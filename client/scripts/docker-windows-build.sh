#!/bin/sh
set -eu
cd /app
export ELECTRON_SKIP_BINARY_DOWNLOAD=1 CSC_IDENTITY_AUTO_DISCOVERY=false
signature=$(node -e 'const fs=require("node:fs"),c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync("package-lock.json")).update(process.version).digest("hex"))')
if [ ! -f node_modules/.volna-install ] || [ "$(cat node_modules/.volna-install)" != "$signature" ]; then
  npm ci --prefer-offline --no-audit --no-fund
  printf '%s' "$signature" > node_modules/.volna-install
else
  echo 'Reusing Windows npm dependencies from cache.'
fi
node scripts/prepare-windows.mjs
VOLNA_DESKTOP_BUILD=1 npm run build
npm run windows
version=$(node -p 'require("./package.json").version')
mkdir -p "/out/$version"
node scripts/verify-windows.mjs release "/out/$version/release-info.json"
cp release/*.exe release/*.exe.blockmap release/latest.yml "/out/$version/"
echo 'Verified Windows installer and update feed.'
