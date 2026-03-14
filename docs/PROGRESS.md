# Vocis — Implementation Progress

> **For Claude:** After completing any task in this project, append a new entry at the **bottom** of this file (below the last `---` divider) following the format below. Keep entries concise. Stage `docs/PROGRESS.md` explicitly and include it in the same commit as the task's code changes.

---

## Entry format

```
### YYYY-MM-DD — [short title]
**What was built:** ...
**Key decisions:** ...
**Bugs / gotchas:** ...
**What was tried and didn't work:** ... (include root cause if known; use N/A if nothing failed)
```

---

### 2026-03-07 — Initial extension scaffold

**What was built:** Chrome MV3 extension with three-layer architecture — `content-script.ts` (IntersectionObserver page extraction), `background.ts` (service worker, Claude + ElevenLabs API calls), `sidebar/` (React 18 UI with narration and chat panels). Vite build via `vite-plugin-web-extension`.

**Key decisions:**
- `background.ts` is the only file that imports `@anthropic-ai/sdk` or `elevenlabs` — keeps API keys and heavy deps out of the sidebar bundle.
- Content script is injected on demand (ping/inject pattern) rather than declared statically in the manifest — avoids running on every page load.
- Audio is transferred as base64 strings over `chrome.runtime.sendMessage` because ArrayBuffers serialize as empty objects across the message channel.
- ElevenLabs SDK `client.textToSpeech.convert()` returns a Node `stream.Readable` type but in a Chrome extension service worker the underlying fetch returns a Web `ReadableStream` — cast to `AsyncIterable<Uint8Array>` to consume it.
- MV3 service workers can be killed after ~30s idle; a keepalive (`chrome.storage` ping every 20s) is used during long Claude + ElevenLabs calls.

**Bugs / gotchas:** None at this stage.

**What was tried and didn't work:** N/A

---

### 2026-03-08 — Voice conversation mode

**What was built:** Full voice conversation loop in `sidebar/ChatPanel.tsx` — mic input via Web Speech API, three chat modes (Auto / Text / Voice), conversation loop where Claude speaks then mic reopens automatically, 5-state input bar (idle / recording / loading / playing / conversation), mic error banner, unmount cleanup.

Added `setOnAudioEnded` ref-based callback hook to `sidebar/useChat.ts` so `ChatPanel` can register a post-audio callback without stale closures.

Added speech recognition bridge to `content-script.ts` — `SPEECH_START` / `SPEECH_STOP` messages trigger `SpeechRecognition` in the content script and relay `SPEECH_RESULT` / `SPEECH_END` / `SPEECH_ERROR` back via `chrome.runtime.sendMessage`.

**Key decisions:**
- `chrome-extension://` pages cannot trigger Chrome's mic permission dialog via `SpeechRecognition.start()` or `navigator.mediaDevices.getUserMedia()` — both fail silently with "not-allowed". Delegating speech recognition to the content script (which runs in the web page's security context) is the correct architecture.
- `conversationActiveRef` mirrors `conversationActive` state so async callbacks (speech events, audio ended) read the current value without stale closures.
- `endConversation` must be declared before `startListening` in source order so it can be listed as a `useCallback` dependency.
- `setOnAudioEnded` fires in four places in `useChat.ts`: natural audio end, audio decode error (`catch` block), `!audioBase64` early return, and `!response.success` early return — missing any one of these leaves the conversation loop hung.

**Bugs / gotchas:**
- Two failed attempts before root cause was found: (1) adding `"microphone"` to manifest permissions — not a valid MV3 extension permission, Chrome ignores it. (2) calling `navigator.mediaDevices.getUserMedia({ audio: true })` before `SpeechRecognition.start()` in the extension page — also fails silently at `chrome-extension://` origin.
- `endConversation` was missing from `startListening`'s `useCallback` dep array, causing a stale closure bug — caught in code review.
- Stop button during active conversation was calling `stopAudio()` only, leaving the UI in a stale "speak anytime" state — fixed to call `endConversation()` when conversation is active.
- No unmount cleanup caused dangling `SpeechRecognition` and post-unmount state sets.
- No "End" button visible during `barState="loading"` when conversation active — user was trapped with no escape.

**What was tried and didn't work:**
- `"microphone"` manifest permission — not a valid Chrome MV3 extension permission.
- `getUserMedia` preamble in extension page — `chrome-extension://` origin cannot trigger Chrome's mic permission dialog regardless of API used.

---

### 2026-03-08 — Rename AI Narrator → Vocis

**What was built:** Renamed the project from "AI Narrator" to "Vocis" across all source files: `manifest.json` (name, default_title, description), `package.json` (name, description), `sidebar/index.html` (title), `sidebar/App.tsx` (header text), `sidebar/useChat.ts` / `useNarrator.ts` / `usePageContent.ts` / `content-script.ts` / `background.ts` (all console log prefixes).

**Key decisions:** Local directory name (`smart-voice`) was kept unchanged — only in-source strings were updated.

**Bugs / gotchas:** None.

**What was tried and didn't work:** N/A

---

### 2026-03-13 — Per-tab side panel

**What was built:** Fixed the side panel opening on every tab. Removed `"side_panel": { "default_path": ... }` from `manifest.json` (was globally enabling the panel for all tabs). Updated `background.ts` icon-click handler to call `chrome.sidePanel.setOptions({ tabId, path, enabled: true })` before `chrome.sidePanel.open({ tabId })`, enabling the panel only for the specific clicked tab.

