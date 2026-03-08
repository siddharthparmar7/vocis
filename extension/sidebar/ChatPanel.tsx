import { useState, useRef } from "react";
import type { ExtractedPage } from "../types";
import { useChat } from "./useChat";

// Minimal local types for the Web Speech API (not in this project's DOM lib)
interface SpeechRecognitionResult {
  readonly 0: { transcript: string };
}
interface SpeechRecognitionResultList {
  readonly 0: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  readonly results: SpeechRecognitionResultList;
}
interface ISpeechRecognition {
  lang: string;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
}
interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: ISpeechRecognitionConstructor;
    webkitSpeechRecognition?: ISpeechRecognitionConstructor;
  }
}

type Props = {
  page: ExtractedPage | null;
  voice: string;
};

export function ChatPanel({ page, voice }: Props) {
  const { messages, send, loading } = useChat(page);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const recogRef = useRef<ISpeechRecognition | null>(null);

  function startListening() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recog = new Ctor();
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      send(transcript, voice);
    };
    recog.onend = () => setListening(false);
    recogRef.current = recog;
    recog.start();
    setListening(true);
  }

  function handleSend() {
    if (!input.trim()) return;
    send(input, voice);
    setInput("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Ask anything about this page.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm rounded px-3 py-2 max-w-[85%] ${
              m.role === "user"
                ? "ml-auto bg-blue-100 text-blue-900"
                : "mr-auto bg-gray-100 text-gray-800"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="mr-auto bg-gray-100 text-gray-400 text-xs px-3 py-2 rounded">
            Thinking…
          </div>
        )}
      </div>

      <div className="border-t p-2 flex gap-2">
        <input
          className="flex-1 text-sm border rounded px-2 py-1"
          placeholder="Ask about this page…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={!page}
        />
        <button
          className={`text-sm px-2 py-1 rounded border ${listening ? "bg-red-100" : "bg-gray-100"}`}
          onClick={startListening}
          disabled={!page || listening}
          title="Voice input"
        >
          🎤
        </button>
        <button
          className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={handleSend}
          disabled={!page || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
