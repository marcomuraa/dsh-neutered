'use strict'

// macOS hardware probe and the memory budget for model weights plus KV cache.

const { execFileSync } = require('node:child_process')
const { GIB } = require('./sizing.cjs')

function defaultExec(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function sysctl(exec, key) {
  try {
    return exec('/usr/sbin/sysctl', ['-n', key])
  } catch {
    return null
  }
}

function gpuCores(exec) {
  try {
    const json = JSON.parse(exec('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json']))
    const gpu = (json.SPDisplaysDataType || [])[0] || {}
    const cores = Number(gpu.sppci_cores)
    return Number.isFinite(cores) && cores > 0 ? cores : null
  } catch {
    return null
  }
}

/** Read RAM, chip name, Apple Silicon flag and GPU core count. Throws off macOS. */
function probe(exec = defaultExec, platform = process.platform) {
  if (platform !== 'darwin') throw new Error('dsh-neutered supports macOS only')
  const ramBytes = Number(sysctl(exec, 'hw.memsize'))
  if (!Number.isFinite(ramBytes) || ramBytes <= 0) throw new Error('could not read hw.memsize')
  const appleSilicon = sysctl(exec, 'hw.optional.arm64') === '1'
  return {
    platform,
    ramBytes,
    chip: sysctl(exec, 'machdep.cpu.brand_string') || 'unknown CPU',
    appleSilicon,
    gpuCores: appleSilicon ? gpuCores(exec) : null,
  }
}

/**
 * Bytes available for weights plus KV cache. macOS lets the GPU wire about 75 % of RAM
 * on machines with 36 GiB or more and about 67 % below that; Intel Macs run on the CPU
 * and get half. A headroom of min(2 GiB, RAM / 8) is kept for dsh and the OS.
 */
function budget(hw, env = process.env) {
  const override = env.DSH_NEUTERED_BUDGET_GIB
  if (override !== undefined && override !== '') {
    const gib = Number(override)
    if (!Number.isFinite(gib) || gib <= 0) {
      throw new Error(`DSH_NEUTERED_BUDGET_GIB must be a positive number of GiB, got ${JSON.stringify(override)}`)
    }
    return Math.floor(gib * GIB)
  }
  const ram = hw.ramBytes
  const factor = hw.appleSilicon ? (ram >= 36 * GIB ? 0.75 : 0.67) : 0.5
  const headroom = Math.min(2 * GIB, ram / 8)
  return Math.floor(ram * factor - headroom)
}

function describe(hw, budgetBytes) {
  const gpu = hw.gpuCores ? `, ${hw.gpuCores} GPU cores` : ''
  const kind = hw.appleSilicon ? 'unified memory' : 'RAM (Intel Mac: CPU-only inference, expect it to be slow)'
  return `Machine: ${hw.chip}, ${Math.round(hw.ramBytes / GIB)} GiB ${kind}${gpu}  (usable for models: ${(budgetBytes / GIB).toFixed(1)} GiB)`
}

module.exports = { probe, budget, describe, defaultExec }
