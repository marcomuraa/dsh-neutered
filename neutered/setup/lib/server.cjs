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
    const req = http.get({ host: endpoint.host, port: endpoint.port, path: pathname, timeout: timeoutMs, agent: false }, (res) => {
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
