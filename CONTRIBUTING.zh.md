# 为 dsh-neutered 做贡献

[English](CONTRIBUTING.md) | 中文

请在本分支仓库的 GitHub Issue 和 Pull Request 中提交 dsh-neutered 的问题与修改。请提供复现步骤、macOS 和 Node 版本，以及相关的本地服务器和模型信息。分享日志前，请移除凭据、私人提示词和本地文件内容。

## 开发

请先阅读[安装指南](README.md#quick-start)。本分支的启动器、设置程序、网络防护和测试位于 [neutered/](neutered/README.md)。共享源码位于 [packages/](packages/README.zh.md)。

在仓库根目录运行 `pnpm run build` 和 `pnpm run test:neutered`。本分支的测试使用测试数据和本地模拟服务器，不需要下载模型或提供服务商凭据。修改共享包时，请额外运行相关的定向测试。

## 网络行为

任务运行使用本地模型端点。设置程序下载依赖和模型资源。修改启动器或添加集成时，请保留这一区分，并在[网络防护参考文档](neutered/guard/README.md)中说明各项防护的限制。
