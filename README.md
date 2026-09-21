# Conversation

A minimal React Native Web voice app: one large play/stop button and a small, live transcript. Built from the GPT-Live connection in `agentic_speech_demo`, with a general conversation prompt and no instrument catalogue or settings panels.

The UI uses React Native primitives through React Native Web. This repository ships the browser application; it does not include iOS/Android binaries. The WebRTC transport is browser-specific.

## Local development

Use Node.js 24 or newer.

```sh
npm ci
cp .env.example .env
# Set OPENAI_API_KEY in .env
npm run dev
```

Open http://localhost:5173. Allow microphone access and press play. Press the same button to stop. The visible transcript remains until the next conversation. Memory and pending conversation text are saved in this browser’s localStorage and carried into new sessions. While the page is open, the browser asynchronously asks `gpt-5.6-terra` to summarize memory every 30 seconds when there is new text, and when a session ends. Voice never waits for summarization. Pending work survives reloads; failures retain it for retry. Open **Memory** to view the summary, update it, or clear it after stopping. Memory is specific to this browser profile and origin; use one tab for conversations (concurrent tabs do not merge memory). Clearing browser site data also removes it. If browser storage is unavailable, memory only lasts for this page and the Memory panel shows a warning.

```sh
npm test
npm run build
PUBLIC_ORIGIN=http://localhost:3000 npm start
```

## Voice connection

The Express server validates the origin and SDP offer, then creates a `gpt-live-1` session with the `marin` voice and `gpt-5.6-terra` Responses delegation. The backend has hosted `web_search` access for current information and public webpages. Opening-hours requests check the exact branch, date, and local timezone, preferring official sources. Citation links appear under the transcript. The API key stays on the server. `/api/memory` proxies bounded, origin-checked summary requests through the [Responses API](https://developers.openai.com/api/reference/responses/create) with `store: false`; the app server does not persist memory. Audio travels directly over WebRTC; timestamped events update each speaker's transcript independently. The greeting waits for session readiness and its instruction acknowledgement. Stop silences audio immediately, requests session closure, and releases browser resources.

Based on the official [WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) and [session lifecycle guide](https://developers.openai.com/api/docs/guides/live-conversations).

## nixpi deployment

Checkout: `/home/infiniter/services/conversation`. Put `.env` there with `OPENAI_API_KEY`. Existing speech-demo `.env` files work; Compose explicitly sets the origin and port so copied `APP_PORT` values cannot conflict.

```sh
docker compose up -d --build
```

Docker binds only `127.0.0.1:13005`, runs as a non-root user, and restarts after reboot. Secrets are excluded from Git and Docker build contexts. `/api/health` reports whether a key is configured, without making a paid API request. The session endpoint limits request size and connection attempts; this personal demo has no user accounts.

The `nix-server` repo configures the nginx HTTPS host and Websupport dynamic DNS A record for https://conversation.infiniter.tech. After updating that repo on nixpi, run `nixos-rebuild switch --flake /etc/nixos#nixpi` and start `websupport-ddns.service`.

## Checks

`npm test` checks origin rejection, bounded SDP input, safe upstream failures, request limiting, greeting acknowledgement, delayed microphone cancellation, shutdown/restart, and overlapping transcripts. Tests use mocked voice responses and make no paid API calls. `npm run build` runs TypeScript and builds the production web bundle.
