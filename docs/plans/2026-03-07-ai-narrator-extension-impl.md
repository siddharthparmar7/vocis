# AI Narrator Chrome Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome MV3 extension with a sidebar panel that extracts page content, narrates it via ElevenLabs TTS, and opens a persistent voice/text chat with Claude using the page as context.

**Architecture:** Content script extracts readable text via Readability.js and sends it to a background service worker on demand. The background worker is the sole holder of API keys and handles all calls to Claude and ElevenLabs. The sidebar (React + TypeScript) is pure UI — all chrome.runtime messaging is encapsulated in custom hooks.

**Tech Stack:** Chrome MV3, React 18, TypeScript, Vite + vite-plugin-web-extension, Tailwind CSS, Mozilla Readability.js, @anthropic-ai/sdk, elevenlabs npm package, Web Speech API

---

## Project Bootstrap

### Task 1: Scaffold the project

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/vite.config.ts`
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/sidebar/index.html`

**Step 1: Initialize the project**

```bash
mkdir -p extension/sidebar
cd extension
npm init -y
npm install react react-dom
npm install -D typescript vite vite-plugin-web-extension @types/react @types/react-dom @types/chrome tailwindcss autoprefixer postcss
npx tailwindcss init -p
```

**Step 2: Create `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "AI Narrator",
  "version": "0.1.0",
  "description": "Narrate any webpage and chat with Claude about it.",
  "permissions": ["sidePanel", "activeTab", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "side_panel": {
    "default_path": "sidebar/index.html"
  },
  "action": {
    "default_title": "Open AI Narrator"
  }
}
```

**Step 3: Create `extension/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: "manifest.json",
      additionalInputs: ["sidebar/index.html"],
    }),
  ],
});
```

**Step 4: Create `extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

**Step 5: Create `extension/sidebar/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Narrator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

**Step 6: Configure Tailwind — add to `extension/tailwind.config.js`**

```js
export default {
  content: ["./sidebar/**/*.{ts,tsx,html}"],
  theme: { extend: {} },
  plugins: [],
};
```

**Step 7: Verify build runs**

```bash
cd extension && npm run build
```

Expected: `dist/` directory created, no errors.

**Step 8: Commit**

```bash
git add extension/
git commit -m "feat: scaffold Chrome MV3 extension with Vite"
```

---

## Task 2: Content Script — page extraction

**Files:**
- Create: `extension/content-script.ts`

**Context:** This file is injected into every page. It uses Readability.js to strip nav/ads/footers and return clean article text. It listens for `EXTRACT_CONTENT` messages from the sidebar hooks (via background) and responds with `{ title, content, readTimeMinutes }`.

**Step 1: Install Readability**

```bash
cd extension && npm install @mozilla/readability
npm install -D @types/mozilla-readability
```

**Step 2: Write `extension/content-script.ts`**

```typescript
import { Readability } from "@mozilla/readability";

function extractContent(): { title: string; content: string; readTimeMinutes: number } {
  const documentClone = document.cloneNode(true) as Document;
  const reader = new Readability(documentClone);
  const article = reader.parse();

  const title = article?.title ?? document.title;
  const content = article?.textContent?.trim() ?? document.body.innerText.trim();
  const wordCount = content.split(/\s+/).length;
  const readTimeMinutes = Math.ceil(wordCount / 200); // ~200 wpm

  return { title, content, readTimeMinutes };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTENT") {
    try {
      sendResponse({ success: true, data: extractContent() });
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
    return true; // keep channel open for async
  }
});
```

**Step 3: Verify TypeScript compiles**

```bash
cd extension && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add extension/content-script.ts
git commit -m "feat: add content script with Readability.js extraction"
```

---

## Task 3: Background Service Worker — message router + API calls

**Files:**
- Create: `extension/background.ts`

**Context:** This is the ONLY file that calls Claude and ElevenLabs. It receives typed messages from sidebar hooks, makes API calls, and streams responses back. API keys come from `chrome.storage.local`. Never expose keys to the sidebar.

