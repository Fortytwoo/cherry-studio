# Yoyoking Studio 开发与验证

这是基于 Cherry Studio 二次开发的完整桌面应用源码。仓库根目录保留 Cherry Studio 的 `src/`、`packages/`、`resources/`、`pnpm-lock.yaml` 和上游 Git 历史；剪辑代码已纳入同一仓库。克隆该分支后即可开发，无须另行检出 `jy-draftc` 或应用补丁。

```powershell
git clone --branch yoyoking https://github.com/Fortytwoo/cherry-studio.git
cd cherry-studio
```

## 源码位置

| 目录 | 内容 |
| --- | --- |
| `src/main/features/yoyoking/` | 剪辑服务、原生窗口联动、账号托管 |
| `src/renderer/components/yoyoking/` | 剪辑工作台、视频预览、剪映窗口和抖音账号页签 |
| `src/renderer/routes/app/yoyoking.tsx` | Cherry Studio 内的工作台路由 |
| `vendor/jy-draftc/` | Python MCP、C++ 原生工具、Win32 helper、共享 Skill 与测试源码 |
| `scripts/prepare-yoyoking-runtime.mjs` | 从本仓库源码和编译输出生成带 SHA-256 清单的运行时资源 |

底座固定为 Cherry Studio `2.1.8` / `de8d659dbe23753fe62e86330483c10c88007566`。导入的剪辑源代码版本见 `vendor/jy-draftc/SOURCE.json`；该目录内的兼容性修复与当前已验证原生构建一致。

## Windows x64 开发

准备 Node `24.12+`、pnpm `12.6.0`、uv、FFmpeg / ffprobe，以及 MSVC x64。完整依赖安装和发行包的系统语音 helper 需要 Visual Studio C++ ATL 组件 `Microsoft.VisualStudio.Component.VC.ATL`。剪映运行时和 DouyinCreatorSDK 由用户在本机提供，不随源码或发行包分发。

```powershell
pnpm install --frozen-lockfile
pnpm build:yoyoking:native
pnpm download:binaries
pnpm rebuild:electron
pnpm build:utility-process
pnpm dev:yoyoking
```

`dev:yoyoking` 和 `build:yoyoking` 会先从 `vendor/jy-draftc/` 准备运行时资源，缺少编译输出时会报错。工作台设置中填写允许素材目录与匹配版本的剪映运行时后，点击“准备剪辑环境”。剪辑 Agent、模型配置、MCP 与 Skill 使用 Cherry Studio 现有能力。

```powershell
pnpm build:yoyoking
.\scripts\start-yoyoking.cmd
pnpm package:yoyoking E:\CodexBuild\yoyoking-package
```

启动器使用 `%LOCALAPPDATA%\YoyokingStudioDev` 作为开发 Profile，不迁移现有 Cherry Studio / Harness 的会话和设置。应用使用独立的名称、appId、NSIS GUID、协议和配置目录，并关闭上游更新渠道。打包脚本当前输出 Windows x64 解包目录，禁用发布和自动签名；未签名产物标为 `NotSigned`。源码提交不代表已生成或安装发行包。

## 验证

```powershell
pnpm smoke:yoyoking --edit --native --host --output=E:\CodexBuild\yoyoking-acceptance
```

该检查使用隔离 Electron Profile、合成音视频和独立 Win32 fixture，验证真实 MCP 工具发现、编辑与 revision 冲突保护、快照、原生导出、成片解码、视频播放与鼠标拖动、窗口接入与恢复，以及托管 SDK 的启动和退出。`--host` 需要本机存在 DouyinCreatorSDK，但不执行真实账号授权。

迁移前的本地验证覆盖 83 个主进程测试、41 个导航测试，以及隔离 Electron 中的音视频导出和播放拖动。本次独立仓库验证完成应用及 utility-process 构建、201 个剪辑后端回归（3 个原生实机测试按默认设置跳过）、9 个工程读取/选择与 Win32 测试，以及全部文档检查。从 Git 暂存内容导出的独立目录也已重新编译原生工具、生成 36 个运行时资源并逐项验证 SHA-256，无须旁边的后端仓库。

本次隔离 Electron 启动成功，实际发现 71 个剪辑工具、3 个剪辑 Skill、5 个宿主工具，完成原生 fixture 接入/恢复和 SDK 启动/元数据读取，renderer 未报告错误。但两次成片检查都在原生 draft restore 阶段遇到 `EXPORT_TIMEOUT`；旧二进制对相同草稿的有界对照也在该阶段超时，原因尚未确定。本次端到端成片检查未通过，不能以前一轮成功代替；检查明细见 `YOYOKING-VALIDATION.json`。

仍待完成：真实模型对话与 Skill 执行；用户原生剪映工程打开、输入、保存重开和跨屏；抖音官方账号授权及业务、下载、Excel 产物；Windows 发行包运行。当前机器缺少 ATL，尚无本轮发行包。单视频轨道、没有独立音轨的原生导出样例会在 `ProjectService::init` 失败，合成音视频样例已通过；这项限制保持明确记录。

## 许可与来源

Cherry Studio 保留根目录的 AGPL-3.0 及原有贡献者历史。`vendor/jy-draftc/LICENSE` 和原有 MIT 组件保留其声明。SDK、凭据、账号状态、用户素材、Python 环境及编译产物不入库。
