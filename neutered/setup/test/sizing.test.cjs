'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { GIB, kvBytesPerToken, chooseContext, maxTokensFor, rankCatalog, preHeaderAllowance } = require('../lib/sizing.cjs')

const HYBRID = { blockCount: 64, fullAttentionInterval: 4, headCountKv: 8, keyLength: 128, valueLength: 128, contextLength: 262144 }
const DENSE = { blockCount: 48, headCountKv: 4, keyLength: 128, valueLength: 128, contextLength: 262144 }
const BUDGET_64 = 46 * GIB // 64 GiB Apple Silicon machine
const BUDGET_32 = 20873541058 // 32 GiB Apple Silicon machine
const BUDGET_16 = 9363028705 // 16 GiB Apple Silicon machine

test('kvBytesPerToken: dense model counts every layer', () => {
  assert.equal(kvBytesPerToken(DENSE), 48 * 4 * 256 * 2)
})

test('kvBytesPerToken: hybrid model counts only full-attention layers', () => {
  assert.equal(kvBytesPerToken(HYBRID), 16 * 8 * 256 * 2)
})

test('kvBytesPerToken: derives head size from embedding_length when key_length is absent', () => {
  assert.equal(kvBytesPerToken({ blockCount: 32, headCountKv: 8, headCount: 32, embeddingLength: 4096 }), 32 * 8 * 256 * 2)
})

test('kvBytesPerToken: per-layer head_count_kv arrays are summed', () => {
  assert.equal(kvBytesPerToken({ blockCount: 4, headCountKv: [8, 0, 8, 0], keyLength: 128, valueLength: 128 }), 16 * 256 * 2)
})

test('kvBytesPerToken: rejects geometry without layers', () => {
  assert.throws(() => kvBytesPerToken({ headCountKv: 8, keyLength: 128 }), /blockCount/)
})

test('chooseContext: 17 GB hybrid model on a 64 GiB machine takes the native 262144', () => {
  const choice = chooseContext(HYBRID, 17e9, BUDGET_64)
  assert.equal(choice.contextWindow, 262144)
  assert.equal(choice.kvBytes, 262144 * 65536)
  assert.equal(choice.totalBytes, 17e9 + 262144 * 65536 + GIB + 262144 * 4096)
})

test('chooseContext: same model on a 32 GiB machine drops to 32768', () => {
  assert.equal(chooseContext(HYBRID, 17e9, BUDGET_32).contextWindow, 32768)
})

test('chooseContext: returns null when even 32768 does not fit', () => {
  assert.equal(chooseContext(DENSE, 12.1e9, BUDGET_16), null)
})

test('chooseContext: never exceeds the native context', () => {
  assert.equal(chooseContext({ ...DENSE, contextLength: 131072 }, 1e9, 100 * GIB).contextWindow, 131072)
})

test('maxTokensFor: a quarter of the window, capped at 32768', () => {
  assert.equal(maxTokensFor(262144), 32768)
  assert.equal(maxTokensFor(32768), 8192)
})

test('preHeaderAllowance: a quarter of the file, clamped to 1..3 GiB', () => {
  assert.equal(preHeaderAllowance(2e9), GIB)
  assert.equal(preHeaderAllowance(8e9), 2e9)
  assert.equal(preHeaderAllowance(46e9), 3 * GIB)
})

const CATALOG = [
  { id: 'a-q8', sizeBytes: 29e9, tags: ['quality'] },
  { id: 'a-q4', sizeBytes: 17e9, tags: ['recommended'] },
  { id: 'big', sizeBytes: 63.4e9, tags: ['large'] },
  { id: 'coder', sizeBytes: 46e9, tags: ['coder'] },
  { id: 'tiny', sizeBytes: 6e9, tags: ['small'] },
]

test('rankCatalog: recommended first, then largest first; too-large sorted ascending', () => {
  const { fits, tooLarge } = rankCatalog(CATALOG, BUDGET_64)
  assert.deepEqual(fits.map((e) => e.id), ['a-q4', 'coder', 'a-q8', 'tiny'])
  assert.deepEqual(tooLarge.map((e) => e.id), ['big'])
})

test('rankCatalog: on 16 GiB only the small entry fits', () => {
  const { fits } = rankCatalog(CATALOG, BUDGET_16)
  assert.deepEqual(fits.map((e) => e.id), ['tiny'])
})
