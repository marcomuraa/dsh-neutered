# dsh-neutered — progress log

Fork goal: run DeepSeek Harness fully offline. Only permitted network destination is an
OpenAI-compatible model server at `http://127.0.0.1:1234/v1`. Headless profile only.
Everything else that can reach the network is physically removed from the tree, or blocked
at run time by the egress guard / seatbelt policy / static gates.

Branch: `neutered` (never pushed). Base: tag `dsh-v0.1.2-alpha.4`.

## How to resume this work

1. `git status` / `git log --oneline` in the repo root (one directory above `neutered/`).
2. Read this file top to bottom; the "Next" section is authoritative.
3. Verify the last completed step with its "verify" command before proceeding.
4. Every step commits on `neutered` with a clear message. Never push.
5. `pnpm install` (registry) is the only permitted network use in this session.

## Done

- [x] 2026-09-02 Environment setup: `pnpm install` complete (pnpm 11.7.0, node v25.9.0).
      Verified: `pnpm install` exit 0.
- [x] Baseline architecture survey: headless profile = bundle `@deepseek-ai/dsh-base`
      + `@deepseek-ai/dsh-headless` (PROFILE_TEMPLATES in
      `packages/boot/app-boot/src/profile.ts`). Base bundle patch:
      `packages/bundle/base/cordis.patch.yml`. LLM capability: `packages/llm/llm`
      (`ctx.llm.registerAdapter([provider], adapter)`; `LlmAdapter.stream(GenerateOptions)
      → AsyncIterable<StreamChunk>`). Native DeepSeek adapter: `packages/llm/llm-deepseek`
      (provider route `deepseek-official`); multi-provider twin `packages/llm/llm-pi-ai`
      (backed by `@earendil-works/pi-ai`).
- [x] Step 1: `neutered/INVENTORY.md` — one table per site class (production, tests,
      node_modules, non-code) with `file:line | kind | destination | trigger | action`, plus
      the exact rg sweeps and raw outputs under `neutered/docs/audit/.raw/`. Verified: every referenced
      file exists; sweeps re-runnable from the appendix.
- [x] Step 2, batch 1: `website/` + `python/` physically removed (74 file deletions total,
      incl. `pytest.ini` and the python/exe/doc-site/release scripts), plus their live
      references:
      - Root `package.json`: `website` out of workspaces; 19 script entries removed
        (benchmark/npm-resolution pair, doc-site + website docs/preview scripts,
        `publish:npm-baseline`, 6 `release:*`, `verify-npm-install-layout`,
        `verify-runtime-closure`); orphan devDeps `@yarnpkg/cli-dist` + `smol-toml` removed.
      - `pnpm-workspace.yaml`: `website`, `python/sdk-runtime`, and the single-exe
        `file:packages/subprocess/subprocess-local` allowBuilds entry removed.
      - `tsconfig.host.json`: the two `website/**` includes removed.
      - `scripts/run-gates.ts`: `docs-site-build` + `docs-site-projection` gates dropped from
        `docSyncLeafGates` (and its `docsBuildScript` option), `windows-site` gate dropped
        from the Windows blocking/complete lanes; `runtime-closure` gate dropped from
        `check-all`, `hygiene`, and the shared CI static lane (D13).
      - `scripts/check-workspace-constraints.ts`: the `python/sdk-runtime` deploy-root
        manifest is no longer folded into the dependency-isolation check.
      - `scripts/gen-third-party-notices.ts`: the Python `pyproject.toml` machinery
        (`parsePyproject*`, `collectPython*`, `PYTHON_METADATA`) and the
        `@yao-pkg/pkg` build-time-tool pin source are gone; `THIRD_PARTY_NOTICES.md`
        regenerated (no Python section; 264 workspace manifests, above the 100 floor).
      - `scripts/rescope-vendor.ts`: `publication-set-scope-assertion` rule removed
        (its target `publish-npm-baseline.ts` is gone).
      - `scripts/oxlint-contract.spec.ts`: website probe removed;
        `scripts/session-snapshot-corpus.corpus.ts`: roots loop skips missing directories
        (python/ and website/ no longer exist on disk); `lefthook.yml`: notices job glob no
        longer lists `python/*/pyproject.toml` or `scripts/build-exe-for-python-sdk.ts`.
      - `pnpm install` pruned 81 packages; lockfile updated (the only network use).
      Verified: `pnpm run build` exit 0; `pnpm run constraints` exit 0; specs green for
      run-gates (79/85 — the 6 `fail-fast scheduling` `spawn EPERM` failures reproduce on
      base HEAD `690e46fb5b` in a clean worktree, i.e. pre-existing host-sandbox
      spawn denials), check-workspace-constraints, gen-third-party-notices (incl. the
      freshness assertion), oxlint-contract, ci-workflow, rescope-vendor, and the
      session-snapshot corpus. Snapshot *adapter* replays (sdk/headless) fail for
      pre-existing environmental reasons: nested `sandbox-exec`/PTY denial,
      `/Users/m` mkdtemp denial, and local pyenv default 3.9.6 < required 3.10 for
      `code-runtime-python` — unrelated to this batch.
      Left intentionally stale/frozen (D8): `.github/workflows/*` (incl.
      `release.yml`'s `verify-npm-install-layout` line), `.gitlab-ci.yml` (two
      `verify-runtime-closure` lines), `scripts/ci-workflow.spec.ts` (asserts the frozen CI
      content), `scripts/check-macos-deployment-target.py`, `.agents/`; inert python
      path-prefix rules in `scripts/translation-pairing.ts`; the frozen-CI filename list in
      `scripts/client-build-environment.client.spec.ts`. Watch items for later batches:
      doc dead links (`verify-md-links`) and the snapshot-corpus adapter list (web adapters
      land in batch 2).

