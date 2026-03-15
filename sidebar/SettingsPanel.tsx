import { useState, useEffect, useRef } from "react";

interface SettingsPanelProps {
  firstRun?: boolean;
  onSaved?: () => void;
  onClose?: () => void;
  claudeKey?: string;
  elevenLabsKey?: string;
}

export function SettingsPanel({
  firstRun,
  onSaved,
  onClose,
  claudeKey: claudeKeyProp = "",
  elevenLabsKey: elevenLabsKeyProp = "",
}: SettingsPanelProps) {
  const [claudeKey, setClaudeKey] = useState(claudeKeyProp);
  const [elevenLabsKey, setElevenLabsKey] = useState(elevenLabsKeyProp);
  const [claudeError, setClaudeError] = useState("");
  const [elevenLabsError, setElevenLabsError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync stored key props → local state (for normal/edit mode pre-population)
  useEffect(() => {
    setClaudeKey(claudeKeyProp);
    setElevenLabsKey(elevenLabsKeyProp);
  }, [claudeKeyProp, elevenLabsKeyProp]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  async function handleSave() {
    let hasError = false;
    if (!claudeKey.startsWith("sk-ant-")) {
      setClaudeError('Key should start with "sk-ant-"');
      hasError = true;
    } else {
      setClaudeError("");
    }
    if (!elevenLabsKey) {
      setElevenLabsError("ElevenLabs key is required");
      hasError = true;
    } else {
      setElevenLabsError("");
    }
    if (hasError) return;

    setSaveError("");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SET_KEYS",
        claudeKey,
        elevenLabsKey,
      });
      if (response?.success) {
        if (firstRun) {
          onSaved?.();
        } else {
          setSaved(true);
          timerRef.current = setTimeout(() => {
            setSaved(false);
            onClose?.();
          }, 1500);
        }
      } else {
        setSaveError("Failed to save — please try again");
      }
    } catch {
      setSaveError("Failed to save — please try again");
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-sm font-semibold">
        {firstRun ? "Welcome to Vocis" : "API Keys"}
      </h2>

      {firstRun && (
        <p className="text-xs text-gray-500">
          Enter your API keys to get started. Keys are stored locally in your browser.
        </p>
      )}

      <div>
        <label className="text-xs font-medium text-gray-700 block mb-0.5">
          Anthropic (Claude) API Key
        </label>
        <p className="text-xs text-gray-400 mb-1">
          Powers narration and chat —{" "}
          <a
            href="https://console.anthropic.com/"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-gray-600"
          >
            get one here
          </a>
        </p>
        <input
          type="password"
          className={`w-full text-sm border rounded px-2 py-1 ${claudeError ? "border-red-400" : ""}`}
          placeholder="sk-ant-..."
          value={claudeKey}
          onChange={(e) => { setClaudeKey(e.target.value); setClaudeError(""); }}
        />
        {claudeError && <p className="text-xs text-red-500 mt-0.5">{claudeError}</p>}
      </div>

      <div>
        <label className="text-xs font-medium text-gray-700 block mb-0.5">
          ElevenLabs API Key
        </label>
        <p className="text-xs text-gray-400 mb-1">
          Powers voice synthesis —{" "}
          <a
            href="https://elevenlabs.io/app/settings/api-keys"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-gray-600"
          >
            get one here
          </a>
        </p>
        <input
          type="password"
          className={`w-full text-sm border rounded px-2 py-1 ${elevenLabsError ? "border-red-400" : ""}`}
          placeholder="..."
          value={elevenLabsKey}
          onChange={(e) => { setElevenLabsKey(e.target.value); setElevenLabsError(""); }}
        />
        {elevenLabsError && <p className="text-xs text-red-500 mt-0.5">{elevenLabsError}</p>}
      </div>

      {saveError && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1">
          {saveError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          className="flex-1 bg-blue-600 text-white text-sm rounded py-1.5 hover:bg-blue-700"
          onClick={handleSave}
        >
          {saved ? "✓ Saved" : "Save Keys"}
        </button>
        {!firstRun && (
          <button
            className="flex-1 border text-sm rounded py-1.5 hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
