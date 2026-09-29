# Wawa Lipsync (MIT)

Vendored from https://github.com/wass08/wawa-lipsync at commit
`312dc31a1ee998248aae3431474f455bfc3ae3e1` (2026-09-27).

`lipsync.ts`, `visemes.ts`, and `utils/mathUtil.ts` come from
`packages/wawa-lipsync/src/`. See LICENSE; a public copy is provided for the credits page.

The classifier, frequency bands, scoring, state transitions, and thresholds are unchanged.
Three integration changes in `lipsync.ts`:
- Optional second constructor argument uses our existing AudioContext.
- `connectSource` connects a received WebRTC audio node without requesting microphone access or connecting a second audible output.
- Explicit `Uint8Array<ArrayBuffer>` type for TypeScript 6's Web Audio types.

The source context owns cleanup. `RemoteAudioMeter` gates actual silence because upstream retains history when audio has no energy. No audio leaves the browser for this analysis.

`TalkingFace.tsx` reuses the interpolation rates from upstream's
`examples/lipsync-demo/src/components/Avatar.jsx`, converted from per-frame rates to elapsed-time rates. Only the names of the existing Rocketbox poses are mapped. No mouth geometry is created or edited.

This is an audio-frequency heuristic, not phoneme recognition or forced alignment. Its predictions can be wrong, and it does not reliably distinguish every consonant. It preserves immediate WebRTC playback, without buffering an entire reply or adding a server-side analysis step.

Upstream demo: https://wawa-lipsync.wawasensei.dev/