- [x] Step 2, batch 2: web surface and remote api group removed — `apps/web`,
      `packages/client`, `packages/api`, `packages/extensions/{ui-cordis,cordis-client-runner}`,
      `packages/experimental/{inspector,webworker-runtime,webworker-packer,
      agent-team-web-profile,client-ui-agent-team}`, `packages/host/{webserver,frontend-static,
      directory-picker*}`, `packages/bundle/web-app`, `packages/session-query/session-log-export`,
      `packages/test-support/client-runtime`, `snapshots/web`, the client build face
      (`tsconfig.client.json`, `build:lib:client`, the tsdown client preset) and every live
      reference. Design note: `.agents/notes/implemented/simplification/
      2026-09-03-remove-web-surface-and-api-batch-2.md`. Verified 2026-09-04: `pnpm run build`
      exit 0; `verify-cordis-config`, `verify-package-dependencies`, `constraints`,
      `verify-tsconfig-paths`, `verify-package-invariants`, `verify-application-entrypoints`
      all exit 0; the built CLI composes the headless profile (`--dump-config`, 87 rows, empty
      stderr); vitest 588 of 592 test files pass, the 4 failures are environmental (D14).

- [x] Step 2, batch 3: ACP, SDK and the external-agent subagents removed — `packages/acp`,
      `packages/sdk/{client,protocol,server}`, `packages/bundle/{acp-app,sdk-app,sdk-minimal}`,
      `packages/subagent/{subagent-acp,subagent-dsh-sdk,subagent-codex,subagent-claude-code}`
      (the codex subagent imported the SDK protocol, so both external-agent subagents left with
      it), `apps/cli/tests/profiles/{acp,sdk}`, `snapshots/{acp,sdk}`, the acp and codex session
      snapshots, the acp and sdk PROFILE_TEMPLATES entries, the acp and sdk e2e cases in
      `apps/cli/tests/built-bin.e2e.ts`, the sdk and acp cases in
      `apps/cli/tests/profile-hmr.spec.ts`, and every reference in `apps/cli/package.json`,
      `tsconfig.host.json`, `tsconfig.base.json`, `vitest.config.ts` and `scripts/*`.
      `pnpm-lock.yaml` regenerated; `THIRD_PARTY_NOTICES.md` regenerated. The hooks packages stay
      for the next batch because `snapshots/session/text-turn` mounts them. Verified 2026-09-04:
      `pnpm run build` exit 0; the six structural verify gates exit 0; the built CLI composes the
      headless profile (87 rows, empty stderr); vitest 560 of 563 test files pass, the 3 failures
      are the environmental ones in D14.

- [x] Step 2, batch 4: hook bridges removed — `packages/hooks/{hook-protocol,hooks-claude-code,
      hooks-codex}`, the fifteen `snapshots/session/hook-cc-*` and `hook-codex-*` recorded
      sessions, the `hooks-claude-code` and `hooks-codex` rows in
      `snapshots/session/text-turn/cordis.yml` (no derived snapshot file referenced them), and
      every reference in `apps/cli/package.json`, `tsconfig.host.json`, `tsconfig.base.json`,
      `vitest.config.ts` and `scripts/*`. `pnpm-lock.yaml` regenerated. Verified 2026-09-04:
      `pnpm run build` exit 0; the six structural verify gates exit 0; the built CLI composes the
      headless profile (87 rows, empty stderr); vitest 541 of 545 test files pass, the 3 D14
      environmental failures plus `packages/boot/app-boot/tests/user-patches.spec.ts`, a
      10-second HMR timing test that passed twice when rerun alone (load flake, not a regression).

- [x] Step 2, batch 5: MCP client, e2b and webhooks removed — `packages/mcp/mcp-client`,
      `packages/e2b/{e2b,fs-e2b,subprocess-e2b}`, `packages/webhook/{webhook,webhook-github}`,
      the `apps/cli/config/examples/mcp-memory` example configs and
      `apps/cli/tests/memory-mcp-configs.spec.ts`, plus every reference in `apps/cli/package.json`,
      `apps/cli/tsconfig.json`, `tsconfig.host.json`, `tsconfig.base.json` and `scripts/*`. The
      catalog generator's stale `ctx.e2b`, `ctx.webServer`, `ctx.webhookRuntime`, `WebhookRule`,
      `WebhookRoute` and `Sandbox` page mappings were dropped and `docs/subsystems/subprocess.*`
      regenerated; `pnpm-lock.yaml` and `THIRD_PARTY_NOTICES.md` regenerated. Verified 2026-09-04:
      `pnpm run build` exit 0; the six structural verify gates exit 0; the built CLI composes the
      headless profile (87 rows, empty stderr); vitest passes except the D14 environmental files.

- [x] Step 2, batch 6: telemetry, web tools, feedback command and plugin manager removed —
      `packages/session/session-telemetry{,-otel}`, `packages/feedback/command-feedback`,
      `packages/web/{web,web-fetch-http,web-search-deepseek,web-search-exa,web-search-perplexity,
      tool-web}`, `apps/cli/src/plugin.ts` with the `plugin` command, its help line, its
      invocation type and its tests in `apps/cli/src/{bin,args}.ts` and `apps/cli/tests/args.spec.ts`,
      the `snapshots/session/{web-fetch,web-search-endpoint-guidance}` recorded sessions,
      `scripts/snapshot-http-fixtures.spec.ts` (three of its four cases exercised the deleted
      web-search fixture), the `session-telemetry-otel`, `command-feedback`, `web`,
      `web-search-deepseek`, `web-fetch-http` and `tool-web` rows in the base bundle, the
      `tool-web` rows in the cordis, ptc and standard presets, the telemetry rows in the dsh-badge
      fixtures, and every reference in manifests, tsconfig references and aliases, vitest config,
      the type-equiv manifest and scripts. Generators updated and rerun: `gen-cordis-catalog`
      (stale `ctx.sessionTelemetry`, `ctx.web`, `session-telemetry/*` and `SessionTelemetryRecord`
      mappings dropped), `gen-doc-graphs` (sixteen stale service-role blocks dropped),
      `gen-tool-catalog`, `gen-third-party-notices`; lockfile regenerated. Verified 2026-09-04:
      `pnpm run build` exit 0; the six structural verify gates exit 0; the built CLI composes the
      headless profile (81 rows, empty stderr) and answered a live PONG through LM Studio in 41 s;
      vitest 508 of 511 test files pass, the 3 failures are the D14 environmental files.

