import { application } from '@application'
import type { yoyokingRequestSchemas } from '@shared/ipc/schemas/yoyoking'
import type { IpcHandlersFor } from '@shared/ipc/types'

function owner(id: string | null) {
  const window = id ? application.get('WindowManager').getWindow(id) : undefined
  if (!window || window.isDestroyed()) throw new Error('The editing workbench requires a managed application window')
  return window
}
const service = () => application.get('YoyokingService')

export const yoyokingHandlers: IpcHandlersFor<typeof yoyokingRequestSchemas> = {
  'yoyoking.status': async () => service().status(),
  'yoyoking.configure': async (input, { senderId }) => {
    owner(senderId)
    await service().configure(input)
  },
  'yoyoking.setup': async (_input, { senderId }) => {
    owner(senderId)
    return service().setup()
  },
  'yoyoking.tool.call': async ({ name, args }, { senderId }) => {
    owner(senderId)
    return service().call(name, args, senderId!)
  },
  'yoyoking.preview.open': async ({ path }, { senderId }) => service().preview(path, owner(senderId)),
  'yoyoking.preview.release': async ({ id }, { senderId }) => service().releasePreview(id, owner(senderId)),
  'yoyoking.native.list': async (_input, { senderId }) => {
    owner(senderId)
    return service().nativeEditor().list()
  },
  'yoyoking.native.launch': async (_input, { senderId }) => {
    owner(senderId)
    await service().launchNative()
  },
  'yoyoking.native.attach': async (input, { senderId }) => {
    const window = owner(senderId),
      native = service().nativeEditor()
    return native.exclusive(() => native.attach(window, input.hwnd, input))
  },
  'yoyoking.native.sync': async (input, { senderId }) => {
    const window = owner(senderId),
      native = service().nativeEditor()
    return native.exclusive(() => native.sync(window, input))
  },
  'yoyoking.native.detach': async ({ ownerId }, { senderId }) => {
    const window = owner(senderId),
      native = service().nativeEditor()
    return native.exclusive(() => native.detach(window, false, ownerId))
  },
  'yoyoking.native.current_project': async (_input, { senderId }) => {
    owner(senderId)
    return service().currentProject()
  },
  'yoyoking.douyin.login': async (_input, { senderId }) => {
    owner(senderId)
    return service().login()
  },
  'yoyoking.douyin.disconnect': async (_input, { senderId }) => {
    owner(senderId)
    return service().disconnect()
  }
}
