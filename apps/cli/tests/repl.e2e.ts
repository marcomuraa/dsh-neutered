import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

/** Two piped prompts through the built `dsh --profile repl` against the mock model server. */
const dshBin = fileURLToPath(new URL('../lib/bin.js', import.meta.url))
const SPAWN_TIMEOUT_MS = 60_000

describe('dsh --profile repl (built bin)', () => {
  it('answers each piped line in order and exits 0 at EOF', async () => {
    const server = await startMockLlmServer({ host: '127.0.0.1', sequence: ['success'], repeatLast: true, successText: 'MOCK-ANSWER' })
    const home = mkdtempSync(join(tmpdir(), 'dsh-repl-e2e-'))
    const patch = join(home, 'mock.patch.yml')
    writeFileSync(patch, `- id: llm-local\n  config:\n    baseURL: http://127.0.0.1:${String(server.port)}/v1\n`)
    try {
      const result = await execa(process.execPath, [dshBin, '--profile', 'repl', '--patch', patch], {
        input: 'say one\nsay two\n',
        cwd: home,
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        reject: false,
        env: { ...process.env, DSH_HOME: join(home, '.dsh'), DSH_AGENTS_HOME: join(home, '.agents'), DSH_TELEMETRY_DISABLED: '1' },
        extendEnv: false,
      })
      expect(result.timedOut).toBe(false)
      expect(result.stderr).not.toContain('dsh: ')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^session session-/)
      expect(result.stdout.split('MOCK-ANSWER').length - 1).toBe(2)
    } finally {
      await server.close()
    }
  })
})