- [x] Step 3, part 1: `packages/llm/llm-local` exists, is registered and answers. Built as D15
      says: a copy of `llm-deepseek` with the credential ladder, `apiKeyEnv`, `PUBLIC_BASE_URL`,
      `DEEPSEEK_BASE_URL`, the DeepSeek model catalog defaults, the `deepseekLlmApiExtensions`
      hook and the four credential-bound tests removed; identifiers renamed (`llm-local`, route
      `local`); a placeholder bearer token is sent; `baseURL` defaults to `http://127.0.0.1:1234/v1`
      and is accepted only when it is plain HTTP on the literal `127.0.0.1` host (D16). The
      extension request types are defined locally so the package has no dependency on the DeepSeek
      packages. Registered as row `llm-local` in the base bundle after `llm-deepseek`, declared in
      `packages/bundle/base/package.json` and `apps/cli/package.json`, referenced in
      `tsconfig.host.json`; aliases, lockfile, third-party notices, tool catalog and doc graphs
      regenerated. Verified 2026-09-04: `pnpm run build` exit 0; the six structural verify gates
      exit 0; vitest passes except the D14 files; the built CLI with an overlay setting
      `agent-default-model` to `provider: local` answered a live PONG through LM Studio in 37 s and
      the session log shows `"provider":"local"`.

- [x] Step 3, part 2a: the unit-lane harness runs on `llm-local`. `packages/test-support/llm-replay`
      (its accept rule and spec), `packages/llm/llm-retry/tests/transport-recovery.spec.ts`,
      `packages/fs/tool-fs`, `packages/subagent/subagent-spawn-in-process`,
      `packages/context/agent-instructions`, `packages/session/session-title-first-prompt-llm`,
      `packages/workflow/workflow-worker-thread` and `packages/core/agent-loop` (their harnesses,
      e2e files and manifests) now import `@deepseek-ai/dsh-llm-local`, mount `LlmLocal` and use the
      route name `local`; mock servers in those tests expect the placeholder bearer token `local`.
      `agent-default-model` in the base bundle now defaults to `provider: local`, `model: local`.
      Verified 2026-09-04: `pnpm run build` exit 0; the six structural verify gates exit 0; vitest
      passes except the D14 files (the llm-retry transport suite passes on `llm-local`); the built
      CLI answered a live PONG through `llm-local` in 5 s with an overlay that only names the
      model. Still on the DeepSeek route: `packages/llm/llm-pi-ai` (leaves with pi-ai), the
      headless profile e2e overlays and expected fixtures under `apps/cli/tests/profiles/headless`,
      `apps/cli/tests/built-bin.e2e.ts`, and the recorded snapshot corpus.

- [x] Step 3, part 2a: the unit-lane harness runs on `llm-local`. `packages/test-support/llm-replay`
      (its accept rule and spec), `packages/llm/llm-retry/tests/transport-recovery.spec.ts`,
      `packages/fs/tool-fs`, `packages/subagent/subagent-spawn-in-process`,
      `packages/context/agent-instructions`, `packages/session/session-title-first-prompt-llm`,
      `packages/workflow/workflow-worker-thread` and `packages/core/agent-loop` (their harnesses,
      e2e files and manifests) now import `@deepseek-ai/dsh-llm-local`, mount `LlmLocal` and use the
      route name `local`; mock servers in those tests expect the placeholder bearer token `local`.
      `agent-default-model` in the base bundle now defaults to `provider: local`, `model: local`.
      Verified 2026-09-04: `pnpm run build` exit 0; the six structural verify gates exit 0; vitest
      passes except the D14 files (the llm-retry transport suite passes on `llm-local`); the built
      CLI answered a live PONG through `llm-local` in 5 s with an overlay that only names the
      model. Still on the DeepSeek route: `packages/llm/llm-pi-ai` (leaves with pi-ai), the
      headless profile e2e overlays and expected fixtures under `apps/cli/tests/profiles/headless`,
      `apps/cli/tests/built-bin.e2e.ts`, and the recorded snapshot corpus.

- [x] Step 3, part 2b-1: `packages/llm/llm-pi-ai` removed with `@earendil-works/pi-ai` and its vendor
      SDKs (no longer in `pnpm-lock.yaml`), its base bundle row, manifests, tsconfig reference,
      alias, vitest entry, doc-graph lists and the sample name in `user-patches.spec.ts`; the pi-ai
      e2e fixtures and cases (`pi-ai-defaults.patch.yml`, `invalid-provider.cordis.yml`, the pi-ai
      case in `headless.expected.e2e.ts`, the patch-overlay boot failure case in `built-bin.e2e.ts`)
      removed. The CLI e2e tree under `apps/cli/tests` was moved to the local route mechanically:
      `deepseek-official` to `local`, `llm-deepseek` rows to `llm-local`, `deepseek-v4-flash` and
      `deepseek-v4-pro` to `local`, mock-server tokens to `local`; the `missing-credential` and
      `invalid-credential` expected fixtures, their two cases, their constants and
      `credentials-snapshot.patch.yml` were deleted because the local route has no credential.
      Verified 2026-09-04: `pnpm run build` exit 0 (so the e2e sources still typecheck); the six
      structural verify gates exit 0; vitest passes except the D14 files. Not yet run: the e2e
      `expected` lane over the retargeted headless fixtures, and `apps/cli/tests/built-bin.e2e.ts`
      still points the built CLI at its mock server through `DEEPSEEK_BASE_URL`, which `llm-local`
      does not read; both belong to the DeepSeek-route removal batch.

