# Story media contract

This contract defines how story media is accepted, normalized, positioned, and displayed on iOS and web.

## Canonical canvas

- Aspect ratio: `9:16`
- Playback derivative: `1080 × 1920`
- Thumbnail derivative: `360 × 640`
- The iOS viewer canvas extends to the top of the screen while retaining the bottom edge of the fitted `9:16` canvas, leaving room for bottom controls. Composer and web story frames remain `9:16`.
- Portrait, square, and landscape assets use the same canvas placement.
- Viewer chrome may reduce the fitted canvas size. Extending the iOS viewing area upward must not move its bottom edge into the controls.
- Text, link, and quote overlays use percentage coordinates relative to this canvas, not the device screen.

## Framing

- Photo upload defaults to Fit: preserve the entire source with centered black padding.
- Creators may explicitly choose Fill to center-crop a photo to the same `9:16` canvas. The preview and exported photo use the same framing.
- iOS retains an orientation-normalized source during editing so switching from Fill back to Fit restores the whole photo, including for batch uploads.
- Space not occupied by fitted media is rendered black on both iOS and web. Transparency in source photos may be preserved, with black behind the playback canvas.
- Photo playback never adds a blurred background. The iOS viewer uses proportional fill for its extended viewing area; composer and web playback retain the exported framing.
- Feed, discovery, and profile thumbnails may still use a separate cover crop; that crop is never used as story playback media.
- Video upload preserves the source aspect ratio. On iOS, story-shaped portrait playback (width/height at most `9/16 + 0.01`) uses proportional fill in the extended viewer area. Horizontal, square, wider portrait, and unknown-dimension video use Fit with centered black padding, preserving the full source. The active playback rendition determines framing, including during processing. Its loading poster uses the same framing as playback. Web video remains Fit.

## Inputs and delivery

| Asset | Accepted input | Source limit | Duration | Delivery |
| --- | --- | ---: | ---: | --- |
| Image | JPG, PNG, WebP | 25 MB | — | AVIF or WebP display derivative; WebP thumbnail |
| Video | MP4, MOV, WebM | 512 MB | 120 seconds | Versioned Vercel Blob CMAF HLS with generated poster |

iOS may accept camera-roll formats such as HEIC because it normalizes unsupported source images to JPEG before upload. The server only accepts the normalized input types listed above.

Image display derivatives use the highest AVIF or WebP quality that fits a `1.5 MB`
budget. Thumbnail derivatives use the highest configured WebP quality that fits a
`150 KB` budget. Web playback requests story images from Next.js at quality `85`.

## Derived surfaces

- Composers and web viewers use the canonical canvas. The iOS viewer extends upward and selects video framing from playback dimensions; this does not crop or rewrite the uploaded video.
- Feed, discovery, and profile tiles use their own cover crops from the story thumbnail.
- A tile crop never changes the canonical story asset or its overlay coordinates.

## Source of truth

- Web dimensions and upload limits: `lib/story-media-contract.ts`
- iOS dimensions, upload limits, and quality ladders:
  `apps/ios/UBEYE/Features/Stories/StoryMediaCanvas.swift`

Any change to this contract must update both sources of truth and their focused tests in the same change.

## Playable and HD readiness

Cloudflare Stream publication uses its `ready` state plus `readyToStream` when `MEDIA_EARLY_VIDEO_PUBLICATION_ENABLED=true`. Moderation approval, structural scan approval, expiry, and deletion checks still gate visibility. `processingStatus=ready` means playable; `fullQualityReady` additionally requires the actual provider completion to reach 100%. Provider completion is never inferred from playable availability. Recovery continues checking playable videos whose HD encoding is unfinished. Set the publication flag to `false` to restore the full-encoding gate for future publications.

Compatible iOS video inputs pass through or remux without recompression. Inputs requiring a lossy export use an 8.2 Mbps total size hint, bounded by the upload byte limit, with cancellation and a three-minute deadline per export. The hint is not a strict achieved bitrate or file-size guarantee. Imported HDR remains source content; Cloudflare delivery converts it to SDR.
