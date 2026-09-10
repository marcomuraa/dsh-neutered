import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a YAML mapping')
  }
  return value as Record<string, unknown>
}

function missingScripts(command: string, scripts: Record<string, unknown>): string[] {
  return [...command.matchAll(/\bpnpm run ([\w:-]+)/g)]
    .map(match => match[1]!)
    .filter(name => !Object.hasOwn(scripts, name))
}

describe('fork CI workflows', () => {
  const workflows = readdirSync(resolve(root, '.github/workflows'))
    .filter(file => /\.ya?ml$/.test(file))

  it('uses existing package scripts and read-only checkout tokens', () => {
    const manifest: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const scripts = record(record(manifest).scripts)
    expect(workflows.length).toBeGreaterThan(0)
    for (const file of workflows) {
      const workflow = record(yaml.load(readFileSync(resolve(root, '.github/workflows', file), 'utf8')))
      expect(record(workflow.permissions)).toEqual({ contents: 'read' })
      for (const value of Object.values(record(workflow.jobs))) {
        const job = record(value)
        if (job.permissions !== undefined) {
          expect(Object.values(record(job.permissions))).not.toContain('write')
        }
        expect(Array.isArray(job.steps)).toBe(true)
        for (const stepValue of job.steps as unknown[]) {
          const step = record(stepValue)
          if (typeof step.run === 'string') {
            expect(missingScripts(step.run, scripts), file).toEqual([])
          }
          if (typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@')) {
            expect(record(step.with)['persist-credentials']).toBe(false)
          }
        }
      }
    }
  })

  it('rejects a removed release script without rejecting supported commands', () => {
    expect(missingScripts('pnpm run build\npnpm run release:pack --family dsh', { build: 'tsx scripts/build.ts' }))
      .toEqual(['release:pack'])
  })
})