- [x] Step 3, part 2b-2: the recorded snapshot corpus runs on `llm-local`. All 129 corpus files
      that named the DeepSeek route were renamed mechanically (`deepseek-official` to `local`,
      `llm-deepseek` rows to `llm-local`, model ids to `local`, `local-pro`, `local-vision`), the
      derived files were re-recorded with `DSH_SNAPSHOT=refresh` and re-packed with
      `pnpm run migrate:packed-session-fixtures`; `product-subagent-result-diagnostic` was deleted
      (its system-prompt source was the deleted codex scenario) and the packed-rows test that read
      the deleted `hook-cc-pretool-deny` recording was dropped; the corpus adapter list and the
      ACP-only assertions in `scripts/session-snapshot-corpus.corpus.ts` now know only the
      `session` profile. `apps/cli/tests/built-bin.e2e.ts` hands the built CLI its mock-server URL
      through an `llm-local` overlay written into the temporary home; the environment-probe test
      and its helper, which exercised the DeepSeek credential ladder, were removed. Verified
      2026-09-04: `pnpm run build` exit 0; the six structural verify gates exit 0; vitest passes
      except the D14 files; the e2e expected lane passes (7 files, 17 tests); the rewritten
      built-bin case passes; the snapshot lane passes 59 of 60 scenarios, the one failure is
      `ptc-python-turn`, which needs CPython 3.10 (D14).

- [x] Step 2, batch 7 (the DeepSeek route) and step 3 complete: `packages/llm/llm-deepseek`,
      `packages/llm/deepseek-llm-api-extensions`, `packages/session/session-log-deepseek` and
      `packages/llm/plugin-package-inventory-deepseek` removed with their base bundle rows,
      manifests, tsconfig references and aliases, doc-graph blocks and lists, the catalog page
      mapping, the `session-log-deepseek/delivery-accepted` known event type, and the extension
      hook and its three tests in `packages/test-support/llm-replay`; the five replay overlays that
      disabled the inventory row were cleaned. The tree's only LLM adapter is now `llm-local`.
      Generators rerun: `gen-cordis-api`, `gen-cordis-catalog`, `gen-doc-graphs`,
      `gen-tool-catalog`, `gen-third-party-notices`; lockfile regenerated. Verified 2026-09-04:
      `pnpm run build` exit 0; the six structural verify gates exit 0; vitest passes except the
      D14 files; the snapshot lane passes 59 of 60 scenarios (the remaining one needs CPython
      3.10). Remaining DeepSeek strings in the tree are test-only: the frozen CI workflow assertions
      in `scripts/ci-workflow.spec.ts`, the real-model e2e lanes that skip without
      `DEEPSEEK_API_KEY`, and two stale comments in `packages/llm/llm-local/src/index.ts`; step 7
      decides their fate when the static gate is written.

- [x] Step 4: `neutered/guard/loopback-only.cjs`, the Node preload egress guard, plus its
      `node --test` suite and README. It wraps `net.Socket.prototype.connect`, `tls.connect`,
      `dgram` send/connect, the `dns` callback/promise/Resolver families, `http`/`https`
      request/get and `globalThis.fetch`, and permits exactly `127.0.0.1:1234` (plain HTTP); every
      other destination throws `EGRESS_BLOCKED`, all DNS is blocked including `localhost`, Unix
      sockets pass, and the wrap is idempotent and re-applied in workers and Node children through
      `NODE_OPTIONS`. Authored by Claude, not dsh: the 27B spent 55 minutes reasoning without
      writing the file (same open-ended-authoring stall as the first overnight run), so per the
      original design note this fail-closed security file was written directly and given a 13-case
      `node --test` suite. Verified 2026-09-04: 13 of 13 guard tests pass and the archived T2 gate
      exits 0. Note for later steps: Node 25's `node --test <dir>` treats the path as one file;
      the working invocation is `node --test 'neutered/guard/test/**/*.test.cjs'`.

- [x] Step 5: the macOS Seatbelt profile that wraps every bash-tool child now denies the network.
      `packages/sandbox/sandbox-local/src/profiles.ts` emits `(deny network*)` followed by
      `(allow network-outbound (remote ip "localhost:1234"))`, so a bash child (curl, git, python)
      can reach only TCP 127.0.0.1:1234; a public IP and every other loopback port are refused at
      the kernel, and a hostname fails to resolve. The pinned profile string in
      `packages/sandbox/sandbox-local/tests/local.spec.ts` was updated and a real-curl case added
      to `packages/sandbox/sandbox-local/tests/seatbelt.e2e.ts` (curl to 1.1.1.1, to a hostname and
      to another loopback port all fail; a server on 1234 answers). This is a live edit to an
      upstream file, kept on the branch; Phase 4's patch capture is not used in this build because
      the whole fork is one branch, not a patch stack over a pinned tag. Verified 2026-09-04:
      `pnpm run build` exit 0; the sandbox-local unit and e2e suites pass (38 + 6); the six
      structural verify gates exit 0; the wider vitest run passes except the D14 files. Linux
      (bwrap, Landlock) is unchanged; the artifact is macOS-only per Q7.

