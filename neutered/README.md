# dsh-neutered

Run coding tasks with a local OpenAI-compatible model server at `http://127.0.0.1:1234/v1`, either one task at a time or in a terminal REPL. This fork removes the remote integrations listed below. Its launcher also loads a network guard. These protections cover specific calls and processes; they do not guarantee complete network isolation. [Setup](#network-exception) uses the network to download and install local assets.

This is a single fork branch (`neutered`) over the upstream tag `dsh-v0.1.2-alpha.4`, not a patch stack. Everything this fork owns lives under `neutered/`.

## What was removed

The DeepSeek API route and its extensions, session-log-deepseek, the package inventory, OpenTelemetry telemetry, the DeepSeek web search and the `web_fetch` / `web_search` tools, the MCP client, e2b, webhooks, the codex and claude-code hook and subagent bridges, the pnpm-backed plugin manager, the pi-ai multi-provider adapter, the web app and browser client packages, the ACP and SDK bundles, the Python SDK and the website. The only LLM adapter left is `packages/llm/llm-local`, an OpenAI-compatible chat-completions client pinned to the loopback endpoint.

## Intended launch and network protections

Use [dsh-neutered](bin/dsh-neutered) to launch this fork. The wrapper loads the Node guard before starting the harness and applies the offline model overlay. A direct launch of this checkout's underlying CLI uses the same modified source. The removed cloud integrations stay removed, but a direct launch does not automatically load the guard. If the wrapper selects a different CLI through `--dsh` or its PATH fallback, that installation has its own code.

The [local adapter](../packages/llm/llm-local/src/index.ts) accepts only a plain-HTTP `127.0.0.1` base URL. The [Node guard](guard/README.md) adds the port restriction. It intercepts selected networking APIs, rejects covered calls outside `127.0.0.1:1234`, and records blocked attempts. This also catches external calls from dependencies when they use those APIs.

Shell commands have a separate restriction. The [macOS Seatbelt profile](../packages/sandbox/sandbox-local/src/profiles.ts) denies network operations except outbound connections to localhost port `1234` for children it wraps. The Linux filesystem profiles in the same file do not provide the equivalent network rule.

For a model server it starts, the wrapper checks the pinned [llama-server files](llama/README.md), supplies the loopback bind and `--offline` flags, and refuses specified download, remote-backend, bind, router and UI arguments. It reuses an existing listener without checking its implementation or whether it forwards model requests elsewhere.

The Node guard runs inside the harness process. It cannot enforce a firewall around native programs or workers that start without it. The wrapper also does not apply an OS network sandbox to the model server. The [guard's limits](guard/README.md#known-limits) explain these exclusions. An uncovered path is not evidence that it sends traffic externally.

## Build

Dependencies are vendored; `pnpm run build` (from the repository root) produces `apps/cli/lib/bin.js`. On this machine both were run once.

## Run

From a fresh clone, `bash neutered/bin/install` installs the workspace, builds the CLI and runs the first-time setup; `neutered/bin/dsh-neutered setup` runs that setup alone. Setup detects the machine, asks which model to use (Enter accepts the recommendation), downloads the model and writes `$DSH_HOME/neutered/config.json` plus `overlay.yml` ([neutered/setup/README.md](setup/README.md)). The server that answers on `127.0.0.1:1234` is the vendored, hash-checked `llama-server`; install it once from a tarball downloaded on a connected machine (see `neutered/llama/README.md`):

```
bash neutered/llama/install.sh /path/to/llama-b10798-bin-macos-arm64.tar.gz
```

(Setup still installs Homebrew's llama.cpp as well; the wrapper does not run it. Replacing that step with the pinned tarball is the open follow-up in the merge notes of `docs/plans/2026-09-04-first-run-setup.md`.) Alternatively start your own OpenAI-compatible server on `127.0.0.1:1234`, LM Studio for example; the wrapper reuses whatever already listens there. Then:

```
neutered/bin/dsh-neutered -- "run the tests and fix the first failure"
```

When nothing listens on the port the wrapper takes the model from `--model`, `DSH_NEUTERED_MODEL` or the configuration, checks the server files against `neutered/llama/SHA256SUMS`, starts `llama-server` on it with `--ctx` (default: the configured context window, else 131072) and `--sleep-idle-seconds` (`--idle-seconds`, default 1800), waits for `/health`, runs the agent, and stops the server when the run ends. `--keep-server` (or `server.keep` in the configuration) leaves it running for the next run; it unloads the weights after the idle time and reloads them on the next request. `--server-arg <arg>` passes extra flags to the server after the configured `serverArgs` and `extraArgs`, except download, remote, bind, router and UI flags, which are refused. Without a configuration, a `--model` or a listening server, a task run performs the first-time setup first.

The wrapper loads the guard, applies `neutered/offline.patch.yml` and the generated `$DSH_HOME/neutered/overlay.yml`, and picks the profile: task text after `--` runs the headless profile once; no task with a terminal on stdin opens the REPL (`--resume [id]` continues a persisted session, `--sessions` lists them); no task with piped stdin (`pbpaste | neutered/bin/dsh-neutered`) runs the piped text as one headless task. In the REPL, Enter sends, Esc cancels the running turn, typing during a turn queues the next prompt, `y`/Esc answer approval questions, and Ctrl-C twice (or Ctrl-D) exits. There are no slash commands; `DSH_REPL_REASONING=0` hides the model's reasoning.

Workspace instructions come from one file name only: `DSH_INSTRUCTIONS.md`, read from the project root (the first ancestor holding `.git`) down to the working directory, plus nested ones the model touches. `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.local` overlays and anything under `$DSH_HOME` are ordinary files to this build, never instructions, and the name cannot be widened by configuration; the system prompt says so to the model as well. To give the model guidance that a repository keeps under another name, add a `DSH_INSTRUCTIONS.md` symlink to it. Design: `neutered/docs/2026-09-05-instructions-design.md`.

`--dry-run` prints the chosen profile, the server plan, the exact command and environment; `--dsh <path>` points at another built CLI; `-h` explains the single offline posture. There are no privacy levels, no `-p` flag and no web UI. `neutered/gate/egress-capture.sh --repl` runs the capture gate through the REPL under a pty.

`neutered/bin/dsh-neutered settings` shows the configuration or changes the model (`--model`), the context window (`--context`) and whether a started server stays up (`--keep-server on|off`).

## Network exception

[Setup](setup/README.md) downloads models from Hugging Face through `hf` or curl and can install llama.cpp through Homebrew. These operations run without the guard from `setup` and `settings --model`. When no configuration, explicit model or listening server exists, the wrapper runs setup before the task. The [installer](bin/install) also installs dependencies and builds the CLI before setup. These downloads are part of the intended setup workflow. With a configured local model or a listening server, task startup skips those downloads.

The wrapper's curl readiness check uses the caller's proxy settings and curl configuration. A model server started by the wrapper reads its local `.gguf` file. The static check excludes the setup directory, so a passing scan does not prove complete runtime isolation.

## Audit

- `node --test 'neutered/guard/test/**/*.test.cjs'` runs the guard's tests.
- `node --test 'neutered/setup/test/**/*.test.cjs'` tests the setup libraries without downloads.
- `bash neutered/bin/test/dsh-neutered.test.sh` tests the wrapper.
- `bash neutered/bin/test/install.test.sh` tests the installer without downloads.
- `bash neutered/gate/egress-grep.sh` checks known destination patterns and networking APIs in the files it scans. Its exclusions and pattern list limit what a passing result establishes.
- `bash neutered/gate/egress-capture.sh` polls connections with `lsof` during a session and exercises negative controls. `--model <gguf>` starts the vendored server through the wrapper. Polling observes a particular run and can miss short-lived connections.