**Step 1: Install SDKs**

```bash
cd extension && npm install @anthropic-ai/sdk elevenlabs
```

**Step 2: Define shared message types — create `extension/types.ts`**

```typescript
export type ExtractedPage = {
  title: string;
  content: string;
  readTimeMinutes: number;
};

export type MessageRequest =
  | { type: "GET_PAGE_CONTENT" }
  | { type: "NARRATE"; page: ExtractedPage; voice: string }
  | { type: "CHAT"; page: ExtractedPage; history: ChatMessage[]; userMessage: string; voice: string }
  | { type: "GET_VOICES" }
  | { type: "SET_KEYS"; claudeKey: string; elevenLabsKey: string };

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type MessageResponse =
  | { success: true; data: unknown }
  | { success: false; error: string };
```

**Step 3: Write `extension/background.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { ElevenLabsClient } from "elevenlabs";
import type { MessageRequest, ExtractedPage, ChatMessage } from "./types";

// Curated voice presets
const PRESET_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
];

async function getKeys(): Promise<{ claudeKey: string; elevenLabsKey: string }> {
  const result = await chrome.storage.local.get(["claudeKey", "elevenLabsKey"]);
  return { claudeKey: result.claudeKey ?? "", elevenLabsKey: result.elevenLabsKey ?? "" };
}

async function buildNarrationText(page: ExtractedPage, claudeKey: string): Promise<string> {
  const client = new Anthropic({ apiKey: claudeKey });
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `You are a personal reading assistant. Rewrite the following article as clean, natural spoken prose. Remove navigation, footers, ads, and repetitive elements. Preserve all meaningful information. Write as if speaking aloud.`,
    messages: [{ role: "user", content: `Title: ${page.title}\n\n${page.content}` }],
  });
  const block = msg.content[0];
  return block.type === "text" ? block.text : "";
}

async function synthesizeSpeech(text: string, voiceId: string, elevenLabsKey: string): Promise<ArrayBuffer> {
  const client = new ElevenLabsClient({ apiKey: elevenLabsKey });
  const audioStream = await client.textToSpeech.convert(voiceId, {
    text,
    model_id: "eleven_turbo_v2",
    output_format: "mp3_44100_128",
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.buffer;
}

async function chatWithClaude(
  page: ExtractedPage,
  history: ChatMessage[],
  userMessage: string,
  claudeKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey: claudeKey });
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are a personal reading assistant. The user is on a webpage.\n\nPage title: ${page.title}\n\nFull page content:\n${page.content}\n\nAnswer questions about this page. Be concise.`,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ],
  });
  const block = msg.content[0];
  return block.type === "text" ? block.text : "";
}

chrome.runtime.onMessage.addListener((message: MessageRequest, sender, sendResponse) => {
  (async () => {
    try {
      const { claudeKey, elevenLabsKey } = await getKeys();

      if (message.type === "GET_PAGE_CONTENT") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("No active tab");
        const result = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTENT" });
        sendResponse(result);

      } else if (message.type === "NARRATE") {
        const narrationText = await buildNarrationText(message.page, claudeKey);
        const audioBuffer = await synthesizeSpeech(narrationText, message.voice, elevenLabsKey);
        sendResponse({ success: true, data: { audioBuffer } });

      } else if (message.type === "CHAT") {
        const reply = await chatWithClaude(message.page, message.history, message.userMessage, claudeKey);
        const audioBuffer = await synthesizeSpeech(reply, message.voice, elevenLabsKey);
        sendResponse({ success: true, data: { text: reply, audioBuffer } });

      } else if (message.type === "GET_VOICES") {
        sendResponse({ success: true, data: PRESET_VOICES });

      } else if (message.type === "SET_KEYS") {
        await chrome.storage.local.set({
          claudeKey: message.claudeKey,
          elevenLabsKey: message.elevenLabsKey,
        });
        sendResponse({ success: true, data: null });
      }
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
  })();
  return true; // async response
});
```

**Step 4: Verify TypeScript compiles**

```bash
cd extension && npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add extension/background.ts extension/types.ts
git commit -m "feat: add background service worker with Claude + ElevenLabs integration"
```

---

## Task 4: `usePageContent` hook

**Files:**
- Create: `extension/sidebar/usePageContent.ts`

**Context:** This hook asks the background worker for the current page's extracted content. It exposes `{ page, loading, error, refresh }`. Components never call chrome.runtime directly.

**Step 1: Write `extension/sidebar/usePageContent.ts`**

```typescript
import { useState, useEffect, useCallback } from "react";
import type { ExtractedPage } from "../types";

