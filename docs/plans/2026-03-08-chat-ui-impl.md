# Chat UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the chat UI with a transforming input bar, auto/text/voice mode toggle, Claude Desktop-style mic button, and stop controls for chat audio.

**Architecture:** Three layers of change — (1) `types.ts` + `background.ts` add `voiceReply` flag to skip TTS when not needed, (2) `useChat.ts` gains `stopAudio()` and `isPlaying` state, (3) `ChatPanel.tsx` is fully redesigned with 4 input states, a mode toggle pill, and inline stop on active bubbles.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v3, Web Speech API, Chrome Extension MV3, AudioContext

---

### Task 1: Add `voiceReply` to types and background

**Files:**
- Modify: `types.ts:12`
- Modify: `background.ts:169-177`

**Context:**
The `CHAT` message type in `types.ts` currently has no `voiceReply` field. `background.ts` always calls `synthesizeSpeech` for every chat response. We need to make TTS optional.

**Step 1: Read both files**

Read `types.ts` and the CHAT handler section of `background.ts` (lines 169-177).

**Step 2: Update `types.ts`**

Change line 12 from:
```typescript
| { type: "CHAT"; page: ExtractedPage; history: ChatMessage[]; userMessage: string; voice: string }
```
To:
```typescript
| { type: "CHAT"; page: ExtractedPage; history: ChatMessage[]; userMessage: string; voice: string; voiceReply: boolean }
```

**Step 3: Update `background.ts` CHAT handler**

The current CHAT handler (around lines 169-177) looks like:
```typescript
} else if (message.type === "CHAT") {
  log("Chat: user message:", `"${message.userMessage}"`);
  const { text: reply, audioBuffer } = await withKeepalive(async () => {
    const text = await chatWithClaude(message.page, message.history, message.userMessage, claudeKey);
    const audioBuffer = await synthesizeSpeech(text, message.voice, elevenLabsKey);
    return { text, audioBuffer };
  });
  log("Chat: response sent");
  sendResponse({ success: true, data: { text: reply, audioBase64: audioBuffer } });
```

Replace it with:
```typescript
} else if (message.type === "CHAT") {
  log("Chat: user message:", `"${message.userMessage}"`, "voiceReply:", message.voiceReply);
  const { text: reply, audioBase64 } = await withKeepalive(async () => {
    const text = await chatWithClaude(message.page, message.history, message.userMessage, claudeKey);
    if (!message.voiceReply) return { text, audioBase64: null };
    const audioBase64 = await synthesizeSpeech(text, message.voice, elevenLabsKey);
    return { text, audioBase64 };
  });
  log("Chat: response sent");
  sendResponse({ success: true, data: { text: reply, audioBase64 } });
```

**Step 4: Build**

```bash
cd /Users/sidparmar/workspace-ml/smart-voice && npm run build
```

Expected: Zero TypeScript errors.

**Step 5: Commit**

```bash
git add types.ts background.ts
git commit -m "feat: add voiceReply flag to CHAT — skip TTS when text mode"
```

---

### Task 2: Update `useChat.ts` — add `stopAudio`, `isPlaying`, `voiceReply` param

**Files:**
- Modify: `sidebar/useChat.ts`

**Context:**
Current `send(userText, voice)` always attempts to play audio. We need to:
1. Add `voiceReply: boolean` parameter to `send()`
2. Track `isPlaying` state (audio is currently playing)
3. Add `stopAudio()` to stop the active source node
4. Skip audio decode/play when `audioBase64` is null

**Step 1: Read the current file**

Read `sidebar/useChat.ts` in full.

**Step 2: Replace the file contents**

