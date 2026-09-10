/**
 * @deepseek-ai/dsh-repl — the interactive terminal driver. One Agent lives for
 * the whole process: every submitted prompt is a follow-up on it, Esc cancels
 * the running turn, prompts typed during a turn queue for the next one, and
 * Ctrl-C twice, Ctrl-D or stdin EOF flushes the Session and exits.
 *
 * @module @deepseek-ai/dsh-repl
 */

import { randomUUID } from 'node:crypto'
import { createInterface, emitKeypressEvents } from 'node:readline'
import type { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
// Empty type imports carry the Context merges for sessionPersistence, the
// loader settlement await and the cmdline appExit host value.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { installApprovalAnswerer } from './approval.ts'
import { TerminalInput } from './input.ts'
import type { InputEvent, Key } from './input.ts'
import { initialRenderState, renderEvent } from './render.ts'

/** Stable Cordis plugin name. */
export const name = 'repl-runner'

/** Core services required before the session can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the startup values resolved from this app's provider service. */
export interface Config {
  /** `true` resumes the most recent persisted session, a string resumes that id, absent starts fresh. */
  resume?: string | true
  /** Print the ten most recent sessions and exit. */
  listSessions: boolean
}

export const Config: z<Config> = z.object({
  resume: z.union([z.string(), z.const(true)]),
  listSessions: z.boolean().default(false),
})

/** The stdin the runner reads; a terminal exposes raw mode. */
export type ReplStdin = Readable & {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
}

/** Process-facing effects of the session: streams, environment, bounded exit request. */
interface ReplIo {
  stdin: ReplStdin
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  env: NodeJS.ProcessEnv
  exit(code: number): void
}

/** The process streams the runner uses; tests substitute captures. */
export const internals: Omit<ReplIo, 'exit'> = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
}

const PROMPT = 'dsh> '
const PASTE_ON = '\x1b[?2004h'
const PASTE_OFF = '\x1b[?2004l'
const LISTING_LIMIT = 10

/** Persisted session headers, newest first. */
async function recentSessions(ctx: Context): Promise<SessionHeader[]> {
  const persistence = ctx.get('sessionPersistence')
  const headers = persistence === undefined ? [] : await persistence.list()
  return [...headers].sort((a, b) => b.createdAt - a.createdAt)
}

async function printSessions(ctx: Context, io: ReplIo): Promise<void> {
  const recent = (await recentSessions(ctx)).slice(0, LISTING_LIMIT)
  if (recent.length === 0) {
    io.stdout.write('no persisted sessions\n')
    return
  }
  for (const header of recent) {
    io.stdout.write(`${new Date(header.createdAt).toISOString()}  ${header.id}  ${header.cwd ?? ''}\n`)
  }
}

