'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { runtimeDependencies, renderFormula, validateRelease } = require('../pack.cjs')
const { assertContained } = require('../verify.cjs')

test('deployment includes required workspace peers and follows cycles without adding optional providers', () => {
  const cli = { dependencies: { app: 'workspace:^', external: '^1.0.0' } }
  const packages = [
    { name: 'app', dependencies: { library: 'workspace:^' }, peerDependencies: { provider: 'workspace:^', optional: 'workspace:^' }, peerDependenciesMeta: { optional: { optional: true } } },
    { name: 'library', dependencies: { app: 'workspace:^' } },
    { name: 'provider' }, { name: 'optional' }, { name: 'test-only' },
  ]
  assert.deepEqual(runtimeDependencies(packages, cli), { app: 'workspace:*', external: '^1.0.0', library: 'workspace:*', provider: 'workspace:*' })
})

test('formula identifies the exact release asset and rejects injected Ruby or paths', () => {
  const formula = renderFormula('0.1.0-alpha.1', 'owner/dsh-neutered', 'a'.repeat(64))
  assert.ok(formula.includes('/owner/dsh-neutered/releases/download/v0.1.0-alpha.1/dsh-neutered-0.1.0-alpha.1-darwin-arm64.tar.gz'))
  assert.ok(formula.includes(`sha256 "${'a'.repeat(64)}"`))
  assert.ok(!formula.includes('@VERSION@'))
  for (const version of ['', '../1.0.0', '1.0.0"', '01.0.0']) assert.throws(() => validateRelease(version, 'owner/repo'))
  for (const repo of ['', 'repo', '../repo', 'owner/repo"']) assert.throws(() => validateRelease('1.0.0', repo))
  assert.throws(() => renderFormula('1.0.0', 'owner/repo', 'abc'))
})

test('release verification rejects dangling links and valid links outside the archive', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-release-links-'))
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }))
  const root = path.join(scratch, 'release')
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, 'file'), 'ok')
  fs.symlinkSync('file', path.join(root, 'link'))
  fs.symlinkSync('.', path.join(root, 'self'))
  assertContained(root)
  fs.symlinkSync('missing', path.join(root, 'dangling'))
  assert.throws(() => assertContained(root), /ENOENT/)
  fs.unlinkSync(path.join(root, 'dangling'))
  fs.writeFileSync(path.join(scratch, 'outside'), 'outside')
  fs.symlinkSync('../outside', path.join(root, 'escape'))
  assert.throws(() => assertContained(root), /Release symlink escapes/)
})

test('launcher preserves paths with spaces and makes its pinned server available to setup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh release paths '))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const dir of ['neutered/bin', 'neutered/guard', 'neutered/setup', 'neutered/llama/bin', 'apps/cli/lib']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
  const wrapper = path.join(root, 'neutered/bin/dsh-neutered')
  fs.copyFileSync(path.resolve(__dirname, '../../bin/dsh-neutered'), wrapper)
  fs.writeFileSync(path.join(root, 'apps/cli/package.json'), '{"version":"1.2.3"}')
  fs.writeFileSync(path.join(root, 'apps/cli/lib/bin.js'), 'console.log(JSON.stringify(process.argv.slice(2)))')
  fs.copyFileSync(path.resolve(__dirname, '../../guard/loopback-only.cjs'), path.join(root, 'neutered/guard/loopback-only.cjs'))
  fs.writeFileSync(path.join(root, 'neutered/setup/setup.cjs'), `
    if (process.argv[2] === 'overlay-path') console.log('/nonexistent-overlay')
    else console.log(require('node:child_process').execFileSync('/usr/bin/which', ['llama-server'], { encoding: 'utf8' }).trim())
  `)
  const server = path.join(root, 'neutered/llama/bin/llama-server')
  fs.writeFileSync(server, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const fakePath = path.join(root, 'commands')
  fs.mkdirSync(fakePath)
  fs.writeFileSync(path.join(fakePath, 'lsof'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const env = { ...process.env, PATH: `${fakePath}:${process.env.PATH}`, DSH_HOME: path.join(root, 'home'), NODE_OPTIONS: '' }
  const run = args => execFileSync(wrapper, args, { env, encoding: 'utf8', timeout: 10000 })
  assert.equal(run(['--version']).trim(), '1.2.3')
  assert.equal(run(['setup']).trim(), server)
  const result = JSON.parse(run(['--', 'task with spaces']).trim())
  assert.deepEqual(result.slice(-2), ['--', 'task with spaces'])
  assert.ok(result.includes(path.join(root, 'neutered/offline.patch.yml')))
})
