import { useState, useRef, useCallback } from "react";
import type { ExtractedPage } from "../types";

export type NarratorState = "IDLE" | "LOADING" | "PLAYING" | "PAUSED" | "STOPPED";

const log = (...args: unknown[]) => console.log("[AI Narrator:narrator]", ...args);

export function useNarrator() {
  const [state, setState] = useState<NarratorState>("IDLE");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const pauseOffsetRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  function getOrCreateCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  // Stops the active source node without triggering the onended handler
  function stopSource() {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
  }

  function startSource(ctx: AudioContext, audioBuffer: AudioBuffer, offset = 0) {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (sourceRef.current === source) {
        log("Playback ended naturally");
        sourceRef.current = null;
        setState("IDLE");
      }
    };
    source.start(0, offset);
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime - offset;
  }

  const stop = useCallback(() => {
    log("stop()");
    stopSource();
    audioBufferRef.current = null;
    pauseOffsetRef.current = 0;
    setState("IDLE");
  }, []);

  const play = useCallback(async (page: ExtractedPage, voice: string) => {
    log("play() →", `"${page.title}"`, "voice:", voice);
    stopSource();
    audioBufferRef.current = null;
    pauseOffsetRef.current = 0;

    // Unlock AudioContext NOW, while we're still in the user gesture call stack
    const ctx = getOrCreateCtx();
    await ctx.resume();

    setState("LOADING");

    const response = await chrome.runtime.sendMessage({ type: "NARRATE", page, voice });
    if (!response?.success) {
      console.error("[AI Narrator:narrator] NARRATE failed:", response?.error);
      setState("IDLE");
      return;
    }

    const binary = atob(response.data.audioBase64 as string);
    const rawBuffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) rawBuffer[i] = binary.charCodeAt(i);
    log("Audio buffer received:", `${(rawBuffer.byteLength / 1024).toFixed(1)} kB`);

    const audioBuffer = await ctx.decodeAudioData(rawBuffer.buffer);
    audioBufferRef.current = audioBuffer;

    startSource(ctx, audioBuffer, 0);
    log("Playback started → PLAYING");
    setState("PLAYING");
  }, [stop]);

  const pause = useCallback(() => {
    log("pause()");
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    pauseOffsetRef.current = ctx.currentTime - startTimeRef.current;
    stopSource();
    setState("PAUSED");
  }, []);

  const resume = useCallback(() => {
    log("resume()");
    const ctx = audioCtxRef.current;
    const audioBuffer = audioBufferRef.current;
    if (!ctx || !audioBuffer) return;
    startSource(ctx, audioBuffer, pauseOffsetRef.current);
    setState("PLAYING");
  }, []);

  return { state, play, pause, resume, stop };
}
