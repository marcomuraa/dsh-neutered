# dsh-neutered egress capture — 20260905T013355Z (repl)

- host: macOS 26.5.1
- dsh: 0.1.2-alpha.4
- mode: normal session
- model server: external on 127.0.0.1:1234
- task: Reply with exactly the word PONG and nothing else.
- capture method: lsof (process-tree poll every 0.25s)
- wall: 5s, session exit: 0

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
session session-5fa547e0-a374-4144-9a57-1a1e90231d02
[?2004hdsh> Reply with exactly the word PONG and nothing else.
dsh: reasoning:
The user is asking me to reply with exactly the word PONG and nothing else. This is a direct instruction. The system reminder is just contextual information, and the user's request takes priority. I should reply with "PONG" and nothing else.


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
