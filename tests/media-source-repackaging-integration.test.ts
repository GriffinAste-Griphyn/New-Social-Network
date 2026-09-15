import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { afterEach, expect, it, vi } from "vitest"
import { encodeMediaRenditionFile, inspectMediaFile, mediaBinaryPaths } from "@/lib/media-pipeline/ffmpeg"
import { mediaRenditionProfiles } from "@/lib/media-pipeline/contracts"
import { canRepackageSourceVideo } from "@/lib/media-pipeline/source-repackaging"

const run=promisify(execFile)
afterEach(()=>vi.unstubAllEnvs())
it("repackages a real H.264 fixture with every decoded frame unchanged",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"ubeye-repackage-"))
  try {
    const {ffmpeg}=mediaBinaryPaths()
    const source=path.join(root,"source.mp4"), outputDirectory=path.join(root,"hls")
    await mkdir(outputDirectory)
    await run(ffmpeg,["-hide_banner","-loglevel","error","-y","-f","lavfi","-i","testsrc2=size=360x640:rate=30",
      "-t","4","-c:v","libx264","-profile:v","high","-level:v","4.1","-crf","30","-pix_fmt","yuv420p",
      "-color_primaries","bt709","-color_trc","bt709","-colorspace","bt709","-g","60","-keyint_min","60",
      "-sc_threshold","0","-movflags","+faststart",source])
    const metadata=await inspectMediaFile(source)
    expect(canRepackageSourceVideo(metadata,mediaRenditionProfiles[0]), JSON.stringify(metadata)).toBe(true)
    const encoded=await encodeMediaRenditionFile({inputPath:source,outputDirectory,sourceMetadata:metadata,profile:mediaRenditionProfiles[0]})
    expect(encoded.repackaged).toBe(true)
    const hashes=async(input:string)=>{
      const {stdout}=await run(ffmpeg,["-hide_banner","-loglevel","error","-i",input,"-map","0:v:0","-f","framemd5","-"])
      return stdout.split("\n").filter(line=>line && !line.startsWith("#")).map(line=>line.split(",").at(-1)?.trim())
    }
    const original=await hashes(source), candidate=await hashes(path.join(outputDirectory,"index.m3u8"))
    expect(original).toHaveLength(120)
    expect(candidate).toEqual(original)
  } finally {await rm(root,{recursive:true,force:true})}
},30000)
