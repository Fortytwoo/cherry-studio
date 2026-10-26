import * as z from 'zod'

import { NativeViewportSchema, YoyokingSettingsSchema, type YoyokingStatus } from '@shared/types/yoyoking'

import { defineRoute } from '../define'

const object = z.record(z.string(), z.unknown())
export const yoyokingRequestSchemas = {
  'yoyoking.status': defineRoute({ input: z.void(), output: z.custom<YoyokingStatus>() }),
  'yoyoking.configure': defineRoute({ input: YoyokingSettingsSchema, output: z.void() }),
  'yoyoking.setup': defineRoute({ input: z.void(), output: z.custom<YoyokingStatus>() }),
  'yoyoking.tool.call': defineRoute({
    input: z.object({ name: z.string().min(1), args: object.default({}) }),
    output: z.unknown()
  }),
  'yoyoking.preview.open': defineRoute({
    input: z.object({ path: z.string().min(1) }),
    output: z.object({ id: z.string(), url: z.string() })
  }),
  'yoyoking.preview.release': defineRoute({ input: z.object({ id: z.string() }), output: z.void() }),
  'yoyoking.native.list': defineRoute({ input: z.void(), output: z.array(object) }),
  'yoyoking.native.launch': defineRoute({ input: z.void(), output: z.void() }),
  'yoyoking.native.attach': defineRoute({
    input: NativeViewportSchema.extend({ hwnd: z.number().int().positive() }),
    output: object
  }),
  'yoyoking.native.sync': defineRoute({ input: NativeViewportSchema, output: object }),
  'yoyoking.native.detach': defineRoute({ input: z.object({ ownerId: z.uuid() }), output: object }),
  'yoyoking.native.current_project': defineRoute({ input: z.void(), output: object }),
  'yoyoking.douyin.login': defineRoute({ input: z.void(), output: object }),
  'yoyoking.douyin.disconnect': defineRoute({ input: z.void(), output: object })
}
