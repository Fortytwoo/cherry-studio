# Agent Note: Integrate Yoyoking into a Cherry Studio desktop derivative

Status: proposed

English | [中文](2026-10-26-yoyoking-desktop-integration.zh.md)

## Problem

The local jy-draftc project provides an independent Python editing MCP, a native draft converter/exporter, Harness-specific video and Douyin adapters, and a Windows Jianying window-host POC. The user requests a Cherry Studio derivative incorporating all four capabilities: editing, video preview, native project integration, and Douyin account access. They confirmed this scope on 2026-10-26. The current checkout contains uncommitted work that must survive migration.

The baseline is Cherry Studio 2.1.8 at `de8d659dbe23753fe62e86330483c10c88007566`. This is a local integration proposal, not a claim that the migration or runtime acceptance has passed. No remote PR, application installation, account login, or native editor operation has been performed.

## Proposal

Build a Windows x64 desktop derivative with a dedicated editing workbench. Reuse Cherry's models, conversations, Agent runtime, MCP runtime, Skill library, IpcApi, Preference, Cache, DataApi, lifecycle container, path registry, UI components, and localization. Use an independent application identity and data directory; the working name is Yoyoking Studio. Do not inherit the official updater distribution channel.

Keep Python editing and the native converter independently versioned. Register the stdio service through existing MCP APIs, attach it to the editing Agent, and adapt the existing editing Skills to discovered tool names and the new host. The user clarified that delivery is a complete Cherry Studio derivative in `Fortytwoo/cherry-studio`, branch `yoyoking`, rather than a patch stored only in the backend repository. Include backend, native-tool and Skill source under `vendor/jy-draftc/`, preserve upstream history and licenses, and generate resources entirely within this checkout. Packaged builds must carry pinned runtime resources and cannot rely on developer paths. Preserve revisions, operation receipts, pagination, source hashes, media-root checks, native references, and time units.

Place host adapters under `src/main/features/yoyoking/`, the workbench under `src/renderer/components/yoyoking/`, its route under `src/renderer/routes/app/`, and command schemas/handlers in the existing IpcApi domains. Do not load the Harness plugin manifest or create another Agent/MCP container. Make the combined source layout reproducible before treating the local nested checkout as distributable source.

Extend the existing media protocol with file-backed video entries and streaming single-range reads. Its present Buffer store is not suitable for loading whole MP4 files. Retain trusted-window provenance, explicit entry ownership, realpath checks, GET/HEAD behavior, and deterministic revocation. Reuse the current preview's contracts rather than exposing an arbitrary-path HTTP server.

Adapt the Windows helper and current-project reader to the new Electron host. Select ambiguous windows explicitly. Preserve native window restoration, lock-owner verification, stable snapshots, authoritative main-timeline resolution, and copy-on-write edits. Identify current-project reads as last-saved disk snapshots with unknown unsaved changes; backend success does not establish native UI open/playback/save acceptance.

Adapt the existing Douyin managed process and in-memory OAuth implementation to a lifecycle-owned application service. Share login across the derivative's own sessions, release it on application exit, revoke associated tools on disconnect, and leave editing usable if the external SDK is unavailable. Reuse or improve Cherry's authenticated MCP transport extension point; do not persist transient access tokens in MCP headers. Official authorization remains a user action. Keep the existing data/download/export scope and serial request intervals of at least five seconds.

Implement sequentially: independent application and workbench; editing MCP/Skills and real export; streamed preview; native editor integration; Douyin; packaged acceptance. Keep each incomplete criterion visibly pending. Ship license and provenance notices for the Cherry and MIT components; treat the user-provided Douyin SDK as an external runtime rather than silently redistributing it.

## Alternatives considered

- Only add an MCP configuration to an unmodified Cherry installation: exposes editing tools but does not deliver the requested integrated preview, native editor, account panel, or derivative application.
- Copy the Harness plugin into Cherry unchanged: its Cordis services, tool registration, UI slots, and lifecycle do not match Cherry's APIs.
- Rewrite editing in TypeScript or add a second model/Agent/MCP stack: duplicates working capabilities and loses existing validation and revision behavior.
- Store whole videos in the current Buffer media store or expose arbitrary local file URLs: the former scales memory with asset size; the latter loses the existing authorization and ownership boundary.
- Rewrite the parent repository around the upstream tree immediately: risks uncommitted work and makes the backend's source ownership and upstream history harder to review.

## Acceptance criteria

- AC1 — An independently identified Windows application opens the editing workbench without altering existing Cherry or Harness user data or using the official Cherry updater channel. (verification: Electron)
- AC2 — A reproducible checkout and packaged resource manifest resolve the pinned Python backend, native helper and Skills without developer-machine absolute paths or copied credentials. (verification: packaged artifact)
- AC3 — The editing Agent discovers the real MCP tools and loads the adapted editing Skills; unrelated sessions retain their own configured tool scope. (verification: Electron)
- AC4 — Synthetic media completes project creation, revision-guarded edits, snapshot, native export and terminal job readback; decoding, duration, dimensions and source hashes are independently checked. (verification: Electron)
- AC5 — Authorized videos play and seek through mouse interaction with GET/HEAD and range responses; escaped paths and released entries cannot be read, and opening a large file does not buffer the whole file. (verification: Electron)
- AC6 — Native editor selection, attach, project reading and normal detach preserve the selected PID/window binding, source hashes and snapshot semantics, including rejection of ambiguity or concurrent source changes. (verification: Electron)
- AC7 — A separate test draft supports real playback, keyboard and Chinese input, resizing, tab switching, save/reopen and original-window restoration in the derivative; backend-only results cannot satisfy this criterion. (verification: Electron)
- AC8 — The account panel starts its owned SDK, completes user-confirmed official authorization, shares login only within the application, revokes tools on disconnect, and leaves no owned SDK process after exit. (verification: Electron)
- AC9 — After real authorization, bounded Douyin reads, a download and an Excel export preserve tool receipts and have independently inspected outputs; synthetic OAuth tests alone cannot satisfy this criterion. (verification: Electron)
- AC10 — The Windows package repeats the editing, preview, native-window and account acceptance from a standalone directory and reports its actual signing state, including NotSigned when unsigned. (verification: packaged artifact)
- AC11 — The bilingual proposal remains proposed until every criterion has evidence, with incomplete runtime or account checks explicitly recorded rather than inferred from successful builds or fixtures. (verification: docs gate)

## Risks

Jianying window behavior and native rendering depend on separately verified versions; their compatibility cannot be inferred from each other. The Windows embedding code remains a POC until the new host passes real interaction checks. The external SDK and official account authorization are prerequisites for real Douyin acceptance. Native dependencies and bundled Python resources require packaged execution checks. Cherry's existing media and OAuth extension points may need scoped improvements before the adapters can meet their contracts. Preserve existing dirty work and user sessions throughout; do not install over an existing desktop application or terminate its host as part of preparing this proposal.
