'use strict'

// Sequential reader for GGUF v2/v3 metadata. Reads only the key/value header, never
// tensor data, so a 60 GB model costs a few megabytes of I/O.

const fs = require('node:fs')

const GGUF_MAGIC = 0x46554747 // the bytes "GGUF" read as a little-endian uint32
const CHUNK = 4 * 1024 * 1024
const MAX_KEPT_ARRAY = 4096
const T = Object.freeze({
  UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5, FLOAT32: 6,
  BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12,
})

class Reader {
  constructor(readChunk) {
    this.readChunk = readChunk
    this.buf = Buffer.alloc(0)
    this.filePos = 0
  }

  ensure(n) {
    while (this.buf.length < n) {
      const chunk = this.readChunk(this.filePos + this.buf.length, Math.max(CHUNK, n - this.buf.length))
      if (!chunk || chunk.length === 0) throw new Error('GGUF metadata is truncated')
      this.buf = Buffer.concat([this.buf, chunk])
    }
  }

  take(n) {
    this.ensure(n)
    const out = this.buf.subarray(0, n)
    this.buf = this.buf.subarray(n)
    this.filePos += n
    return out
  }

  u8() { return this.take(1).readUInt8(0) }
  i8() { return this.take(1).readInt8(0) }
  u16() { return this.take(2).readUInt16LE(0) }
  i16() { return this.take(2).readInt16LE(0) }
  u32() { return this.take(4).readUInt32LE(0) }
  i32() { return this.take(4).readInt32LE(0) }
  f32() { return this.take(4).readFloatLE(0) }
  u64() { return Number(this.take(8).readBigUInt64LE(0)) }
  i64() { return Number(this.take(8).readBigInt64LE(0)) }
  f64() { return this.take(8).readDoubleLE(0) }
  string() { return this.take(this.u64()).toString('utf8') }
}

function readScalar(reader, type) {
  switch (type) {
    case T.UINT8: return reader.u8()
    case T.INT8: return reader.i8()
    case T.UINT16: return reader.u16()
    case T.INT16: return reader.i16()
    case T.UINT32: return reader.u32()
    case T.INT32: return reader.i32()
    case T.FLOAT32: return reader.f32()
    case T.BOOL: return reader.u8() !== 0
    case T.STRING: return reader.string()
    case T.UINT64: return reader.u64()
    case T.INT64: return reader.i64()
    case T.FLOAT64: return reader.f64()
    default: throw new Error(`GGUF: unknown value type ${type}`)
  }
}

function readValue(reader, type) {
  if (type !== T.ARRAY) return readScalar(reader, type)
  const elementType = reader.u32()
  const count = reader.u64()
  if (elementType === T.ARRAY) throw new Error('GGUF: nested arrays are not supported')
  const keep = elementType !== T.STRING && count <= MAX_KEPT_ARRAY
  const values = keep ? [] : null
  for (let i = 0; i < count; i++) {
    const value = readScalar(reader, elementType)
    if (keep) values.push(value)
  }
  return keep ? values : { arrayLength: count, elementType }
}

/** Parse the header through `readChunk(position, length)`; returns `{ version, tensorCount, kv }`. */
function parseMetadata(readChunk) {
  const reader = new Reader(readChunk)
  const magic = reader.u32()
  if (magic !== GGUF_MAGIC) throw new Error(`not a GGUF file (magic 0x${magic.toString(16)})`)
  const version = reader.u32()
  if (version < 2 || version > 3) throw new Error(`unsupported GGUF version ${version}`)
  const tensorCount = reader.u64()
  const kvCount = reader.u64()
  const kv = {}
  for (let i = 0; i < kvCount; i++) {
    const key = reader.string()
    const type = reader.u32()
    kv[key] = readValue(reader, type)
  }
  return { version, tensorCount, kv }
}

function parseBuffer(buffer) {
  return parseMetadata((pos, len) => buffer.subarray(pos, pos + len))
}

function readMetadata(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    return parseMetadata((pos, len) => {
      const buffer = Buffer.alloc(len)
      const read = fs.readSync(fd, buffer, 0, len, pos)
      return buffer.subarray(0, read)
    })
  } finally {
    fs.closeSync(fd)
  }
}

/** The geometry sizing needs, read through the architecture prefix (`llama.block_count`, ...). */
function modelGeometry(meta) {
  const kv = meta.kv
  const architecture = kv['general.architecture']
  if (typeof architecture !== 'string') throw new Error('GGUF: general.architecture missing')
  const g = (suffix) => kv[`${architecture}.${suffix}`]
  return {
    architecture,
    name: typeof kv['general.name'] === 'string' ? kv['general.name'] : null,
    blockCount: g('block_count') ?? null,
    contextLength: g('context_length') ?? null,
    embeddingLength: g('embedding_length') ?? null,
    headCount: g('attention.head_count') ?? null,
    headCountKv: g('attention.head_count_kv') ?? g('attention.head_count') ?? null,
    keyLength: g('attention.key_length') ?? null,
    valueLength: g('attention.value_length') ?? null,
    fullAttentionInterval: g('full_attention_interval') ?? null,
    splitCount: kv['split.count'] ?? 1,
  }
}

module.exports = { T, parseMetadata, parseBuffer, readMetadata, modelGeometry }
