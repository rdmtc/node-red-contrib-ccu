#!/usr/bin/env bash
# Ask the Node-RED flow library (flows.nodered.org) to pick up the version just published to npm.
#
# The library notices new npm versions late or not at all; its "check for update" button submits
# the "add a node" form, which this script does the same way: GET /add/node for the session cookie
# and the form's CSRF token, then POST /add/node with the module name. No login is needed. The
# palette manager reads catalogue.nodered.org, which is rebuilt from the library periodically.
#
# Usage: .github/flows-refresh.sh [<package> [<version>]]   (defaults: name and version of ./package.json)
# Env:   FLOWS_REFRESH_DELAY  seconds to wait first for the npm registry to propagate (default 60)
#
# Not an official API: every failure is a GitHub Actions warning, and the script always exits 0.

set -u

PKG=${1:-$(node -p 'require("./package.json").name')}
VERSION=${2:-$(node -p 'require("./package.json").version')}
BASE=https://flows.nodered.org
DELAY=${FLOWS_REFRESH_DELAY:-60}

warn() { echo "::warning title=Node-RED flow library::$*"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# One GET + POST with a fresh cookie jar. Returns 0 when the library took the update or already
# had it, 1 otherwise; the reason is in $RESULT.
refresh() {
    rm -f "$TMP/jar"
    local code csrf
    code=$(curl -sS -m 30 -c "$TMP/jar" -o "$TMP/form.html" -w '%{http_code}' "$BASE/add/node") || {
        RESULT="GET /add/node failed (curl)"
        return 1
    }
    if [ "$code" != 200 ]; then
        RESULT="GET /add/node answered HTTP $code"
        return 1
    fi
    csrf=$(sed -n 's/.*id="add-node-csrf"[^>]*value="\([^"]*\)".*/\1/p' "$TMP/form.html" | head -n 1)
    if [ -z "$csrf" ]; then
        RESULT="no _csrf token in the add form (page layout changed?)"
        return 1
    fi
    code=$(curl -sS -m 120 -b "$TMP/jar" -c "$TMP/jar" -o "$TMP/answer.txt" -w '%{http_code}' \
        --data-urlencode "module=$PKG" --data-urlencode "_csrf=$csrf" "$BASE/add/node") || {
        RESULT="POST /add/node failed (curl)"
        return 1
    }
    local answer
    answer=$(head -c 300 "$TMP/answer.txt" | tr -d '\r' | tr '\n' ' ')
    case "$code" in
        2?? | 3??)
            RESULT="updated (HTTP $code: $answer)"
            return 0
            ;;
    esac
    if grep -qi 'already at latest version' "$TMP/answer.txt"; then
        RESULT="already at the latest version (HTTP $code)"
        return 0
    fi
    RESULT="POST /add/node answered HTTP $code: $answer"
    return 1
}

echo "Node-RED flow library: refreshing $PKG $VERSION"
if [ "$DELAY" -gt 0 ]; then
    echo "waiting ${DELAY}s for the npm registry"
    sleep "$DELAY"
fi

ok=
for wait in 0 30 60 120; do
    if [ "$wait" -gt 0 ]; then
        echo "retrying in ${wait}s"
        sleep "$wait"
    fi
    if refresh; then
        ok=1
        echo "$RESULT"
        break
    fi
    echo "attempt failed: $RESULT"
done
if [ -z "$ok" ]; then
    warn "could not refresh $PKG: $RESULT - click \"check for update\" on $BASE/node/$PKG"
    exit 0
fi

# The library lists the npm `latest` dist-tag; a prerelease goes to `next` and does not show there.
case "$VERSION" in
    *-*)
        echo "$VERSION is a prerelease (npm dist-tag next): the library keeps showing the latest release"
        exit 0
        ;;
esac

shown=
for wait in 0 30 60; do
    [ "$wait" -gt 0 ] && sleep "$wait"
    shown=$(curl -sS -m 30 "$BASE/node/$PKG" | sed -n 's/.*<span class="flow-version">\([^<]*\)<\/span>.*/\1/p' | head -n 1)
    [ "$shown" = "$VERSION" ] && break
done
if [ "$shown" = "$VERSION" ]; then
    echo "the library shows $PKG $shown: $BASE/node/$PKG"
else
    warn "the library shows $PKG ${shown:-(no version found)}, expected $VERSION: $BASE/node/$PKG"
fi
exit 0
