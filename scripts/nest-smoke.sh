#!/usr/bin/env bash
# End-to-end smoke of @arkveil/nest on a fresh NestJS scaffold.
#
# Scaffolds an application with the given @nestjs/cli version (11 → CommonJS,
# 12 → ESM), installs the packed SDK tarballs with no peer flags, drops in the
# getting-started walkthrough from scripts/nest-smoke/, builds it, and checks
# one grant and one deny against a stub kernel. Same files as the landing
# walkthrough, except that the service URL points at the stub.
#
# usage: scripts/nest-smoke.sh <@nestjs/cli@N> <dir holding arkveil-*.tgz>
set -euo pipefail

CLI=$1
TARBALLS=$(cd "$2" && pwd)
FIXTURES=$(cd "$(dirname "$0")/nest-smoke" && pwd)
WORK=$(mktemp -d)
STUB_PORT=${STUB_PORT:-4010}
APP_PORT=${APP_PORT:-3010}

cleanup() { kill "${APP_PID:-}" "${STUB_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT

echo "== scaffold with $CLI (npm $(npm --version), node $(node --version))"
cd "$WORK"
npx --yes "$CLI" new app --package-manager npm --skip-git --strict < /dev/null > scaffold.log 2>&1 || { cat scaffold.log; exit 1; }
cd app
node -e 'const p = require("./package.json"); console.log("type:", p.type ?? "commonjs", "| @nestjs/core", p.dependencies["@nestjs/core"], "| typescript", p.devDependencies.typescript)'

echo "== install the packed SDK (no peer flags)"
npm install "$TARBALLS"/arkveil-[0-9]*.tgz "$TARBALLS"/arkveil-nest-*.tgz

echo "== walkthrough files"
rm -f src/app.controller.ts src/app.service.ts src/app.controller.spec.ts
cp "$FIXTURES"/*.ts src/

echo "== build"
npm run build

echo "== run against the stub kernel"
node "$FIXTURES/stub-kernel.mjs" "$STUB_PORT" & STUB_PID=$!
ARKVEIL_SERVICE_URL="http://127.0.0.1:$STUB_PORT" ARKVEIL_API_KEY=smoke PORT=$APP_PORT \
  node dist/main.js > app.log 2>&1 & APP_PID=$!
for _ in $(seq 1 60); do grep -q 'successfully started' app.log && break; sleep 0.5; done
grep -q 'successfully started' app.log || { cat app.log; exit 1; }

check() { # <label> <expected status> <x-user json>
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "http://127.0.0.1:$APP_PORT/invoices/inv-1" -H "x-user: $3")
  echo "$1 → HTTP $status (expected $2)"
  [ "$status" = "$2" ]
}
check manager 200 '{"id":"u-42","role":"manager","region":"EU"}'
check viewer 403 '{"id":"u-7","role":"viewer"}'
echo "== OK: $CLI"
