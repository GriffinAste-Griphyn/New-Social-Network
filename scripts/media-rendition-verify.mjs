// Read-only release check against an explicitly selected existing Stream asset.
// Reports decoded dimensions, duration and audio. Never logs signed URLs.
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as storageModule from '../lib/story-storage.ts'
import * as renditionModule from '../lib/story-media/renditions.ts'
import * as encoderModule from '../lib/media-pipeline/ffmpeg.ts'
const storage = storageModule.default ?? storageModule
const rendition = renditionModule.default ?? renditionModule
const encoder = encoderModule.default ?? encoderModule
const uid = process.env.MEDIA_RELEASE_STORY_UID
if (!/^[a-f0-9]{32}$/.test(uid ?? '')) throw Error('Explicit Stream asset ID required')
const directory = await mkdtemp(path.join(tmpdir(), 'ubeye-exact-rendition-'))
try {
  const url = await storage.createCloudflareStreamPlaybackUrl(uid)
  const master = await rendition.fetchStoryMaster(url)
  const reports = []
  for (const target of [1080, 720]) {
    const selected = rendition.selectStoryRendition(master, url, target)
    const manifest = path.join(directory, `${target}.m3u8`)
    const output = path.join(directory, `${target}.mp4`)
    await writeFile(manifest, selected.playlist, { mode: 0o600 })
    await new Promise((resolve, reject) => {
      const child = spawn(encoder.mediaBinaryPaths().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-i', manifest, '-t', '120', '-c', 'copy', output],
        { stdio: ['ignore', 'ignore', 'ignore'] })
      const timer = setTimeout(() => child.kill('SIGKILL'), 60000)
      child.once('error', () => { clearTimeout(timer); reject(Error('Rendition verification could not start')) })
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Rendition download failed')) })
    })
    const actual = await encoder.inspectMediaFile(output)
    if (actual.width !== selected.width || actual.height !== selected.height || !actual.hasAudio) {
      throw Error('Selected rendition dimensions or audio failed verification')
    }
    reports.push({ target, selectedWidth: selected.width, selectedHeight: selected.height,
      actualWidth: actual.width, actualHeight: actual.height, durationMs: actual.durationMs, audio: actual.hasAudio })
  }
  console.log('MEDIA_EXACT_RENDITION_REPORT=' + JSON.stringify({ assetId: uid, reports }))
} finally { await rm(directory, { recursive: true, force: true }) }
