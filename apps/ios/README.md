# UBEYE iOS

Native Swift iOS client for the existing UBEYE backend.

This is the active production mobile client. The backend, database, Stripe,
story media, and web/admin app remain in the root Next.js project.

## Generate the Xcode project

```bash
cd apps/ios
xcodegen generate
open UBEYE.xcodeproj
```

## API base URL

The default local API URL is `http://127.0.0.1:3000`. Change it in the in-app
Settings screen for device testing or production, for example:

```text
https://www.ubeye.ai
```

## Current native scope

- SwiftUI app shell and tabs
- Keychain-backed auth session
- Mobile API client with device ID and bearer token headers
- Login, signup, email verification check, and profile completion
- Feed, following, discover, profile, creator stats, and payout status screens
- Story stack viewer with image/video playback, replies, reactions, impressions,
  report, block, and owner delete actions
- Camera/photo-library story composer with still photo capture and video recording
- Image multipart upload to `/api/mobile/stories`
- Cloudflare Stream form and TUS video upload handoff through
  `/api/mobile/stories/video-upload` and `/api/mobile/stories/video-complete`
- Profile photo upload and account deletion
- App icon, camera/microphone/photo usage strings, portrait-only iPhone config,
  and non-exempt-encryption metadata

## Build verification

```bash
npm run ios:generate
npm run ios:build:debug
npm run ios:build:release
```

## TestFlight deployment checklist

1. Open `UBEYE.xcodeproj`.
2. Select the `UBEYE` target and set your Apple development team.
3. Confirm bundle ID `com.griffinaste.ubeye` matches App Store Connect.
4. Set the App Store Connect support/reviewer contact email to
   `griffin@ubeye.ai`.
5. Configure APNs backend credentials for the same bundle ID:
   - `APNS_KEY_ID`
   - `APNS_TEAM_ID`
   - `APNS_BUNDLE_ID`
   - `APNS_PRIVATE_KEY`
   - `APNS_ENVIRONMENT`
6. Confirm production backend integrations are configured:
   - `NEXT_PUBLIC_APP_URL=https://www.ubeye.ai`
   - production database migrations applied
   - Vercel Blob story image storage
   - Cloudflare Stream video upload and webhook processing
   - Stripe webhook delivery for payout status
   - seeded reviewer demo account with visible story content
7. Set the in-app API base URL to `https://www.ubeye.ai` before production QA.
8. Run on a physical iPhone and test:
   - signup, email verification, login, sign out, session restore
   - user-initiated APNs permission prompt, token registration, and delivered notifications
   - feed load, story stack playback, reactions, replies, reports, blocks
   - image post, recorded video post, picked video post, processing completion
   - profile avatar upload, support contact, Stripe payout status, account deletion
9. Archive with Xcode Product > Archive and distribute to TestFlight.

## Known backend alignment note

The mobile push-token endpoint accepts APNs device tokens for this native app.
Native APNs delivery is implemented on the backend when the APNs environment
variables above are configured. Legacy Expo-token compatibility remains in the
backend for existing installs, but the Expo app is no longer part of the active
mobile client.
