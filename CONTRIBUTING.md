# Contributing to dsh-neutered

English | [中文](CONTRIBUTING.zh.md)

Use this fork's GitHub issues and pull requests for changes to dsh-neutered. Include reproduction steps, macOS and Node versions, and the local server and model when relevant. Remove credentials, private prompts, and local file contents from logs before sharing them.

## Development

Start with the [installation guide](README.md#quick-start). The fork's launcher, setup, network guard, and tests live under [neutered/](neutered/README.md). Shared source lives under [packages/](packages/README.md).

Run `pnpm run build` and `pnpm run test:neutered` from the repository root. The fork tests use fixtures and local stub servers, so they need neither a downloaded model nor provider credentials. Run additional focused tests for any shared packages you change.

## Network behavior

Task runs use a local model endpoint. Setup downloads dependencies and model assets. Preserve that distinction when changing the launcher or adding integrations, and document the limits of each protection in the [network guard reference](neutered/guard/README.md).
