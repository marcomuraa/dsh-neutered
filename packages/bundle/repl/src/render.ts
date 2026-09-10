/**
 * Session events to terminal lines for the REPL: assistant text streams to
 * stdout as it arrives, each tool call and each result takes one line, and
 * provider reasoning goes to stderr when enabled. Pure: the runner writes.
 * @module
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface RenderOptions {
  /** Forward provider reasoning to stderr. */
  reasoning: boolean
}

/** Which output lines are open, so the next line can close them first. */
export interface RenderState {
  /** Assistant text is open on stdout and its last character was not a newline. */
  textOpen: boolean
  /** Reasoning is open on stderr and its last character was not a newline. */
  reasoningOpen: boolean
}

export interface Rendered {
  out?: string
  err?: string
}

export function initialRenderState(): RenderState {
  return { textOpen: false, reasoningOpen: false }
}

const SUMMARY_WIDTH = 80

/** The first line of `text`, clipped to the summary width. */
export function clip(text: string): string {
  const line = text.split('\n', 1)[0] ?? ''
  return line.length > SUMMARY_WIDTH ? `${line.slice(0, SUMMARY_WIDTH - 1)}…` : line
}

/** The first non-blank string argument of a tool call, or the raw text when there is none. */
export function summarizeArguments(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') {
      for (const value of Object.values(parsed as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim() !== '') return clip(value.trim())
      }
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return clip(raw.trim())
}

function closeText(state: RenderState): string {
  if (!state.textOpen) return ''
  state.textOpen = false
  return '\n'
}

function closeReasoning(state: RenderState): string {
  if (!state.reasoningOpen) return ''
  state.reasoningOpen = false
  return '\n'
}

function merge(out: string, err: string): Rendered {
  const rendered: Rendered = {}
  if (out !== '') rendered.out = out
  if (err !== '') rendered.err = err
  return rendered
}

/** Render one session event of the REPL's own agent. */
export function renderEvent(event: SessionEvent, state: RenderState, options: RenderOptions): Rendered {
  switch (event.type) {
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        if (chunk.text === '') return {}
        const err = closeReasoning(state)
        state.textOpen = !chunk.text.endsWith('\n')
        return merge(chunk.text, err)
      }
      if (chunk.type === 'reasoning-delta') {
        if (!options.reasoning || chunk.text === '') return {}
        const prefix = state.reasoningOpen ? '' : 'dsh: reasoning:\n'
        state.reasoningOpen = !chunk.text.endsWith('\n')
        return merge('', prefix + chunk.text)
      }
      return {}
    }
    case 'tool/call': {
      const out = closeText(state)
      const err = closeReasoning(state)
      return merge(`${out}> ${event.data.name}: ${summarizeArguments(event.data.arguments)}\n`, err)
    }
    case 'tool/result': {
      const block = event.data.message.content[0]
      const text = block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
      const lines = text === '' ? 0 : text.split('\n').length
      const status = event.data.error !== undefined
        ? `error ${event.data.error.code}`
        : block.isError === true ? 'error' : 'ok'
      const summary = clip(text.trim())
      const suffix = lines > 1 ? ` (${String(lines)} lines)` : ''
      return merge(`< ${status}${summary === '' ? '' : `: ${summary}`}${suffix}\n`, '')
    }
    case 'turn/end': {
      const out = closeText(state)
      let err = closeReasoning(state)
      const reason = event.data.reason
      if (reason.kind === 'error') err += `dsh: ${reason.error.code}: ${reason.error.message}\n`
      else if (reason.kind === 'aborted') err += 'dsh: turn cancelled\n'
      return merge(out, err)
    }
    default:
      return {}
  }
}
