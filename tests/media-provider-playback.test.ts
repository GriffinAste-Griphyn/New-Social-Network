import { afterEach, describe, expect, it, vi } from "vitest"
import { selectVerifiedPlaybackVariant, verifyProviderPlayback, isVerifiedProviderPlayback } from "@/lib/media-provider-playback"
import { isCloudflareStreamPublicationReady, isCloudflareStreamFullyReady, mergeCloudflareStreamProviderDetails } from "@/lib/media-upload-sessions"

const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.640029,mp4a.40.2",RESOLUTION=360x640\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.640029,mp4a.40.2",RESOLUTION=1080x1920\nhigh.m3u8\n'
const playlist = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2.0,\nfirst.m4s\n#EXT-X-ENDLIST\n'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe("verified first playback publication", () => {
  function responses(high = playlist, headStatus = 200, inputMaster = master) {
    const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
      if (options?.method === "HEAD") return new Response(null, {status:headStatus})
      return new Response(input.endsWith("video.m3u8") ? inputMaster : high)
    })
    vi.stubGlobal("fetch", fetcher)
    return fetcher
  }
  it("waits for a source-appropriate resolution and known playback codecs", () => {
    expect(selectVerifiedPlaybackVariant(master,1080,1920)).toMatchObject({width:1080,height:1920,uri:"high.m3u8"})
    expect(selectVerifiedPlaybackVariant(master.split('#EXT-X-STREAM-INF:BANDWIDTH=6000000')[0],1080,1920)).toBeNull()
    expect(selectVerifiedPlaybackVariant(master.replaceAll("avc1.640029","hvc1.1.6.L120.90"),1080,1920)).toBeNull()
    expect(selectVerifiedPlaybackVariant(master,0,1920)).toBeNull()
  })
  it("checks initialization and first segment availability without downloading video", async () => {
    const fetcher = responses()
    const proof = await verifyProviderPlayback("https://customer.invalid/token/manifest/video.m3u8",1080,1920)
    expect(proof).toMatchObject({width:1080,height:1920,inputWidth:1080,inputHeight:1920})
    expect(fetcher.mock.calls.filter(([,options])=>options?.method === "HEAD")).toHaveLength(2)
    expect(isVerifiedProviderPlayback({width:1080,height:1920,verifiedPlayback:proof!})).toBe(true)
    expect(isVerifiedProviderPlayback({width:720,height:1280,verifiedPlayback:proof!})).toBe(false)
  })
  it.each([playlist.replace('#EXT-X-ENDLIST',''),playlist.replace('#EXTINF:2.0,','#EXTINF:0,'),playlist+'#EXT-X-GAP',playlist+'#EXT-X-KEY:METHOD=AES-128'])
    ("retains the full-ready gate for incomplete playback %s",async high=>{
      responses(high)
      expect(await verifyProviderPlayback("https://customer.invalid/video.m3u8",1080,1920)).toBeNull()
    })
  it("checks separately advertised audio before granting readiness",async()=>{
    const audioMaster = master.replace('RESOLUTION=1080x1920', 'RESOLUTION=1080x1920,AUDIO="audio"') +
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n'
    const fetcher=responses(playlist,200,audioMaster)
    expect(await verifyProviderPlayback("https://customer.invalid/video.m3u8",1080,1920)).not.toBeNull()
    expect(fetcher.mock.calls.some(([url])=>url.endsWith("audio.m3u8"))).toBe(true)
    responses(playlist,200,audioMaster.replace('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n',''))
    expect(await verifyProviderPlayback("https://customer.invalid/video.m3u8",1080,1920)).toBeNull()
  })
  it("rejects unavailable first media segments",async()=>{
    responses(playlist,404)
    expect(await verifyProviderPlayback("https://customer.invalid/video.m3u8",1080,1920)).toBeNull()
  })
  it("cannot follow a playlist reference to another host",async()=>{
    const fetcher = responses(playlist,200,master.replace("high.m3u8","https://other.invalid/private"))
    expect(await verifyProviderPlayback("https://customer.invalid/video.m3u8",1080,1920)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("caps playlist verification memory",async()=>{
    responses(playlist,200,"#EXTM3U\n"+"a".repeat(65536))
    expect(await verifyProviderPlayback("https://customer.invalid/video.m3u8",1080,1920)).toBeNull()
  })
  it("retains proof through provider polling without conflating full quality",()=>{
    const proof={inputWidth:1080,inputHeight:1920,width:1080,height:1920,verifiedAt:new Date().toISOString()}
    const details={readyToStream:true,state:"ready",pctComplete:80,errorReason:null,byteSize:1,durationMs:1000,width:1080,height:1920,verifiedPlayback:proof}
    const merged=mergeCloudflareStreamProviderDetails(details,{...details,verifiedPlayback:undefined,pctComplete:90})
    expect(merged.verifiedPlayback).toEqual(proof)
    expect(isCloudflareStreamPublicationReady(merged)).toBe(true)
    expect(isCloudflareStreamFullyReady(merged)).toBe(false)
    vi.stubEnv("MEDIA_VERIFIED_PLAYBACK_PUBLICATION_ENABLED","false")
    expect(isCloudflareStreamPublicationReady(merged)).toBe(false)
  })
})
