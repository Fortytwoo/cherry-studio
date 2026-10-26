import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Badge,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea
} from '@cherrystudio/ui'
import { useTabs } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { YoyokingSettings, YoyokingStatus } from '@shared/types/yoyoking'

const settingsLabels = {
  jianyingRuntime: 'yoyoking.jianyingRuntime',
  jianyingExecutable: 'yoyoking.jianyingExecutable',
  douyinSdkDirectory: 'yoyoking.douyinSdkDirectory'
}

function payload(value: unknown): Record<string, any> {
  const result = value as { structuredContent?: Record<string, any>; content?: { type: string; text?: string }[] }
  if (result.structuredContent) return result.structuredContent
  const text = result.content?.find((item) => item.type === 'text')?.text
  return text ? JSON.parse(text) : {}
}

export default function YoyokingWorkbench() {
  const { t } = useTranslation()
  const { openTab } = useTabs()
  const [status, setStatus] = useState<YoyokingStatus>()
  const [settings, setSettings] = useState<YoyokingSettings>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [output, setOutput] = useState<unknown>()
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<{ id: string; url: string }>()
  const video = useRef<HTMLVideoElement>(null)
  const previewId = useRef<string | undefined>(undefined)
  const refresh = useCallback(async () => {
    const state = await ipcApi.request('yoyoking.status')
    setStatus(state)
    setSettings((current) => current ?? state.settings)
  }, [])
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true)
      setError('')
      try {
        await action()
        await refresh()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  useEffect(() => {
    void refresh().catch((failure) => setError(String(failure)))
    const timer = setInterval(() => {
      void refresh().catch(() => {})
    }, 2000)
    return () => {
      clearInterval(timer)
    }
  }, [refresh])
  useEffect(
    () => () => {
      if (previewId.current) void ipcApi.request('yoyoking.preview.release', { id: previewId.current }).catch(() => {})
    },
    []
  )

  const showVideo = useCallback(async (source: string) => {
    const next = await ipcApi.request('yoyoking.preview.open', { path: source })
    video.current?.pause()
    if (video.current) {
      video.current.removeAttribute('src')
      video.current.load()
    }
    const previous = previewId.current
    previewId.current = next.id
    setPreview(next)
    setPath(source)
    if (previous) await ipcApi.request('yoyoking.preview.release', { id: previous })
  }, [])
  useIpcOn('yoyoking.preview.requested', ({ path }) => {
    void run(() => showVideo(path))
  })

  return (
    <main
      className="flex h-full min-h-0 flex-col gap-4 overflow-auto bg-background p-4"
      data-testid="yoyoking-workbench">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto font-medium">{t('yoyoking.title')}</h1>
        <Badge variant="secondary">{status?.toolNames.length ?? 0} MCP</Badge>
        <Button
          disabled={busy}
          onClick={() => {
            void run(() => ipcApi.request('yoyoking.setup'))
          }}>
          {t('yoyoking.setup')}
        </Button>
        <Button
          variant="outline"
          disabled={!status?.agentId}
          onClick={() => openTab(`/app/agents?agentId=${status?.agentId}`)}>
          {t('yoyoking.open_agent')}
        </Button>
      </header>
      {error ? <Alert type="error" description={error} /> : null}
      {status?.editServerId && !status.agentId ? (
        <Alert
          action={
            <Button variant="link" onClick={() => openTab('/settings/model')}>
              {t('yoyoking.default_model_required')}
            </Button>
          }
        />
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">{t('common.settings')}</summary>
        {settings ? (
          <FieldGroup className="mt-3">
            <Field>
              <FieldLabel htmlFor="yoyoking-roots">{t('yoyoking.media_roots')}</FieldLabel>
              <Textarea.Input
                id="yoyoking-roots"
                value={settings.mediaRoots.join('\n')}
                onChange={(event) =>
                  setSettings({ ...settings, mediaRoots: event.target.value.split('\n').filter(Boolean) })
                }
              />
            </Field>
            {(['jianyingRuntime', 'jianyingExecutable', 'douyinSdkDirectory'] as const).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`yoyoking-${key}`}>{t(settingsLabels[key])}</FieldLabel>
                <Input
                  id={`yoyoking-${key}`}
                  value={settings[key]}
                  onChange={(event) => setSettings({ ...settings, [key]: event.target.value })}
                />
              </Field>
            ))}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run(() => ipcApi.request('yoyoking.configure', settings))
              }}>
              {t('common.save')}
            </Button>
          </FieldGroup>
        ) : null}
      </details>
      <Separator />
      <Tabs defaultValue="video" className="flex shrink-0 flex-col">
        <TabsList>
          <TabsTrigger value="video">{t('yoyoking.preview')}</TabsTrigger>
          <TabsTrigger value="native">{t('yoyoking.native_editor')}</TabsTrigger>
          <TabsTrigger value="projects">{t('yoyoking.projects')}</TabsTrigger>
          <TabsTrigger value="douyin">{t('yoyoking.douyin')}</TabsTrigger>
        </TabsList>
        <TabsContent value="video" className="flex min-h-0 flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="yoyoking-video-path">{t('yoyoking.preview')}</FieldLabel>
            <Input id="yoyoking-video-path" value={path} onChange={(event) => setPath(event.target.value)} />
          </Field>
          <Button
            variant="outline"
            disabled={busy || !path.trim()}
            onClick={() => {
              void run(() => showVideo(path))
            }}>
            {t('common.open')}
          </Button>
          {preview ? (
            <video
              ref={video}
              src={preview.url}
              controls
              preload="metadata"
              className="min-h-48 max-h-[65vh] w-full bg-background-subtle"
              onError={() => setError(t('yoyoking.video_error'))}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="native" className="min-h-96 flex-1">
          <NativeEditorPane run={run} setOutput={setOutput} />
        </TabsContent>
        <TabsContent value="projects" className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {['list_projects', 'list_native_projects', 'get_capabilities'].map((name) => (
              <Button
                key={name}
                variant="outline"
                disabled={busy || !status?.toolNames.includes(name)}
                onClick={() => {
                  void run(async () =>
                    setOutput(payload(await ipcApi.request('yoyoking.tool.call', { name, args: {} })))
                  )
                }}>
                {name === 'list_projects'
                  ? t('yoyoking.projects')
                  : name === 'list_native_projects'
                    ? `${t('yoyoking.native_editor')} · ${t('yoyoking.projects')}`
                    : 'MCP'}
              </Button>
            ))}
          </div>
          <p className="break-all text-sm text-muted-foreground">{status?.workspace}</p>
        </TabsContent>
        <TabsContent value="douyin" className="flex flex-col gap-3">
          <Badge variant="secondary">{String(status?.douyin.state ?? 'disconnected')}</Badge>
          <p className="text-sm text-muted-foreground">{String(status?.douyin.message ?? '')}</p>
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                void run(() => ipcApi.request('yoyoking.douyin.login'))
              }}>
              {t('yoyoking.login')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run(() => ipcApi.request('yoyoking.douyin.disconnect'))
              }}>
              {t('yoyoking.disconnect')}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
      {output ? (
        <pre className="max-h-64 shrink-0 overflow-auto rounded-md bg-background-subtle p-3 text-xs" aria-live="polite">
          {JSON.stringify(output, null, 2)}
        </pre>
      ) : null}
    </main>
  )
}

