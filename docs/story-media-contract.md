# Story media contract

This contract defines how story media is accepted, normalized, positioned, and displayed on iOS and web.

## Canonical canvas

- Aspect ratio: `9:16`
- Playback derivative: `1080 × 1920`
- Thumbnail derivative: `360 × 640`
- The iOS viewer canvas is centered horizontally and vertically on the full screen, regardless of source orientation or missing legacy dimensions. Web story frames remain `9:16` within their page layouts.
- Portrait, square, and landscape assets use the same canvas placement.
- Viewer chrome may reduce the canvas size to fit, but it must not change its aspect ratio or screen-centered placement.
- Text, link, and quote overlays use percentage coordinates relative to this canvas, not the device screen.

## Framing

- Photo upload defaults to Fit: preserve the entire source with centered black padding.
- Creators may explicitly choose Fill to center-crop a photo to the same `9:16` canvas. The preview and exported photo use the same framing.
- iOS retains an orientation-normalized source during editing so switching from Fill back to Fit restores the whole photo, including for batch uploads.
- Space not occupied by fitted media is rendered black on both iOS and web. Transparency in source photos may be preserved, with black behind the playback canvas.
- Photo playback never adds a blurred background or applies an additional crop after export.
- Feed, discovery, and profile thumbnails may still use a separate cover crop; that crop is never used as story playback media.
- Video normalization and playback are always aspect-fit with centered black padding, preserving the full source. Its generated poster is used only while the first video frame is loading.

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

- Full story viewers and composers use the canonical canvas. Video remains Fit with centered black padding; Fill is a photo-only editing choice.
- Feed, discovery, and profile tiles use their own cover crops from the story thumbnail.
- A tile crop never changes the canonical story asset or its overlay coordinates.

## Source of truth

- Web dimensions and upload limits: `lib/story-media-contract.ts`
- iOS dimensions, upload limits, and quality ladders:
  `apps/ios/UBEYE/Features/Stories/StoryMediaCanvas.swift`

Any change to this contract must update both sources of truth and their focused tests in the same change.
