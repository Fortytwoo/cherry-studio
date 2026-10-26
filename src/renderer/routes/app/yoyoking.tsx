import { createFileRoute } from '@tanstack/react-router'

import YoyokingWorkbench from '@renderer/components/yoyoking/YoyokingWorkbench'

export const Route = createFileRoute('/app/yoyoking')({ component: YoyokingWorkbench })
