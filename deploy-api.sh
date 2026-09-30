#!/usr/bin/env bash
# ============================================================
#  Brandix — STEP 1: put the API online (Railway)
#  Run from Terminal:   bash deploy-api.sh
#  The ONLY manual moment is approving the Railway login in your
#  browser. Everything else is automatic.
# ============================================================
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
echo "==> Project: $ROOT"

# 1) Railway CLI ------------------------------------------------
if ! command -v railway >/dev/null 2>&1; then
  echo "==> Installing Railway CLI..."
  npm install -g @railway/cli || sudo npm install -g @railway/cli
fi
echo "==> Railway CLI: $(railway --version 2>/dev/null || echo installed)"

# 2) Login (interactive — approve in your browser) -------------
if ! railway whoami >/dev/null 2>&1; then
  echo "==> A browser window will open. Approve the login, then come back here."
  railway login
fi
echo "==> Logged in as: $(railway whoami 2>/dev/null)"

# 3) Link to your existing project (pick the one with Postgres) -
if ! railway status >/dev/null 2>&1; then
  echo "==> Use the arrow keys to select your project (the one with your Postgres)."
  railway link
fi

# 4) Pick / create the API service (NEVER deploy onto Postgres) -
echo ""
echo "==> Your code must deploy to its OWN service, not the Postgres one."
echo "    If you haven't already: open the Railway dashboard, open this project,"
echo "    click '+ New' -> 'Empty Service', name it 'api'. Then on that 'api'"
echo "    service go to Variables and add:   DATABASE_URL = \${{Postgres.DATABASE_URL}}"
echo ""
read -r -p "Name of the API service to deploy to [api]: " SVC
SVC="${SVC:-api}"

# 5) Deploy ----------------------------------------------------
echo "==> Deploying to service '$SVC' (uploads source only; node_modules is ignored)..."
railway up --service "$SVC"

# 6) Get / create a public URL ---------------------------------
echo "==> Ensuring a public domain exists..."
DOMAIN_OUT="$(railway domain --service "$SVC" 2>&1 || railway domain 2>&1 || true)"
echo "$DOMAIN_OUT"
URL="$(echo "$DOMAIN_OUT" | grep -oE 'https://[a-zA-Z0-9.-]+' | head -1)"

if [ -z "$URL" ]; then
  echo ""
  echo "==> Couldn't read the URL automatically."
  echo "    Open Railway dashboard -> your API service -> Settings -> Networking,"
  echo "    click 'Generate Domain', copy the https URL, and paste it here:"
  read -r URL
fi

URL="${URL%/}"
echo "==> API public URL: $URL"

# 7) Point all four apps at it (writes .env files) -------------
for app in booking-web kitchen verification admin; do
  echo "VITE_API_URL=$URL" > "apps/$app/.env"
  echo "   wrote apps/$app/.env"
done

echo ""
echo "============================================================"
echo " DONE. Your API is live at: $URL"
echo " Quick check: open  $URL/admin/settings  in a browser —"
echo " you should see JSON, not an error."
echo " Next: run  bash build-android.sh  to build the phone apps."
echo "============================================================"
