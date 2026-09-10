'use strict'

// Memory arithmetic for dsh-neutered setup. Pure functions, no I/O. All sizes are bytes.

const GIB = 1024 ** 3
const CONTEXT_STEPS = Object.freeze([32768, 65536, 131072, 262144])
const COMPUTE_FIXED_BYTES = GIB
const COMPUTE_PER_TOKEN_BYTES = 4096
const MAX_TOKENS_CAP = 32768
const KV_BYTES_PER_ELEMENT = 2 // f16 keys and values

/** Bytes of KV cache one token costs, from the GGUF geometry (see gguf-header.cjs). */
function kvBytesPerToken(geom) {
  const layers = geom.blockCount
  if (!Number.isInteger(layers) || layers <= 0) throw new Error('kvBytesPerToken: blockCount missing')
  const keyLength =
    geom.keyLength ?? (geom.embeddingLength && geom.headCount ? geom.embeddingLength / geom.headCount : null)
  if (!keyLength) {
    throw new Error('kvBytesPerToken: key length unknown (no attention.key_length, embedding_length or head_count)')
  }
  const valueLength = geom.valueLength ?? keyLength
  const perHead = (keyLength + valueLength) * KV_BYTES_PER_ELEMENT
  if (Array.isArray(geom.headCountKv)) {
    return geom.headCountKv.reduce((sum, heads) => sum + heads * perHead, 0)
  }
  if (!Number.isInteger(geom.headCountKv) || geom.headCountKv <= 0) {
    throw new Error('kvBytesPerToken: head_count_kv missing')
  }
  const attentionLayers = geom.fullAttentionInterval ? Math.floor(layers / geom.fullAttentionInterval) : layers
  return attentionLayers * geom.headCountKv * perHead
}

/** Weights plus KV cache plus an approximation of llama.cpp's compute buffers. */
function memoryFor(geom, fileBytes, contextWindow) {
  return fileBytes + contextWindow * kvBytesPerToken(geom) + COMPUTE_FIXED_BYTES + contextWindow * COMPUTE_PER_TOKEN_BYTES
}

function fitsContext(geom, fileBytes, budgetBytes, contextWindow) {
  return memoryFor(geom, fileBytes, contextWindow) <= budgetBytes
}

/** Largest step that fits the budget and does not exceed the model's native context, or null. */
function chooseContext(geom, fileBytes, budgetBytes, steps = CONTEXT_STEPS) {
  const native = geom.contextLength ?? Infinity
  let best = null
  for (const ctx of steps) {
    if (ctx > native) break
    if (fitsContext(geom, fileBytes, budgetBytes, ctx)) best = ctx
  }
  if (best === null) return null
  return { contextWindow: best, kvBytes: best * kvBytesPerToken(geom), totalBytes: memoryFor(geom, fileBytes, best) }
}

function maxTokensFor(contextWindow) {
  return Math.min(MAX_TOKENS_CAP, Math.floor(contextWindow / 4))
}

/** Stand-in for KV cache and buffers before the model header is available. */
function preHeaderAllowance(sizeBytes) {
  return Math.min(3 * GIB, Math.max(GIB, Math.floor(sizeBytes / 4)))
}

/** Split catalog entries into those that fit the budget (ordered for display) and those that do not. */
function rankCatalog(entries, budgetBytes) {
  const fits = []
  const tooLarge = []
  for (const entry of entries) {
    if (entry.sizeBytes + preHeaderAllowance(entry.sizeBytes) <= budgetBytes) fits.push(entry)
    else tooLarge.push(entry)
  }
  const rank = (entry) => (entry.tags.includes('recommended') ? 0 : 1)
  fits.sort((a, b) => rank(a) - rank(b) || b.sizeBytes - a.sizeBytes)
  tooLarge.sort((a, b) => a.sizeBytes - b.sizeBytes)
  return { fits, tooLarge }
}

function formatGiB(bytes) {
  return `${(bytes / GIB).toFixed(1)} GiB`
}

module.exports = {
  GIB,
  CONTEXT_STEPS,
  kvBytesPerToken,
  memoryFor,
  fitsContext,
  chooseContext,
  maxTokensFor,
  preHeaderAllowance,
  rankCatalog,
  formatGiB,
}
