import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import type { BrowserWindow } from 'electron'

import type { NativeViewport } from '@shared/types/yoyoking'

const exec = promisify(execFile)
type WindowInfo = { hwnd: number; pid: number; parent: number; path: string; visible: boolean; title: string }

export class NativeEditor {
  private child?: ChildProcessWithoutNullStreams
  private owner?: BrowserWindow
  private target?: WindowInfo
  private controller?: string
  private panel?: WindowInfo
  private active = false
  private stopping?: Promise<Record<string, unknown>>
  private lastHeartbeat = 0
  private lastScan = 0
  private restoration: Record<string, unknown> | null = null
  private transition = Promise.resolve<unknown>(undefined)

  constructor(private runtime: string) {}

  private native = async (...args: string[]): Promise<WindowInfo[]> => {
    const { stdout } = await exec(join(this.runtime, 'bin/window-host.exe'), args, {
      windowsHide: true,
      timeout: 5000,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024
    })
    return stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }

  status(): Record<string, unknown> {
    return { active: this.active, target: this.target, panel: this.panel, restoration: this.restoration }
  }

  async list(): Promise<Record<string, unknown>[]> {
    if (process.platform !== 'win32') throw new Error('Windows is required for the native editor')
    const { selectEditor } = await import(pathToFileURL(join(this.runtime, 'adapters/selection.js')).href)
    return selectEditor(await this.native('list')).candidates
  }

  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.transition.then(action)
    this.transition = result.catch(() => undefined)
    return result
  }

  async attach(owner: BrowserWindow, hwnd: number, viewport: NativeViewport): Promise<Record<string, unknown>> {
    if (this.active) throw new Error('Detach the current editor before attaching another')
    const { selectEditor } = await import(pathToFileURL(join(this.runtime, 'adapters/selection.js')).href)
    const selected = selectEditor(await this.native('list'), hwnd).selected as WindowInfo | undefined
    if (!selected) throw new Error('The selected Jianying window is no longer available')
    const nativeHandle = owner.getNativeWindowHandle()
    const ownerHwnd = Number(nativeHandle.length === 8 ? nativeHandle.readBigUInt64LE() : nativeHandle.readUInt32LE())
    this.owner = owner
    this.controller = viewport.ownerId
    this.target = selected
    this.restoration = null
    const child = spawn(join(this.runtime, 'bin/window-host.exe'), ['panel', String(hwnd), String(ownerHwnd), '1800'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    const closed = () => {
      void this.detach().catch(() => {})
    }
    owner.once('closed', closed)
    child.stdin.on('error', () => {})
    child.stderr.resume()
    child.once('exit', () => {
      this.active = false
      owner.removeListener('closed', closed)
    })
    let buffer = ''
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Native attach timed out')), 8000)
        const finish = (error?: Error) => {
          clearTimeout(timer)
          error ? reject(error) : resolve()
        }
        child.once('error', finish)
        child.once('exit', () => finish(new Error('Native editor closed during attach')))
        child.stdout.on('data', (bytes) => {
          buffer += bytes.toString('utf8')
          if (buffer.length > 1024 * 1024) {
            finish(new Error('Invalid native response'))
            child.stdin.end('detach\n')
            return
          }
          let index: number
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index)
            buffer = buffer.slice(index + 1)
            let event: Record<string, any>
            try {
              event = JSON.parse(line)
            } catch {
              continue
            }
            if (event.event === 'native_panel') {
              this.panel = event.panel
              if (event.electronOwner.hwnd !== ownerHwnd) finish(new Error('Native owner mismatch'))
            }
            if (event.event === 'attached') {
              this.active = true
              finish()
            }
            if (event.event === 'restored') this.restoration = event
            if (event.event === 'rejected' || event.event === 'attach_failed') finish(new Error(String(event.reason)))
          }
        })
      })
      await this.sync(owner, viewport)
      return this.status()
    } catch (error) {
      await this.detach()
      throw error
    }
  }

  async sync(owner: BrowserWindow, input: NativeViewport): Promise<Record<string, unknown>> {
    if (this.owner !== owner) throw new Error('This window does not own the native editor')
    if (this.controller !== input.ownerId) return { active: false, status: 'another_tab_active' }
    this.lastHeartbeat = Date.now()
    if (this.active) {
      if (input.visible && this.target && Date.now() - this.lastScan > 750) {
        this.lastScan = Date.now()
        const family = await this.native('family', String(this.target.pid))
        const current = family.find((window) => window.hwnd === this.target!.hwnd)
        if (current?.visible === false) {
          const { replacementEditor } = await import(pathToFileURL(join(this.runtime, 'adapters/selection.js')).href)
          const replacement = replacementEditor(family, this.target)
          if (replacement.selected) {
            await this.detach(owner, true)
            return this.attach(owner, replacement.selected.hwnd, input)
          }
          if (replacement.status === 'choose_window') {
            this.child?.stdin.write('hide\n')
            return { ...this.status(), status: 'choose_window', candidates: replacement.candidates }
          }
        }
      }
      if (!input.visible) this.child?.stdin.write('hide\n')
      else {
        const { x, y, width, height, viewportWidth, viewportHeight } = input
        if (x + width > viewportWidth || y + height > viewportHeight) throw new Error('Invalid native viewport')
        this.child?.stdin.write(`viewport ${x} ${y} ${width} ${height} ${viewportWidth} ${viewportHeight}\n`)
      }
    }
    return this.status()
  }

  suspendExpired(): void {
    if (this.active && Date.now() - this.lastHeartbeat > 5000) this.child?.stdin.write('hide\n')
  }

  async detach(owner?: BrowserWindow, handoff = false, ownerId?: string): Promise<Record<string, unknown>> {
    if (ownerId && ownerId !== this.controller) return { active: false, status: 'another_tab_active' }
    if (owner && owner !== this.owner) throw new Error('This window does not own the native editor')
    if (this.stopping) return this.stopping
    const child = this.child
    if (!child || child.exitCode !== null) return this.status()
    this.stopping = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native window restoration was not confirmed')), 10000)
      child.once('exit', (code) => {
        clearTimeout(timer)
        this.child = undefined
        if ((code === 0 && this.restoration?.ok) || code === 70) resolve(this.status())
        else reject(new Error('Native window restoration failed'))
      })
      child.stdin.end(handoff ? 'handoff\n' : 'detach\n')
    })
    try {
      return await this.stopping
    } finally {
      this.stopping = undefined
    }
  }

  async currentProject(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { readCurrentProject } = await import(pathToFileURL(join(this.runtime, 'adapters/current-project.js')).href)
    return readCurrentProject(config, () => this.status(), this.native)
  }
}
