import { Context } from '@deepseek-ai/cordis'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, REPL_STARTUP_SERVICE, type ReplStartupValues } from '../src/startup.ts'

afterEach(() => {
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

function parse(args: string[]): { values: ReplStartupValues | undefined; exits: number[]; out: string } {
  const exits: number[] = []
  let out = ''
  const observing = { write: (chunk: string) => { out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const ctx = new Context()
  provideCmdline(ctx, { args, exit: code => void exits.push(code) })
  apply(ctx)
  return { values: ctx.get(REPL_STARTUP_SERVICE) as ReplStartupValues | undefined, exits, out }
}

describe('repl command-line provider', () => {
  it('publishes a fresh-session start with no arguments', () => {
    expect(parse([])).toMatchObject({ values: { listSessions: false }, exits: [] })
  })
  it('publishes --resume without an id as true', () => {
    expect(parse(['--resume']).values).toEqual({ resume: true, listSessions: false })
  })
  it('publishes --resume with an id as that id', () => {
    expect(parse(['--resume', 'session-abc']).values).toEqual({ resume: 'session-abc', listSessions: false })
  })
  it('publishes --sessions', () => {
    expect(parse(['--sessions']).values).toEqual({ listSessions: true })
  })
  it('rejects task text with a usage error', () => {
    const result = parse(['do', 'things'])
    expect(result.values).toBeUndefined()
    expect(result.exits).toEqual([1])
    expect(result.out).toContain('too many arguments')
  })
})
