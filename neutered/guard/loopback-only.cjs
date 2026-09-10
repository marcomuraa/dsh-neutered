'use strict'

// dsh-neutered runtime egress guard.
//
// Preloaded into every Node process of the product through
// NODE_OPTIONS=--require=<absolute path to this file>. It makes it impossible
// for the process, its worker threads, and its Node children (which inherit
// NODE_OPTIONS) to open any network connection except plain TCP to the local
// model server. The one permitted destination is the literal IPv4 address
// 127.0.0.1 on TCP port 1234. There is no configuration and no allowlist file.
// Anything else fails closed.
//
// Non-Node children (curl, git, python) are not covered here; the macOS
// Seatbelt profile that wraps the bash tool and the optional pf recipe cover
// them. This file never opens a socket of its own.

const net = require('node:net')
const tls = require('node:tls')
const dgram = require('node:dgram')
const dns = require('node:dns')
const http = require('node:http')
const https = require('node:https')

const ALLOWED_HOST = '127.0.0.1'
const ALLOWED_PORT = 1234

const GUARD_APPLIED = Symbol.for('dsh-neutered.guard.applied')
const WRAPPED = Symbol.for('dsh-neutered.guard.wrapped')

/** A destination is permitted only when it is exactly 127.0.0.1:1234. */
function isAllowed(host, port) {
  return host === ALLOWED_HOST && Number(port) === ALLOWED_PORT
}

const loggedDestinations = new Set()

