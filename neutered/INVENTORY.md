# dsh-neutered — network inventory

Complete inventory of every place code can open a socket, resolve DNS, fetch a URL, spawn a
network-capable program, or read a remote destination from config. One table per site class;
all rows use the same columns.

**Columns:** `file:line` (line = the decisive statement; multi-line sites name the module's
entry statement) | `kind` | `destination` | `trigger` | `action`.

**Actions:**
- `delete` — the file/package is physically removed from the tree (steps 2–3).
- `guard` — the code stays in the tree and its egress is blocked at run time by
  `neutered/guard/loopback-only.cjs` (applied via `NODE_OPTIONS=--require`), plus the seatbelt
  policy for bash-tool children and the `egress-grep` static gate.
- `keep-loopback` — the code stays and only ever touches loopback (127.0.0.1), including the
  one permitted destination `127.0.0.1:1234`.
- `setup-only` — reachable only from `dsh-neutered setup` / `settings --model`
  (`neutered/setup/`), never from a task run; excluded from the static gate by path.

**Scope note (gate D8):** the egress gate scans product sources (`apps/cli/src`,
`packages/**/src`, `packages/bundle`, `native/`, `vendor/`, `snapshots/`, `scripts/`) and
`node_modules` (separate pass with an explicit allowlist). Excluded from the gate: `.github/`,
`.gitlab-ci.yml`, `docs/`, `*.md`, `*.i18n.yaml`, `.agents/`, `lefthook.yml` — dev/CI-only and
prose, listed in Table 4 for audit.

## Table 1 — production code (non-test)

