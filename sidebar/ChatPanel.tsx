import { useState, useRef, useEffect, useCallback } from "react";
import type { ExtractedPage } from "../types";
import { useChat } from "./useChat";

type ChatMode = "auto" | "text" | "voice";

type Props = {
  page: ExtractedPage | null;
  voice: string;
};

export function ChatPanel({ page, voice }: Props) {
  const { messages, send, loading, isPlaying, stopAudio, setOnAudioEnded, error: chatError, clearError: clearChatError } = useChat(page);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState<ChatMode>("auto");
  const [conversationActive, setConversationActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<ChatMode>("auto");
  const conversationActiveRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { conversationActiveRef.current = conversationActive; }, [conversationActive]);

  const playingMsgIndex = isPlaying
    ? messages
        .map((m, i) => (m.role === "assistant" ? i : -1))
        .filter((i) => i >= 0)
        .at(-1) ?? -1
    : -1;

  // Load persisted mode
  useEffect(() => {
    chrome.storage.sync.get(["chatMode"]).then((r) => {
      if (r.chatMode === "text" || r.chatMode === "voice" || r.chatMode === "auto") {
        setMode(r.chatMode as ChatMode);
      }
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Send a message to the content script in the active tab.
  // Speech recognition runs there (web-page context → inherits page's mic permission).
  const speechMessage = useCallback((msg: Record<string, unknown>) => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    });
  }, []);

  function persistMode(m: ChatMode) {
    setMode(m);
    chrome.storage.sync.set({ chatMode: m });
    if (m !== "voice" && conversationActiveRef.current) {
      endConversation();
    }
  }

  function resolveVoiceReply(fromMic: boolean): boolean {
    if (modeRef.current === "text") return false;
    if (modeRef.current === "voice") return true;
    return fromMic; // auto
  }

  const endConversation = useCallback(() => {
    setConversationActive(false);
    conversationActiveRef.current = false;
    setOnAudioEnded(null);
    speechMessage({ type: "SPEECH_STOP" });
    setListening(false);
    setInterimTranscript("");
    stopAudio();
  }, [setOnAudioEnded, stopAudio, speechMessage]);

  useEffect(() => {
    return () => { endConversation(); };
  }, [endConversation]);

  // Receive speech results from the content script
  useEffect(() => {
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === "SPEECH_RESULT" && typeof msg.transcript === "string") {
        setInterimTranscript("");
        // Mic always means voiceReply=true unless text mode
        send(msg.transcript, voice, modeRef.current !== "text");
      } else if (msg.type === "SPEECH_END") {
        setInterimTranscript("");
        setListening(false);
      } else if (msg.type === "SPEECH_INTERIM" && typeof msg.transcript === "string") {
        setInterimTranscript(msg.transcript);
      } else if (msg.type === "SPEECH_ERROR") {
        const error = String(msg.error ?? "");
        if (error === "not-allowed") {
          setMicError("Microphone access denied. Click the mic icon in the address bar to allow.");
        } else if (error === "audio-capture") {
          setMicError("No microphone found.");
        } else if (error === "not-supported") {
          setMicError("Speech recognition not supported in this browser.");
        }
        setListening(false);
        if (conversationActiveRef.current) endConversation();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [send, voice, endConversation]);

  const startListening = useCallback(() => {
    setMicError(null);
    speechMessage({ type: "SPEECH_START", lang: "en-US" });
    setListening(true);
  }, [speechMessage]);

  function handleMicClick() {
    if (modeRef.current === "voice") {
      // Voice mode: enter conversation loop
      setConversationActive(true);
      conversationActiveRef.current = true;
      setOnAudioEnded(() => {
        if (conversationActiveRef.current) startListening();
      });
      startListening();
    } else {
      // Auto/Text mode: single-shot
      startListening();
    }
  }

  function cancelListening() {
    speechMessage({ type: "SPEECH_STOP" });
    setListening(false);
    setInterimTranscript("");
    if (conversationActiveRef.current) endConversation();
  }

  function handleSend() {
    if (!input.trim()) return;
    send(input, voice, resolveVoiceReply(false));
    setInput("");
  }

  type BarState = "idle" | "recording" | "loading" | "playing" | "conversation";
  const barState: BarState = conversationActive && !listening && !loading && !isPlaying
    ? "conversation"
    : listening
    ? "recording"
    : loading
    ? "loading"
    : isPlaying
    ? "playing"
    : "idle";

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Ask anything about this page.
          </p>
        )}
        {messages.map((m, i) => {
          const isActiveAudio =
            isPlaying && m.role === "assistant" && playingMsgIndex === i;
          return (
            <div key={i} className="relative">
              <div
                className={`text-sm rounded px-3 py-2 max-w-[85%] ${
                  m.role === "user"
                    ? "ml-auto bg-blue-100 text-blue-900"
                    : "mr-auto bg-gray-100 text-gray-800"
                }`}
              >
                {m.content}
              </div>
              {isActiveAudio && (
                <button
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-gray-300 hover:bg-gray-400 text-gray-700"
                  onClick={stopAudio}
                  title="Stop audio"
                >
                  <svg viewBox="0 0 10 10" className="w-3 h-3 fill-current">
                    <rect x="1" y="1" width="8" height="8" rx="1" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="mr-auto bg-gray-100 text-gray-400 text-xs px-3 py-2 rounded">
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Chat API error banner */}
      {chatError && (
        <div className="mx-3 mb-1 px-3 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-center justify-between">
          <span className="truncate">{chatError}</span>
          <button onClick={clearChatError} className="ml-2 flex-shrink-0 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Mic error banner */}
      {micError && (
        <div className="mx-3 mb-1 px-3 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-center justify-between">
          <span>{micError}</span>
          <button onClick={() => setMicError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Mode toggle */}
      <div className="px-3 pt-2 flex justify-end">
        <div className="flex text-xs rounded-full border border-gray-200 overflow-hidden">
          {(["auto", "text", "voice"] as ChatMode[]).map((m) => (
            <button
              key={m}
              onClick={() => persistMode(m)}
              className={`px-2 py-0.5 capitalize transition-colors ${
                mode === m
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t p-2">
        {barState === "recording" ? (
          <div className="flex items-center gap-2 h-9">
            <div className="flex-1 flex items-center gap-1.5 px-3 min-w-0">
              {!interimTranscript && [0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-red-500 animate-bounce flex-shrink-0"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
              <span className="text-xs text-gray-500 ml-1 truncate">
                {interimTranscript || "Listening…"}
              </span>
            </div>
            <button
              className="text-sm px-3 py-1 border rounded text-gray-600 hover:bg-gray-100"
              onClick={cancelListening}
            >
              ✕ {conversationActive ? "End" : "Cancel"}
            </button>
          </div>
        ) : barState === "conversation" ? (
          <div className="flex items-center gap-2 h-9">
            <div className="flex-1 flex items-center gap-2 px-3">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-gray-500">In conversation — speak anytime</span>
            </div>
            <button
              className="text-sm px-3 py-1 bg-red-100 border border-red-300 rounded text-red-600 hover:bg-red-200"
              onClick={endConversation}
            >
              End
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              className="flex-1 text-sm border rounded px-2 py-1"
              placeholder="Ask about this page…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && barState === "idle" && handleSend()
              }
              disabled={!page || barState !== "idle"}
            />

            {/* Circular SVG mic button */}
            <button
              className={`w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${
                mode === "voice"
                  ? "bg-blue-50 border-blue-400 hover:bg-blue-100"
                  : "bg-gray-100 border-gray-300 hover:bg-gray-200"
              }`}
              onClick={handleMicClick}
              disabled={!page || barState !== "idle"}
              title={mode === "voice" ? "Start voice conversation" : "Voice input"}
            >
              <svg
                viewBox="0 0 24 24"
                className={`w-4 h-4 fill-none stroke-current ${mode === "voice" ? "text-blue-600" : ""}`}
                strokeWidth="2"
              >
                <rect x="9" y="2" width="6" height="11" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" strokeLinecap="round" />
                <line x1="12" y1="17" x2="12" y2="21" strokeLinecap="round" />
                <line x1="9" y1="21" x2="15" y2="21" strokeLinecap="round" />
              </svg>
            </button>

            {/* Send / Stop / Loading */}
            {barState === "playing" ? (
              <button
                className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-1"
                onClick={conversationActive ? endConversation : stopAudio}
              >
                <svg viewBox="0 0 10 10" className="w-3 h-3 fill-current">
                  <rect x="1" y="1" width="8" height="8" rx="1" />
                </svg>
                Stop
              </button>
            ) : barState === "loading" ? (
              <>
                <button
                  className="text-sm px-3 py-1 bg-gray-300 text-gray-500 rounded"
                  disabled
                >
                  …
                </button>
                {conversationActive && (
                  <button
                    className="text-sm px-3 py-1 bg-red-100 border border-red-300 rounded text-red-600 hover:bg-red-200"
                    onClick={endConversation}
                  >
                    End
                  </button>
                )}
              </>
            ) : (
              <button
                className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                onClick={handleSend}
                disabled={!page || !input.trim()}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-3 h-3 fill-none stroke-current"
                  strokeWidth="2"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                Send
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
