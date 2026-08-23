# Story media contract

This contract defines how story media is accepted, normalized, positioned, and displayed on iOS and web.

## Canonical canvas

- Aspect ratio: `9:16`
- Playback derivative: `1080 × 1920`
- Thumbnail derivative: `360 × 640`
- The canvas is centered horizontally and anchored to the top of the usable viewer region.
- A vertical `9:16` asset fills that canvas from its top edge; it must not be pushed down to center the canvas vertically.
- Viewer chrome may reserve space below the canvas, but it must not change the canvas aspect ratio.
- Text, link, and quote overlays use percentage coordinates relative to this canvas, not the device screen.

## Framing

- `Fit` is the default. It preserves the entire source asset.
- Space not occupied by fitted media is filled by a cover-scaled, blurred copy of the same asset with a dark overlay.
- The blurred extension is clipped to the `9:16` canvas. Space outside the canvas is black.
- `Fill` is an explicit photo option. It center-crops the source to the canvas.
- Video playback always preserves the full source. A blurred thumbnail or generated poster fills the canvas behind it.

## Inputs and delivery

| Asset | Accepted input | Source limit | Duration | Delivery |
| --- | --- | ---: | ---: | --- |
| Image | JPG, PNG, WebP | 25 MB | — | AVIF or WebP display derivative; WebP thumbnail |
| Video | MP4, MOV, WebM | 512 MB | 120 seconds | Cloudflare Stream adaptive playback and thumbnail |

iOS may accept camera-roll formats such as HEIC because it normalizes unsupported source images to JPEG before upload. The server only accepts the normalized input types listed above.

Image display derivatives use the highest AVIF or WebP quality that fits a `1.5 MB`
budget. Thumbnail derivatives use the highest configured WebP quality that fits a
`150 KB` budget. Web playback requests story images from Next.js at quality `85`.

## Derived surfaces

- Full story viewers and composers use the canonical canvas.
- Feed, discovery, and profile tiles use their own cover crops from the story thumbnail.
- A tile crop never changes the canonical story asset or its overlay coordinates.

## Source of truth

- Web dimensions and upload limits: `lib/story-media-contract.ts`
- iOS dimensions, upload limits, and quality ladders:
  `apps/ios/UBEYE/Features/Stories/StoryMediaCanvas.swift`

Any change to this contract must update both sources of truth and their focused tests in the same change.
