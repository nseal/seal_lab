# Azure Container Apps デプロイ手順書

MCP Gateway を Azure Container Apps にデプロイする手順です。az CLI のコマンドを上から順にコピー&ペーストで実行できる構成になっています。

## 構成概要

```
[MCPクライアント / 管理者ブラウザ]
        │ HTTPS (Container Apps が自動で証明書付与)
        ▼
[Azure Container Apps]  ── mcp-gateway コンテナ ×1 レプリカ
        │  /data にマウント
        ▼
[Azure Files 共有]      ── gateway.db (SQLite) を永続化
[Azure Container Registry] ── コンテナ image
```

- **レプリカは 1 固定**にします。SQLite は単一ライタ前提のため、複数レプリカにするとDBが破損します(スケールアウトが必要になったら PostgreSQL 移行が先です)。
- Azure Files は SMB マウントで SQLite の WAL モードが機能しないため、環境変数 `MCP_GATEWAY_SQLITE_JOURNAL=DELETE` を必ず設定します。

## 0. 前提条件

- Azure サブスクリプションと、リソースグループ作成権限のあるアカウント
- [az CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) がインストール済みで `az login` 済み
- ローカルに Docker は**不要**(image は `az acr build` でクラウドビルドします)

```bash
az login
az account show   # 対象サブスクリプションであることを確認
az extension add --name containerapp --upgrade   # 初回のみ
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

## 1. 変数定義

以降のコマンドが参照する変数をまとめて定義します。名前はグローバル一意制約のあるもの(ACR・ストレージ)だけ調整してください。

```bash
LOCATION=japaneast
RG=rg-mcp-gateway
ACR=mcpgatewayacr$RANDOM          # 英数字のみ・グローバル一意
STORAGE=mcpgwstore$RANDOM         # 英数字小文字のみ・グローバル一意
SHARE=mcp-gateway-data
ENV_NAME=cae-mcp-gateway
APP=mcp-gateway
IMAGE=$ACR.azurecr.io/mcp-gateway:v1

echo "ACR=$ACR STORAGE=$STORAGE"  # 後で使うため控えておく
```

## 2. リソースグループと ACR、image のビルド

```bash
az group create --name $RG --location $LOCATION

az acr create --resource-group $RG --name $ACR --sku Basic

# リポジトリの mcp-gateway/ ディレクトリで実行(クラウド側で docker build が走る)
cd mcp-gateway
az acr build --registry $ACR --image mcp-gateway:v1 .
```

## 3. SQLite 永続化用の Azure Files

```bash
az storage account create \
  --resource-group $RG --name $STORAGE --location $LOCATION \
  --sku Standard_LRS --kind StorageV2

az storage share-rm create \
  --resource-group $RG --storage-account $STORAGE \
  --name $SHARE --quota 5

STORAGE_KEY=$(az storage account keys list \
  --resource-group $RG --account-name $STORAGE \
  --query "[0].value" --output tsv)
```

## 4. Container Apps 環境とストレージマウント登録

```bash
az containerapp env create \
  --resource-group $RG --name $ENV_NAME --location $LOCATION

az containerapp env storage set \
  --resource-group $RG --name $ENV_NAME \
  --storage-name gatewaydata \
  --azure-file-account-name $STORAGE \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name $SHARE \
  --access-mode ReadWrite
```

## 5. シークレット生成とアプリ作成

```bash
# ゲートウェイのシークレットを生成(値は安全な場所に控える。MASTER_KEY を失うと保存済み上流トークンを復号できません)
MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ADMIN_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")

ACR_PASSWORD=$(az acr credential show --name $ACR --query "passwords[0].value" --output tsv)

az containerapp create \
  --resource-group $RG --name $APP \
  --environment $ENV_NAME \
  --image $IMAGE \
  --registry-server $ACR.azurecr.io \
  --registry-username $ACR \
  --registry-password "$ACR_PASSWORD" \
  --target-port 8787 \
  --ingress external \
  --min-replicas 1 --max-replicas 1 \
  --secrets master-key="$MASTER_KEY" admin-token="$ADMIN_TOKEN" \
  --env-vars \
    MCP_GATEWAY_MASTER_KEY=secretref:master-key \
    MCP_GATEWAY_ADMIN_TOKEN=secretref:admin-token \
    MCP_GATEWAY_DB_PATH=/data/gateway.db \
    MCP_GATEWAY_SQLITE_JOURNAL=DELETE
