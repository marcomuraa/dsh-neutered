/**
 * @deepseek-ai/dsh-repl/startup — the REPL app's command-line provider. It
 * parses the app arguments the launcher forwards (`dsh --profile repl
 * [--resume [id]] [--sessions]`) and publishes them as the `replStartup`
 * service the runner row reads.
 * @module @deepseek-ai/dsh-repl/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'repl-startup'

/** The launcher-provided argument vector. */
export const inject = ['cmdlineArgs']

/** Service name the bundle patch reads through `ctx.replStartup`. */
export const REPL_STARTUP_SERVICE = 'replStartup'

/** What the operator asked for on the command line. */
export interface ReplStartupValues {
  /** `true` resumes the most recent session, a string resumes that id, absent starts fresh. */
  resume?: string | true
  /** Print the ten most recent sessions and exit. */
  listSessions: boolean
}

function replCommand(): Command {
  return new Command()
    .name('dsh --profile repl')
    .description('Talk to the agent turn by turn in the terminal: Esc cancels a turn, Ctrl-C twice exits.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume [id]', 'continue a persisted session: the most recent one, or the given id')
    .option('--sessions', 'list the ten most recent sessions and exit')
    .addHelpText('after', `
Examples:
  dsh --profile repl                 start a fresh session
  dsh --profile repl --resume        continue the most recent session
  dsh --profile repl --sessions      list sessions
`)
}

/**
 * Parse the app arguments and publish the startup values.
 * @param ctx - plugin context carrying the launcher's `cmdlineArgs` and `appExit`.
 */
export function apply(ctx: Context): void {
  const program = replCommand()
  program.action(() => {
    // Commander itself rejects task text: the command declares no positional argument.
    const options = program.opts<{ resume?: string | true; sessions?: boolean }>()
    const values: ReplStartupValues = { listSessions: options.sessions === true }
    if (options.resume !== undefined) values.resume = options.resume
    ctx.provide(REPL_STARTUP_SERVICE, values)
  })
  parseCmdline(ctx, program)
}
