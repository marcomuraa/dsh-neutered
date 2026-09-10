---
description: "Workspace-instruction context for users and maintainers enabling, sizing, or debugging DSH_INSTRUCTIONS.md loading and refresh."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-instructions

English | [中文](README.zh.md)

## Summary

`dsh-agent-instructions` loads workspace instruction files named `DSH_INSTRUCTIONS.md` into model context: the project chain reaches the first request as one durable baseline, and successful `read`, `write`, or `edit` calls bring newly relevant nested files, changes, and removals into later requests. `dsh-base` includes it by default, and a profile patch can disable it. Everything is bounded by a byte budget: broader files are omitted before the most specific file is truncated, and an empty chain contributes nothing. There is no file watcher — external edits become visible on the next successful filesystem touch or when a resumed session reconciles its baseline.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when agents should work from the workspace's own instruction files. `dsh-base` already includes it with a 65,536-byte budget, so base-backed profiles only need to replace the row when they want another `maxBytes`; providerless trees load nothing until a filesystem provider is present.

### What the agent gets

The first request includes one durable baseline message with the project chain, that is every `DSH_INSTRUCTIONS.md` from the project root down to the session working directory, broadest first. No other file name is read. `AGENTS.md`, `CLAUDE.md`, `.local` overlays and files under `$DSH_HOME` are ordinary project data to this plugin. After a successful `read`, `write`, or `edit` call reaches a deeper directory, the next request includes the newly applicable instruction file; a changed file replaces its content, and a file that disappears produces a removal notice.

### Configuration

The default root marker is `.git`. The file name is fixed at `DSH_INSTRUCTIONS.md` and cannot be configured. Only `maxBytes` is required. It caps the complete rendered baseline, so each deployment chooses its prompt budget explicitly.

```yaml
- name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536
```

The accepted fields, at a glance:

```ts
export interface Config {
  projectRootMarkers?: string[]
  maxBytes: number
  maxSourceBytes?: number
}
```

| Field | Default | Meaning |
|---|---|---|
| `maxBytes` | required | Cap on the complete rendered baseline message, in bytes |
| `maxSourceBytes` | `1048576` | Cap on one source instruction file before rendering |
| `projectRootMarkers` | `['.git']` | Directory names that mark the project root |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-agent-instructions) is the exhaustive source for every accepted field and its JSDoc.

### Observing the budget

Rendering keeps the most specific files first: it drops whole broader files before truncating the most-specific file, and emits a visible `Workspace instruction budget ...` notice naming the omitted and truncated paths. The rendered bytes never exceed `maxBytes`. An over-budget broad file is ignored; during refresh it is treated as temporarily unavailable rather than removed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the plugin; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The plugin is built on one principle: workspace instructions are durable conversation content, owned per agent and per session. Baseline and refresh messages are ordinary sourced `user/message` events, so they replay, compact, and resume exactly like other history, and model-visible state is always reconstructable from the session log. The plugin owns the complete `<system-reminder>` framing and every injected message reaches the model verbatim.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: pre-step listener, `tools/result` touch tracking, inbox composition |
| [`src/config.ts`](src/config.ts) | `Config` schema, budget resolution, baseline identity |
| [`src/files.ts`](src/files.ts) | Candidate discovery, project-root search, bounded streaming reads |
| [`src/render.ts`](src/render.ts) | Instruction rendering, budget truncation, change records |
| [`src/state.ts`](src/state.ts) | Durable message sources, version/digest cache, reconciliation |
| [`src/digest.ts`](src/digest.ts) | SHA-1 content identity and per-directory duplicate keys |
| — | No runtime invariant companion is published; replay intentionally tolerates unknown or malformed workspace sources, while focused pipeline tests own its private pending/cache state transitions. |

### Main flow

At the first eligible `agent/pre-step` of a session, the plugin composes the baseline and folds it into the entering batch right after the claimed messages. Successful first-party `read`, `write`, and `edit` calls contribute touches that bubble up through parent execution tokens; once the enclosing step is durable, a projection reconciles the visible session state against the inbox and queues additions, replacements, or removals. An unchanged path with an unchanged digest is never injected again. Discovery follows structured filesystem activity rather than shell navigation, because each local shell call starts a fresh process and parsing arbitrary shell syntax is not a reliable filesystem seam.

### Invariants

