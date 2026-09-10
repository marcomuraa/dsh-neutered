import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, internals } from '../src/index.ts'

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

/** Append one complete assistant turn answering `message` with `text`. */
function answer(session: Session, turn: number, message: UserMessage, text: string): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  session.append('assistant/chunk', { turn, step: 1, chunk: { type: 'text-delta', index: 0, text } })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'test-provider', model: 'test-model' } }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

interface Bench {
  ctx: Context
  stdin: PassThrough & { isTTY?: boolean; setRawMode?: (mode: boolean) => void }
  prompts: string[]
  cancels: number
  out: () => string
  err: () => string
  exited: Promise<number>
  order: string[]
  /** Resolve to end the turn the fake agent is running. */
  release: () => void
}

async function bench(options: { tty: boolean; delayTurns?: boolean } = { tty: false }): Promise<Bench> {
  const ctx = new Context()
  let out = ''
  let err = ''
  const order: string[] = []
  const prompts: string[] = []
  const bench = { cancels: 0, release: () => {} } as unknown as Bench
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options2: CreateAgentOptions): Promise<AgentHandle> {
      const session = ctx.sessions.create(options2.sessionId, { ...options2.meta === undefined ? {} : { meta: options2.meta } })
      let idle = Promise.resolve()
      let turn = 0
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
      const runOne = async (message: UserMessage): Promise<void> => {
        // A live driver claims the message when its turn opens, before any model work.
        turn += 1
        inbox.claim('next-turn', turn)
        if (options.delayTurns === true) await new Promise<void>((resolve) => { bench.release = resolve })
        answer(session, turn, message, `reply to ${message.content[0]?.type === 'text' ? message.content[0].text : '?'}`)
      }
      Object.assign(agent, {
        id: session.id,
        options: options2.agentOptions ?? {},
        session,
        inbox,
        status: 'idle',
        ctx: agentCtx,
        cancel: () => { bench.cancels += 1; bench.release() },
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          prompts.push(message.content[0]?.type === 'text' ? message.content[0].text : '?')
          inbox.append('next-turn', message)
          idle = idle.then(() => runOne(message))
        },
        steer: () => {},
        inject: () => {},
        whenIdle: () => idle,
      } satisfies Partial<Agent>)
      await options2.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  const stdin = new PassThrough() as Bench['stdin']
  if (options.tty) {
    stdin.isTTY = true
    stdin.setRawMode = () => {}
  }
  ctx.on('session/flush', () => { order.push('flush') })
  internals.stdin = stdin
  internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
  internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
  internals.env = {}
  const exited = new Promise<number>((resolve) => {
    ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
  })
  Object.assign(bench, { ctx, stdin, prompts, out: () => out, err: () => err, exited, order })
  return bench
}

describe('repl runner', () => {
  it('runs each piped line as a turn, streams the answers, flushes and exits 0 at EOF', async () => {
    const test = await bench({ tty: false })
    apply(test.ctx, { listSessions: false })
    test.stdin.end('first\n\nsecond\n')
    expect(await test.exited).toBe(0)
    expect(test.prompts).toEqual(['first', 'second'])
    expect(test.out()).toMatch(/^session session-[0-9a-f-]+\n/)
    expect(test.out()).toContain('reply to first\n')
    expect(test.out()).toContain('reply to second\n')
    expect(test.order).toEqual(['flush', 'exit'])
    await test.ctx.fiber.dispose()
  })
  it('in a terminal, prompts, queues a prompt typed during a turn and cancels on Esc', async () => {
    const test = await bench({ tty: true, delayTurns: true })
    apply(test.ctx, { listSessions: false })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(test.out()).toContain('dsh> ')
    test.stdin.write('go\r')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(test.prompts).toEqual(['go'])
    test.stdin.write('later\r')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(test.prompts).toEqual(['go', 'later'])
    expect(test.out()).toContain('queued (1)')
    test.stdin.write('\x1b')
    await new Promise(resolve => setTimeout(resolve, 700))
    expect(test.cancels).toBe(1)
    test.release()
    await new Promise(resolve => setTimeout(resolve, 20))
    test.stdin.write('\x03\x03')
    expect(await test.exited).toBe(0)
    expect(test.out()).toContain('[?2004h')
    expect(test.out()).toContain('[?2004l')
    await test.ctx.fiber.dispose()
  })
})
