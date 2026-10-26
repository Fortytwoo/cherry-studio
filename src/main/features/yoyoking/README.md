# Yoyoking host integration

`YoyokingService` owns application-level editing setup, preview leases, native editor ownership and the managed Douyin process. It uses existing MCP, Skill, Agent, Preference, IpcApi, path-registry and lifecycle APIs. Editing operations remain in the independent Python backend.

`NativeEditor` wraps the existing Win32 helper. A managed Electron window and a per-pane UUID jointly own an attachment. The renderer never supplies the host HWND. Fresh inventories select the exact target HWND, replacement windows remain in the selected PID, and detach waits for a native restoration receipt. Current-project reads reuse the lock-owner and stable-snapshot implementation and return last-saved disk state.

Runtime resources are generated from this repository's `vendor/jy-draftc/` source by `scripts/prepare-yoyoking-runtime.mjs`, checked against `manifest.json`, and loaded from the registered `feature.yoyoking.runtime` path. A fresh checkout includes all backend, native-tool and Skill source without a sibling repository, submodule or patch reconstruction. Source adapters are derived from the existing host-independent implementation; Harness registration and UI manifests are not loaded. The external Douyin SDK and credentials are not copied into these resources.

The MCP runtime accepts registered local endpoint factories and memory-only authenticated fetch functions. Revoking a registration stops its connections and clears catalog state. Douyin server metadata contains the loopback URL and an `ephemeral-auth` tag, never a token. Without the owned authenticated registration, that tag refuses connection. Disconnect removes the account's MCP association and disables its Skill for the editing Agent.

File preview permissions follow the configured media roots and application workspace. Narrowing configuration disables the previous editing server until setup updates its environment; already-created preview entries are revoked. Preview tool results request playback in the workbench and do not claim visual inspection by the model.

Verification uses file-video boundary tests, existing MCP and navigation consumers, a synthetic editing/export flow in real Electron, and an independent Win32 fixture attached to that Electron host. Fixture success is separate from real Jianying project open/playback/save and from real Douyin authorization and account output validation.
