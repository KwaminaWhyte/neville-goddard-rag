# The Law — mobile (Expo)

Native iOS/Android client for the local Neville Goddard manifestation engine.
Full feature parity with the web app: desires, "living in the end" scenes,
daily process (markdown), journey log with edit/delete + search, felt-state
trends, signs timeline, streak, and a streaming coach chat.

It talks to the **same backend** as the web app over a JSON API the web server
exposes (`web/app/routes/api/*`). No Postgres/Ollama/LightRAG access from the
phone — everything goes through that API.

## Stack

- Expo **SDK 56** (React Native 0.85, React 19), **expo-router** (file-based)
- TypeScript, plain `StyleSheet` (no UI lib), no chart lib (sparkline is Views)
- Streaming coach via `expo/fetch` (the SDK 56 default global `fetch`)

## Setup

```bash
# 1. Start the backend (from repo root) — Postgres + LightRAG + web server
docker compose up -d
cd web && npm run dev          # serves the app + JSON API on :5173

# 2. Point the app at your machine's LAN IP (a phone can't see "localhost")
cd ../mobile
cp .env.example .env
#   edit EXPO_PUBLIC_API_URL → http://<your-LAN-ip>:5173
#   (macOS: ipconfig getifaddr en0)

# 3. Run it
npm install
npx expo start                 # scan the QR with Expo Go, or press i / a
```

Phone and dev machine must be on the **same network**.

## Layout

```
app/
  _layout.tsx        Themed Stack navigator (dark gold)
  index.tsx          Home — desires list, create, onboarding, health banner
  goal/[id].tsx      Goal detail — composes every feature section
components/
  ui.tsx             Design system: Card, Button, Field, Pill, …
  Markdown.tsx       Dependency-free RN markdown renderer
  EndScene, DailyProcess, JourneyLog, SignsTimeline,
  Trends, StreakBadge, CoachChat, Onboarding, HealthBanner
lib/
  api.ts             Typed client for the web server's /api/* routes
  types.ts           Wire shapes (mirror db.server.ts)
  theme.ts           Color / spacing / type tokens
```

## Notes

- Auth is intentionally absent — single-user, trusted LAN, for now.
- The API is unauthenticated; do not expose port 5173 beyond your LAN.
