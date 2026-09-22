# Conversation

A minimal React Native Web voice app: an animated humanoid companion, a pause/resume button, and a small, live transcript. The face blinks while connected and animates its mouth and head while the existing remote-audio detector reports speech. Pausing or blocked playback stops the talking animation; reduced-motion preferences disable movement. This is a speech activity animation, not phoneme-level lip sync. Built from the GPT-Live connection in `agentic_speech_demo`, with a general conversation prompt and no instrument catalogue or settings panels.

The UI uses React Native primitives through React Native Web. This repository ships the browser application; it does not include iOS/Android binaries. The WebRTC transport is browser-specific.

## Local development

Use Node.js 24 or newer.

```sh
npm ci
cp .env.example .env
# Set OPENAI_API_KEY in .env
npm run dev
```

Open http://localhost:5173. The page joins voice automatically on load; allow microphone access when prompted. The agent greets you on every join, including when resuming a saved conversation. Press pause to silence voice and turn off the microphone, then play to resume. If browser autoplay blocks sound, use **Tap to enable sound**. The current conversation survives page reloads: its latest OpenAI session ID, recent transcript (up to 100 entries / 48,000 characters), and source links are saved in this browser’s localStorage (`conversation.current.v1`). **New conversation**, available in the top-right corner of the sticky header, clears the local conversation and pending memory-review speech while keeping saved long-term memory, then immediately starts a fresh voice conversation. **Wipe everything** asks for confirmation, then stops voice and clears all localStorage for this app, including conversation and memory. **Wipe everything** leaves voice paused; press play to begin again. Memory management and **Wipe everything** stay hidden in the bottom-left **Memory** dropdown until it is opened; click outside or press Escape to close it. Reloading or returning to the page enables voice again; pausing applies to the current visit. Storage failures appear in the UI. Concurrent tabs do not merge conversation changes. Memory is an array of distinct strings saved in this browser’s localStorage (`conversation.memory.v2`). Memory review uses a separate durable queue of new transcript fragments, saved alongside the memory list so reloads can retry unfinished reviews. Every 30 seconds with pending speech, and when a session ends, the browser asks `gpt-5.6-terra` to review the **entire existing memory list** plus only the pending queue. Terra returns a minimal patch: useful additions, corrections to existing entries, removals, or an empty patch when nothing merits remembering. Memory includes facts, interests, and substantive topics explored through questions and lookups. A first discussion is phrased cautiously as a recent topic rather than a permanent preference; changing answer details such as temperatures and schedules are omitted. The first load after this policy upgrade queues the saved conversation once, so topics excluded by the earlier rules can be recovered. Unchanged memories are preserved; exact duplicate additions are suppressed locally, and the model is instructed to avoid semantic duplicates. A no-change run durably consumes the reviewed queue without a change notification. Only actual changes appear in the expandable toast, never the entire list or an “updating” toast. Open **Memory** to see the saved memories and the **Wipe everything** button at the bottom. Older summaries migrate to an entry without discarding them. Voice never waits for memory review. Failures keep the queue for retry, including after closing or reloading. Applying a patch and consuming its reviewed queue are saved together to avoid losing unreviewed speech. Existing memory lists migrate without changes to their entries. Memory is specific to this browser and origin; concurrent tabs do not merge changes.

```sh
npm test
npm run build
PUBLIC_ORIGIN=http://localhost:3000 npm start
```

## Voice connection

The Express server validates the origin, SDP offer, saved session identifier, and bounded text history, then creates a `gpt-live-1` session with the `marin` voice and `gpt-5.6-terra` Responses delegation. The backend has hosted `web_search` access for current information and public webpages. Opening-hours requests check the exact branch, date, and local timezone, preferring official sources. Citation links appear under the transcript. Voice sessions use `store: true`. On continuation, the backend first forks the saved session through `POST /v1/live/sessions/{session_id}/fork`, explicitly enabling storage for the child as well. The browser replaces the saved ID once the child session starts. Forking creates a new session/connection from the completed stored voice conversation. It requires storage enabled in the OpenAI project; recordings are available for 30 days, and forking is unavailable under Zero Data Retention. When a fork is rejected as invalid, unavailable, expired, or not ready (HTTP 400/404/409/410/422), the backend creates a replacement using the recent local transcript as role-separated `session.input`. Authentication, quota, rate-limit, and service failures are surfaced instead of retried. Reloads can happen before recording finalization, so local history remains a fallback. Each joined session receives greeting instructions and an acknowledged greeting cue; returning users get a brief welcome back in their preferred or recent language. The cue is suppressed if speech has already begun in the new session. **New conversation** clears the local reference; it does not delete the stored OpenAI recording. The API key stays on the server. `/api/memory` proxies bounded, origin-checked summary requests through the [Responses API](https://developers.openai.com/api/reference/responses/create) with `store: false`; the app server does not persist memory. Audio travels directly over WebRTC; timestamped events update each speaker's transcript independently. The greeting waits for session readiness and its instruction acknowledgement. Pause silences audio immediately, requests session closure, and waits up to 15 seconds for recording finalization before releasing browser resources. Transcript fragments received during closing are still saved.

Based on the official [WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) and [session lifecycle guide](https://developers.openai.com/api/docs/guides/live-conversations).

## nixpi deployment

Checkout: `/home/infiniter/services/conversation`. Put `.env` there with `OPENAI_API_KEY`. Existing speech-demo `.env` files work; Compose explicitly sets the origin and port so copied `APP_PORT` values cannot conflict.

```sh
docker compose up -d --build
```

Docker binds only `127.0.0.1:13005`, runs as a non-root user, and restarts after reboot. Secrets are excluded from Git and Docker build contexts. `/api/health` reports whether a key is configured, without making a paid API request. The session endpoint limits request size and connection attempts; this personal demo has no user accounts.

The `nix-server` repo configures the nginx HTTPS host and Websupport dynamic DNS A record for https://conversation.infiniter.tech. After updating that repo on nixpi, run `nixos-rebuild switch --flake /etc/nixos#nixpi` and start `websupport-ddns.service`.

## Checks

`npm test` checks origin rejection, bounded SDP input, safe upstream failures, request limiting, greeting acknowledgement, delayed microphone cancellation, shutdown/restart, overlapping transcripts, local reload recovery, stored-session forking and fallback, storage failures, and explicit conversation reset. Tests use mocked voice responses and make no paid API calls. `npm run build` runs TypeScript and builds the production web bundle.
