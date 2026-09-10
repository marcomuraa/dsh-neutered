'use strict'

// The only network-using code in dsh-neutered: install llama.cpp through Homebrew and fetch
// GGUF files from Hugging Face. Used by `dsh-neutered setup` and `settings --model` only;
// the task path never loads this file.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')

const HF_BASE = 'https://huggingface.co'
const UNPINNED_TOLERANCE = 0.1

class SetupError extends Error {
  constructor(exitCode, message) {
    super(message)
    this.exitCode = exitCode
  }
}

function hfUrl(repo, file) {
  return `${HF_BASE}/${repo}/resolve/main/${file}`
}

function defaultExec(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function defaultRun(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'inherit' })
}

const defaultLog = (line) => process.stderr.write(line + '\n')

function hasCommand(name, exec = defaultExec) {
  try {
    return exec('/usr/bin/which', [name]) !== ''
  } catch {
    return false
  }
}

/** Return the llama-server command, installing llama.cpp with Homebrew when it is missing. */
function ensureLlamaServer({ run = defaultRun, exec = defaultExec, log = defaultLog } = {}) {
  if (hasCommand('llama-server', exec)) return 'llama-server'
  if (!hasCommand('brew', exec)) {
    throw new SetupError(3, 'llama-server is not installed and Homebrew is missing. Install Homebrew from https://brew.sh, then run dsh-neutered setup again.')
  }
  log('Installing llama.cpp with Homebrew (network) …')
  const result = run('brew', ['install', 'llama.cpp'])
  if (result.status !== 0) {
    throw new SetupError(3, `brew install llama.cpp failed (exit ${result.status}); fix the Homebrew error above and rerun setup`)
  }
  if (!hasCommand('llama-server', exec)) {
    throw new SetupError(3, 'brew install finished but llama-server is not on PATH; open a new shell or add $(brew --prefix)/bin to PATH, then rerun setup')
  }
  return 'llama-server'
}

function sha256Of(file, exec = defaultExec) {
  return exec('/usr/bin/shasum', ['-a', '256', file]).split(/\s+/)[0]
}

/**
 * Download every file of a catalog entry into modelsDir (hf CLI when present, else curl with
 * resume). Verifies SHA-256 when the entry carries one and the total size (exact for pinned
 * entries, ±10 % otherwise). Returns the path of the first file and the total bytes.
 */
function downloadModel(entry, modelsDir, { run = defaultRun, exec = defaultExec, log = defaultLog } = {}) {
  fs.mkdirSync(modelsDir, { recursive: true })
  const useHf = hasCommand('hf', exec)
  const downloaded = []
  entry.files.forEach((file, index) => {
    const dest = path.join(modelsDir, file)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    log(`Downloading ${entry.repo} ${file} → ${dest} (network) …`)
    const result = useHf
      ? run('hf', ['download', entry.repo, file, '--local-dir', modelsDir])
      : run('curl', ['-fL', '-C', '-', '--retry', '5', '-o', dest, hfUrl(entry.repo, file)])
    if (result.status !== 0) throw new SetupError(3, `download of ${file} failed (exit ${result.status}); rerun setup to resume`)
    if (!fs.existsSync(dest)) throw new SetupError(3, `download finished but ${dest} does not exist`)
    const expectedSha = entry.sha256 && entry.sha256[index]
    if (expectedSha) {
      const got = sha256Of(dest, exec)
      if (got !== expectedSha) {
        fs.rmSync(dest, { force: true })
        throw new SetupError(3, `${file}: SHA-256 mismatch (expected ${expectedSha}, got ${got}); the corrupt file was deleted, rerun setup`)
      }
    }
    downloaded.push(dest)
  })
  const totalBytes = downloaded.reduce((sum, file) => sum + fs.statSync(file).size, 0)
  if (entry.sizeBytes) {
    const tolerance = entry.pinned ? 0 : Math.floor(entry.sizeBytes * UNPINNED_TOLERANCE)
    if (Math.abs(totalBytes - entry.sizeBytes) > tolerance) {
      downloaded.forEach((file) => fs.rmSync(file, { force: true }))
      throw new SetupError(3, `${entry.name}: downloaded ${totalBytes} bytes, expected ${entry.sizeBytes}${entry.pinned ? '' : ' (±10 %)'}; the files were deleted, rerun setup`)
    }
  }
  return { modelPath: downloaded[0], totalBytes }
}

module.exports = { HF_BASE, SetupError, hfUrl, hasCommand, ensureLlamaServer, downloadModel, sha256Of }
