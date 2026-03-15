import { useState, useEffect, useCallback } from "react";

export function useKeyStatus() {
  const [keysLoading, setKeysLoading] = useState(true);
  const [claudeKey, setClaudeKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");

  const refresh = useCallback(async () => {
    setKeysLoading(true);
    const result = await chrome.storage.local.get(["claudeKey", "elevenLabsKey"]);
    setClaudeKey((result.claudeKey as string | undefined) ?? "");
    setElevenLabsKey((result.elevenLabsKey as string | undefined) ?? "");
    setKeysLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const keysSet = claudeKey.length > 0 && elevenLabsKey.length > 0;

  return { keysSet, keysLoading, claudeKey, elevenLabsKey, refresh };
}
