/**
 * The REPL's keyboard state machine. It owns the line buffer, bracketed
 * paste, the Esc / Ctrl-C / Ctrl-D rules and the approval prompt. It is pure:
 * the runner feeds decoded keypresses (or whole lines when stdin is a pipe)
 * and acts on the events it returns; echo goes through the injected writer.
 * @module
 */

/** One decoded keypress as `readline.emitKeypressEvents` reports it. */
export interface Key {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  sequence?: string
}

/** What the runner must do next. */
export type InputEvent =
  | { type: 'submit'; text: string }
  | { type: 'cancel' }
  | { type: 'exit' }
  | { type: 'approve' }
  | { type: 'reject' }

/** `prompt` edits a line; `approval` waits for y or Esc. */
export type InputMode = 'prompt' | 'approval'

export interface InputOptions {
  /** Milliseconds within which a second Ctrl-C exits (default 1500). */
  exitWindowMs?: number
  /** Clock for the Ctrl-C window; tests inject a fake. */
  now?: () => number
}

/** Terminal echo the machine wants written; the runner forwards it to stdout. */
export interface Echo {
  write(text: string): void
}

const EXIT_HINT = '\n(press Ctrl-C again to exit)\n'

export class TerminalInput {
  private buffer = ''
  private pasting = false
  private mode: InputMode = 'prompt'
  private lastInterrupt: number | undefined
  private readonly exitWindowMs: number
  private readonly now: () => number

  constructor(private readonly echo: Echo, options: InputOptions = {}) {
    this.exitWindowMs = options.exitWindowMs ?? 1500
    this.now = options.now ?? Date.now
  }

  /** The line being edited. */
  get text(): string {
    return this.buffer
  }

  setMode(mode: InputMode): void {
    this.mode = mode
  }

  /** Pipe mode: one complete line is one prompt; blank lines and approval-time lines are ignored. */
  line(text: string): InputEvent | undefined {
    if (this.mode === 'approval') return undefined
    if (text.trim() === '') return undefined
    return { type: 'submit', text }
  }

  /** TTY mode: one decoded keypress. */
  keypress(str: string | undefined, key: Key): InputEvent | undefined {
    if (key.name === 'paste-start') {
      this.pasting = true
      return undefined
    }
    if (key.name === 'paste-end') {
      this.pasting = false
      return undefined
    }
    if (key.ctrl === true && key.name === 'c') return this.interrupt()
    if (this.mode === 'approval') return this.approvalKey(key)
    if (key.ctrl === true && key.name === 'd') {
      return this.buffer === '' ? { type: 'exit' } : undefined
    }
    if (key.name === 'escape' && !this.pasting) {
      this.clear()
      return { type: 'cancel' }
    }
    if (key.name === 'return' || key.name === 'enter') return this.newline()
    if (key.name === 'backspace') {
      if (this.buffer !== '') {
        this.buffer = this.buffer.slice(0, -1)
        this.echo.write('\b \b')
      }
      return undefined
    }
    if (str !== undefined && str !== '' && key.ctrl !== true && key.meta !== true) {
      this.buffer += str
      this.echo.write(str)
    }
    return undefined
  }

  private newline(): InputEvent | undefined {
    if (this.pasting) {
      this.buffer += '\n'
      this.echo.write('\n')
      return undefined
    }
    if (this.buffer.endsWith('\\')) {
      this.buffer = `${this.buffer.slice(0, -1)}\n`
      this.echo.write('\n')
      return undefined
    }
    this.echo.write('\n')
    const text = this.buffer
    this.buffer = ''
    if (text.trim() === '') return undefined
    return { type: 'submit', text }
  }

  private interrupt(): InputEvent | undefined {
    const at = this.now()
    if (this.mode === 'approval') {
      this.lastInterrupt = at
      return { type: 'reject' }
    }
    if (this.lastInterrupt !== undefined && at - this.lastInterrupt <= this.exitWindowMs) {
      return { type: 'exit' }
    }
    this.lastInterrupt = at
    this.clear()
    this.echo.write(EXIT_HINT)
    return undefined
  }

  private approvalKey(key: Key): InputEvent | undefined {
    if (key.name === 'escape') return { type: 'reject' }
    if (key.sequence === 'y' || key.name === 'y') return { type: 'approve' }
    return undefined
  }

  private clear(): void {
    this.buffer = ''
    this.pasting = false
  }
}
