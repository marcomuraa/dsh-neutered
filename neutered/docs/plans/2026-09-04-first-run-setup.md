# dsh-neutered First-Run Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh macOS clone of dsh-neutered becomes usable with one install command and one model choice: hardware detection, curated model catalog, llama.cpp and model download, context sizing from the GGUF header, a settings command, and a wrapper that starts and stops `llama-server` around each task.

**Architecture:** Plain CommonJS scripts under `neutered/setup/` (zero dependencies, no build step) called from the existing bash wrapper `neutered/bin/dsh-neutered`. Setup writes `$DSH_HOME/neutered/config.json` and renders `$DSH_HOME/neutered/overlay.yml`, which the wrapper passes as a second `--patch`. The static egress gate excludes `neutered/setup/**` by path; the runtime posture (guard, Seatbelt, loopback-only) is unchanged.

**Tech Stack:** Node 22+ (`node:test`, `node:http`, `node:child_process`), bash 3.2 compatible shell, Homebrew `llama.cpp`, Hugging Face `hf` CLI or `curl`.

**Spec:** `neutered/docs/2026-09-04-first-run-setup-design.md`

## Global Constraints

- macOS only. Setup refuses other platforms with exit 2. Apple Silicon first-class; Intel Macs warn and continue.
- Every new file lives under `neutered/`. No changes to `apps/cli/src` or `packages/**`.
- No npm dependencies. Setup scripts are `.cjs`, runnable with the system `node` before any build.
- The only network destinations in the tree outside `neutered/setup/lib/download.cjs` and `neutered/setup/verify-catalog.cjs` stay as today. `download.cjs` may reach `https://huggingface.co/<repo>/resolve/main/<file>` and run `brew install llama.cpp`; nothing else.
- The task path (`dsh-neutered -- ...`) never downloads. `llama-server` is started with `-m <local path>`, never `-hf`.
- Setup processes run without the guard; the task path keeps `NODE_OPTIONS=--require=<guard>` exactly as today.
- Exit codes: 0 ok; 2 usage; 3 setup incomplete or download failed; 4 server failed to start; else dsh's own code.
- Bash scripts must run under macOS `/bin/bash` 3.2: no `${arr[@]}` on an empty array under `set -u` without the `${arr[@]+"${arr[@]}"}` idiom, no associative arrays, no `mapfile`.
- Prose in files is normal English (docs, comments, commit messages).
- Budget formula: `gpuCap = appleSilicon ? (ram >= 36 GiB ? 0.75 : 0.67) * ram : 0.5 * ram`; `budget = gpuCap - min(2 GiB, ram / 8)`; env override `DSH_NEUTERED_BUDGET_GIB`.
- Context steps `[32768, 65536, 131072, 262144]`; `maxTokens = min(32768, floor(ctx / 4))`; `streamIdleTimeoutMs` in the overlay is `1800000`.
- Commit after every task on the worktree branch `worktree-neutered-setup`. Never push (the only remote is upstream).

## Work split and the dsh delegation protocol

Claude authors every new file (Tasks 1–8, 10, 13 new files). dsh applies exact old→new edits to
existing files (Tasks 9, 11, 12, 13 edits). Rules from the 2026-09-04 session:

- One file per dsh prompt, at most 6 replacements, each given as `OLD:` block → `NEW:` block with
  a neighbour line included so deletions never read "replace with nothing".
- Prompt preamble, verbatim: "Read the target file once, then apply the replacements below in
  order. Do not reformat other lines. Do not run tests. Tool-call budget: <edits + 2>."
- Invocation from the worktree root, LM Studio serving on 127.0.0.1:1234:

```bash
cd /Users/m/Documents/dsh_neutered/dsh-neutered/.claude/worktrees/neutered-setup
NODE_OPTIONS="--require=$HOME/.dsh/preload/slow-prefill.cjs" dsh --profile headless "$(cat /Users/m/.claude/jobs/a30e340d/tmp/prompt-<task>.txt)"
```

- After each prompt: `git diff --stat` and `git diff <file>`; the diff must contain only the
  listed replacements. Then run the task's verification. If a dsh prompt fails twice (nothing
  applied, or unrelated lines changed), apply the edits directly with the Edit tool and note
  "applied directly" in the commit body.

## File structure

New files (Claude):

| Path | Responsibility |
|---|---|
| `neutered/setup/lib/sizing.cjs` | Pure memory arithmetic: KV bytes per token, context choice, catalog ranking. |
| `neutered/setup/lib/hardware.cjs` | macOS probe (`sysctl`, `system_profiler`) and the budget formula. |
| `neutered/setup/lib/gguf-header.cjs` | Sequential GGUF v2/v3 metadata parser and geometry extraction. |
| `neutered/setup/lib/catalog.cjs`, `neutered/setup/catalog.json` | Curated model list, validation, custom `repo:file` or local path resolution. |
| `neutered/setup/lib/config.cjs` | `$DSH_HOME/neutered` paths, config read/write, overlay rendering. |
| `neutered/setup/lib/server.cjs` | `/health` probe, detached `llama-server` spawn, pid-file stop. |
| `neutered/setup/lib/prompt.cjs` | One-question TTY prompt with default and `--yes`. |
| `neutered/setup/lib/download.cjs` | Homebrew install of llama.cpp, `hf`/`curl` model download, size and SHA-256 checks. |
| `neutered/setup/setup.cjs` | CLI entry: `setup`, `settings`, `server ensure|stop|status|plan`, `overlay-path`. |
| `neutered/setup/verify-catalog.cjs` | Maintenance script that pins sizes and hashes from the Hugging Face API. |
| `neutered/setup/test/*.test.cjs` | `node --test` suites for every lib. |
| `neutered/setup/README.md` | What setup does and downloads; how to audit it. |
| `neutered/bin/install` | Automatic setup for a fresh clone. |
| `README.md` (root, replaced) | The fork's GitHub page. |

Modified files (dsh unless noted): `neutered/bin/dsh-neutered`, `neutered/bin/test/dsh-neutered.test.sh`,
`neutered/gate/egress-grep.sh`, `neutered/gate/forbidden-patterns.txt`, `neutered/gate/README.md`,
`neutered/INVENTORY.md`, `neutered/offline.patch.yml`, `neutered/README.md`, `neutered/PROGRESS.md`,
`scripts/translation-pairing.manifest.json`. Deleted (Claude): `README.zh.md`, `README.i18n.yaml`.

Running the setup tests: `node --test 'neutered/setup/test/**/*.test.cjs'` (quote the glob; on
Node 25 a bare directory path is treated as one file).

---

### Task 1: Sizing arithmetic

**Files:**
- Create: `neutered/setup/lib/sizing.cjs`
- Test: `neutered/setup/test/sizing.test.cjs`

**Interfaces:**
- Produces: `GIB`, `CONTEXT_STEPS`, `kvBytesPerToken(geom)`, `memoryFor(geom, fileBytes, ctx)`, `fitsContext(geom, fileBytes, budgetBytes, ctx)`, `chooseContext(geom, fileBytes, budgetBytes, steps?) → { contextWindow, kvBytes, totalBytes } | null`, `maxTokensFor(ctx)`, `preHeaderAllowance(sizeBytes)`, `rankCatalog(entries, budgetBytes) → { fits, tooLarge }`, `formatGiB(bytes)`.
- `geom` shape (from Task 3): `{ blockCount, contextLength, embeddingLength, headCount, headCountKv: number | number[], keyLength, valueLength, fullAttentionInterval }`.

- [ ] **Step 1: Write the failing tests**

```js
// neutered/setup/test/sizing.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { GIB, kvBytesPerToken, chooseContext, maxTokensFor, rankCatalog, preHeaderAllowance } = require('../lib/sizing.cjs')

const HYBRID = { blockCount: 64, fullAttentionInterval: 4, headCountKv: 8, keyLength: 128, valueLength: 128, contextLength: 262144 }
const DENSE = { blockCount: 48, headCountKv: 4, keyLength: 128, valueLength: 128, contextLength: 262144 }
const BUDGET_64 = 46 * GIB // 64 GiB Apple Silicon machine
const BUDGET_32 = 20873541058 // 32 GiB Apple Silicon machine
const BUDGET_16 = 9363028705 // 16 GiB Apple Silicon machine

test('kvBytesPerToken: dense model counts every layer', () => {
  assert.equal(kvBytesPerToken(DENSE), 48 * 4 * 256 * 2)
})

test('kvBytesPerToken: hybrid model counts only full-attention layers', () => {
  assert.equal(kvBytesPerToken(HYBRID), 16 * 8 * 256 * 2)
})

test('kvBytesPerToken: derives head size from embedding_length when key_length is absent', () => {
  assert.equal(kvBytesPerToken({ blockCount: 32, headCountKv: 8, headCount: 32, embeddingLength: 4096 }), 32 * 8 * 256 * 2)
})

test('kvBytesPerToken: per-layer head_count_kv arrays are summed', () => {
  assert.equal(kvBytesPerToken({ blockCount: 4, headCountKv: [8, 0, 8, 0], keyLength: 128, valueLength: 128 }), 16 * 256 * 2)
})

test('kvBytesPerToken: rejects geometry without layers', () => {
  assert.throws(() => kvBytesPerToken({ headCountKv: 8, keyLength: 128 }), /blockCount/)
})

test('chooseContext: 17 GB hybrid model on a 64 GiB machine takes the native 262144', () => {
  const choice = chooseContext(HYBRID, 17e9, BUDGET_64)
  assert.equal(choice.contextWindow, 262144)
  assert.equal(choice.kvBytes, 262144 * 65536)
  assert.equal(choice.totalBytes, 17e9 + 262144 * 65536 + GIB + 262144 * 4096)
})

test('chooseContext: same model on a 32 GiB machine drops to 32768', () => {
  assert.equal(chooseContext(HYBRID, 17e9, BUDGET_32).contextWindow, 32768)
})

test('chooseContext: returns null when even 32768 does not fit', () => {
  assert.equal(chooseContext(DENSE, 12.1e9, BUDGET_16), null)
})

test('chooseContext: never exceeds the native context', () => {
  assert.equal(chooseContext({ ...DENSE, contextLength: 131072 }, 1e9, 100 * GIB).contextWindow, 131072)
})

test('maxTokensFor: a quarter of the window, capped at 32768', () => {
  assert.equal(maxTokensFor(262144), 32768)
  assert.equal(maxTokensFor(32768), 8192)
})

test('preHeaderAllowance: a quarter of the file, clamped to 1..3 GiB', () => {
  assert.equal(preHeaderAllowance(2e9), GIB)
  assert.equal(preHeaderAllowance(8e9), 2e9)
  assert.equal(preHeaderAllowance(46e9), 3 * GIB)
})

const CATALOG = [
  { id: 'a-q8', sizeBytes: 29e9, tags: ['quality'] },
  { id: 'a-q4', sizeBytes: 17e9, tags: ['recommended'] },
  { id: 'big', sizeBytes: 63.4e9, tags: ['large'] },
  { id: 'coder', sizeBytes: 46e9, tags: ['coder'] },
  { id: 'tiny', sizeBytes: 6e9, tags: ['small'] },
]

test('rankCatalog: recommended first, then largest first; too-large sorted ascending', () => {
  const { fits, tooLarge } = rankCatalog(CATALOG, BUDGET_64)
  assert.deepEqual(fits.map((e) => e.id), ['a-q4', 'coder', 'a-q8', 'tiny'])
  assert.deepEqual(tooLarge.map((e) => e.id), ['big'])
})

test('rankCatalog: on 16 GiB only the small entry fits', () => {
  const { fits } = rankCatalog(CATALOG, BUDGET_16)
  assert.deepEqual(fits.map((e) => e.id), ['tiny'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: FAIL with `Cannot find module '../lib/sizing.cjs'`

- [ ] **Step 3: Write the implementation**

```js
// neutered/setup/lib/sizing.cjs
'use strict'

// Memory arithmetic for dsh-neutered setup. Pure functions, no I/O. All sizes are bytes.

const GIB = 1024 ** 3
const CONTEXT_STEPS = Object.freeze([32768, 65536, 131072, 262144])
const COMPUTE_FIXED_BYTES = GIB
const COMPUTE_PER_TOKEN_BYTES = 4096
const MAX_TOKENS_CAP = 32768
const KV_BYTES_PER_ELEMENT = 2 // f16 keys and values

/** Bytes of KV cache one token costs, from the GGUF geometry (see gguf-header.cjs). */
function kvBytesPerToken(geom) {
  const layers = geom.blockCount
  if (!Number.isInteger(layers) || layers <= 0) throw new Error('kvBytesPerToken: blockCount missing')
  const keyLength =
    geom.keyLength ?? (geom.embeddingLength && geom.headCount ? geom.embeddingLength / geom.headCount : null)
  if (!keyLength) {
    throw new Error('kvBytesPerToken: key length unknown (no attention.key_length, embedding_length or head_count)')
  }
  const valueLength = geom.valueLength ?? keyLength
  const perHead = (keyLength + valueLength) * KV_BYTES_PER_ELEMENT
  if (Array.isArray(geom.headCountKv)) {
    return geom.headCountKv.reduce((sum, heads) => sum + heads * perHead, 0)
  }
  if (!Number.isInteger(geom.headCountKv) || geom.headCountKv <= 0) {
    throw new Error('kvBytesPerToken: head_count_kv missing')
  }
  const attentionLayers = geom.fullAttentionInterval ? Math.floor(layers / geom.fullAttentionInterval) : layers
  return attentionLayers * geom.headCountKv * perHead
}

/** Weights plus KV cache plus an approximation of llama.cpp's compute buffers. */
function memoryFor(geom, fileBytes, contextWindow) {
  return fileBytes + contextWindow * kvBytesPerToken(geom) + COMPUTE_FIXED_BYTES + contextWindow * COMPUTE_PER_TOKEN_BYTES
}

function fitsContext(geom, fileBytes, budgetBytes, contextWindow) {
  return memoryFor(geom, fileBytes, contextWindow) <= budgetBytes
}

/** Largest step that fits the budget and does not exceed the model's native context, or null. */
function chooseContext(geom, fileBytes, budgetBytes, steps = CONTEXT_STEPS) {
  const native = geom.contextLength ?? Infinity
  let best = null
  for (const ctx of steps) {
    if (ctx > native) break
    if (fitsContext(geom, fileBytes, budgetBytes, ctx)) best = ctx
  }
  if (best === null) return null
  return { contextWindow: best, kvBytes: best * kvBytesPerToken(geom), totalBytes: memoryFor(geom, fileBytes, best) }
}

function maxTokensFor(contextWindow) {
  return Math.min(MAX_TOKENS_CAP, Math.floor(contextWindow / 4))
}

/** Stand-in for KV cache and buffers before the model header is available. */
function preHeaderAllowance(sizeBytes) {
  return Math.min(3 * GIB, Math.max(GIB, Math.floor(sizeBytes / 4)))
}

/** Split catalog entries into those that fit the budget (ordered for display) and those that do not. */
function rankCatalog(entries, budgetBytes) {
  const fits = []
  const tooLarge = []
  for (const entry of entries) {
    if (entry.sizeBytes + preHeaderAllowance(entry.sizeBytes) <= budgetBytes) fits.push(entry)
    else tooLarge.push(entry)
  }
  const rank = (entry) => (entry.tags.includes('recommended') ? 0 : 1)
  fits.sort((a, b) => rank(a) - rank(b) || b.sizeBytes - a.sizeBytes)
  tooLarge.sort((a, b) => a.sizeBytes - b.sizeBytes)
  return { fits, tooLarge }
}

function formatGiB(bytes) {
  return `${(bytes / GIB).toFixed(1)} GiB`
}