- [x] Step 6: `neutered/bin/dsh-neutered`, `neutered/offline.patch.yml`, `neutered/README.md` and
      the wrapper test. The wrapper preloads the guard through NODE_OPTIONS, boots the headless
      profile of the built `apps/cli/lib/bin.js` with the offline overlay, forwards everything
      after `--` to the agent, and rejects `-p`, `--web` and any unknown flag (this build has one
      offline posture). `--dry-run` prints the command and environment; `--dsh <path>` overrides
      the executable. Because the base bundle is already fully neutered — the DeepSeek route,
      telemetry, web tools, MCP, e2b, webhooks and plugin manager are gone and `agent-default-model`
      defaults to `provider: local` — the overlay only pins the `llm-local` model catalog and
      context window. Verified 2026-09-04: the wrapper test passes; the overlay composes from a
      clean `DSH_HOME` with no unmatched targets; a real run through the wrapper answered PONG
      against the local model in 65 s with the guard active and `egress-blocked.log` empty.

- [x] Step 7: both egress gates. `neutered/gate/egress-grep.sh` is the static gate (patterns in
      forbidden-patterns.txt, a self-test, and the neutered baselines); it reports 0 destination
      and 0 primitive hits on the tree in both sources and closure modes.
      `neutered/gate/egress-capture.sh` is the dynamic gate: it runs a real dsh-neutered session
      under lsof process-tree polling and passes only when every peer is 127.0.0.1:1234, with a
      node negative control that must FAIL naming 1.1.1.1:80 and a bash negative control that runs
      curl through the bash tool and now PASSES with CURL_RC=7 because the Seatbelt profile denies
      it. Verified 2026-09-04: the real session PASSES (sole peer 127.0.0.1:1234), the node control
      FAILS (exit 1), the bash control PASSES (exit 0, curl refused at the kernel).

- [x] Step 8 (2026-09-04): the vendored model server. `neutered/llama/` pins llama.cpp build
      b10798 (`VERSION`: tarball SHA-256; `SHA256SUMS`: llama-server and the ten libraries it
      links); `install.sh` verifies and unpacks a locally supplied tarball into the git-ignored
      `bin/`, never downloading. `neutered/bin/dsh-neutered` gained the sidecar lifecycle: with
      `--model <gguf>` (or `DSH_NEUTERED_MODEL`) and nothing listening on 127.0.0.1:1234 it
      re-checks `bin/` against `SHA256SUMS`, starts `llama-server --host 127.0.0.1 --port 1234
      -m <gguf> -c <ctx> -ngl 99 --jinja --alias local --no-webui --offline --sleep-idle-seconds
      <idle>`, waits for `GET /health` = 200, runs the agent, and stops the server on exit unless
      `--keep-server`; an existing listener is reused; `--server-arg` refuses download, remote,
      bind, router and UI flags. `egress-capture.sh` gained `--model` and classifies sockets whose
      local end is 127.0.0.1:1234 (the sidecar accepting the agent) as served connections, not
      peers; `egress-grep.sh` skips `neutered/llama/bin/`; `huggingface.co` joined the forbidden
      destinations. Verified 2026-09-04: the wrapper test (spawn, reuse, keep, hash mismatch,
      death, timeout, refused flags) passes against a stub server; the real b10798 binary loaded
      a 3B GGUF in 2 s, answered PONG, fell from 4.4 GB to 138 MB RSS after the idle time with
      `/health` still 200, reloaded on the next request, and exited on SIGTERM.
- [x] Step 9 (2026-09-05): the interactive REPL. New bundle `packages/bundle/repl`
      (`@deepseek-ai/dsh-repl`) and shipped profile `repl`: one Agent for the process, prompts
      as follow-ups, live text and one line per tool call and result, reasoning on stderr
      (`DSH_REPL_REASONING=0` hides it), bracketed paste, Esc cancels the turn with the inbox
      kept, typing during a turn queues, y/Esc answer approvals, Ctrl-C twice or Ctrl-D exits,
      `--resume [id]` and `--sessions`. The wrapper picks the profile from task text / TTY /
      pipe. Gates: static 0/0, `egress-capture.sh --repl` under expect. Design record:
      `neutered/docs/2026-09-05-repl-design.md`; plan: `neutered/docs/2026-09-05-repl-plan.md`.

ALL BUILD STEPS DONE. dsh-neutered is a fully offline headless DeepSeek Harness whose only network
destination is http://127.0.0.1:1234/v1, enforced by source deletion, the llm-local adapter, the
Node preload guard, and the macOS Seatbelt network-deny, and proven by the static and dynamic
gates. Steps 5 to 7 of the original delivery plan (GitHub Actions release, signing, SBOM, tarball,
optional pf recipe) are packaging, not neutering, and remain for whenever the artifact is shipped
off this machine.

- [x] Step 10 (2026-09-05): first-run setup. `neutered/bin/install` installs, builds and hands off
      to `neutered/bin/dsh-neutered setup`, which probes the Mac (`neutered/setup/lib/hardware.cjs`),
      ranks `neutered/setup/catalog.json` by fit, installs llama.cpp with Homebrew, downloads the
      chosen GGUF from Hugging Face, sizes the context window from the GGUF header
      (`gguf-header.cjs`, `sizing.cjs`) and writes `$DSH_HOME/neutered/{config.json,overlay.yml}`.
      The wrapper applies the generated overlay as a second `--patch` and, when 127.0.0.1:1234 is
      silent, starts the vendored `llama-server` (step 8) on the configured model and stops it after
      the run; `settings` changes the model, context and keep-server. Design:
      `neutered/docs/2026-09-04-first-run-setup-design.md`. Built on `worktree-neutered-setup`
      (based on `05def55a68`) and merged into `neutered` on 2026-09-05 after steps 8 and 9, following
      the merge-notes table at the end of `neutered/docs/plans/2026-09-04-first-run-setup.md`:
      sidecar lifecycle and flags kept, setup dispatch, second overlay and auto-setup kept, wrapper
      defaults from `config.json` added (D21). Verified on the merged tree: `pnpm run build`,
      `node --test 'neutered/setup/test/**/*.test.cjs'`, both wrapper tests, `egress-grep.sh`,
      `egress-capture.sh` (numbers in the merge commit message).
      Open follow-up from the merge notes: `neutered/setup/lib/download.cjs` still installs
      llama.cpp with Homebrew, which the wrapper no longer runs; a fresh clone must also run
      `bash neutered/llama/install.sh <tarball>` until setup downloads the pinned asset named in
      `neutered/llama/VERSION` instead.

