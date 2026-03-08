import { useState, useCallback, useRef } from "react";
import type { ChatMessage, ExtractedPage } from "../types";

const log = (...args: unknown[]) => console.log("[AI Narrator:chat]", ...args);

export function useChat(page: ExtractedPage | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inFlightRef = useRef(false);

  function getOrCreateCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  const send = useCallback(async (userText: string, voice: string) => {
    if (!page || !userText.trim() || inFlightRef.current) {
      if (inFlightRef.current) log("send() blocked — request already in flight");
      return;
    }

    log("send():", `"${userText}"`);
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
    });

    setLoading(false);
    inFlightRef.current = false;

    if (!response?.success) {
      console.error("[AI Narrator:chat] CHAT failed:", response?.error);
      return;
    }

    const { text, audioBuffer } = response.data as { text: string; audioBuffer: ArrayBuffer };
    log("Response received:", `"${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`);
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);

    // Play reply via AudioContext (immune to autoplay policy after ctx.resume() above)
    try {
      const decodedBuffer = await ctx.decodeAudioData(audioBuffer);
      const source = ctx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(ctx.destination);
      source.start(0);
      log("Playing audio response");
    } catch (e) {
      console.error("[AI Narrator:chat] Audio playback failed:", e);
    }
  }, [page]);

  return { messages, send, loading };
}