**Key decisions:**
- Each tab gets its own independent panel instance with separate React state (chat history, page content, narration state). User preferences (`chrome.storage.sync`: voice selection, chat mode) are intentionally shared across tabs; API keys remain in `chrome.storage.local`.
- Chrome persists tab-specific `sidePanel` options across service worker restarts, so no re-enablement logic is needed.

**Bugs / gotchas:** `chrome.sidePanel.setOptions()` returns `Promise<void>` — a code reviewer flagged calling `open()` without awaiting it as a race condition and wrapped both in an async IIFE. This broke the feature entirely (see next entry).

**What was tried and didn't work:** N/A

---

### 2026-03-13 — Fix: sidePanel.open() user gesture context

**What was built:** Removed async IIFE from the icon-click handler so `setOptions` and `open` are called synchronously.

**Key decisions:** `chrome.sidePanel.open()` is a user-gesture-required API. Chrome tracks gestures synchronously — `await`ing anything before `open()` expires the gesture context and Chrome silently ignores the call. Both `setOptions` and `open` are now fire-and-forget; Chrome's FIFO IPC ordering guarantees `setOptions` is applied in the browser process before `open` is handled, so there is no real race condition.

**Bugs / gotchas:** The previous "fix" (async IIFE) was introduced by a code quality reviewer who correctly identified an unawaited Promise but didn't know about Chrome's user gesture requirement. The panel appeared to build fine but silently failed to open at runtime.

**What was tried and didn't work:** Async IIFE with `await setOptions` before `open` — `open()` is silently ignored because the user gesture context expires across an `await`. (include root cause if known; use N/A if nothing failed)

---

### 2026-03-14 — Melodious narration voice

**What was built:** Switched narration from `eleven_turbo_v2` to `eleven_multilingual_v2` with expressive voice settings (stability: 0.4, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true). Chat replies keep `eleven_turbo_v2` for low latency. Added optional `quality: "high" | "fast"` param to `synthesizeSpeech`; NARRATE passes `"high"`, CHAT uses the default `"fast"`.

**Key decisions:** Quality/speed split keeps voice conversation snappy while making long narrations sound much more natural and expressive. `voice_settings` are only applied when `quality === "high"` to avoid affecting chat latency.

**Bugs / gotchas:** None anticipated.

**What was tried and didn't work:** N/A (include root cause if known; use N/A if nothing failed)

---

### 2026-03-14 — Revert to eleven_turbo_v2 (fix 402 on ElevenLabs)

**What was built:** Removed `eleven_multilingual_v2` and premium voice settings (`style`, `use_speaker_boost`). Now uses `eleven_turbo_v2` for all synthesis. Removed the `quality: "high" | "fast"` parameter from `synthesizeSpeech` entirely.

**Key decisions:** `eleven_multilingual_v2`, `style`, and `use_speaker_boost` require a paid ElevenLabs tier — free plan only supports `eleven_turbo_v2`.

**Bugs / gotchas:** ElevenLabs returns HTTP 402 with an empty body `{}` when the model or settings exceed the current plan — not a helpful error message.

**What was tried and didn't work:**
- `eleven_multilingual_v2` with `voice_settings: { stability, similarity_boost, style, use_speaker_boost }` — 402 Payment Required on the free plan.
- `output_format: "mp3_44100_128"` — also 402; free plan only supports `mp3_44100_64`. Fixed in follow-up commit.

---

### 2026-03-14 — Visible error surfacing + resilient chat text

**What was built:** Added user-visible error banners when API calls fail. Previously all errors were silently swallowed (only logged to the service worker console). Now:
- Chat failures show a dismissible red error banner above the input bar (`chatError` state in `useChat.ts`, rendered in `ChatPanel.tsx`)
- Narration failures show a red banner in the narrator panel (`error` state in `useNarrator.ts`, rendered in `NarratorPanel.tsx`)

Also fixed a latent architecture issue in the CHAT handler in `background.ts`: the Claude text call and the ElevenLabs audio call were wrapped in a single `withKeepalive`. If ElevenLabs threw, the entire response failed and the user saw no text at all. Split them: Claude runs first and always returns text; ElevenLabs runs separately and on failure logs the error and returns `audioBase64: null` (text-only fallback).

**Key decisions:**
- Chat error banner is dismissible (✕ button). Narration error auto-clears on next narrate attempt.
- Text-only fallback for chat is silent — user gets text without audio, which is better than nothing.

**Bugs / gotchas:** Root cause of "no response" bug was likely ElevenLabs synthesis failing (new `eleven_multilingual_v2` model or `voice_settings` rejected), causing the entire CHAT response to fail including the text.

**What was tried and didn't work:** N/A

---

### 2026-03-14 — Live voice transcript preview

**What was built:** Enabled `interimResults: true` in `content-script.ts` speech recognizer. Partial results emit `SPEECH_INTERIM` messages; final results continue to emit `SPEECH_RESULT`. In `ChatPanel.tsx`, an `interimTranscript` state string updates on each `SPEECH_INTERIM` and is cleared on `SPEECH_RESULT`/`SPEECH_END`. The recording bar shows the live transcript instead of "Listening…" when interim text is available; the animated dots hide while text is showing.

**Key decisions:** `SPEECH_INTERIM` is a separate message type from `SPEECH_RESULT` so the sidebar never accidentally calls `send()` on a partial result. Dots are hidden when transcript text is present to avoid layout shift; `min-w-0` + `truncate` on the container prevent overflow.

**Bugs / gotchas:** None anticipated.

**What was tried and didn't work:** N/A (include root cause if known; use N/A if nothing failed)