module.exports = {
  GIB,
  CONTEXT_STEPS,
  kvBytesPerToken,
  memoryFor,
  fitsContext,
  chooseContext,
  maxTokensFor,
  preHeaderAllowance,
  rankCatalog,
  formatGiB,
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: `# pass 13`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add neutered/setup/lib/sizing.cjs neutered/setup/test/sizing.test.cjs
git commit -m "neutered: setup sizing arithmetic (KV per token, context choice, catalog ranking)"
```

---

### Task 2: Hardware probe and budget

**Files:**
- Create: `neutered/setup/lib/hardware.cjs`
- Test: `neutered/setup/test/hardware.test.cjs`

**Interfaces:**
- Consumes: `GIB` from `sizing.cjs`.
- Produces: `probe(exec?, platform?) → { platform, ramBytes, chip, appleSilicon, gpuCores }`, `budget(hw, env?) → bytes`, `describe(hw, budgetBytes) → string`, `defaultExec(cmd, args) → string`.
- `exec(cmd, args)` returns trimmed stdout or throws. Tests inject a fake.

- [ ] **Step 1: Write the failing tests**

```js
// neutered/setup/test/hardware.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { probe, budget, describe } = require('../lib/hardware.cjs')
const { GIB } = require('../lib/sizing.cjs')

function fakeExec(sysctlValues, gpuCores = '40') {
  return (cmd, args) => {
    if (cmd.endsWith('sysctl')) {
      const key = args[args.length - 1]
      if (!(key in sysctlValues)) throw new Error(`sysctl: unknown oid '${key}'`)
      return sysctlValues[key]
    }
    if (cmd.endsWith('system_profiler')) return JSON.stringify({ SPDisplaysDataType: [{ sppci_cores: gpuCores }] })
    throw new Error(`unexpected command ${cmd}`)
  }
}

const M4_MAX = { 'hw.memsize': String(64 * GIB), 'machdep.cpu.brand_string': 'Apple M4 Max', 'hw.optional.arm64': '1' }

test('probe: reads memory, chip, arm64 and GPU cores', () => {
  assert.deepEqual(probe(fakeExec(M4_MAX), 'darwin'), {
    platform: 'darwin',
    ramBytes: 64 * GIB,
    chip: 'Apple M4 Max',
    appleSilicon: true,
    gpuCores: 40,
  })
})

test('probe: an Intel Mac has no arm64 key and no Apple GPU cores', () => {
  const exec = (cmd, args) => {
    if (cmd.endsWith('sysctl') && args[1] === 'hw.memsize') return String(8 * GIB)
    if (cmd.endsWith('sysctl') && args[1] === 'machdep.cpu.brand_string') return 'Intel(R) Core(TM) i7'
    throw new Error('no such oid')
  }
  const hw = probe(exec, 'darwin')
  assert.equal(hw.appleSilicon, false)
  assert.equal(hw.gpuCores, null)
})

test('probe: refuses non-macOS platforms', () => {
  assert.throws(() => probe(fakeExec(M4_MAX), 'linux'), /macOS only/)
})

test('budget: Apple Silicon table', () => {
  const at = (gib) => budget({ ramBytes: gib * GIB, appleSilicon: true }, {})
  assert.equal(at(16), 9363028705)
  assert.equal(at(32), 20873541058)
  assert.equal(at(64), 46 * GIB)
  assert.equal(at(128), 94 * GIB)
})

test('budget: Intel Mac uses half the RAM', () => {
  assert.equal(budget({ ramBytes: 8 * GIB, appleSilicon: false }, {}), 3 * GIB)
})

test('budget: DSH_NEUTERED_BUDGET_GIB overrides the formula', () => {
  assert.equal(budget({ ramBytes: 64 * GIB, appleSilicon: true }, { DSH_NEUTERED_BUDGET_GIB: '40' }), 40 * GIB)
  assert.throws(() => budget({ ramBytes: 64 * GIB, appleSilicon: true }, { DSH_NEUTERED_BUDGET_GIB: 'lots' }), /positive number/)
})

test('describe: one line with chip, memory kind, GPU cores and budget', () => {
  const hw = probe(fakeExec(M4_MAX), 'darwin')
  assert.equal(describe(hw, 46 * GIB), 'Machine: Apple M4 Max, 64 GiB unified memory, 40 GPU cores  (usable for models: 46.0 GiB)')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: FAIL with `Cannot find module '../lib/hardware.cjs'`

- [ ] **Step 3: Write the implementation**

```js
// neutered/setup/lib/hardware.cjs
'use strict'

// macOS hardware probe and the memory budget for model weights plus KV cache.

const { execFileSync } = require('node:child_process')
const { GIB } = require('./sizing.cjs')

function defaultExec(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function sysctl(exec, key) {
  try {
    return exec('/usr/sbin/sysctl', ['-n', key])
  } catch {
    return null
  }
}

function gpuCores(exec) {
  try {
    const json = JSON.parse(exec('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json']))
    const gpu = (json.SPDisplaysDataType || [])[0] || {}
    const cores = Number(gpu.sppci_cores)
    return Number.isFinite(cores) && cores > 0 ? cores : null
  } catch {
    return null
  }
}

/** Read RAM, chip name, Apple Silicon flag and GPU core count. Throws off macOS. */
function probe(exec = defaultExec, platform = process.platform) {
  if (platform !== 'darwin') throw new Error('dsh-neutered supports macOS only')
  const ramBytes = Number(sysctl(exec, 'hw.memsize'))
  if (!Number.isFinite(ramBytes) || ramBytes <= 0) throw new Error('could not read hw.memsize')
  const appleSilicon = sysctl(exec, 'hw.optional.arm64') === '1'
  return {
    platform,
    ramBytes,
    chip: sysctl(exec, 'machdep.cpu.brand_string') || 'unknown CPU',
    appleSilicon,
    gpuCores: appleSilicon ? gpuCores(exec) : null,
  }
}

/**
 * Bytes available for weights plus KV cache. macOS lets the GPU wire about 75 % of RAM
 * on machines with 36 GiB or more and about 67 % below that; Intel Macs run on the CPU
 * and get half. A headroom of min(2 GiB, RAM / 8) is kept for dsh and the OS.
 */
function budget(hw, env = process.env) {
  const override = env.DSH_NEUTERED_BUDGET_GIB
  if (override !== undefined && override !== '') {
    const gib = Number(override)
    if (!Number.isFinite(gib) || gib <= 0) {
      throw new Error(`DSH_NEUTERED_BUDGET_GIB must be a positive number of GiB, got ${JSON.stringify(override)}`)
    }
    return Math.floor(gib * GIB)
  }
  const ram = hw.ramBytes
  const factor = hw.appleSilicon ? (ram >= 36 * GIB ? 0.75 : 0.67) : 0.5
  const headroom = Math.min(2 * GIB, ram / 8)
  return Math.floor(ram * factor - headroom)
}

function describe(hw, budgetBytes) {
  const gpu = hw.gpuCores ? `, ${hw.gpuCores} GPU cores` : ''
  const kind = hw.appleSilicon ? 'unified memory' : 'RAM (Intel Mac: CPU-only inference, expect it to be slow)'
  return `Machine: ${hw.chip}, ${Math.round(hw.ramBytes / GIB)} GiB ${kind}${gpu}  (usable for models: ${(budgetBytes / GIB).toFixed(1)} GiB)`
}

module.exports = { probe, budget, describe, defaultExec }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: `# pass 20`, `# fail 0`

- [ ] **Step 5: Sanity-check on this machine**

Run: `node -e "const h=require('./neutered/setup/lib/hardware.cjs');const hw=h.probe();console.log(h.describe(hw,h.budget(hw)))"`
Expected: `Machine: Apple M4 Max, 64 GiB unified memory, 40 GPU cores  (usable for models: 46.0 GiB)`

- [ ] **Step 6: Commit**

```bash
git add neutered/setup/lib/hardware.cjs neutered/setup/test/hardware.test.cjs
git commit -m "neutered: setup hardware probe and memory budget"
```

---

### Task 3: GGUF header reader

**Files:**
- Create: `neutered/setup/lib/gguf-header.cjs`
- Test: `neutered/setup/test/gguf-header.test.cjs`

**Interfaces:**
- Produces: `parseMetadata(readChunk) → { version, tensorCount, kv }` where `readChunk(pos, len) → Buffer`; `parseBuffer(buffer)`; `readMetadata(filePath)`; `modelGeometry(meta) → { architecture, name, blockCount, contextLength, embeddingLength, headCount, headCountKv, keyLength, valueLength, fullAttentionInterval, splitCount }`; `T` (GGUF value type codes).
- `kv` maps key → scalar, numeric array (≤ 4096 elements), or `{ arrayLength, elementType }` for skipped arrays (strings, or longer numeric arrays).

- [ ] **Step 1: Write the failing tests**

```js
// neutered/setup/test/gguf-header.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseBuffer, parseMetadata, readMetadata, modelGeometry, T } = require('../lib/gguf-header.cjs')

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
function str(s) { const bytes = Buffer.from(s, 'utf8'); return Buffer.concat([u64(bytes.length), bytes]) }
function kvU32(key, n) { return Buffer.concat([str(key), u32(T.UINT32), u32(n)]) }
function kvStr(key, s) { return Buffer.concat([str(key), u32(T.STRING), str(s)]) }
function kvBool(key, v) { return Buffer.concat([str(key), u32(T.BOOL), Buffer.from([v ? 1 : 0])]) }
function kvF32(key, v) { const b = Buffer.alloc(4); b.writeFloatLE(v); return Buffer.concat([str(key), u32(T.FLOAT32), b]) }
function kvStrArray(key, items) { return Buffer.concat([str(key), u32(T.ARRAY), u32(T.STRING), u64(items.length), ...items.map(str)]) }
function kvU32Array(key, items) { return Buffer.concat([str(key), u32(T.ARRAY), u32(T.UINT32), u64(items.length), ...items.map(u32)]) }
function gguf(kvs, version = 3, magic = 'GGUF') {
  return Buffer.concat([Buffer.from(magic), u32(version), u64(0), u64(kvs.length), ...kvs])
}

const QWEN35 = gguf([
  kvStr('general.architecture', 'qwen35'),
  kvStr('general.name', 'Qwen3.8 27B'),
  kvU32('qwen35.block_count', 64),
  kvU32('qwen35.context_length', 262144),
  kvU32('qwen35.embedding_length', 5120),
  kvU32('qwen35.attention.head_count', 32),
  kvU32('qwen35.attention.head_count_kv', 8),
  kvU32('qwen35.attention.key_length', 128),
  kvU32('qwen35.attention.value_length', 128),
  kvU32('qwen35.full_attention_interval', 4),
  kvStrArray('tokenizer.ggml.tokens', ['<s>', 'hello', '🙂']),
  kvU32Array('tokenizer.ggml.token_type', [1, 2, 3]),
  kvBool('tokenizer.ggml.add_bos_token', true),
  kvF32('qwen35.rope.freq_base', 1000000),
])

test('parseBuffer: scalars, strings, bools, floats and small numeric arrays are kept', () => {
  const meta = parseBuffer(QWEN35)
  assert.equal(meta.version, 3)
  assert.equal(meta.tensorCount, 0)
  assert.equal(meta.kv['general.architecture'], 'qwen35')
  assert.equal(meta.kv['qwen35.block_count'], 64)
  assert.equal(meta.kv['tokenizer.ggml.add_bos_token'], true)
  assert.equal(Math.round(meta.kv['qwen35.rope.freq_base']), 1000000)
  assert.deepEqual(meta.kv['tokenizer.ggml.token_type'], [1, 2, 3])
})

test('parseBuffer: string arrays are walked but not kept', () => {
  assert.deepEqual(parseBuffer(QWEN35).kv['tokenizer.ggml.tokens'], { arrayLength: 3, elementType: T.STRING })
})

test('parseMetadata: works when the source hands out tiny chunks', () => {
  const meta = parseMetadata((pos, len) => QWEN35.subarray(pos, Math.min(pos + 3, pos + len)))
  assert.equal(meta.kv['qwen35.attention.head_count_kv'], 8)
})

test('modelGeometry: extracts the architecture-prefixed keys', () => {
  assert.deepEqual(modelGeometry(parseBuffer(QWEN35)), {
    architecture: 'qwen35',
    name: 'Qwen3.8 27B',
    blockCount: 64,
    contextLength: 262144,
    embeddingLength: 5120,
    headCount: 32,
    headCountKv: 8,
    keyLength: 128,
    valueLength: 128,
    fullAttentionInterval: 4,
    splitCount: 1,
  })
})

test('modelGeometry: falls back to head_count when head_count_kv is absent', () => {
  const meta = parseBuffer(gguf([kvStr('general.architecture', 'llama'), kvU32('llama.block_count', 2), kvU32('llama.attention.head_count', 16)]))
  assert.equal(modelGeometry(meta).headCountKv, 16)
  assert.equal(modelGeometry(meta).keyLength, null)
})

test('parseBuffer: rejects a bad magic and a truncated file', () => {
  assert.throws(() => parseBuffer(gguf([], 3, 'GGML')), /not a GGUF file/)
  assert.throws(() => parseBuffer(QWEN35.subarray(0, 40)), /truncated/)
})

test('readMetadata: reads from a file on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-'))
  const file = path.join(dir, 'model.gguf')
  fs.writeFileSync(file, QWEN35)
  try {
    assert.equal(readMetadata(file).kv['qwen35.context_length'], 262144)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: FAIL with `Cannot find module '../lib/gguf-header.cjs'`

- [ ] **Step 3: Write the implementation**

```js
// neutered/setup/lib/gguf-header.cjs
'use strict'

// Sequential reader for GGUF v2/v3 metadata. Reads only the key/value header, never
// tensor data, so a 60 GB model costs a few megabytes of I/O.

const fs = require('node:fs')

const GGUF_MAGIC = 0x46554747 // the bytes "GGUF" read as a little-endian uint32
const CHUNK = 4 * 1024 * 1024
const MAX_KEPT_ARRAY = 4096
const T = Object.freeze({
  UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5, FLOAT32: 6,
  BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12,
})

class Reader {
  constructor(readChunk) {
    this.readChunk = readChunk
    this.buf = Buffer.alloc(0)
    this.filePos = 0
  }

  ensure(n) {
    while (this.buf.length < n) {
      const chunk = this.readChunk(this.filePos + this.buf.length, Math.max(CHUNK, n - this.buf.length))
      if (!chunk || chunk.length === 0) throw new Error('GGUF metadata is truncated')
      this.buf = Buffer.concat([this.buf, chunk])
    }
  }

  take(n) {
    this.ensure(n)
    const out = this.buf.subarray(0, n)
    this.buf = this.buf.subarray(n)
    this.filePos += n
    return out
  }

  u8() { return this.take(1).readUInt8(0) }
  i8() { return this.take(1).readInt8(0) }
  u16() { return this.take(2).readUInt16LE(0) }
  i16() { return this.take(2).readInt16LE(0) }
  u32() { return this.take(4).readUInt32LE(0) }
  i32() { return this.take(4).readInt32LE(0) }
  f32() { return this.take(4).readFloatLE(0) }
  u64() { return Number(this.take(8).readBigUInt64LE(0)) }
  i64() { return Number(this.take(8).readBigInt64LE(0)) }
  f64() { return this.take(8).readDoubleLE(0) }
  string() { return this.take(this.u64()).toString('utf8') }
}

function readScalar(reader, type) {
  switch (type) {
    case T.UINT8: return reader.u8()
    case T.INT8: return reader.i8()
    case T.UINT16: return reader.u16()
    case T.INT16: return reader.i16()
    case T.UINT32: return reader.u32()
    case T.INT32: return reader.i32()
    case T.FLOAT32: return reader.f32()
    case T.BOOL: return reader.u8() !== 0
    case T.STRING: return reader.string()
    case T.UINT64: return reader.u64()
    case T.INT64: return reader.i64()
    case T.FLOAT64: return reader.f64()
    default: throw new Error(`GGUF: unknown value type ${type}`)
  }
}

function readValue(reader, type) {
  if (type !== T.ARRAY) return readScalar(reader, type)
  const elementType = reader.u32()
  const count = reader.u64()
  if (elementType === T.ARRAY) throw new Error('GGUF: nested arrays are not supported')
  const keep = elementType !== T.STRING && count <= MAX_KEPT_ARRAY
  const values = keep ? [] : null
  for (let i = 0; i < count; i++) {
    const value = readScalar(reader, elementType)
    if (keep) values.push(value)
  }
  return keep ? values : { arrayLength: count, elementType }
}

/** Parse the header through `readChunk(position, length)`; returns `{ version, tensorCount, kv }`. */
function parseMetadata(readChunk) {
  const reader = new Reader(readChunk)
  const magic = reader.u32()
  if (magic !== GGUF_MAGIC) throw new Error(`not a GGUF file (magic 0x${magic.toString(16)})`)
  const version = reader.u32()
  if (version < 2 || version > 3) throw new Error(`unsupported GGUF version ${version}`)
  const tensorCount = reader.u64()
  const kvCount = reader.u64()
  const kv = {}
  for (let i = 0; i < kvCount; i++) {
    const key = reader.string()
    const type = reader.u32()
    kv[key] = readValue(reader, type)
  }
  return { version, tensorCount, kv }
}

function parseBuffer(buffer) {
  return parseMetadata((pos, len) => buffer.subarray(pos, pos + len))
}

function readMetadata(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    return parseMetadata((pos, len) => {
      const buffer = Buffer.alloc(len)
      const read = fs.readSync(fd, buffer, 0, len, pos)
      return buffer.subarray(0, read)
    })
  } finally {
    fs.closeSync(fd)
  }
}

/** The geometry sizing needs, read through the architecture prefix (`llama.block_count`, ...). */
function modelGeometry(meta) {
  const kv = meta.kv
  const architecture = kv['general.architecture']
  if (typeof architecture !== 'string') throw new Error('GGUF: general.architecture missing')
  const g = (suffix) => kv[`${architecture}.${suffix}`]
  return {
    architecture,
    name: typeof kv['general.name'] === 'string' ? kv['general.name'] : null,
    blockCount: g('block_count') ?? null,
    contextLength: g('context_length') ?? null,
    embeddingLength: g('embedding_length') ?? null,
    headCount: g('attention.head_count') ?? null,
    headCountKv: g('attention.head_count_kv') ?? g('attention.head_count') ?? null,
    keyLength: g('attention.key_length') ?? null,
    valueLength: g('attention.value_length') ?? null,
    fullAttentionInterval: g('full_attention_interval') ?? null,
    splitCount: kv['split.count'] ?? 1,
  }
}

module.exports = { T, parseMetadata, parseBuffer, readMetadata, modelGeometry }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: `# pass 27`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add neutered/setup/lib/gguf-header.cjs neutered/setup/test/gguf-header.test.cjs
git commit -m "neutered: setup GGUF header reader for model geometry"
```

---

### Task 4: Model catalog

**Files:**
- Create: `neutered/setup/catalog.json`
- Create: `neutered/setup/lib/catalog.cjs`
- Test: `neutered/setup/test/catalog.test.cjs`

**Interfaces:**
- Produces: `CATALOG_PATH`, `KNOWN_TAGS`, `validateCatalog(entries) → entries`, `loadCatalog(file?) → entries`, `findEntry(entries, id) → entry | null`, `resolveCustom(spec, { statSync? }) → entry`.
- Entry shape: `{ id, name, repo, files[], sizeBytes, sha256[], nativeContext, tags[], serverArgs[], pinned, notes?, local? }`. Custom entries have `id: 'custom'`, `tags: ['custom']`, `local: true|false`; a local entry's `files[0]` is an absolute path; a remote custom entry has `sizeBytes: null` and `nativeContext: null`.

- [ ] **Step 1: Write the catalog**

```json
[
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
    "pinned": false,
    "notes": "Qwen's 27B generalist with reasoning; the best coding quality per gigabyte in this list."
  },
  {
    "id": "qwen3.8-27b-q8",
    "name": "Qwen3.8-27B Q8_0",
    "repo": "unsloth/Qwen3.8-27B-GGUF",
    "files": ["Qwen3.8-27B-Q8_0.gguf"],
    "sizeBytes": 29000000000,
    "sha256": [],
    "nativeContext": 262144,
    "tags": ["quality", "dense"],
    "serverArgs": ["--temp", "0.7", "--top-p", "0.8", "--top-k", "20", "--min-p", "0", "--presence-penalty", "1.5"],
    "pinned": false,
    "notes": "Near-lossless 8-bit build of the same model for machines with 48 GiB or more."
  },
  {
    "id": "qwen3.8-27b-iq3",
    "name": "Qwen3.8-27B UD-IQ3_XXS",
    "repo": "unsloth/Qwen3.8-27B-GGUF",
    "files": ["Qwen3.8-27B-UD-IQ3_XXS.gguf"],
    "sizeBytes": 12000000000,
    "sha256": [],
    "nativeContext": 262144,
    "tags": ["small", "dense"],
    "serverArgs": ["--temp", "0.7", "--top-p", "0.8", "--top-k", "20", "--min-p", "0", "--presence-penalty", "1.5"],
    "pinned": false,
    "notes": "3-bit build for 24 GiB machines; noticeably weaker than the 4-bit one."
  },
  {
    "id": "qwen3.6-35b-a3b-q4",
    "name": "Qwen3.6-35B-A3B UD-Q4_K_XL",
    "repo": "unsloth/Qwen3.6-35B-A3B-GGUF",
    "files": ["Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"],
    "sizeBytes": 28000000000,
    "sha256": [],
    "nativeContext": 262144,
    "tags": ["fast", "moe"],
    "serverArgs": ["--temp", "0.7", "--top-p", "0.8", "--top-k", "20", "--min-p", "0"],
    "pinned": false,
    "notes": "Mixture of experts with 3B active parameters: much faster per token than the dense 27B."
  },
  {
    "id": "qwen3-coder-next-q4",
    "name": "Qwen3-Coder-Next UD-Q4_K_XL",
    "repo": "unsloth/Qwen3-Coder-Next-GGUF",
    "files": ["Qwen3-Coder-Next-UD-Q4_K_XL.gguf"],
    "sizeBytes": 46000000000,
    "sha256": [],
    "nativeContext": 262144,
    "tags": ["coder", "moe"],
    "serverArgs": ["--temp", "1.0", "--top-p", "0.95", "--top-k", "40", "--min-p", "0.01"],
    "pinned": false,
    "notes": "80B mixture of experts (3B active) tuned for agentic coding; needs 64 GiB."
  },
  {
    "id": "gpt-oss-20b",
    "name": "gpt-oss-20b MXFP4",
    "repo": "ggml-org/gpt-oss-20b-GGUF",
    "files": ["gpt-oss-20b-mxfp4.gguf"],
    "sizeBytes": 12100000000,
    "sha256": [],
    "nativeContext": 131072,
    "tags": ["small", "moe"],
    "serverArgs": ["--temp", "1.0", "--top-p", "1.0", "--top-k", "0"],
    "pinned": false,
    "notes": "OpenAI's open-weight 20B mixture of experts in its native 4-bit format; 128k context."
  },
  {
    "id": "gpt-oss-120b",
    "name": "gpt-oss-120b MXFP4",
    "repo": "ggml-org/gpt-oss-120b-GGUF",
    "files": [
      "gpt-oss-120b-mxfp4-00001-of-00003.gguf",
      "gpt-oss-120b-mxfp4-00002-of-00003.gguf",
      "gpt-oss-120b-mxfp4-00003-of-00003.gguf"
    ],
    "sizeBytes": 63400000000,
    "sha256": [],
    "nativeContext": 131072,
    "tags": ["large", "moe"],
    "serverArgs": ["--temp", "1.0", "--top-p", "1.0", "--top-k", "0"],
    "pinned": false,
    "notes": "OpenAI's open-weight 120B mixture of experts; needs 96 GiB or more."
  },
  {
    "id": "qwen3.5-9b-q4",
    "name": "Qwen3.5-9B UD-Q4_K_XL",
    "repo": "unsloth/Qwen3.5-9B-GGUF",
    "files": ["Qwen3.5-9B-UD-Q4_K_XL.gguf"],
    "sizeBytes": 6000000000,
    "sha256": [],
    "nativeContext": 262144,
    "tags": ["small", "dense"],
    "serverArgs": ["--temp", "0.7", "--top-p", "0.8", "--top-k", "20", "--min-p", "0"],
    "pinned": false,
    "notes": "The option for 16 GiB machines; limited but usable for small edits."
  }
]
```

File names and sizes are as published on 2026-09-04; Task 13's `verify-catalog.cjs` pins exact bytes and hashes and fails loudly on a file name that does not exist in the repository tree.

- [ ] **Step 2: Write the failing tests**

```js
// neutered/setup/test/catalog.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadCatalog, validateCatalog, findEntry, resolveCustom, CATALOG_PATH } = require('../lib/catalog.cjs')

const VALID = {
  id: 'x-q4', name: 'X Q4', repo: 'owner/X-GGUF', files: ['X-Q4.gguf'], sizeBytes: 1000, sha256: [],
  nativeContext: 32768, tags: ['recommended'], serverArgs: [], pinned: false,
}

test('loadCatalog: the shipped catalog validates and has exactly one recommended entry', () => {
  const entries = loadCatalog(CATALOG_PATH)
  assert.ok(entries.length >= 5)
  assert.equal(entries.filter((e) => e.tags.includes('recommended')).length, 1)
  assert.equal(findEntry(entries, 'qwen3.8-27b-q4').repo, 'unsloth/Qwen3.8-27B-GGUF')
  assert.equal(findEntry(entries, 'nope'), null)
})

test('validateCatalog: rejects duplicates, bad files, unknown tags, missing pinned, two recommended', () => {
  assert.throws(() => validateCatalog([VALID, { ...VALID, tags: ['small'] }]), /duplicate id/)
  assert.throws(() => validateCatalog([{ ...VALID, files: ['/abs/X.gguf'] }]), /files/)
  assert.throws(() => validateCatalog([{ ...VALID, files: ['../X.gguf'] }]), /files/)
  assert.throws(() => validateCatalog([{ ...VALID, tags: ['recommended', 'huge'] }]), /unknown tag/)
  assert.throws(() => validateCatalog([{ ...VALID, pinned: 'yes' }]), /pinned/)
  assert.throws(() => validateCatalog([VALID, { ...VALID, id: 'y' }]), /exactly one entry/)
  assert.throws(() => validateCatalog([{ ...VALID, sha256: ['a', 'b'] }]), /sha256/)
})

test('resolveCustom: owner/repo:file becomes a remote custom entry', () => {
  const entry = resolveCustom('unsloth/Qwen3.5-9B-GGUF:Qwen3.5-9B-UD-Q6_K_XL.gguf')
  assert.deepEqual(entry, {
    id: 'custom', name: 'Qwen3.5-9B-UD-Q6_K_XL', repo: 'unsloth/Qwen3.5-9B-GGUF', files: ['Qwen3.5-9B-UD-Q6_K_XL.gguf'],
    sizeBytes: null, sha256: [], nativeContext: null, tags: ['custom'], serverArgs: [], pinned: false, local: false,
  })
})

test('resolveCustom: an existing .gguf path becomes a local custom entry', () => {
  const statSync = (p) => { if (p === '/models/my.gguf') return { isFile: () => true, size: 4242 }; throw new Error('ENOENT') }
  const entry = resolveCustom('/models/my.gguf', { statSync })
  assert.equal(entry.local, true)
  assert.equal(entry.name, 'my')
  assert.equal(entry.sizeBytes, 4242)
  assert.deepEqual(entry.files, ['/models/my.gguf'])
})

test('resolveCustom: rejects empty, non-gguf and missing inputs', () => {
  const statSync = () => { throw new Error('ENOENT') }
  assert.throws(() => resolveCustom('   '), /empty/)
  assert.throws(() => resolveCustom('owner/repo:notes.txt'), /\.gguf/)
  assert.throws(() => resolveCustom('/nowhere/x.gguf', { statSync }), /neither/)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: FAIL with `Cannot find module '../lib/catalog.cjs'`

- [ ] **Step 4: Write the implementation**

```js
// neutered/setup/lib/catalog.cjs
'use strict'

// The curated model catalog and the custom escape hatch.

const fs = require('node:fs')
const path = require('node:path')

const CATALOG_PATH = path.join(__dirname, '..', 'catalog.json')
const KNOWN_TAGS = new Set(['recommended', 'dense', 'moe', 'small', 'quality', 'fast', 'coder', 'large', 'custom'])
const ID_RE = /^[a-z0-9][a-z0-9.-]*$/
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

function validFileName(file) {
  return typeof file === 'string' && file.endsWith('.gguf') && !file.startsWith('/') && !file.split('/').includes('..') && !file.split('/').includes('')
}

function validateCatalog(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('catalog: expected a non-empty array')
  const ids = new Set()
  let recommended = 0
  entries.forEach((e, i) => {
    const at = `catalog[${i}]`
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) throw new Error(`${at}: bad id ${JSON.stringify(e.id)}`)
    if (ids.has(e.id)) throw new Error(`${at}: duplicate id ${e.id}`)
    ids.add(e.id)
    if (typeof e.name !== 'string' || e.name === '') throw new Error(`${at}: name missing`)
    if (typeof e.repo !== 'string' || !REPO_RE.test(e.repo)) throw new Error(`${at}: repo must be owner/name`)
    if (!Array.isArray(e.files) || e.files.length === 0 || !e.files.every(validFileName)) {
      throw new Error(`${at}: files must be non-empty relative .gguf paths`)
    }
    if (!Number.isInteger(e.sizeBytes) || e.sizeBytes <= 0) throw new Error(`${at}: sizeBytes must be a positive integer`)
    if (!Array.isArray(e.sha256) || (e.sha256.length !== 0 && e.sha256.length !== e.files.length)) {
      throw new Error(`${at}: sha256 must be empty or parallel to files`)
    }
    if (!Number.isInteger(e.nativeContext) || e.nativeContext < 32768) throw new Error(`${at}: nativeContext must be >= 32768`)
    if (!Array.isArray(e.tags) || e.tags.length === 0 || !e.tags.every((t) => KNOWN_TAGS.has(t))) throw new Error(`${at}: unknown tag`)
    if (!Array.isArray(e.serverArgs) || !e.serverArgs.every((a) => typeof a === 'string')) throw new Error(`${at}: serverArgs must be strings`)
    if (typeof e.pinned !== 'boolean') throw new Error(`${at}: pinned must be a boolean`)
    if (e.tags.includes('recommended')) recommended++
  })
  if (recommended !== 1) throw new Error(`catalog: exactly one entry must carry the recommended tag (found ${recommended})`)
  return entries
}

function loadCatalog(file = CATALOG_PATH) {
  return validateCatalog(JSON.parse(fs.readFileSync(file, 'utf8')))
}

function findEntry(entries, id) {
  return entries.find((e) => e.id === id) || null
}

/** `owner/repo:file.gguf` becomes a remote custom entry; an existing local `.gguf` path a local one. */
function resolveCustom(spec, { statSync = fs.statSync } = {}) {
  const trimmed = String(spec || '').trim()
  if (trimmed === '') throw new Error('custom model: empty specification')
  const colon = trimmed.lastIndexOf(':')
  const looksRemote = colon > 0 && REPO_RE.test(trimmed.slice(0, colon))
  if (looksRemote) {
    const repo = trimmed.slice(0, colon)
    const file = trimmed.slice(colon + 1)
    if (!validFileName(file)) throw new Error(`custom model: '${file}' must be a relative .gguf path inside ${repo}`)
    return {
      id: 'custom', name: path.basename(file, '.gguf'), repo, files: [file], sizeBytes: null, sha256: [],
      nativeContext: null, tags: ['custom'], serverArgs: [], pinned: false, local: false,
    }
  }
  const abs = path.resolve(trimmed.replace(/^~(?=\/|$)/, process.env.HOME || ''))
  let stat
  try {
    stat = statSync(abs)
  } catch {
    throw new Error(`custom model: '${trimmed}' is neither owner/repo:file.gguf nor an existing file`)
  }
  if (!stat.isFile() || !abs.endsWith('.gguf')) throw new Error(`custom model: '${abs}' is not a .gguf file`)
  return {
    id: 'custom', name: path.basename(abs, '.gguf'), repo: null, files: [abs], sizeBytes: stat.size, sha256: [],
    nativeContext: null, tags: ['custom'], serverArgs: [], pinned: false, local: true,
  }
}

module.exports = { CATALOG_PATH, KNOWN_TAGS, validateCatalog, loadCatalog, findEntry, resolveCustom }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: `# pass 32`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add neutered/setup/catalog.json neutered/setup/lib/catalog.cjs neutered/setup/test/catalog.test.cjs
git commit -m "neutered: curated model catalog with custom escape hatch"
```

---

### Task 5: Configuration and generated overlay

**Files:**
- Create: `neutered/setup/lib/config.cjs`
- Test: `neutered/setup/test/config.test.cjs`

**Interfaces:**
- Consumes: `maxTokensFor` from `sizing.cjs`.
- Produces: `CONFIG_VERSION`, `STREAM_IDLE_TIMEOUT_MS`, `neuteredPaths(env?) → { dshHome, home, configPath, overlayPath, modelsDir, logPath, pidPath }`, `readConfig(paths) → config | null`, `buildConfig({ entry, modelPath, geometry, contextWindow, hardware, budgetBytes, now? }) → config`, `renderOverlay(config) → string`, `writeConfig(paths, config)`, `updateContext(config, contextWindow, now?) → config`.
- Config shape: `{ version: 1, model: { id, name, repo, path, nativeContext, architecture, serverArgs[] }, contextWindow, maxTokens, server: { keep, startTimeoutMs, extraArgs[] }, hardware: { chip, ramBytes, appleSilicon, budgetBytes }, createdAt, updatedAt? }`.

- [ ] **Step 1: Write the failing tests**

```js
// neutered/setup/test/config.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { neuteredPaths, readConfig, buildConfig, renderOverlay, writeConfig, updateContext } = require('../lib/config.cjs')

const ENTRY = {
  id: 'qwen3.8-27b-q4', name: 'Qwen3.8-27B UD-Q4_K_XL', repo: 'unsloth/Qwen3.8-27B-GGUF',
  files: ['Qwen3.8-27B-UD-Q4_K_XL.gguf'], sizeBytes: 17e9, sha256: [], nativeContext: 262144,
  tags: ['recommended', 'dense'], serverArgs: ['--temp', '0.7'], pinned: false,
}
const GEOM = { architecture: 'qwen35', contextLength: 262144, blockCount: 64 }
const HW = { chip: 'Apple M4 Max', ramBytes: 68719476736, appleSilicon: true }
const NOW = new Date('2026-09-04T18:00:00Z')

function example() {
  return buildConfig({ entry: ENTRY, modelPath: '/Users/m/.dsh/neutered/models/Qwen3.8-27B-UD-Q4_K_XL.gguf', geometry: GEOM, contextWindow: 131072, hardware: HW, budgetBytes: 49392123904, now: NOW })
}

test('neuteredPaths: honours DSH_HOME and defaults to ~/.dsh', () => {
  const p = neuteredPaths({ DSH_HOME: '/tmp/dshhome' })
  assert.equal(p.home, '/tmp/dshhome/neutered')
  assert.equal(p.configPath, '/tmp/dshhome/neutered/config.json')
  assert.equal(p.overlayPath, '/tmp/dshhome/neutered/overlay.yml')
  assert.equal(p.modelsDir, '/tmp/dshhome/neutered/models')
  assert.equal(p.pidPath, '/tmp/dshhome/neutered/server.pid')
  assert.equal(neuteredPaths({}).home, path.join(os.homedir(), '.dsh', 'neutered'))
})

test('buildConfig: assembles the documented shape', () => {
  assert.deepEqual(example(), {
    version: 1,
    model: {
      id: 'qwen3.8-27b-q4', name: 'Qwen3.8-27B UD-Q4_K_XL', repo: 'unsloth/Qwen3.8-27B-GGUF',
      path: '/Users/m/.dsh/neutered/models/Qwen3.8-27B-UD-Q4_K_XL.gguf', nativeContext: 262144, architecture: 'qwen35', serverArgs: ['--temp', '0.7'],
    },
    contextWindow: 131072,
    maxTokens: 32768,
    server: { keep: false, startTimeoutMs: 600000, extraArgs: [] },
    hardware: { chip: 'Apple M4 Max', ramBytes: 68719476736, appleSilicon: true, budgetBytes: 49392123904 },
    createdAt: '2026-09-04T18:00:00.000Z',
  })
})

test('renderOverlay: exact YAML for the example', () => {
  assert.equal(renderOverlay(example()), [
    '# Generated by dsh-neutered setup on 2026-09-04T18:00:00.000Z. Edit config.json and run',
    '# `dsh-neutered settings` instead of editing this file.',
    '- id: llm-local',
    '  config:',
    '    defaultContextWindow: 131072',
    '    maxTokens: 32768',
    '    streamIdleTimeoutMs: 1800000',
    '    models:',
    '      - id: local',
    '        name: "Qwen3.8-27B UD-Q4_K_XL"',
    '        contextWindow: 131072',
    '        maxTokens: 32768',
    '',
  ].join('\n'))
})

test('updateContext: recomputes maxTokens and stamps updatedAt', () => {
  const next = updateContext(example(), 32768, NOW)
  assert.equal(next.contextWindow, 32768)
  assert.equal(next.maxTokens, 8192)
  assert.equal(next.updatedAt, '2026-09-04T18:00:00.000Z')
})

test('writeConfig and readConfig round-trip in a temporary DSH_HOME', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-neutered-'))
  const p = neuteredPaths({ DSH_HOME: dir })
  try {
    assert.equal(readConfig(p), null)
    writeConfig(p, example())
    assert.deepEqual(readConfig(p), example())
    assert.equal(fs.readFileSync(p.overlayPath, 'utf8'), renderOverlay(example()))
    fs.writeFileSync(p.configPath, '{ not json')
    assert.throws(() => readConfig(p), /invalid JSON/)
    fs.writeFileSync(p.configPath, JSON.stringify({ version: 99 }))
    assert.throws(() => readConfig(p), /unsupported version 99/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: FAIL with `Cannot find module '../lib/config.cjs'`

- [ ] **Step 3: Write the implementation**

```js
// neutered/setup/lib/config.cjs
'use strict'

// $DSH_HOME/neutered/config.json and the overlay rendered from it.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { maxTokensFor } = require('./sizing.cjs')

const CONFIG_VERSION = 1
const STREAM_IDLE_TIMEOUT_MS = 1800000
const DEFAULT_START_TIMEOUT_MS = 600000

function neuteredPaths(env = process.env) {
  const dshHome = env.DSH_HOME ? env.DSH_HOME : path.join(os.homedir(), '.dsh')
  const home = path.join(dshHome, 'neutered')
  return {
    dshHome,
    home,
    configPath: path.join(home, 'config.json'),
    overlayPath: path.join(home, 'overlay.yml'),
    modelsDir: path.join(home, 'models'),
    logPath: path.join(home, 'llama-server.log'),
    pidPath: path.join(home, 'server.pid'),
  }
}

/** The stored configuration, or null when none exists yet. Corrupt files throw with the path. */
function readConfig(paths) {
  let raw
  try {
    raw = fs.readFileSync(paths.configPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  let config
  try {
    config = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${paths.configPath}: invalid JSON (${err.message}); delete it and run setup again`)
  }
  if (config.version !== CONFIG_VERSION) {
    throw new Error(`${paths.configPath}: unsupported version ${config.version}; delete it and run setup again`)
  }
  return config
}

function buildConfig({ entry, modelPath, geometry, contextWindow, hardware, budgetBytes, now = new Date() }) {
  return {
    version: CONFIG_VERSION,
    model: {
      id: entry.id,
      name: entry.name,
      repo: entry.repo,
      path: modelPath,
      nativeContext: geometry.contextLength,
      architecture: geometry.architecture,
      serverArgs: [...entry.serverArgs],
    },
    contextWindow,
    maxTokens: maxTokensFor(contextWindow),
    server: { keep: false, startTimeoutMs: DEFAULT_START_TIMEOUT_MS, extraArgs: [] },
    hardware: { chip: hardware.chip, ramBytes: hardware.ramBytes, appleSilicon: hardware.appleSilicon, budgetBytes },
    createdAt: now.toISOString(),
  }
}

/** The llm-local overlay dsh loads as the second --patch. Hand-emitted YAML, no library. */
function renderOverlay(config) {
  const ctx = config.contextWindow
  const max = config.maxTokens
  return [
    `# Generated by dsh-neutered setup on ${config.createdAt}. Edit config.json and run`,
    '# `dsh-neutered settings` instead of editing this file.',
    '- id: llm-local',
    '  config:',
    `    defaultContextWindow: ${ctx}`,
    `    maxTokens: ${max}`,
    `    streamIdleTimeoutMs: ${STREAM_IDLE_TIMEOUT_MS}`,
    '    models:',
    '      - id: local',
    `        name: ${JSON.stringify(config.model.name)}`,
    `        contextWindow: ${ctx}`,
    `        maxTokens: ${max}`,
    '',
  ].join('\n')
}

function writeConfig(paths, config) {
  fs.mkdirSync(paths.home, { recursive: true })
  fs.writeFileSync(paths.configPath, JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(paths.overlayPath, renderOverlay(config))
}

function updateContext(config, contextWindow, now = new Date()) {
  return { ...config, contextWindow, maxTokens: maxTokensFor(contextWindow), updatedAt: now.toISOString() }
}

module.exports = {
  CONFIG_VERSION,
  STREAM_IDLE_TIMEOUT_MS,
  neuteredPaths,
  readConfig,
  buildConfig,
  renderOverlay,
  writeConfig,
  updateContext,
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: `# pass 37`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add neutered/setup/lib/config.cjs neutered/setup/test/config.test.cjs
git commit -m "neutered: setup configuration file and generated llm-local overlay"
```

---

### Task 6: Model server control

**Files:**
- Create: `neutered/setup/lib/server.cjs`
- Test: `neutered/setup/test/server.test.cjs`

**Interfaces:**
- Consumes: config shape from Task 5 (`config.model.path`, `config.model.serverArgs`, `config.contextWindow`, `config.server.startTimeoutMs`, `config.server.keep`, `config.server.extraArgs`) and `paths` from `neuteredPaths`.
- Produces: `ENDPOINT`, `ServerError` (has `exitCode`), `status(endpoint?) → Promise<'healthy'|'loading'|'busy'|'silent'>`, `serverArgs(config, endpoint?) → string[]`, `processInfo(pid, exec?) → { comm, lstart } | null`, `processMatches(info, record)`, `readPidFile(paths)`, `waitHealthy(endpoint, deadlineMs, opts)`, `ensure(config, paths, opts?) → Promise<{ kind: 'external' } | { kind: 'started' | 'started-keep', pid }>`, `stop(paths, opts?) → Promise<'stopped'|'none'|'stale'>`.
- `opts` for tests: `endpoint`, `spawnFn`, `exec`, `sleepFn`, `log`, `llamaServer`, `kill`.

- [ ] **Step 1: Write the failing tests**

```js
// neutered/setup/test/server.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { status, serverArgs, processMatches, ensure, stop, ServerError } = require('../lib/server.cjs')
const { neuteredPaths } = require('../lib/config.cjs')

function fakeServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, endpoint: { host: '127.0.0.1', port: srv.address().port } }))
  })
}
const close = (srv) => new Promise((r) => srv.close(r))
const noSleep = async () => {}

