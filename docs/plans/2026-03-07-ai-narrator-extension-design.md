# AI Narrator Chrome Extension — Design Doc

**Date:** 2026-03-07
**Status:** Approved
**Author:** Sid Parmar

---

## Overview

A Chrome extension with a sidebar panel that:
1. Silently extracts readable content from any webpage
2. Narrates it on demand via ElevenLabs TTS
3. Opens a persistent voice/text chat with Claude using the page content as context

Primary user: personal productivity tool (Sid). Not an accessibility product.

---

## Platform

**Chrome Extension, Manifest V3** with `chrome.sidePanel` API.
Compatible with Chrome, Arc, Brave.

---

## Architecture

Three layers with clean separation:

```
┌─────────────────────────────────────────┐
│  Chrome Tab (page content)              │
│                        ┌───────────────┐│
│                        │  Sidebar App  ││
│                        │  (React)      ││
│                        │               ││
│                        │  NarratorPanel││
│                        │  ChatPanel    ││
│                        └───────────────┘│
└─────────────────────────────────────────┘
```

- **Content Script** — injected into every page, extracts readable text via Mozilla `Readability.js`. Runs silently, sends content to background worker on demand.
- **Background Service Worker** — message bus. The only layer that holds API keys and calls external services (Claude, ElevenLabs). Stateless across tab sessions.
- **Sidebar React App** — all UI. Stateful per session. Communicates with background via `chrome.runtime.sendMessage`.

---

## User Flow

```
User opens sidebar on any page
  │
  ▼
Page title, estimated read time displayed
Voice selector dropdown (ElevenLabs presets)
[▶ Narrate] button

  ├── User clicks ▶ OR types/says "narrate"
  │         │
  │         ▼
  │   Content script extracts page text
  │   Claude structures it for narration
  │   ElevenLabs streams audio (starts in ~1s)
  │   [⏸ Pause] [⏹ Stop] controls shown
  │         │
  │         ▼
  │   Narration ends → Chat activates
  │
  └── User skips narration
            │
            ▼
      Chat is always available immediately
      (page content always in Claude's context)

Voice or text chat:
  User speaks (Web Speech API STT) or types
  → Claude responds (with page context + history)
  → ElevenLabs speaks reply
```

**Key principle:** Narration is optional. Chat is always available from the moment the sidebar opens.

---

## File Structure

```
extension/
├── manifest.json              # MV3 config, permissions, sidePanel registration
├── content-script.ts          # Readability.js extraction, injected into page
├── background.ts              # Service worker, API calls, message routing
└── sidebar/
    ├── index.html             # Sidebar entry point
    ├── App.tsx                # Root component, global state
    ├── NarratorPanel.tsx      # Play/pause/stop, voice picker, progress bar
    ├── ChatPanel.tsx          # Message thread, text + voice input
    ├── useNarrator.ts         # ElevenLabs streaming, playback state machine
    ├── useChat.ts             # Claude API, message history, page context
    └── usePageContent.ts      # Receives extracted content from content script
```

### Separation of concerns

- `background.ts` is the **only** file with API keys and external service calls
- Hooks are the **only** files that touch `chrome.runtime` messaging
- Components are pure UI — no API calls, no chrome APIs directly
- **Adding future features** = new panel component + new hook + new message handler in `background.ts`. Nothing else changes.

---

## API Integration

| Service | Usage | Notes |
|---|---|---|
| **Claude API** | Structure page text for narration; all chat turns | Full page content in system prompt for entire session |
| **ElevenLabs** | TTS for narration + chat replies | Streaming audio; user picks preset voice on first use |
| **Web Speech API** | STT for voice chat input | Built-in Chrome, no cost, no extra dependency |

### Claude system prompt strategy

```
System: You are a personal reading assistant. The user is currently on a webpage.
Full page content: [extracted text]

For narration requests: rewrite as clean, natural spoken prose. Remove nav/footer/ads.
For chat: answer questions about this page. Be concise. You may also speak the reply aloud.
```

### ElevenLabs voice selection
- On first open: show a dropdown of ~6 curated preset voices
- Selection persisted in `chrome.storage.sync`
- Same voice used for both narration and chat replies (consistent experience)

---

## State Machine (Narrator)

```
IDLE → LOADING → PLAYING → PAUSED → IDLE
                         ↘ STOPPED → IDLE
```

- `IDLE`: default, shows play button
- `LOADING`: Claude + ElevenLabs request in flight, shows spinner
- `PLAYING`: audio streaming, shows pause + stop
- `PAUSED`: audio paused, shows resume + stop
- `STOPPED` / done: chat activates, narrator resets to IDLE

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Extension framework | Chrome MV3, no framework | Keeps bundle small, avoids complexity |
| Sidebar UI | React + TypeScript | Component model suits panel UI |
| Styling | Tailwind CSS (or CSS Modules) | Fast iteration, scoped styles |
| Content extraction | Mozilla `Readability.js` | Battle-tested, same as Firefox Reader View |
| Build tool | Vite + `vite-plugin-web-extension` | Fast builds, good MV3 support |
| Claude | `@anthropic-ai/sdk` | Official SDK, streaming support |
| ElevenLabs | `elevenlabs` npm package or direct REST | Streaming TTS |

---

## Scalability Notes

- Background service worker is designed as a **message router** — new features register new message types, no refactoring needed
- Sidebar `App.tsx` uses a simple panel switcher — new panels slot in without changing existing ones
- API keys stored in `chrome.storage.local` (user-configurable via an options page, to be added later)
- No hardcoded content assumptions — works on articles, docs, PDFs rendered in browser, GitHub READMEs, etc.

---

## Out of Scope (for v1)

- Voice cloning
- Offline/local TTS
- Mobile / Firefox support
- Dashboard, todo list, notes (separate future project)
- Multi-tab session persistence

---

## Next Step

Create a new Claude Code project in a fresh directory and use this doc as the starting spec.
Suggested project name: `ai-narrator-extension`