Every injected message carries a typed source with its change list; a complete baseline also carries an identity derived from normalized discovery, precedence, project-root, and budget configuration, and a matching durable message confirms a queued baseline. Model-visible text contains no hidden state markers, and literal `</system-reminder>` text anywhere in instruction content or model-visible metadata is escaped so repository-controlled text cannot close the plugin-owned frame.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the instruction-file format to the design decision and the exhaustive configuration.

- [Documentation standard](../../../docs/AGENTS.md) describes this repository's own `AGENTS.md` maintainer notes. The runtime reads none of them; it reads `DSH_INSTRUCTIONS.md` only.
- [Workspace-context decision record](../../../.agents/notes/implemented/feature/2026-06-24-workspace-context.md) — per-agent/session isolation and lifecycle rationale.
- [Context group map](../README.md) — sibling request-context packages.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-agent-instructions) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a> <a id="prompt-shape"></a>
## Model Experience

### Baseline context

#### What the model sees

At the first request, derived history contains one durable user-role message with the bounded project instruction chain in broad-to-specific order. Resume reuses that message when its visible baseline is compatible.

##### Baseline instruction template

```markdown
<system-reminder>
The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.

Instructions from: DSH_INSTRUCTIONS.md

<project-instructions>

Instructions from: packages/app/DSH_INSTRUCTIONS.md

<nested-project-instructions>
</system-reminder>
```

#### Token effect

The rendered baseline is appended once and remains in derived history until compaction. `maxBytes` bounds the complete message, broader files are omitted before the most-specific file is truncated, and an empty chain contributes zero tokens.

#### KV Cache effect

Append-only after the existing reusable prefix. Resume preserves reuse when the visible baseline identity is compatible; an incompatible identity appends a complete replacement, so discovery, precedence, project-root, or budget changes affect reuse only from that history position.

### Newly discovered scope context

#### What the model sees

After a successful first-party filesystem call reaches a deeper directory, the next request includes one retained sourced `user/message` with the newly applicable instruction file.

##### Additional instruction template

```markdown
<system-reminder>
Additional instructions from: packages/app/DSH_INSTRUCTIONS.md

These instructions apply to work under `packages/app`. Use them as guidance when relevant; more specific instructions take precedence. They do not override system, developer, or direct user instructions.

<nested-instructions>
</system-reminder>
```

#### Token effect

Each discovered scope adds bounded history tokens until compaction. Unchanged content is suppressed by visible session state plus version/digest comparison, and PTC mode defers the same message until after the outer `run_code` result and its enclosing durable step.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Changed or removed instruction context

#### What the model sees

A changed file produces `Updated instructions from: <path>` plus its replacement content. A file that disappears produces the removal notice below.

##### Removal notice

```markdown
<system-reminder>
Instructions removed: packages/app/DSH_INSTRUCTIONS.md

The previously loaded instructions from this file no longer apply.
</system-reminder>
```

#### Token effect

Each confirmed change or removal is one retained history message bounded by `maxBytes`. Provider failures add no message, and an update omitted by the budget remains eligible for a later filesystem touch.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when instruction loading is a poor fit or needs operational awareness. They are current package constraints, not a task backlog.

- **Discovery follows structured fs tools, not shell navigation** — a `bash` command that changes directories does not trigger nested instruction discovery because shell syntax and per-call shell state are not a reliable filesystem seam.
- **Refresh is touch-driven** — there is no watcher; external edits become visible on the next successful first-party `read`, `write`, or `edit`, when resume reconciles a visible baseline, or when an entering pre-step restores a shadowed baseline.
- **One file name.** Only `DSH_INSTRUCTIONS.md` is read, and the name cannot be configured. `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.local` overlays, `.claude/rules/` and `@path` imports are not interpreted, and nothing under `$DSH_HOME` loads as instructions. A repository that keeps its guidance under another name exposes it through a `DSH_INSTRUCTIONS.md` symlink. The probe is a `stat()`, so on a case-insensitive filesystem `dsh_instructions.md` loads too.
- **Symlinked instruction files are followed across the trust boundary** — a candidate whose final component is a symlink is resolved and its target loaded, so a cloned repository can surface off-tree file content as lower-authority workspace guidance (it never overrides system, developer, or direct user instructions). Confine `ctx.fs` with the filesystem policy gate or an OS sandbox when loading untrusted repositories.
- **Instruction content is bounded, not summarized** — over-budget broad files are omitted and the most-specific file may be truncated; the plugin never asks a model to compress instruction prose.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
