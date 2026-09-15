# Media upload release 425

## Behavior

Video preparation begins locally when a draft selects a video. A bounded selection of up to ten items prepares serially, coalescing in-flight work with Post. Inspection and normalization retain the existing quality, geometry, duration, and size rules. Clean first-frame JPEG generation and SHA-256 hashing happen before Post where editing time permits. Source identity, source kind, duration limit, byte size, and modification time invalidate stale results. The prepared file is checked again before reuse. Failed speculative preparation can be attempted again when posting. Selection changes cancel abandoned preparation and remove only generated files owned by that preparation. Critical resource mode defers speculative preparation until posting.

Images already normalize during selection and reframing; they now retain the checksum of the exact normalized bytes. Reframing computes a new checksum. Pending manifests persist optional prepared checksums and file fingerprints for images and videos; older manifests decode without those fields and use the existing hash path. Modification timestamps encode numerically to preserve subsecond precision across the manifest's ISO-8601 date encoding. A changed staged file is hashed again. No upload lease or media upload starts before Post.

Pending video staging uses a hard link when supported, with a physical-copy fallback. Removing the composer's source does not remove the pending video. The upload store rejects duplicate simultaneous work for the same pending ID.

Uploads hold a reference-counted bandwidth priority scope through completion, releasing it on success or failure. The scope pauses queued image preheats, cancels speculative image/video/HLS downloads and player construction, and retains completed players within the current budget. Displayed images retain their own load consumers; visible-screen thumbnail preparation owns a separate real load consumer. Visible playback and acquiring players continue. Upload completion resumes image work and the current viewer or initial feed player intent. Memory cleanup removes remembered feed sources.

## Resumable transfer

Each TUS PATCH contains a bounded, exact file range. Standard connections default to 50 MiB; limited/cellular connections cap at 5 MiB. The configured size is clamped to 5–200 MiB and aligned to 256 KiB; only the final remaining range can be smaller. A full-file hard link is used only when the entire file actually fits that request. Range copies use bounded buffers.

The background URLSession delegate validates the acknowledged offset and stages/enqueues the next PATCH before releasing the system background-event completion callback. It keeps a single PATCH active per upload URL; the caller does not need to wake between successful chunks. Failed transfer attempts recover the provider's current HEAD offset, including partial acceptance. Cancellation cancels the active URLSession task, prevents further chunks, and avoids the ordinary retry loop. Disposable request bodies are removed; pending originals remain durable. After process relaunch, orphaned transport work is canceled and the existing durable manifest recovery resumes from the server offset.

This delegate behavior is regression-tested with URLSession delegate callbacks. Actual operating-system suspension/relaunch and upload throughput on Wi-Fi/cellular still need confirmation on physical devices; simulator callback tests cannot establish those real-device results.

## Backend finalization

The mobile completion route still performs authentication, rate limiting, the owner-bound completion claim, and duplicate detection before provider work. Poster integrity verification and Cloudflare status reads now overlap. Provider errors remain durably recorded before completion releases the upload for recovery. On a healthy status, status persistence and default thumbnail configuration overlap; each remains awaited before story completion. Existing moderation, publication, source validation, and session completion rules are retained. Structured `complete_phase` timings separate poster verification, provider status, status persistence, and thumbnail configuration for production profiling. The private Vercel HLS processing path retains its source checks and processing dispatch.

Media config version is `2026-09-13.5`. No hosting or storage provider migration is required.

## Verification and delivery

285 backend tests pass across 62 files. The final selected iOS run passes 166 tests with no build warnings, covering upload range contents, delegate continuation, partial-offset retries, cancellation, durable staging, preparation reuse and invalidation, fingerprint precision, visible thumbnails during uploads, and existing media/player/geometry/runtime behavior. The optional source-quality export audit passed in an earlier selected run and was excluded from the final repeated regression run. TypeScript, targeted ESLint, and diff checks pass.

The signed archive confirms version **1.0.12, build 425**. Signature verification passed. App Store Connect accepted the upload at **2026-09-13 22:02:22 UTC**, reporting `Uploaded package is processing`, `Upload succeeded`, and `EXPORT SUCCEEDED`. Apple processing and tester availability have not yet been confirmed. The archive is `/tmp/ubeye-testflight-425/UBEYE.xcarchive`; logs are `/tmp/ubeye-testflight-425-archive.log` and `/tmp/ubeye-testflight-425-upload.log`. Release archive metadata extraction reports the existing notice that no AppIntents framework dependency was found.

Production deployment `dpl_7uACjuHPt5Y46FApGyyRzDE5WDig` is READY and serves https://www.ubeye.ai. App, video, and image health checks returned 200/ok; signed Cloudflare Stream playback and the R2 bucket API probe passed. Anonymous admin access redirects to login, and the media-config and media-operations cron endpoints return 401 without authentication. Initial error/fatal runtime log counts for this deployment were empty. These checks completed at 2026-09-13 22:03 UTC. The production media config version environment setting was updated to `2026-09-13.5` before deployment. No database migration or separate storage-provider deployment was needed.
