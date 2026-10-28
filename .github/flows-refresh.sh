#!/usr/bin/env bash
# Ask the Node-RED flow library (flows.nodered.org) to pick up the version just published to npm.
#
# The library notices new npm versions late or not at all; its "check for update" button submits
# the "add a node" form, which this script does the same way: GET /add/node for the session cookie
# and the form's CSRF token, then POST /add/node with the module name. No login is needed. The
# palette manager reads catalogue.nodered.org, which is rebuilt from the library periodically.
#
# The library reads npm through a cache that lags: right after a publish it may answer "already at
# latest version" while its page still shows the old one (seen with 4.7.1, 25 minutes behind). So
# that answer counts only when the module's page names the new version; otherwise the check is
# repeated with a growing wait (2, 5, 10, 20 minutes by default).
#
# Usage: .github/flows-refresh.sh [<package> [<version>]]   (defaults: name and version of ./package.json)
# Env:   FLOWS_REFRESH_DELAY        seconds to wait first for the npm registry to propagate (default 60)
#        FLOWS_REFRESH_STALE_WAITS  the waits, in seconds, between repeated checks while the library
#                                   still shows the old version (default "120 300 600 1200")
#
# Not an official API: every failure is a GitHub Actions warning, and the script always exits 0.

set -u

PKG=${1:-$(node -p 'require("./package.json").name')}
VERSION=${2:-$(node -p 'require("./package.json").version')}
BASE=https://flows.nodered.org
DELAY=${FLOWS_REFRESH_DELAY:-60}
STALE_WAITS=${FLOWS_REFRESH_STALE_WAITS:-"120 300 600 1200"}

warn() { echo "::warning title=Node-RED flow library::$*"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# The version the module's page shows (empty when the page has none or cannot be read).
page_version() {
    curl -sS -m 30 "$BASE/node/$PKG" 2>/dev/null | sed -n 's/.*<span class="flow-version">\([^<]*\)<\/span>.*/\1/p' | head -n 1
}

# One GET + POST with a fresh cookie jar. Returns 0 when the library took the update or already
# had it, 1 otherwise; the reason is in $RESULT, and $STATUS says which: updated or latest.
refresh() {
    rm -f "$TMP/jar"
    STATUS=
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
            STATUS=updated
            return 0
            ;;
    esac
    if grep -qi 'already at latest version' "$TMP/answer.txt"; then
        RESULT="already at the latest version (HTTP $code)"
        STATUS=latest
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

# The library lists the npm `latest` dist-tag; a prerelease goes to `next` and does not show there.
prerelease=
case "$VERSION" in
    *-*) prerelease=1 ;;
esac

# Ask until the library took the update, or says it already has it *and* its page shows the
# version. A failed request is retried after 30/60/120 s; "already at latest" with the old version
# on the page is the library's lagging npm cache, asked again after the longer waits.
errors=0
stale=0
# shellcheck disable=SC2206
stale_waits=($STALE_WAITS)
error_waits=(30 60 120)
while :; do
    if refresh; then
        echo "$RESULT"
        if [ "$STATUS" = updated ]; then
            break
        fi
        if [ -n "$prerelease" ]; then
            echo "$VERSION is a prerelease (npm dist-tag next): the library keeps showing the latest release"
            exit 0
        fi
        shown=$(page_version)
        if [ "$shown" = "$VERSION" ]; then
            echo "the library shows $PKG $shown: $BASE/node/$PKG"
            exit 0
        fi
        if [ "$stale" -ge "${#stale_waits[@]}" ]; then
            warn "the library says $PKG is at the latest version but shows ${shown:-(no version found)}, expected $VERSION - its npm cache lags; click \"check for update\" on $BASE/node/$PKG later"
            exit 0
        fi
        wait=${stale_waits[$stale]}
        stale=$((stale + 1))
        echo "the library shows ${shown:-(no version found)}, not $VERSION yet - asking again in ${wait}s"
        sleep "$wait"
    else
        echo "attempt failed: $RESULT"
        if [ "$errors" -ge "${#error_waits[@]}" ]; then
            warn "could not refresh $PKG: $RESULT - click \"check for update\" on $BASE/node/$PKG"
            exit 0
        fi
        wait=${error_waits[$errors]}
        errors=$((errors + 1))
        echo "retrying in ${wait}s"
        sleep "$wait"
    fi
done

if [ -n "$prerelease" ]; then
    echo "$VERSION is a prerelease (npm dist-tag next): the library keeps showing the latest release"
    exit 0
fi

# updated: the page follows within moments
shown=
for wait in 0 30 60; do
    [ "$wait" -gt 0 ] && sleep "$wait"
    shown=$(page_version)
    [ "$shown" = "$VERSION" ] && break
done
if [ "$shown" = "$VERSION" ]; then
    echo "the library shows $PKG $shown: $BASE/node/$PKG"
else
    warn "the library shows $PKG ${shown:-(no version found)}, expected $VERSION: $BASE/node/$PKG"
fi
exit 0