```typescript
import { useState, useCallback, useRef } from "react";
import type { ChatMessage, ExtractedPage } from "../types";

const log = (...args: unknown[]) => console.log("[AI Narrator:chat]", ...args);

export function useChat(page: ExtractedPage | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const inFlightRef = useRef(false);

  function getOrCreateCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  const stopAudio = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const send = useCallback(async (userText: string, voice: string, voiceReply: boolean) => {
    if (!page || !userText.trim() || inFlightRef.current) {
      if (inFlightRef.current) log("send() blocked — request already in flight");
      return;
    }

    log("send():", `"${userText}"`, "voiceReply:", voiceReply);
    inFlightRef.current = true;
    const userMessage: ChatMessage = { role: "user", content: userText };

    // Unlock AudioContext NOW, while still in the user gesture call stack
    const ctx = getOrCreateCtx();
    await ctx.resume();

    // Use functional updater to always get latest state
    let currentHistory: ChatMessage[] = [];
    setMessages((prev) => {
      currentHistory = prev;
      return [...prev, userMessage];
    });

    setLoading(true);

    const response = await chrome.runtime.sendMessage({
      type: "CHAT",
      page,
      history: currentHistory,
      userMessage: userText,
      voice,
      voiceReply,
    });

    setLoading(false);
    inFlightRef.current = false;

    if (!response?.success) {
      console.error("[AI Narrator:chat] CHAT failed:", response?.error);
      return;
    }

    const { text, audioBase64 } = response.data as { text: string; audioBase64: string | null };
    log("Response received:", `"${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`);
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);

    if (!audioBase64) return;

    // Play reply via AudioContext
    try {
      const binary = atob(audioBase64);
      const rawBuffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) rawBuffer[i] = binary.charCodeAt(i);
      const decodedBuffer = await ctx.decodeAudioData(rawBuffer.buffer);
      const source = ctx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (sourceRef.current === source) {
          sourceRef.current = null;
          setIsPlaying(false);
          log("Chat audio ended naturally");
        }
      };
      source.start(0);
      sourceRef.current = source;
      setIsPlaying(true);
      log("Playing audio response");
    } catch (e) {
      console.error("[AI Narrator:chat] Audio playback failed:", e);
    }
  }, [page, stopAudio]);

  return { messages, send, loading, isPlaying, stopAudio };
}
```

**Step 3: Build**

```bash
cd /Users/sidparmar/workspace-ml/smart-voice && npm run build
```

Expected: TypeScript error in `ChatPanel.tsx` because `send` now requires 3 arguments. That's fine — we fix it in Task 3.

**Step 4: Commit**

```bash
git add sidebar/useChat.ts
git commit -m "feat: add voiceReply param, stopAudio, isPlaying to useChat"
```

---

### Task 3: Redesign `ChatPanel.tsx`

**Files:**
- Modify: `sidebar/ChatPanel.tsx`

**Context:**
This is the biggest change. The current panel has a simple input + mic emoji + Send. We're replacing it with:
- A mode toggle pill (`Auto | Text | Voice`) above the input bar
- A transforming input bar with 4 states (IDLE / RECORDING / LOADING / PLAYING)
- A proper circular SVG mic button with pulse animation when recording
- Stop button inline on the active assistant message bubble
- Stop button replacing Send in the input bar while audio plays

The mode is persisted in `chrome.storage.sync` under key `"chatMode"`.

**Step 1: Read the current file**

Read `sidebar/ChatPanel.tsx` in full.

**Step 2: Replace the file contents**

```typescript
import { useState, useRef, useEffect } from "react";
import type { ExtractedPage } from "../types";
import { useChat } from "./useChat";

interface SpeechRecognitionResult {
  readonly 0: { transcript: string };
}
interface SpeechRecognitionResultList {
  readonly 0: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  readonly results: SpeechRecognitionResultList;
}
interface ISpeechRecognition {
  lang: string;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}
declare global {
  interface Window {
    SpeechRecognition?: ISpeechRecognitionConstructor;
    webkitSpeechRecognition?: ISpeechRecognitionConstructor;
  }
}

type ChatMode = "auto" | "text" | "voice";

type Props = {
  page: ExtractedPage | null;
  voice: string;
};

// Index of the last assistant message that is currently playing audio
let playingMessageIndex = -1;