const CONFIG = {
  version: 1,
  model: { path: '/models/x.gguf', serverArgs: ['--temp', '0.7'] },
  contextWindow: 131072,
  server: { keep: false, startTimeoutMs: 5000, extraArgs: ['--threads', '8'] },
}

function tmpPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-neutered-'))
  return { dir, paths: neuteredPaths({ DSH_HOME: dir }) }
}

test('status: 200 is healthy, 503 is loading, other codes are busy, no listener is silent', async () => {
  let code = 200
  const { srv, endpoint } = await fakeServer((req, res) => { res.statusCode = code; res.end('{}') })
  try {
    assert.equal(await status(endpoint), 'healthy')
    code = 503
    assert.equal(await status(endpoint), 'loading')
    code = 404
    assert.equal(await status(endpoint), 'busy')
  } finally {
    await close(srv)
  }
  assert.equal(await status(endpoint), 'silent')
})

test('serverArgs: loopback endpoint, local model path, context, full offload, jinja, then model and extra args', () => {
  assert.deepEqual(serverArgs(CONFIG, { host: '127.0.0.1', port: 1234 }), [
    '--host', '127.0.0.1', '--port', '1234', '-m', '/models/x.gguf', '-c', '131072', '-ngl', '99', '--jinja',
    '--temp', '0.7', '--threads', '8',
  ])
})