- [x] 2026-09-06 Step 11: one instruction file name. The `agent-instructions` plugin reads
      exactly `DSH_INSTRUCTIONS.md` (constant `INSTRUCTION_FILE` in
      `packages/context/agent-instructions/src/config.ts`), from the project root down to the cwd
      plus nested directories the model touches. Gone: the `AGENTS.md`/`CLAUDE.md` candidate list,
      the `.local.md` overlays, the user-global `$DSH_HOME/AGENTS.md` scope, the per-directory
      content dedup, and the `instructionFileCandidates`, `localInstructionFileCandidates` and
      `dshHome` config fields, so no overlay can widen the set. The headless and repl persona tell
      the model that only `DSH_INSTRUCTIONS.md` carries operator instructions. The repo root has a
      `DSH_INSTRUCTIONS.md` symlink to `AGENTS.md`; the upstream `AGENTS.md`/`CLAUDE.md` files stay.
      The 4680-line spec was replaced by a 9-test spec; the session snapshots keep covering nested
      dynamic injection. Design: `neutered/docs/2026-09-05-instructions-design.md`. Built on
      `worktree-instructions`: dsh (27B) wrote every source, persona and spec edit from 14 exact
      prompts, all byte-identical; shell did renames, deletions, symlinks and snapshot refreshes.
      Verified: build 0; `vitest run packages/context/agent-instructions packages/core/agent-loop
      packages/core/session` 34 files, 658 tests; snapshot suite 59 pass, 2 skipped, 1 failing
      before and after (`ptc-python-turn`, host python 3.9); `workspace-context-resume` expected
      test refreshed and green; `egress-grep.sh` 0/0; live check: a repo with `CLAUDE.md`
      (BANANA) and `DSH_INSTRUCTIONS.md` (PONG) answers PONG, a repo with only `CLAUDE.md` does
      not answer BANANA.

## Next

- Setup follow-up (merge notes, 2026-09-05): replace the Homebrew branch of
  `neutered/setup/lib/download.cjs` with the download of the pinned llama.cpp asset named in
  `neutered/llama/VERSION` plus `neutered/llama/install.sh`, so a fresh clone needs no second step.
  Then decide whether `neutered/setup/lib/server.cjs` (`server ensure`/`stop`, `server.pid`) is
  still worth keeping or goes with its test.

Step 2 — physical removals (each batch commits separately; `pnpm run build` must be green
after each). Batches 1 to 6 are done — see "Done". Step 2 is complete except for the
DeepSeek route. Step 3 part 1 is done (see D15, D16). Next units of work, in order:
1. Done above. Steps 4 to 7 follow in the order of the original task list: the preload guard
   `neutered/guard/loopback-only.cjs` with its `node --test` suite; the Seatbelt network deny for
   bash-tool children in `packages/sandbox/sandbox-local/src/profiles.ts` with a curl test; the
   `neutered/bin/dsh-neutered` wrapper and `neutered/README.md`; `neutered/gate/egress-grep.sh` and
   `neutered/gate/egress-capture.sh` with both negative controls. The former item text follows for
   reference only: `packages/llm/llm-deepseek` is a test dependency of
   `llm-replay`, `tool-fs`, `agent-instructions`, `llm-retry`, `llm-pi-ai`,
   `session-title-first-prompt-llm`, `subagent-spawn-in-process` and of every recorded
   `cordis.snapshot.yml`, so the test harness must be retargeted to `llm-local` first.
   Then: `packages/llm/llm-deepseek`, `packages/llm/deepseek-llm-api-extensions`,
   `packages/web` (whole group), telemetry `packages/session/session-telemetry{,-otel}`,
   `apps/cli/src/plugin.ts` (pnpm plugin manager; D4) + `dsh plugin` wiring in
   `apps/cli/src/{bin,args}.ts`, orphaned CI/dev scripts.
After each batch: fix package.json deps/exports, bundle patch rows, tsconfig references,
vitest configs, then `pnpm run build`.

## Decisions (recorded, no user input available — decide and record)

- D1: Repo root for all work is the git checkout (one dir above `neutered/`). All deliverable
  paths in the task are relative to that root.
- D2: `packages/api` (Remote BFF / Typert RPC gateway: `dsh-api-gateway` stream server+client,
  `dsh-api-remotes`, session/settings/workspace controllers) is physically removed in step 2.
  It exists solely to serve the web client surface (and ACP/SDK, also removed); after those
  removals nothing in the headless path imports it, and its stream client/server are network
  primitives. The `typert-gateway` row leaves `packages/bundle/base/cordis.patch.yml`.
  `typert-registry`/`typert-loader` rows stay (in-process type registry, no network).
- D3: `pnpm run build` keeps its `build:lib` (host) phase; the `build:web` phase and the
  client face (`build:lib:client`, `tsconfig.client.json`) are removed together with the web
  app + client packages. `scripts/build.ts` is updated to run host-only and skip the client
  artifact record.
- D4: The pnpm-backed plugin manager is `apps/cli/src/plugin.ts` (`dsh plugin` subcommand, a
  thin pnpm forwarder). Removed from the CLI in step 2; profile boot keeps resolving
  in-box bundles (no pnpm call needed for shipped profiles).