export function ChatPanel({ page, voice }: Props) {
  const { messages, send, loading, isPlaying, stopAudio } = useChat(page);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState<ChatMode>("auto");
  const recogRef = useRef<ISpeechRecognition | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const playingIndexRef = useRef(-1);

  // Track which message index is currently playing
  useEffect(() => {
    if (isPlaying) {
      // The last assistant message is the one playing
      const lastAssistantIdx = messages.map((m, i) => m.role === "assistant" ? i : -1).filter(i => i >= 0).at(-1) ?? -1;
      playingIndexRef.current = lastAssistantIdx;
    } else {
      playingIndexRef.current = -1;
    }
  }, [isPlaying, messages]);

  // Load persisted mode
  useEffect(() => {
    chrome.storage.sync.get(["chatMode"]).then((r) => {
      if (r.chatMode === "text" || r.chatMode === "voice" || r.chatMode === "auto") {
        setMode(r.chatMode as ChatMode);
      }
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function persistMode(m: ChatMode) {
    setMode(m);
    chrome.storage.sync.set({ chatMode: m });
  }

  function resolveVoiceReply(fromMic: boolean): boolean {
    if (mode === "text") return false;
    if (mode === "voice") return true;
    return fromMic; // auto
  }

  function startListening() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const recog = new Ctor();
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      send(transcript, voice, resolveVoiceReply(true));
    };
    recog.onend = () => setListening(false);
    recogRef.current = recog;
    recog.start();
    setListening(true);
  }

  function cancelListening() {
    recogRef.current?.stop();
    setListening(false);
  }

  function handleSend() {
    if (!input.trim()) return;
    send(input, voice, resolveVoiceReply(false));
    setInput("");
  }

  // Determine input bar state
  type BarState = "idle" | "recording" | "loading" | "playing";
  const barState: BarState = listening ? "recording" : loading ? "loading" : isPlaying ? "playing" : "idle";

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Ask anything about this page.
          </p>
        )}
        {messages.map((m, i) => {
          const isActiveAudio = isPlaying && m.role === "assistant" && playingIndexRef.current === i;
          return (
            <div key={i} className="relative group">
              <div
                className={`text-sm rounded px-3 py-2 max-w-[85%] ${
                  m.role === "user"
                    ? "ml-auto bg-blue-100 text-blue-900"
                    : "mr-auto bg-gray-100 text-gray-800"
                }`}
              >
                {m.content}
              </div>
              {isActiveAudio && (
                <button
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-gray-300 hover:bg-gray-400 text-gray-700"
                  onClick={stopAudio}
                  title="Stop audio"
                >
                  <svg viewBox="0 0 10 10" className="w-3 h-3 fill-current">
                    <rect x="1" y="1" width="8" height="8" rx="1" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="mr-auto bg-gray-100 text-gray-400 text-xs px-3 py-2 rounded">
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Mode toggle */}
      <div className="px-3 pt-2 flex justify-end">
        <div className="flex text-xs rounded-full border border-gray-200 overflow-hidden">
          {(["auto", "text", "voice"] as ChatMode[]).map((m) => (
            <button
              key={m}
              onClick={() => persistMode(m)}
              className={`px-2 py-0.5 capitalize transition-colors ${
                mode === m
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t p-2">
        {barState === "recording" ? (
          /* Recording state */
          <div className="flex items-center gap-2 h-9">
            <div className="flex-1 flex items-center gap-1.5 px-3">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-red-500 animate-bounce"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
              <span className="text-xs text-gray-500 ml-1">Listening…</span>
            </div>
            <button
              className="text-sm px-3 py-1 border rounded text-gray-600 hover:bg-gray-100"
              onClick={cancelListening}
            >
              ✕ Cancel
            </button>
          </div>
        ) : (
          /* Idle / Loading / Playing state */
          <div className="flex gap-2">
            <input
              className="flex-1 text-sm border rounded px-2 py-1"
              placeholder="Ask about this page…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && barState === "idle" && handleSend()}
              disabled={!page || barState !== "idle"}
            />

            {/* Mic button — circular SVG */}
            <button
              className={`w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${
                barState === "recording"
                  ? "bg-red-100 border-red-400 animate-pulse"
                  : "bg-gray-100 border-gray-300 hover:bg-gray-200"
              }`}
              onClick={startListening}
              disabled={!page || barState !== "idle"}
              title="Voice input"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current stroke-2">
                <rect x="9" y="2" width="6" height="11" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" strokeLinecap="round" />
                <line x1="12" y1="17" x2="12" y2="21" strokeLinecap="round" />
                <line x1="9" y1="21" x2="15" y2="21" strokeLinecap="round" />
              </svg>
            </button>

            {/* Send / Stop / Loading button */}
            {barState === "playing" ? (
              <button
                className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-1"
                onClick={stopAudio}
              >
                <svg viewBox="0 0 10 10" className="w-3 h-3 fill-current">
                  <rect x="1" y="1" width="8" height="8" rx="1" />
                </svg>
                Stop
              </button>
            ) : barState === "loading" ? (
              <button
                className="text-sm px-3 py-1 bg-gray-300 text-gray-500 rounded"
                disabled
              >
                …
              </button>
            ) : (
              <button
                className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                onClick={handleSend}
                disabled={!page || !input.trim()}
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3 fill-none stroke-current stroke-2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                Send
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Build**

```bash
cd /Users/sidparmar/workspace-ml/smart-voice && npm run build
```

Expected: Zero TypeScript errors. All 3 entry points build cleanly.

**Step 4: Verify in Chrome**

1. Reload the extension in `chrome://extensions`
2. Open the side panel on any article
3. **Text mode test:** Set mode to "Text", type a question, hit Send → response appears as text, no audio plays
4. **Voice mode test:** Set mode to "Voice", type a question, hit Send → response appears AND plays audio; "■ Stop" button appears in input bar and on the message bubble
5. **Auto mode test:** Set to "Auto", type → text only; click mic → voice reply
6. **Stop test:** During audio playback, click "■ Stop" in input bar → audio stops, button reverts to "Send"
7. **Recording state test:** Click mic button → input area shows bouncing dots + "Listening…" + Cancel button

**Step 5: Commit**

```bash
git add sidebar/ChatPanel.tsx
git commit -m "feat: redesign chat panel with mode toggle, mic button, stop controls"
```
