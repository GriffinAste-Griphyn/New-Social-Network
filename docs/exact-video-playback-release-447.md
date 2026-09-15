# Exact video playback — 1.0.12 (447)

## Problem

Build 446's recent production events showed 240–480p first frames despite HD source metadata. Its upper bitrate/resolution preferences permitted HD but did not select an HD rendition. A completed preroll could therefore hand a low-resolution frame to the viewer. The newest eight-second upload had no playback events available during diagnosis, so the historical events were not presented as proof of that exact upload's playback.

## Changes

- New-build feed and story responses advertise `selection=exact-v1` on signed story-media URLs. The feed varies its cache by app build. Older builds retain their existing behavior.
- Authenticated `rendition=1080` / `rendition=720` requests return a single advertised video variant, selected by resolution, with its matching audio/subtitle groups and codecs. Media segments remain direct provider/CDN requests. Provider manifests have bounded size/time, same-origin HTTPS children, explicit errors, and no shared caching of signed playlists. Vercel HLS masters use the same selection after child signing.
- iOS prepares 1080p by default, including ordinary cellular connections; Low Data Mode/critical resource restrictions start at 720p. The viewer checks decoded dimensions and up to 750 ms of contiguous buffer before reveal. Smaller source dimensions and the end of short clips bound the requirement. A previously prepared adaptive player cannot bypass the gate when a refreshed source advertises exact selection.
- Exact startup preparation is bounded to 2.5 seconds at 1080p, then 2 seconds at 720p, followed by the existing adaptive recovery path. Pauses do not consume those budgets. Hidden playback cannot advance while the quality/buffer gate is unsatisfied. The adaptive fallback is preserved across subsequent retries.
- Quality changes preserve playback position. During a visible quality change the old player pauses/mutes and retains its decoded surface until the replacement frame is ready; completion/navigation releases it. This avoids jumping back to the opening thumbnail but can still hold a frame briefly while the replacement loads.
- One upward retry is allowed after 10 healthy playing seconds, with at least 12 seconds remaining and measured throughput of at least 12 Mbps. It applies to 720p or adaptive fallback on capable sources. Short clips avoid decoder churn. Fallback remains available if that upgrade fails.
- First-frame telemetry labels exact selections; quality changes use the existing quality-ramp event contract, without a database migration.

## Verification

- Backend: **397 passed, 0 failed, 9 database integration cases skipped** by the credential-isolated release runner. Tests include selection when bitrate ordering is misleading, landscape/smaller sources, audio/subtitles, malformed/foreign resources, actual route authentication, legacy redirects, explicit provider failure, and build-specific capability signing.
- iOS: **262 passed, 0 failed, 3 optional fixture cases skipped**. The new decoded-video test passed: a simulated playback failure retains the current frame/player and stopping the viewer releases both. Additional tests cover stale prepared-player rejection, authorization preservation, low-resolution/buffer rejection, short clips, bounded fallback, and recovery policy. Final run: `test_sim_2026-09-14T22-18-30-722Z_pid2475_f6bdf426.log`.
- Signed Release archive succeeded; strict deep code-signature verification passed. Native sources and the release snapshot were hash-checked.
- Read-only verification against the user's actual latest Stream asset decoded both selected streams: **1080×1920** and **720×1280**, both **8,008 ms**, both with audio. See `media-rendition-verification-447.json`. Temporary media/manifests were deleted by the probe.

These checks establish rendition selection, decoding and playback-state behavior. They do not establish visual parity with another app or quantify compression/HDR loss relative to the phone original. Throttled physical-device visual acceptance remains outstanding; no original-source comparison was possible from the available stored asset metadata.

## Deployment

Production deployment `dpl_7qCZGrkY9aAugd5XJva7fh1K8Brd`, `new-social-network-40g7aqb8i-griffin-astes-projects.vercel.app`, passed its build, source-clip rendition probe, and staged video/image health checks, then was promoted to `www.ubeye.ai`. No migration or re-upload of existing stories is required.

Persistent archive and release logs: `/Users/griffinaste/Library/Developer/UBEYE-Releases/447/`. TestFlight upload status is recorded below after the upload finishes.

Production video/image health checks returned 200 with all checks true after promotion.

App Store Connect accepted **1.0.12 (447)** on September 14, 2026 at **16:21:06 MDT**: “Uploaded package is processing”, “Upload succeeded”, and `EXPORT SUCCEEDED`. Apple processing/tester availability and installation on the physical phone are not yet confirmed.

## Public App Store submission

On September 14, 2026 at approximately **16:47 MDT**, App Store Connect confirmed **“1 Item Submitted”** for **1.0.12 (447)** and changed the version status to **Waiting for Review**. Build processing is complete. Submission ID: `8b6821bf-3f7d-467e-b2aa-a38759a4aae1`.

- Release mode: automatically after App Review approval, with the update released to all users immediately rather than phased over seven days.
- Distribution method: Public — discoverable by anyone on the App Store. Existing availability shows 148 available countries or regions and 27 marked Cannot Sell; availability settings were not changed.
- Existing screenshots, listing description, review sign-in information, and contact information were retained. Public release notes and review notes were updated for build 447.
- Public release notes: “This update improves story video quality and playback, photo and video uploads, and navigation between stories. It also includes performance improvements and reliability fixes.”

Apple approval and public availability of this version remain pending. [App Review submission](https://appstoreconnect.apple.com/apps/6768760562/distribution/reviewsubmissions/details/8b6821bf-3f7d-467e-b2aa-a38759a4aae1).
