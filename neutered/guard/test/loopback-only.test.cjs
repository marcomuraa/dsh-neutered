'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const GUARD = path.resolve(__dirname, '..', 'loopback-only.cjs')

/** Run a snippet in a fresh Node with the guard preloaded; return {status, stderr}. */
function runWithGuard(snippet, extraEnv) {
  return spawnSync(process.execPath, ['--require', GUARD, '-e', snippet], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...extraEnv },
  })
}

const FINISH = ';setTimeout(()=>process.exit(0),500)'

test('isAllowed: only 127.0.0.1:1234 passes', () => {
  const { __test } = require(GUARD)
  assert.strictEqual(__test.isAllowed('127.0.0.1', 1234), true)
  assert.strictEqual(__test.isAllowed('127.0.0.1', '1234'), true)
  assert.strictEqual(__test.isAllowed('127.0.0.1', 1235), false)
  assert.strictEqual(__test.isAllowed('localhost', 1234), false)
  assert.strictEqual(__test.isAllowed('::1', 1234), false)
  assert.strictEqual(__test.isAllowed('1.1.1.1', 80), false)
  assert.strictEqual(__test.isAllowed('0.0.0.0', 1234), false)
})

test('net.connect to a public host is blocked', () => {
  const r = runWithGuard("try{require('net').connect(80,'1.1.1.1')}catch(e){process.stderr.write(e.code)}" + FINISH)
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})

test('net.connect to 127.0.0.1:1234 is not blocked by the guard', () => {
  const r = runWithGuard("const s=require('net').connect(1234,'127.0.0.1');s.on('error',()=>{});s.on('connect',()=>s.destroy())" + FINISH)
  assert.doesNotMatch(r.stderr, /dsh-neutered guard: blocked/)
})

test('net.connect to localhost by name is blocked (no alias)', () => {
  const r = runWithGuard("try{require('net').connect(1234,'localhost')}catch(e){process.stderr.write(e.code)}" + FINISH)
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})

test('net.connect to another loopback port is blocked', () => {
  const r = runWithGuard("try{require('net').connect(1235,'127.0.0.1')}catch(e){process.stderr.write(e.code)}" + FINISH)
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})

test('a Unix domain socket path is allowed', () => {
  const r = runWithGuard("const s=require('net').connect('/tmp/dsh-guard-nonexistent.sock');s.on('error',()=>{})" + FINISH)
  assert.doesNotMatch(r.stderr, /dsh-neutered guard: blocked/)
})

test('fetch to a public URL rejects with EGRESS_BLOCKED', () => {
  const r = runWithGuard("fetch('http://example.com').then(()=>{},e=>process.stderr.write(e.code))" + FINISH)
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})

test('fetch to http://127.0.0.1:1234 is not blocked by the guard', () => {
  const r = runWithGuard("fetch('http://127.0.0.1:1234/v1/models').then(()=>{},()=>{})" + FINISH)
  assert.doesNotMatch(r.stderr, /dsh-neutered guard: blocked/)
})

test('fetch over https to the loopback port is blocked (server speaks http)', () => {
  const r = runWithGuard("fetch('https://127.0.0.1:1234/').then(()=>{},e=>process.stderr.write(e.code))" + FINISH)
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})

test('dns.lookup of a public host is blocked', () => {
  const r = runWithGuard("require('dns').lookup('example.com',(e)=>process.stderr.write(e?e.code:'RESOLVED'))" + FINISH)
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})

test('dns.lookup of localhost is blocked too', () => {
  const r = runWithGuard("require('dns').lookup('localhost',(e)=>process.stderr.write(e?e.code:'RESOLVED'))" + FINISH)
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})

test('a worker thread inherits the block', () => {
  const snippet = [
    "const {Worker}=require('node:worker_threads');",
    "const w=new Worker(\"try{require('net').connect(80,'1.1.1.1')}catch(e){process.stderr.write(e.code)}\",{eval:true});",
    "w.on('exit',()=>process.exit(0));",
    "setTimeout(()=>process.exit(0),3000)",
  ].join('')
  const r = runWithGuard(snippet)
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})

test('a spawned Node child inherits the block via NODE_OPTIONS', () => {
  const snippet = [
    "const {spawnSync}=require('node:child_process');",
    "const r=spawnSync(process.execPath,['-e',\"try{require('net').connect(80,'1.1.1.1')}catch(e){process.stderr.write(e.code)}\"],{encoding:'utf8'});",
    "process.stderr.write(r.stderr)",
  ].join('')
  const r = runWithGuard(snippet, { NODE_OPTIONS: `--require=${GUARD}` })
  assert.match(r.stderr, /EGRESS_BLOCKED/)
})
