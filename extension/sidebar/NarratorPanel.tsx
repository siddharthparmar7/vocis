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
