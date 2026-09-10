# Repository maintenance

This reference covers the files needed to develop and publish the offline fork. Start with the [root README](../../README.md) for installation and [the fork reference](../README.md) for runtime behavior.

## Source and generated files

Keep workspace manifests, the lockfile, source, tests, vendored source, and licence notices in Git. Package `lib/` directories and `*.tsbuildinfo` files are generated. The handwritten modules in [setup/lib/](../setup/lib/) are source and have a local ignore-rule exception.

Git ignores dependency stores, local worktrees, model-server binaries, environment files, Python caches, and generated capture reports. Environment templates named `.env.example` or `.env.template` may be committed. Model weights and runtime configuration belong under the configured DSH home, outside the checkout by default.

Use `pnpm run clean` to remove repository build outputs when needed, then `pnpm run build` to rebuild. The cleaner retains live package dependencies and refuses unknown files in orphan package directories.

## Audit records

The [network inventory](../INVENTORY.md) and [progress log](../PROGRESS.md) contain the fork's implementation history. Their paths and observations can describe earlier code. Raw inventory scans live under [audit/.raw/](audit/.raw/), and saved September 2026 capture reports live under [audit/reports/](audit/reports/).

New capture reports go to the ignored [gate/reports/](../gate/reports/) directory. A maintainer may copy a reviewed report into the audit documentation when retaining its evidence is useful.

## GitHub checks

[CI](../../.github/workflows/ci.yml) installs the locked dependencies, builds the CLI, and runs `pnpm run test:neutered` on macOS with Node 24. That command checks setup, the launcher, the guard, static egress detection, the local adapter, the REPL, and workflow references. It uses fixtures and local stub servers, without downloading models.

These checks do not prove real-model quality or complete network isolation. Run the [capture procedure](../gate/README.md) with a local model when a change needs that evidence. Broader inherited documentation and package checks remain available through [package.json](../../package.json); they can still refer to components absent from this fork.

CI has read-only repository permissions and no publishing job. Repository creation, the destination remote, and publication are separate actions.

## Repository guidance

The published repository excludes contributor-agent instruction files, contributor skills, and the `.agents` design-note tree. Application prompts, bundled skills, and instruction fixtures remain part of the software. Local ignored worktrees are not uploaded. Inherited documentation can refer to removed components and decision records; the root README and `neutered/` references describe this fork.