```

続いて Azure Files をコンテナにマウントします(CLI ではボリューム指定を YAML で行うのが確実です):

```bash
az containerapp show --resource-group $RG --name $APP --output yaml > app.yaml
```

`app.yaml` の `template:` セクションを編集し、`volumes` と `volumeMounts` を追加します:

```yaml
template:
  containers:
    - image: <そのまま>
      name: mcp-gateway
      # ... env などはそのまま ...
      volumeMounts:
        - volumeName: gatewaydata
          mountPath: /data
  volumes:
    - name: gatewaydata
      storageName: gatewaydata      # 手順4で登録した storage-name
      storageType: AzureFile
```

反映します:

```bash
az containerapp update --resource-group $RG --name $APP --yaml app.yaml
rm app.yaml   # キー情報は含まれないが不要ファイルは消しておく
```

## 6. 動作確認

```bash
FQDN=$(az containerapp show --resource-group $RG --name $APP \
  --query "properties.configuration.ingress.fqdn" --output tsv)

curl https://$FQDN/healthz          # -> {"ok":true}
echo "管理画面: https://$FQDN/admin/"
echo "管理トークン: $ADMIN_TOKEN"
```

1. ブラウザで `https://$FQDN/admin/` を開き、`$ADMIN_TOKEN` でログイン
2. 接続口を作成(アダプタ: Asana / Atlassian / Box / Generic、上流トークン、許可テナントID)
3. 「上流からツールを取得」で公開ツールを選択し、APIキーを発行
4. クライアントから接続:

```bash
claude mcp add my-asana --transport http https://$FQDN/mcp/<slug> \
  --header "Authorization: Bearer mcpgw_..."
```

再起動しても接続口設定が残ること(= Azure Files 永続化)を確認するには:

```bash
az containerapp revision restart --resource-group $RG --name $APP \
  --revision $(az containerapp revision list -g $RG -n $APP --query "[0].name" -o tsv)
curl -s https://$FQDN/api/admin/endpoints -H "Authorization: Bearer $ADMIN_TOKEN"
```

## 7. 運用

### 更新デプロイ

```bash
cd mcp-gateway
az acr build --registry $ACR --image mcp-gateway:v2 .
az containerapp update --resource-group $RG --name $APP \
  --image $ACR.azurecr.io/mcp-gateway:v2
```

### ログ確認

```bash
az containerapp logs show --resource-group $RG --name $APP --follow
```

### DB バックアップ

Azure Files 共有上の `gateway.db` をコピーするだけです(上流トークンは暗号化済み):

```bash
az storage file download --account-name $STORAGE --account-key "$STORAGE_KEY" \
  --share-name $SHARE --path gateway.db --dest ./gateway-backup-$(date +%Y%m%d).db
```

### シークレットのローテーション

- **ADMIN_TOKEN**: `az containerapp secret set -g $RG -n $APP --secrets admin-token=<新値>` 後、リビジョン再起動
- **MASTER_KEY**: 変更すると既存の上流トークンが復号不能になります。ローテーションする場合は、変更後に各接続口の上流トークンを管理画面から再登録してください

### 注意事項

- **レプリカを増やさないこと**(`--max-replicas 1` を維持)。SQLite の単一ライタ制約のためです
- 管理画面 (`/admin/`) とMCPエンドポイントは外部公開されます。管理トークン・APIキーの管理を徹底し、必要に応じて Container Apps の IP 制限 (`az containerapp ingress access-restriction`) で管理元IPを絞ることを推奨します
- Box の OAuth アクセストークンは有効期限が短い(標準60分)ため、本番運用では長期利用可能なトークン取得方法(Box Platform の CCG 等)の検討が必要です

## トラブルシューティング

| 症状 | 確認ポイント |
| --- | --- |
| コンテナが起動しない | `az containerapp logs show` で `MCP_GATEWAY_MASTER_KEY is required` 等の起動エラーを確認 |
| `SQLITE_BUSY` / DB破損 | レプリカ数が1か、`MCP_GATEWAY_SQLITE_JOURNAL=DELETE` が設定されているか確認 |
| 設定が再起動で消える | ボリュームマウント(手順5のYAML)が反映されているか `az containerapp show -o yaml` で確認 |
| 上流に接続できない (502) | 接続口の上流URL・トークンを確認。`discover-tools` のエラーメッセージに上流の応答が含まれます |
