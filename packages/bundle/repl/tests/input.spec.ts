import { describe, expect, it } from 'vitest'
import { TerminalInput } from '../src/input.ts'
import type { InputEvent, Key } from '../src/input.ts'

function machine(now: () => number = () => 0): { input: TerminalInput; echoed: () => string } {
  let echoed = ''
  const input = new TerminalInput({ write: (text) => { echoed += text } }, { now })
  return { input, echoed: () => echoed }
}

/** Feed printable text one keypress at a time, then the given special keys. */
function type(input: TerminalInput, text: string, ...keys: Key[]): (InputEvent | undefined)[] {
  const events: (InputEvent | undefined)[] = []
  for (const ch of text) events.push(input.keypress(ch, { sequence: ch, name: ch }))
  for (const key of keys) events.push(input.keypress(undefined, key))
  return events
}

const RETURN: Key = { name: 'return', sequence: '\r' }
const ESC: Key = { name: 'escape', sequence: '\x1b' }
const CTRL_C: Key = { name: 'c', ctrl: true, sequence: '\x03' }
const CTRL_D: Key = { name: 'd', ctrl: true, sequence: '\x04' }
const PASTE_START: Key = { name: 'paste-start', sequence: '\x1b[200~' }
const PASTE_END: Key = { name: 'paste-end', sequence: '\x1b[201~' }

describe('TerminalInput keypress mode', () => {
  it('submits the buffer on Enter and echoes what was typed', () => {
    const { input, echoed } = machine()
    const events = type(input, 'hi', RETURN)
    expect(events.at(-1)).toEqual({ type: 'submit', text: 'hi' })
    expect(echoed()).toBe('hi\n')
    expect(input.text).toBe('')
  })
  it('ignores Enter on a blank buffer', () => {
    const { input } = machine()
    expect(type(input, '  ', RETURN).at(-1)).toBeUndefined()
  })
  it('keeps newlines inside a bracketed paste and submits once at the end', () => {
    const { input } = machine()
    input.keypress(undefined, PASTE_START)
    type(input, 'one', RETURN)
    type(input, 'two')
    input.keypress(undefined, PASTE_END)
    expect(input.text).toBe('one\ntwo')
    expect(input.keypress(undefined, RETURN)).toEqual({ type: 'submit', text: 'one\ntwo' })
  })
  it('continues a line that ends with a backslash', () => {
    const { input } = machine()
    expect(type(input, 'a\\', RETURN).at(-1)).toBeUndefined()
    expect(type(input, 'b', RETURN).at(-1)).toEqual({ type: 'submit', text: 'a\nb' })
  })
  it('deletes with backspace', () => {
    const { input, echoed } = machine()
    type(input, 'ab', { name: 'backspace' })
    expect(input.text).toBe('a')
    expect(echoed()).toBe('ab\b \b')
  })
  it('emits cancel on Esc and clears the buffer', () => {
    const { input } = machine()
    expect(type(input, 'half', ESC).at(-1)).toEqual({ type: 'cancel' })
    expect(input.text).toBe('')
  })
  it('does not treat Esc inside a paste as cancel', () => {
    const { input } = machine()
    input.keypress(undefined, PASTE_START)
    expect(input.keypress(undefined, ESC)).toBeUndefined()
  })
  it('clears and hints on one Ctrl-C, exits on a second within the window', () => {
    let clock = 1000
    const { input, echoed } = machine(() => clock)
    expect(type(input, 'abc', CTRL_C).at(-1)).toBeUndefined()
    expect(input.text).toBe('')
    expect(echoed()).toContain('Ctrl-C again')
    clock += 1400
    expect(input.keypress(undefined, CTRL_C)).toEqual({ type: 'exit' })
  })
  it('does not exit when the second Ctrl-C is late', () => {
    let clock = 1000
    const { input } = machine(() => clock)
    input.keypress(undefined, CTRL_C)
    clock += 1600
    expect(input.keypress(undefined, CTRL_C)).toBeUndefined()
  })
  it('exits on Ctrl-D only when the buffer is empty', () => {
    const { input } = machine()
    expect(type(input, 'x', CTRL_D).at(-1)).toBeUndefined()
    input.keypress(undefined, ESC)
    expect(input.keypress(undefined, CTRL_D)).toEqual({ type: 'exit' })
  })
  it('maps y and Esc in approval mode and ignores other keys', () => {
    const { input } = machine()
    input.setMode('approval')
    expect(input.keypress('n', { name: 'n', sequence: 'n' })).toBeUndefined()
    expect(input.keypress('y', { name: 'y', sequence: 'y' })).toEqual({ type: 'approve' })
    expect(input.keypress(undefined, ESC)).toEqual({ type: 'reject' })
    expect(input.keypress(undefined, CTRL_C)).toEqual({ type: 'reject' })
    expect(input.text).toBe('')
  })
})

describe('TerminalInput line mode', () => {
  it('submits each non-blank line', () => {
    const { input } = machine()
    expect(input.line('hello')).toEqual({ type: 'submit', text: 'hello' })
    expect(input.line('   ')).toBeUndefined()
  })
  it('ignores lines while an approval is pending', () => {
    const { input } = machine()
    input.setMode('approval')
    expect(input.line('y')).toBeUndefined()
  })
})
