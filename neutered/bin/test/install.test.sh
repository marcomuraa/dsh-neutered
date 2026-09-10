#!/bin/bash
# neutered/bin/test/install.test.sh — contract of the installer that does not need the network.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
installer="$here/../install"
rc=0
fail() { echo "FAIL: $*"; rc=1; }

# -h prints usage and exits 0.
out=$(bash "$installer" -h 2>&1); [ $? -eq 0 ] || fail "-h exit code"
echo "$out" | grep -q -- "--no-setup" || fail "-h lacks --no-setup"

# Unknown flags exit 2.
bash "$installer" --bogus >/dev/null 2>&1; [ $? -eq 2 ] || fail "unknown flag should exit 2"

# A non-macOS uname is refused with exit 2 before anything runs.
fake=$(mktemp -d)
printf '#!/bin/bash\necho Linux\n' > "$fake/uname"; chmod +x "$fake/uname"
out=$(PATH="$fake:$PATH" bash "$installer" --no-setup 2>&1); code=$?
[ $code -eq 2 ] || fail "Linux should exit 2 (got $code)"
echo "$out" | grep -q "macOS only" || fail "Linux refusal lacks the macOS-only message"
rm -rf "$fake"

# The installer is bash 3.2 clean.
bash -n "$installer" || fail "syntax"

echo "install.test: rc=$rc"
exit $rc
