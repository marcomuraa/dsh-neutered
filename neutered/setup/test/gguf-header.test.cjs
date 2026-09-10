'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseBuffer, parseMetadata, readMetadata, modelGeometry, T } = require('../lib/gguf-header.cjs')

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
function str(s) { const bytes = Buffer.from(s, 'utf8'); return Buffer.concat([u64(bytes.length), bytes]) }
function kvU32(key, n) { return Buffer.concat([str(key), u32(T.UINT32), u32(n)]) }
function kvStr(key, s) { return Buffer.concat([str(key), u32(T.STRING), str(s)]) }
function kvBool(key, v) { return Buffer.concat([str(key), u32(T.BOOL), Buffer.from([v ? 1 : 0])]) }
function kvF32(key, v) { const b = Buffer.alloc(4); b.writeFloatLE(v); return Buffer.concat([str(key), u32(T.FLOAT32), b]) }
function kvStrArray(key, items) { return Buffer.concat([str(key), u32(T.ARRAY), u32(T.STRING), u64(items.length), ...items.map(str)]) }
function kvU32Array(key, items) { return Buffer.concat([str(key), u32(T.ARRAY), u32(T.UINT32), u64(items.length), ...items.map(u32)]) }
function gguf(kvs, version = 3, magic = 'GGUF') {
  return Buffer.concat([Buffer.from(magic), u32(version), u64(0), u64(kvs.length), ...kvs])
}

const QWEN35 = gguf([
  kvStr('general.architecture', 'qwen35'),
  kvStr('general.name', 'Qwen3.8 27B'),
  kvU32('qwen35.block_count', 64),
  kvU32('qwen35.context_length', 262144),
  kvU32('qwen35.embedding_length', 5120),
  kvU32('qwen35.attention.head_count', 32),
  kvU32('qwen35.attention.head_count_kv', 8),
  kvU32('qwen35.attention.key_length', 128),
  kvU32('qwen35.attention.value_length', 128),
  kvU32('qwen35.full_attention_interval', 4),
  kvStrArray('tokenizer.ggml.tokens', ['<s>', 'hello', '🙂']),
  kvU32Array('tokenizer.ggml.token_type', [1, 2, 3]),
  kvBool('tokenizer.ggml.add_bos_token', true),
  kvF32('qwen35.rope.freq_base', 1000000),
])

test('parseBuffer: scalars, strings, bools, floats and small numeric arrays are kept', () => {
  const meta = parseBuffer(QWEN35)
  assert.equal(meta.version, 3)
  assert.equal(meta.tensorCount, 0)
  assert.equal(meta.kv['general.architecture'], 'qwen35')
  assert.equal(meta.kv['qwen35.block_count'], 64)
  assert.equal(meta.kv['tokenizer.ggml.add_bos_token'], true)
  assert.equal(Math.round(meta.kv['qwen35.rope.freq_base']), 1000000)
  assert.deepEqual(meta.kv['tokenizer.ggml.token_type'], [1, 2, 3])
})

test('parseBuffer: string arrays are walked but not kept', () => {
  assert.deepEqual(parseBuffer(QWEN35).kv['tokenizer.ggml.tokens'], { arrayLength: 3, elementType: T.STRING })
})

test('parseMetadata: works when the source hands out tiny chunks', () => {
  const meta = parseMetadata((pos, len) => QWEN35.subarray(pos, Math.min(pos + 3, pos + len)))
  assert.equal(meta.kv['qwen35.attention.head_count_kv'], 8)
})

test('modelGeometry: extracts the architecture-prefixed keys', () => {
  assert.deepEqual(modelGeometry(parseBuffer(QWEN35)), {
    architecture: 'qwen35',
    name: 'Qwen3.8 27B',
    blockCount: 64,
    contextLength: 262144,
    embeddingLength: 5120,
    headCount: 32,
    headCountKv: 8,
    keyLength: 128,
    valueLength: 128,
    fullAttentionInterval: 4,
    splitCount: 1,
  })
})

test('modelGeometry: falls back to head_count when head_count_kv is absent', () => {
  const meta = parseBuffer(gguf([kvStr('general.architecture', 'llama'), kvU32('llama.block_count', 2), kvU32('llama.attention.head_count', 16)]))
  assert.equal(modelGeometry(meta).headCountKv, 16)
  assert.equal(modelGeometry(meta).keyLength, null)
})

test('parseBuffer: rejects a bad magic and a truncated file', () => {
  assert.throws(() => parseBuffer(gguf([], 3, 'GGML')), /not a GGUF file/)
  assert.throws(() => parseBuffer(QWEN35.subarray(0, 40)), /truncated/)
})

test('readMetadata: reads from a file on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-'))
  const file = path.join(dir, 'model.gguf')
  fs.writeFileSync(file, QWEN35)
  try {
    assert.equal(readMetadata(file).kv['qwen35.context_length'], 262144)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
