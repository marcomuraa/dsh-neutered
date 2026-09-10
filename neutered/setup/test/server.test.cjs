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
