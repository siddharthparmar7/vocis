import Anthropic from "@anthropic-ai/sdk";
import { ElevenLabsClient } from "elevenlabs";
import type { MessageRequest, ExtractedPage, ChatMessage } from "./types";

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
  const claudeKey: string = (result.claudeKey as string | undefined) ?? "";
  const elevenLabsKey: string = (result.elevenLabsKey as string | undefined) ?? "";
  return { claudeKey, elevenLabsKey };
}

async function injectContentScriptIfNeeded(tabId: number): Promise<void> {
  try {
    // Check if content script is already injected by pinging it
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    // Not injected yet — inject it now
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
  }
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

chrome.runtime.onMessage.addListener((message: MessageRequest, _sender, sendResponse) => {
  (async () => {
    try {
      const { claudeKey, elevenLabsKey } = await getKeys();

      if (message.type === "GET_PAGE_CONTENT") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("No active tab");
        await injectContentScriptIfNeeded(tab.id);
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
  return true; // keep channel open for async response
});
