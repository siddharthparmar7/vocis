import { useState, useEffect } from "react";
import { useKeyStatus } from "./useKeyStatus";
import { usePageContent } from "./usePageContent";
import { NarratorPanel } from "./NarratorPanel";
import { ChatPanel } from "./ChatPanel";
import { SettingsPanel } from "./SettingsPanel";

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel

export function App() {
  const { keysSet, keysLoading, claudeKey, elevenLabsKey, refresh } = useKeyStatus();
  const { page, loading, error } = usePageContent({ enabled: keysSet });
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get(["selectedVoice"]).then((result) => {
      if (typeof result.selectedVoice === "string") setVoice(result.selectedVoice);
    });
  }, []);

  function handleVoiceChange(id: string) {
    setVoice(id);
    chrome.storage.sync.set({ selectedVoice: id });
  }

  // Spinner while reading stored keys
  if (keysLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  // First-run gate: keys not set yet
  if (!keysSet) {
    return (
      <div className="flex flex-col h-screen text-gray-900 bg-white">
        <SettingsPanel firstRun={true} onSaved={refresh} />
      </div>
    );
  }

  // Normal render: keys are set
  return (
    <div className="flex flex-col h-screen text-gray-900 bg-white">
      <header className="p-3 border-b flex items-center justify-between">
        <span className="text-sm font-bold">Vocis</span>
        <button
          className="text-gray-400 hover:text-gray-700 text-lg"
          onClick={() => setShowSettings((s) => !s)}
          title="Settings"
        >
          ⚙
        </button>
      </header>

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onSaved={refresh}
          claudeKey={claudeKey}
          elevenLabsKey={elevenLabsKey}
        />
      )}

      {!showSettings && (
        <>
          {loading && (
            <div className="p-4 text-sm text-gray-400">Extracting page content…</div>
          )}
          {error && (
            <div className="p-4 text-sm text-red-500">Error: {error}</div>
          )}
          {page && (
            <>
              <NarratorPanel page={page} voice={voice} onVoiceChange={handleVoiceChange} />
              <div className="border-t flex-1 flex flex-col overflow-hidden">
                <ChatPanel page={page} voice={voice} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
