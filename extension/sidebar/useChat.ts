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