/** Report an unexpected driver failure and request a failing exit. */
function fail(io: ReplIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Create or resume the Agent, then drive it from stdin until exit.
 * @param ctx - plugin context carrying the Agent registry, default model, Sessions and launcher IO.
 * @param config - validated startup values.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: ReplIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  if (config.listSessions) {
    await printSessions(ctx, io)
    io.exit(0)
    return
  }
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  const selection = defaultModel.currentSelection()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const setup = (agentCtx: Context): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }
  let agent: Agent
  if (config.resume === undefined) {
    ({ agent } = await agents.create({
      sessionId: brandString<SessionId>(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup,
    }))
    io.stdout.write(`session ${agent.session.id}\n`)
  } else {
    const id = config.resume === true
      ? (await recentSessions(ctx))[0]?.id
      : brandString<SessionId>(config.resume)
    if (id === undefined) {
      throw new Error('no persisted session to resume')
    }
    ({ agent } = await agents.resume({ resumeSessionId: id, agentOptions, setup }))
    io.stdout.write(`session ${agent.session.id} (resumed)\n`)
  }
  await agent.whenIdle()

  const tty = io.stdin.isTTY === true
  const state = initialRenderState()
  const reasoning = io.env.DSH_REPL_REASONING !== '0'
  const stopRender = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    const rendered = renderEvent(event, state, { reasoning })
    if (rendered.out !== undefined) io.stdout.write(rendered.out)
    if (rendered.err !== undefined) io.stderr.write(rendered.err)
  })

  const input = new TerminalInput({ write: (text) => { if (tty) io.stdout.write(text) } })
  let running = false
  let finished = false
  let teardown = (): void => {}
  let stopApproval = (): void => {}
  let pendingApproval: ((outcome: 'allowed-once' | 'rejected') => void) | undefined

  const prompt = (): void => {
    if (tty && !finished) io.stdout.write(PROMPT)
  }
  const settle = async (): Promise<void> => {
    // A live driver runs queued follow-ups inside the same activity, so idle
    // means the whole queue ran. A turn the operator cancelled leaves its
    // queue pending until the next prompt wakes the driver.
    do {
      await agent.whenIdle()
      await new Promise<void>(resolve => setImmediate(resolve))
    } while (agent.status === 'running')
    const pending = agent.inbox.nextTurn.length
    if (pending > 0) io.stdout.write(`pending (${String(pending)}): the next prompt runs them first\n`)
  }
  const finish = async (): Promise<void> => {
    if (finished) return
    finished = true
    teardown()
    stopApproval()
    stopRender()
    await sessions.flush(agent.session)
    io.exit(0)
  }
  const submit = (text: string): void => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    if (running) {
      io.stdout.write(`queued (${String(agent.inbox.nextTurn.length)})\n`)
      return
    }
    running = true
    void settle().then(() => {
      running = false
      prompt()
    })
  }
  const dispatch = (event: InputEvent | undefined): void => {
    if (event === undefined || finished) return
    switch (event.type) {
      case 'submit':
        submit(event.text)
        return
      case 'cancel':
        if (running) agent.cancel({ kind: 'user' }, { keepInbox: true })
        else prompt()
        return
      case 'exit':
        void finish().catch((error: unknown) => { fail(io, error) })
        return
      case 'approve':
        pendingApproval?.('allowed-once')
        return
      case 'reject':
        pendingApproval?.('rejected')
        return
    }
  }

  if (tty) {
    stopApproval = installApprovalAnswerer(ctx, agent, {
      ask: (question, signal) => new Promise((resolve) => {
        io.stdout.write(`\n${question}`)
        input.setMode('approval')
        const answer = (outcome: 'allowed-once' | 'rejected'): void => {
          signal?.removeEventListener('abort', onAbort)
          pendingApproval = undefined
          input.setMode('prompt')
          io.stdout.write('\n')
          resolve(outcome)
        }
        const onAbort = (): void => { answer('rejected') }
        signal?.addEventListener('abort', onAbort, { once: true })
        pendingApproval = answer
      }),
    })
    emitKeypressEvents(io.stdin)
    io.stdin.setRawMode?.(true)
    io.stdout.write(PASTE_ON)
    const onKeypress = (str: string | undefined, key: Key | undefined): void => {
      dispatch(input.keypress(str, key ?? {}))
    }
    io.stdin.on('keypress', onKeypress)
    io.stdin.resume()
    teardown = () => {
      io.stdin.off('keypress', onKeypress)
      io.stdout.write(PASTE_OFF)
      io.stdin.setRawMode?.(false)
      io.stdin.pause()
    }
  } else {
    const lines = createInterface({ input: io.stdin, crlfDelay: Infinity, terminal: false })
    lines.on('line', (line) => { dispatch(input.line(line)) })
    lines.on('close', () => {
      void settle().then(() => { dispatch({ type: 'exit' }) })
    })
    teardown = () => { lines.close() }
  }
  prompt()
}

/**
 * Mount the interactive driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup values.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('repl-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: ReplIo = { ...internals, exit }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
