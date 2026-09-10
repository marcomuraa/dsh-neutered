#!/usr/bin/env node
'use strict'

// Build a relocatable macOS release from the compiled workspace. See README.md.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { parseArgs } = require('node:util')
const yaml = require('js-yaml')
const { createHash } = require('node:crypto')
const { verify } = require('./verify.cjs')

const root = path.resolve(__dirname, '../..')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

/** Reject values that cannot identify one immutable GitHub release asset. */
function validateRelease(version, repository) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(version || '')) {
    throw new Error('--version must be a release version such as 0.1.0-alpha.1')
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repository || '')) {
    throw new Error('--repository must be a GitHub owner/repository')
  }
}

/** Include workspace dependencies and required peers in the installation's resolver. */
function runtimeDependencies(manifests, entry) {
  const byName = new Map(manifests.map(manifest => [manifest.name, manifest]))
  const dependencies = { ...entry.dependencies }
  const seen = new Set()
  const pending = Object.keys(dependencies)
  while (pending.length) {
    const name = pending.pop()
    if (seen.has(name) || !byName.has(name)) continue
    seen.add(name)
    const manifest = byName.get(name)
    dependencies[name] = 'workspace:*'
    pending.push(...Object.keys(manifest.dependencies || {}))
    pending.push(...Object.keys(manifest.peerDependencies || {})
      .filter(peer => !manifest.peerDependenciesMeta?.[peer]?.optional))
  }
  return dependencies
}

/** Resolve release metadata into the checked-in Homebrew formula template. */
function renderFormula(version, repository, sha256) {
  validateRelease(version, repository)
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('archive SHA-256 must contain 64 lowercase hex digits')
  return fs.readFileSync(path.join(__dirname, 'dsh-neutered.rb.in'), 'utf8')
    .replaceAll('@VERSION@', version).replaceAll('@REPOSITORY@', repository).replaceAll('@SHA256@', sha256)
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } })
}

/** Pack built code and a checksum-verified llama.cpp archive without publishing. */
function main() {
  const { values } = parseArgs({ options: {
    version: { type: 'string' }, repository: { type: 'string' },
    'llama-archive': { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('Usage: node neutered/release/pack.cjs --version VERSION --repository OWNER/REPO --llama-archive FILE [--output DIRECTORY]')
    return
  }
  validateRelease(values.version, values.repository)
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build releases on an Apple Silicon Mac')
  if (!values['llama-archive']) throw new Error('--llama-archive is required; see neutered/llama/VERSION')
  const llamaArchive = fs.realpathSync(values['llama-archive'])
  const output = path.resolve(values.output || path.join(root, '.artifacts/homebrew', values.version))
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}; choose a new --output directory`)
  fs.accessSync(path.join(root, 'apps/cli/lib/bin.js'))
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-release-'))
  try {
    const source = path.join(temporary, 'source')
    fs.mkdirSync(source)
    for (const name of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'patches', 'apps', 'packages', 'vendor', 'native']) {
      fs.cpSync(path.join(root, name), path.join(source, name), {
        recursive: true, verbatimSymlinks: true,
        filter: file => !['node_modules', '.git', 'target', 'build'].includes(path.basename(file)),
      })
    }
    const workspaceFile = path.join(source, 'pnpm-workspace.yaml')
    const workspace = yaml.load(fs.readFileSync(workspaceFile, 'utf8'))
    // pnpm deploy preserves link: overrides as links to the source checkout.
    for (const [name, specifier] of Object.entries(workspace.overrides || {})) {
      if (specifier.startsWith('link:')) workspace.overrides[name] = `file:${specifier.slice(5)}`
    }
    fs.writeFileSync(workspaceFile, yaml.dump(workspace))
    const manifests = fs.globSync(['packages/*/*/package.json', 'apps/*/package.json', 'vendor/*/package.json',
      'native/landlock-run/package.json', 'native/landlock-run/packages/*/package.json'], { cwd: source })
      .map(file => readJson(path.join(source, file)))
    const cliFile = path.join(source, 'apps/cli/package.json')
    const cli = readJson(cliFile)
    cli.dependencies = runtimeDependencies(manifests, cli)
    cli.version = values.version
    writeJson(cliFile, cli)
    const name = `dsh-neutered-${values.version}-darwin-arm64`
    const artifact = path.join(temporary, name)
    fs.mkdirSync(path.join(artifact, 'apps'), { recursive: true })
    run('pnpm', ['--filter', '@deepseek-ai/dsh', 'deploy', '--legacy', '--prod', '--ignore-scripts',
      path.join(artifact, 'apps/cli')], source)
    const installedCli = path.join(artifact, 'apps/cli')
    // Legacy deploy leaves its root link and skipped Linux optionals pointing at the workspace.
    const selfLink = path.join(installedCli, 'node_modules/.pnpm/node_modules/@deepseek-ai/dsh')
    fs.rmSync(selfLink, { force: true })
    fs.symlinkSync(path.relative(path.dirname(selfLink), installedCli), selfLink)
    const landlock = fs.realpathSync(path.join(installedCli, 'node_modules/@deepseek-ai/node-addon-landlock-run'))
    for (const platform of ['linux-arm64', 'linux-x64']) {
      fs.rmSync(path.join(path.dirname(landlock), `node-addon-landlock-run-${platform}`), { force: true })
    }
    // node-pty ships prebuilt N-API binaries; its subprocess consumer owns helper permissions.
    run(process.execPath, [path.join(artifact, 'apps/cli/node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs')], artifact)
    for (const name of ['bin/dsh-neutered', 'guard/loopback-only.cjs', 'offline.patch.yml',
      'setup', 'llama/install.sh', 'llama/VERSION', 'llama/SHA256SUMS']) {
      const destination = path.join(artifact, 'neutered', name)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.cpSync(path.join(root, 'neutered', name), destination, {
        recursive: true, filter: file => !['test', 'README.md'].includes(path.basename(file)),
      })
    }
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(root, name), path.join(artifact, name))
    run('bash', [path.join(artifact, 'neutered/llama/install.sh'), llamaArchive], artifact)
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== ''
    writeJson(path.join(artifact, 'release.json'), {
      version: values.version, repository: values.repository, platform: process.platform, arch: process.arch,
      sourceRevision: revision, sourceDirty: dirty, node: process.version,
    })
    verify(artifact)
    const archive = path.join(temporary, `${name}.tar.gz`)
    run('tar', ['--no-xattrs', '-czf', archive, '-C', temporary, name], temporary)
    const sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    fs.mkdirSync(output, { recursive: true })
    fs.copyFileSync(archive, path.join(output, `${name}.tar.gz`))
    fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${sha256}  ${name}.tar.gz\n`)
    fs.writeFileSync(path.join(output, 'dsh-neutered.rb'), renderFormula(values.version, values.repository, sha256))
    console.log(`Release prepared in ${output}`)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

module.exports = { validateRelease, runtimeDependencies, renderFormula }
if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
