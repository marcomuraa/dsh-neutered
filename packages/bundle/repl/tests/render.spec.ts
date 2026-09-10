import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { clip, initialRenderState, renderEvent, summarizeArguments } from '../src/render.ts'

const ON = { reasoning: true }
const OFF = { reasoning: false }

function chunk(chunk: SessionEvent<'assistant/chunk'>['data']['chunk']): SessionEvent {
  return { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk } } as unknown as SessionEvent
}

function toolCall(name: string, args: string): SessionEvent {
  return { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name, arguments: args } } as unknown as SessionEvent
}

function toolResult(text: string, options: { isError?: boolean; error?: { name: string; code: string } } = {}): SessionEvent {
  return {
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text }], ...(options.isError === undefined ? {} : { isError: options.isError }) }] },
      ...(options.error === undefined ? {} : { error: options.error }),
    },
  } as unknown as SessionEvent
}

function turnEnd(reason: unknown): SessionEvent {
  return { type: 'turn/end', data: { turn: 1, reason } } as unknown as SessionEvent
}

describe('renderEvent', () => {
  it('streams text deltas to stdout and closes the line at turn end', () => {
    const state = initialRenderState()
    expect(renderEvent(chunk({ type: 'text-delta', index: 0, text: 'hel' }), state, ON)).toEqual({ out: 'hel' })
    expect(renderEvent(chunk({ type: 'text-delta', index: 0, text: 'lo' }), state, ON)).toEqual({ out: 'lo' })
    expect(renderEvent(turnEnd({ kind: 'completed' }), state, ON)).toEqual({ out: '\n' })
  })
  it('does not add a newline when the text already ended with one', () => {
    const state = initialRenderState()
    renderEvent(chunk({ type: 'text-delta', index: 0, text: 'done\n' }), state, ON)
    expect(renderEvent(turnEnd({ kind: 'completed' }), state, ON)).toEqual({})
  })
  it('prefixes reasoning once on stderr and can be switched off', () => {
    const state = initialRenderState()
    expect(renderEvent(chunk({ type: 'reasoning-delta', index: 0, text: 'think' }), state, ON)).toEqual({ err: 'dsh: reasoning:\nthink' })
    expect(renderEvent(chunk({ type: 'reasoning-delta', index: 0, text: 'ing' }), state, ON)).toEqual({ err: 'ing' })
    expect(renderEvent(chunk({ type: 'text-delta', index: 1, text: 'a' }), state, ON)).toEqual({ out: 'a', err: '\n' })
    expect(renderEvent(chunk({ type: 'reasoning-delta', index: 0, text: 'x' }), initialRenderState(), OFF)).toEqual({})
  })
  it('renders a tool call as one line with the first string argument', () => {
    const state = initialRenderState()
    expect(renderEvent(toolCall('bash', '{"command":"git status","timeout":5}'), state, ON)).toEqual({ out: '> bash: git status\n' })
  })
  it('closes an open text line before a tool call line', () => {
    const state = initialRenderState()
    renderEvent(chunk({ type: 'text-delta', index: 0, text: 'Let me look' }), state, ON)
    expect(renderEvent(toolCall('fs_read', '{"path":"a.ts"}'), state, ON)).toEqual({ out: '\n> fs_read: a.ts\n' })
  })
  it('renders ok, error-flag and error-code results', () => {
    const state = initialRenderState()
    expect(renderEvent(toolResult('On branch main\nnothing to commit'), state, ON)).toEqual({ out: '< ok: On branch main (2 lines)\n' })
    expect(renderEvent(toolResult('no such file', { isError: true }), state, ON)).toEqual({ out: '< error: no such file\n' })
    expect(renderEvent(toolResult('', { error: { name: 'ToolError', code: 'TIMEOUT' } }), state, ON)).toEqual({ out: '< error TIMEOUT\n' })
  })
  it('reports errored and cancelled turns on stderr', () => {
    expect(renderEvent(turnEnd({ kind: 'error', error: { code: 'NO_ADAPTER', message: 'no route' } }), initialRenderState(), ON))
      .toEqual({ err: 'dsh: NO_ADAPTER: no route\n' })
    expect(renderEvent(turnEnd({ kind: 'aborted', reason: { kind: 'user' } }), initialRenderState(), ON))
      .toEqual({ err: 'dsh: turn cancelled\n' })
  })
  it('ignores unrelated events', () => {
    expect(renderEvent({ type: 'turn/start', data: { turn: 1 } } as unknown as SessionEvent, initialRenderState(), ON)).toEqual({})
  })
})

describe('summaries', () => {
  it('clips to the first line and 80 characters', () => {
    expect(clip('a\nb')).toBe('a')
    expect(clip('x'.repeat(100))).toBe(`${'x'.repeat(79)}…`)
  })
  it('falls back to the raw text when arguments are not JSON or hold no string', () => {
    expect(summarizeArguments('not json')).toBe('not json')
    expect(summarizeArguments('{"n":1}')).toBe('{"n":1}')
  })
})