type State =
  | { status: "loading" }
  | { status: "ready"; page: ExtractedPage }
  | { status: "error"; message: string };

export function usePageContent() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const response = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT" });
    if (response?.success) {
      setState({ status: "ready", page: response.data as ExtractedPage });
    } else {
      setState({ status: "error", message: response?.error ?? "Failed to extract page content" });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return {
    page: state.status === "ready" ? state.page : null,
    loading: state.status === "loading",
    error: state.status === "error" ? state.message : null,
    refresh: load,
  };
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd extension && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add extension/sidebar/usePageContent.ts
git commit -m "feat: add usePageContent hook"
```

---

## Task 5: `useNarrator` hook — narrator state machine

**Files:**
- Create: `extension/sidebar/useNarrator.ts`

**Context:** Manages the `IDLE → LOADING → PLAYING → PAUSED → IDLE` state machine. Calls `NARRATE` message to background, receives an ArrayBuffer of MP3 audio, plays it via Web Audio API. Exposes `{ state, play, pause, resume, stop }`.

**Step 1: Write `extension/sidebar/useNarrator.ts`**

```typescript
import { useState, useRef, useCallback } from "react";
import type { ExtractedPage } from "../types";

export type NarratorState = "IDLE" | "LOADING" | "PLAYING" | "PAUSED" | "STOPPED";

export function useNarrator() {
  const [state, setState] = useState<NarratorState>("IDLE");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setState("IDLE");
  }, []);

  const play = useCallback(async (page: ExtractedPage, voice: string) => {
    stop();
    setState("LOADING");

    const response = await chrome.runtime.sendMessage({ type: "NARRATE", page, voice });
    if (!response?.success) {
      setState("IDLE");
      console.error("Narration failed:", response?.error);
      return;
    }

    const buffer: ArrayBuffer = response.data.audioBuffer;
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.addEventListener("ended", () => {
      URL.revokeObjectURL(url);
      setState("IDLE");
    });

    audio.play();
    setState("PLAYING");
  }, [stop]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState("PAUSED");
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play();
    setState("PLAYING");
  }, []);

  return { state, play, pause, resume, stop };
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd extension && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add extension/sidebar/useNarrator.ts
git commit -m "feat: add useNarrator hook with IDLE/LOADING/PLAYING/PAUSED state machine"
```

---

## Task 6: `useChat` hook

**Files:**
- Create: `extension/sidebar/useChat.ts`

**Context:** Sends user messages (text or transcribed voice) to the background worker alongside page context and conversation history. Receives `{ text, audioBuffer }` back — plays the audio and appends both turns to history. Exposes `{ messages, send, loading }`.

**Step 1: Write `extension/sidebar/useChat.ts`**

```typescript
import { useState, useCallback, useRef } from "react";
import type { ChatMessage, ExtractedPage } from "../types";

