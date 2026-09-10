# dsh-neutered step 9: the interactive REPL profile

Design record from the 2026-09-05 grill. Fifteen decisions, one artifact, one
new profile. Everything below is settled; the implementation plan that follows
it turns each section into dsh prompts.

## Why

The neutered build deleted the web UI that Marco used to drive dsh with a
long prompt he keeps off disk. Headless is one-shot: no multi-turn, no live
tool trace, no approvals. The REPL replaces the web UI for daily driving.
It is not an engagement deliverable and not a debugging toy: it is the way
the sole operator talks to the local model.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Shape | Plain terminal REPL. No panes, no mouse, no TUI library. |
| 2 | Purpose | Daily driving in place of the deleted web UI. |
| 3 | Location | New bundle `packages/bundle/repl` (`@deepseek-ai/dsh-repl`), new shipped profile `repl`. Headless untouched. |
| 4 | Per-turn output | Stream `text-delta` live to stdout; one line per `tool/call` and one per `tool/result`; provider reasoning to stderr as headless does. |
| 5 | Input | Bracketed paste (`ESC[?2004h`): newlines inside a paste insert, Enter outside submits, trailing `\` continues a line. |
| 6 | Interrupt | Esc cancels the running turn (`agent.cancel({kind:'user'},{keepInbox:true})`). Enter during a turn queues the message (`agent.followup`). Ctrl-C once clears the input line and prints a hint; Ctrl-C twice within 1.5 s exits. Ctrl-D at an empty prompt exits. |
| 7 | Approvals | Terminal answerer on `approval/request`: print the request, `y` approves, Esc rejects. Not a TTY: no answerer, fail closed as headless. |
| 8 | Sessions | Fresh session by default, id printed on start. `--resume` = most recent, `--resume <id>` = that one. `--sessions` prints the last 10 and exits. |
| 9 | Slash commands | None. Reasoning display toggled by `DSH_REPL_REASONING=0`. |
| 10 | Invocation | Wrapper: no task and stdin is a TTY = REPL; a task after `--` = headless (unchanged). |
| 11 | Piped stdin | No task and stdin not a TTY = whole stdin becomes one headless task (`pbpaste \| dsh-neutered`). |
| 12 | Base branch | Step 8 (`worktree-llama-sidecar`) fast-forwarded into `neutered` first; work on `worktree-repl` off that tip. |
| 13 | Verification | Vitest unit tests on the input layer with a fake stdin; one recorded snapshot over the mock model server; static gate 0/0; capture gate extended to drive the REPL through a pty; build 0. |
| 14 | Who builds | dsh-neutered writes everything, new files included. Claude writes prompts, diagnoses, verifies, commits. |
| 15 | Stall policy | Every new file is born as a scaffold under 40 lines, then grown by exact old→new prompts of at most 6 edits. Kill at 15 min, split the prompt, retry. |

Web UI semantics were read from the tag tree, not remembered:
`packages/api/session-controller/src/commands.ts` at `dsh-v0.1.2-alpha.4`
called `agent.followup(message)` for a prompt sent during a running turn and
`agent.cancel({ kind: 'user' }, { keepInbox: true })` for the stop button.

## Architecture

```
neutered/bin/dsh-neutered ──(task)──────────▶ dsh --profile headless --patch offline.patch.yml -- <task>
                          ──(no task, TTY)──▶ dsh --profile repl     --patch offline.patch.yml [-- --resume [id] | --sessions]
                          ──(no task, pipe)─▶ task="$(cat)"; headless as above
```

The `repl` profile template is `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-repl']`
in `packages/boot/app-boot/src/profile.ts`, beside `headless`. The bundle patch
mirrors `packages/bundle/headless/cordis.patch.yml`: same `system-prompt`
persona, same `tools` mode, same `code-runtime`, then `repl-startup` and
`repl-runner`.

### Bundle layout (`packages/bundle/repl`)

