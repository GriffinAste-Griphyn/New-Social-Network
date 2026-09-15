# Story composer control cleanup — 1.0.12 (436)

## Changes

The phone task removed the Fit/Fill photo selector and the Start upload early toggle/helper text. Native photos retain the existing Fit default and video preview retains aspect-fit playback. Both web story forms explicitly use Fit for preview and submitted photo framing; browser image derivatives also use Fit. The unused web framing control and native reframing UI state were removed. Existing automatic private-upload behavior and saved early-upload preference remain unchanged; this request removes the control.

## Verification

- Final simulator check: **52 passed, 0 failed, 0 skipped** across selection, upload fast-path, durable submission, playback and UX suites. Result: /Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T16-02-27-932Z_pid51447_2936f41a.xcresult.
- **22 web image/upload tests passed** across three files. TypeScript, targeted component lint and git diff whitespace checks passed. Evidence: /tmp/ubeye-436-tests.log, /tmp/ubeye-436-types.log, /tmp/ubeye-436-lint.log.
- The previous phone-task native build was blocked by disk space. This verification reused the established native build cache successfully.
- All 59 native source/configuration inputs and 253 backend/component inputs are frozen in /tmp/ubeye-436-source-freeze.json and /tmp/ubeye-436-backend-freeze.json. The removed framing-control file is confirmed absent. Relative to release 435, native changes are confined to the composer and build configuration; backend implementation is unchanged apart from web composer components.

## Delivery

- Production deployment **dpl_FZhYuFnPQJ7BVsBcxPdQgNrd58Dr** is **READY** and serves www.ubeye.ai, ubeye.ai and new-social-network-nine.vercel.app. Deployment URL: new-social-network-g87c8p1b9-griffin-astes-projects.vercel.app. Target production; Next.js 16.2.6; remote build completed in 51 seconds. Log: /tmp/ubeye-436-deploy.log.
- General, video and image health checks returned 200 with ok=true. Mobile configuration remains 401 and admin media remains protected with 307. Deployment-scoped error/fatal counts were empty after deployment. Evidence: /tmp/ubeye-436-production-health.json.
- Signed archive **1.0.12 (436)** succeeded and passed embedded-version and strict deep code-signature verification. Archive: /tmp/ubeye-testflight-436/UBEYE.xcarchive. Log: /tmp/ubeye-testflight-436-archive.log. The only archive warning is the existing skipped App Intents metadata extraction because the app does not depend on AppIntents.framework.
- App Store Connect accepted **1.0.12 (436)** at **2026-09-14 16:07:44 UTC**, reporting **Uploaded package is processing**, **Upload succeeded** and **EXPORT SUCCEEDED**, with exit code 0. Upload log: /tmp/ubeye-testflight-436-upload.log. Tester availability has not been separately confirmed and depends on Apple processing.
- All 59 native and 253 backend/component frozen source inputs remained unchanged after production deployment, signed archive and TestFlight upload; the removed framing control remains absent. `git diff --check` passed. Existing working-tree changes were preserved; no Git commit or push was made.
