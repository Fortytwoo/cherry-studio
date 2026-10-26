import * as z from 'zod'

export const YoyokingSettingsSchema = z.object({
  mediaRoots: z.array(z.string().min(1)).max(30).default([]),
  jianyingExecutable: z.string().default(''),
  jianyingRuntime: z.string().default(''),
  douyinSdkDirectory: z.string().default(''),
  douyinEnabled: z.boolean().default(true)
})
export type YoyokingSettings = z.infer<typeof YoyokingSettingsSchema>

export const NativeViewportSchema = z.object({
  ownerId: z.uuid(),
  x: z.number().int().min(0).max(10000),
  y: z.number().int().min(0).max(10000),
  width: z.number().int().min(100).max(10000),
  height: z.number().int().min(100).max(10000),
  viewportWidth: z.number().int().min(100).max(10000),
  viewportHeight: z.number().int().min(100).max(10000),
  visible: z.boolean()
})
export type NativeViewport = z.infer<typeof NativeViewportSchema>

export interface YoyokingStatus {
  settings: YoyokingSettings
  workspace: string
  editServerId: string | null
  agentId: string | null
  toolNames: string[]
  skillNames: string[]
  douyin: Record<string, unknown>
}