| File | Role |
|------|------|
| `package.json` | Copy of headless's manifest with name `@deepseek-ai/dsh-repl`, exports `.` and `./startup`, `dsh.bundle.patch`. |
| `cordis.patch.yml` | The bundle patch described above. |
| `src/startup.ts` | Commander parser over `cmdlineArgs`: `--resume [id]`, `--sessions`, `--help`. Provides `replStartup` = `{ resume?: string \| true, listSessions: boolean }`. |
| `src/index.ts` | `repl-runner` plugin: awaits the loader, creates or resumes the Agent, wires render + input + approval, runs the turn loop, exits. |
| `src/render.ts` | Pure functions from session events to output lines: text deltas, `> name: summary`, `< ok \| error code`, reasoning gate. |
| `src/input.ts` | Terminal input state machine over `readline.emitKeypressEvents`: bracketed paste, `\` continuation, Esc, Ctrl-C twice, Ctrl-D, approval mode (`y`/Esc). Takes an injectable `Tty` interface so tests feed keypresses. |
| `src/approval.ts` | `approval/request` waterfall answerer: prints request, asks `input.ts` for `y`/Esc, resolves `'approved' \| 'rejected'`; returns `next()` when stdin is not a TTY. |
| `tests/input.spec.ts` | Fake-stdin keypress tests: paste with newlines submits once; Enter submits; `\` continues; Esc emits cancel; Ctrl-C once clears + hint, twice within 1.5 s exits, twice 2 s apart does not; Ctrl-D on empty exits; approval mode maps `y`/Esc. |
| `tests/render.spec.ts` | Event-to-line tests: tool call line, ok result, error result, text delta passthrough, reasoning suppressed when disabled. |

### Turn loop

```
await ctx.get('loader')?.await()
agent = resume ? agents.resume({ resumeSessionId }) : agents.create({ sessionId, meta:{cwd}, agentOptions, setup })
print "session <id>" (+ "resumed" when applicable)
subscribe render to 'session/event' for agent.session
register approval answerer scoped to agent
loop:
  line = await input.readPrompt()          # resolves on submit, 'exit', or EOF
  if exit/EOF: break
  if agent.status === 'running': agent.followup(msg); print "queued (n)"; continue
  agent.followup(msg); await agent.whenIdle()
  print turn/end error when reason.kind === 'error'
on Esc while running: agent.cancel({kind:'user'},{keepInbox:true})
finally: await sessions.flush(agent.session); appExit(0)
```

Cancellation semantics, from `runtime-types.ts`: `cancel` aborts the active turn;
with `keepInbox` queued work survives for the next turn. Input queued during a
turn goes to `followup` (next-turn inbox), never `steer`.

### Input state machine

States: `idle`, `paste`, `approval`. Keys handled in raw mode
(`stdin.setRawMode(true)` only when `stdin.isTTY`):

| Key | idle | paste | approval |
|-----|------|-------|----------|
| printable | append | append | ignore |
| Enter (`\r`) | line ends with `\` → strip, newline, continue; else submit | append newline | ignore |
| `ESC[200~` / `ESC[201~` | enter paste | leave paste | ignore |
| Esc alone | cancel-turn event (or clear buffer when idle and not running) | n/a | reject |
| `y` | append | append | approve |
| Ctrl-C | clear buffer; hint; second within 1.5 s → exit | same | reject |
| Ctrl-D | buffer empty → exit; else ignore | ignore | ignore |

Not a TTY (snapshot lane, pipes): no raw mode, no bracketed paste; each line
is a prompt, EOF exits, approvals fail closed. This is what lets the recorded
snapshot drive the REPL through a pipe.

### Wrapper changes (`neutered/bin/dsh-neutered`)

- New flags `--resume [id]` and `--sessions`, forwarded to the repl app after `--`.
  Either flag with a task text is an error (exit 2).
- Mode selection replaces the fixed `--profile headless`:
  task present → headless; no task and `[ -t 0 ]` → repl; no task and not a TTY →
  `task="$(cat)"`, empty task → usage exit 2, else headless.
- `--dry-run` prints the chosen profile.
- Usage text loses "(headless only)" and documents the three entry paths.

## Verification

| Check | Command | Expect |
|-------|---------|--------|
| Build | `pnpm run build` | exit 0 |
| Unit | `pnpm exec vitest run packages/bundle/repl` | all green |
| Snapshot | `DSH_SNAPSHOT=record pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/session/repl.snapshot.ts` once against the mock server, then replay | 2 turns recorded, replay green |
| Static gate | `bash neutered/gate/egress-grep.sh` | 0 destination hits, 0 primitive hits (readline and tty are not network primitives) |
| Wrapper test | `bash neutered/bin/test/dsh-neutered.test.sh` | mode selection cases added: task → headless, TTY → repl, pipe → headless with stdin task, `--resume` with task → exit 2 |
| Capture gate | `bash neutered/gate/egress-capture.sh --repl` | drives the wrapper under `/usr/bin/expect`: waits for the prompt, sends the PONG task, waits for PONG, sends Ctrl-C twice; peer set is exactly 127.0.0.1:1234 |
| Smoke | `neutered/bin/dsh-neutered` in a terminal against LM Studio | prompt, PONG, Esc cancel, queue, exit |

## Out of scope

Slash commands, session picker, `$EDITOR`, steering, TUI panes, Windows.
The first-run setup spec on `worktree-neutered-setup` has its own TTY prompt
library (`neutered/setup/lib/prompt.cjs`); the REPL does not depend on it.
