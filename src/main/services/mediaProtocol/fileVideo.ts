import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { Readable } from 'node:stream'

import parseRange from 'range-parser'

export interface FileVideoEntry {
  path: string
  roots: string[]
  mimeType: string
  access: { webContentsId: number }
  lifetime: AbortController
}

export async function resolveVideoPath(path: string, roots: string[]): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Video path must be absolute')
  const canonical = await realpath(path)
  for (const directory of roots) {
    const root = await realpath(directory)
    const child = relative(root, canonical)
    if (child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)) return canonical
  }
  throw new Error('Video is outside the permitted media roots')
}

export async function serveFileVideo(request: Request, entry: FileVideoEntry): Promise<Response> {
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    const signal = AbortSignal.any([request.signal, entry.lifetime.signal])
    signal.throwIfAborted()
    const source = await resolveVideoPath(entry.path, entry.roots)
    file = await open(source, 'r')
    const info = await file.stat({ bigint: true })
    const checked = await resolveVideoPath(entry.path, entry.roots)
    const current = await stat(checked, { bigint: true })
    if (!info.isFile() || checked !== source || info.ino !== current.ino || info.dev !== current.dev)
      throw new Error('Video changed')
    const size = Number(info.size)
    if (!Number.isSafeInteger(size)) throw new Error('Video is too large')
    const headers = new Headers({
      'Content-Type': entry.mimeType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    })
    let start = 0,
      end = size - 1,
      status = 200
    const range = request.headers.get('Range')
    if (range && request.method === 'GET') {
      const ranges = parseRange(size, range, { combine: true })
      if (ranges === -1) {
        await file.close()
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' }
        })
      }
      if (Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1) {
        ;({ start, end } = ranges[0])
        status = 206
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
        headers.set('Content-Length', String(end - start + 1))
      }
    }
    if (request.method === 'HEAD' || size === 0) {
      await file.close()
      return new Response(null, { status, headers })
    }
    signal.throwIfAborted()
    const stream = file.createReadStream({ start, end, autoClose: true, signal })
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
  } catch {
    await file?.close().catch(() => {})
    return new Response('Video unavailable', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
}
