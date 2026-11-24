#!/usr/bin/env bash
# Exercises a running stack through its front door: smoke-test.sh http://localhost:5173
set -euo pipefail
BASE="${1:?usage: smoke-test.sh BASE_URL}"
API="$BASE/api/v1"
EMAIL="smoke-$(date +%s)@example.com"
JSON='content-type: application/json'
pass() { printf 'PASS  %s\n' "$*"; }

curl -fsS "$API/health/ready" | grep -q '"status":"ready"' && pass "API ready (database and storage)"
curl -fsS "$BASE/files/deep/link" | grep -q '<div id="root">' && pass "app shell served for deep links"
curl -fsSI "$BASE/" | grep -qi '^content-security-policy:' && pass "security headers present"
test "$(curl -s -o /dev/null -w '%{http_code}' "$API/files")" = 401 && pass "API rejects anonymous requests"

TOKEN="$(curl -fsS -H "$JSON" -d "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"password\":\"Smoke-test-1\"}" "$API/auth/register" |
  sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
test -n "$TOKEN" && pass "registration"
AUTH="authorization: Bearer $TOKEN"

BODY="The penguin colony lives on the southern ice shelf."
FILE="$(curl -fsS -H "$AUTH" --form-string note=x -F "file=@-;filename=smoke.txt;type=text/plain" "$API/files" <<<"$BODY" | sed -n 's/.*"data":{"id":"\([^"]*\)".*/\1/p')"
test -n "$FILE" && pass "upload"
URL="$(curl -fsS -H "$AUTH" "$API/files/$FILE/download" | sed -n 's/.*"downloadUrl":"\([^"]*\)".*/\1/p' | sed 's/\\u0026/\&/g')"
test "$(curl -fsS "$URL")" = "$BODY" && pass "download from storage with the browser-facing URL"

for _ in $(seq 1 60); do
  STATUS="$(curl -fsS -H "$AUTH" "$API/ai/files/$FILE" | sed -n 's/.*"status":"\([a-z_]*\)","supported".*/\1/p')"
  [ "$STATUS" = ready ] && break
  sleep 2
done
test "$STATUS" = ready && pass "indexed by the separate worker with local embeddings"
curl -fsS -H "$AUTH" -H "$JSON" -d '{"query":"where do the birds live"}' "$API/ai/search" | grep -q "$FILE" && pass "semantic search"
curl -fsS -X DELETE -H "$AUTH" "$API/files/$FILE" >/dev/null && pass "delete"
echo "Smoke test passed"
