# dsh-neutered egress capture — 20260905T005741Z (repl)

- host: macOS 26.5.1
- dsh: 0.1.2-alpha.4
- mode: normal session
- model server: external on 127.0.0.1:1234
- task: Reply with exactly the word PONG and nothing else.
- capture method: lsof (process-tree poll every 0.25s)
- wall: 9s, session exit: 0

## Distinct network peers
```
127.0.0.1:1234
```
## Listeners
```
<none>
```
## Connections accepted by the model server on 127.0.0.1:1234
```
<none>
```
## Session stdout (first 40 lines)
```
spawn /Users/m/Documents/dsh_neutered/dsh-neutered/.claude/worktrees/repl/neutered/bin/dsh-neutered --dsh node /Users/m/Documents/dsh_neutered/dsh-neutered/.claude/worktrees/repl/apps/cli/lib/bin.js
session session-b6f62f98-0529-46f8-9ee1-6f2fae61742e
[?2004hdsh> Reply with exactly the word PONG and nothing else.
dsh: reasoning:
The user is asking me to respond with exactly the word "PONG" and nothing else. This is a simple instruction, and no tools are needed. The system reminder about AGENTS.md is contextual information, but the direct user instruction takes precedence.

dsh: reasoning:
Wait, but there's something to be careful about here. The user is saying "respond with exactly the word PONG and nothing else." This is a direct instruction. I should respond with exactly "PONG".

dsh: reasoning:
No tools needed. Just reply "PONG".


PONG
dsh>
(press Ctrl-C again to exit)
[?2004l
```
## Verdict
PASS — only loopback peers; session answered PONG

## Limitations
lsof polling at 0.25s can miss a connection shorter than the interval; a stronger proof
is tcpdump with BPF access (/dev/bpf* readable) or pf logging. Non-loopback DNS would show
as a UDP peer to the resolver; none is expected because the guard blocks DNS and the model
is reached by IP.