| file:line | kind | destination | trigger | action |
|---|---|---|---|---|
| packages/llm/llm-deepseek/src/adapter.ts:643 | https-request (fetch) | config `llm-deepseek.baseURL` / env `DEEPSEEK_BASE_URL`; default `https://api.deepseek.com` | every `deepseek-official` route model call (base bundle row `llm-deepseek`) | delete |
| packages/llm/llm-deepseek/src/index.ts:200 | config-remote-dest | `PUBLIC_BASE_URL = 'https://api.deepseek.com'` (default endpoint, catalog, key ref) | adapter registration + per-request resolution | delete |
| packages/llm/llm-deepseek/src/sse.ts:1 | https-request (SSE parse of the chat-completions stream) | same as adapter.ts | streaming DeepSeek responses | delete |
| packages/llm/llm-deepseek/src/files-api.ts:1 | https-request (files API client) | same base URL + `/files` | file upload/offload (vision) | delete |
| packages/llm/llm-deepseek/src/file-store.ts:1 | https-request (image store) | same base URL | image offload to provider | delete |
| packages/llm/deepseek-llm-api-extensions/src/index.ts:1 | (DeepSeek API route extensions; no direct socket) | extends the `deepseek-official` route | base bundle row `deepseek-llm-api-extensions` | delete |
| packages/llm/llm-pi-ai/src/stream.ts:1 | https-request (via `@earendil-works/pi-ai`) | provider-table endpoints: `api.openai.com`, `api.anthropic.com`, `api.deepseek.com`, `openrouter.ai`, `api.kimi.com`, `api.moonshot.cn/.ai`, `api.x.ai`, `api.mistral.ai`, `api.minimaxi.com/.io`, `api.together.ai`, `api.groq.com`, `api.individual.githubcopilot.com`, `gateway.ai.cloudflare.com`, `huggingface.co` (per `llm-pi-ai` provider config) | model calls on pi-ai routes once a `llm-pi-ai:` settings section exists | delete |
| packages/llm/llm-pi-ai/src/discovery.ts:253 | https-request (fetch) | `llm-pi-ai` provider-profile `baseURL` (env `DSH_PI_AI_OPENAI_BASE_URL` et al.) | model discovery / OAuth login | delete |
| packages/llm/llm-pi-ai/src/auth.ts:1 | https-request (OAuth flows) | provider auth endpoints (auth.openai.com et al.) | `llm-pi-ai` login | delete |
| packages/llm/llm/src/attribution.ts:43 | hardcoded-host (metadata literal) | `https://github.com/deepseek-ai/deepseek-harness` — sent as an attribution header value, never dialed | every LLM request header | keep-loopback (gate-allowlisted: not a dial destination) |
| packages/llm/llm-local/src/index.ts:1 (NEW, step 3) | https-request (fetch, SSE) | constant `http://127.0.0.1:1234/v1` — model id and context window configurable, base URL fixed | every model call in the neutered headless profile | keep-loopback |
| neutered/setup/lib/download.cjs:1 (NEW, step 8) | subprocess (`hf download` / `curl`, `brew install llama.cpp`) | `https://huggingface.co/<repo>/resolve/main/<file>`; Homebrew's mirrors | `dsh-neutered setup`, `settings --model` | setup-only |
| neutered/setup/lib/server.cjs:1 (NEW, step 8) | http-request (`/health`), subprocess (`llama-server --host 127.0.0.1 --port 1234`) | `127.0.0.1:1234` | every task run (start, poll, stop the local server) | keep-loopback |
| packages/session/session-telemetry-otel/src/index.ts:34 | OTLP/HTTP log exporter (fetch under the hood) | env `DSH_TELEMETRY_OTLP_URL`; bundle default `https://harness-telemetry.deepseeksvc.com/v1/logs` (base row 196) | batched session telemetry export | delete |
| packages/bundle/base/cordis.patch.yml:196 | config-remote-dest | same default OTLP URL | base bundle telemetry section | delete (row removed) |
| packages/web/web-fetch-http/src/network.ts:185 | fetch | any URL from the model's `web_fetch` request | web_fetch tool call | delete |
| packages/web/web-fetch-http/src/network.ts:9 | dns (node:dns/promises lookup) | DNS for the fetched host | web_fetch tool call | delete |
| packages/web/web-fetch-http/src/index.ts:23 | hardcoded-host (UA string) | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | every fetch | delete |
| packages/web/web-search-deepseek/src/provider.ts:225 | fetch | config `baseURL`; default `https://api.deepseek.com/anthropic/v1` (provider.ts:35) | web_search tool (DeepSeek) | delete |
| packages/web/web-search-exa/src/provider.ts:101 | fetch | config `baseURL`; default `https://api.exa.ai` (provider.ts:22) | web_search tool (Exa) | delete |
| packages/web/web-search-perplexity/src/provider.ts:104 | fetch | config `baseURL`; default `https://api.perplexity.ai` (provider.ts:22) | web_search tool (Perplexity) | delete |
| packages/web/tool-web/src/fetch.ts:499 | fetch (via `ctx.web` carrier) | any model-requested URL | web tool (browse/fetch) | delete |
| packages/web/web/src/index.ts:157 | fetch (web service dispatch) | provider-dependent | web service calls | delete |
| packages/mcp/mcp-client/src/index.ts:1 | spawn-network-program + http (MCP servers over stdio/HTTP/SSE) | MCP server URL from config | MCP client calls | delete |
| packages/acp/acp/src/mcp.ts:1 | node:http (MCP server inside the ACP app) | loopback MCP endpoint | ACP profile only | delete |
| packages/e2b/e2b/src/index.ts:1 | https-request (e2b SDK) | `api.e2b.dev` (e2b@2.29.1) | e2b sandbox spawn | delete |
| packages/e2b/subprocess-e2b/src/index.ts:140 | subprocess provider into e2b sandbox | remote e2b VM | e2b subprocess capability | delete |
| packages/e2b/fs-e2b/src/index.ts:1 | fs provider into e2b sandbox | remote e2b VM | e2b fs capability | delete |
| packages/webhook/webhook-github/src/handler.ts:1 | node:http (webhook ingress: verify + receive) | webhook listener port | webhook profile only | delete |
| packages/webhook/webhook/src/index.ts:1 | webhook ingress (server) | webhook listener port | webhook profile only | delete |
| packages/hooks/hooks-codex/src/index.ts:1 | spawn-network-program (codex CLI) | codex hook bridge | hook events (codex) | delete |
| packages/hooks/hooks-claude-code/src/index.ts:1 | spawn-network-program (claude CLI) | claude hook bridge | hook events (claude) | delete |
| packages/hooks/hook-protocol/src/index.ts:1 | (hook wire-protocol library; no direct socket) | n/a | orphaned once both bridges are removed | delete |
| packages/acp/acp/src/index.ts:1 | ACP server (JSON-RPC) | ACP client transport | ACP profile only | delete |
| packages/sdk/client/src/client.ts:1 | fetch (JSON-RPC over http) | SDK server URL | SDK consumer | delete |
| packages/sdk/server/src/index.ts:1 | fetch/http (JSON-RPC server carrier) | SDK client transport | SDK host | delete |
| packages/sdk/protocol/src/transport.ts:1 | transport types over http/ws | n/a (type + framing) | SDK protocol | delete |
| packages/api/gateway/src/stream-server.ts:1 | http-server | gateway port (config) | web-surface RPC (web-app bundle) | delete |
| packages/api/gateway/src/client/stream-client.ts:142 | WebSocket + fetch | `INTERNAL_BASE = 'http://dsh.internal'` placeholder → live gateway URL | web client stream | delete |
| packages/api/remotes/src/index.ts:1 | fetch (BFF remote carrier) | BFF endpoint | web BFF | delete |
| packages/api/session-controller/src/client/index.ts:1 | fetch (client contract carrier) | BFF endpoint | web BFF | delete |
| packages/api/settings-controller/src/index.ts:1 | fetch (client carrier) | BFF endpoint | web BFF | delete |
| packages/api/workspace-controller/src/index.ts:1 | fetch (client carrier) | BFF endpoint | web BFF | delete |
| packages/client/connection/src/http-bridge.ts:75 | fetch + node:http | gateway URL | web client boot | delete |
| packages/client/hmr/src/index.ts:187 | WebSocket (HMR) | web HMR endpoint | web client | delete |
| packages/client/modules/src/index.ts:1 | fetch (client module manifests) | gateway URL | web client | delete |
| packages/session-query/session-log-export/src/client/controller.ts:70 | fetch | host-streamed ZIP origin (`http://dsh.internal` placeholder) | web session-export download | delete |
| packages/host/webserver/src/index.ts:242 | http-server | config `host: '127.0.0.1' \| '0.0.0.0'` (index.ts:126) + port | web-app bundle row `web-server` | delete |
| packages/host/frontend-static/src/index.ts:15 | http-server (static-file routes for the webserver) | same as webserver | web-app bundle | delete |
| packages/experimental/inspector/src/worker/bridge/endpoint.ts:3 | http-server | loopback inspector bridge port | web-preview inspector | delete |
| packages/experimental/inspector/src/client/bridge/transport.ts:1 | fetch | inspector RPC carrier | web-preview inspector | delete |
| packages/experimental/webworker-runtime/src/node/builtin_modules/implemented/http.ts:1 | http polyfill (worker host) | worker request carrier | web-preview worker | delete |
| packages/experimental/webworker-runtime/src/transport/tunnel.ts:1 | WebSocket (worker tunnel) | host tunnel endpoint | web-preview worker | delete |
| packages/subagent/subagent-dsh-sdk/src/run.ts:1 | child dsh process via SDK JSON-RPC (fetch carrier) | dsh SDK server | subagent delegation | delete |
| packages/subagent/subagent-codex/src/run.ts:241 | spawn-network-program (codex CLI) | codex agent | subagent delegation | delete |
| packages/subagent/subagent-claude-code/src/run.ts:366 | spawn-network-program (claude CLI) | claude agent | subagent delegation | delete |
| packages/subagent/subagent-acp/src/run.ts:346 | spawn-network-program (ACP agent process) | ACP agent | subagent delegation | delete |
| apps/cli/src/plugin.ts:134 | spawn-network-program (`pnpm` → npm registry) | `dsh plugin` subcommand (profile plugin install) | user runs `dsh plugin …` | delete |
| packages/test-support/llm-mock-server/src/index.ts:205 | http-server | `127.0.0.1` default (host configurable in test config; specs bind loopback) | unit/e2e mock model server | keep-loopback |
| packages/test-support/llm-mock-server/src/bin.ts:18 | http-server | `127.0.0.1` default | `pnpm run mock:llm` | keep-loopback |
| snapshots/session/loopback-fixture-server.mjs:55 | http-server | 127.0.0.1 | recorded-session snapshot replay | keep-loopback |
| scripts/benchmark-npm-resolution.ts:5 | http-server (fixture) + spawn of `npm install` against the registry | npm registry | dev benchmark | delete |
| scripts/benchmark-next-package-dependency.ts:1 | spawn of `npm install` against the registry | npm registry | dev benchmark | delete |
| scripts/publish-npm-baseline.ts:23 | config-remote-dest | `DEFAULT_REGISTRY = 'https://registry.npm.harnessment.com'` | dev release script | delete |
| scripts/release/process.ts:1 | release tooling (git local + publish step) | npm registry (publish) | dev release | delete |
| scripts/release/bump.ts:1 | release tooling (git local) | n/a (local git) | dev release | delete |
| scripts/dev-web.ts:1 | web dev server tooling | web dev | dev only | delete |
| scripts/run-web-snapshots.ts:1 | web snapshot runner | web dev | dev only | delete |
| scripts/client-build-environment.ts:1 | client-build env helper | n/a (build face for the removed web client) | dev only | delete |
| scripts/project-doc-site.ts:26 | config-remote-dest | `https://github.com/deepseek-ai/deepseek-harness` (raw image URLs) | website build (orphaned) | delete |
| scripts/verify-doc-site-fragments.ts:109 | (`.invalid` origin, no dial) | n/a | website fragments gate (orphaned) | delete |
| scripts/build-exe-for-python-sdk.ts:1 | python-SDK exe build | python/ toolchain | dev only (python SDK removed) | delete |
| neutered/guard/loopback-only.cjs:1 (NEW, step 4) | net/tls/dgram/dns/http/https/fetch wrapper | throws `EgressBlockedError` (code `EGRESS_BLOCKED`) for any destination other than `127.0.0.1:1234`; all DNS blocked | every process started by `neutered/bin/dsh-neutered` | keep-loopback |