export function useChat(page: ExtractedPage | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const send = useCallback(async (userText: string, voice: string) => {
    if (!page || !userText.trim()) return;

    const userMessage: ChatMessage = { role: "user", content: userText };
    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setLoading(true);

    const response = await chrome.runtime.sendMessage({
      type: "CHAT",
      page,
      history: messages,
      userMessage: userText,
      voice,
    });

    setLoading(false);

    if (!response?.success) {
      console.error("Chat failed:", response?.error);
      return;
    }

    const { text, audioBuffer } = response.data as { text: string; audioBuffer: ArrayBuffer };
    setMessages([...nextHistory, { role: "assistant", content: text }]);

    // Play reply audio
    audioRef.current?.pause();
    const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    audio.play();
  }, [page, messages]);

  return { messages, send, loading };
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd extension && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add extension/sidebar/useChat.ts
git commit -m "feat: add useChat hook with history management and audio playback"
```

---

## Task 7: `NarratorPanel` component

**Files:**
- Create: `extension/sidebar/NarratorPanel.tsx`

**Context:** Shows page title, estimated read time, voice picker dropdown, and play/pause/stop controls. Calls `useNarrator` — never calls chrome.runtime directly. Receives `page`, `voice`, `onVoiceChange` as props.

**Step 1: Write `extension/sidebar/NarratorPanel.tsx`**

```tsx
import { useNarrator } from "./useNarrator";
import type { ExtractedPage } from "../types";

const PRESET_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
];

type Props = {
  page: ExtractedPage;
  voice: string;
  onVoiceChange: (id: string) => void;
};

