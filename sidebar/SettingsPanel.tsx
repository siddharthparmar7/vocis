import { useState, useEffect, useRef } from "react";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [claudeKey, setClaudeKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  async function handleSave() {
    await chrome.runtime.sendMessage({ type: "SET_KEYS", claudeKey, elevenLabsKey });
    setSaved(true);
    timerRef.current = setTimeout(() => { setSaved(false); onClose(); }, 1000);
  }

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-sm font-semibold">API Keys</h2>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Anthropic (Claude) API Key</label>
        <input
          type="password"
          className="w-full text-sm border rounded px-2 py-1"
          placeholder="sk-ant-..."
          value={claudeKey}
          onChange={(e) => setClaudeKey(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">ElevenLabs API Key</label>
        <input
          type="password"
          className="w-full text-sm border rounded px-2 py-1"
          placeholder="..."
          value={elevenLabsKey}
          onChange={(e) => setElevenLabsKey(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 bg-blue-600 text-white text-sm rounded py-1 hover:bg-blue-700"
          onClick={handleSave}
        >
          {saved ? "Saved!" : "Save Keys"}
        </button>
        <button
          className="flex-1 border text-sm rounded py-1 hover:bg-gray-50"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