## Table 2 — test, fixture, and recorded-data sites

All test-only: they fire under vitest/e2e, never in the shipped product. `delete` rows belong
to packages removed in steps 2–3; `keep-loopback` rows stay and only touch loopback fixtures
or local data.
| file:line | kind | destination | trigger | action |
|---|---|---|---|---|
| apps/cli/tests/dsh-badge.expected.e2e.ts:87 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| apps/cli/tests/fixtures/web-browser-open/open.mjs:25 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/cli/tests/github-webhook-real.e2e.ts:8 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/cli/tests/profiles/acp/tests/image-offload.expected.e2e.ts:2 | socket/dns primitive (test) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| apps/cli/tests/profiles/headless/tests/headless.expected.e2e.ts:2 | socket/dns primitive (test) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts:1 | socket/dns primitive (test) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| apps/cli/tests/web-auth.e2e.ts:6 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/declared-reasoning.e2e.ts:41 | config-remote-dest (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/default-model.e2e.ts:69 | config-remote-dest (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/feedback-release.e2e.ts:12 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/github-ready-review.e2e.ts:4 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/lifecycle-chrome.e2e.ts:6 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/markdown-images.e2e.ts:5 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/models-settings.e2e.ts:168 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/preview-boot.e2e.ts:21 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/scaffold.ts:6 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/shipped-composition.e2e.ts:81 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/smoke-real.e2e.ts:21 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/subagent-conversation.e2e.ts:290 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/subagent-interrupt-ui.e2e.ts:193 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/support.ts:3 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/support/listen-probe.mjs:2 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/vite-entry.e2e.ts:7 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| apps/web/tests/web-search-round.e2e.ts:6 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/acp/acp/tests/bridge.spec.ts:782 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/acp/acp/tests/content.spec.ts:197 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/acp/acp/tests/mcp.spec.ts:31 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/api/gateway/tests/gateway-stream.host.spec.ts:4 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/api/gateway/tests/gateway.client.spec.ts:225 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/api/gateway/tests/gateway.host.spec.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/api/gateway/tests/stream-server.host.spec.ts:2 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/api/remotes/tests/built-lib.e2e.ts:49 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/attachment/attachment-local/tests/normalization.spec.ts:294 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/boot/app-boot/tests/app-boot.spec.ts:134 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/bundle/web-app/tests/browser-open.spec.ts:108 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/connection/tests/api-request-trust.host.spec.ts:31 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/connection/tests/client-apply.client.spec.ts:433 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/connection/tests/fetch-routes.host.spec.ts:33 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/connection/tests/fixture.client.spec.ts:723 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/connection/tests/http-bridge.host.spec.ts:3 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/connection/tests/node-half.host.spec.ts:3 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/modules/tests/loader.client.spec.ts:89 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/modules/tests/node-half.client.spec.ts:4 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-conversation/tests/history-transport.perf.client.ts:4 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/ansi.client.spec.ts:127 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/cjk-strong-and-inline-code-url.settled.txt:12 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/cjk-strong-and-inline-code-url.streaming.txt:12 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/footnotes.settled.txt:20 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/footnotes.streaming.txt:20 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/gfm-strikethrough-and-literals.settled.txt:7 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/gfm-strikethrough-and-literals.streaming.txt:7 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/images.settled.txt:3 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/images.streaming.txt:3 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/links-and-autolinks.settled.txt:3 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/links-and-autolinks.streaming.txt:3 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/math-edge-cases.settled.txt:6 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/math-inline-and-display.settled.txt:6 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/reference-links-and-images.settled.txt:4 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/reference-links-and-images.streaming.txt:4 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/table-with-alignment.settled.txt:27 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/fixtures/markdown-dom/table-with-alignment.streaming.txt:27 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-primitives/tests/markdown-plain-text.client.spec.ts:7 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/client/ui-settings-plugins/tests/stores.client.spec.ts:97 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/context/session-reference/tests/session-reference.spec.ts:252 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/credentials/authorization/tests/authorization.spec.ts:140 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/experimental/inspector/tests/built-lib.e2e.ts:18 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/client-browser.e2e.ts:3 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/client-sources.client.spec.ts:15 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/client-stack.client.spec.ts:10 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/client-stack.host.spec.ts:20 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/cordis-tree.host.spec.ts:4 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/debugger.e2e.ts:3 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/fetch-observer.host.spec.ts:37 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/fixtures/client-source.client.ts:5 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/integration.host.spec.ts:3 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/network.host.spec.ts:339 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/plugin.client.spec.ts:9 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/plugin.host.spec.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/inspector/tests/port-selection.host.spec.ts:3 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/client/source-chooser.spec.ts:7 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/fixtures/vfs-example/home/sessions/--dsh-workspace--/preview-showcase/session.jsonl:186 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/node/builtins-table.spec.ts:108 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/node/http-server.spec.ts:2 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/node/node-stubs.spec.ts:37 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/shell/shell-process.spec.ts:20 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/storage/image-gzip.spec.ts:63 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/transport/tunnel-client.spec.ts:61 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/experimental/webworker-runtime/tests/vfs-example-fixture.ts:205 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/extensions/cordis-client-runner/tests/evaluator.client.spec.ts:67 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/extensions/cordis-host-runner/tests/sandbox.spec.ts:57 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/fs/fs-local/tests/fsio.spec.ts:12 | socket/dns primitive (test) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/host/frontend-static/tests/frontend-static.spec.ts:88 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/host/webserver/tests/webserver.spec.ts:10 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-deepseek/tests/adapter.spec.ts:283 | config-remote-dest (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-deepseek/tests/file-store.spec.ts:30 | config-remote-dest (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-deepseek/tests/files-api.spec.ts:32 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-deepseek/tests/mock-server.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-deepseek/tests/upload-index.spec.ts:14 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-pi-ai/tests/adapter.spec.ts:203 | config-remote-dest (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-pi-ai/tests/catalog.spec.ts:160 | config-remote-dest (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-pi-ai/tests/config.spec.ts:10 | config-remote-dest (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-pi-ai/tests/convert.spec.ts:842 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-pi-ai/tests/discovery.spec.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-pi-ai/tests/login.spec.ts:125 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-pi-ai/tests/mock-server.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/llm/llm-retry/tests/transport-recovery.spec.ts:2 | socket/dns primitive (test) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/llm/llm/tests/attribution.spec.ts:12 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/llm/llm/tests/topology.spec.ts:215 | config-remote-dest (test) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/llm/plugin-package-inventory-deepseek/tests/inventory.spec.ts:137 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/lsp/tool-lsp/tests/render.spec.ts:91 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/mcp/mcp-client/tests/http-fixture.ts:3 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/mcp/mcp-client/tests/mcp-client.e2e.ts:11 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/mcp/mcp-client/tests/mcp-client.spec.ts:969 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/sdk/server/tests/plugin-apply.spec.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/sdk/server/tests/server.spec.ts:3 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/session-query/session-log-export/tests/archive.host.spec.ts:137 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/session-query/session-log-export/tests/controller.client.spec.ts:111 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/session-query/session-log-export/tests/route.host.spec.ts:71 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/session/session-telemetry-otel/tests/fixtures/driver.ts:10 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/session/session-telemetry-otel/tests/otel.spec.ts:2 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/skill/skill/tests/skill.spec.ts:1072 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/skill/tool-skill/tests/tool-skill.spec.ts:829 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/subagent/subagent-claude-code/tests/messages-fixture.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/subagent/subagent-claude-code/tests/real-deepseek.e2e.ts:23 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/subagent/subagent-codex/tests/deepseek-responses-bridge.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/subagent/subagent-codex/tests/responses-fixture.ts:1 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/test-support/llm-mock-server/tests/server.spec.ts:1 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| packages/web/tool-web/tests/integration.spec.ts:11 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/tool-web/tests/spill.spec.ts:11 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/tool-web/tests/tool-web.spec.ts:61 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/web-fetch-http/tests/fetch-http.spec.ts:2 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/web-search-deepseek/tests/deepseek.spec.ts:37 | config-remote-dest (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/web-search-deepseek/tests/redirect.spec.ts:7 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/web-search-deepseek/tests/settings.spec.ts:43 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/web-search-exa/tests/exa.spec.ts:8 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/web-search-perplexity/tests/perplexity.spec.ts:11 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/web/web/tests/web.spec.ts:33 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/webhook/webhook-github/tests/body.spec.ts:1 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| packages/webhook/webhook-github/tests/handler.spec.ts:2 | socket/dns primitive (test) | n/a (removed with package) | test-only (vitest) | delete |
| packages/webhook/webhook-github/tests/loader-composition.spec.ts:77 | fetch (test) | n/a (removed with package) | test-only (vitest) | delete |
| scripts/ci-workflow.spec.ts:604 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/client-bundle-purity.spec.ts:199 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/gen-third-party-notices.spec.ts:158 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/project-doc-site.spec.ts:185 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/snapshot-http-fixtures.spec.ts:7 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/translation-links.spec.ts:221 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/translation-pairing.spec.ts:212 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/verify-doc-site-fragments.spec.ts:26 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/verify-md-links.spec.ts:79 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| scripts/verify-public-repository-links.spec.ts:14 | network ref (test data) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| snapshots/session/loopback-fixture-server.mjs:2 | socket/dns primitive (test) | loopback fixture / local test data, no external connection | test-only (vitest) | keep-loopback |
| snapshots/session/web-fetch/session.jsonl:5 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| snapshots/session/web-fetch/web-fetch-fixture-server.mjs:12 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |
| snapshots/web/web-search-round/session.jsonl:23 | network ref (test data) | n/a (removed with package) | test-only (vitest) | delete |

## Table 3 — remote hosts hardcoded inside node_modules (with the package that carries them)

Current tree (pre-removal). Packages marked *pruned* leave `node_modules` once their workspace
dependents are removed and `pnpm install` re-runs.

| package (version from `node_modules/.pnpm`) | host(s) | file:line example | kind | trigger | action |
|---|---|---|---|---|---|
| @earendil-works/pi-ai@0.84.2 | api.deepseek.com, api.anthropic.com, api.openai.com, openrouter.ai, huggingface.co, api.kimi.com, api.moonshot.cn, api.moonshot.ai, api.x.ai, api.mistral.ai, api.minimaxi.com, api.minimax.io, api.together.ai, api.groq.com, api.individual.githubcopilot.com, gateway.ai.cloudflare.com, api.z.ai, api.xiaomimimo.com, auth.x.ai, auth.kimi.com | node_modules/.pnpm/@earendil-works+pi-ai@*/node_modules/@earendil-works/pi-ai (provider table) | hardcoded endpoint table (active code) | provider routes registered by `llm-pi-ai` | delete (pruned with step 3) |
| openai@6.40.0 | api.openai.com, auth.openai.com, platform.openai.com (docs) | node_modules/.pnpm/openai@6.40.0*/node_modules/openai/... | SDK default base URL (active code) | via pi-ai provider | delete (pruned with step 3) |
| @anthropic-ai/claude-agent-sdk@0.3.241 | api.anthropic.com, beacon.claude-ai.staging.ant.dev | node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@*/... | SDK default base URL + telemetry beacon (active code) | subagent-codex / hooks-claude-code bridges | delete (pruned with step 2) |
| @anthropic-ai/sdk@0.91.1, 0.93.0 | api.anthropic.com, docs.claude.com (docs) | node_modules/.pnpm/@anthropic-ai+sdk@*/... | SDK default base URL (active code) | via claude-agent-sdk / pi-ai | delete (pruned with steps 2–3) |
| @agentclientprotocol/sdk@1.4.0 | api.anthropic.com, api.openai.com (examples), wss:// (docs) | node_modules/.pnpm/@agentclientprotocol+sdk@*/... | example endpoints (dead code) | ACP sample servers | delete (pruned with step 2) |
| e2b@2.29.1 | api.e2b.dev | node_modules/.pnpm/e2b@2.29.1/... | sandbox API base (active code) | e2b sandbox spawn | delete (pruned with step 2) |
| @modelcontextprotocol/sdk@1.29.0 | api.example.com (comment) | node_modules/.pnpm/@modelcontextprotocol+sdk@*/... | comment example (dead code) | n/a | delete (pruned with step 2) |
| @opentelemetry/exporter-logs-otlp-http@0.220.0, otlp-exporter-base@0.220.0, sdk-metrics@2.9.0, sdk-trace@2.9.0, semantic-conventions@1.43.0 | OTLP endpoint (config-supplied; no remote default constant) | node_modules/.pnpm/@opentelemetry+*/... | exporter (active code, destination from config) | session telemetry export | delete (pruned with step 2) |
| @algolia/*, @docsearch/* (autocomplete-core, client-search, docsearch js/react) | cdn.jsdelivr.net, www.algolia.com (docs) | node_modules/.pnpm/@algolia+*/... | CDN/docs refs (dead code) | website (VitePress) search | delete (pruned with website) |
| playwright-core@1.61.1 | cdn.playwright.dev | node_modules/.pnpm/playwright-core@1.61.1/... | docs/download ref (dead code) | browser e2e of the web app | delete (devDependency removed with the web app) |
| express@5.2.1 | api.example.com (comment) | node_modules/.pnpm/express@5.2.1/... | comment example (dead code) | packages/api BFF | delete (pruned with step 2) |
| esbuild@0.21.5, 0.25.12, 0.28.1 | registry.npmjs.org | node_modules/.pnpm/esbuild@*/lib/main.js | binary-package resolution (build-time only, never in the product runtime) | `pnpm run build` | guard (dev-time tool; gate allowlist `neutered/gate/allowlist.txt`) |
| @yarnpkg/cli-dist@4.17.1 | registry.npmjs.org, registry.yarnpkg.com | node_modules/.pnpm/@yarnpkg+cli-dist@4.17.1/... | registry constants (build-time only) | dev tooling | guard (dev-time tool; gate allowlist) |
| remaining dev libraries (undici, ws, happy-dom, jsdom, vite, vitest, mermaid, vue, lightningcss, tsdown, oxlint, …) | spec/doc comment URLs only (w3.org, whatwg, developer.mozilla.org, …) | — | comment prose, no dial destinations in executable paths | n/a | keep (node_modules gate matches destination-class hosts, not comment prose) |

## Table 4 — non-code remote destinations (dev/CI/prose; out of gate scope, kept for audit)

| file:line | kind | destination | trigger | action |
|---|---|---|---|---|
| neutered/setup/verify-catalog.cjs:1 | https-request (`https://huggingface.co/api/models/<repo>/tree/main`) | huggingface.co | maintainer runs it by hand to pin catalog sizes and hashes | gate-exclude (dev-only, under the excluded setup path) |
| .github/workflows/e2e.yml:118 | config-remote-dest | `DEEPSEEK_BASE_URL: https://api.deepseek.com` | CI real-API e2e | gate-exclude (dev-only CI) |
| .github/workflows/pi-ai-provider-e2e.yml:67 | config-remote-dest | `DSH_PI_AI_OPENAI_BASE_URL: https://openai-routerhub-resource.services.ai.azure.com/…` | CI pi-ai e2e (feature removed) | gate-exclude (dev-only CI; workflow orphaned) |
| .github/workflows/build-exe-for-python-sdk.yml:389,410 | config-remote-dest | `DEEPSEEK_BASE_URL: https://api.deepseek.com` | CI python-SDK build | gate-exclude (dev-only CI) |
| .github/workflows/{release-publish,release-vendor-publish,landlock-run-release}.yml | config-remote-dest | `registry-url: https://registry.npmjs.org` (npm publish action) | CI release | gate-exclude (dev-only CI) |
| .github/issue-management/policy.mjs:419 | fetch | `api.github.com` (GraphQL issue bot) | maintainer bot | gate-exclude (dev-only) |
| docs/**, *.md, *.i18n.yaml (324 URL lines) | hardcoded-host (prose links) | doc links (github.com, npmjs.com, spec sites) | n/a | docs-only (gate-exclude) |
| snapshots/session/web-fetch/{session.jsonl,web-fetch-fixture-server.mjs} | test data + loopback server | `http://public.test:43117`, `https://fixture.invalid` | web-fetch snapshot (feature removed) | delete (with the web feature) |
| snapshots/web/web-search-round/session.jsonl:23 | test data | recorded search URL | web-search snapshot (feature removed) | delete (with the web feature) |
| pnpm-lock.yaml | (no remote registry entries — workspace-local resolution) | n/a | n/a | keep |

## Sweeps (rg commands used)

```
# URL host literals in code + config
rg -n 'https?://[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-z]{2,}' --no-ignore -g '!node_modules' -g '!.git' \
  -g '*.ts' -g '*.js' -g '*.mjs' -g '*.cjs' -g '*.yml' -g '*.yaml' -g '*.json'
# fetch / XHR / WebSocket
rg -n 'fetch\(|WebSocket|undici|EventSource' --no-ignore -g '!node_modules' -g '!.git' -g '*.ts' -g '*.js' -g '*.mjs' -g '*.cjs'
# node network modules
rg -n "from 'node:(http|https|net|tls|dgram|dns)'|require\('node:(http|https|net|tls|dgram|dns)'" --no-ignore -g '!node_modules' -g '!.git'
# dns/dgram
rg -n 'node:dgram|node:dns|dgram\.|dns\.(lookup|resolve)' --no-ignore -g '!node_modules' -g '!.git'
# spawns
rg -n 'spawn\w*\(|execFile\(|execa\(' --no-ignore -g '!node_modules' -g '!.git' -g '*.ts'
# network-capable programs
rg -n 'curl|wget|git clone|npm i |npm install|pnpm install|npx ' --no-ignore -g '!node_modules' -g '!.git' -g '*.ts'
# config remote destinations
rg -n 'baseURL|baseUrl|endpoint|apiUrl' --no-ignore -g '!node_modules' -g '!.git' -g '*.ts' -g '*.yml' -g '*.yaml'
rg -n 'process\.env\.[A-Z_]*(URL|ENDPOINT|HOST|OTLP)' --no-ignore -g '!node_modules' -g '!.git' -g '*.ts' -g '*.yml'
# node_modules: distinct hosts
rg -o 'https?://[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-z]{2,}' node_modules/.pnpm --no-ignore -g '*.js' -g '*.cjs' -g '*.mjs'
# node_modules: destination-class hosts
rg -o 'https?://(api|app|cdn|static|collector|registry|telemetry|ingest|gateway|proxy|oauth|auth|login|events|stats|sentry|posthog|amplitude|segment|beacon|metrics|otlp|upload|download)\.[a-zA-Z0-9.-]+\.[a-z]{2,}' node_modules/.pnpm --no-ignore -g '*.js' -g '*.cjs' -g '*.mjs'
rg -o 'https?://[a-zA-Z0-9.-]*\.(deepseek|anthropic|openai|claude|e2b|perplexity|exa|harness|deepseeksvc)[a-zA-Z0-9.-]*' node_modules/.pnpm --no-ignore -g '*.js' -g '*.cjs' -g '*.mjs'
# non-code files
rg -n 'https?://[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-z]{2,}' --no-ignore -g '!node_modules' -g '!.git' -g '!*.ts' -g '!*.js' -g '!*.mjs' -g '!*.cjs' -g '!*.yml' -g '!*.yaml' -g '!*.json' -g '!*.md' -g '!*.i18n.yaml'
```

Raw sweep outputs are preserved under `neutered/docs/audit/.raw/` (hosts-code.txt, node-net-files.txt,
fetch-files.txt, spawn-src.txt, config-src.txt, hosts-src.txt, hosts-other.txt,
test-rows-first.txt).
