// Generate reproducible fixtures for the actual iOS encoder quality audit.
// node scripts/media-upload-quality-fixtures.mjs /absolute/fixture/directory
import { spawn } from "node:child_process"
import { mkdir, writeFile, access } from "node:fs/promises"
import path from "node:path"
import ffmpeg from "ffmpeg-static"
const directory = process.argv[2]
if (!directory || !path.isAbsolute(directory)) throw Error("Supply an absolute fixture directory")
await mkdir(directory, { recursive: true })
const font = process.env.MEDIA_FIXTURE_FONT || '/System/Library/Fonts/SFNSMono.ttf'
await access(font)
const extended = new Set(['landscape', 'high-frame-rate', 'gradient', 'fine-text', 'slow-motion', 'hdr-pq'])
const fixtures = [
  ["motion", "testsrc2=size=1080x1920:rate=30"],
  ["detail", "nullsrc=size=1080x1920:rate=30,geq=lum='128+70*sin(X*2)*sin(Y*2)':cb=128:cr=128"],
  ["dark", "testsrc2=size=1080x1920:rate=30,lutyuv=y='val*0.12':u='128+(val-128)*0.3':v='128+(val-128)*0.3'"],
  ["landscape", "testsrc2=size=1920x1080:rate=30"],
  ["high-frame-rate", "testsrc2=size=720x1280:rate=60"],
  ["gradient", "gradients=size=1080x1920:rate=30:c0=black:c1=white"],
  ["fine-text", `color=c=black:size=1080x1920:rate=30,drawtext=fontfile='${font}':text='Small detail 0123456789 ABC abc':fontsize=24:fontcolor=white:x=20:y=200,drawgrid=width=27:height=27:thickness=1:color=white@0.2`],
  ["slow-motion", "testsrc2=size=720x1280:rate=120,setpts=4*PTS,fps=30"],
  ["hdr-pq", "gradients=size=1080x1920:rate=30:c0=black:c1=white,format=gbrpf32le,zscale=pin=bt709:tin=linear:min=gbr:p=bt2020:t=smpte2084:m=bt2020nc:npl=1000,format=yuv420p10le"],
  ["skin-palette", "color=c=0xb77d62:size=1080x1920:rate=30,drawbox=x=0:y=0:w=540:h=960:color=0xf2c5a6:t=fill,drawbox=x=540:y=960:w=540:h=960:color=0x654436:t=fill"],
]
for (const [name, filter] of fixtures) {
  const hdr = name === 'hdr-pq'
  const videoArguments = hdr ? ['-c:v', 'libx265', '-crf', '10', '-pix_fmt', 'yuv420p10le', '-x265-params', 'pools=1:frame-threads=1', '-tag:v', 'hvc1', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc'] : ['-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", filter,
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1.5", "-threads", "2", ...videoArguments,
      "-c:a", "aac", "-movflags", "+faststart", path.join(directory, `${extended.has(name) ? "reference" : "audit"}-${name}.mp4`)], { stdio: "inherit" })
    child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(Error(`Fixture ${name} failed: ${code}`)))
  })
  console.log(`Generated ${name}`)
}

await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version: 1, synthetic: true, fixtures: fixtures.map(([name]) => ({ file: `${extended.has(name) ? "reference" : "audit"}-${name}.mp4`, category: name })), requiredCameraAcceptance: ['consented moving faces', 'real HDR camera reference', 'camera slow-motion metadata', 'audio sync on a physical device'], limitations: 'Synthetic palette is not a real skin-tone/face quality test.' }, null, 2))
