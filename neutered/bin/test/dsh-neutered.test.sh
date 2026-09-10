#!/bin/bash
# Tests for the dsh-neutered wrapper. Exits non-zero on the first failure.
#
# The sidecar tests use a stub llama-server (a Node HTTP server that answers
# /health) on a free port through the wrapper's DSH_NEUTERED_TEST_PORT seam, so
# they run even while a real model server holds 127.0.0.1:1234. DSH_HOME points
# at an empty temp directory so the developer's own configuration never leaks
# in; the setup tests write their fixture configuration there.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
wrapper="$here/../dsh-neutered"
rc=0
fail() { echo "FAIL: $*"; rc=1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export DSH_HOME="$tmp/home"
mkdir -p "$DSH_HOME"

# -h exits 0 and names the single permitted destination.
out=$("$wrapper" -h 2>&1); [ $? -eq 0 ] || fail "-h exit code"
echo "$out" | grep -q "127.0.0.1:1234" || fail "-h does not name 127.0.0.1:1234"

# Unknown level and web flags are rejected (no privacy levels in this build).
"$wrapper" -p 3 -- hi >/dev/null 2>&1; [ $? -eq 2 ] || fail "-p 3 should exit 2"
"$wrapper" --web >/dev/null 2>&1; [ $? -eq 2 ] || fail "--web should exit 2"
"$wrapper" --bogus >/dev/null 2>&1; [ $? -eq 2 ] || fail "unknown flag should exit 2"

# --dry-run prints the command, the overlay, the guard in NODE_OPTIONS, and a
# server line that names the pinned endpoint.
dry=$("$wrapper" --dry-run -- "a task" 2>&1); [ $? -eq 0 ] || fail "--dry-run exit code"
echo "$dry" | grep -q -- "--profile headless" || fail "dry-run lacks --profile headless"
echo "$dry" | grep -q "offline.patch.yml" || fail "dry-run lacks the offline overlay"
echo "$dry" | grep -q "loopback-only.cjs" || fail "dry-run lacks the guard in NODE_OPTIONS"
echo "$dry" | grep -q "^server: .*127.0.0.1:1234" || fail "dry-run server line does not name 127.0.0.1:1234"

# --dsh overrides the executable.
dry2=$("$wrapper" --dsh /bin/echo --dry-run -- hi 2>&1)
echo "$dry2" | grep -q "/bin/echo --profile headless" || fail "--dsh override not honoured"

# The wrapper carries no privacy-level or allowlist surface.
grep -q -E "DSH_NEUTERED_ALLOW|^\\s*-p\\)|\\bDSH_NEUTERED_ALLOW\\b" "$wrapper" && fail "wrapper carries an allowlist override or -p handler"

# ── Sidecar lifecycle against a stub llama-server ────────────────────────────
port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')
[ -n "$port" ] || { echo "cannot pick a free port"; exit 1; }
export DSH_NEUTERED_TEST_PORT="$port"
export STUB_ARGS="$tmp/stub-args" STUB_PID="$tmp/stub-pid"
gguf="$tmp/model.gguf"; : > "$gguf"

mkdir -p "$tmp/llama/bin"
cat > "$tmp/llama/bin/llama-server" <<'STUB'
#!/bin/bash
# Stub llama-server: records its argv and pid, then serves /health on --port.
# STUB_MODE=die exits at once; STUB_MODE=never answers 503 forever.
printf '%s\n' "$@" > "$STUB_ARGS"
echo $$ > "$STUB_PID"
port=""; prev=""
for a in "$@"; do [ "$prev" = "--port" ] && port="$a"; prev="$a"; done
[ "${STUB_MODE:-ok}" = die ] && exit 7
exec node -e '
const mode = process.argv[2];
require("http").createServer((req, res) => {
  if (req.url === "/health" && mode !== "never") { res.writeHead(200); res.end("{\"status\":\"ok\"}"); return; }
  res.writeHead(503); res.end("{\"error\":\"loading\"}");
}).listen(Number(process.argv[1]), "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
' "$port" "${STUB_MODE:-ok}"
STUB
chmod +x "$tmp/llama/bin/llama-server"
(cd "$tmp/llama/bin" && shasum -a 256 llama-server > ../SHA256SUMS)

# A fake agent: proves the server is healthy while the agent runs, then exits 5.
cat > "$tmp/fake-dsh" <<FAKE
#!/bin/bash
curl -fsS -m 2 "http://127.0.0.1:$port/health" > "$tmp/health-during-run" 2>/dev/null
printf '%s\n' "\$@" > "$tmp/dsh-args"
exit 5
FAKE
chmod +x "$tmp/fake-dsh"
stub_alive() { [ -f "$STUB_PID" ] && kill -0 "$(cat "$STUB_PID")" 2>/dev/null; }
reset_stub() { rm -f "$STUB_ARGS" "$STUB_PID" "$tmp/health-during-run" "$tmp/dsh-args"; }

# Dry run of a spawn shows the server command, its log and the stop policy.
dry3=$("$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" --dry-run -- hi 2>&1); [ $? -eq 0 ] || fail "spawn dry-run exit code"
echo "$dry3" | grep -q "^server: .*llama-server .*--sleep-idle-seconds 1800" || fail "spawn dry-run lacks the server command"
echo "$dry3" | grep -q "^server-stop-on-exit: yes" || fail "spawn dry-run should stop the server on exit"
stub_alive && fail "dry-run must not start the server"

# Spawn: server started with the pinned flags, healthy during the run, agent
# exit code propagated, server stopped afterwards.
reset_stub
"$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" --ctx 4096 --idle-seconds 7 --server-arg -np --server-arg 2 -- "do it" >/dev/null 2>&1
code=$?; [ "$code" -eq 5 ] || fail "spawn run should propagate the agent's exit 5, got $code"
grep -q '"status":"ok"' "$tmp/health-during-run" 2>/dev/null || fail "server was not healthy while the agent ran"
grep -q -- "--profile" "$tmp/dsh-args" 2>/dev/null || fail "agent did not receive its arguments"
for want in "--host" "127.0.0.1" "--port" "$port" "-m" "$gguf" "-c" "4096" "-ngl" "99" "--jinja" "--no-webui" "--offline" "--sleep-idle-seconds" "7" "-np" "2"; do
  grep -qx -- "$want" "$STUB_ARGS" 2>/dev/null || fail "server argv lacks $want"
done
grep -qx -- "--alias" "$STUB_ARGS" && grep -qx -- "local" "$STUB_ARGS" || fail "server argv lacks --alias local"
sleep 0.3; stub_alive && fail "server still running after the run"

# --keep-server leaves the server up; the test stops it.
reset_stub
"$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" --keep-server -- hi >/dev/null 2>&1
stub_alive || fail "--keep-server did not leave the server running"
kill -TERM "$(cat "$STUB_PID")" 2>/dev/null; sleep 0.3

# Reuse: when something already listens on the port, nothing is spawned.
reset_stub
node -e 'require("http").createServer((q,s)=>{s.end("{\"status\":\"ok\"}")}).listen(Number(process.argv[1]),"127.0.0.1");process.on("SIGTERM",()=>process.exit(0))' "$port" &
listener=$!; sleep 0.5
dry4=$("$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" --dry-run -- hi 2>&1)
echo "$dry4" | grep -q "^server: reuse" || fail "dry-run should reuse an existing listener"
echo "$dry4" | grep -q "is ignored" || fail "reuse should warn that --model is ignored"
"$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" -- hi >/dev/null 2>&1
code=$?; [ "$code" -eq 5 ] || fail "reuse run should propagate exit 5, got $code"
[ -f "$STUB_ARGS" ] && fail "reuse must not spawn the stub"
# Without a configuration the listener is used as is and setup is not proposed.
no_cfg=$("$wrapper" --dsh "$tmp/fake-dsh" --dry-run -- hi 2>&1)
echo "$no_cfg" | grep -q "using the server already listening" || fail "no config + listener should announce the reuse"
echo "$no_cfg" | grep -q "setup: would run first" && fail "no config + listener must not propose setup"
kill -TERM "$listener" 2>/dev/null; wait "$listener" 2>/dev/null; sleep 0.3

# Nothing listening, no model, no configuration: dry-run announces that setup
# would run first and that no server is planned.
out=$("$wrapper" --dsh "$tmp/fake-dsh" --dry-run -- hi 2>&1); code=$?
[ "$code" -eq 0 ] || fail "no-config dry-run should exit 0, got $code"
echo "$out" | grep -q "setup: would run first" || fail "no-config dry-run should announce setup"
echo "$out" | grep -q "^server: none" || fail "no-config dry-run should plan no server"
[ -f "$STUB_ARGS" ] && fail "no-config dry-run must not spawn the stub"

# Refused server arguments, plain and --flag=value forms.
for bad in --hf-repo -hf --model-url --rpc=1.2.3.4:50052 --host --port=1 --models-dir --webui --api-key --mcp-servers-json; do
  "$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" --server-arg "$bad" --dry-run -- hi >/dev/null 2>&1
  [ $? -eq 2 ] || fail "--server-arg $bad should exit 2"
done

# Hash mismatch: the wrapper refuses to start a modified server.
reset_stub
echo "0000000000000000000000000000000000000000000000000000000000000000  llama-server" > "$tmp/llama/SHA256SUMS"
out=$("$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" -- hi 2>&1); code=$?
[ "$code" -eq 3 ] || fail "hash mismatch should exit 3, got $code"
echo "$out" | grep -q "SHA256SUMS" || fail "hash mismatch error should name SHA256SUMS"
[ -f "$STUB_ARGS" ] && fail "hash mismatch must not spawn the stub"
(cd "$tmp/llama/bin" && shasum -a 256 llama-server > ../SHA256SUMS)

# Missing model file: exit 2.
"$wrapper" --dsh "$tmp/fake-dsh" --model "$tmp/absent.gguf" --llama-dir "$tmp/llama" -- hi >/dev/null 2>&1
[ $? -eq 2 ] || fail "missing model should exit 2"

# Server dies during load: exit 3, nothing left running.
reset_stub
out=$(STUB_MODE=die "$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" -- hi 2>&1); code=$?
[ "$code" -eq 3 ] || fail "server death should exit 3, got $code"
echo "$out" | grep -q "exited during load" || fail "server death error text"
[ -f "$tmp/dsh-args" ] && fail "agent must not run when the server died"

# Server never healthy: exit 3 after --load-timeout, server stopped.
reset_stub
out=$(STUB_MODE=never "$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" --load-timeout 2 -- hi 2>&1); code=$?
[ "$code" -eq 3 ] || fail "unhealthy server should exit 3, got $code"
echo "$out" | grep -q "not healthy after 2s" || fail "load-timeout error text"
sleep 0.3; stub_alive && fail "unhealthy server still running after timeout"
[ -f "$tmp/dsh-args" ] && fail "agent must not run when the server never became healthy"

# ── Saved configuration (setup, settings, config.json defaults) ──────────────
# setup and settings dispatch to neutered/setup/setup.cjs.
out=$("$wrapper" setup -h 2>&1); [ $? -eq 0 ] || fail "setup -h exit code"
echo "$out" | grep -q "first-run configuration" || fail "setup -h lacks the setup usage"
out=$("$wrapper" settings -h 2>&1); [ $? -eq 0 ] || fail "settings -h exit code"

# With a configuration: both overlays are applied and the model, context,
# keep-server and server arguments default from config.json; the server is the
# vendored sidecar, started as a child of the wrapper.
cfg_home="$tmp/cfg-home"; mkdir -p "$cfg_home/neutered"
printf '%s\n' "{\"version\":1,\"model\":{\"id\":\"t\",\"name\":\"t\",\"path\":\"$gguf\",\"nativeContext\":32768,\"serverArgs\":[\"-np\",\"2\"]},\"contextWindow\":32768,\"maxTokens\":8192,\"server\":{\"keep\":true,\"startTimeoutMs\":1000,\"extraArgs\":[\"--flash-attn\",\"on\"]},\"hardware\":{},\"createdAt\":\"2026-01-01T00:00:00.000Z\"}" > "$cfg_home/neutered/config.json"
: > "$cfg_home/neutered/overlay.yml"
dry5=$(DSH_HOME="$cfg_home" "$wrapper" --dsh "$tmp/fake-dsh" --llama-dir "$tmp/llama" --dry-run -- "a task" 2>&1); [ $? -eq 0 ] || fail "--dry-run (config) exit code: $dry5"
echo "$dry5" | grep -q "offline.patch.yml" || fail "dry-run lacks the tracked overlay"
echo "$dry5" | grep -q "$cfg_home/neutered/overlay.yml" || fail "dry-run lacks the generated overlay"
echo "$dry5" | grep -q "^server: .*llama-server .*-m $gguf .*-c 32768 " || fail "dry-run lacks the configured model and context in the server plan"
echo "$dry5" | grep -q "^server: .*-np 2 --flash-attn on" || fail "dry-run lacks the configured server arguments"
echo "$dry5" | grep -q "^server-stop-on-exit: no" || fail "configured server.keep should leave the server running"
echo "$dry5" | grep -q "is ignored" && fail "a configured model must not be reported as ignored"
# Flags win over the configuration.
dry6=$(DSH_HOME="$cfg_home" "$wrapper" --dsh "$tmp/fake-dsh" --llama-dir "$tmp/llama" --ctx 2048 --model "$gguf" --dry-run -- "a task" 2>&1)
echo "$dry6" | grep -q "^server: .*-c 2048 " || fail "--ctx should override the configured context"
# A configured run uses the sidecar lifecycle: healthy during the run, exit
# code propagated, and server.keep honoured (the test stops it).
reset_stub
DSH_HOME="$cfg_home" "$wrapper" --dsh "$tmp/fake-dsh" --llama-dir "$tmp/llama" -- "do it" >/dev/null 2>&1
code=$?; [ "$code" -eq 5 ] || fail "configured run should propagate exit 5, got $code"
grep -q '"status":"ok"' "$tmp/health-during-run" 2>/dev/null || fail "configured run: server was not healthy while the agent ran"
grep -qx -- "32768" "$STUB_ARGS" 2>/dev/null || fail "configured run: server argv lacks the configured context"
grep -q -- "--patch $cfg_home/neutered/overlay.yml" <(tr '\n' ' ' < "$tmp/dsh-args") || fail "configured run: agent did not get the generated overlay"
stub_alive || fail "configured server.keep did not leave the server running"
kill -TERM "$(cat "$STUB_PID")" 2>/dev/null; sleep 0.3
# A broken config.json is refused with a hint, not a stack trace.
echo '{' > "$cfg_home/neutered/config.json"
out=$(DSH_HOME="$cfg_home" "$wrapper" --dsh "$tmp/fake-dsh" --dry-run -- hi 2>&1); code=$?
[ "$code" -eq 2 ] || fail "broken config should exit 2, got $code"
echo "$out" | grep -q "run dsh-neutered setup again" || fail "broken config error should point at setup"
rm -rf "$cfg_home"

# --keep-server is accepted on the task path.
dry7=$("$wrapper" --keep-server --dry-run --dsh /bin/echo -- hi 2>&1); [ $? -eq 0 ] || fail "--keep-server not accepted"

# Without the test seam the port is 1234.
unset DSH_NEUTERED_TEST_PORT
dry8=$("$wrapper" --dsh "$tmp/fake-dsh" --model "$gguf" --llama-dir "$tmp/llama" --dry-run -- hi 2>&1)
echo "$dry8" | grep -q "127.0.0.1:1234\|--port 1234" || fail "default port is not 1234"

# --- step 9: mode selection ---
unset DSH_NEUTERED_TEST_PORT
tty_dry=$(script -q /dev/null "$wrapper" --dsh /bin/echo --dry-run 2>&1 </dev/null)
echo "$tty_dry" | grep -q -- "--profile repl" || fail "a terminal with no task should pick the repl profile"
echo "$tty_dry" | grep -q "^profile: repl" || fail "dry-run should print the profile line"
tty_resume=$(script -q /dev/null "$wrapper" --dsh /bin/echo --resume abc --dry-run 2>&1 </dev/null)
echo "$tty_resume" | grep -q -- "-- --resume abc" || fail "--resume <id> should reach the repl app"
tty_sessions=$(script -q /dev/null "$wrapper" --dsh /bin/echo --sessions --dry-run 2>&1 </dev/null)
echo "$tty_sessions" | grep -q -- "-- --sessions" || fail "--sessions should reach the repl app"
pipe_dry=$(printf 'piped task\n' | "$wrapper" --dsh /bin/echo --dry-run 2>&1)
echo "$pipe_dry" | grep -q -- "--profile headless" || fail "piped stdin should pick headless"
echo "$pipe_dry" | grep -q "piped" || fail "piped stdin should become the task"
: | "$wrapper" --dsh /bin/echo --dry-run >/dev/null 2>&1; [ $? -eq 2 ] || fail "empty piped stdin should exit 2"
"$wrapper" --dsh /bin/echo --resume --dry-run -- "a task" >/dev/null 2>&1; [ $? -eq 2 ] || fail "--resume with a task should exit 2"
"$wrapper" --dsh /bin/echo --sessions --dry-run -- "a task" >/dev/null 2>&1; [ $? -eq 2 ] || fail "--sessions with a task should exit 2"

echo "dsh-neutered.test: rc=$rc"
exit $rc