- D5: `packages/subagent/subagent-dsh-sdk` and `packages/subagent/subagent-codex` are removed
  with the SDK group: they run external agent processes (dsh child via JSON-RPC, codex CLI)
  that carry network capability and whose dependencies (`dsh-sdk-client/protocol`) are removed.
  `subagent-acp`/`subagent-claude-code` are removed with ACP / claude-code bridges.
- D6: Guard scope (step 4): the preload blocks every socket/DNS/fetch destination except
  `127.0.0.1:1234`. DNS is fully blocked (loopback literal needs no resolution). The only
  remaining in-tree egress site after step 3 is `packages/llm/llm-local`; the guard makes
  that the only legal peer at run time even if code regresses.
- D7: The egress-grep gate (step 7) treats "network primitives" as egress-capable APIs
  (fetch, http(s).request/get, net/tls connect, dgram, dns lookup/resolve) plus any remote
  destination literal (http(s) URL with non-loopback host) anywhere in sources or
  node_modules. Loopback-only TCP servers (none expected in the final headless tree) would
  be allowlisted by path; if one appears, it must be recorded here.
- D8: Gate scope = product sources (`apps/cli/src`, `packages/**/src`, `packages/bundle`,
  `native/`, `vendor/`, `snapshots/`, `scripts/`) + `node_modules` (separate pass with
  `neutered/gate/allowlist.txt`). Excluded: `.github/`, `.gitlab-ci.yml`, `docs/`, `*.md`,
  `*.i18n.yaml`, `.agents/`, `lefthook.yml` (dev/CI + prose). Rationale: the product runtime
  never loads CI config or docs; those are inventoried in INVENTORY.md Table 4 for audit.
- D9: Web-preview and client-side experimental packages are removed with the web surface:
  `packages/experimental/{inspector,webworker-runtime,webworker-packer,
  agent-team-web-profile,client-ui-agent-team}` (network primitives: CDP bridge http server,
  worker http/net/ws polyfills, BFF deps). Kept: `packages/experimental/{agent-team,
  tool-agent-team,agent-team-profile,code-runtime-python}` — in-process prototypes with no
  direct network primitive (they reach the LLM only through the local adapter).
- D10: Host packages removed with the web surface: `packages/host/{webserver,
  frontend-static,directory-picker,directory-picker-auto,directory-picker-browse,
  directory-picker-native}` (the webserver binds `127.0.0.1` **or `0.0.0.0`** by config —
  an explicit egress/ingress vector; only the web-app bundle mounted it).
  `packages/host/plugin-inventory` stays (no network).
