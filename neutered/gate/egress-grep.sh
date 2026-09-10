#!/bin/bash
# dsh-neutered static egress gate.
#
# Fails when the tree holds any known off-machine destination, or any
# network-capable primitive outside the four paths allowed to have one:
#   neutered/guard/            (the runtime guard wraps the primitives on purpose)
#   neutered/gate/             (this gate names the primitives)
#   neutered/setup/            (first-run setup: Homebrew and Hugging Face, never on the task path)
#   packages/llm/llm-local/    (the one HTTP client, pinned to loopback)
#
# Usage: egress-grep.sh [ROOT] [--json] [--closure]
#   ROOT       defaults to the git top level of this script's location.
#   --json     machine-readable output.
#   --closure  also scan node_modules for destinations (the artifact's
#              dependency closure); primitives there are not checked.
#
# Exit 0 when both counts are zero, 1 on any hit, 2 on usage error / missing rg.
set -u

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
patterns="$script_dir/forbidden-patterns.txt"

root=""
json=0
closure=0
for arg in "$@"; do
  case "$arg" in
    --json) json=1 ;;
    --closure) closure=1 ;;
    -*) echo "egress-grep: unknown flag $arg" >&2; exit 2 ;;
    *) root="$arg" ;;
  esac
done

command -v rg >/dev/null 2>&1 || { echo "egress-grep: ripgrep (rg) is required" >&2; exit 2; }
[ -f "$patterns" ] || { echo "egress-grep: missing $patterns" >&2; exit 2; }

if [ -z "$root" ]; then
  root="$( (cd "$script_dir" && git rev-parse --show-toplevel 2>/dev/null) || (cd "$script_dir/../.." && pwd) )"
fi
root="$(cd "$root" && pwd)"
cd "$root" || { echo "egress-grep: cannot enter $root" >&2; exit 2; }

# Split the pattern file at the PRIMITIVES marker.
dest_patterns=()
prim_patterns=()
section=dest
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in
    '## PRIMITIVES') section=prim; continue ;;
    '#'*) continue ;;
  esac
  if [ "$section" = dest ]; then dest_patterns+=("$line"); else prim_patterns+=("$line"); fi
done < "$patterns"

# The generic quoted-URL destination: a URL inside a string literal (code can
# dial it), never a bare comment. Applied with -P for the negative lookahead.
quoted_url='['"'"'"`]https?://(?!127\.0\.0\.1)[^'"'"'"`[:space:]]+'

common_excludes=(-g '!.git' -g '!neutered/gate/**' -g '!neutered/llama/bin/**' -g '!neutered/setup/**' -g '!**/node_modules/**' -g '!**/lib/**' -g '!**/dist/**' -g '!*.tsbuildinfo' -g '!pnpm-lock.yaml' -g '!*.md' -g '!*.i18n.yaml' -g '!docs/**' -g '!website/**' -g '!snapshots/**' -g '!scripts/snapshots/**' -g '!neutered/gate/baseline-*.txt' -g '!THIRD_PARTY_NOTICES.md' -g '!**/tests/**' -g '!**/test/**' -g '!*.spec.ts' -g '!*.spec.tsx' -g '!*.e2e.ts' -g '!*.test.cjs' -g '!*.corpus.ts')
# These maintainer files name release URLs and test rejected connections; neither ships in the runtime.
common_excludes+=(-g '!neutered/release/dsh-neutered.rb.in' -g '!neutered/release/verify.cjs')

# Destination scan.
dest_hits=""
for p in "${dest_patterns[@]}"; do
  dest_hits+=$(rg -n --no-heading -e "$p" "${common_excludes[@]}" . 2>/dev/null || true)$'\n'
done
url_globs=(-g '!package.json' -g '!**/package.json' -g '!vendor/**' -g '!scripts/**' -g '!*.sh' -g '!.github/**' -g '!.gitlab-ci.yml' -g '!tsconfig*.json' -g '!*.config.ts' -g '!packages/test-support/**' -g '!packages/llm/llm/src/attribution.ts')
dest_hits+=$(rg -n --no-heading -P -e "$quoted_url" "${common_excludes[@]}" "${url_globs[@]}" . 2>/dev/null || true)$'\n'

if [ "$closure" -eq 1 ]; then
  closure_excludes=(-g '!.git' -g '!**/*.map' -g '!**/*.d.ts' -g '!**/README*' -g '!**/CHANGELOG*' -g '!**/LICENSE*' -g '!**/test/**' -g '!**/tests/**')
  for p in "${dest_patterns[@]}"; do
    dest_hits+=$(rg -n --no-heading -e "$p" "${closure_excludes[@]}" node_modules 2>/dev/null || true)$'\n'
  done
fi

# Primitive scan: everywhere but the four allowed roots.
prim_excludes=("${common_excludes[@]}" -g '!neutered/guard/**' -g '!neutered/gate/**' -g '!neutered/setup/**' -g '!packages/llm/llm-local/**' -g '!packages/test-support/**')
prim_hits=""
for p in "${prim_patterns[@]}"; do
  prim_hits+=$(rg -n --no-heading -e "$p" "${prim_excludes[@]}" . 2>/dev/null || true)$'\n'
done

# Clean, sort, count.
clean() { printf '%s' "$1" | grep -v '^$' | sort -u; }
dest_clean="$(clean "$dest_hits")"
prim_clean="$(clean "$prim_hits")"
n_dest=$(printf '%s' "$dest_clean" | grep -c '^' )
n_prim=$(printf '%s' "$prim_clean" | grep -c '^' )
[ -z "$dest_clean" ] && n_dest=0
[ -z "$prim_clean" ] && n_prim=0
mode=sources; [ "$closure" -eq 1 ] && mode=closure

trim() { cut -c1-160; }

if [ "$json" -eq 1 ]; then
  to_json() {
    printf '%s' "$1" | grep -v '^$' | while IFS=: read -r path lineno text; do
      printf '{"path":%s,"line":%s,"text":%s}\n' "$(printf '%s' "$path" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" "${lineno:-0}" "$(printf '%s' "$text" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
    done | paste -sd, -
  }
  printf '{"mode":"%s","destinations":[%s],"primitives":[%s]}\n' "$mode" "$(to_json "$dest_clean")" "$(to_json "$prim_clean")"
else
  echo "# destinations"
  [ "$n_dest" -gt 0 ] && printf '%s\n' "$dest_clean" | trim
  echo "# primitives"
  [ "$n_prim" -gt 0 ] && printf '%s\n' "$prim_clean" | trim
  echo "egress-grep: $n_dest destination hits, $n_prim primitive hits, mode=$mode"
fi

[ "$n_dest" -eq 0 ] && [ "$n_prim" -eq 0 ] && exit 0
exit 1