test('processMatches: only a llama-server with the recorded start time matches', () => {
  const record = { pid: 7, startedAt: 'Thu Sep  4 18:00:00 2026' }
  assert.equal(processMatches({ comm: '/opt/homebrew/bin/llama-server', lstart: 'Thu Sep  4 18:00:00 2026' }, record), true)
  assert.equal(processMatches({ comm: 'node', lstart: 'Thu Sep  4 18:00:00 2026' }, record), false)
  assert.equal(processMatches({ comm: 'llama-server', lstart: 'Fri Sep  5 09:00:00 2026' }, record), false)
  assert.equal(processMatches(null, record), false)
})

test('ensure: a healthy server is external and nothing is spawned', async () => {
  const { srv, endpoint } = await fakeServer((req, res) => res.end('{}'))
  const { dir, paths } = tmpPaths()
  try {
    const result = await ensure(CONFIG, paths, { endpoint, spawnFn: () => { throw new Error('must not spawn') }, log: () => {} })
    assert.deepEqual(result, { kind: 'external' })
  } finally {
    await close(srv)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ensure: a busy port is exit 4 and nothing is spawned', async () => {
  const { srv, endpoint } = await fakeServer((req, res) => { res.statusCode = 404; res.end() })
  const { dir, paths } = tmpPaths()
  try {
    await assert.rejects(
      ensure(CONFIG, paths, { endpoint, spawnFn: () => { throw new Error('must not spawn') }, log: () => {} }),
      (err) => err instanceof ServerError && err.exitCode === 4 && /something else is listening/.test(err.message),
    )
  } finally {
    await close(srv)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ensure: a silent port spawns llama-server detached, records the pid and waits for health', async () => {
  let healthy = false
  const { srv, endpoint } = await fakeServer((req, res) => { res.statusCode = healthy ? 200 : 503; res.end('{}') })
  const { dir, paths } = tmpPaths()
  const spawned = []
  const spawnFn = (bin, args, options) => {
    spawned.push({ bin, args, options })
    const child = new EventEmitter()
    child.pid = 4242
    child.unref = () => { child.unrefCalled = true }
    process.nextTick(() => { child.emit('spawn'); healthy = true })
    return child
  }
  const exec = (cmd, args) => (args[1] === 'comm=' ? 'llama-server\n' : 'Thu Sep  4 18:00:00 2026\n')
  try {
    // The server answers 503 until the fake child has "spawned"; the probe below sees the 503 first.
    healthy = false
    const result = await ensure(CONFIG, paths, { endpoint, spawnFn, exec, sleepFn: noSleep, log: () => {}, llamaServer: '/opt/homebrew/bin/llama-server', probeFirst: 'silent' })
    assert.deepEqual(result, { kind: 'started', pid: 4242 })
    assert.equal(spawned.length, 1)
    assert.equal(spawned[0].bin, '/opt/homebrew/bin/llama-server')
    assert.equal(spawned[0].options.detached, true)
    assert.deepEqual(spawned[0].args.slice(0, 4), ['--host', '127.0.0.1', '--port', String(endpoint.port)])
    const record = JSON.parse(fs.readFileSync(paths.pidPath, 'utf8'))
    assert.equal(record.pid, 4242)
    assert.equal(record.startedAt, 'Thu Sep  4 18:00:00 2026')
    assert.ok(fs.readFileSync(paths.logPath, 'utf8').includes('dsh-neutered starting'))
  } finally {
    await close(srv)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ensure: keep=true reports started-keep', async () => {
  const { srv, endpoint } = await fakeServer((req, res) => res.end('{}'))
  const { dir, paths } = tmpPaths()
  const spawnFn = () => { const c = new EventEmitter(); c.pid = 1; c.unref = () => {}; process.nextTick(() => c.emit('spawn')); return c }
  const exec = (cmd, args) => (args[1] === 'comm=' ? 'llama-server' : 'now')
  try {
    const result = await ensure({ ...CONFIG, server: { ...CONFIG.server, keep: true } }, paths, { endpoint, spawnFn, exec, sleepFn: noSleep, log: () => {}, probeFirst: 'silent' })
    assert.deepEqual(result, { kind: 'started-keep', pid: 1 })
  } finally {
    await close(srv)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('stop: no pid file is none; a stale record only removes the file; a live match is signalled', async () => {
  const { dir, paths } = tmpPaths()
  try {
    assert.equal(await stop(paths), 'none')
    fs.mkdirSync(paths.home, { recursive: true })
    fs.writeFileSync(paths.pidPath, JSON.stringify({ pid: 4242, startedAt: 'then' }))
    assert.equal(await stop(paths, { exec: () => 'node\n' }), 'stale')
    assert.equal(fs.existsSync(paths.pidPath), false)

    fs.writeFileSync(paths.pidPath, JSON.stringify({ pid: 4242, startedAt: 'then' }))
    const signals = []
    let alive = true
    const exec = (cmd, args) => {
      if (!alive) throw new Error('no such process')
      return args[1] === 'comm=' ? 'llama-server' : 'then'
    }
    const kill = (pid, sig) => { signals.push([pid, sig]); alive = false }
    assert.equal(await stop(paths, { exec, kill, sleepFn: noSleep }), 'stopped')
    assert.deepEqual(signals, [[4242, 'SIGTERM']])
    assert.equal(fs.existsSync(paths.pidPath), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: FAIL with `Cannot find module '../lib/server.cjs'`

- [ ] **Step 3: Write the implementation**

```js
// neutered/setup/lib/server.cjs
'use strict'

// Start, probe and stop the local llama-server on 127.0.0.1:1234. The server is spawned
// detached (own session, output to a log file) so it sits outside the wrapper's process tree:
// the egress-capture gate walks that tree and must see only the dsh side of the loopback pair.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ENDPOINT = Object.freeze({ host: '127.0.0.1', port: 1234 })
const HEALTH_TIMEOUT_MS = 2000
const POLL_MS = 1000
const PROGRESS_MS = 10000

class ServerError extends Error {
  constructor(exitCode, message) {
    super(message)
    this.exitCode = exitCode
  }
}

function request(pathname, endpoint = ENDPOINT, timeoutMs = HEALTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get({ host: endpoint.host, port: endpoint.port, path: pathname, timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode, body }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (err) => resolve({ error: err.code || err.message }))
  })
}

/** healthy (200), loading (503), busy (anything else answering), silent (nothing listens). */
async function status(endpoint = ENDPOINT) {
  const res = await request('/health', endpoint)
  if (res.error === 'ECONNREFUSED') return 'silent'
  if (res.error) return 'busy'
  if (res.statusCode === 200) return 'healthy'
  if (res.statusCode === 503) return 'loading'
  return 'busy'
}

function serverArgs(config, endpoint = ENDPOINT) {
  return [
    '--host', endpoint.host,
    '--port', String(endpoint.port),
    '-m', config.model.path,
    '-c', String(config.contextWindow),
    '-ngl', '99',
    '--jinja',
    ...(config.model.serverArgs || []),
    ...((config.server && config.server.extraArgs) || []),
  ]
}

function defaultExec(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/** Command name and start time of a live process, or null when it is gone. */
function processInfo(pid, exec = defaultExec) {
  try {
    const comm = exec('/bin/ps', ['-o', 'comm=', '-p', String(pid)]).trim()
    const lstart = exec('/bin/ps', ['-o', 'lstart=', '-p', String(pid)]).trim()
    return comm ? { comm, lstart } : null
  } catch {
    return null
  }
}

function readPidFile(paths) {
  try {
    const record = JSON.parse(fs.readFileSync(paths.pidPath, 'utf8'))
    return Number.isInteger(record.pid) ? record : null
  } catch {
    return null
  }
}

function processMatches(info, record) {
  return Boolean(info) && path.basename(info.comm) === 'llama-server' && info.lstart === record.startedAt
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitHealthy(endpoint, deadlineMs, { sleepFn = sleep, log = () => {}, isAlive = () => true, now = Date.now } = {}) {
  const started = now()
  let lastNote = started
  for (;;) {
    if ((await status(endpoint)) === 'healthy') return true
    if (!isAlive()) return false
    const t = now()
    if (t - started > deadlineMs) return false
    if (t - lastNote >= PROGRESS_MS) {
      log(`llama-server: loading model … ${Math.round((t - started) / 1000)} s`)
      lastNote = t
    }
    await sleepFn(POLL_MS)
  }
}

/**
 * Make sure a healthy server answers on the endpoint. Returns `external` when one already did,
 * otherwise spawns llama-server detached, records `server.pid`, waits for /health and returns
 * `started` (or `started-keep` when the configuration says to leave it running).
 */
async function ensure(config, paths, opts = {}) {
  const {
    endpoint = ENDPOINT,
    spawnFn = spawn,
    exec = defaultExec,
    log = (line) => process.stderr.write(line + '\n'),
    llamaServer = 'llama-server',
    sleepFn = sleep,
    probeFirst = null,
  } = opts
  const initial = probeFirst || (await status(endpoint))
  if (initial === 'healthy') return { kind: 'external' }
  if (initial === 'busy') {
    throw new ServerError(4, `something else is listening on ${endpoint.host}:${endpoint.port} and does not answer /health; stop it or let it finish, then retry`)
  }
  if (initial === 'loading') {
    log(`a model server is already loading on ${endpoint.host}:${endpoint.port}; waiting for it`)
    if (await waitHealthy(endpoint, config.server.startTimeoutMs, { sleepFn, log })) return { kind: 'external' }
    throw new ServerError(4, 'the existing server did not become healthy in time')
  }

  fs.mkdirSync(paths.home, { recursive: true })
  const args = serverArgs(config, endpoint)
  const fd = fs.openSync(paths.logPath, 'a')
  fs.writeSync(fd, `\n=== ${new Date().toISOString()} dsh-neutered starting: ${llamaServer} ${args.join(' ')}\n`)
  const child = spawnFn(llamaServer, args, { detached: true, stdio: ['ignore', fd, fd] })
  const spawnError = await new Promise((resolve) => {
    child.once('error', resolve)
    child.once('spawn', () => resolve(null))
  })
  fs.closeSync(fd)
  if (spawnError) {
    throw new ServerError(4, `could not start ${llamaServer}: ${spawnError.message}; run dsh-neutered setup to install llama.cpp`)
  }
  child.unref()
  const info = processInfo(child.pid, exec)
  const record = { pid: child.pid, startedAt: info ? info.lstart : null, model: config.model.path, startedBy: 'dsh-neutered', at: new Date().toISOString() }
  fs.writeFileSync(paths.pidPath, JSON.stringify(record) + '\n')
  log(`llama-server: started pid ${child.pid} (${path.basename(config.model.path)}, context ${config.contextWindow}); log ${paths.logPath}`)

  const isAlive = () => processInfo(child.pid, exec) !== null
  const healthy = await waitHealthy(endpoint, config.server.startTimeoutMs, { sleepFn, log, isAlive })
  if (!healthy) {
    await stop(paths, { exec, sleepFn })
    throw new ServerError(4, `llama-server did not become healthy within ${Math.round(config.server.startTimeoutMs / 1000)} s; see ${paths.logPath}`)
  }
  return { kind: config.server.keep ? 'started-keep' : 'started', pid: child.pid }
}

/** Stop the server recorded in server.pid, but only if that pid is still our llama-server. */
async function stop(paths, opts = {}) {
  const { exec = defaultExec, sleepFn = sleep, kill = process.kill.bind(process) } = opts
  const record = readPidFile(paths)
  if (!record) return 'none'
  const info = processInfo(record.pid, exec)
  if (!processMatches(info, record)) {
    fs.rmSync(paths.pidPath, { force: true })
    return 'stale'
  }
  kill(record.pid, 'SIGTERM')
  for (let i = 0; i < 100 && processInfo(record.pid, exec) !== null; i++) await sleepFn(100)
  if (processInfo(record.pid, exec) !== null) kill(record.pid, 'SIGKILL')
  fs.rmSync(paths.pidPath, { force: true })
  return 'stopped'
}

module.exports = {
  ENDPOINT,
  ServerError,
  request,
  status,
  serverArgs,
  processInfo,
  processMatches,
  readPidFile,
  waitHealthy,
  ensure,
  stop,
}
```

The `probeFirst` option exists only so a test can drive the "silent" branch while a fake server is already listening; the CLI never passes it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: `# pass 45`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add neutered/setup/lib/server.cjs neutered/setup/test/server.test.cjs
git commit -m "neutered: setup llama-server control (probe, detached start, pid-file stop)"
```

---

### Task 7: Prompt and download helpers

**Files:**
- Create: `neutered/setup/lib/prompt.cjs`
- Create: `neutered/setup/lib/download.cjs`
- Test: `neutered/setup/test/download.test.cjs`

**Interfaces:**
- Produces (`prompt.cjs`): `ask(question, defaultValue, { yes?, input?, output? }) → Promise<string>`.
- Produces (`download.cjs`): `HF_BASE`, `SetupError` (has `exitCode`), `hfUrl(repo, file)`, `hasCommand(name, exec?)`, `ensureLlamaServer({ run?, exec?, log? }) → 'llama-server'`, `downloadModel(entry, modelsDir, { run?, exec?, log? }) → { modelPath, totalBytes }`, `sha256Of(file, exec?)`.
- `run(cmd, args)` returns `{ status }` and inherits stdio (progress bars go to the terminal); `exec(cmd, args)` returns trimmed stdout or throws. Tests inject both.

- [ ] **Step 1: Write the failing tests**

```js
// neutered/setup/test/download.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { hfUrl, hasCommand, ensureLlamaServer, downloadModel, SetupError } = require('../lib/download.cjs')
const { ask } = require('../lib/prompt.cjs')
const { Readable, Writable } = require('node:stream')

function execWith(available, extra = {}) {
  return (cmd, args) => {
    if (cmd === '/usr/bin/which') {
      if (available.includes(args[0])) return `/opt/homebrew/bin/${args[0]}`
      throw new Error('not found')
    }
    if (cmd === '/usr/bin/shasum') return `${extra.sha || 'deadbeef'}  ${args[2]}`
    throw new Error(`unexpected ${cmd}`)
  }
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-neutered-dl-')) }

const ENTRY = {
  id: 'x', name: 'X', repo: 'owner/X-GGUF', files: ['X-Q4.gguf'], sizeBytes: 1000, sha256: [],
  nativeContext: 32768, tags: ['recommended'], serverArgs: [], pinned: false,
}

test('hfUrl: resolves a file on the main branch', () => {
  assert.equal(hfUrl('owner/X-GGUF', 'sub/X-Q4.gguf'), 'https://huggingface.co/owner/X-GGUF/resolve/main/sub/X-Q4.gguf')
})

test('hasCommand: true only when which finds it', () => {
  assert.equal(hasCommand('hf', execWith(['hf'])), true)
  assert.equal(hasCommand('hf', execWith([])), false)
})

test('ensureLlamaServer: present means no install; missing brew is exit 3; brew failure is exit 3', () => {
  const runs = []
  const run = (cmd, args) => { runs.push([cmd, ...args]); return { status: 0 } }
  assert.equal(ensureLlamaServer({ run, exec: execWith(['llama-server']), log: () => {} }), 'llama-server')
  assert.deepEqual(runs, [])
  assert.throws(() => ensureLlamaServer({ run, exec: execWith([]), log: () => {} }), (e) => e instanceof SetupError && e.exitCode === 3 && /Homebrew/.test(e.message))
  const failing = () => ({ status: 1 })
  assert.throws(() => ensureLlamaServer({ run: failing, exec: execWith(['brew']), log: () => {} }), /brew install llama.cpp failed/)
})

test('ensureLlamaServer: installs with brew when only brew is present', () => {
  const runs = []
  let installed = false
  const exec = (cmd, args) => {
    if (args[0] === 'brew') return '/opt/homebrew/bin/brew'
    if (args[0] === 'llama-server' && installed) return '/opt/homebrew/bin/llama-server'
    throw new Error('not found')
  }
  const run = (cmd, args) => { runs.push([cmd, ...args]); installed = true; return { status: 0 } }
  assert.equal(ensureLlamaServer({ run, exec, log: () => {} }), 'llama-server')
  assert.deepEqual(runs, [['brew', 'install', 'llama.cpp']])
})

test('downloadModel: uses hf when present, checks the size within 10 % for unpinned entries', () => {
  const dir = tmpDir()
  const runs = []
  const run = (cmd, args) => {
    runs.push([cmd, ...args])
    fs.writeFileSync(path.join(dir, 'X-Q4.gguf'), Buffer.alloc(1050))
    return { status: 0 }
  }
  try {
    const result = downloadModel(ENTRY, dir, { run, exec: execWith(['hf']), log: () => {} })
    assert.deepEqual(runs, [['hf', 'download', 'owner/X-GGUF', 'X-Q4.gguf', '--local-dir', dir]])
    assert.equal(result.modelPath, path.join(dir, 'X-Q4.gguf'))
    assert.equal(result.totalBytes, 1050)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('downloadModel: falls back to curl with resume and retries when hf is absent', () => {
  const dir = tmpDir()
  const runs = []
  const run = (cmd, args) => { runs.push([cmd, ...args]); fs.writeFileSync(args[args.length - 2], Buffer.alloc(1000)); return { status: 0 } }
  try {
    downloadModel(ENTRY, dir, { run, exec: execWith([]), log: () => {} })
    assert.deepEqual(runs, [['curl', '-fL', '-C', '-', '--retry', '5', '-o', path.join(dir, 'X-Q4.gguf'), 'https://huggingface.co/owner/X-GGUF/resolve/main/X-Q4.gguf']])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('downloadModel: a pinned entry must match byte-exact and the partial file is deleted', () => {
  const dir = tmpDir()
  const run = () => { fs.writeFileSync(path.join(dir, 'X-Q4.gguf'), Buffer.alloc(999)); return { status: 0 } }
  try {
    assert.throws(() => downloadModel({ ...ENTRY, pinned: true }, dir, { run, exec: execWith([]), log: () => {} }), /expected 1000/)
    assert.equal(fs.existsSync(path.join(dir, 'X-Q4.gguf')), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('downloadModel: a SHA-256 mismatch deletes the file and is exit 3', () => {
  const dir = tmpDir()
  const run = () => { fs.writeFileSync(path.join(dir, 'X-Q4.gguf'), Buffer.alloc(1000)); return { status: 0 } }
  try {
    assert.throws(() => downloadModel({ ...ENTRY, sha256: ['cafe'] }, dir, { run, exec: execWith([], { sha: 'deadbeef' }), log: () => {} }), (e) => e.exitCode === 3 && /SHA-256 mismatch/.test(e.message))
    assert.equal(fs.existsSync(path.join(dir, 'X-Q4.gguf')), false)
    downloadModel({ ...ENTRY, sha256: ['cafe'] }, dir, { run, exec: execWith([], { sha: 'cafe' }), log: () => {} })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('downloadModel: a failed download is exit 3 and says rerun resumes', () => {
  const dir = tmpDir()
  try {
    assert.throws(() => downloadModel(ENTRY, dir, { run: () => ({ status: 22 }), exec: execWith([]), log: () => {} }), /rerun setup to resume/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ask: --yes or a non-TTY input returns the default without reading', async () => {
  const output = []
  const sink = new Writable({ write(chunk, enc, cb) { output.push(String(chunk)); cb() } })
  const input = Readable.from([])
  input.isTTY = false
  assert.equal(await ask('Choose', 1, { yes: true, input, output: sink }), '1')
  assert.equal(await ask('Choose', 2, { yes: false, input, output: sink }), '2')
  assert.match(output.join(''), /Choose \[1\]/)
})

test('ask: a TTY answer wins, an empty answer yields the default', async () => {
  const sink = new Writable({ write(chunk, enc, cb) { cb() } })
  const input = Readable.from(['3\n'])
  input.isTTY = true
  assert.equal(await ask('Choose', 1, { input, output: sink }), '3')
  const empty = Readable.from(['\n'])
  empty.isTTY = true
  assert.equal(await ask('Choose', 1, { input: empty, output: sink }), '1')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: FAIL with `Cannot find module '../lib/download.cjs'`

- [ ] **Step 3: Write the prompt helper**

```js
// neutered/setup/lib/prompt.cjs
'use strict'

// The one question setup asks. Non-interactive runs (--yes, or stdin not a TTY) take the default.

const readline = require('node:readline')

async function ask(question, defaultValue, { yes = false, input = process.stdin, output = process.stdout } = {}) {
  if (yes || !input.isTTY) {
    output.write(`${question} [${defaultValue}] (accepted automatically)\n`)
    return String(defaultValue)
  }
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} [${defaultValue}]: `, resolve))
    const trimmed = answer.trim()
    return trimmed === '' ? String(defaultValue) : trimmed
  } finally {
    rl.close()
  }
}

module.exports = { ask }
```

- [ ] **Step 4: Write the download helper**

```js
// neutered/setup/lib/download.cjs
'use strict'

// The only network-using code in dsh-neutered: install llama.cpp through Homebrew and fetch
// GGUF files from Hugging Face. Used by `dsh-neutered setup` and `settings --model` only;
// the task path never loads this file.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')

const HF_BASE = 'https://huggingface.co'
const UNPINNED_TOLERANCE = 0.1

class SetupError extends Error {
  constructor(exitCode, message) {
    super(message)
    this.exitCode = exitCode
  }
}

function hfUrl(repo, file) {
  return `${HF_BASE}/${repo}/resolve/main/${file}`
}

function defaultExec(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function defaultRun(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'inherit' })
}

const defaultLog = (line) => process.stderr.write(line + '\n')

function hasCommand(name, exec = defaultExec) {
  try {
    return exec('/usr/bin/which', [name]) !== ''
  } catch {
    return false
  }
}

/** Return the llama-server command, installing llama.cpp with Homebrew when it is missing. */
function ensureLlamaServer({ run = defaultRun, exec = defaultExec, log = defaultLog } = {}) {
  if (hasCommand('llama-server', exec)) return 'llama-server'
  if (!hasCommand('brew', exec)) {
    throw new SetupError(3, 'llama-server is not installed and Homebrew is missing. Install Homebrew from https://brew.sh, then run dsh-neutered setup again.')
  }
  log('Installing llama.cpp with Homebrew (network) …')
  const result = run('brew', ['install', 'llama.cpp'])
  if (result.status !== 0) {
    throw new SetupError(3, `brew install llama.cpp failed (exit ${result.status}); fix the Homebrew error above and rerun setup`)
  }
  if (!hasCommand('llama-server', exec)) {
    throw new SetupError(3, 'brew install finished but llama-server is not on PATH; open a new shell or add $(brew --prefix)/bin to PATH, then rerun setup')
  }
  return 'llama-server'
}

function sha256Of(file, exec = defaultExec) {
  return exec('/usr/bin/shasum', ['-a', '256', file]).split(/\s+/)[0]
}

/**
 * Download every file of a catalog entry into modelsDir (hf CLI when present, else curl with
 * resume). Verifies SHA-256 when the entry carries one and the total size (exact for pinned
 * entries, ±10 % otherwise). Returns the path of the first file and the total bytes.
 */
function downloadModel(entry, modelsDir, { run = defaultRun, exec = defaultExec, log = defaultLog } = {}) {
  fs.mkdirSync(modelsDir, { recursive: true })
  const useHf = hasCommand('hf', exec)
  const downloaded = []
  entry.files.forEach((file, index) => {
    const dest = path.join(modelsDir, file)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    log(`Downloading ${entry.repo} ${file} → ${dest} (network) …`)
    const result = useHf
      ? run('hf', ['download', entry.repo, file, '--local-dir', modelsDir])
      : run('curl', ['-fL', '-C', '-', '--retry', '5', '-o', dest, hfUrl(entry.repo, file)])
    if (result.status !== 0) throw new SetupError(3, `download of ${file} failed (exit ${result.status}); rerun setup to resume`)
    if (!fs.existsSync(dest)) throw new SetupError(3, `download finished but ${dest} does not exist`)
    const expectedSha = entry.sha256 && entry.sha256[index]
    if (expectedSha) {
      const got = sha256Of(dest, exec)
      if (got !== expectedSha) {
        fs.rmSync(dest, { force: true })
        throw new SetupError(3, `${file}: SHA-256 mismatch (expected ${expectedSha}, got ${got}); the corrupt file was deleted, rerun setup`)
      }
    }
    downloaded.push(dest)
  })
  const totalBytes = downloaded.reduce((sum, file) => sum + fs.statSync(file).size, 0)
  if (entry.sizeBytes) {
    const tolerance = entry.pinned ? 0 : Math.floor(entry.sizeBytes * UNPINNED_TOLERANCE)
    if (Math.abs(totalBytes - entry.sizeBytes) > tolerance) {
      downloaded.forEach((file) => fs.rmSync(file, { force: true }))
      throw new SetupError(3, `${entry.name}: downloaded ${totalBytes} bytes, expected ${entry.sizeBytes}${entry.pinned ? '' : ' (±10 %)'}; the files were deleted, rerun setup`)
    }
  }
  return { modelPath: downloaded[0], totalBytes }
}

module.exports = { HF_BASE, SetupError, hfUrl, hasCommand, ensureLlamaServer, downloadModel, sha256Of }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: `# pass 56`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add neutered/setup/lib/prompt.cjs neutered/setup/lib/download.cjs neutered/setup/test/download.test.cjs
git commit -m "neutered: setup prompt and download helpers (Homebrew llama.cpp, Hugging Face GGUF)"
```

---

### Task 8: The setup CLI entry

**Files:**
- Create: `neutered/setup/setup.cjs`
- Test: `neutered/setup/test/setup-cli.test.cjs`

**Interfaces:**
- Consumes every lib from Tasks 1–7.
- Produces the command surface the wrapper calls: `node neutered/setup/setup.cjs setup|settings|server <sub>|overlay-path`. `server ensure` prints exactly `external`, `started <pid>` or `started-keep <pid>` on stdout; `server plan` prints `server: external`, `server: setup required` or the `llama-server …` command line; `overlay-path` prints the overlay path.

- [ ] **Step 1: Write the failing tests**

```js
// neutered/setup/test/setup-cli.test.cjs
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const CLI = path.join(__dirname, '..', 'setup.cjs')

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-neutered-cli-')) }

const CONFIG = {
  version: 1,
  model: { id: 't', name: 'T', repo: null, path: '/tmp/t.gguf', nativeContext: 32768, architecture: 'llama', serverArgs: ['--temp', '0.5'] },
  contextWindow: 32768, maxTokens: 8192,
  server: { keep: false, startTimeoutMs: 1000, extraArgs: [] },
  hardware: { chip: 'x', ramBytes: 1, appleSilicon: true, budgetBytes: 1 },
  createdAt: '2026-01-01T00:00:00.000Z',
}

test('no command or -h prints usage and exits 0; an unknown command exits 2', () => {
  assert.equal(run([]).code, 0)
  assert.match(run(['-h']).out, /first-run configuration/)
  const bad = run(['bogus'])
  assert.equal(bad.code, 2)
  assert.match(bad.err, /unknown command 'bogus'/)
})

test('overlay-path follows DSH_HOME', () => {
  const home = tmpHome()
  try {
    assert.equal(run(['overlay-path'], { DSH_HOME: home }).out.trim(), path.join(home, 'neutered', 'overlay.yml'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('settings --show without a configuration exits 3 and points at setup', () => {
  const home = tmpHome()
  try {
    const r = run(['settings', '--show'], { DSH_HOME: home })
    assert.equal(r.code, 3)
    assert.match(r.err, /run dsh-neutered setup first/)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('settings --show, --context and --keep-server rewrite config and overlay', () => {
  const home = tmpHome()
  const dir = path.join(home, 'neutered')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(CONFIG))
  try {
    const show = run(['settings', '--show'], { DSH_HOME: home })
    assert.equal(show.code, 0)
    assert.match(show.out, /model:\s+T/)
    assert.match(show.out, /context window:\s+32768/)

    const ctx = run(['settings', '--context', '16384'], { DSH_HOME: home })
    assert.equal(ctx.code, 0, ctx.err)
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
    assert.equal(after.contextWindow, 16384)
    assert.equal(after.maxTokens, 4096)
    assert.match(fs.readFileSync(path.join(dir, 'overlay.yml'), 'utf8'), /contextWindow: 16384/)

    assert.equal(run(['settings', '--context', '65536'], { DSH_HOME: home }).code, 2)
    assert.equal(run(['settings', '--keep-server', 'sideways'], { DSH_HOME: home }).code, 2)
    assert.equal(run(['settings', '--keep-server', 'on'], { DSH_HOME: home }).code, 0)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).server.keep, true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('settings --reset removes config and overlay but keeps models', () => {
  const home = tmpHome()
  const dir = path.join(home, 'neutered')
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(CONFIG))
  fs.writeFileSync(path.join(dir, 'overlay.yml'), '')
  fs.writeFileSync(path.join(dir, 'models', 'keep.gguf'), '')
  try {
    assert.equal(run(['settings', '--reset'], { DSH_HOME: home }).code, 0)
    assert.equal(fs.existsSync(path.join(dir, 'config.json')), false)
    assert.equal(fs.existsSync(path.join(dir, 'overlay.yml')), false)
    assert.equal(fs.existsSync(path.join(dir, 'models', 'keep.gguf')), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('server plan prints the llama-server line or reports an external server', () => {
  const home = tmpHome()
  const dir = path.join(home, 'neutered')
  fs.mkdirSync(dir, { recursive: true })
  try {
    assert.equal(run(['server', 'plan'], { DSH_HOME: home }).out.trim(), 'server: setup required')
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(CONFIG))
    const plan = run(['server', 'plan'], { DSH_HOME: home }).out.trim()
    assert.ok(plan === 'server: external' || plan === 'llama-server --host 127.0.0.1 --port 1234 -m /tmp/t.gguf -c 32768 -ngl 99 --jinja --temp 0.5', plan)
    const status = run(['server', 'status'], { DSH_HOME: home }).out.trim()
    assert.match(status, /^(healthy|loading|busy|silent)/)
    assert.equal(run(['server', 'sideways'], { DSH_HOME: home }).code, 2)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('setup --model with an unknown id that is not a custom spec exits with a clear error', () => {
  const home = tmpHome()
  try {
    const r = run(['setup', '--yes', '--model', 'no-such-model'], { DSH_HOME: home, DSH_NEUTERED_BUDGET_GIB: '1' })
    assert.notEqual(r.code, 0)
    assert.match(r.err, /neither owner\/repo:file.gguf nor an existing file/)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: FAIL (the CLI file does not exist; spawn exits non-zero with `Cannot find module`)

- [ ] **Step 3: Write the CLI**

```js
#!/usr/bin/env node
// neutered/setup/setup.cjs
'use strict'

// dsh-neutered first-run setup, settings and model-server control.
//
// Called by neutered/bin/dsh-neutered without the egress guard. `setup` and `settings --model`
// are the only commands that reach the network (Homebrew and Hugging Face, see lib/download.cjs).
// `server` and `overlay-path` touch nothing but 127.0.0.1:1234 and $DSH_HOME/neutered.

const fs = require('node:fs')
const hardware = require('./lib/hardware.cjs')
const sizing = require('./lib/sizing.cjs')
const { readMetadata, modelGeometry } = require('./lib/gguf-header.cjs')
const catalogLib = require('./lib/catalog.cjs')
const configLib = require('./lib/config.cjs')
const download = require('./lib/download.cjs')
const server = require('./lib/server.cjs')
const { ask } = require('./lib/prompt.cjs')

class UsageError extends Error {
  constructor(message) {
    super(message)
    this.exitCode = 2
  }
}

const out = (line) => process.stdout.write(line + '\n')
const err = (line) => process.stderr.write(line + '\n')

const USAGE = `dsh-neutered setup — first-run configuration (uses the network once)

  setup    [--yes] [--model <id | owner/repo:file.gguf | /path/model.gguf>] [--context <n>] [--force]
  settings [--show] [--model <…>] [--context <n>] [--keep-server on|off] [--stop-server] [--reset]
  server   ensure | stop | status | plan
  overlay-path

setup detects the machine, ranks the model catalog by fit, asks which model to use (Enter accepts
the recommendation), installs llama.cpp with Homebrew, downloads the model from Hugging Face into
$DSH_HOME/neutered/models, sizes the context window from the model header and writes
$DSH_HOME/neutered/config.json plus overlay.yml. Only setup and settings --model reach the
network; running a task never does.
`

const SETUP_FLAGS = { yes: 'bool', model: 'value', context: 'value', force: 'bool' }
const SETTINGS_FLAGS = { show: 'bool', model: 'value', context: 'value', 'keep-server': 'value', 'stop-server': 'bool', reset: 'bool', yes: 'bool', force: 'bool' }

function parseFlags(argv, spec) {
  const flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      flags.help = true
      continue
    }
    if (!arg.startsWith('--')) {
      flags._.push(arg)
      continue
    }
    const name = arg.slice(2)
    const kind = spec[name]
    if (!kind) throw new UsageError(`unknown flag ${arg}`)
    if (kind === 'bool') {
      flags[name] = true
      continue
    }
    const value = argv[++i]
    if (value === undefined) throw new UsageError(`${arg} needs a value`)
    flags[name] = value
  }
  return flags
}

function parseContext(value, nativeContext) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 4096) throw new UsageError(`--context must be an integer >= 4096, got ${value}`)
  if (nativeContext && n > nativeContext) throw new UsageError(`--context ${n} exceeds the model's native context ${nativeContext}`)
  return n
}

const gb = (bytes) => `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 0 : 1)} GB`
const ctxLabel = (n) => `${Math.round(n / 1024)}k ctx`

async function pickEntry(catalog, ranked, flags) {
  if (flags.model) {
    const known = catalogLib.findEntry(catalog, flags.model)
    if (known) {
      if (ranked.tooLarge.includes(known) && !flags.force) {
        throw new download.SetupError(3, `${known.name} needs about ${gb(known.sizeBytes)} and does not fit this machine's budget; pass --force to try anyway`)
      }
      return known
    }
    return catalogLib.resolveCustom(flags.model)
  }
  out('Models that fit:')
  ranked.fits.forEach((entry, i) => {
    out(`  ${i + 1}) ${entry.name.padEnd(32)} ${gb(entry.sizeBytes).padStart(6)}   ${ctxLabel(entry.nativeContext)}   ${entry.tags.join(', ')}`)
  })
  const customIndex = ranked.fits.length + 1
  out(`  ${customIndex}) custom (Hugging Face owner/repo:file.gguf, or a local .gguf path)`)
  if (ranked.tooLarge.length > 0) {
    out(`Too large for this machine: ${ranked.tooLarge.map((e) => `${e.name} (${gb(e.sizeBytes)})`).join(', ')}`)
  }
  if (ranked.fits.length === 0 && (flags.yes || !process.stdin.isTTY)) {
    throw new download.SetupError(3, 'no catalog model fits this machine; rerun with --model owner/repo:file.gguf to name a smaller one')
  }
  const answer = await ask('Choose', ranked.fits.length > 0 ? 1 : customIndex, { yes: flags.yes })
  const n = Number(answer)
  if (Number.isInteger(n) && n >= 1 && n <= ranked.fits.length) return ranked.fits[n - 1]
  if (n === customIndex) return catalogLib.resolveCustom(await ask('Hugging Face owner/repo:file.gguf or local .gguf path', '', {}))
  throw new UsageError(`'${answer}' is not one of the listed numbers`)
}

async function acquireModel(entry, paths) {
  if (entry.local) return { modelPath: entry.files[0], totalBytes: entry.sizeBytes }
  return download.downloadModel(entry, paths.modelsDir)
}

function sizeContext(geom, fileBytes, budgetBytes, flags) {
  const kvPerToken = sizing.kvBytesPerToken(geom)
  const attention = geom.fullAttentionInterval ? Math.floor(geom.blockCount / geom.fullAttentionInterval) : geom.blockCount
  out(`Model header: ${geom.architecture}, ${geom.blockCount} layers (${attention} with a KV cache), native context ${geom.contextLength}, KV ${Math.round(kvPerToken / 1024)} KiB per token`)
  if (flags.context) {
    const n = parseContext(flags.context, geom.contextLength)
    if (!sizing.fitsContext(geom, fileBytes, budgetBytes, n)) {
      err(`warning: context ${n} needs ${sizing.formatGiB(sizing.memoryFor(geom, fileBytes, n))}, above the ${sizing.formatGiB(budgetBytes)} budget; llama-server may fail to start`)
    }
    return n
  }
  const choice = sizing.chooseContext(geom, fileBytes, budgetBytes)
  if (!choice) {
    throw new download.SetupError(3, `this model does not fit: weights ${sizing.formatGiB(fileBytes)} + KV at 32768 ${sizing.formatGiB(32768 * kvPerToken)} + buffers exceed the ${sizing.formatGiB(budgetBytes)} budget. Run setup again and choose a smaller model.`)
  }
  out(`Context window: ${choice.contextWindow} (weights ${sizing.formatGiB(fileBytes)} + KV ${sizing.formatGiB(choice.kvBytes)} + buffers = ${sizing.formatGiB(choice.totalBytes)} of ${sizing.formatGiB(budgetBytes)})`)
  return choice.contextWindow
}

/** Shared by setup and settings --model: choose, download, size, and build the configuration. */
async function configureModel(flags, paths, previousServer) {
  const hw = hardware.probe()
  const budgetBytes = hardware.budget(hw)
  out(hardware.describe(hw, budgetBytes))
  const catalog = catalogLib.loadCatalog()
  const ranked = sizing.rankCatalog(catalog, budgetBytes)
  const entry = await pickEntry(catalog, ranked, flags)
  download.ensureLlamaServer()
  const { modelPath, totalBytes } = await acquireModel(entry, paths)
  const geom = modelGeometry(readMetadata(modelPath))
  const contextWindow = sizeContext(geom, totalBytes, budgetBytes, flags)
  const config = configLib.buildConfig({ entry, modelPath, geometry: geom, contextWindow, hardware: hw, budgetBytes })
  return previousServer ? { ...config, server: previousServer } : config
}

async function runSetup(flags, paths) {
  if (flags.help) return out(USAGE)
  if (process.platform !== 'darwin') throw new UsageError('dsh-neutered supports macOS only')
  const config = await configureModel(flags, paths, null)
  configLib.writeConfig(paths, config)
  out(`Wrote ${paths.configPath} and ${paths.overlayPath}`)
  out('Ready. Run: neutered/bin/dsh-neutered -- "your task"')
}

async function showConfig(config, paths) {
  const record = server.readPidFile(paths)
  const status = await server.status()
  out(`model:          ${config.model.name} (${config.model.id})`)
  out(`file:           ${config.model.path}`)
  out(`context window: ${config.contextWindow} (native ${config.model.nativeContext})`)
  out(`max tokens:     ${config.maxTokens}`)
  out(`keep server:    ${config.server.keep ? 'on' : 'off'}`)
  out(`budget:         ${sizing.formatGiB(config.hardware.budgetBytes)} on ${config.hardware.chip}`)
  out(`server:         ${status}${record ? ` (started by dsh-neutered, pid ${record.pid})` : ''}`)
  out(`config:         ${paths.configPath}`)
}

async function runSettings(flags, paths) {
  if (flags.help) return out(USAGE)
  if (flags.reset) {
    fs.rmSync(paths.configPath, { force: true })
    fs.rmSync(paths.overlayPath, { force: true })
    return out(`Removed ${paths.configPath} and ${paths.overlayPath}; models in ${paths.modelsDir} were kept. Run dsh-neutered setup to configure again.`)
  }
  const config = configLib.readConfig(paths)
  if (!config) throw new download.SetupError(3, `no configuration at ${paths.configPath}; run dsh-neutered setup first`)
  if (flags['stop-server']) return out(`server: ${await server.stop(paths)}`)

  const changes = []
  let next = config
  if (flags.model) {
    next = await configureModel(flags, paths, config.server)
    changes.push('model')
  } else if (flags.context) {
    next = configLib.updateContext(next, parseContext(flags.context, next.model.nativeContext))
    changes.push('context')
  }
  if (flags['keep-server'] !== undefined) {
    const value = flags['keep-server']
    if (value !== 'on' && value !== 'off') throw new UsageError('--keep-server takes on or off')
    next = { ...next, server: { ...next.server, keep: value === 'on' } }
    changes.push('keep-server')
  }
  if (changes.length === 0) {
    if (flags.show || !process.stdin.isTTY) return showConfig(next, paths)
    await showConfig(next, paths)
    const choice = await ask('Change (model, context, keep-server, none)', 'none', {})
    if (choice === 'none') return
    if (choice === 'model') return runSettings({ ...flags, model: await ask('Catalog id, owner/repo:file.gguf or local .gguf path', '', {}) }, paths)
    if (choice === 'context') return runSettings({ ...flags, context: await ask('Context window', String(next.contextWindow), {}) }, paths)
    if (choice === 'keep-server') return runSettings({ ...flags, 'keep-server': next.server.keep ? 'off' : 'on' }, paths)
    throw new UsageError(`'${choice}' is not one of model, context, keep-server, none`)
  }
  configLib.writeConfig(paths, next)
  out(`Updated ${changes.join(', ')}; wrote ${paths.configPath} and ${paths.overlayPath}`)
  const record = server.readPidFile(paths)
  if (record && (changes.includes('model') || changes.includes('context'))) {
    out(`A llama-server started by dsh-neutered is running (pid ${record.pid}); run dsh-neutered settings --stop-server so the next task restarts it with the new settings.`)
  }
}

async function runServer(sub, paths) {
  const config = configLib.readConfig(paths)
  switch (sub) {
    case 'status': {
      const status = await server.status()
      const record = server.readPidFile(paths)
      return out(record ? `${status} (started by dsh-neutered, pid ${record.pid})` : status)
    }
    case 'stop':
      return out(await server.stop(paths))
    case 'plan': {
      if (!config) return out('server: setup required')
      const status = await server.status()
      return out(status === 'healthy' ? 'server: external' : `llama-server ${server.serverArgs(config).join(' ')}`)
    }
    case 'ensure': {
      if (!config) throw new download.SetupError(3, `no configuration at ${paths.configPath}; run dsh-neutered setup first`)
      const result = await server.ensure(config, paths)
      return out(result.kind === 'external' ? 'external' : `${result.kind} ${result.pid}`)
    }
    default:
      throw new UsageError(`server: expected ensure, stop, status or plan, got '${sub}'`)
  }
}

async function main(argv) {
  const [command, ...rest] = argv
  const paths = configLib.neuteredPaths()
  switch (command) {
    case undefined:
    case '-h':
    case '--help':
      return out(USAGE)
    case 'setup':
      return runSetup(parseFlags(rest, SETUP_FLAGS), paths)
    case 'settings':
      return runSettings(parseFlags(rest, SETTINGS_FLAGS), paths)
    case 'server':
      return runServer(rest[0], paths)
    case 'overlay-path':
      return out(paths.overlayPath)
    default:
      throw new UsageError(`unknown command '${command}'`)
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error) => {
    err(`dsh-neutered setup: ${error.message}`)
    process.exit(Number.isInteger(error.exitCode) ? error.exitCode : 1)
  },
)
```

Then `chmod +x neutered/setup/setup.cjs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: `# pass 63`, `# fail 0`

- [ ] **Step 5: Dry exercise on this machine without downloading**

Run: `DSH_HOME=$(mktemp -d) node neutered/setup/setup.cjs setup --yes --model /nonexistent.gguf; echo "exit=$?"`
Expected: the machine line (`Machine: Apple M4 Max, 64 GiB unified memory …`) then `dsh-neutered setup: custom model: '/nonexistent.gguf' is neither owner/repo:file.gguf nor an existing file` and `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add neutered/setup/setup.cjs neutered/setup/test/setup-cli.test.cjs
git commit -m "neutered: setup CLI (setup, settings, server control, overlay-path)"
```

---

### Task 9: Wrapper subcommands and server lifecycle (dsh-delegated edits)

**Files:**
- Modify: `neutered/bin/dsh-neutered` (whole file; 5 exact replacements, one dsh prompt)
- Modify: `neutered/bin/test/dsh-neutered.test.sh` (1 replacement, one dsh prompt)

**Interfaces:**
- Consumes: `node neutered/setup/setup.cjs setup|settings|server ensure|server stop|server plan|overlay-path` from Task 8.
- Produces: `dsh-neutered setup …`, `dsh-neutered settings …`, `--keep-server`, auto-setup when the overlay is missing, both `--patch` files on the dsh command, detached server start before the task and stop after it.

- [ ] **Step 1: Write the failing contract test additions**

Give dsh this one replacement for `neutered/bin/test/dsh-neutered.test.sh` (prompt file `prompt-task9-test.txt`, preamble as in the delegation protocol):

OLD:
```bash
# The wrapper carries no privacy-level or allowlist surface.
grep -q -E "DSH_NEUTERED_ALLOW|^\\s*-p\\)|\\bDSH_NEUTERED_ALLOW\\b" "$wrapper" && fail "wrapper carries an allowlist override or -p handler"

echo "dsh-neutered.test: rc=$rc"
```
NEW:
```bash
# The wrapper carries no privacy-level or allowlist surface.
grep -q -E "DSH_NEUTERED_ALLOW|^\\s*-p\\)|\\bDSH_NEUTERED_ALLOW\\b" "$wrapper" && fail "wrapper carries an allowlist override or -p handler"

# setup and settings dispatch to neutered/setup/setup.cjs.
out=$("$wrapper" setup -h 2>&1); [ $? -eq 0 ] || fail "setup -h exit code"
echo "$out" | grep -q "first-run configuration" || fail "setup -h lacks the setup usage"
out=$("$wrapper" settings -h 2>&1); [ $? -eq 0 ] || fail "settings -h exit code"

# --dry-run without a configuration announces that setup would run first.
tmp_home=$(mktemp -d)
dry3=$(DSH_HOME="$tmp_home" "$wrapper" --dry-run -- "a task" 2>&1); [ $? -eq 0 ] || fail "--dry-run (no config) exit code"
echo "$dry3" | grep -q "setup: would run first" || fail "dry-run without config does not announce setup"

# --dry-run with a configuration shows both overlays and the server plan.
mkdir -p "$tmp_home/neutered"
printf '%s\n' '{"version":1,"model":{"id":"t","name":"t","path":"/tmp/t.gguf","nativeContext":32768,"serverArgs":[]},"contextWindow":32768,"maxTokens":8192,"server":{"keep":false,"startTimeoutMs":1000,"extraArgs":[]},"hardware":{},"createdAt":"2026-01-01T00:00:00.000Z"}' > "$tmp_home/neutered/config.json"
: > "$tmp_home/neutered/overlay.yml"
dry4=$(DSH_HOME="$tmp_home" "$wrapper" --dry-run -- "a task" 2>&1); [ $? -eq 0 ] || fail "--dry-run (config) exit code"
echo "$dry4" | grep -q "offline.patch.yml" || fail "dry-run lacks the tracked overlay"
echo "$dry4" | grep -q "$tmp_home/neutered/overlay.yml" || fail "dry-run lacks the generated overlay"
echo "$dry4" | grep -q -E "llama-server .*-c 32768|server: external" || fail "dry-run lacks the server plan"
rm -rf "$tmp_home"

# --keep-server is accepted on the task path.
dry5=$("$wrapper" --keep-server --dry-run --dsh /bin/echo -- hi 2>&1); [ $? -eq 0 ] || fail "--keep-server not accepted"

echo "dsh-neutered.test: rc=$rc"
```

- [ ] **Step 2: Run the contract test to verify the new assertions fail**

Run: `bash neutered/bin/test/dsh-neutered.test.sh`
Expected: `FAIL: setup -h exit code` (and the other new lines), `dsh-neutered.test: rc=1`

- [ ] **Step 3: Apply the wrapper edits through dsh**

Prompt file `prompt-task9-wrapper.txt`: the protocol preamble, then these five replacements for `neutered/bin/dsh-neutered`, in order.

Replacement 1 (header comment and usage block):

OLD:
```bash
# network from bash-tool children.
#
# Usage:
#   dsh-neutered [--dsh <path>] [--dry-run] [-- <task text and dsh args>]
#   dsh-neutered -h | --help
#
# --dsh <path>   Use this built CLI entry (default: apps/cli/lib/bin.js next to
#                this checkout, else `dsh` on PATH).
# --dry-run      Print the exact command and environment, then exit 0.
# Everything after `--` is forwarded to the headless app unchanged.
set -euo pipefail
```
NEW:
```bash
# network from bash-tool children.
#
# `setup` and `settings` are the one exception: they run neutered/setup/setup.cjs
# without the guard to install llama.cpp and download a model (see
# neutered/setup/README.md). A task run never downloads anything; when no
# configuration exists yet it runs setup first, then the task. When nothing
# answers on 127.0.0.1:1234 the wrapper starts llama-server detached and stops
# it after the task unless --keep-server is given.
#
# Usage:
#   dsh-neutered [--dsh <path>] [--dry-run] [--keep-server] [-- <task text and dsh args>]
#   dsh-neutered setup    [--yes] [--model <id>] [--context <n>] [--force]
#   dsh-neutered settings [--show] [--model <id>] [--context <n>] [--keep-server on|off] [--stop-server] [--reset]
#   dsh-neutered -h | --help
set -euo pipefail
```

Replacement 2 (variables):

OLD:
```bash
overlay="$neutered/offline.patch.yml"

dsh_bin=""
dry_run=0
args=()
```
NEW:
```bash
overlay="$neutered/offline.patch.yml"
setup_cjs="$neutered/setup/setup.cjs"

dsh_bin=""
dry_run=0
keep_server=0
mode="run"
args=()
```

Replacement 3 (usage text):

OLD:
```bash
Runs the headless profile with a loopback-only egress guard. The single
permitted network destination is http://127.0.0.1:1234/v1 (a local
OpenAI-compatible model server, e.g. llama-server on port 1234).

Usage:
  dsh-neutered [--dsh <path>] [--dry-run] [-- <task text>]
  dsh-neutered -h | --help

  --dsh <path>   built CLI entry to run (default: the checkout's apps/cli/lib/bin.js, else dsh on PATH)
  --dry-run      print the command and environment, then exit
  -- <args>      everything after -- is forwarded to the headless app

This build has no privacy levels, no -p flag and no web UI.
USAGE
```
NEW:
```bash
Runs the headless profile with a loopback-only egress guard. The single
permitted network destination is http://127.0.0.1:1234/v1 (a local
OpenAI-compatible model server; dsh-neutered starts llama-server there itself
when nothing is listening, and stops it after the task).

Usage:
  dsh-neutered [--dsh <path>] [--dry-run] [--keep-server] [-- <task text>]
  dsh-neutered setup    [--yes] [--model <id>] [--context <n>] [--force]
  dsh-neutered settings [--show] [--model <id>] [--context <n>] [--keep-server on|off] [--stop-server] [--reset]
  dsh-neutered -h | --help

  --dsh <path>    built CLI entry to run (default: the checkout's apps/cli/lib/bin.js, else dsh on PATH)
  --dry-run       print the command, environment and server plan, then exit
  --keep-server   leave a llama-server this run started running afterwards
  -- <args>       everything after -- is forwarded to the headless app
  setup           first-run configuration: detect hardware, pick a model, download it (network)
  settings        show or change the model, context window and server behaviour

This build has no privacy levels, no -p flag and no web UI. Only setup and
settings --model use the network; a task run reaches 127.0.0.1:1234 and nothing else.
USAGE
```

Replacement 4 (argument loop):

OLD:
```bash
    -h|--help) usage; exit 0 ;;
    --dsh) shift; [ $# -gt 0 ] || { echo "dsh-neutered: --dsh needs a path" >&2; exit 2; }; dsh_bin="$1"; shift ;;
    --dry-run) dry_run=1; shift ;;
    --) shift; args=("$@"); break ;;
```
NEW:
```bash
    -h|--help) usage; exit 0 ;;
    setup|settings) mode="$1"; shift; args=("$@"); break ;;
    --dsh) shift; [ $# -gt 0 ] || { echo "dsh-neutered: --dsh needs a path" >&2; exit 2; }; dsh_bin="$1"; shift ;;
    --dry-run) dry_run=1; shift ;;
    --keep-server) keep_server=1; shift ;;
    --) shift; args=("$@"); break ;;
```

Replacement 5 (everything after the dsh_bin default, to the end of the file):

OLD:
```bash
node_options="--require=$guard"
if [ -n "${NODE_OPTIONS:-}" ]; then
  node_options="$NODE_OPTIONS $node_options"
fi

cmd=($dsh_bin --profile headless --patch "$overlay")
if [ ${#args[@]} -gt 0 ]; then
  cmd+=(-- "${args[@]}")
fi

if [ "$dry_run" -eq 1 ]; then
  echo "NODE_OPTIONS=$node_options"
  printf '%q ' "${cmd[@]}"; echo
  exit 0
fi

exec env NODE_OPTIONS="$node_options" "${cmd[@]}"
```
NEW:
```bash
# The task path carries the guard in NODE_OPTIONS. Setup calls must not, so
# they run with the caller's NODE_OPTIONS unchanged.
node_options="--require=$guard"
if [ -n "${NODE_OPTIONS:-}" ]; then
  node_options="$NODE_OPTIONS $node_options"
fi
setup_node() { NODE_OPTIONS="${NODE_OPTIONS:-}" node "$setup_cjs" "$@"; }

case "$mode" in
  setup) setup_node setup ${args[@]+"${args[@]}"}; exit $? ;;
  settings) setup_node settings ${args[@]+"${args[@]}"}; exit $? ;;
esac

user_overlay="$(setup_node overlay-path)"
if [ ! -f "$user_overlay" ]; then
  if [ "$dry_run" -eq 1 ]; then
    echo "setup: would run first (no $user_overlay)"
  else
    echo "dsh-neutered: no configuration yet; running first-time setup" >&2
    setup_node setup || exit $?
  fi
fi

cmd=($dsh_bin --profile headless --patch "$overlay" --patch "$user_overlay")
if [ ${#args[@]} -gt 0 ]; then
  cmd+=(-- "${args[@]}")
fi

if [ "$dry_run" -eq 1 ]; then
  echo "NODE_OPTIONS=$node_options"
  printf '%q ' "${cmd[@]}"; echo
  setup_node server plan
  exit 0
fi

# Start llama-server when nothing answers; it is spawned detached by setup.cjs,
# so it is not part of this process tree. Stop it afterwards unless asked to keep it.
started=0
ensure_out="$(setup_node server ensure)" || exit $?
case "$ensure_out" in
  started\ *) started=1 ;;
esac
cleanup() {
  if [ "$started" -eq 1 ] && [ "$keep_server" -eq 0 ]; then
    started=0
    setup_node server stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

set +e
env NODE_OPTIONS="$node_options" "${cmd[@]}"
rc=$?
set -e
exit "$rc"
```

Run the prompt as described in the delegation protocol, then `git diff neutered/bin/dsh-neutered`; the diff must contain exactly these five hunks. If dsh fails twice, apply the five replacements with the Edit tool and note it in the commit body.

- [ ] **Step 4: Run the contract test and the old assertions**

Run: `bash neutered/bin/test/dsh-neutered.test.sh`
Expected: `dsh-neutered.test: rc=0`

Run: `bash -n neutered/bin/dsh-neutered && /bin/bash --version | head -1`
Expected: no syntax error; the check ran under the system bash 3.2.

- [ ] **Step 5: Commit**

```bash
git add neutered/bin/dsh-neutered neutered/bin/test/dsh-neutered.test.sh
git commit -m "neutered: wrapper gains setup/settings, auto-setup, generated overlay and llama-server lifecycle"
```

---

### Task 10: Automatic install for a fresh clone

**Files:**
- Create: `neutered/bin/install`
- Test: `neutered/bin/test/install.test.sh`

**Interfaces:**
- Consumes: `neutered/bin/dsh-neutered setup [--yes]` and `settings --show` from Task 9.
- Produces: `bash neutered/bin/install [--no-setup] [--yes]`.

- [ ] **Step 1: Write the failing test**

```bash
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash neutered/bin/test/install.test.sh`
Expected: `FAIL: -h exit code` … `install.test: rc=1`

- [ ] **Step 3: Write the installer**

```bash
#!/bin/bash
# dsh-neutered — automatic setup for a fresh clone (macOS only).
#
# Installs the pnpm workspace, builds the CLI, then runs the first-time setup
# (hardware detection, model choice, llama.cpp and model download). Everything
# here uses the network on purpose; a task run afterwards never does.
#
# Usage: bash neutered/bin/install [--no-setup] [--yes]
#   --no-setup   install and build only; run neutered/bin/dsh-neutered setup later
#   --yes        accept the recommended model without asking
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
PNPM_VERSION="11.7.0"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=19

usage() { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

no_setup=0
setup_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-setup) no_setup=1; shift ;;
    --yes) setup_args+=("--yes"); shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install: dsh-neutered supports macOS only (this is $(uname -s))" >&2
  exit 2
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "install: warning: $(uname -m) Mac detected; inference will run on the CPU and be slow" >&2
fi

command -v git >/dev/null 2>&1 || { echo "install: git is required (xcode-select --install)" >&2; exit 3; }
if ! command -v node >/dev/null 2>&1; then
  echo "install: Node.js >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} is required: brew install node" >&2
  exit 3
fi
node_version="$(node --version | sed 's/^v//')"
node_major="${node_version%%.*}"
node_rest="${node_version#*.}"
node_minor="${node_rest%%.*}"
if [ "$node_major" -lt "$NODE_MIN_MAJOR" ] || { [ "$node_major" -eq "$NODE_MIN_MAJOR" ] && [ "$node_minor" -lt "$NODE_MIN_MINOR" ]; }; then
  echo "install: Node.js ${node_version} is too old; need >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} (brew install node)" >&2
  exit 3
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "install: enabling pnpm ${PNPM_VERSION} through corepack"
  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
fi

cd "$repo"
echo "install: pnpm install --frozen-lockfile (network: npm registry)"
pnpm install --frozen-lockfile
echo "install: pnpm run build"
pnpm run build

if [ "$no_setup" -eq 1 ]; then
  echo "install: build complete. Next: neutered/bin/dsh-neutered setup"
  exit 0
fi

if "$here/dsh-neutered" settings --show 2>/dev/null; then
  echo "install: existing configuration kept (change it with neutered/bin/dsh-neutered settings)"
else
  "$here/dsh-neutered" setup ${setup_args[@]+"${setup_args[@]}"}
fi

echo
echo "install: done. Run a task with:"
echo "  $here/dsh-neutered -- \"describe the task\""
if [ -d /opt/homebrew/bin ] && [ -w /opt/homebrew/bin ] && [ ! -e /opt/homebrew/bin/dsh-neutered ]; then
  echo "Optional: ln -s \"$here/dsh-neutered\" /opt/homebrew/bin/dsh-neutered"
fi
```

Then `chmod +x neutered/bin/install`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash neutered/bin/test/install.test.sh`
Expected: `install.test: rc=0`

- [ ] **Step 5: Commit**

```bash
git add neutered/bin/install neutered/bin/test/install.test.sh
git commit -m "neutered: automatic install script for a fresh clone"
```

---

### Task 11: Static egress gate allowlist (dsh-delegated edits)

**Files:**
- Modify: `neutered/gate/egress-grep.sh` (3 replacements)
- Modify: `neutered/gate/forbidden-patterns.txt` (1 replacement)
- Modify: `neutered/gate/README.md` (2 replacements)

**Interfaces:**
- Produces: `bash neutered/gate/egress-grep.sh` exits 0 with `neutered/setup/**` present and `huggingface\.co` forbidden everywhere else.

- [ ] **Step 1: Prove the gate currently rejects the setup path**

Run: `bash neutered/gate/egress-grep.sh; echo "exit=$?"`
Expected: `exit=1` with hits in `neutered/setup/lib/download.cjs` (`fetch`/`http` primitive patterns and, once Step 2 lands, `huggingface.co`). This is the invalid case the allowlist must reject-then-exclude.

- [ ] **Step 2: dsh prompt for `neutered/gate/forbidden-patterns.txt`**

OLD:
```
# ── DESTINATIONS ──
deepseeksvc\.com
```
NEW:
```
# ── DESTINATIONS ──
# huggingface.co is legal in exactly one place, neutered/setup/ (model download during
# `dsh-neutered setup`); the scan excludes that path, so a hit anywhere else is a leak.
huggingface\.co
deepseeksvc\.com
```

- [ ] **Step 3: dsh prompt for `neutered/gate/egress-grep.sh`** (three replacements)

Replacement 1:

OLD:
```bash
# Fails when the tree holds any known off-machine destination, or any
# network-capable primitive outside the three files allowed to have one:
#   neutered/guard/            (the runtime guard wraps the primitives on purpose)
#   neutered/gate/             (this gate names the primitives)
#   packages/llm/llm-local/    (the one HTTP client, pinned to loopback)
```
NEW:
```bash
# Fails when the tree holds any known off-machine destination, or any
# network-capable primitive outside the four paths allowed to have one:
#   neutered/guard/            (the runtime guard wraps the primitives on purpose)
#   neutered/gate/             (this gate names the primitives)
#   neutered/setup/            (first-run setup: Homebrew and Hugging Face, never on the task path)
#   packages/llm/llm-local/    (the one HTTP client, pinned to loopback)
```

Replacement 2 (the `common_excludes` line; add the setup glob right after the gate glob):

OLD:
```bash
common_excludes=(-g '!.git' -g '!neutered/gate/**' -g '!**/node_modules/**'
```
NEW:
```bash
common_excludes=(-g '!.git' -g '!neutered/gate/**' -g '!neutered/setup/**' -g '!**/node_modules/**'
```

Replacement 3:

OLD:
```bash
# Primitive scan: everywhere but the three allowed roots.
prim_excludes=("${common_excludes[@]}" -g '!neutered/guard/**' -g '!neutered/gate/**' -g '!packages/llm/llm-local/**' -g '!packages/test-support/**')
```
NEW:
```bash
# Primitive scan: everywhere but the four allowed roots.
prim_excludes=("${common_excludes[@]}" -g '!neutered/guard/**' -g '!neutered/gate/**' -g '!neutered/setup/**' -g '!packages/llm/llm-local/**' -g '!packages/test-support/**')
```

Replacement 2 replaces only the start of the long line; tell dsh "replace the leading text of that one line and leave the rest of the line unchanged".

- [ ] **Step 4: dsh prompt for `neutered/gate/README.md`** (two replacements)

Replacement 1:

OLD:
```
A mechanical, exit-code check that the source tree holds no off-machine
destination and no network primitive outside the three files allowed to have
one (`neutered/guard/`, `neutered/gate/`, `packages/llm/llm-local/`).
```
NEW:
```
A mechanical, exit-code check that the source tree holds no off-machine
destination and no network primitive outside the four paths allowed to have
one (`neutered/guard/`, `neutered/gate/`, `neutered/setup/`,
`packages/llm/llm-local/`). `neutered/setup/` is excluded from both scans
because `dsh-neutered setup` downloads a model from `huggingface.co` and
installs llama.cpp through Homebrew; nothing on the task path loads it
(`neutered/setup/README.md`).
```

Replacement 2 (append to the dynamic gate section; the heading is line 27 of the file):

OLD:
```
## Dynamic: `egress-capture.sh`
```
NEW:
```
## Dynamic: `egress-capture.sh`

The capture walks the wrapper's process tree. A `llama-server` the wrapper
starts is spawned detached by `neutered/setup/lib/server.cjs` and is therefore
outside that tree; only the dsh side of the loopback pair (`127.0.0.1:1234`) is
visible. Run the gate against an already-running server, as before.
```

- [ ] **Step 5: Verify the gate passes and still rejects a leak**

Run: `bash neutered/gate/egress-grep.sh; echo "exit=$?"`
Expected: `exit=0`

Run (negative control):
```bash
echo "const u = 'https://huggingface.co/x'" > packages/llm/llm-local/src/leak-probe.ts
bash neutered/gate/egress-grep.sh; echo "exit=$?"
rm packages/llm/llm-local/src/leak-probe.ts
```
Expected: `exit=1` naming `leak-probe.ts` and `huggingface\.co`, then the file is removed.

Run: `bash neutered/gate/test/egress-grep.test.sh; echo "exit=$?"` — the gate's own test.
Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add neutered/gate/egress-grep.sh neutered/gate/forbidden-patterns.txt neutered/gate/README.md
git commit -m "neutered: static gate allowlists neutered/setup and forbids huggingface.co elsewhere"
```

---

### Task 12: Inventory, overlay comment and progress log (dsh-delegated edits)

**Files:**
- Modify: `neutered/INVENTORY.md` (3 replacements)
- Modify: `neutered/offline.patch.yml` (1 replacement)
- Modify: `neutered/PROGRESS.md` (2 replacements)

- [ ] **Step 1: dsh prompt for `neutered/INVENTORY.md`**

Replacement 1 (legend):

OLD:
```
- `keep-loopback` — the code stays and only ever touches loopback (127.0.0.1), including the
  one permitted destination `127.0.0.1:1234`.
```
NEW:
```
- `keep-loopback` — the code stays and only ever touches loopback (127.0.0.1), including the
  one permitted destination `127.0.0.1:1234`.
- `setup-only` — reachable only from `dsh-neutered setup` / `settings --model`
  (`neutered/setup/`), never from a task run; excluded from the static gate by path.
```

Replacement 2 (Table 1, after the llm-local row):

OLD:
```
| packages/llm/llm-local/src/index.ts:1 (NEW, step 3) | https-request (fetch, SSE) | constant `http://127.0.0.1:1234/v1` — model id and context window configurable, base URL fixed | every model call in the neutered headless profile | keep-loopback |
```
NEW:
```
| packages/llm/llm-local/src/index.ts:1 (NEW, step 3) | https-request (fetch, SSE) | constant `http://127.0.0.1:1234/v1` — model id and context window configurable, base URL fixed | every model call in the neutered headless profile | keep-loopback |
| neutered/setup/lib/download.cjs:1 (NEW, step 8) | subprocess (`hf download` / `curl`, `brew install llama.cpp`) | `https://huggingface.co/<repo>/resolve/main/<file>`; Homebrew's mirrors | `dsh-neutered setup`, `settings --model` | setup-only |
| neutered/setup/lib/server.cjs:1 (NEW, step 8) | http-request (`/health`), subprocess (`llama-server --host 127.0.0.1 --port 1234`) | `127.0.0.1:1234` | every task run (start, poll, stop the local server) | keep-loopback |
```

Replacement 3 (Table 4, after its header rows):

OLD:
```
| .github/workflows/e2e.yml:118 | config-remote-dest | `DEEPSEEK_BASE_URL: https://api.deepseek.com` | CI real-API e2e | gate-exclude (dev-only CI) |
```
NEW:
```
| neutered/setup/verify-catalog.cjs:1 | https-request (`https://huggingface.co/api/models/<repo>/tree/main`) | huggingface.co | maintainer runs it by hand to pin catalog sizes and hashes | gate-exclude (dev-only, under the excluded setup path) |
| .github/workflows/e2e.yml:118 | config-remote-dest | `DEEPSEEK_BASE_URL: https://api.deepseek.com` | CI real-API e2e | gate-exclude (dev-only CI) |
```

- [ ] **Step 2: dsh prompt for `neutered/offline.patch.yml`**

OLD:
```yaml
# named `local` with a generous context window, which the wrapper's caller can
# override by editing this file. The runtime endpoint is fixed at
# http://127.0.0.1:1234/v1 by the llm-local adapter and enforced by the guard.
```
NEW:
```yaml
# named `local` with a generous context window. `dsh-neutered setup` writes a
# second overlay, $DSH_HOME/neutered/overlay.yml, with the chosen model's name
# and the context window sized for the machine; the wrapper applies it after
# this file, so its values win. The runtime endpoint is fixed at
# http://127.0.0.1:1234/v1 by the llm-local adapter and enforced by the guard.
```

- [ ] **Step 3: dsh prompt for `neutered/PROGRESS.md`**

Replacement 1 (a new Done entry; anchor on the `## Next` heading):

OLD:
```
## Next
```
NEW:
```
- [x] Step 8 (2026-09-04): first-run setup. `neutered/bin/install` installs, builds and hands off
      to `neutered/bin/dsh-neutered setup`, which probes the Mac (`neutered/setup/lib/hardware.cjs`),
      ranks `neutered/setup/catalog.json` by fit, installs llama.cpp with Homebrew, downloads the
      chosen GGUF from Hugging Face, sizes the context window from the GGUF header
      (`gguf-header.cjs`, `sizing.cjs`) and writes `$DSH_HOME/neutered/{config.json,overlay.yml}`.
      The wrapper applies the generated overlay as a second `--patch`, starts `llama-server`
      detached when 127.0.0.1:1234 is silent and stops it after the task; `settings` changes the
      model, context and keep-server. Design: `neutered/docs/2026-09-04-first-run-setup-design.md`.
      Verified: `node --test 'neutered/setup/test/**/*.test.cjs'`, both wrapper tests,
      `egress-grep.sh` exit 0 with the new `neutered/setup/**` exclusion, `egress-capture.sh` PASS.

## Next
```

Replacement 2 (decisions; the OLD anchor is the last line of D16, line 409 of the file):

OLD:
```
    artifact is still loopback-only while the tests stay runnable.
```
NEW:
```
    artifact is still loopback-only while the tests stay runnable.

 - D17: First-run setup lives in `neutered/setup/` and is the one network-using path of the fork.
   It runs without the guard, only from `dsh-neutered setup` and `settings --model`; the static
   gate excludes `neutered/setup/**` and forbids `huggingface\.co` everywhere else.
 - D18: macOS only. Apple Silicon budget is 75 % of RAM at 36 GiB or more, else 67 %, minus
   min(2 GiB, RAM / 8); Intel Macs get 50 %. `DSH_NEUTERED_BUDGET_GIB` overrides.
 - D19: The wrapper starts `llama-server` detached when the port is silent and stops it after the
   task (`--keep-server` or `server.keep` leaves it). An already healthy server is used as is.
 - D20: The model list is a curated `catalog.json` plus a custom `owner/repo:file.gguf` or local
   path. Context = largest of 32k/64k/128k/256k that fits weights + KV (from the GGUF header) +
   buffers, capped at the native context; `maxTokens = min(32768, ctx / 4)`.
 - D21: The root README is the fork's page; upstream's README stays in history (`05def55a68`).
   `README.zh.md` and `README.i18n.yaml` are removed and `README.md` is listed in
   `scripts/translation-pairing.manifest.json` `excluded`.
```

- [ ] **Step 4: Verify**

Run: `git diff --stat` — exactly the three files. Run: `grep -c 'setup-only' neutered/INVENTORY.md` → `3` (legend plus two rows). Run: `bash neutered/gate/egress-grep.sh; echo "exit=$?"` → `exit=0` (Markdown is excluded from the scan; this confirms nothing else moved).

- [ ] **Step 5: Commit**

```bash
git add neutered/INVENTORY.md neutered/offline.patch.yml neutered/PROGRESS.md
git commit -m "neutered: inventory rows, overlay comment and progress log for first-run setup"
```

---

### Task 13: Documentation, catalog maintenance script, translation manifest

**Files:**
- Create (Claude): `neutered/setup/README.md`, `neutered/setup/verify-catalog.cjs`
- Replace (Claude): `README.md` (root)
- Delete (Claude): `README.zh.md`, `README.i18n.yaml`
- Modify (Claude, 1 line): `scripts/translation-pairing.manifest.json`
- Modify (dsh, 2 replacements): `neutered/README.md`

- [ ] **Step 1: Write `neutered/setup/README.md`**

```markdown
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
```

- [ ] **Step 2: Write `neutered/setup/verify-catalog.cjs`**

```js
#!/usr/bin/env node
// neutered/setup/verify-catalog.cjs
'use strict'

// Maintainer tool (network): pin catalog sizes and SHA-256 hashes from the Hugging Face API and
// fail on file names that do not exist in their repository. Never run by a gate or a test.

const fs = require('node:fs')
const https = require('node:https')
const { CATALOG_PATH, loadCatalog } = require('./lib/catalog.cjs')

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'dsh-neutered-verify-catalog' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`${url}: HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject)
  })
}

async function listTree(repo) {
  const tree = await getJson(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`)
  const byPath = new Map()
  for (const item of tree) {
    if (item.type === 'file') byPath.set(item.path, { size: item.size, sha256: item.lfs ? item.lfs.sha256 : null })
  }
  return byPath
}

async function main() {
  const catalog = loadCatalog(CATALOG_PATH)
  const trees = new Map()
  const problems = []
  for (const entry of catalog) {
    if (!trees.has(entry.repo)) trees.set(entry.repo, await listTree(entry.repo))
    const tree = trees.get(entry.repo)
    let total = 0
    const hashes = []
    for (const file of entry.files) {
      const info = tree.get(file)
      if (!info) {
        problems.push(`${entry.id}: ${file} is not in ${entry.repo}`)
        continue
      }
      total += info.size
      hashes.push(info.sha256 || '')
    }
    if (hashes.length === entry.files.length) {
      entry.sizeBytes = total
      entry.sha256 = hashes.every(Boolean) ? hashes : []
      entry.pinned = true
      process.stdout.write(`${entry.id}: ${total} bytes${entry.sha256.length ? ', sha256 pinned' : ''}\n`)
    }
  }
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n')
  if (problems.length) {
    process.stderr.write(problems.join('\n') + '\n')
    process.exit(1)
  }
}

main().catch((error) => {
  process.stderr.write(`verify-catalog: ${error.message}\n`)
  process.exit(1)
})
```

Then `chmod +x neutered/setup/verify-catalog.cjs`.

- [ ] **Step 3: Run the maintenance script once (network) and fix any file name it rejects**

Run: `node neutered/setup/verify-catalog.cjs; echo "exit=$?"`
Expected: one line per entry with exact bytes; `exit=0`. If it prints `<id>: <file> is not in <repo>`, open `https://huggingface.co/<repo>/tree/main` in a browser, correct the file name in `catalog.json` (keep the quant the spec names; if that quant does not exist, take the nearest `UD-Q4_K_XL`/`Q4_K_M`), rerun until `exit=0`.

Run: `node --test 'neutered/setup/test/**/*.test.cjs'`
Expected: still `# fail 0` (the catalog test validates the pinned file).

- [ ] **Step 4: Replace the root `README.md`**

```markdown
# dsh-neutered

An offline fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It runs
the headless coding agent against one local model server on `http://127.0.0.1:1234/v1` and
nothing else: the code that could reach the network is removed from the tree, a Node preload
guard blocks every other socket, and macOS Seatbelt denies the network to bash-tool children.

macOS only. Apple Silicon recommended; Intel Macs run on the CPU and are slow.

## Quick start

```sh
git clone https://github.com/<your-user>/dsh-neutered.git
cd dsh-neutered
bash neutered/bin/install
neutered/bin/dsh-neutered -- "run the tests and fix the first failure"
```

`install` needs Node.js 22.19 or newer and Homebrew. It installs the workspace, builds the CLI
and runs the first-time setup: it reads your machine's memory, lists the models that fit with
the recommended one first, asks you to pick one (Enter accepts), installs llama.cpp, downloads
the model into `~/.dsh/neutered/models/` and sizes the context window. That is the only time
the network is used.

Each task run starts `llama-server` when nothing is listening on port 1234, runs the agent, and
stops the server again. Pass `--keep-server` to leave it running, or start your own server
(LM Studio, llama-server) and the wrapper uses it.

```sh
neutered/bin/dsh-neutered settings                 # show the configuration
neutered/bin/dsh-neutered settings --model <id>    # switch model (downloads if needed)
neutered/bin/dsh-neutered settings --context 65536 # change the context window
neutered/bin/dsh-neutered -h                       # all options
```

## Which model fits

| Machine memory | Fits | Recommended |
|---|---|---|
| 16 GiB | Qwen3.5-9B | Qwen3.5-9B UD-Q4_K_XL, 32k context |
| 32 GiB | Qwen3.8-27B 4-bit, Qwen3.8-27B 3-bit, gpt-oss-20b, Qwen3.5-9B | Qwen3.8-27B UD-Q4_K_XL, 32k context |
| 64 GiB | everything but gpt-oss-120b | Qwen3.8-27B UD-Q4_K_XL, 256k context |
| 128 GiB | everything in the catalog | Qwen3.8-27B UD-Q4_K_XL, 256k context |

The list is `neutered/setup/catalog.json`; the setup also accepts any Hugging Face
`owner/repo:file.gguf` or a local `.gguf` path.

## How egress is contained

1. **Source deletion.** The DeepSeek API route, telemetry, web tools, MCP, e2b, webhooks, the
   plugin manager, the multi-provider adapter, the web UI, the SDKs and the website are gone
   from the tree. `git log` on the `neutered` branch is the record.
2. **`llm-local`.** The one HTTP client accepts only plain HTTP to `127.0.0.1`.
3. **Node preload guard.** Every socket, DNS, HTTP and `fetch` primitive is wrapped; anything
   but `127.0.0.1:1234` throws `EGRESS_BLOCKED`.
4. **macOS Seatbelt.** Bash-tool children run under `(deny network*)` plus one loopback allow.

The one exception is setup itself: `neutered/setup/` downloads a model from Hugging Face and
installs llama.cpp with Homebrew, runs without the guard, and is never loaded by a task run.
Details, audit commands and the network inventory: [neutered/README.md](neutered/README.md),
[neutered/setup/README.md](neutered/setup/README.md), [neutered/INVENTORY.md](neutered/INVENTORY.md).

## Safety and licence

Read [SAFETY.md](SAFETY.md) before running an autonomous agent on your files. This fork keeps
upstream's [MIT licence](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Upstream's
own README is in history at `05def55a68`.
```

Then:

```bash
git rm -q README.zh.md README.i18n.yaml
```

- [ ] **Step 5: Exclude the root README from translation pairing**

Edit `scripts/translation-pairing.manifest.json`: in the `excluded` array add `"README.md",` as the first entry (before `".agents/notes/AGENTS.md"`), keeping the array alphabetical order is not required.

Run: `node_modules/.bin/tsx scripts/verify-translation-pairing.ts --list; echo "exit=$?"`
Expected: `exit=0` and no line mentioning `README.md`.

- [ ] **Step 6: dsh prompt for `neutered/README.md`** (two replacements)

Replacement 1 (the Run section):

OLD:
```
## Run

Start a local model server on port 1234 first, for example:

```
llama-server --host 127.0.0.1 --port 1234 -m <model>.gguf -c 131072 -ngl 99
```

Then:

```
neutered/bin/dsh-neutered -- "run the tests and fix the first failure"
```

The wrapper loads the guard, boots the headless profile with
`neutered/offline.patch.yml`, and forwards everything after `--` to the agent.
`--dry-run` prints the exact command and environment; `--dsh <path>` points at
another built CLI; `-h` explains the single offline posture. There are no
privacy levels, no `-p` flag and no web UI.

`neutered/offline.patch.yml` pins the local model catalog; edit its `models`
list and context window to match the model your server serves.
```
NEW:
```
## Run

From a fresh clone, `bash neutered/bin/install` installs the workspace, builds
the CLI and runs the first-time setup; `neutered/bin/dsh-neutered setup` runs
that setup alone. Setup detects the machine, asks which model to use (Enter
accepts the recommendation), installs llama.cpp with Homebrew, downloads the
model and writes `~/.dsh/neutered/config.json` plus `overlay.yml`
([neutered/setup/README.md](setup/README.md)).

```
neutered/bin/dsh-neutered -- "run the tests and fix the first failure"
```

The wrapper loads the guard, boots the headless profile with
`neutered/offline.patch.yml` and the generated `~/.dsh/neutered/overlay.yml`,
starts `llama-server` on 127.0.0.1:1234 when nothing answers there (and stops
it after the task unless `--keep-server` is given), and forwards everything
after `--` to the agent. An already-running server, LM Studio for example, is
used as is. `--dry-run` prints the exact command, environment and server plan;
`--dsh <path>` points at another built CLI; `-h` explains the single offline
posture. There are no privacy levels, no `-p` flag and no web UI.

`neutered/bin/dsh-neutered settings` shows the configuration or changes the
model (`--model`), the context window (`--context`) and whether a started server
stays up (`--keep-server on|off`).

## Network exception

`neutered/setup/` is the one network-using path of the fork: it reaches
`https://huggingface.co/<repo>/resolve/main/<file>` and runs
`brew install llama.cpp`, only from `setup` and `settings --model`, and without
the guard. A task run never loads it; `llama-server` is started from a local
`.gguf` path. The static gate excludes that directory and forbids
`huggingface.co` everywhere else.
```

Replacement 2 (the Audit list):

OLD:
```
- `node --test 'neutered/guard/test/**/*.test.cjs'` — the guard's own suite.
- `bash neutered/bin/test/dsh-neutered.test.sh` — the wrapper's contract.
```
NEW:
```
- `node --test 'neutered/guard/test/**/*.test.cjs'` — the guard's own suite.
- `node --test 'neutered/setup/test/**/*.test.cjs'` — the setup libraries, offline.
- `bash neutered/bin/test/dsh-neutered.test.sh` — the wrapper's contract.
- `bash neutered/bin/test/install.test.sh` — the installer's offline contract.
```

- [ ] **Step 7: Verify the docs**

Run: `git status --short` → `README.md` modified, `README.zh.md` and `README.i18n.yaml` deleted, manifest modified, `neutered/README.md` modified, two new files.
Run: `grep -c 'neutered/bin/install' README.md neutered/README.md` → at least 1 each.
Run: `bash neutered/gate/egress-grep.sh; echo "exit=$?"` → `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add README.md README.zh.md README.i18n.yaml scripts/translation-pairing.manifest.json neutered/README.md neutered/setup/README.md neutered/setup/verify-catalog.cjs neutered/setup/catalog.json
git commit -m "neutered: fork README at the root, setup README, catalog pinned from the Hugging Face API"
```

If the `translation pairing` pre-commit hook rejects the deletion, read its message; the expected fix is the manifest exclusion from Step 5. Do not commit with `--no-verify`.

---

### Task 14: Whole-tree verification and acceptance on this machine

**Files:** none new. This task proves the branch.

- [ ] **Step 1: Offline checks**

```bash
node --test 'neutered/setup/test/**/*.test.cjs'
node --test 'neutered/guard/test/**/*.test.cjs'
bash neutered/bin/test/dsh-neutered.test.sh
bash neutered/bin/test/install.test.sh
bash neutered/gate/egress-grep.sh
```
Expected: `# fail 0` twice, `rc=0` twice, gate `exit 0`.

- [ ] **Step 2: Build**

Run: `pnpm run build; echo "exit=$?"`
Expected: `exit=0` (nothing under `packages/` or `apps/` changed; this proves the tree still builds).

- [ ] **Step 3: Dynamic gate against the running LM Studio server**

Run: `curl -s -m 3 http://127.0.0.1:1234/health; echo; bash neutered/gate/egress-capture.sh; echo "exit=$?"`
Expected: `{"status":"ok"}` then `egress-capture: PASS peers=[127.0.0.1:1234] …`, `exit=0`. The wrapper must report the LM Studio server as external (no `llama-server` in `ps`).

- [ ] **Step 4: First-run acceptance in a temporary clone (network, ~20 GB download)**

```bash
tmp=$(mktemp -d)
git clone -q --branch worktree-neutered-setup /Users/m/Documents/dsh_neutered/dsh-neutered "$tmp/dsh-neutered"
cd "$tmp/dsh-neutered"
DSH_HOME="$tmp/home" bash neutered/bin/install --yes
```
Expected: `pnpm install --frozen-lockfile` and `pnpm run build` succeed; setup prints the machine line with `46.0 GiB`, lists the models with Qwen3.8-27B UD-Q4_K_XL first, installs llama.cpp, downloads the model, prints `Context window: 262144 …` (or 131072 if the header shows a dense KV layout), writes config and overlay.

If `pnpm install --frozen-lockfile` fails with a lockfile mismatch: run `pnpm install` in the worktree, commit `pnpm-lock.yaml` with the message "neutered: refresh lockfile after the step 2 removals", and repeat this step.

- [ ] **Step 5: Task run with the wrapper starting and stopping the server**

Stop LM Studio's server first (or its model), so port 1234 is silent, then:

```bash
DSH_HOME="$tmp/home" neutered/bin/dsh-neutered -- "print the word PONG and stop"
pgrep -fl llama-server || echo "server stopped"
DSH_HOME="$tmp/home" neutered/bin/dsh-neutered --keep-server -- "print the word PONG and stop"
pgrep -fl llama-server
DSH_HOME="$tmp/home" neutered/bin/dsh-neutered settings --stop-server
```
Expected: first run prints `llama-server: started pid …`, loading progress, the agent answers PONG, then `server stopped`; the second run leaves `llama-server` in `pgrep`; `settings --stop-server` prints `server: stopped`.

- [ ] **Step 6: Settings**

```bash
DSH_HOME="$tmp/home" neutered/bin/dsh-neutered settings --context 65536
grep contextWindow "$tmp/home/neutered/overlay.yml"
DSH_HOME="$tmp/home" neutered/bin/dsh-neutered settings --show
```
Expected: `Updated context; wrote …`, the overlay shows `contextWindow: 65536` twice, `--show` lists the model, context 65536 and `server: silent`.

- [ ] **Step 7: Clean up and record**

```bash
rm -rf "$tmp"
```
Add the acceptance result (date, machine, model, context chosen, wall time of the download) to the Step 8 entry in `neutered/PROGRESS.md` as a one-line "Acceptance:" sentence via a dsh prompt or directly, and commit:

```bash
git add neutered/PROGRESS.md
git commit -m "neutered: record first-run setup acceptance on the M4 Max"
```

- [ ] **Step 8: Hand back**

Report: branch `worktree-neutered-setup` in `.claude/worktrees/neutered-setup`, the commit list, the acceptance numbers, and that nothing was pushed (the only remote is upstream). Next step for Marco: merge this branch and `worktree-llama-sidecar` into `neutered` (see the merge notes below), then add his GitHub fork as a remote and push.

---

## Merge notes: relationship to `worktree-llama-sidecar`

Decision (Marco, 2026-09-05): this plan is executed as written and merged independently of the
llama sidecar branch. Both branches base on `05def55a68`. The sidecar commit `64715244cd` adds a
pinned `llama-server` under `neutered/llama/` (tarball verified by SHA-256, `install.sh <local
tarball>`, no network) and wrapper flags `--model <gguf> --ctx <n> --idle-seconds <n>
--keep-server --llama-dir --server-arg --load-timeout`, plus `DSH_NEUTERED_MODEL` and
`DSH_NEUTERED_TEST_PORT`. It has no hardware detection, catalog, download or saved settings.

Files both branches change, and what to keep when the second one is merged:

| File | Sidecar side | This branch | Resolution |
|---|---|---|---|
| `neutered/bin/dsh-neutered` | server lifecycle in bash, `--model/--ctx` flags | `setup`/`settings` dispatch, auto-setup, second `--patch`, lifecycle through `setup.cjs server` | Keep the sidecar's lifecycle and flags; keep this branch's dispatch, overlay and auto-setup; make the wrapper default `model` and `ctx` from `config.json` when the flags and `DSH_NEUTERED_MODEL` are absent; drop the `server ensure`/`stop` calls. `server.cjs` stays only for `status`/`plan`, or is deleted with its test. |
| `neutered/bin/test/dsh-neutered.test.sh` | lifecycle tests on `DSH_NEUTERED_TEST_PORT` | setup/settings/dry-run tests | Keep both blocks; the dry-run assertion on the server plan changes to the sidecar's plan line. |
| `neutered/gate/egress-grep.sh` | excludes `neutered/llama/bin/**`, root detection fix | excludes `neutered/setup/**` | Keep both excludes and the root fix. |
| `neutered/gate/forbidden-patterns.txt` | adds `huggingface\.co` | adds `huggingface\.co` | Keep one entry; merge the two comments. |
| `neutered/gate/README.md`, `neutered/README.md`, `neutered/PROGRESS.md` | sidecar sections, "step 8" | setup sections, "step 8" | Keep both texts; renumber this branch's entry to step 9 and its decisions to D22–D26 if the sidecar merges first. |
| `neutered/setup/lib/download.cjs` | — | `brew install llama.cpp` | After the merge, replace the Homebrew branch with: download the asset named in `neutered/llama/VERSION` from `https://github.com/ggml-org/llama.cpp/releases/download/<tag>/<asset>` and run `neutered/llama/install.sh <tarball>`. Until then the two server binaries coexist: the sidecar's `neutered/llama/bin/llama-server` when `--model` is given, Homebrew's when the configuration path starts it. |

The merge is a separate task with its own plan; nothing in Tasks 1–14 depends on the sidecar.
