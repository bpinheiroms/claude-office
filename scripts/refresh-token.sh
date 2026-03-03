#!/bin/bash
# Refresh Claude Code OAuth token and write back to keychain.
# Runs as a SessionStart hook to keep the keychain token fresh
# before Claude Code can rotate the refresh token internally.
#
# Exit codes: 0 = success or not needed, 1 = error (non-blocking)

set -euo pipefail

KEYCHAIN_SERVICE="Claude Code-credentials"
OAUTH_CLIENT_ID="9d1c250a-e61b-44d9-88ed-5944d1962f5e"
TOKEN_URL="https://console.anthropic.com/v1/oauth/token"

# Read current credentials from keychain
CREDS=$(/usr/bin/security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null) || exit 0

# Parse with python3 (available on all macOS)
eval "$(echo "$CREDS" | python3 -c "
import json, sys, time, shlex
d = json.load(sys.stdin).get('claudeAiOauth', {})
at = d.get('accessToken', '')
rt = d.get('refreshToken', '')
exp = d.get('expiresAt', 0)
now = int(time.time() * 1000)
needs_refresh = 'true' if (exp > 0 and exp - now < 1800000) else 'false'
print(f'ACCESS_TOKEN={shlex.quote(at)}')
print(f'REFRESH_TOKEN={shlex.quote(rt)}')
print(f'EXPIRES_AT={exp}')
print(f'NEEDS_REFRESH={needs_refresh}')
" 2>/dev/null)" || exit 0

# Skip if token is still valid for > 30 min
if [ "$NEEDS_REFRESH" = "false" ]; then
  exit 0
fi

# Skip if no refresh token
if [ -z "$REFRESH_TOKEN" ]; then
  exit 0
fi

# Call token refresh endpoint
RESPONSE=$(curl -s --max-time 5 -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=${REFRESH_TOKEN}" \
  --data-urlencode "client_id=${OAUTH_CLIENT_ID}" 2>/dev/null) || exit 0

# Parse response
eval "$(echo "$RESPONSE" | python3 -c "
import json, sys, time, shlex
d = json.load(sys.stdin)
at = d.get('access_token', '')
rt = d.get('refresh_token', '')
exp_in = d.get('expires_in', 0)
err = d.get('error', '')
if err:
    print(f'NEW_ACCESS_TOKEN={shlex.quote(str())}')
    print(f'REFRESH_ERROR={shlex.quote(err)}')
else:
    exp_at = int(time.time() * 1000) + (exp_in * 1000)
    print(f'NEW_ACCESS_TOKEN={shlex.quote(at)}')
    print(f'NEW_REFRESH_TOKEN={shlex.quote(rt)}')
    print(f'NEW_EXPIRES_AT={exp_at}')
    print(f'REFRESH_ERROR={shlex.quote(str())}')
" 2>/dev/null)" || exit 0

# If refresh failed, nothing to do
if [ -z "$NEW_ACCESS_TOKEN" ]; then
  exit 0
fi

# Build updated credentials JSON and write back to keychain
UPDATED_CREDS=$(echo "$CREDS" | python3 -c "
import json, sys, os
d = json.load(sys.stdin)
oauth = d.get('claudeAiOauth', {})
oauth['accessToken'] = os.environ.get('NEW_ACCESS_TOKEN', oauth.get('accessToken'))
rt = os.environ.get('NEW_REFRESH_TOKEN', '')
if rt:
    oauth['refreshToken'] = rt
exp = os.environ.get('NEW_EXPIRES_AT', '')
if exp:
    oauth['expiresAt'] = int(exp)
d['claudeAiOauth'] = oauth
print(json.dumps(d))
" 2>/dev/null) || exit 0

# Update keychain entry
# First find the account name
ACCOUNT=$(/usr/bin/security find-generic-password -s "$KEYCHAIN_SERVICE" 2>/dev/null | grep "acct" | head -1 | sed 's/.*<blob>="\(.*\)"/\1/' 2>/dev/null) || ACCOUNT=""

# Delete old and add new
/usr/bin/security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "${ACCOUNT:-claude}" >/dev/null 2>&1 || true
/usr/bin/security add-generic-password -s "$KEYCHAIN_SERVICE" -a "${ACCOUNT:-claude}" -w "$UPDATED_CREDS" >/dev/null 2>&1 || exit 0

exit 0
