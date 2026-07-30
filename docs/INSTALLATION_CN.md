# 一键安装与环境方案

[English](INSTALLATION.md) | 简体中文

本文是安装器行为的统一说明。首次安装、升级和中断续跑都从这里开始；Hub 配置见[配置参考](CONFIGURATION_CN.md)，部署后的启动与排错见[运维指南](OPERATIONS_CN.md)，需要 Codex 代为操作时见[使用 Codex 部署](DEPLOY_WITH_CODEX_CN.md)。

## 选择入口

| 当前条件 | 推荐命令 | 默认结果 |
| --- | --- | --- |
| 已有 Node.js/npm | `npx -y "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"` | 下载/升级源码，并完成环境、Codex、npm 依赖和 `verify` |
| 已有 pnpm | `pnpm dlx "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"` | 与 npm 入口相同 |
| 没有 Node.js | `curl -fsSL https://raw.githubusercontent.com/gl813788-byte/codex-qq-bot/main/install.sh \| bash` | 下载/升级源码并安装 `ncc`，后续运行 `ncc` |
| 没有 Node.js，但希望一条命令完成依赖 | `curl -fsSL https://raw.githubusercontent.com/gl813788-byte/codex-qq-bot/main/install.sh \| bash -s -- --prepare` | 下载源码后继续完成环境、依赖和 `verify` |
| 已有源码 | `./一键部署.command` | 识别当前环境并进入首次配置或日常菜单 |
| 上次被中断 | 重新执行上次相同命令 | 校验并复用有效阶段，从未完成处继续 |

npm/pnpm 命令先在线解析 registry 的精确版本，再执行不可变版本，避免旧 `_npx` 缓存。只需要源码时给 npm/pnpm 入口追加 `--download-only`。Windows 请在 WSL 内运行。

## 安装阶段

安装器把工作拆成可校验阶段，只有阶段成功后才写完成标记：

1. 解析默认分支与精确提交。
2. 断点下载、校验并解压源码 ZIP。
3. 安全切换源码；保留数据、运行目录、本地配置和完整升级备份。
4. 识别平台、发行版、架构、libc、包管理器和权限类型。
5. 原生 Termux 安装或复用 PRoot；其他平台直接使用当前系统。
6. 安装基础工具、Node.js 20+ 和官方 Codex CLI，并实际运行 `codex --version`。
7. 安装项目 npm 依赖；依赖指纹和 `npm ls` 均有效时才跳过。
8. 运行 `npm run verify`；成功后才记录环境准备完成。
9. `ncc` 继续 Codex 登录、OneBot、主人 QQ 和群白名单配置。

源码下载、Node 下载和 npm 使用各自缓存。下载损坏时会隔离坏文件；解压总是从干净临时目录开始。验证阶段中断不会让依赖阶段失效，下次只重新验证。Git 工作区、本地改动、陌生非空目录和其他同名全局 `ncc` 不会被覆盖。

## 环境决策表

| 环境 | Node/Codex 方案 | 系统包权限 | QQ/OneBot 方案 |
| --- | --- | --- | --- |
| macOS x64/arm64 | 用户目录中的 SHA-256 校验版官方 Node；npm 安装官方 Codex | Homebrew，不使用 sudo | 外部兼容 OneBot |
| 原生 glibc Linux x64/arm64 | 用户目录中的官方 Node；npm 安装官方 Codex | root、sudo 或 doas | apt-get/dnf 可自动安装官方 NapCat Rootless；其他发行版使用外部 OneBot |
| musl Linux（如 Alpine） | 发行版 `nodejs`/`npm` 包；安装后检查 Node 20+ | root、sudo 或 doas | 外部兼容 OneBot |
| Windows WSL | 在 WSL 发行版内安装和运行 | 发行版权限模型 | Windows 或其他环境中的外部 OneBot |
| Linux 容器 | 在容器内安装和运行 | 容器权限模型 | 容器外部 OneBot |
| 原生 Termux | Android 层只准备 `proot-distro`；Node、Codex 和 Hub 在受管 Debian 内运行 | 必须是普通 Termux 用户，不使用 `su` | 手机内或其他设备上的外部 OneBot |
| 已有 Termux PRoot Ubuntu/Debian | 直接使用当前 guest，不再嵌套 PRoot | uid 0 识别为虚拟 root | 外部兼容 OneBot |
| 未受管 Android shell / Android 真 root | 停止并提示切换到普通 Termux | 不自动提权 | 不安装 |

