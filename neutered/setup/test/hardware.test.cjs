'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { probe, budget, describe } = require('../lib/hardware.cjs')
const { GIB } = require('../lib/sizing.cjs')

function fakeExec(sysctlValues, gpuCores = '40') {
  return (cmd, args) => {
    if (cmd.endsWith('sysctl')) {
      const key = args[args.length - 1]
      if (!(key in sysctlValues)) throw new Error(`sysctl: unknown oid '${key}'`)
      return sysctlValues[key]
    }
    if (cmd.endsWith('system_profiler')) return JSON.stringify({ SPDisplaysDataType: [{ sppci_cores: gpuCores }] })
    throw new Error(`unexpected command ${cmd}`)
  }
}

const M4_MAX = { 'hw.memsize': String(64 * GIB), 'machdep.cpu.brand_string': 'Apple M4 Max', 'hw.optional.arm64': '1' }

test('probe: reads memory, chip, arm64 and GPU cores', () => {
  assert.deepEqual(probe(fakeExec(M4_MAX), 'darwin'), {
    platform: 'darwin',
    ramBytes: 64 * GIB,
    chip: 'Apple M4 Max',
    appleSilicon: true,
    gpuCores: 40,
  })
})

test('probe: an Intel Mac has no arm64 key and no Apple GPU cores', () => {
  const exec = (cmd, args) => {
    if (cmd.endsWith('sysctl') && args[1] === 'hw.memsize') return String(8 * GIB)
    if (cmd.endsWith('sysctl') && args[1] === 'machdep.cpu.brand_string') return 'Intel(R) Core(TM) i7'
    throw new Error('no such oid')
  }
  const hw = probe(exec, 'darwin')
  assert.equal(hw.appleSilicon, false)
  assert.equal(hw.gpuCores, null)
})

test('probe: refuses non-macOS platforms', () => {
  assert.throws(() => probe(fakeExec(M4_MAX), 'linux'), /macOS only/)
})

test('budget: Apple Silicon table', () => {
  const at = (gib) => budget({ ramBytes: gib * GIB, appleSilicon: true }, {})
  assert.equal(at(16), 9363028705)
  assert.equal(at(32), 20873541058)
  assert.equal(at(64), 46 * GIB)
  assert.equal(at(128), 94 * GIB)
})

test('budget: Intel Mac uses half the RAM', () => {
  assert.equal(budget({ ramBytes: 8 * GIB, appleSilicon: false }, {}), 3 * GIB)
})

test('budget: DSH_NEUTERED_BUDGET_GIB overrides the formula', () => {
  assert.equal(budget({ ramBytes: 64 * GIB, appleSilicon: true }, { DSH_NEUTERED_BUDGET_GIB: '40' }), 40 * GIB)
  assert.throws(() => budget({ ramBytes: 64 * GIB, appleSilicon: true }, { DSH_NEUTERED_BUDGET_GIB: 'lots' }), /positive number/)
})

test('describe: one line with chip, memory kind, GPU cores and budget', () => {
  const hw = probe(fakeExec(M4_MAX), 'darwin')
  assert.equal(describe(hw, 46 * GIB), 'Machine: Apple M4 Max, 64 GiB unified memory, 40 GPU cores  (usable for models: 46.0 GiB)')
})
