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

    try {
      await audio.play();
      setState("PLAYING");
    } catch {
      URL.revokeObjectURL(url);
      audioRef.current = null;
      setState("IDLE");
      console.error("Audio playback blocked or failed");
    }
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
