import { useState, useCallback, useRef } from "react";
import type { ChatMessage, ExtractedPage } from "../types";

export function useChat(page: ExtractedPage | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inFlightRef = useRef(false);

  const send = useCallback(async (userText: string, voice: string) => {
    if (!page || !userText.trim() || inFlightRef.current) return;

    inFlightRef.current = true;
    const userMessage: ChatMessage = { role: "user", content: userText };

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
      console.error("Chat failed:", response?.error);
      return;
    }

    const { text, audioBuffer } = response.data as { text: string; audioBuffer: ArrayBuffer };
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);

    // Play reply audio
    audioRef.current?.pause();
    const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    try {
      await audio.play();
    } catch {
      URL.revokeObjectURL(url);
      audioRef.current = null;
    }
  }, [page]);

  return { messages, send, loading };
}
