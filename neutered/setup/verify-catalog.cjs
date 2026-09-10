#!/usr/bin/env node
'use strict'

// Maintainer tool (network): pin catalog sizes and SHA-256 hashes from the Hugging Face API and
// fail on file names that do not exist in their repository. Never run by a gate or a test.

const fs = require('node:fs')
const https = require('node:https')
const { CATALOG_PATH, loadCatalog } = require('./lib/catalog.cjs')

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'dsh-neutered-verify-catalog' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`${url}: HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject)
  })
}

async function listTree(repo) {
  const tree = await getJson(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`)
  const byPath = new Map()
  for (const item of tree) {
    if (item.type === 'file') byPath.set(item.path, { size: item.size, sha256: item.lfs ? item.lfs.sha256 : null })
  }
  return byPath
}

async function main() {
  const catalog = loadCatalog(CATALOG_PATH)
  const trees = new Map()
  const problems = []
  for (const entry of catalog) {
    if (!trees.has(entry.repo)) trees.set(entry.repo, await listTree(entry.repo))
    const tree = trees.get(entry.repo)
    let total = 0
    const hashes = []
    for (const file of entry.files) {
      const info = tree.get(file)
      if (!info) {
        problems.push(`${entry.id}: ${file} is not in ${entry.repo}`)
        continue
      }
      total += info.size
      hashes.push(info.sha256 || '')
    }
    if (hashes.length === entry.files.length) {
      entry.sizeBytes = total
      entry.sha256 = hashes.every(Boolean) ? hashes : []
      entry.pinned = true
      process.stdout.write(`${entry.id}: ${total} bytes${entry.sha256.length ? ', sha256 pinned' : ''}\n`)
    }
  }
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n')
  if (problems.length) {
    process.stderr.write(problems.join('\n') + '\n')
    process.exit(1)
  }
}

main().catch((error) => {
  process.stderr.write(`verify-catalog: ${error.message}\n`)
  process.exit(1)
})
