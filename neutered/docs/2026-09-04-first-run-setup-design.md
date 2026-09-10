# dsh-neutered first-run setup — design

Date: 2026-09-04. Status: draft for review. Branch: `worktree-neutered-setup` over `neutered`
(`05def55a68`).

## 1. Goal

Make a fresh GitHub clone of dsh-neutered usable by someone who is not the author, with as little
input as possible:

1. **Automatic setup.** One command installs dependencies, builds the CLI, and hands off to the
   first-run flow.
2. **First-run flow.** Detects the machine, ranks a small catalog of coding models by fit, asks
   exactly one question (which model; Enter accepts the recommendation), downloads the model and
   llama.cpp, sizes the context window, and writes the configuration.
3. **Settings mode.** `dsh-neutered settings` shows and changes the model, the context window and
   the server behaviour, interactively or by flags.
4. **Automatic model server.** `dsh-neutered -- "task"` starts `llama-server` when nothing answers
   on `127.0.0.1:1234`, waits for it, runs the task, and stops the server it started.

The runtime posture of the fork does not change: the agent process, its Node children and its
bash-tool children can still reach only `127.0.0.1:1234`.

## 2. Decisions taken with Marco (2026-09-04)

| # | Decision | Alternatives rejected |
|---|---|---|
| 1 | Setup code lives in a new, network-using `neutered/setup/` path, allowlisted by path in the static egress gate and documented in INVENTORY.md and the READMEs. | Print download commands only; separate installer repository. |
| 2 | macOS only. Apple Silicon first-class; Intel Macs run with a warning (CPU only). Linux gets a clear "unsupported" message from the installer. | macOS + Linux; macOS + Linux + WSL. |
| 3 | The wrapper auto-starts `llama-server` when the port is silent and stops it after the task. `--keep-server` leaves it running. An already-running server (for example LM Studio) is used as today. | Keep running by default; never auto-start. |
| 4 | Curated catalog of coding GGUFs plus a custom escape hatch (Hugging Face `repo:file` or a local `.gguf` path). | Curated only; free-form repository only. |
| 5 | The root `README.md` is replaced by the fork's page. The upstream text stays in git history and is linked. | Banner over upstream text; leave untouched. |

Implementation is Node scripts (plain CommonJS, zero dependencies, no build step) called from the
existing bash wrapper, the same shape as `neutered/guard/loopback-only.cjs`. A `dsh setup`
subcommand inside `apps/cli/src` was rejected: it would need the build before setup can run and
would widen the product source the gate audits.

## 3. Posture: the setup exception

Setup downloads a model from Hugging Face and installs llama.cpp through Homebrew. That is network
egress, and it is the only egress the fork performs, under these rules:

- It happens only inside `dsh-neutered setup`, `dsh-neutered settings` (when a model change needs
  a download) and `neutered/bin/install`. Nothing on the task path (`dsh-neutered -- ...`)
  downloads anything.
- Setup processes never load the guard. The wrapper strips `--require=.../loopback-only.cjs`
  from `NODE_OPTIONS` before running a setup script. The task path keeps the guard exactly as
  today.
- The runtime starts `llama-server` with a local `-m <path>.gguf`, never with `-hf`, so the
  server does not dial Hugging Face either.
