#!/bin/bash
# Self-test for egress-grep.sh: build a throwaway tree with known hits and
# assert the gate's exit codes and counts. Exits non-zero on the first failure.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
gate="$here/../egress-grep.sh"
rc=0
fail() { echo "FAIL: $*"; rc=1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/neutered/gate" "$tmp/neutered/guard" "$tmp/packages/foo/src" "$tmp/packages/llm/llm-local/src"
cp "$here/../forbidden-patterns.txt" "$tmp/neutered/gate/forbidden-patterns.txt"
cp "$gate" "$tmp/neutered/gate/egress-grep.sh"
( cd "$tmp" && git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -qm x )

# (a) clean file — no hit.
echo 'export const answer = 42' > "$tmp/packages/foo/src/clean.ts"
# (b) a forbidden destination anywhere.
echo 'const u = "https://harness-telemetry.deepseeksvc.com/v1/logs"' > "$tmp/packages/foo/src/bad-dest.ts"
# (c) a primitive inside an allowed root — must NOT count.
echo "import http from 'node:http'" > "$tmp/neutered/guard/ok-primitive.ts"
echo "const c = await fetch('http://127.0.0.1:1234/')" > "$tmp/packages/llm/llm-local/src/ok-fetch.ts"
# (d) the same primitive outside an allowed root — must count.
echo "import net from 'node:net'" > "$tmp/packages/foo/src/bad-primitive.ts"
# (e) a URL in a comment — must NOT count as a destination.
echo '// see https://example.com/spec for details' > "$tmp/packages/foo/src/comment.ts"

out="$(bash "$tmp/neutered/gate/egress-grep.sh" "$tmp" 2>&1)"; code=$?
[ "$code" -eq 1 ] || fail "expected exit 1 on hits, got $code"
echo "$out" | grep -q "bad-dest.ts" || fail "did not flag the forbidden destination"
echo "$out" | grep -q "bad-primitive.ts" || fail "did not flag the out-of-root primitive"
echo "$out" | grep -q "ok-primitive.ts" && fail "wrongly flagged a primitive in neutered/guard"
echo "$out" | grep -q "ok-fetch.ts" && fail "wrongly flagged a fetch in llm-local"
echo "$out" | grep -q "comment.ts" && fail "wrongly flagged a URL in a comment"
summary="$(echo "$out" | tail -1)"
echo "$summary" | grep -q "1 destination hits, 1 primitive hits" || fail "summary counts wrong: $summary"

# JSON is valid and reports the same shape.
json="$(bash "$tmp/neutered/gate/egress-grep.sh" "$tmp" --json 2>/dev/null)"
echo "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(j.mode!=="sources"||j.destinations.length!==1||j.primitives.length!==1)process.exit(1)})' || fail "--json shape wrong"

# A clean tree exits 0.
rm "$tmp/packages/foo/src/bad-dest.ts" "$tmp/packages/foo/src/bad-primitive.ts"
bash "$tmp/neutered/gate/egress-grep.sh" "$tmp" >/dev/null 2>&1; [ $? -eq 0 ] || fail "clean tree should exit 0"

mkdir -p "$tmp/neutered/release"
echo 'url "https://github.com/owner/repo"' > "$tmp/neutered/release/dsh-neutered.rb.in"
echo "require('node:net').connect(443, 'example.com')" > "$tmp/neutered/release/verify.cjs"
bash "$tmp/neutered/gate/egress-grep.sh" "$tmp" >/dev/null 2>&1; [ $? -eq 0 ] || fail "maintainer release files should be excluded"
cp "$tmp/neutered/release/verify.cjs" "$tmp/neutered/release/runtime.cjs"
bash "$tmp/neutered/gate/egress-grep.sh" "$tmp" >/dev/null 2>&1; [ $? -eq 1 ] || fail "release exclusion must not cover adjacent runtime code"

echo "egress-grep.test: rc=$rc"
exit $rc
