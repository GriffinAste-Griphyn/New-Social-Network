# Thumbnail/overlay handoff — 1.0.12 (446)

## Cause and fix

`CachedAsyncImage` used `StableImageLoader.displayedImage` as a fallback even after the view's requested URL changed. The home cards updated text overlays independently. While the new image was loading, the old thumbnail could therefore appear with the new story's text. Clearing state only inside `.task(id:)` would still leave the render before the task begins vulnerable.

The loader now publishes its URL and image together and provides a URL-matched presentation accessor. The image view never presents the retained image for another URL, including before the replacement task starts or after a failed download. Existing generation/cancellation guards still reject late completions.

Home and Following story cards render their gradient and story overlay inside the successfully loaded image content. During a miss they show the existing placeholder, then reveal the new media and text together. My Story derives thumbnail text from the same last item used to select its thumbnail; absent item text does not inherit stale summary text.

This is an iOS-only presentation fix. No backend changes or migration are required. Existing uploaded assets and overlay records are unchanged.

## Verification

Regression coverage includes the synchronous render before a new URL's task starts, delayed replacement, failed replacement, stale completions, missing-media clearing, partial My Story summaries, and a rendered My Story placeholder with and without new overlay text. Test/build/distribution outcomes are recorded after completion below.

- Complete iOS suite: **257 passed, zero failed, three optional fixture cases skipped**. The rendered-placeholder regression passed, as did delayed/failed loading, partial summary pairing, and stale completion cases.
- Result bundle: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T21-35-51-313Z_pid2475_04d77e3a.xcresult`.
- Native sources frozen at `/tmp/ubeye-446-release/apps/ios`; 89-file hash manifest `/tmp/ubeye-446-native-manifest.json`.

## Distribution

Signed Release archive succeeded; strict deep signature verification passed and all 89 source hashes matched the working tree. Persistent archive: `/Users/griffinaste/Library/Developer/UBEYE-Releases/446/UBEYE.xcarchive`.

App Store Connect accepted **1.0.12 (446)** on September 14, 2026 at **15:39:25 MDT**: “Uploaded package is processing”, “Upload succeeded”, and `EXPORT SUCCEEDED`. Apple processing/tester availability is not yet confirmed. Upload log: `/Users/griffinaste/Library/Developer/UBEYE-Releases/446/testflight-upload.log`.

No backend redeployment was necessary; production remains on release 445's verified backend deployment.
