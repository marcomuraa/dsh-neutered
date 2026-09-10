#!/usr/bin/env node
'use strict'

// Exercise installed code with plain Node and a disposable Harness home.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

/** Reject dangling links and links that require files outside the release. */
function assertContained(directory) {
  const root = fs.realpathSync(directory)
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) pending.push(file)
      if (!entry.isSymbolicLink()) continue
      const target = fs.realpathSync(file)
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Release symlink escapes: ${file} -> ${target}`)
    }
  }
}

/** Verify an unpacked release without downloading a model or contacting a provider. */
function verify(directory) {
  const root = fs.realpathSync(directory)
  assertContained(root)
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-installed-'))
  try {
    const env = { ...process.env, DSH_HOME: path.join(scratch, 'home'), NODE_OPTIONS: '', NODE_PATH: '' }
    const run = (command, args, extra = {}) => {
      const result = spawnSync(command, args, { cwd: scratch, env, encoding: 'utf8', timeout: 60000, ...extra })
      if (result.error) throw result.error
      assert.equal(result.signal, null, `${command} ended by signal`)
      const output = result.stdout + result.stderr
      assert.equal(result.status, 0, output)
      return output
    }
    const wrapper = path.join(root, 'neutered/bin/dsh-neutered')
    const cli = path.join(root, 'apps/cli/lib/bin.js')
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'))
    assert.equal(run(wrapper, ['--version']).trim(), manifest.version)
    assert.match(run(wrapper, ['--help']), /dsh-neutered setup/)
    assert.match(run(wrapper, ['setup', '--help']), /first-run configuration/)
    const guard = path.join(root, 'neutered/guard/loopback-only.cjs')
    const guarded = { ...env, NODE_OPTIONS: `--require=${JSON.stringify(guard)}` }
    for (const profile of ['headless', 'repl']) {
      assert.match(run(process.execPath, [cli, '--profile', profile, '--', '--help'], { env: guarded }), /Usage:/)
    }
    assert.match(run(process.execPath, ['-e', `
      const assert = require('node:assert/strict')
      assert.throws(() => require('node:net').connect(443, 'example.com'), /is blocked/)
      console.log('guard rejected egress')
    `], { env: guarded }), /guard rejected egress/)
    run('shasum', ['-a', '256', '-c', '../SHA256SUMS', '--status'], { cwd: path.join(root, 'neutered/llama/bin') })
    assert.match(run(path.join(root, 'neutered/llama/bin/llama-server'), ['--version']), /version|b\d+/i)
    const subprocessRoot = fs.realpathSync(path.join(root, 'apps/cli/node_modules/@deepseek-ai/dsh-subprocess-local'))
    run(process.execPath, ['-e', `
      const assert = require('node:assert/strict')
      const { createRequire } = require('node:module')
      const requireRuntime = createRequire(process.argv[1])
      const pty = requireRuntime('node-pty').spawn('/bin/sh', ['-c', 'printf release-pty'], { env: process.env })
      let output = ''
      pty.onData(chunk => { output += chunk })
      pty.onExit(({ exitCode, signal }) => {
        assert.equal(exitCode, 0)
        assert.ok(!signal)
        assert.equal(output, 'release-pty')
      })
    `, path.join(subprocessRoot, 'package.json')])
    console.log('Installed release verified: profiles, guard, server checksums, native PTY')
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

module.exports = { assertContained, verify }
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node neutered/release/verify.cjs UNPACKED_RELEASE')
    verify(process.argv[2])
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