function NativeEditorPane({
  run,
  setOutput
}: {
  run: (action: () => Promise<unknown>) => Promise<void>
  setOutput: (value: unknown) => void
}) {
  const { t } = useTranslation()
  const area = useRef<HTMLDivElement>(null)
  const ownerId = useRef(crypto.randomUUID())
  const attached = useRef(false)
  const [windows, setWindows] = useState<Record<string, unknown>[]>([])
  const [selected, setSelected] = useState<string>('')
  const bounds = useCallback(() => {
    const rect = area.current?.getBoundingClientRect()
    const x = Math.max(0, Math.ceil(rect?.left ?? 0)),
      y = Math.max(0, Math.ceil(rect?.top ?? 0))
    const width = Math.floor(Math.min(rect?.right ?? 0, window.innerWidth) - x)
    const height = Math.floor(Math.min(rect?.bottom ?? 0, window.innerHeight) - y)
    const visible = width >= 100 && height >= 100 && document.visibilityState === 'visible'
    return {
      ownerId: ownerId.current,
      x: visible ? x : 0,
      y: visible ? y : 0,
      width: visible ? width : 100,
      height: visible ? height : 100,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      visible
    }
  }, [])
  useEffect(() => {
    const controllerId = ownerId.current
    const timer = setInterval(() => {
      if (attached.current)
        void ipcApi.request('yoyoking.native.sync', bounds()).catch((error) => {
          attached.current = false
          toast.error(String(error))
        })
    }, 750)
    return () => {
      clearInterval(timer)
      if (attached.current) void ipcApi.request('yoyoking.native.detach', { ownerId: controllerId }).catch(() => {})
    }
  }, [bounds])
  return (
    <section className="flex h-full min-h-96 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            void run(async () => setWindows(await ipcApi.request('yoyoking.native.list')))
          }}>
          {t('common.refresh')}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void run(() => ipcApi.request('yoyoking.native.launch'))
          }}>
          {t('common.open')}
        </Button>
        {windows.map((item) => (
          <Button
            key={String(item.hwnd)}
            variant={selected === String(item.hwnd) ? 'default' : 'outline'}
            onClick={() => setSelected(String(item.hwnd))}>
            {String(item.title)} · PID {String(item.pid)} · HWND {String(item.hwnd)}
          </Button>
        ))}
        <Button
          disabled={!selected}
          onClick={() => {
            void run(async () => {
              const state = await ipcApi.request('yoyoking.native.attach', { ...bounds(), hwnd: Number(selected) })
              attached.current = true
              setOutput(state)
            })
          }}>
          {t('yoyoking.attach')}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void run(async () => {
              const state = await ipcApi.request('yoyoking.native.detach', { ownerId: ownerId.current })
              attached.current = false
              setOutput(state)
            })
          }}>
          {t('yoyoking.detach')}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void run(async () => setOutput(await ipcApi.request('yoyoking.native.current_project')))
          }}>
          {t('yoyoking.current_project')}
        </Button>
      </div>
      <div
        ref={area}
        className="min-h-72 flex-1 rounded-md border border-border bg-background-subtle"
        data-testid="yoyoking-native-viewport"
      />
    </section>
  )
}
