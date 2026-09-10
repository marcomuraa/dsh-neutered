'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadCatalog, validateCatalog, findEntry, resolveCustom, CATALOG_PATH } = require('../lib/catalog.cjs')

const VALID = {
  id: 'x-q4', name: 'X Q4', repo: 'owner/X-GGUF', files: ['X-Q4.gguf'], sizeBytes: 1000, sha256: [],
  nativeContext: 32768, tags: ['recommended'], serverArgs: [], pinned: false,
}

test('loadCatalog: the shipped catalog validates and has exactly one recommended entry', () => {
  const entries = loadCatalog(CATALOG_PATH)
  assert.ok(entries.length >= 5)
  assert.equal(entries.filter((e) => e.tags.includes('recommended')).length, 1)
  assert.equal(findEntry(entries, 'qwen3.8-27b-q4').repo, 'unsloth/Qwen3.8-27B-GGUF')
  assert.equal(findEntry(entries, 'nope'), null)
})

test('validateCatalog: rejects duplicates, bad files, unknown tags, missing pinned, two recommended', () => {
  assert.throws(() => validateCatalog([VALID, { ...VALID, tags: ['small'] }]), /duplicate id/)
  assert.throws(() => validateCatalog([{ ...VALID, files: ['/abs/X.gguf'] }]), /files/)
  assert.throws(() => validateCatalog([{ ...VALID, files: ['../X.gguf'] }]), /files/)
  assert.throws(() => validateCatalog([{ ...VALID, tags: ['recommended', 'huge'] }]), /unknown tag/)
  assert.throws(() => validateCatalog([{ ...VALID, pinned: 'yes' }]), /pinned/)
  assert.throws(() => validateCatalog([VALID, { ...VALID, id: 'y' }]), /exactly one entry/)
  assert.throws(() => validateCatalog([{ ...VALID, sha256: ['a', 'b'] }]), /sha256/)
})

test('resolveCustom: owner/repo:file becomes a remote custom entry', () => {
  const entry = resolveCustom('unsloth/Qwen3.5-9B-GGUF:Qwen3.5-9B-UD-Q6_K_XL.gguf')
  assert.deepEqual(entry, {
    id: 'custom', name: 'Qwen3.5-9B-UD-Q6_K_XL', repo: 'unsloth/Qwen3.5-9B-GGUF', files: ['Qwen3.5-9B-UD-Q6_K_XL.gguf'],
    sizeBytes: null, sha256: [], nativeContext: null, tags: ['custom'], serverArgs: [], pinned: false, local: false,
  })
})

test('resolveCustom: an existing .gguf path becomes a local custom entry', () => {
  const statSync = (p) => { if (p === '/models/my.gguf') return { isFile: () => true, size: 4242 }; throw new Error('ENOENT') }
  const entry = resolveCustom('/models/my.gguf', { statSync })
  assert.equal(entry.local, true)
  assert.equal(entry.name, 'my')
  assert.equal(entry.sizeBytes, 4242)
  assert.deepEqual(entry.files, ['/models/my.gguf'])
})

test('resolveCustom: rejects empty, non-gguf and missing inputs', () => {
  const statSync = () => { throw new Error('ENOENT') }
  assert.throws(() => resolveCustom('   '), /empty/)
  assert.throws(() => resolveCustom('owner/repo:notes.txt'), /\.gguf/)
  assert.throws(() => resolveCustom('/nowhere/x.gguf', { statSync }), /neither/)
})
