#!/usr/bin/env bash
# ============================================================
#  Akshaya Patra — deploy the 4 web apps to Railway.
#  Run AFTER you've created the 4 services in the dashboard
#  (see DEPLOY_WEB.md). Then:  bash deploy-web.sh
#  Optional: one app only ->   bash deploy-web.sh web-admin
# ============================================================
set -e
cd "$(dirname "$0")"

ONLY="$1"
# service name  ->  config file
deploy() { # $1 = railway service name (its Config File is set in the dashboard)
  if [ -n "$ONLY" ] && [ "$ONLY" != "$1" ]; then return; fi
  echo ""
  echo "============================================================"
  echo " Deploying $1"
  echo "============================================================"
  # --detach: upload + trigger build but DON'T tail logs forever (the static
  # server never exits, which would block the loop on the next app).
  railway up --service "$1" --detach
}

deploy web-booking
deploy web-kitchen
deploy verification
deploy admin

echo ""
echo "Done. In the Railway dashboard, open each web service ->"
echo "Settings -> Networking -> Generate Domain to get its public URL."
