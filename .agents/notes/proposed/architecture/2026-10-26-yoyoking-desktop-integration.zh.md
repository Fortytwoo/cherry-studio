# Agent Note: 将 Yoyoking 集成到基于 Cherry Studio 的桌面应用

Status: proposed

[English](2026-10-26-yoyoking-desktop-integration.md) | 中文

## 问题

本地 jy-draftc 项目包含独立的 Python 剪辑 MCP、原生草稿转换与导出器、依赖 Harness 的视频和抖音适配层，以及 Windows 剪映窗口承载 POC。用户要求基于 Cherry Studio 二次开发，并接入剪辑、视频预览、原生工程联动和抖音账号四类能力，已于 2026-10-26 确认完整范围。当前工作区的未提交改动必须在迁移中保留。

底座固定为 Cherry Studio 2.1.8，提交 `de8d659dbe23753fe62e86330483c10c88007566`。本文是本地集成提案，不表示迁移或运行时验收已经通过。尚未创建远端 PR、安装应用、登录账号或操作原生编辑器。

## 提案

构建 Windows x64 桌面派生应用，提供独立剪辑工作台。复用 Cherry 的模型、对话、Agent runtime、MCP runtime、Skill 库、IpcApi、Preference、Cache、DataApi、生命周期容器、路径注册表、UI 组件和国际化。使用独立应用身份及数据目录，暂名 Yoyoking Studio；不继承官方更新分发渠道。

Python 剪辑后端和原生转换器独立管理版本。通过现有 MCP API 注册 stdio 服务并关联剪辑 Agent，将现有剪辑 Skill 适配到实时发现的工具名与新宿主。用户明确交付物应为 `Fortytwoo/cherry-studio` 的 `yoyoking` 分支中的完整 Cherry Studio 派生项目，而非仅在后端仓库保存补丁。将后端、原生工具和 Skill 源码纳入 `vendor/jy-draftc/`，保留上游历史与许可证，资源生成完全在本 checkout 内完成。发行包必须携带固定运行时资源，不能依赖开发机路径。保留 revision、操作回执、分页、源哈希、素材目录检查、原生引用和时间单位。

宿主适配放在 `src/main/features/yoyoking/`，工作台放在 `src/renderer/components/yoyoking/`，路由放在 `src/renderer/routes/app/`，命令 schema/handler 接入现有 IpcApi domain。不加载 Harness 插件 manifest，也不增加第二套 Agent/MCP 容器。先实现可复现的组合源码布局，再将本地嵌套 checkout 视为可交付源码。

为现有媒体协议增加文件型视频 entry 和单区间流式读取。当前 Buffer 存储不适合装入完整 MP4。保留可信窗口来源校验、明确的 entry 所有权、realpath 检查、GET/HEAD 行为和确定性撤销。复用现有预览契约，不暴露任意路径 HTTP 服务。

将 Windows helper 和当前工程读取器适配到新 Electron 宿主。窗口有歧义时明确选择。保留原生窗口恢复、锁持有者验证、稳定快照、有效主时间线解析及副本编辑。当前工程读取标记为最近保存的磁盘快照，未保存修改未知；后端成功不能证明原生 UI 打开、播放和保存通过。

将现有抖音托管进程和内存 OAuth 实现适配为应用生命周期服务。只在派生应用自身会话间共享登录，退出应用时释放，断开账号时撤销关联工具；外部 SDK 不可用时剪辑仍能使用。复用或改进 Cherry 已认证 MCP 传输的扩展点，不把短期 access token 持久化到 MCP headers。官方授权仍由用户操作。维持现有数据、下载、导出范围，以及串行且至少五秒的请求间隔。

依次实施：独立应用和工作台；剪辑 MCP/Skill 与真实导出；流式预览；原生编辑器联动；抖音；打包验收。每项未满足的验收标准保持明确待完成。随包保留 Cherry 和 MIT 组件的许可证与来源声明；用户提供的 Douyin SDK 作为外部运行时，不直接随包再分发。

## 备选方案

- 只在未修改的 Cherry 中增加 MCP 配置：能够提供剪辑工具，但无法交付所需的集成预览、原生编辑器、账号面板和派生应用。
- 原样复制 Harness 插件到 Cherry：其 Cordis 服务、工具注册、UI 插槽及生命周期与 Cherry API 不匹配。
- 将剪辑重写为 TypeScript 或增加第二套模型/Agent/MCP：重复现有能力，并丢失既有验证及 revision 行为。
- 将完整视频放入当前 Buffer 媒体存储，或直接暴露任意本地文件 URL：前者内存随素材大小增长，后者丢失现有授权与所有权边界。
- 立即用上游目录树重写父仓库：可能影响未提交改动，也使后端源码归属与上游历史更难审阅。

## 验收标准

- AC1 — 独立身份的 Windows 应用能打开剪辑工作台，且不修改现有 Cherry/Harness 用户数据、不使用 Cherry 官方更新源。 (verification: Electron)
- AC2 — 可复现 checkout 和打包资源清单能解析固定 Python 后端、原生 helper 和 Skill，不依赖开发机绝对路径或复制的凭据。 (verification: packaged artifact)
- AC3 — 剪辑 Agent 能发现真实 MCP 工具并加载适配后的剪辑 Skill，无关会话维持各自配置的工具作用域。 (verification: Electron)
- AC4 — 合成素材完成工程创建、revision 保护编辑、快照、原生导出及任务终态回读，解码、时长、尺寸和源哈希经独立检查。 (verification: Electron)
- AC5 — 授权视频支持鼠标播放和拖动、GET/HEAD 与 Range 响应；越界路径和已释放 entry 无法读取，打开大文件不缓存整段内容。 (verification: Electron)
- AC6 — 原生编辑器选择、接入、工程读取及正常脱离保留选定 PID/窗口绑定、源哈希及快照语义，并拒绝歧义和源文件并发变化。 (verification: Electron)
- AC7 — 独立测试草稿在派生应用中通过真实播放、键盘和中文输入、缩放、页签切换、保存重开及原窗口恢复，仅后端结果不能满足此项。 (verification: Electron)
- AC8 — 账号面板启动自有 SDK、完成用户确认的官方授权、仅在应用内共享登录、断开时撤销工具，退出后无残留自有 SDK 进程。 (verification: Electron)
- AC9 — 真实授权后完成有界抖音读取、一次下载与一次 Excel 导出，保留工具回执并独立检查输出；合成 OAuth 测试不能满足此项。 (verification: Electron)
- AC10 — Windows 分发包从独立目录重复完成剪辑、预览、原生窗口和账号验收，并报告实际签名状态，未签名时标记 NotSigned。 (verification: packaged artifact)
- AC11 — 双语提案在每项标准都有证据前保持 proposed，明确记录未完成的运行时或账号检查，不从构建或夹具成功推断完成。 (verification: docs gate)

## 风险

剪映窗口行为与原生渲染分别依赖经验证的版本，不能相互推断兼容性。Windows 承载代码在新宿主完成真实交互验收前仍属于 POC。真实抖音验收需要外部 SDK 与官方账号授权。原生依赖及 Python 运行时资源必须经打包执行检查。Cherry 现有媒体及 OAuth 扩展点可能需要范围明确的改进后，适配层才能满足契约。整个过程保留既有未提交改动和用户会话；准备本提案不覆盖现有桌面安装，也不终止其宿主。