function logBlocked(host, port, api) {
  const key = `${host}:${port}|${api}`
  if (loggedDestinations.has(key)) return
  loggedDestinations.add(key)
  const line = `dsh-neutered guard: blocked ${host}:${port} via ${api}`
  try {
    process.stderr.write(line + '\n')
  } catch {
    /* stderr may be closed; a blocked call still throws below */
  }
  try {
    const os = require('node:os')
    const path = require('node:path')
    const fs = require('node:fs')
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    fs.mkdirSync(home, { recursive: true })
    fs.appendFileSync(path.join(home, 'egress-blocked.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* file logging is best-effort; never let it mask the block */
  }
}

/** Build the EGRESS_BLOCKED error and record the attempt. */
function blocked(host, port, api) {
  logBlocked(host, port, api)
  const error = new Error(`dsh-neutered guard: egress to ${host}:${port} via ${api} is blocked; only ${ALLOWED_HOST}:${ALLOWED_PORT} is permitted`)
  error.code = 'EGRESS_BLOCKED'
  return error
}

// ── net.Socket.prototype.connect ────────────────────────────────────────────
// Signatures: connect(options[, cb]); connect(port[, host][, cb]);
// connect(path[, cb]) for a Unix domain socket, which is not network and is
// allowed. Parse enough to decide; leave the original to do the real work.
function parseConnectArgs(args) {
  // Node normalizes the public call and invokes Socket.prototype.connect with a
  // single [options, callback] array. Unwrap that so the option object below is read.
  if (Array.isArray(args[0])) args = args[0]
  const first = args[0]
  if (first !== null && typeof first === 'object') {
    if (typeof first.path === 'string') return { unix: true }
    if (first.port === undefined && typeof first.host !== 'string' && first.pipe === undefined && first.fd === undefined) {
      // Not a TCP options object we can read; treat as blockable with unknown host.
      return { host: String(first.host ?? ''), port: Number(first.port) }
    }
    return { host: first.host === undefined ? 'localhost' : String(first.host), port: Number(first.port) }
  }
  if (typeof first === 'string') {
    // A string first argument is a Unix socket path unless it parses as a port.
    if (/^\d+$/.test(first)) {
      const second = args[1]
      const host = typeof second === 'string' ? second : 'localhost'
      return { host, port: Number(first) }
    }
    return { unix: true }
  }
  // Numeric port form: connect(port[, host]).
  const second = args[1]
  const host = typeof second === 'string' ? second : 'localhost'
  return { host, port: Number(first) }
}

function wrapConnect(target, api) {
  const original = target.connect
  if (typeof original !== 'function' || original[WRAPPED]) return
  function guarded(...args) {
    const parsed = parseConnectArgs(args)
    if (parsed.unix) return original.apply(this, args)
    if (!isAllowed(parsed.host, parsed.port)) {
      throw blocked(parsed.host || '(unknown)', Number.isFinite(parsed.port) ? parsed.port : '(unknown)', api)
    }
    return original.apply(this, args)
  }
  guarded[WRAPPED] = true
  target.connect = guarded
}

// ── tls.connect ─────────────────────────────────────────────────────────────
function wrapTlsConnect() {
  const original = tls.connect
  if (typeof original !== 'function' || original[WRAPPED]) return
  function guarded(...args) {
    const parsed = parseConnectArgs(args)
    if (!parsed.unix && !isAllowed(parsed.host, parsed.port)) {
      throw blocked(parsed.host || '(unknown)', Number.isFinite(parsed.port) ? parsed.port : '(unknown)', 'tls.connect')
    }
    return original.apply(this, args)
  }
  guarded[WRAPPED] = true
  tls.connect = guarded
}

// ── dgram: UDP is never needed; block send and connect outright ──────────────
function wrapDgram() {
  const proto = dgram.Socket.prototype
  for (const method of ['send', 'connect']) {
    const original = proto[method]
    if (typeof original !== 'function' || original[WRAPPED]) continue
    function guarded() {
      throw blocked('*', '*', `dgram.${method}`)
    }
    guarded[WRAPPED] = true
    proto[method] = guarded
  }
}

// ── DNS: block every resolution; the product dials 127.0.0.1 by IP ───────────
function wrapDnsFamily(object, names, prefix) {
  for (const name of names) {
    const original = object[name]
    if (typeof original !== 'function' || original[WRAPPED]) continue
    function guarded(...args) {
      const cb = args[args.length - 1]
      const error = blocked('(dns)', '(dns)', `${prefix}.${name}`)
      if (typeof cb === 'function') {
        process.nextTick(cb, error)
        return undefined
      }
      throw error
    }
    guarded[WRAPPED] = true
    object[name] = guarded
  }
}

function wrapDnsPromises(object, names, prefix) {
  for (const name of names) {
    const original = object[name]
    if (typeof original !== 'function' || original[WRAPPED]) continue
    function guarded() {
      return Promise.reject(blocked('(dns)', '(dns)', `${prefix}.${name}`))
    }
    guarded[WRAPPED] = true
    object[name] = guarded
  }
}

const DNS_METHODS = ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveTxt', 'resolveSrv', 'resolvePtr', 'reverse', 'lookupService']

function wrapDns() {
  wrapDnsFamily(dns, DNS_METHODS, 'dns')
  if (dns.promises) wrapDnsPromises(dns.promises, DNS_METHODS, 'dns.promises')
  if (typeof dns.Resolver === 'function') wrapDnsFamily(dns.Resolver.prototype, DNS_METHODS, 'dns.Resolver')
  if (dns.promises && typeof dns.promises.Resolver === 'function') wrapDnsPromises(dns.promises.Resolver.prototype, DNS_METHODS, 'dns.promises.Resolver')
}

// ── http(s).request / get ────────────────────────────────────────────────────
function requestHostPort(module, args) {
  let options = args[0]
  if (typeof options === 'string' || options instanceof URL) {
    try {
      const url = new URL(String(options))
      const port = url.port !== '' ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
      return { host: url.hostname, port }
    } catch {
      return { host: '(unknown)', port: '(unknown)' }
    }
  }
  if (options !== null && typeof options === 'object') {
    const host = options.hostname ?? options.host ?? 'localhost'
    const port = options.port !== undefined ? Number(options.port) : (module === https ? 443 : 80)
    return { host: String(host), port }
  }
  return { host: '(unknown)', port: '(unknown)' }
}

function wrapHttp(module, name) {
  for (const method of ['request', 'get']) {
    const original = module[method]
    if (typeof original !== 'function' || original[WRAPPED]) continue
    function guarded(...args) {
      const { host, port } = requestHostPort(module, args)
      if (!isAllowed(host, port)) {
        throw blocked(host, port, `${name}.${method}`)
      }
      return original.apply(this, args)
    }
    guarded[WRAPPED] = true
    module[method] = guarded
  }
}

// ── globalThis.fetch ─────────────────────────────────────────────────────────
function wrapFetch() {
  const original = globalThis.fetch
  if (typeof original !== 'function' || original[WRAPPED]) return
  async function guarded(input, init) {
    let url
    try {
      url = new URL(typeof input === 'string' ? input : (input && input.url) || String(input))
    } catch {
      throw blocked('(unknown)', '(unknown)', 'fetch')
    }
    const port = url.port !== '' ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
    if (url.protocol !== 'http:' || !isAllowed(url.hostname, port)) {
      throw blocked(url.hostname, port, 'fetch')
    }
    return original(input, init)
  }
  guarded[WRAPPED] = true
  globalThis.fetch = guarded
}

// ── re-apply in worker threads ────────────────────────────────────────────────
// --require reaches worker threads whose execArgv is inherited, but a Worker
// created with an explicit execArgv or eval code may not carry it. Setting
// NODE_OPTIONS makes every spawned Node process and default Worker re-require
// this file; wrapping is idempotent, so a double-apply is harmless.
function ensureNodeOptions() {
  const self = __filename
  const flag = `--require=${self}`
  const current = process.env.NODE_OPTIONS || ''
  if (!current.includes(flag)) {
    process.env.NODE_OPTIONS = current.length > 0 ? `${current} ${flag}` : flag
  }
}

function apply() {
  if (globalThis[GUARD_APPLIED]) return
  globalThis[GUARD_APPLIED] = true
  wrapConnect(net.Socket.prototype, 'net.Socket.connect')
  wrapTlsConnect()
  wrapDgram()
  wrapDns()
  wrapHttp(http, 'http')
  wrapHttp(https, 'https')
  wrapFetch()
  ensureNodeOptions()
}

apply()

module.exports = { __test: { isAllowed } }
