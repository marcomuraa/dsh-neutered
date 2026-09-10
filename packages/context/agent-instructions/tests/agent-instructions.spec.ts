import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as workspaceContext from '@deepseek-ai/dsh-agent-instructions'
import {
  discoverBaselineInstructionFiles,
  loadBaselineInstructions,
  renderWorkspaceContext,
} from '@deepseek-ai/dsh-agent-instructions'
import { INSTRUCTION_FILE, resolveConfig, workspaceBaselineIdentity } from '../src/config.ts'
import { candidateScopeKey, decodeScopeKey, instructionScopeKey } from '../src/render.ts'

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-context-'))
  await mkdir(join(root, '.git'), { recursive: true })
  return root
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

describe('workspace context instruction discovery', () => {
  it('reads only DSH_INSTRUCTIONS.md, from the project root down to the cwd', async () => {
    const root = await tempRepo()
    try {
      const cwd = join(root, 'packages', 'app')
      await write(join(root, INSTRUCTION_FILE), 'root rules')
      await write(join(root, 'AGENTS.md'), 'agents rules')
      await write(join(root, 'CLAUDE.md'), 'claude rules')
      await write(join(root, 'DSH_INSTRUCTIONS.local.md'), 'local rules')
      await write(join(root, 'packages', 'CLAUDE.md'), 'package claude rules')
      await write(join(cwd, INSTRUCTION_FILE), 'app rules')

      const files = await discoverBaselineInstructionFiles({ cwd })

      expect(files.map(file => file.displayPath)).toEqual([
        INSTRUCTION_FILE,
        join('packages', 'app', INSTRUCTION_FILE),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads nothing above the project root or under the harness home', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'dsh-workspace-context-outer-'))
    const home = await mkdtemp(join(tmpdir(), 'dsh-workspace-context-home-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const root = join(outer, 'repo')
      await mkdir(join(root, '.git'), { recursive: true })
      await write(join(outer, INSTRUCTION_FILE), 'outside rules')
      await write(join(home, INSTRUCTION_FILE), 'home rules')
      await write(join(home, 'AGENTS.md'), 'home agents rules')

      expect(await discoverBaselineInstructionFiles({ cwd: root })).toEqual([])
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(outer, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })

  it('loads the chain in precedence order and follows a symlink named DSH_INSTRUCTIONS.md', async () => {
    const root = await tempRepo()
    try {
      const cwd = join(root, 'pkg')
      await write(join(root, 'AGENTS.md'), 'shared rules')
      await symlink('AGENTS.md', join(root, INSTRUCTION_FILE))
      await write(join(cwd, INSTRUCTION_FILE), 'package rules')

      const rendered = await loadBaselineInstructions({ cwd, maxBytes: 65536 })

      expect(rendered?.text).toContain(`Instructions from: ${INSTRUCTION_FILE}\n\nshared rules`)
      expect(rendered?.text).toContain(`Instructions from: ${join('pkg', INSTRUCTION_FILE)}\n\npackage rules`)
      expect(rendered?.text.indexOf('shared rules')).toBeLessThan(rendered?.text.indexOf('package rules') ?? -1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('treats a directory carrying the name as absent', async () => {
    const root = await tempRepo()
    try {
      await mkdir(join(root, INSTRUCTION_FILE))

      expect(await discoverBaselineInstructionFiles({ cwd: root })).toEqual([])
      expect(await loadBaselineInstructions({ cwd: root, maxBytes: 65536 })).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('loads nothing when the byte budget is disabled or the file exceeds the source cap', async () => {
    const root = await tempRepo()
    try {
      await write(join(root, INSTRUCTION_FILE), 'x'.repeat(64))

      expect(await loadBaselineInstructions({ cwd: root, maxBytes: 0 })).toBeUndefined()
      expect(await loadBaselineInstructions({ cwd: root, maxBytes: 65536, maxSourceBytes: 16 })).toBeUndefined()
      expect((await loadBaselineInstructions({ cwd: root, maxBytes: 65536 }))?.text).toContain('x'.repeat(64))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('workspace context rendering and scope keys', () => {
  it('renders the baseline inside one system-reminder without absolute paths', () => {
    const rendered = renderWorkspaceContext([
      { absolutePath: '/repo/DSH_INSTRUCTIONS.md', displayPath: 'DSH_INSTRUCTIONS.md', content: 'root rules' },
      { absolutePath: '/repo/pkg/DSH_INSTRUCTIONS.md', displayPath: 'pkg/DSH_INSTRUCTIONS.md', content: 'package rules' },
    ], { maxBytes: 65536 })

    expect(rendered.text).toBe([
      '<system-reminder>',
      'The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.',
      '',
      'Instructions from: DSH_INSTRUCTIONS.md',
      '',
      'root rules',
      '',
      'Instructions from: pkg/DSH_INSTRUCTIONS.md',
      '',
      'package rules',
      '</system-reminder>',
    ].join('\n'))
    expect(rendered.text).not.toContain('/repo/')
    expect(rendered.omitted).toEqual([])
    expect(rendered.truncated).toEqual([])
  })

  it('keys every scope by its directory and the fixed file name', () => {
    expect(instructionScopeKey('DSH_INSTRUCTIONS.md')).toBe(candidateScopeKey('.', INSTRUCTION_FILE))
    expect(instructionScopeKey('pkg/DSH_INSTRUCTIONS.md')).toBe(candidateScopeKey('pkg', INSTRUCTION_FILE))
    expect(decodeScopeKey(candidateScopeKey('pkg', INSTRUCTION_FILE)))
      .toEqual({ directory: 'pkg', candidateName: INSTRUCTION_FILE })
  })
})

describe('workspace context configuration', () => {
  it('fixes the file name and identifies a baseline by root, markers and byte caps only', () => {
    expect(INSTRUCTION_FILE).toBe('DSH_INSTRUCTIONS.md')

    const resolved = resolveConfig({ maxBytes: 65536 })

    expect(resolved).toEqual({ projectRootMarkers: ['.git'], maxBytes: 65536, maxSourceBytes: 1_048_576 })
    expect(JSON.parse(workspaceBaselineIdentity(resolved, join('/repo', 'pkg'), '/repo'))).toEqual({
      projectRoot: '..',
      projectRootMarkers: ['.git'],
      maxBytes: 65536,
      maxSourceBytes: 1_048_576,
    })
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/Config/apply', () => {
    expect('default' in workspaceContext).toBe(false)
    expect(typeof workspaceContext.apply).toBe('function')

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(workspaceContext) as Record<string, unknown>
    expect(unwrapped).toBe(workspaceContext)
    expect(unwrapped.name).toBe('agent-instructions')
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })
})
