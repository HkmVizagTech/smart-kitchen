#!/usr/bin/env bash
# ============================================================
#  Akshaya Patra — push a self-hosted OTA update (no Capgo cloud,
#  no fees). Builds each app, zips it, and uploads to YOUR Railway
#  API. Installed apps then show "Update now".
#
#  Requires (one-time): set the same secret on the API (Railway env
#  UPDATE_SECRET) and locally. Then:
#     UPDATE_SECRET=your-secret bash push-update.sh
# ============================================================
set -e
cd "$(dirname "$0")"

# API base comes from the apps' .env (written by deploy-api.sh)
API="$(grep -h '^VITE_API_URL=' apps/booking-web/.env 2>/dev/null | head -1 | cut -d= -f2-)"
if [ -z "$API" ]; then echo "!! No VITE_API_URL in apps/booking-web/.env — run deploy-api.sh first."; exit 1; fi
API="${API%/}"
if [ -z "$UPDATE_SECRET" ]; then
  echo "!! Set UPDATE_SECRET first (same value as the API's Railway variable):"
  echo "     UPDATE_SECRET=your-secret bash push-update.sh"
  exit 1
fi
echo "==> API: $API"

# Optional first arg = push just one app, e.g.  bash push-update.sh admin
ONLY="$1"

for app in booking-web kitchen verification admin; do
  case "$app" in
    booking-web) key=booking ;;
    kitchen) key=kitchen ;;
    verification) key=verification ;;
    admin) key=admin ;;
  esac
  if [ -n "$ONLY" ] && [ "$ONLY" != "$key" ] && [ "$ONLY" != "$app" ]; then continue; fi
  echo ""
  echo "============================================================"
  echo " Pushing update: $app  ->  /updates/$key"
  echo "============================================================"
  pushd "apps/$app" >/dev/null
  npm version patch --no-git-tag-version >/dev/null
  VER="$(node -p "require('./package.json').version")"
  echo "   version -> $VER"
  pnpm run build
  # zip the built web files at the root of the archive
  rm -f bundle.zip
  ( cd dist && zip -qr ../bundle.zip . )
  echo "   uploading $(du -h bundle.zip | cut -f1) …"
  curl -fsS -X POST "$API/updates/$key?version=$VER" \
    -H "x-update-secret: $UPDATE_SECRET" \
    -H "content-type: application/zip" \
    --data-binary @bundle.zip
  echo ""
  rm -f bundle.zip
  popd >/dev/null
done

echo ""
echo "============================================================"
echo " Done. Open each app on a phone — it shows 'Update now'."
echo "============================================================"
