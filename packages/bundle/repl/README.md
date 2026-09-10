---
description: "Interactive terminal mode for dsh: one long-lived session driven turn by turn from stdin, for an operator talking to a local model."
kind: "package-bundle"
---

# @deepseek-ai/dsh-repl

## Summary

`dsh-repl` opens one agent session in the terminal and keeps it for the whole
process. Type a prompt and press Enter; the assistant text streams as it
arrives, every tool call and result takes one line, and provider reasoning
goes to stderr. Press Esc to cancel the running turn (queued prompts survive),
type during a turn to queue the next prompt, press Ctrl-C twice within 1.5 s
or Ctrl-D at an empty prompt to exit. Pasted text keeps its newlines
(bracketed paste); a trailing `\` continues a line by hand.

`dsh --profile repl` starts a fresh session and prints its id. `--resume`
continues the most recent persisted session, `--resume <id>` a given one,
`--sessions` lists the ten most recent and exits. When a tool asks for
approval, `y` allows it once and Esc rejects it. When stdin is not a
terminal, each line is one prompt, EOF exits, and approvals fail closed.

There are no slash commands. `DSH_REPL_REASONING=0` hides reasoning.

## Implementation

`src/startup.ts` parses the app arguments the launcher forwards and publishes
`replStartup`. `src/input.ts` is the keyboard state machine (pure), `src/render.ts`
turns session events into output lines (pure), `src/approval.ts` answers
`approval/request` for the REPL's agent, and `src/index.ts` creates or resumes
the Agent, wires the three together and owns the turn loop and exit.
