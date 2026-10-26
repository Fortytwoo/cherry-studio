import { mkdtemp, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type FileVideoEntry, resolveVideoPath, serveFileVideo } from '../fileVideo'

describe('file video authorization and byte-range contract', () => {
  let directory: string, entry: FileVideoEntry
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'yoyoking-video-'))
    const path = join(directory, 'video.mp4')
    await writeFile(path, Buffer.from([0, 1, 2, 3, 4, 5]))
    entry = {
      path,
      roots: [directory],
      mimeType: 'video/mp4',
      access: { webContentsId: 1 },
      lifetime: new AbortController()
    }
  })
  afterEach(async () => {
    entry.lifetime.abort()
    await rm(directory, { recursive: true, force: true })
  })

  it('serves exact seek ranges, suffixes, HEAD and unsatisfied ranges', async () => {
    for (const [range, bytes, expected] of [
      ['bytes=1-3', [1, 2, 3], 'bytes 1-3/6'],
      ['bytes=-2', [4, 5], 'bytes 4-5/6'],
      ['bytes=4-', [4, 5], 'bytes 4-5/6']
    ] as const) {
      const response = await serveFileVideo(
        new Request('cherry-media://video/test', { headers: { Range: range } }),
        entry
      )
      expect(response.status).toBe(206)
      expect(response.headers.get('Content-Range')).toBe(expected)
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(bytes)
    }
    const head = await serveFileVideo(new Request('cherry-media://video/test', { method: 'HEAD' }), entry)
    expect(head.headers.get('Content-Length')).toBe('6')
    expect(await head.text()).toBe('')
    const invalid = await serveFileVideo(
      new Request('cherry-media://video/test', { headers: { Range: 'bytes=99-' } }),
      entry
    )
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('Content-Range')).toBe('bytes */6')
  })

  it('reads a bounded range of a sparse large file without transferring its entire content', async () => {
    const file = await open(entry.path, 'r+')
    await file.truncate(1024 * 1024 * 1024)
    await file.close()
    const response = await serveFileVideo(
      new Request('cherry-media://video/test', { headers: { Range: 'bytes=0-5' } }),
      entry
    )
    expect(response.headers.get('Content-Range')).toBe('bytes 0-5/1073741824')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('rejects sibling-prefix and directory-link escapes on each request', async () => {
    const permitted = join(directory, 'allowed')
    const outside = join(directory, 'allowed-other')
    await mkdir(permitted)
    await mkdir(outside)
    await writeFile(join(outside, 'private.mp4'), 'private')
    await symlink(outside, join(permitted, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(resolveVideoPath(join(outside, 'private.mp4'), [permitted])).rejects.toThrow('outside')
    entry.roots = [permitted]
    entry.path = join(permitted, 'link/private.mp4')
    expect((await serveFileVideo(new Request('cherry-media://video/test'), entry)).status).toBe(404)
  })

  it('revokes new reads when the owning preview is released', async () => {
    entry.lifetime.abort()
    const response = await serveFileVideo(new Request('cherry-media://video/test'), entry)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('0,1,2')
  })
})
