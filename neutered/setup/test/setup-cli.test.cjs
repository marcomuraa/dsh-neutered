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
    const noConfig = run(['server', 'plan'], { DSH_HOME: home }).out.trim()
    assert.ok(noConfig === 'server: setup required' || noConfig === 'server: external', noConfig)
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
