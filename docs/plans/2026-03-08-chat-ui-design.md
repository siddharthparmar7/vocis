# Chat UI Redesign Design

**Date:** 2026-03-08

## Problem

1. Chat responses are always narrated (ElevenLabs TTS) — no way to get text-only replies
2. No stop button for chat audio — only the Narrator panel has stop controls
3. Mic button is a plain emoji (🎤), unclear UX, no visual recording state
4. No mode distinction between "I want to read the reply" vs "I want to hear the reply"

## Solution

Redesign the chat input bar to match Claude Desktop's interaction pattern:
- Transforming input bar with 4 distinct states
- Auto mode (default): typing → text reply, mic → voice reply
- Explicit mode toggle to force text-only or voice-always
- Stop button in input bar (primary) + inline on active message bubble (secondary)

## Architecture

### Input Bar States

```
IDLE:       [ Ask about this page…   ] [🎙] [→ Send]
RECORDING:  [ ●●● Listening…    ] [✕ Cancel]
LOADING:    [ Ask about this page…   ] [🎙] [⟳ ...]    ← disabled
PLAYING:    [ Ask about this page…   ] [🎙] [■ Stop]    ← Send → Stop
```

The mic button is a circular icon button (SVG microphone, grey ring). While recording it pulses red. The text input is disabled during RECORDING and LOADING states.

### Mode Toggle

A small segmented control (`Auto · Text · Voice`) sits above the input bar, right-aligned.

| Mode | Behavior |
|------|----------|
| **Auto** (default) | Keyboard/Send → `voiceReply: false`; Mic → `voiceReply: true` |
| **Text** | All replies text-only, no audio regardless of input method |
| **Voice** | All replies narrated, even if typed |

### Stop Controls

Two simultaneous stop controls when chat audio is playing:
1. **Input bar** (primary): Send button becomes `■ Stop`
2. **Message bubble** (secondary): small `■` icon appears top-right on the active assistant bubble

Both call the same `stopAudio()` from `useChat`. Stopping reverts both controls.

### Data Flow

```
User types + Send (Auto/Text mode)
  → send(text, voice, voiceReply: false)
  → background: CHAT message with voiceReply: false
  → background: skips synthesizeSpeech, returns { text, audioBase64: null }
  → useChat: renders text, skips audio

User clicks mic (Auto/Voice mode)
  → SpeechRecognition → transcript
  → send(transcript, voice, voiceReply: true)
  → background: CHAT message with voiceReply: true
  → background: Claude text + ElevenLabs TTS → { text, audioBase64: "..." }
  → useChat: renders text + plays audio, exposes isPlaying: true
  → ChatPanel: Send → ■ Stop, bubble shows ■ icon
```

## Files Changed

| File | Change |
|------|--------|
| `sidebar/ChatPanel.tsx` | Input bar state machine, mode toggle UI, mic button redesign, stop-on-bubble |
| `sidebar/useChat.ts` | Add `voiceReply` param to `send()`, add `stopAudio()`, expose `isPlaying` |
| `background.ts` | Skip `synthesizeSpeech` when `message.voiceReply === false`; return `{ text, audioBase64: null }` |

## Files NOT Changed

- `sidebar/NarratorPanel.tsx` — narrator controls untouched
- `sidebar/App.tsx` — no structural changes
- `sidebar/useNarrator.ts` — narrator playback untouched
- `types.ts` — `CHAT` message type gets `voiceReply: boolean` added
- `content-script.ts` — no changes

## Input Bar State Machine

```
IDLE
  → user clicks mic → RECORDING
  → user types + Send → LOADING (voiceReply: false)
  → user types + Send (Voice mode) → LOADING (voiceReply: true)

RECORDING
  → speech result → LOADING (voiceReply: true)
  → user clicks Cancel → IDLE

LOADING
  → response received, voiceReply: false → IDLE
  → response received, voiceReply: true → PLAYING

PLAYING
  → audio ends naturally → IDLE
  → user clicks Stop → IDLE
```

## UX Notes

- Mode toggle persists in `chrome.storage.sync` (survives panel close/reopen)
- Active bubble `■` icon uses a CSS transition to fade in/out
- Mic button uses an SVG icon (not emoji) with a pulsing red ring animation during recording
- `voiceReply` default in Auto mode is determined at click time, not stored
