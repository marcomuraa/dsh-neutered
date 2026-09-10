---
description: "Package map for the host group: the read-only plugin inventory projection of current Loader entries."
kind: "package-group"
---

# host/ — host group

English | [中文](README.zh.md)

## Summary

The `host/` group provides the read-only plugin inventory projection of current Loader entries. Its single package is a product package; its README owns the contract and configuration.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

One package plays the host role; its README owns its contract and configuration.

| Package | Role | ctx key |
|---|---|---|
| [`plugin-inventory/`](plugin-inventory/README.md) | Read-only projection of current Loader entries | Remote `pluginInventory/list` |

-----

<a id="related-documentation"></a>
## Related documentation

See the subsystem reference for the workspace records.

- [Workspace subsystem](../../docs/subsystems/workspace.md) — the workspace records.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
