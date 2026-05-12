# Mobile App

Native mobile app scaffold for the social network, built with Expo and Expo Router.

## Run

```bash
cd apps/mobile
npm run start
```

Platform shortcuts:

```bash
npm run ios
npm run android
npm run web
```

From the repo root:

```bash
npm run mobile:start
npm run mobile:ios
npm run mobile:android
npm run mobile:web
```

## Current state

- `app/(tabs)/index.tsx` is the native story-home screen.
- `following`, `discover`, `post`, and `profile` are separate native tabs.
- UI is native React Native, not shared DOM with the web app.
- Shared contracts live in `packages/shared/`.
- Mobile auth calls the Next backend for signup, Resend email verification checks, and profile setup.

## TestFlight builds

`eas.json` defines development, preview, and production build profiles. EAS builds use `https://www.ubeye.ai` for `EXPO_PUBLIC_API_URL`; local Expo Go development can still use `.env.local`.

Before the first TestFlight submit, create the iOS app record in App Store Connect for bundle ID `com.griffinaste.ubeye`, then add the app's Apple ID as `submit.production.ios.ascAppId` in `eas.json`.

```bash
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --profile production --latest
```
