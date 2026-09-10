#!/usr/bin/env node
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
      const status = await server.status()
      if (status === 'healthy') return out('server: external')
      if (!config) return out('server: setup required')
      return out(status === 'healthy' ? 'server: external' : `llama-server ${server.serverArgs(config).join(' ')}`)
    }
    case 'ensure': {
      if (!config) {
        if ((await server.status()) === 'healthy') return out('external')
        throw new download.SetupError(3, `no configuration at ${paths.configPath}; run dsh-neutered setup first`)
      }
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
