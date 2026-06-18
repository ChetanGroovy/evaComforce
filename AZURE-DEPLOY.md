# comforceEva → Azure — quick deploy guide

Two parts: **(1) push the code to a repo**, **(2) deploy to Azure**. The deployable app is the
`platform/` monorepo (Fastify API that also serves the built React UI).

> ⚠️ **Before you start — secrets & PHI.** The repo is configured so these are **never committed**:
> `.env` (credentials), `studies/` (patient PHI + study configs), `.studies-backup/`, all `*-FULL.*` /
> `*-REDACTED.*` reports. Verify with `git status` after `git add -A` — if you see any of those, STOP.
> A clinical password was exposed earlier in this project's history → **rotate it** before going live.

---

## 0. One-time local prep

```bash
cd /home/groovy/Desktop/projects/comforceEva

# sanity: build + test the app
cd platform
corepack pnpm@9 install
corepack pnpm@9 -r build
corepack pnpm@9 -r test          # engine 106 · extractor 25 · eval 14 · api 16 — all green
cd ..
```

---

## 1. Push the code to Azure Repos (Azure DevOps Git)

```bash
cd /home/groovy/Desktop/projects/comforceEva

git init -b main
git add -A
git status            # ← CONFIRM no .env / studies/ / *-FULL.* / .studies-backup appear
git commit -m "comforceEva platform: deterministic prescreening engine + UI"

# Create a project + repo in Azure DevOps (https://dev.azure.com/<org>), then:
git remote add origin https://<org>@dev.azure.com/<org>/<project>/_git/comforceEva
git push -u origin main
```

*(GitHub instead? `git remote add origin https://github.com/<you>/comforceEva.git` then push — Azure deploys from GitHub too.)*

---

## 2. Deploy to Azure — pick one

### Option A — Azure Container Apps (recommended: simplest, scales to zero)

```bash
# variables
RG=comforceeva-rg
LOC=eastus
ACR=comforceevaacr$RANDOM           # must be globally unique, lowercase
APP=comforceeva-api
ENVNAME=comforceeva-env

az group create -n $RG -l $LOC

# build the image in the cloud (no local Docker needed) from the platform/ context
az acr create -n $ACR -g $RG --sku Basic --admin-enabled true
az acr build -r $ACR -t comforceeva:latest ./platform     # uses platform/Dockerfile

# container apps environment + app
az containerapp env create -n $ENVNAME -g $RG -l $LOC
az containerapp create -n $APP -g $RG \
  --environment $ENVNAME \
  --image $ACR.azurecr.io/comforceeva:latest \
  --registry-server $ACR.azurecr.io \
  --target-port 8080 --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --env-vars PORT=8080 HOST=0.0.0.0 STUDIES_DIR=/data/studies

# get the URL
az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv
```

### Option B — Azure App Service (Web App for Containers)

```bash
az acr build -r $ACR -t comforceeva:latest ./platform
az appservice plan create -n comforceeva-plan -g $RG --is-linux --sku B1
az webapp create -n comforceeva-app -g $RG -p comforceeva-plan \
  --deployment-container-image-name $ACR.azurecr.io/comforceeva:latest
az webapp config appsettings set -n comforceeva-app -g $RG --settings \
  WEBSITES_PORT=8080 PORT=8080 STUDIES_DIR=/data/studies
```

---

## 3. Study data (PHI) — mount, don't bake

The image ships **no** patient data. Provide `studies/` at runtime via **Azure Files**, mounted at `STUDIES_DIR` (`/data/studies`):

```bash
# storage + file share
az storage account create -n comforceevasa$RANDOM -g $RG -l $LOC --sku Standard_LRS
az storage share create   -n studies --account-name <storageAccount>

# Container Apps: add the share as a volume
az containerapp env storage set -n $ENVNAME -g $RG \
  --storage-name studies --azure-file-account-name <storageAccount> \
  --azure-file-account-key <key> --azure-file-share-name studies --access-mode ReadWrite
# then add a volume + volumeMount (STUDIES_DIR=/data/studies) to the app YAML and update.
```

Upload your `studies/<id>/study.json` configs to the share (or use the in-app **"+ New Study"** upload).
Keep PHI in this share with encryption + access controls — never in the image or repo.

---

## 4. Secrets

Set real secrets as Azure secrets/app-settings, never in the repo:

```bash
az containerapp secret set -n $APP -g $RG --secrets anthropic-key=<KEY>
az containerapp update    -n $APP -g $RG --set-env-vars ANTHROPIC_API_KEY=secretref:anthropic-key
```

`ANTHROPIC_API_KEY` is optional — the per-turn extractor falls back to the deterministic rule engine if unset.

---

## 5. Verify the deployment

```bash
URL=https://<fqdn>
curl -s $URL/                       # → 200, serves the UI
curl -s $URL/api/studies            # → study list (after the Files share is populated)
```

Open `$URL` in a browser → pick a study → Start Screening.

---

## Compliance notes (clinical / HIPAA)
- PHI stays on the Azure Files share (encryption at rest + RBAC); not in git, not in the image.
- Sign a **BAA** with Microsoft; enable HTTPS-only ingress, Azure Monitor/audit logs, and private networking if required.
- The verification harness (`platform/apps/web/e2e/`) re-runs the full UI/API/visual suite against any deployed URL — point its base URL at `$URL` to gate releases.
