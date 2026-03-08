# smart-voice

Chrome MV3 extension that narrates any webpage via ElevenLabs TTS and enables voice/text chat with Claude using the page as context.

## Commands

```bash
npm run build      # production build → dist/
npm run dev        # watch mode (rebuilds on save)
npx tsc --noEmit   # type-check only
```

To load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`

After code changes, click the refresh icon on the extension card in `chrome://extensions`.

## Architecture

Three layers with strict separation:

```
content-script.ts   — injected on demand, extracts visible page text via IntersectionObserver
background.ts       — service worker, ONLY file that calls Claude + ElevenLabs APIs
sidebar/            — React UI, communicates with background via chrome.runtime.sendMessage
```

**Key rules:**
- `background.ts` is the **only** file that imports `@anthropic-ai/sdk` or `elevenlabs`
- API keys are stored in `chrome.storage.local`, never in code or .env
- Sidebar hooks are the **only** layer that calls `chrome.runtime.sendMessage`
- Components are pure UI — no chrome APIs, no API calls

## File Map

```
manifest.json           MV3 config — permissions, side panel, action
background.ts           Service worker: message router, Claude + ElevenLabs calls
content-script.ts       IntersectionObserver extraction of visible elements, responds to EXTRACT_CONTENT and PING
types.ts                Shared types: ExtractedPage, ChatMessage, MessageRequest
vite.config.ts          Build config (vite-plugin-web-extension)
tailwind.config.js      Tailwind v3, scoped to sidebar/**

sidebar/
  App.tsx               Root component, voice state, settings toggle
  NarratorPanel.tsx     Play/pause/stop UI, voice picker
  ChatPanel.tsx         Message thread, text + voice input
  SettingsPanel.tsx     API key entry form
  usePageContent.ts     Fetches extracted page from background
  useNarrator.ts        IDLE→LOADING→PLAYING→PAUSED state machine
  useChat.ts            Chat history, sends/receives messages + audio
  main.tsx              React entry point
  index.css             Tailwind directives + base resets
```

## Message Protocol

All sidebar→background communication uses `chrome.runtime.sendMessage`:

| type | payload | response |
|---|---|---|
| `GET_PAGE_CONTENT` | — | `{ success, data: ExtractedPage }` |
| `NARRATE` | `{ page, voice }` | `{ success, data: { audioBuffer } }` |
| `CHAT` | `{ page, history, userMessage, voice }` | `{ success, data: { text, audioBuffer } }` |
| `GET_VOICES` | — | `{ success, data: Voice[] }` |
| `SET_KEYS` | `{ claudeKey, elevenLabsKey }` | `{ success }` |

Content script injection is **dynamic** — background injects `content-script.js` via `chrome.scripting.executeScript` on first `GET_PAGE_CONTENT` request (ping/inject pattern).

## API Keys

Keys are entered by the user via the ⚙ settings panel in the sidebar. They are sent to the background via `SET_KEYS` and stored in `chrome.storage.local`. Never hardcode keys.

## Logging

All logs are prefixed for easy filtering:

| Prefix | Where |
|---|---|
| `[AI Narrator]` | Service worker — inspect via `chrome://extensions` → service worker |
| `[AI Narrator:content]` | Page DevTools console |
| `[AI Narrator:narrator]` | Sidebar DevTools (right-click sidebar → Inspect) |
| `[AI Narrator:chat]` | Sidebar DevTools |

## Known Constraints

- **Service worker lifetime**: MV3 workers can be killed after ~30s idle. Long narrations use a keepalive (`chrome.storage` ping every 20s) to prevent this.
- **Content script injection**: Not declared statically in manifest — injected on demand. This means it only runs when the sidebar is open, not on every page load.
- **ElevenLabs SDK**: The `elevenlabs` npm package is deprecated in favour of `@elevenlabs/elevenlabs-js` but still functional. `client.textToSpeech.convert()` returns a Node `stream.Readable` type but in the browser runtime it's a Web `ReadableStream` — cast to `AsyncIterable<Uint8Array>` to consume it.
- **SPA support**: `content-script.ts` observer does not watch dynamically inserted elements (SPAs); re-injecting the script resets the observer.

## Out of Scope (v1)

Voice cloning, offline TTS, Firefox/mobile support, multi-tab persistence.
