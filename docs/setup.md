# 配置说明

## Linux、macOS 和 Windows 便携版

Linux 用户按 `uname -m` 选择 x64 或 ARM64 附件。以下是 x64 的安装示例：

```sh
unzip Labradorite-linux-x64.zip
cd Labradorite
./labradorite setup
```

macOS 用户可在苹果菜单的“关于本机”里确认机型。Apple 芯片选择 `Labradorite-macos-arm64.zip`，Intel 处理器选择 `Labradorite-macos-x64.zip`。双击 ZIP 解压后，在终端进入 `Labradorite` 目录，运行 `./labradorite setup`。

在便携版目录中，将下文命令里的 `vpr` 或 `vp run` 换成 `./labradorite`。在 SSH 服务器上，连接 MCP 后运行 `./labradorite viewer:url` 即可获取端口转发命令。

Windows 用户完整解压 Release 附件后双击 `labradorite.cmd`。也可以在解压目录打开 PowerShell，将文档命令中的 `vpr` 或 `vp run` 换成 `.\labradorite.cmd`，例如：

```powershell
.\labradorite.cmd setup "D:\LabradoriteData" --embedding lexical
.\labradorite.cmd viewer:url
```

`mcp.json` 会指向解压目录中的 Node.js 运行程序 和服务文件。升级时，先关闭使用该包的 MCP 服务和查看器，将新版解压到固定位置，用原数据目录重新运行 setup。如果解压位置改变，将新生成的 `Labradorite` 条目复制回 MCP 客户端。记忆库存放在数据目录，建议与程序目录分开。

## 手动配置 embedding

手动填写现有服务后 setup 会向填写的接口发送一条测试短句，自动获取向量维度。
例如，使用默认端口的 Ollama 时填写 `http://127.0.0.1:11434/v1/embeddings` 和实际模型名。

## 非交互式 setup

在 setup 命令后加上数据目录的路径即可指定存储位置。请选择同步盘之外的本机持久目录。已有配置再次运行 setup 时会沿用原选择。更换后端或自动部署时，可用参数指定检索方式。非交互首次运行省略模式时使用全文检索。

```sh
# 内置 llama.cpp，自动下载推荐的 Qwen 模型
vpr setup "/path/to/data" --embedding local

# 内置 llama.cpp，使用自己的 GGUF 模型
vpr setup "/path/to/data" --embedding local --model "/path/to/embedding.gguf"

# 连接已有的 llama.cpp / Ollama / 其他兼容接口（此处以 Ollama 为例）
vpr setup "/path/to/data" --embedding external --endpoint "http://127.0.0.1:11434/v1/embeddings" --model "qwen3-embedding:0.6b"

# 不使用 embedding
vpr setup "/path/to/data" --embedding lexical
```

外部接口需要认证时，加上 `--api-key-env MEMORY_EMBEDDING_API_KEY`，并为 setup 和 MCP 进程设置该环境变量。更换后端后重新加载 MCP 客户端。若客户端使用其他配置格式，照填 `mcp.json` 中的 `command` 和 `args`。

## 旧数据目录迁移

默认数据目录现在名为 `labradorite`。使用旧默认目录 `fish-memory-test` 的用户，先停止 MCP 服务和查看器，再运行 `vpr setup`。setup 会将整个旧目录改名，更新配置中指向目录内的数据库和 GGUF 文件路径，并重新生成 `mcp.json`。目录外的文件路径保持不变，自选数据目录不会自动改名。

迁移完成后，用新生成的 `Labradorite` 条目替换客户端中的旧 MCP 配置，再重新加载客户端。新旧目录同时存在时，setup 会停止并提示处理，不会合并或覆盖数据。迁移中途退出后，可以重新运行 setup 继续完成。

安装完成后，可在[运行时设置](settings.md)中查看记忆库配置、空闲索引时长和每日请求预算。