只有“原生、非 WSL、非容器、非 Termux/PRoot、glibc、x64/arm64、apt-get/dnf Linux”会自动调用 NapCat 官方 Rootless 安装器。设置 `CODEX_QQ_BOT_INSTALL_NAPCAT=required` 时，不满足条件会提前失败；`skip` 始终使用外部 OneBot。

无 root 且没有 sudo/doas 的普通 Linux 用户可以复用已有依赖；若缺系统包，安装器会明确列出阻塞项，不会尝试绕过权限。PRoot 中的 uid 0 是虚拟 root，不等同于 Android 真 root。

## Termux 与已有虚拟环境

原生 Termux 的全局 `ncc` 指向 `scripts/termux-proot.command`。该入口：

1. 检查当前不是 `su`/Android root shell。
2. 通过 `pkg` 安装或复用 `proot-distro`。
3. 安装或复用 `CODEX_QQ_BOT_TERMUX_DISTRO`，默认 `debian`。
4. 把 Termux 中的真实项目目录绑定到 guest 的 `/opt/codex-qq-bot`。
5. 在 guest 内安装 Node、Codex、项目依赖并运行验证。
6. 以后每次 `ncc` 自动进入同一 guest 和同一项目目录。

已经手动进入 Ubuntu/Debian PRoot 时，探测器会读取 guest 的 `/etc/os-release` 并直接部署，不会再启动第二层 PRoot。不要在原生 Termux 里先执行 `su`；需要的“root”由 PRoot 隔离提供。

OpenAI 当前 Codex CLI 的系统要求列出 macOS、Ubuntu/Debian 和 WSL2，没有把原生 Android/Termux 列为正式支持环境。因此 Termux 方案使用 Debian PRoot，并在准备阶段真实启动官方 CLI；如果设备内核仍不兼容，安装会停止并保留已完成阶段，不会静默替换成非官方 Codex 分叉。参见 [Codex CLI 安装要求](https://github.com/openai/codex/blob/main/docs/install.md)和 [Termux PRoot Distro](https://github.com/termux/proot-distro)。

## 检查、续跑与排错

只查看环境和计划：

```bash
bash scripts/install-environment.sh --report
bash scripts/bootstrap-environment.sh --check
CODEX_QQ_BOT_BOOTSTRAP_DRY_RUN=1 bash scripts/bootstrap-environment.sh --all
```

常用安装器选项：

| 选项 | 行为 |
| --- | --- |
| `--check` | 只检查远端源码信息，不下载或改项目 |
| `--prepare` | 源码就位后继续完成环境、依赖和 `verify` |
| `--download-only` | 只下载/升级源码 |
| `--install-dir <目录>` | 指定项目目录 |
| `--archive <ZIP>` | 使用本地 ZIP |
| `--launch` | 安装完成后进入 `ncc` |

源码断点与备份默认位于 `<安装目录>.install-cache`；Node/NapCat 缓存默认位于 `~/.cache/codex-qq-bot/bootstrap`；Termux PRoot 状态默认位于 `~/.local/state/codex-qq-bot`。这些目录不是项目运行数据，`data/`、`runtime/` 和 `config/local.env` 仍保留在项目内。

失败后先重新执行相同命令。若仍失败：

- 用 `install-environment.sh --report` 确认没有把原生 Termux、已有 PRoot、WSL 或容器识别错。
- 检查错误发生在源码、PRoot、Node/Codex、npm 依赖还是 `verify` 阶段。
- Termux 中用 `proot-distro login <发行版>` 验证 guest 是否能启动；不要自动删除已有 guest。
- Codex 必须同时满足“命令存在”和 `codex --version` 成功。
- OneBot 必须用 `/get_login_info` 验证真实登录，端口打开不代表 QQ 已连接。

安装变量的完整表见[配置参考](CONFIGURATION_CN.md#一键部署环境变量)。