- Every destination the setup can reach is a literal in one file, `neutered/setup/lib/download.cjs`:
  `https://huggingface.co/<repo>/resolve/main/<file>` (direct download and `hf` CLI both resolve
  there) and the Homebrew formula `llama.cpp` (Homebrew's own mirrors). No other host.
- The static gate excludes `neutered/setup/**` from both the destination and the primitive scan,
  the same way it treats `neutered/guard/` and `neutered/gate/`. INVENTORY.md gains a fifth action
  value, `setup-only`, and rows for the two sites. The gate README lists the fourth allowed root.

## 4. User journey

```
git clone https://github.com/<user>/dsh-neutered.git
cd dsh-neutered
bash neutered/bin/install            # installs deps, builds, then runs first-run setup
neutered/bin/dsh-neutered -- "run the tests and fix the first failure"
neutered/bin/dsh-neutered settings   # change model / context / server behaviour
```

First run, as the user sees it (64 GB M4 Max example, values illustrative):

```
dsh-neutered setup
Machine: Apple M4 Max, 64 GiB unified memory, 40 GPU cores  (usable for models: 46 GiB)
Models that fit:
  1) Qwen3.8-27B  UD-Q4_K_XL        17 GB   256k ctx   recommended, dense
  2) Qwen3-Coder-Next  UD-Q4_K_XL   46 GB   256k ctx   coder, moe
  3) Qwen3.8-27B  Q8_0              29 GB   256k ctx   quality, dense
  4) Qwen3.6-35B-A3B  UD-Q4_K_XL    28 GB   256k ctx   fast, moe
  5) gpt-oss-20b  MXFP4             12 GB   128k ctx   small, moe
  6) Qwen3.8-27B  UD-IQ3_XXS        12 GB   256k ctx   small, dense
  7) Qwen3.5-9B  UD-Q4_K_XL          6 GB   256k ctx   small, dense
  8) custom (Hugging Face repo:file, or a local .gguf path)
Too large for this machine: gpt-oss-120b MXFP4 (63 GB)
Choose [1]: ⏎
Installing llama.cpp (brew) ... done
Downloading unsloth/Qwen3.8-27B-GGUF Qwen3.8-27B-UD-Q4_K_XL.gguf → ~/.dsh/neutered/models/ ... 17.0 GB, done
Reading model header: 64 layers (16 with a KV cache), 8 KV heads × 128, native context 262144
Context window: 262144 (weights 15.8 GiB + KV 16.0 GiB + buffers 2.0 GiB = 33.8 GiB of 46 GiB)
Wrote ~/.dsh/neutered/config.json and ~/.dsh/neutered/overlay.yml
Ready. Run: neutered/bin/dsh-neutered -- "your task"
```

The only prompt is the model choice. `--yes` accepts the recommendation without a prompt;
`--model <id>` and `--context <n>` preselect. If `~/.dsh/neutered/config.json` is missing when a
task is run, the wrapper runs setup first, then the task.

## 5. Components

All new files live under `neutered/`. `$DSH_HOME` defaults to `~/.dsh`, as in the product.

| Path | Kind | Responsibility | Depends on |
|---|---|---|---|
| `neutered/bin/install` | bash | Automatic setup: platform check, Node and pnpm check, `pnpm install --frozen-lockfile`, `pnpm run build`, then `dsh-neutered setup`. | git, node ≥ 22, corepack or pnpm |
| `neutered/bin/dsh-neutered` | bash (existing) | Adds subcommands `setup`, `settings`, flag `--keep-server`; auto-setup when config is missing; server lifecycle around the task; second `--patch` for the generated overlay. | `neutered/setup/setup.cjs` |
| `neutered/setup/setup.cjs` | node entry | Subcommands: `setup [--yes] [--model <id>] [--context <n>] [--force]`, `settings [--show] [--model <id>] [--context <n>] [--keep-server on\|off] [--stop-server] [--reset]`, `server ensure\|stop\|status`, `overlay-path`. Prints for humans on stdout; machine-readable values only where the wrapper needs them (`server ensure` prints `external`, `started <pid>`, or `started-keep <pid>` when the configuration says to leave the server running). | lib/* |
| `neutered/setup/lib/hardware.cjs` | node lib | macOS probe: `sysctl -n hw.memsize`, `machdep.cpu.brand_string`, `hw.optional.arm64`, GPU core count from `system_profiler SPDisplaysDataType -json` (optional, informational). Returns `{ ramBytes, chip, appleSilicon, gpuCores }`. Pure `budget(hw, env)` function. | child_process |
| `neutered/setup/lib/gguf-header.cjs` | node lib | Reads GGUF v2/v3 metadata from the first 16 MiB of a file: architecture, `block_count`, `context_length`, `attention.head_count`, `attention.head_count_kv`, `attention.key_length`, `attention.value_length`, `embedding_length`, `full_attention_interval` when present, `split.count`. No tensor data is read. | fs |
| `neutered/setup/lib/sizing.cjs` | node lib (pure) | `kvBytesPerToken(meta)`, `chooseContext(meta, fileBytes, budgetBytes)`, `rankCatalog(catalog, budgetBytes)`. No I/O. | — |
| `neutered/setup/lib/catalog.cjs` | node lib | Loads and validates `catalog.json`; resolves the custom escape hatch into the same entry shape. | fs |
| `neutered/setup/catalog.json` | data | The curated list (section 7). | — |
| `neutered/setup/lib/config.cjs` | node lib | Reads and writes `$DSH_HOME/neutered/config.json`; renders `$DSH_HOME/neutered/overlay.yml` from it (hand-emitted YAML, no library). Pure `renderOverlay(config)` plus thin fs wrappers. | fs |
| `neutered/setup/lib/download.cjs` | node lib | Installs llama.cpp with `brew install llama.cpp` when `llama-server` is not on PATH (an existing install is used as is); downloads GGUF files with `hf download <repo> <file> --local-dir <dir>` when `hf` is on PATH, else `curl -fL -C - --retry 5` to the same URL; verifies the byte size against the catalog and, when the catalog carries one, the SHA-256. | child_process, fs |
| `neutered/setup/lib/server.cjs` | node lib | `status()` probes `GET http://127.0.0.1:1234/health` and `/v1/models`; `ensure(config)` returns `external` when healthy, else spawns `llama-server` detached (new session, stdio to `$DSH_HOME/neutered/llama-server.log`, `unref`), writes `server.pid`, polls `/health` up to `startTimeoutMs` (default 600000; large models load slowly), and returns `started <pid>`; `stop()` kills the pid in `server.pid` only if that process is still `llama-server` with the same start time, then removes the file. | child_process, http |
| `neutered/setup/lib/prompt.cjs` | node lib | Single-question TTY prompt with default; returns the default immediately when stdin is not a TTY or `--yes` is set. | readline |
| `neutered/setup/verify-catalog.cjs` | dev script | Maintenance only, network-using: queries `https://huggingface.co/api/models/<repo>/tree/main` and refreshes `sizeBytes`, `sha256` and split counts in `catalog.json`. Not a test, never run by any gate. | https |
| `neutered/setup/test/*.test.cjs` | node --test | Unit tests for the pure functions with fixture headers and fake probes (section 16). | node:test |
| `neutered/setup/README.md` | doc | What setup does, what it downloads, the posture note, how to audit it. | — |
| `neutered/docs/2026-09-04-first-run-setup-design.md` | doc | This document. | — |

Interfaces between the wrapper and Node are three calls: `server ensure` (before the task),
`server stop` (after it, only when `ensure` said `started`), and `overlay-path` (to pass the
generated overlay). Everything else is human-facing.

## 6. Hardware detection and memory budget

Probe (macOS only):

- `sysctl -n hw.memsize` → RAM in bytes.
- `sysctl -n hw.optional.arm64` → `1` on Apple Silicon (unified memory: the GPU can address most
  of RAM). `0` means an Intel Mac: warn that inference will be CPU-only and slow, continue.
- `sysctl -n machdep.cpu.brand_string` → display string, for example `Apple M4 Max`.
- GPU core count from `system_profiler SPDisplaysDataType -json` → informational only.

Budget for model weights plus KV cache, in bytes:

```
gpuCap   = appleSilicon ? (ram >= 36 GiB ? 0.75 : 0.67) * ram : 0.50 * ram
headroom = min(2 GiB, ram / 8)    # for dsh itself and the OS
budget   = gpuCap - headroom
```

The 0.75 / 0.67 factors are macOS's default GPU working-set limit for machines above and below
36 GiB. `DSH_NEUTERED_BUDGET_GIB=<n>` overrides `budget` for people who raised
`iogpu.wired_limit_mb` or want a safety margin. Budgets: 16 GiB → 8.72 GiB; 32 GiB → 19.44 GiB;
64 GiB → 46 GiB; 128 GiB → 94 GiB.

## 7. Model catalog

`neutered/setup/catalog.json` is an array of entries:

```json
{
  "id": "qwen3.8-27b-q4",
  "name": "Qwen3.8-27B UD-Q4_K_XL",
  "repo": "unsloth/Qwen3.8-27B-GGUF",
  "files": ["Qwen3.8-27B-UD-Q4_K_XL.gguf"],
  "sizeBytes": 17000000000,
  "sha256": [],
  "nativeContext": 262144,
  "tags": ["recommended", "dense"],
  "serverArgs": ["--temp", "0.7", "--top-p", "0.8", "--top-k", "20", "--min-p", "0", "--presence-penalty", "1.5"],
  "notes": "Qwen's 27B generalist; strongest coding quality per GB in the list."
}
```

`files[0]` is the file passed to `llama-server -m`; further entries are split shards that must be
downloaded next to it. `sizeBytes` is the total of all files. `sha256` is parallel to `files` and
may be empty. `pinned` (boolean, default false) says whether `sizeBytes` and `sha256` were written
by the maintenance script; a pinned entry is verified byte-exact after download, an unpinned one
within ±10 percent. `serverArgs` are the vendor's recommended sampling defaults; a request's own
parameters still win.

Seed entries, values as published on 2026-09-04 (the maintenance script pins exact bytes and
hashes before the first release):

| id | repo / file | size | native ctx | tags |
|---|---|---|---|---|
| `qwen3.8-27b-q4` | `unsloth/Qwen3.8-27B-GGUF` / `Qwen3.8-27B-UD-Q4_K_XL.gguf` | ≈17 GB | 262144 | recommended, dense |
| `qwen3.8-27b-q8` | `unsloth/Qwen3.8-27B-GGUF` / `Qwen3.8-27B-Q8_0.gguf` | ≈29 GB | 262144 | quality, dense |
| `qwen3.8-27b-iq3` | `unsloth/Qwen3.8-27B-GGUF` / `Qwen3.8-27B-UD-IQ3_XXS.gguf` | ≈12 GB | 262144 | small, dense |
| `qwen3.6-35b-a3b-q4` | `unsloth/Qwen3.6-35B-A3B-GGUF` / `Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf` | ≈28 GB | 262144 | fast, moe |
| `qwen3-coder-next-q4` | `unsloth/Qwen3-Coder-Next-GGUF` / `Qwen3-Coder-Next-UD-Q4_K_XL.gguf` | ≈46 GB | 262144 | coder, moe |
| `gpt-oss-20b` | `ggml-org/gpt-oss-20b-GGUF` / `gpt-oss-20b-mxfp4.gguf` | 12.1 GB | 131072 | small, moe |
| `gpt-oss-120b` | `ggml-org/gpt-oss-120b-GGUF` / `gpt-oss-120b-mxfp4-*.gguf` (split) | 63.4 GB | 131072 | large, moe |
| `qwen3.5-9b-q4` | `unsloth/Qwen3.5-9B-GGUF` / `Qwen3.5-9B-UD-Q4_K_XL.gguf` | ≈6 GB | 262144 | small, dense |

Ranking (`rankCatalog`): an entry *fits* when `sizeBytes + allowance <= budget`, where
`allowance = clamp(sizeBytes / 4, 1 GiB, 3 GiB)` stands in for a 32k KV cache and compute
buffers before the header is available. Fitting entries are ordered:
the `recommended` tag first, then the rest by descending `sizeBytes`. The first fitting entry is
the default answer. Non-fitting entries are listed under "Too large for this machine" and cannot
be chosen except through `--model` with `--force`.

Custom escape hatch: `repo:file` downloads exactly that file into the models directory;
a local path is used in place. Both become a synthetic entry with `sizeBytes` from the file,
`nativeContext` from the header, no `serverArgs`.

## 8. Context sizing

After download, `gguf-header.cjs` reads the model's metadata and `sizing.cjs` computes:

```
attnLayers      = full_attention_interval ? floor(block_count / full_attention_interval) : block_count
keyLen          = attention.key_length   ?? embedding_length / attention.head_count
valueLen        = attention.value_length ?? keyLen
kvBytesPerToken = attnLayers * head_count_kv * (keyLen + valueLen) * 2      # f16 K and V
fits(ctx)       = fileBytes + ctx * kvBytesPerToken + 1 GiB + ctx * 4096 <= budget
contextWindow   = max ctx in [32768, 65536, 131072, 262144] with ctx <= nativeContext and fits(ctx)
```

The `1 GiB + ctx * 4096` term approximates llama.cpp's compute buffers. Hybrid Qwen3.5-family
models publish `full_attention_interval` (only every n-th layer keeps a KV cache); gpt-oss's
sliding-window layers are counted in full, which overestimates and is therefore safe. If not even
32768 fits, setup reports the shortfall and offers the next smaller model instead of writing a
configuration. `--context <n>` overrides the computed value; values above `nativeContext` are
refused, values that do not fit print a warning and are accepted.

The same value goes to `llama-server -c <n>` and to the overlay's `contextWindow`, so dsh's
compaction and the server's cache agree. `maxTokens` is `min(32768, contextWindow / 4)`.

## 9. Configuration and generated overlay

`$DSH_HOME/neutered/config.json` (created by setup, edited by settings):

```json
{
  "version": 1,
  "model": {
    "id": "qwen3.8-27b-q4",
    "name": "Qwen3.8-27B UD-Q4_K_XL",
    "path": "/Users/m/.dsh/neutered/models/Qwen3.8-27B-UD-Q4_K_XL.gguf",
    "nativeContext": 262144,
    "serverArgs": ["--temp", "0.7", "--top-p", "0.8", "--top-k", "20", "--min-p", "0", "--presence-penalty", "1.5"]
  },
  "contextWindow": 131072,
  "maxTokens": 32768,
  "server": { "keep": false, "startTimeoutMs": 600000, "extraArgs": [] },
  "hardware": { "chip": "Apple M4 Max", "ramBytes": 68719476736, "budgetBytes": 48318382080 },
  "createdAt": "2026-09-04T18:00:00Z"
}
```

`$DSH_HOME/neutered/overlay.yml`, rendered from it and passed as the second `--patch`
(after `neutered/offline.patch.yml`, so it wins):

```yaml
# Generated by dsh-neutered setup on 2026-09-04T18:00:00Z. Edit config.json and run
# `dsh-neutered settings` instead of editing this file.
- id: llm-local
  config:
    defaultContextWindow: 131072
    maxTokens: 32768
    streamIdleTimeoutMs: 1800000
    models:
      - id: local
        name: Qwen3.8-27B UD-Q4_K_XL
        contextWindow: 131072
        maxTokens: 32768
```

The model id stays `local` so the base bundle's `agent-default-model` (`provider: local`,
`model: local`) needs no change; llama-server ignores the request's model name when it serves a
single model. `streamIdleTimeoutMs` is raised from the code default of 300000 because a 100k-token
prefill on a laptop takes minutes. Other directories: `$DSH_HOME/neutered/models/` for GGUF files,
`llama-server.log`, `server.pid`.

`neutered/offline.patch.yml` stays tracked and unchanged in content; its comment is updated to
say the generated overlay overrides it.

## 10. Server lifecycle

`dsh-neutered -- <task>`:

1. If `config.json` is missing → run `setup` (interactive on a TTY; otherwise the recommendation
   is accepted automatically).
2. `server ensure`: `GET /health` on `127.0.0.1:1234`. Healthy → `external`, nothing to stop later.
   Silent → spawn
   `llama-server --host 127.0.0.1 --port 1234 -m <path> -c <ctx> -ngl 99 --jinja <serverArgs> <extraArgs>`
   detached (own session, stdout and stderr to `llama-server.log`, `unref`), record `server.pid`,
   poll `/health` every second until 200 or `startTimeoutMs`. Print one progress line per 10 s
   ("loading model … 40 s").
3. Run dsh as a child (not `exec`, so the wrapper can clean up), with the guard in `NODE_OPTIONS`
   and both `--patch` files.
4. On exit or any signal: if `ensure` said `started` and `--keep-server` was not given and
   `server.keep` is false, `server stop`. Exit with dsh's status.

Detached spawn matters for the dynamic gate: `egress-capture.sh` walks the wrapper's process tree
with `pgrep -P` and would otherwise see the server's accepted sockets (`127.0.0.1:<ephemeral>`) as
offending peers. A detached server is reparented to launchd and stays outside that tree; the gate
keeps running against an already-started server as it does today, and the gate README notes the
detached-spawn contract.

`dsh-neutered settings` never touches a running server; it prints "restart the server to apply"
when the model or context changed and `server status` says a server started by us is running.
`dsh-neutered settings --stop-server` stops one we started (for `--keep-server` users).

## 11. Wrapper command grammar

```
dsh-neutered [--dsh <path>] [--dry-run] [--keep-server] [-- <task text and dsh args>]
dsh-neutered setup    [--yes] [--model <id>] [--context <n>] [--force]
dsh-neutered settings [--show] [--model <id>] [--context <n>] [--keep-server on|off] [--stop-server] [--reset]
dsh-neutered -h | --help
```

Exit codes: 0 success; 2 usage error (unchanged, including the rejected `-p` and `--web`);
3 setup incomplete or download failed; 4 server failed to start (log path printed); otherwise
dsh's own code. `--dry-run` prints `NODE_OPTIONS`, both `--patch` paths and the `llama-server`
command it would run (or `server: external`). The `-h` text keeps naming `127.0.0.1:1234` and
gains one paragraph about setup and the network exception.

The wrapper computes a guard-free `NODE_OPTIONS` for setup calls by removing its own
`--require=<guard>` token; any user-provided `NODE_OPTIONS` passes through both ways.

## 12. `neutered/bin/install`

```
bash neutered/bin/install [--no-setup] [--yes]
```

1. Refuse anything but Darwin with "dsh-neutered supports macOS only" (exit 2). Warn on x86_64.
2. Require `git` and `node` ≥ 22.19 (print the Homebrew command otherwise, exit 3).
3. Ensure `pnpm` 11: use it if on PATH, else `corepack enable && corepack prepare pnpm@11.7.0 --activate`.
4. From the repository root: `pnpm install --frozen-lockfile`, then `pnpm run build`.
5. Unless `--no-setup`: `neutered/bin/dsh-neutered setup` (forwarding `--yes`).
6. Print the run command and, when `/opt/homebrew/bin` is writable, print a one-line
   `ln -s` suggestion instead of linking silently.

The installer is idempotent; rerunning it rebuilds and, if config exists, prints the current
settings instead of asking again.

## 13. Gates and inventory

- `neutered/gate/egress-grep.sh`: add `-g '!neutered/setup/**'` to `common_excludes` and
  `prim_excludes`; update the header comment to four allowed roots. `neutered/setup/test/**`
  was already excluded by the `test/**` glob.
- `neutered/gate/forbidden-patterns.txt`: add `huggingface\.co` to DESTINATIONS (it is not
  listed today) with a comment that its only legal occurrence is under `neutered/setup/`,
  which the scan excludes by path. The gate then proves no product source or dependency
  reaches Hugging Face.
- `neutered/gate/README.md`: fourth allowed root; detached-server contract for the capture gate.
- `neutered/INVENTORY.md`: new action `setup-only` in the legend; Table 1 rows for
  `neutered/setup/lib/download.cjs` (huggingface.co, Homebrew) and `neutered/setup/lib/server.cjs`
  (loopback `127.0.0.1:1234`, `keep-loopback`); Table 4 row for `neutered/setup/verify-catalog.cjs`.
- Baselines: `neutered/gate/baseline-neutered.txt` must stay unchanged; the new path is excluded,
  not baselined.
- `neutered/PROGRESS.md`: a "Step 8 — first-run setup" section and decisions D17–D21 recording
  section 2 of this document.

## 14. Documentation

- Root `README.md`: replaced by the fork's page: one paragraph on what it is and is not, the
  five-line quick start from section 4, the posture summary (three enforcement layers plus the
  setup exception), hardware guidance (which catalog entries fit 16 / 32 / 64 / 128 GiB), links to
  `neutered/README.md`, `neutered/setup/README.md`, `SAFETY.md` and the upstream project. The
  upstream README is reachable in history at `05def55a68`.
- `README.zh.md` and `README.i18n.yaml`: removed; the fork does not maintain translations.
  The translation pairing script must tolerate the missing pair; if it does not, the plan adds
  a task to adjust it.
- `neutered/README.md`: "Run" section rewritten around `install`, `setup`, `settings`; new
  "Network exception" subsection; audit list gains the setup tests.
- `neutered/setup/README.md`: new.

## 15. Error handling

| Situation | Behaviour |
|---|---|
| Not macOS | `install` and `setup` exit 2 with one line. |
| No Homebrew | Setup prints the Homebrew install one-liner and exits 3; nothing is written. |
| `brew install llama.cpp` fails | Exit 3 with brew's last 20 lines. |
| Download interrupted | Rerun resumes (`hf` cache or `curl -C -`); size mismatch after completion deletes the partial file and exits 3. |
| Model too large after header read | Report weights, KV at 32k, budget; offer the next smaller catalog entry; do not write config. |
| Port 1234 busy but `/health` not 200 | Exit 4: "something else is listening on 127.0.0.1:1234"; never kill an unknown process. |
| Server start timeout | Exit 4, print log path, stop the process we started. |
| `server.pid` stale | `stop` verifies the pid is a `llama-server` with the recorded start time before signalling; otherwise just removes the file. |
| dsh killed by signal | Trap runs `server stop` when we started the server; exit code propagated. |
| stdin is not a TTY | The recommendation is accepted automatically, exactly as with `--yes`; when nothing fits, exit 3 names the `--model owner/repo:file.gguf` form to use. |

## 16. Testing

Unit (`node --test 'neutered/setup/test/**/*.test.cjs'`, offline, fast):

- `sizing`: kvBytesPerToken for a dense fixture, a `full_attention_interval` fixture and a
  fixture lacking `key_length`; `chooseContext` picks 262144 for the 64 GiB example, 32768 for
  the same 17 GB model on a 32 GiB machine's budget; returns null when nothing fits; respects
  `nativeContext`.
- `gguf-header`: parses a hand-built minimal GGUF v3 header (written by the test) with string,
  uint32 and array values; rejects a bad magic.
- `hardware.budget`: 16 / 32 / 64 / 128 GiB, Intel path, env override.
- `catalog`: validates seed entries (unique ids, files non-empty, sizeBytes > 0, tags known);
  `rankCatalog` ordering and the "too large" partition; custom `repo:file` and local path
  resolution.
- `config.renderOverlay`: exact YAML string for the example config; round-trip read/write in a
  temporary `DSH_HOME`.
- `server`: with a fake `/health` HTTP server on an ephemeral port injected as the endpoint,
  `status` reports healthy; `stop` with a stale pid file only removes the file.

Contract (`bash neutered/bin/test/dsh-neutered.test.sh`, extended): `setup -h`, `settings -h`
exit 0; `--dry-run` with a temporary `DSH_HOME` containing a config shows both `--patch` paths and
the `llama-server` line; `--dry-run` without config shows `setup` would run; unknown flags still
exit 2; the wrapper still carries no `-p` or allowlist surface.

Gates: `bash neutered/gate/egress-grep.sh` exit 0 with unchanged baselines;
`node --test 'neutered/guard/test/**/*.test.cjs'` unchanged; `pnpm run build` exit 0;
`egress-capture.sh` PASS against a running server.

Manual acceptance on this machine (64 GiB M4 Max): `bash neutered/bin/install` from a fresh
clone of the branch in a temporary directory, accept the default model, run one task, confirm the
server started and stopped, run `settings --context 65536`, confirm the overlay changed.

## 17. Work split

Per the 2026-09-04 rule (dsh does exact old→new edits; Claude writes new files):

**Claude authors:** `neutered/setup/**` (all scripts, catalog, tests, README), `neutered/bin/install`,
the new root `README.md`, this design document, the plan.

**dsh applies (prompts of at most 6 exact replacements each, one file per prompt, run in the
checkout with the slow-prefill preload):** the wrapper's subcommand dispatch and server lifecycle
edits (given as exact blocks), the wrapper test additions, the two gate script edits, the gate
README and forbidden-patterns comments, INVENTORY.md legend and rows, `offline.patch.yml`
comment, `neutered/README.md` sections, PROGRESS.md step and decisions, removal of references to
the two deleted translation files.

**Claude verifies** every dsh edit by diff and by running the relevant test or gate before commit.

## 18. Related work: the llama sidecar branch

Branch `worktree-llama-sidecar` (commit `64715244cd`, also based on `05def55a68`, written by
another session on 2026-09-04) vendors a pinned `llama-server` under `neutered/llama/` and gives
the wrapper `--model` / `--ctx` flags with its own start-and-stop lifecycle. Marco decided on
2026-09-05 to build this design independently and merge the two afterwards. The plan's merge
notes list the overlapping files and the intended resolution: the sidecar's lifecycle and pinned
binary win, this design's setup, catalog, sizing, configuration and generated overlay feed them,
and setup downloads the pinned tarball instead of installing through Homebrew.

## 19. Out of scope

Linux and Windows; multiple concurrent models; a `doctor` command; KV-cache quantisation flags;
speculative decoding; changing the port or the loopback address; any UI; publishing to npm or
Homebrew; CI workflow updates (frozen per D8).
