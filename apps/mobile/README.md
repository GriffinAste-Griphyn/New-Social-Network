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
