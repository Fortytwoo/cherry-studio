import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { auth } from '@modelcontextprotocol/client'
import { McpServer as ProtocolServer } from '@modelcontextprotocol/server'
import { type BrowserWindow, shell } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { resolveVideoPath } from '@main/services/mediaProtocol'
import { getBinaryPath } from '@main/utils/binaryResolver'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import { type YoyokingSettings, YoyokingSettingsSchema, type YoyokingStatus } from '@shared/types/yoyoking'

import { NativeEditor } from './NativeEditor'

const logger = loggerService.withContext('YoyokingService')
const exec = promisify(execFile)
type Installation = { editServerId?: string; hostServerId?: string; douyinServerId?: string; agentId?: string }
const videoTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska'
}

@Injectable('YoyokingService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpRuntimeService', 'MediaProtocolService', 'WindowManager'])
export class YoyokingService extends BaseService {
  private native!: NativeEditor
  private toolNames: string[] = []
  private skillNames: string[] = []
  private host: any
  private revokeDouyin?: () => Promise<void>
  private revokeHost?: () => Promise<void>
  private previews = new Map<string, { windowId: number; release: () => void }>()
  private setupTask?: Promise<YoyokingStatus>
  private accountQueue = Promise.resolve()
  private generation = -1
  private douyinToolNames: string[] = []
  private accountSyncFailed = false
  private stopping = false

  private runtime(): string {
    return application.getPath('feature.yoyoking.runtime')
  }
  private workspace(): string {
    return application.getPath('feature.yoyoking.workspace')
  }
  private installation(): Installation {
    return application.get('PreferenceService').get('feature.yoyoking.installation')
  }
  private settings(): YoyokingSettings {
    return YoyokingSettingsSchema.parse(application.get('PreferenceService').get('feature.yoyoking.settings'))
  }

  protected async onInit(): Promise<void> {
    this.native = new NativeEditor(this.runtime())
    this.registerInterval(() => this.native.suspendExpired(), 1000)
    const installed = this.installation()
    if (installed.douyinServerId && mcpServerService.getById(installed.douyinServerId)) {
      mcpServerService.update(installed.douyinServerId, { isActive: false })
    }
    if (installed.hostServerId && mcpServerService.getById(installed.hostServerId)) {
      this.revokeHost = application
        .get('McpRuntimeService')
        .registerLocalEndpoint(installed.hostServerId, async () => ({
          createServer: () => this.createHostServer(),
          close: async () => {}
        }))
    }
    if (this.settings().douyinEnabled) await this.startDouyin()
  }

  protected async onStop(): Promise<void> {
    this.stopping = true
    try {
      await this.setupTask?.catch(() => {})
      await this.host?.dispose()
      await this.accountQueue
      await this.revokeDouyin?.()
      await this.revokeHost?.()
    } finally {
      for (const entry of this.previews.values()) entry.release()
      this.previews.clear()
      await this.native.exclusive(() => this.native.detach())
    }
  }

  status(): YoyokingStatus {
    const installed = this.installation()
    return {
      settings: this.settings(),
      workspace: this.workspace(),
      editServerId: installed.editServerId ?? null,
      agentId: installed.agentId ?? null,
      toolNames: this.toolNames,
      skillNames: this.skillNames,
      douyin: {
        ...(this.host?.status() ?? { state: 'disconnected', service_state: 'stopped' }),
        tool_names: this.douyinToolNames,
        tools_state: this.douyinToolNames.length ? 'connected' : 'disconnected'
      }
    }
  }

  async configure(settings: YoyokingSettings): Promise<void> {
    if (this.setupTask) throw new Error('Wait for setup to complete before changing settings')
    const canonicalRoots = await Promise.all(settings.mediaRoots.map((path) => realpath(path)))
    await this.native.exclusive(() => this.native.detach())
    await this.host?.dispose()
    await this.accountQueue
    this.host = undefined
    await this.revokeDouyin?.()
    this.revokeDouyin = undefined
    await application
      .get('PreferenceService')
      .set('feature.yoyoking.settings', { ...settings, mediaRoots: [...new Set(canonicalRoots)] })
    for (const entry of this.previews.values()) entry.release()
    const installed = this.installation()
    if (installed.editServerId && mcpServerService.getById(installed.editServerId)) {
      mcpServerService.update(installed.editServerId, { isActive: false })
      await application.get('McpRuntimeService').stopServer(installed.editServerId)
    }
    this.toolNames = []
  }