export function NarratorPanel({ page, voice, onVoiceChange }: Props) {
  const { state, play, pause, resume, stop } = useNarrator();

  return (
    <div className="p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold truncate">{page.title}</h2>
        <p className="text-xs text-gray-500">{page.readTimeMinutes} min read</p>
      </div>

      <select
        className="w-full text-sm border rounded px-2 py-1"
        value={voice}
        onChange={(e) => onVoiceChange(e.target.value)}
        disabled={state === "PLAYING" || state === "LOADING"}
      >
        {PRESET_VOICES.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>

      <div className="flex gap-2">
        {state === "IDLE" && (
          <button
            className="flex-1 bg-blue-600 text-white text-sm rounded py-1 hover:bg-blue-700"
            onClick={() => play(page, voice)}
          >
            ▶ Narrate
          </button>
        )}
        {state === "LOADING" && (
          <button className="flex-1 bg-gray-300 text-sm rounded py-1" disabled>
            Loading…
          </button>
        )}
        {state === "PLAYING" && (
          <>
            <button
              className="flex-1 bg-yellow-500 text-white text-sm rounded py-1 hover:bg-yellow-600"
              onClick={pause}
            >
              ⏸ Pause
            </button>
            <button
              className="flex-1 bg-red-500 text-white text-sm rounded py-1 hover:bg-red-600"
              onClick={stop}
            >
              ⏹ Stop
            </button>
          </>
        )}
        {state === "PAUSED" && (
          <>
            <button
              className="flex-1 bg-green-600 text-white text-sm rounded py-1 hover:bg-green-700"
              onClick={resume}
            >
              ▶ Resume
            </button>
            <button
              className="flex-1 bg-red-500 text-white text-sm rounded py-1 hover:bg-red-600"
              onClick={stop}
            >
              ⏹ Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd extension && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add extension/sidebar/NarratorPanel.tsx
git commit -m "feat: add NarratorPanel component with play/pause/stop controls"
```

---

## Task 8: `ChatPanel` component

**Files:**
- Create: `extension/sidebar/ChatPanel.tsx`

**Context:** Renders the conversation thread and an input row with a text field and mic button (Web Speech API). On mic press, uses `SpeechRecognition` to transcribe, then calls `useChat.send`. Always available regardless of narrator state.

**Step 1: Write `extension/sidebar/ChatPanel.tsx`**

```tsx
import { useState, useRef } from "react";
import type { ChatMessage, ExtractedPage } from "../types";
import { useChat } from "./useChat";

type Props = {
  page: ExtractedPage | null;
  voice: string;
};

export function ChatPanel({ page, voice }: Props) {
  const { messages, send, loading } = useChat(page);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const recogRef = useRef<SpeechRecognition | null>(null);

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recog = new SpeechRecognition();
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      send(transcript, voice);
    };
    recog.onend = () => setListening(false);
    recogRef.current = recog;
    recog.start();
    setListening(true);
  }

  function handleSend() {
    if (!input.trim()) return;
    send(input, voice);
    setInput("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Ask anything about this page.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm rounded px-3 py-2 max-w-[85%] ${
              m.role === "user"
                ? "ml-auto bg-blue-100 text-blue-900"
                : "mr-auto bg-gray-100 text-gray-800"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="mr-auto bg-gray-100 text-gray-400 text-xs px-3 py-2 rounded">
            Thinking…
          </div>
        )}
      </div>

      <div className="border-t p-2 flex gap-2">
        <input
          className="flex-1 text-sm border rounded px-2 py-1"
          placeholder="Ask about this page…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={!page}
        />
        <button
          className={`text-sm px-2 py-1 rounded border ${listening ? "bg-red-100" : "bg-gray-100"}`}
          onClick={startListening}
          disabled={!page || listening}
          title="Voice input"
        >
          🎤
        </button>
        <button
          className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={handleSend}
          disabled={!page || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd extension && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add extension/sidebar/ChatPanel.tsx
git commit -m "feat: add ChatPanel with text and voice input"
```

---

## Task 9: Root `App.tsx` and sidebar entry point

**Files:**
- Create: `extension/sidebar/App.tsx`
- Create: `extension/sidebar/main.tsx`
- Create: `extension/sidebar/index.css`

**Context:** `App.tsx` wires together `usePageContent`, voice state (persisted to `chrome.storage.sync`), and renders `NarratorPanel` + `ChatPanel` stacked vertically. `main.tsx` is the React entry point.

**Step 1: Write `extension/sidebar/App.tsx`**

```tsx
import { useState, useEffect } from "react";
import { usePageContent } from "./usePageContent";
import { NarratorPanel } from "./NarratorPanel";
import { ChatPanel } from "./ChatPanel";

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel

export function App() {
  const { page, loading, error } = usePageContent();
  const [voice, setVoice] = useState(DEFAULT_VOICE);

  useEffect(() => {
    chrome.storage.sync.get(["selectedVoice"]).then((result) => {
      if (result.selectedVoice) setVoice(result.selectedVoice);
    });
  }, []);

  function handleVoiceChange(id: string) {
    setVoice(id);
    chrome.storage.sync.set({ selectedVoice: id });
  }

  return (
    <div className="flex flex-col h-screen text-gray-900 bg-white">
      <header className="p-3 border-b flex items-center justify-between">
        <span className="text-sm font-bold">AI Narrator</span>
      </header>

      {loading && (
        <div className="p-4 text-sm text-gray-400">Extracting page content…</div>
      )}
      {error && (
        <div className="p-4 text-sm text-red-500">Error: {error}</div>
      )}
      {page && (
        <>
          <NarratorPanel page={page} voice={voice} onVoiceChange={handleVoiceChange} />
          <div className="border-t flex-1 flex flex-col overflow-hidden">
            <ChatPanel page={page} voice={voice} />
          </div>
        </>
      )}
    </div>
  );
}
```

**Step 2: Write `extension/sidebar/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Step 3: Write `extension/sidebar/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  margin: 0;
  font-family: system-ui, sans-serif;
}
```

**Step 4: Verify TypeScript compiles and build succeeds**

```bash
cd extension && npx tsc --noEmit && npm run build
```

Expected: `dist/` built with no errors.

**Step 5: Commit**

```bash
git add extension/sidebar/App.tsx extension/sidebar/main.tsx extension/sidebar/index.css
git commit -m "feat: add App root component and sidebar entry point"
```

---

## Task 10: Settings / API key input

**Files:**
- Create: `extension/sidebar/SettingsPanel.tsx`

**Context:** Users need to enter their Claude and ElevenLabs API keys. Show a settings gear icon in the header that toggles a simple form. Keys are sent to background via `SET_KEYS` and stored in `chrome.storage.local`. No keys are ever held in sidebar state beyond the form inputs.

**Step 1: Write `extension/sidebar/SettingsPanel.tsx`**

```tsx
import { useState } from "react";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [claudeKey, setClaudeKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await chrome.runtime.sendMessage({ type: "SET_KEYS", claudeKey, elevenLabsKey });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1000);
  }

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-sm font-semibold">API Keys</h2>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Anthropic (Claude) API Key</label>
        <input
          type="password"
          className="w-full text-sm border rounded px-2 py-1"
          placeholder="sk-ant-..."
          value={claudeKey}
          onChange={(e) => setClaudeKey(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">ElevenLabs API Key</label>
        <input
          type="password"
          className="w-full text-sm border rounded px-2 py-1"
          placeholder="..."
          value={elevenLabsKey}
          onChange={(e) => setElevenLabsKey(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 bg-blue-600 text-white text-sm rounded py-1 hover:bg-blue-700"
          onClick={handleSave}
        >
          {saved ? "Saved!" : "Save Keys"}
        </button>
        <button
          className="flex-1 border text-sm rounded py-1 hover:bg-gray-50"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Wire settings toggle into `App.tsx`**

Add `showSettings` state and a gear button to the header in `App.tsx`:

```tsx
// Add to imports
import { SettingsPanel } from "./SettingsPanel";

// Add inside App():
const [showSettings, setShowSettings] = useState(false);

// Replace header content:
<header className="p-3 border-b flex items-center justify-between">
  <span className="text-sm font-bold">AI Narrator</span>
  <button
    className="text-gray-400 hover:text-gray-700 text-lg"
    onClick={() => setShowSettings((s) => !s)}
    title="Settings"
  >
    ⚙
  </button>
</header>

// Add after header:
{showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
```

**Step 3: Build and verify**

```bash
cd extension && npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add extension/sidebar/SettingsPanel.tsx extension/sidebar/App.tsx
git commit -m "feat: add settings panel for API key configuration"
```

---

## Task 11: Load the extension in Chrome and smoke test

**No code — manual verification step.**

**Step 1: Build**

```bash
cd extension && npm run build
```

**Step 2: Load in Chrome**
1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked** → select `extension/dist/`

**Step 3: Enter API keys**
1. Click the extension icon → open sidebar
2. Click ⚙ settings → enter Claude and ElevenLabs keys → Save

**Step 4: Test narration**
1. Navigate to any article (e.g. a Wikipedia page)
2. Open sidebar → verify page title and read time appear
3. Select a voice → click ▶ Narrate
4. Verify audio plays within ~2 seconds
5. Test Pause / Resume / Stop

**Step 5: Test chat**
1. Type a question about the page → press Enter
2. Verify Claude responds with page-relevant answer
3. Verify ElevenLabs reads the response aloud
4. Click 🎤 → speak a question → verify same flow

**Step 6: Commit if all passes**

```bash
git commit --allow-empty -m "chore: smoke test passed, v0.1 working"
```

---

## Summary

| Task | Deliverable |
|------|-------------|
| 1 | Project scaffolded, build working |
| 2 | Content script with Readability.js extraction |
| 3 | Background worker: Claude + ElevenLabs + message routing |
| 4 | `usePageContent` hook |
| 5 | `useNarrator` hook + state machine |
| 6 | `useChat` hook |
| 7 | `NarratorPanel` component |
| 8 | `ChatPanel` component with voice input |
| 9 | `App.tsx` root + sidebar entry point |
| 10 | Settings panel for API keys |
| 11 | Manual smoke test |

**Out of scope for this plan (v1):** offline TTS, multi-tab persistence, options page, mobile/Firefox support.
