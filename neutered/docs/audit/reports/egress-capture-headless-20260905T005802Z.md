# dsh-neutered egress capture — 20260905T005802Z (headless)

- host: macOS 26.5.1
- dsh: 0.1.2-alpha.4
- mode: normal session
- model server: external on 127.0.0.1:1234
- task: Reply with exactly the word PONG and nothing else.
- capture method: lsof (process-tree poll every 0.25s)
- wall: 14s, session exit: 0

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


PONG
```
## Verdict
PASS — only loopback peers; session answered PONG

## Limitations
lsof polling at 0.25s can miss a connection shorter than the interval; a stronger proof
is tcpdump with BPF access (/dev/bpf* readable) or pf logging. Non-loopback DNS would show
as a UDP peer to the resolver; none is expected because the guard blocks DNS and the model
is reached by IP.
