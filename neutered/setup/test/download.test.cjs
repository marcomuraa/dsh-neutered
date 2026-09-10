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
