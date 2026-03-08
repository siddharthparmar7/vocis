import { useState, useRef, useCallback } from "react";
import type { ExtractedPage } from "../types";

export type NarratorState = "IDLE" | "LOADING" | "PLAYING" | "PAUSED" | "STOPPED";

const log = (...args: unknown[]) => console.log("[AI Narrator:narrator]", ...args);

export function useNarrator() {
  const [state, setState] = useState<NarratorState>("IDLE");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    log("stop()");
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setState("IDLE");
  }, []);

  const play = useCallback(async (page: ExtractedPage, voice: string) => {
    log("play() →", `"${page.title}"`, "voice:", voice);
    stop();
    setState("LOADING");

    const response = await chrome.runtime.sendMessage({ type: "NARRATE", page, voice });
    if (!response?.success) {
      console.error("[AI Narrator:narrator] NARRATE failed:", response?.error);
      setState("IDLE");
      return;
    }

    const buffer: ArrayBuffer = response.data.audioBuffer;
    log("Audio buffer received:", `${(buffer.byteLength / 1024).toFixed(1)} kB`);
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.addEventListener("ended", () => {
      log("Playback ended");
      URL.revokeObjectURL(url);
      setState("IDLE");
    });

    try {
      await audio.play();
      log("Playback started → PLAYING");
      setState("PLAYING");
    } catch (e) {
      console.error("[AI Narrator:narrator] Audio playback blocked or failed:", e);
      URL.revokeObjectURL(url);
      audioRef.current = null;
      setState("IDLE");
    }
  }, [stop]);

  const pause = useCallback(() => {
    log("pause()");
    audioRef.current?.pause();
    setState("PAUSED");
  }, []);

  const resume = useCallback(() => {
    log("resume()");
    audioRef.current?.play();
    setState("PLAYING");
  }, []);

  return { state, play, pause, resume, stop };
}
