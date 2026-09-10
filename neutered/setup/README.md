# dsh-neutered setup

First-run configuration for the offline fork. Plain Node scripts, no dependencies, no build
step; the wrapper `neutered/bin/dsh-neutered` calls `setup.cjs` for `setup`, `settings`, the
server lifecycle and the generated overlay path.

## What it does

1. Probes the Mac: RAM, chip, Apple Silicon, GPU cores (`lib/hardware.cjs`). Budget for weights
   plus KV cache: 75 % of RAM at 36 GiB or more, else 67 %, minus min(2 GiB, RAM / 8); Intel Macs
   get 50 %. `DSH_NEUTERED_BUDGET_GIB=<n>` overrides.
2. Ranks `catalog.json` by fit (`lib/sizing.cjs`), prints the list with the recommended entry
   first and asks one question. Enter accepts. The last entry is a custom
   `owner/repo:file.gguf` or a local `.gguf` path. `--yes` and `--model` skip the prompt.
3. Installs llama.cpp with Homebrew when `llama-server` is missing, downloads the GGUF files into
   `$DSH_HOME/neutered/models/` with `hf download` or `curl -C -` (`lib/download.cjs`), and
   verifies the size (byte-exact for pinned entries, ±10 % otherwise) and SHA-256 when known.
4. Reads the GGUF header (`lib/gguf-header.cjs`) and picks the largest of 32k, 64k, 128k, 256k
   whose weights + KV cache + buffers fit the budget, capped at the model's native context.
5. Writes `$DSH_HOME/neutered/config.json` and renders `overlay.yml`, which the wrapper passes to
   dsh as a second `--patch` (model name, `contextWindow`, `maxTokens`, `streamIdleTimeoutMs`).

`dsh-neutered settings` shows the configuration or changes the model, the context window and
whether a server started by the wrapper stays up (`--keep-server on|off`). `--reset` removes the
configuration and keeps the downloaded models.

## Network use

This directory is the only network-using code in the fork. `lib/download.cjs` reaches
`https://huggingface.co/<repo>/resolve/main/<file>` and runs `brew install llama.cpp`;
`verify-catalog.cjs` (maintainer tool) reads `https://huggingface.co/api/models/<repo>/tree/main`.
Both run only from `setup`, `settings --model` or by hand, without the egress guard. A task run
never loads them: the wrapper starts `llama-server -m <local path>` and reaches
`127.0.0.1:1234` only. The static gate excludes `neutered/setup/**` and forbids
`huggingface.co` everywhere else (`neutered/gate/README.md`).

## Server lifecycle

Since the merge with the llama sidecar (2026-09-05) the wrapper does not call these commands:
it starts the vendored `neutered/llama/bin/llama-server` itself, as a child, with the model,
context, keep and start timeout read from `config.json` (`neutered/bin/dsh-neutered`). They
remain for `settings --stop-server`, `server status` and `server plan`.

`server ensure` probes `GET /health`. 200 means an external server (LM Studio, a hand-started
llama-server) and nothing is started or stopped. Otherwise it spawns
`llama-server --host 127.0.0.1 --port 1234 -m <path> -c <ctx> -ngl 99 --jinja <model args>`
detached, with output in `$DSH_HOME/neutered/llama-server.log`, records `server.pid`, and
waits for health (default 600 s). `server stop` signals that pid only if it is still a
`llama-server` with the recorded start time.

## Audit

- `node --test 'neutered/setup/test/**/*.test.cjs'` — every lib, offline.
- `bash neutered/bin/test/dsh-neutered.test.sh` and `bash neutered/bin/test/install.test.sh`.
- `node neutered/setup/verify-catalog.cjs` — network; rewrites `catalog.json` with exact sizes
  and hashes and fails on a file name that is not in the repository.