  private ensureServer(id: string | undefined, config: CreateMcpServerDto): McpServer {
    const existing = id ? mcpServerService.getById(id) : null
    return existing ? mcpServerService.update(existing.id, config) : mcpServerService.create(config)
  }

  setup(): Promise<YoyokingStatus> {
    return (this.setupTask ??= this.install().finally(() => {
      this.setupTask = undefined
    }))
  }

  private async install(): Promise<YoyokingStatus> {
    if (this.stopping) throw new Error('Application is stopping')
    const settings = this.settings(),
      runtime = this.runtime(),
      workspace = this.workspace()
    await mkdir(workspace, { recursive: true })
    const backend = join(runtime, 'backend')
    const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8')) as {
      files: { path: string; sha256: string }[]
    }
    for (const file of manifest.files) {
      const target = await realpath(join(runtime, file.path)),
        child = relative(runtime, target)
      if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Invalid runtime resource path')
      if (
        createHash('sha256')
          .update(await readFile(target))
          .digest('hex') !== file.sha256
      )
        throw new Error(`Runtime integrity check failed: ${file.path}`)
    }
    const installed = this.installation()
    const edit = this.ensureServer(installed.editServerId, {
      name: 'yoyoking-edit',
      type: 'stdio',
      command: 'uv',
      args: ['run', '--project', backend, '--directory', backend, '--frozen', '--no-dev', 'jy-edit-mcp'],
      env: {
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        UV_PROJECT_ENVIRONMENT: application.getPath('feature.yoyoking.python_env'),
        JY_EDIT_WORKSPACE: workspace,
        JY_EDIT_MEDIA_ROOTS: JSON.stringify(settings.mediaRoots),
        JY_DRAFTC_EXE: join(runtime, 'bin/jy-draftc.exe'),
        JY_INSTALL_DIR: settings.jianyingRuntime
      },
      timeout: 300,
      isActive: true,
      installSource: 'manual',
      tags: ['yoyoking']
    })
    installed.editServerId = edit.id
    await application.get('PreferenceService').set('feature.yoyoking.installation', { ...installed })
    const tools = await application.get('McpRuntimeService').listTools(edit.id, 'refresh')
    this.toolNames = tools.map((tool) => tool.name)
    const hostServer = this.ensureServer(installed.hostServerId, {
      name: 'yoyoking-host',
      type: 'inMemory',
      isActive: true,
      installSource: 'manual',
      tags: ['yoyoking']
    })
    installed.hostServerId = hostServer.id
    await this.revokeHost?.()
    this.revokeHost = application.get('McpRuntimeService').registerLocalEndpoint(hostServer.id, async () => ({
      createServer: () => this.createHostServer(),
      close: async () => {}
    }))
    const skillIds: string[] = []
    for (const name of ['yoyoking-edit', 'yoyoking-montage', 'yoyoking-captions']) {
      const existing = (await skillService.list({})).find((skill) => skill.name === name)
      const skill =
        existing ?? (await skillService.installFromDirectory({ directoryPath: join(runtime, 'skills', name) }))
      skillIds.push(skill.id)
      if (!this.skillNames.includes(name)) this.skillNames.push(name)
    }
    const model = UniqueModelIdSchema.safeParse(application.get('PreferenceService').get('chat.default_model_id'))
    if (installed.agentId && !agentService.getAgent(installed.agentId)) installed.agentId = undefined
    if (!installed.agentId && model.success) {
      installed.agentId = randomUUID()
      agentService.createAgentWithId(installed.agentId, {
        type: 'pi',
        name: 'Yoyoking',
        model: model.data,
        mcps: [edit.id, hostServer.id],
        skillIds,
        configuration: { permission_mode: 'default', yoyoking: true },
        instructions:
          'You are the video editing agent in Yoyoking Studio. Discover actual tool schemas and load the yoyoking Skills. For the current Jianying project use yoyoking_current_project; it is a last-saved disk snapshot, not in-memory state. Preserve source drafts, use copy-on-write and revisions. Use returned IDs and poll export jobs to terminal states. Call yoyoking_preview_video to show an authorized source or completed export. Do not claim a rendered video or a saved draft passed native UI acceptance without real observation. Douyin calls are serial with at least five seconds between requests.'
      })
    }
    await application.get('PreferenceService').set('feature.yoyoking.installation', { ...installed })
    if (settings.douyinEnabled) await this.startDouyin()
    logger.info('Editing runtime ready', { toolCount: this.toolNames.length, skillCount: this.skillNames.length })
    return this.status()
  }

  async call(name: string, args: Record<string, unknown>, windowId: string): Promise<unknown> {
    const serverId = this.installation().editServerId
    if (!serverId || !this.toolNames.includes(name)) throw new Error('Set up the editing runtime first')
    return application.get('McpRuntimeService').callTool({
      serverId,
      name,
      args,
      scope: `yoyoking:${windowId}`,
      interactionContext: { windowId, topicId: `yoyoking:${windowId}`, requestId: randomUUID() }
    })
  }

  async preview(path: string, owner: BrowserWindow): Promise<{ id: string; url: string }> {
    if ([...this.previews.values()].filter((entry) => entry.windowId === owner.webContents.id).length >= 8)
      throw new Error('Close an existing preview before opening another')
    const roots = [...this.settings().mediaRoots, this.workspace()]
    const source = await resolveVideoPath(path, roots)
    const mimeType = videoTypes[extname(source).toLowerCase()]
    if (!mimeType) throw new Error('Unsupported video format')
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', source],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }
    )
    if (!JSON.parse(stdout).streams?.some((stream: { codec_type: string }) => stream.codec_type === 'video'))
      throw new Error('Source has no video stream')
    const media = application.get('MediaProtocolService')
    const id = media.storeVideo({ path: source, roots, mimeType, access: { webContentsId: owner.webContents.id } })
    const cleanup = () => {
      media.remove('video', id)
      this.previews.delete(id)
      owner.webContents.removeListener('destroyed', cleanup)
    }
    this.previews.set(id, { windowId: owner.webContents.id, release: cleanup })
    owner.webContents.once('destroyed', cleanup)
    return { id, url: media.getUrl('video', id) }
  }

  releasePreview(id: string, owner: BrowserWindow): void {
    if (this.previews.get(id)?.windowId !== owner.webContents.id) return
    this.previews.get(id)?.release()
  }

  nativeEditor(): NativeEditor {
    return this.native
  }

  async launchNative(): Promise<void> {
    if (process.platform !== 'win32') throw new Error('Windows is required')
    const executable = await realpath(this.settings().jianyingExecutable)
    if (basename(executable).toLowerCase() !== 'jianyingpro.exe')
      throw new Error('Choose the JianyingPro.exe executable')
    const child = spawn(executable, [], {
      cwd: dirname(executable),
      detached: true,
      windowsHide: false,
      stdio: 'ignore'
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
  }

  currentProject(): Promise<Record<string, unknown>> {
    return this.native.exclusive(() =>
      this.native.currentProject({
        userDataDirectory: application.getPath('feature.yoyoking.jianying_userdata'),
        snapshotDirectory: application.getPath('feature.yoyoking.snapshots'),
        draftConverter: join(this.runtime(), 'bin/jy-draftc.exe'),
        converterRuntime: this.settings().jianyingRuntime
      })
    )
  }

  private createHostServer(): ProtocolServer {
    const server = new ProtocolServer({ name: 'yoyoking-host', version: '1.0.0' })
    server.registerTool(
      'yoyoking_current_project',
      {
        description:
          'Read the uniquely bound Jianying project last-saved snapshot. Preserves source files; requires an attached editor.',
        inputSchema: z.object({})
      },
      async () => ({ content: [{ type: 'text', text: JSON.stringify(await this.currentProject()) }] })
    )
    server.registerTool(
      'yoyoking_douyin_connect',
      {
        description: 'Start official Douyin authorization in the user browser. Credentials remain in memory.',
        inputSchema: z.object({})
      },
      async () => ({ content: [{ type: 'text', text: JSON.stringify(await this.login()) }] })
    )
    server.registerTool(
      'yoyoking_douyin_status',
      { description: 'Read the local Douyin service and authorization state.', inputSchema: z.object({}) },
      async () => ({ content: [{ type: 'text', text: JSON.stringify(this.status().douyin) }] })
    )
    server.registerTool(
      'yoyoking_douyin_disconnect',
      {
        description: 'Revoke this application shared Douyin authorization and remove the associated tools.',
        inputSchema: z.object({})
      },
      async () => ({ content: [{ type: 'text', text: JSON.stringify(await this.disconnect()) }] })
    )
    server.registerTool(
      'yoyoking_preview_video',
      {
        description: 'Show an authorized local video in the editing workbench. Does not claim model visual inspection.',
        inputSchema: z.object({ path: z.string() })
      },
      async ({ path }) => {
        const source = await resolveVideoPath(path, [...this.settings().mediaRoots, this.workspace()])
        application.get('IpcApiService').broadcast('yoyoking.preview.requested', { path: source })
        return {
          content: [
            { type: 'text', text: JSON.stringify({ kind: 'yoyoking.video', path: source, state: 'preview_requested' }) }
          ]
        }
      }
    )
    return server
  }

  private async startDouyin(): Promise<void> {
    if (this.host) return
    const directory = this.settings().douyinSdkDirectory || application.getPath('feature.yoyoking.douyin_sdk')
    const hostModule = await import(pathToFileURL(join(this.runtime(), 'adapters/douyin-host.js')).href)
    const oauthModule = await import(pathToFileURL(join(this.runtime(), 'adapters/douyin-oauth.js')).href)
    this.host = hostModule.createDouyinHost(
      {
        sdkDirectory: directory,
        workspaceDirectory: this.workspace(),
        uvCommand: await getBinaryPath('uv'),
        pythonVersion: '3.12'
      },
      {
        oauthFactory: (options: Record<string, unknown>) => oauthModule.createDouyinOAuth({ ...options, auth })
      }
    )
    this.host.subscribe(() => {
      this.accountQueue = this.accountQueue
        .then(() => this.syncDouyin())
        .catch((error) => {
          this.accountSyncFailed = true
          logger.warn('Account connection could not be synchronized', error)
        })
      return this.accountQueue
    })
  }

  private async syncDouyin(): Promise<void> {
    const connection = this.host?.connection()
    if (this.generation === (connection?.generation ?? -1) && !this.accountSyncFailed) return
    this.accountSyncFailed = true
    this.douyinToolNames = []
    this.generation = connection?.generation ?? -1
    await this.revokeDouyin?.()
    this.revokeDouyin = undefined
    const installed = this.installation()
    if (!connection || this.stopping) {
      if (installed.douyinServerId && mcpServerService.getById(installed.douyinServerId))
        mcpServerService.update(installed.douyinServerId, { isActive: false })
      if (installed.agentId) {
        const agent = agentService.getAgent(installed.agentId)
        if (agent)
          agentService.updateAgent(installed.agentId, {
            mcps: agent.mcps?.filter((id) => id !== installed.douyinServerId) ?? []
          })
        const skill = (await skillService.list({})).find((item) => item.name === 'yoyoking-douyin')
        if (skill) skillService.toggle({ agentId: installed.agentId, skillId: skill.id, isEnabled: false })
      }
      this.accountSyncFailed = false
      return
    }
    const server = this.ensureServer(installed.douyinServerId, {
      name: 'yoyoking-douyin',
      type: 'streamableHttp',
      baseUrl: connection.url,
      isActive: true,
      tags: ['yoyoking', 'ephemeral-auth'],
      timeout: 300
    })
    installed.douyinServerId = server.id
    await application.get('PreferenceService').set('feature.yoyoking.installation', { ...installed })
    this.revokeDouyin = application.get('McpRuntimeService').registerAuthenticatedTransport(server.id, connection.fetch)
    const tools = await application.get('McpRuntimeService').listTools(server.id, 'refresh')
    if (!tools.length) throw new Error('The authorized SDK exposed no tools')
    this.douyinToolNames = tools.map((tool) => tool.name)
    const skill =
      (await skillService.list({})).find((item) => item.name === 'yoyoking-douyin') ??
      (await skillService.installFromDirectory({ directoryPath: join(this.runtime(), 'skills/yoyoking-douyin') }))
    if (installed.agentId) {
      const agent = agentService.getAgent(installed.agentId)
      if (agent) agentService.updateAgent(installed.agentId, { mcps: [...new Set([...(agent.mcps ?? []), server.id])] })
      await skillService.toggle({ agentId: installed.agentId, skillId: skill.id, isEnabled: true })
    }
    if (!this.skillNames.includes(skill.name)) this.skillNames.push(skill.name)
    this.accountSyncFailed = false
  }

  async login(): Promise<Record<string, unknown>> {
    if (!this.settings().douyinEnabled) throw new Error('Douyin is disabled')
    await this.startDouyin()
    const state = await this.host.login()
    await this.accountQueue
    if (this.host.connection()) await this.syncDouyin()
    const url = state.authorization_url
    if (typeof url === 'string') {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1')
        throw new Error('Invalid authorization origin')
      await shell.openExternal(url)
    }
    return state
  }

  async disconnect(): Promise<Record<string, unknown>> {
    if (this.host) await this.host.logout()
    await this.accountQueue
    return this.host?.status() ?? { state: 'disconnected' }
  }
}
