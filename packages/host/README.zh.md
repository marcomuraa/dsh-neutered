---
description: "Host 组的包映射：当前 Loader 条目的只读插件清单投影。"
kind: "package-group"
---

# host/ — Host 组

[English](README.md) | 中文

## 概述

`host/` 组提供当前 Loader 条目的只读插件清单投影。该组唯一的包是产品包；其 README 拥有约定与配置。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

一个包承担 Host 角色；其 README 拥有约定与配置。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`plugin-inventory/`](plugin-inventory/README.zh.md) | 当前 Loader 条目的只读投影 | Remote `pluginInventory/list` |

-----

<a id="related-documentation"></a>
## 相关文档

参见工作区记录的子系统参考。

- [工作区子系统](../../docs/subsystems/workspace.zh.md)——工作区记录。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