- D11: Dev scripts that reach the network are removed with step 2: `benchmark-npm-resolution
  (+spec,+next-package-dependency)`, `publish-npm-baseline`, `release/*` (bump/process),
  `dev-web`, `run-web-snapshots`, `client-build-environment (+spec)`, `project-doc-site
  (+spec)`, `verify-doc-site-fragments (+spec)`, `build-exe-for-python-sdk (+specs)`.
  Local-only git tooling (translation pairing, change-scope, rescope-vendor,
  verify-*) stays — verified their git subcommands are index/blob-local.

 - D12: `verify-npm-install-layout{,.spec}.ts` removed with batch 1. Its local-registry
   scaffolding (fixture publishing, `@yarnpkg/cli-dist` import) lived in the deleted
   `benchmark-npm-resolution.ts`, and the check itself asserts the two-release npm
   publication layout — an npm-publication concern this fork no longer targets.
 - D13: `verify-runtime-closure{,.spec}.ts`, its root `verify-runtime-closure` script, and
   the `runtime-closure` gate (check-all, hygiene, and the shared CI static lane) removed
   with batch 1. The gate validated the single-exe Python SDK runtime deploy closure under
   `python/sdk-runtime/` (its `package.json` + `platforms.json` inputs), physically deleted
   in the same batch; keeping it would leave a live gate that can only crash on missing
   inputs. Frozen CI references to it (`.gitlab-ci.yml:39,119`) stay by D8 policy.

 - D14: Four test files fail on this machine before and after every batch for environmental
   reasons and do not count as gate failures: `packages/experimental/code-runtime-python/
   tests/{runtime,boot-write-failure}.spec.ts` (pyenv `python3` is CPython 3.9.6, the runtime
   requires 3.10+), `scripts/oxlint-contract.spec.ts` (Node 25 prints a `NO_COLOR`
   deprecation warning on stderr that the test expects empty), `packages/subagent/
   subagent-claude-code/tests/real-product.spec.ts` (needs the external `claude` CLI; the
   package leaves in a later batch). A batch is green when `pnpm run build` exits 0, the
   structural verify gates pass, and no test file fails that passed on the previous commit.

 - D15: Step 3 builds `packages/llm/llm-local` as a trimmed copy of `packages/llm/llm-deepseek`,
   not as a new client. The DeepSeek adapter already speaks OpenAI-compatible chat completions
   over SSE (`adapter.ts`, `serialize.ts`, `sse.ts`, `translate.ts`, `types.ts` stay), and the
   repository's mock model server answers `POST */chat/completions`, so the existing test harness
   retargets by renaming. Dropped from the copy: the credential ladder and `apiKeyEnv` (a fixed
   placeholder `Authorization` header is sent because some local servers reject an empty one),
   `PUBLIC_BASE_URL` and the `baseURL` setting (the constant `http://127.0.0.1:1234/v1`),
   `files-api.ts`, `file-store.ts`, `file-id.ts`, `upload-index.ts`, `image-tokens.ts`,
   `request-pricing.ts` and every image-offload setting, the DeepSeek model catalog defaults
   (model id and context window come from the `llm-local:` settings section), and the
   `deepseek-llm-api-extensions` hooks. Row id `llm-local`, provider route `local`.

 - D16: `llm-local` keeps a `baseURL` setting, unlike the plan's "base URL not configurable"
   wording, because every test harness starts a mock model server on a random loopback port and
   must point the route at it. The setting is validated at resolve time: protocol `http:` and
   hostname exactly `127.0.0.1`, any port. The product default is `http://127.0.0.1:1234/v1`, and
   the step 4 preload guard pins the runtime to 127.0.0.1:1234 regardless of settings, so the
   artifact is still loopback-only while the tests stay runnable.

 - D17: The model server ships as the official llama.cpp `llama-server` binary pinned by hash and
   installed from a local tarball, not as committed binaries (24 MB of Mach-O in git for a
   never-pushed fork) and not as `node-llama-cpp` in-process bindings (a native addon whose
   prebuilt-missing fallback downloads and compiles llama.cpp, and which would replace the
   `llm-local` HTTP adapter the recorded snapshot corpus depends on). Single-model mode with
   `--sleep-idle-seconds` was chosen over router mode (`--models-dir`): the model id stays
   `local`, there is no extra hop, and load and unload are still automatic. The wrapper owns the
   lifecycle because it is the one place that already knows the endpoint and the guard; a
   server the wrapper started is a child in the capture gate's process tree, hence the
   served-connection classification. `DSH_NEUTERED_TEST_PORT` moves only the sidecar and its
   health probe, never the guard's pin, so the wrapper test can run while a developer's own
   server holds 1234.

 - D18: The REPL is a second shipped profile, not a mode of headless, so the one-shot runner and
   its snapshot corpus stay untouched and the gate boundary is one package. Enter during a turn
   queues through `agent.followup` (the web UI's semantics, read from the tag tree), never
   `steer`; Esc is `agent.cancel({kind:'user'},{keepInbox:true})`. No slash commands: every
   command is a flag or a key, so there is no parser for the model to break.

 - D19: First-run setup lives in `neutered/setup/` and is the one network-using path of the fork.
   It runs without the guard, only from `dsh-neutered setup` and `settings --model`; the static
   gate excludes `neutered/setup/**` and forbids `huggingface\.co` everywhere else.
 - D20: macOS only. Apple Silicon budget is 75 % of RAM at 36 GiB or more, else 67 %, minus
   min(2 GiB, RAM / 8); Intel Macs get 50 %. `DSH_NEUTERED_BUDGET_GIB` overrides.
 - D21: The wrapper starts the vendored `llama-server` (D17) as its own child when the port is
   silent, taking the model, context window, keep-server and start timeout from `config.json`
   unless `--model`/`DSH_NEUTERED_MODEL`, `--ctx`, `--keep-server` or `--load-timeout` say
   otherwise, and stops it after the run (`--keep-server` or `server.keep` leaves it). An already
   listening server is used as is. Decided at the merge (2026-09-05): the setup branch's detached
   `setup.cjs server ensure`/`stop` lifecycle is not called by the wrapper any more, so the server
   stays inside the capture gate's process tree; `server.cjs` remains for `server status`/`plan`
   and `settings --stop-server`, which only see a server it started itself.
 - D22: The model list is a curated `catalog.json` plus a custom `owner/repo:file.gguf` or local
   path. Context = largest of 32k/64k/128k/256k that fits weights + KV (from the GGUF header) +
   buffers, capped at the native context; `maxTokens = min(32768, ctx / 4)`.
 - D23: The root README is the fork's page; upstream's README stays in history (`05def55a68`).
   `README.zh.md` and `README.i18n.yaml` are removed and `README.md` is listed in
   `scripts/translation-pairing.manifest.json` `excluded`.

 - D24: Workspace instructions come from one file name, `DSH_INSTRUCTIONS.md`, hardcoded in the
   loader with no candidate list, no `.local` overlay and no `$DSH_HOME` scope. A repository that
   carries only `CLAUDE.md` or `AGENTS.md` gives the model no workspace instructions; the operator
   adds a `DSH_INSTRUCTIONS.md` symlink when that guidance is wanted. Ignored legacy names stay
   silent. Deferred (Marco, 2026-09-05): a static gate that forbids the legacy names in product
   sources, to be built with the scripts that neuter future upstream versions.

## Verification cookbook

- Build: `pnpm run build` (expect exit 0).
- Unit tests: `pnpm run test` (remaining suites).
- Gate (after step 7): `bash neutered/gate/egress-grep.sh` (zero hits) and
  `bash neutered/gate/egress-capture.sh` (needs a local model on 127.0.0.1:1234).
- Smoke: `neutered/bin/dsh-neutered -- "Reply with exactly the word PONG"` prints PONG.
- Sidecar: `bash neutered/bin/test/dsh-neutered.test.sh` (stub server); with port 1234 free,
  `neutered/bin/dsh-neutered --model <gguf> -- "Reply with exactly the word PONG"` and
  `bash neutered/gate/egress-capture.sh --model <gguf>`.
- REPL: `pnpm exec vitest run packages/bundle/repl`, `pnpm exec vitest run --config
  vitest.e2e.config.ts apps/cli/tests/repl.e2e.ts`, `bash neutered/bin/test/dsh-neutered.test.sh`,
  `bash neutered/gate/egress-capture.sh --repl`.
- Instructions (step 11): `pnpm exec vitest run packages/context/agent-instructions`; snapshot
  replay `pnpm exec vitest run --config vitest.snapshot.config.ts -t "agent-instructions|ptc-workspace-context"`;
  live: a temp repo with `.git`, `CLAUDE.md` saying reply BANANA and `DSH_INSTRUCTIONS.md` saying
  reply PONG, `neutered/bin/dsh-neutered -- "Reply with exactly the single word the workspace
  instructions tell you to reply with"` prints PONG.
