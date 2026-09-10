import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it } from 'vitest'
import { describeRequest, installApprovalAnswerer } from '../src/approval.ts'

const mine = { id: 'mine' } as unknown as Agent
const other = { id: 'other' } as unknown as Agent

function request(agent: Agent, reason?: string): ApprovalRequest {
  return { agent, toolName: 'bash', ...(reason === undefined ? {} : { reason }) }
}

describe('describeRequest', () => {
  it('names the tool and the reason', () => {
    expect(describeRequest({ toolName: 'bash', reason: 'writes outside the workspace' })).toBe('approve bash: writes outside the workspace? [y/Esc] ')
    expect(describeRequest({ toolName: 'fs_write' })).toBe('approve fs_write? [y/Esc] ')
  })
})

describe('installApprovalAnswerer', () => {
  it('answers requests of its own agent and passes the rest on', async () => {
    const ctx = new Context()
    const asked: string[] = []
    const dispose = installApprovalAnswerer(ctx, mine, {
      ask: (question) => { asked.push(question); return Promise.resolve('allowed-once') },
    })
    const fallback = (): Promise<ApprovalOutcome> => Promise.resolve('unavailable')
    expect(await ctx.waterfall('approval/request', request(mine, 'why'), fallback)).toBe('allowed-once')
    expect(await ctx.waterfall('approval/request', request(other), fallback)).toBe('unavailable')
    expect(asked).toEqual(['approve bash: why? [y/Esc] '])
    dispose()
    expect(await ctx.waterfall('approval/request', request(mine), fallback)).toBe('unavailable')
    await ctx.fiber.dispose()
  })
})
