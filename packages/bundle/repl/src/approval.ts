/**
 * The REPL's approval answerer: when the agent asks permission for a tool
 * action, print the request and take the operator's answer, y or Esc. The
 * runner installs it only when stdin is a terminal, so a piped session keeps
 * the fail-closed default of the approval service.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

/** How the runner asks the operator one question and gets y (allow once) or Esc (reject). */
export interface ApprovalPrompter {
  ask(question: string, signal?: AbortSignal): Promise<'allowed-once' | 'rejected'>
}

/** One line naming the tool and, when given, why it asks. */
export function describeRequest(req: Pick<ApprovalRequest, 'toolName' | 'reason'>): string {
  const reason = req.reason === undefined || req.reason.trim() === '' ? '' : `: ${req.reason.trim()}`
  return `approve ${req.toolName}${reason}? [y/Esc] `
}

/**
 * Register the answerer for exactly one agent; other agents' requests pass to
 * the next answerer and fail closed when there is none.
 * @param ctx - plugin context that sees the approval waterfall.
 * @param agent - the REPL's agent.
 * @param prompter - the terminal question.
 * @returns a disposer that unregisters the answerer.
 */
export function installApprovalAnswerer(ctx: Context, agent: Agent, prompter: ApprovalPrompter): () => void {
  const dispose = ctx.on('approval/request', (req, next): Promise<ApprovalOutcome> => {
    if (req.agent !== agent) return next()
    return prompter.ask(describeRequest(req), req.signal)
  })
  return () => { dispose() }
}
