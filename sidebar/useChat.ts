import { useState, useCallback, useRef } from "react";
import type { ChatMessage, ExtractedPage } from "../types";

const log = (...args: unknown[]) => console.log("[Vocis:chat]", ...args);

export function useChat(page: ExtractedPage | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const inFlightRef = useRef(false);
  const onAudioEndedRef = useRef<(() => void) | null>(null);

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

  const setOnAudioEnded = useCallback((cb: (() => void) | null) => {
    onAudioEndedRef.current = cb;
  }, []);

  const send = useCallback(async (userText: string, voice: string, voiceReply = true) => {
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
      console.error("[Vocis:chat] CHAT failed:", response?.error);
      onAudioEndedRef.current?.();
      return;
    }

    const { text, audioBase64 } = response.data as { text: string; audioBase64: string | null };
    log("Response received:", `"${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`);
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);

    if (!audioBase64) {
      // No audio — still fire the callback so conversation loop can continue
      onAudioEndedRef.current?.();
      return;
    }

    // Play reply via AudioContext (immune to autoplay policy after ctx.resume() above)
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
          onAudioEndedRef.current?.();
        }
      };
      source.start(0);
      sourceRef.current = source;
      setIsPlaying(true);
      log("Playing audio response");
    } catch (e) {
      console.error("[Vocis:chat] Audio playback failed:", e);
      onAudioEndedRef.current?.();
    }
  }, [page, stopAudio]);

  return { messages, send, loading, isPlaying, stopAudio, setOnAudioEnded };
}
