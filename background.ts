import Anthropic from "@anthropic-ai/sdk";
import { ElevenLabsClient } from "elevenlabs";
import type { MessageRequest, ExtractedPage, ChatMessage } from "./types";

/**
 * Keeps the service worker alive during long async operations by periodically
 * touching chrome.storage (which resets Chrome's idle timer).
 * Necessary for MV3 service workers where Claude + ElevenLabs latency can exceed 30s.
 */
async function withKeepalive<T>(fn: () => Promise<T>): Promise<T> {
  const interval = setInterval(() => {
    chrome.storage.local.get("_keepalive").catch(() => {});
  }, 20000);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}

const PRESET_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
];

const log = (...args: unknown[]) => console.log("[AI Narrator]", ...args);
const err = (...args: unknown[]) => console.error("[AI Narrator]", ...args);

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  log("Icon clicked, opening side panel for tab", tab.id);
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

async function getKeys(): Promise<{ claudeKey: string; elevenLabsKey: string }> {
  const result = await chrome.storage.local.get(["claudeKey", "elevenLabsKey"]);
  // Fall back to build-time env vars (from .env via Vite) if not set in storage
  const claudeKey: string = (result.claudeKey as string | undefined)
    || import.meta.env.VITE_CLAUDE_API_KEY
    || "";
  const elevenLabsKey: string = (result.elevenLabsKey as string | undefined)
    || import.meta.env.VITE_ELEVENLABS_API_KEY
    || "";
  log("Keys resolved — claude:", claudeKey ? `set (${claudeKey.slice(0, 10)}...)` : "MISSING",
    "| elevenlabs:", elevenLabsKey ? `set (${elevenLabsKey.slice(0, 8)}...)` : "MISSING");
  return { claudeKey, elevenLabsKey };
}

async function injectContentScriptIfNeeded(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    log("Content script already injected in tab", tabId);
  } catch {
    log("Injecting content script into tab", tabId);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
    log("Content script injected");
  }
}

async function buildNarrationText(page: ExtractedPage, claudeKey: string): Promise<string> {
  log("Claude: building narration text for", `"${page.title}"`, `(${page.content.length} chars)`);
  if (!claudeKey) err("Claude API key is not set");
  const client = new Anthropic({ apiKey: claudeKey, dangerouslyAllowBrowser: true });
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `You are a personal reading assistant. Rewrite the following article as clean, natural spoken prose. Remove navigation, footers, ads, and repetitive elements. Preserve all meaningful information. Write as if speaking aloud.`,
    messages: [{ role: "user", content: `Title: ${page.title}\n\n${page.content}` }],
  });
  const block = msg.content[0];
  const text = block.type === "text" ? block.text : "";
  log("Claude: narration ready", `(${text.length} chars, ${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out tokens)`);
  return text;
}

async function synthesizeSpeech(text: string, voiceId: string, elevenLabsKey: string): Promise<ArrayBuffer> {
  log("ElevenLabs: synthesizing speech", `(voice: ${voiceId}, ${text.length} chars)`);
  if (!elevenLabsKey) err("ElevenLabs API key is not set");
  const client = new ElevenLabsClient({ apiKey: elevenLabsKey });
  // convert() returns a stream.Readable per types, but in a Chrome extension service worker
  // (browser runtime) the underlying fetch returns a Web ReadableStream which supports
  // async iteration. We cast to AsyncIterable to consume it generically.
  const audioStream = await client.textToSpeech.convert(voiceId, {
    text,
    model_id: "eleven_turbo_v2",
    output_format: "mp3_44100_128",
  });
  const iterable = audioStream as unknown as AsyncIterable<Uint8Array>;
  const chunks: Uint8Array[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  log("ElevenLabs: audio ready", `(${(total / 1024).toFixed(1)} kB)`);
  return merged.buffer;
}

async function chatWithClaude(
  page: ExtractedPage,
  history: ChatMessage[],
  userMessage: string,
  claudeKey: string
): Promise<string> {
  log("Claude: chat request", `(history: ${history.length} turns, page: "${page.title}")`);
  if (!claudeKey) err("Claude API key is not set");
  const client = new Anthropic({ apiKey: claudeKey, dangerouslyAllowBrowser: true });
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
  const text = block.type === "text" ? block.text : "";
  log("Claude: chat response ready", `(${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out tokens)`);
  return text;
}

chrome.runtime.onMessage.addListener((message: MessageRequest, _sender, sendResponse) => {
  (async () => {
    log("Message received:", message.type);
    try {
      const { claudeKey, elevenLabsKey } = await getKeys();

      if (message.type === "GET_PAGE_CONTENT") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("No active tab");
        await injectContentScriptIfNeeded(tab.id);
        const result = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTENT" });
        if (result?.success) {
          log("Page extracted:", `"${result.data.title}"`, `(${result.data.readTimeMinutes} min read)`);
        } else {
          err("Page extraction failed:", result?.error);
        }
        sendResponse(result);

      } else if (message.type === "NARRATE") {
        log("Narrate: starting for", `"${message.page.title}"`);
        const audioBuffer = await withKeepalive(async () => {
          const narrationText = await buildNarrationText(message.page, claudeKey);
          return synthesizeSpeech(narrationText, message.voice, elevenLabsKey);
        });
        log("Narrate: complete");
        sendResponse({ success: true, data: { audioBuffer } });

      } else if (message.type === "CHAT") {
        log("Chat: user message:", `"${message.userMessage}"`);
        const { text: reply, audioBuffer } = await withKeepalive(async () => {
          const text = await chatWithClaude(message.page, message.history, message.userMessage, claudeKey);
          const audioBuffer = await synthesizeSpeech(text, message.voice, elevenLabsKey);
          return { text, audioBuffer };
        });
        log("Chat: response sent");
        sendResponse({ success: true, data: { text: reply, audioBuffer } });

      } else if (message.type === "GET_VOICES") {
        log("Returning", PRESET_VOICES.length, "preset voices");
        sendResponse({ success: true, data: PRESET_VOICES });

      } else if (message.type === "SET_KEYS") {
        await chrome.storage.local.set({
          claudeKey: message.claudeKey,
          elevenLabsKey: message.elevenLabsKey,
        });
        log("API keys saved");
        sendResponse({ success: true, data: null });
      }
    } catch (e) {
      err("Handler error for", message.type, "→", e);
      sendResponse({ success: false, error: String(e) });
    }
  })();
  return true; // keep channel open for async response
});
