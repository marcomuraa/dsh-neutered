'use strict'

// The curated model catalog and the custom escape hatch.

const fs = require('node:fs')
const path = require('node:path')

const CATALOG_PATH = path.join(__dirname, '..', 'catalog.json')
const KNOWN_TAGS = new Set(['recommended', 'dense', 'moe', 'small', 'quality', 'fast', 'coder', 'large', 'custom'])
const ID_RE = /^[a-z0-9][a-z0-9.-]*$/
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

function validFileName(file) {
  return typeof file === 'string' && file.endsWith('.gguf') && !file.startsWith('/') && !file.split('/').includes('..') && !file.split('/').includes('')
}

function validateCatalog(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('catalog: expected a non-empty array')
  const ids = new Set()
  let recommended = 0
  entries.forEach((e, i) => {
    const at = `catalog[${i}]`
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) throw new Error(`${at}: bad id ${JSON.stringify(e.id)}`)
    if (ids.has(e.id)) throw new Error(`${at}: duplicate id ${e.id}`)
    ids.add(e.id)
    if (typeof e.name !== 'string' || e.name === '') throw new Error(`${at}: name missing`)
    if (typeof e.repo !== 'string' || !REPO_RE.test(e.repo)) throw new Error(`${at}: repo must be owner/name`)
    if (!Array.isArray(e.files) || e.files.length === 0 || !e.files.every(validFileName)) {
      throw new Error(`${at}: files must be non-empty relative .gguf paths`)
    }
    if (!Number.isInteger(e.sizeBytes) || e.sizeBytes <= 0) throw new Error(`${at}: sizeBytes must be a positive integer`)
    if (!Array.isArray(e.sha256) || (e.sha256.length !== 0 && e.sha256.length !== e.files.length)) {
      throw new Error(`${at}: sha256 must be empty or parallel to files`)
    }
    if (!Number.isInteger(e.nativeContext) || e.nativeContext < 32768) throw new Error(`${at}: nativeContext must be >= 32768`)
    if (!Array.isArray(e.tags) || e.tags.length === 0 || !e.tags.every((t) => KNOWN_TAGS.has(t))) throw new Error(`${at}: unknown tag`)
    if (!Array.isArray(e.serverArgs) || !e.serverArgs.every((a) => typeof a === 'string')) throw new Error(`${at}: serverArgs must be strings`)
    if (typeof e.pinned !== 'boolean') throw new Error(`${at}: pinned must be a boolean`)
    if (e.tags.includes('recommended')) recommended++
  })
  if (recommended !== 1) throw new Error(`catalog: exactly one entry must carry the recommended tag (found ${recommended})`)
  return entries
}

function loadCatalog(file = CATALOG_PATH) {
  return validateCatalog(JSON.parse(fs.readFileSync(file, 'utf8')))
}

function findEntry(entries, id) {
  return entries.find((e) => e.id === id) || null
}

/** `owner/repo:file.gguf` becomes a remote custom entry; an existing local `.gguf` path a local one. */
function resolveCustom(spec, { statSync = fs.statSync } = {}) {
  const trimmed = String(spec || '').trim()
  if (trimmed === '') throw new Error('custom model: empty specification')
  const colon = trimmed.lastIndexOf(':')
  const looksRemote = colon > 0 && REPO_RE.test(trimmed.slice(0, colon))
  if (looksRemote) {
    const repo = trimmed.slice(0, colon)
    const file = trimmed.slice(colon + 1)
    if (!validFileName(file)) throw new Error(`custom model: '${file}' must be a relative .gguf path inside ${repo}`)
    return {
      id: 'custom', name: path.basename(file, '.gguf'), repo, files: [file], sizeBytes: null, sha256: [],
      nativeContext: null, tags: ['custom'], serverArgs: [], pinned: false, local: false,
    }
  }
  const abs = path.resolve(trimmed.replace(/^~(?=\/|$)/, process.env.HOME || ''))
  let stat
  try {
    stat = statSync(abs)
  } catch {
    throw new Error(`custom model: '${trimmed}' is neither owner/repo:file.gguf nor an existing file`)
  }
  if (!stat.isFile() || !abs.endsWith('.gguf')) throw new Error(`custom model: '${abs}' is not a .gguf file`)
  return {
    id: 'custom', name: path.basename(abs, '.gguf'), repo: null, files: [abs], sizeBytes: stat.size, sha256: [],
    nativeContext: null, tags: ['custom'], serverArgs: [], pinned: false, local: true,
  }
}

module.exports = { CATALOG_PATH, KNOWN_TAGS, validateCatalog, loadCatalog, findEntry, resolveCustom }
