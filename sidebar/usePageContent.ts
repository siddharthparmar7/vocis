import { useState, useEffect, useCallback } from "react";
import type { ExtractedPage } from "../types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; page: ExtractedPage }
  | { status: "error"; message: string };

export function usePageContent({ enabled = true }: { enabled?: boolean } = {}) {
  const [state, setState] = useState<State>({ status: "idle" });

  const load = useCallback(async () => {
    console.log("[Vocis] usePageContent: requesting page content");
    setState({ status: "loading" });
    const response = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT" });
    if (response?.success) {
      console.log("[Vocis] usePageContent: ready —", response.data.title);
      setState({ status: "ready", page: response.data as ExtractedPage });
    } else {
      console.error("[Vocis] usePageContent: failed —", response?.error);
      setState({ status: "error", message: response?.error ?? "Failed to extract page content" });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load]);

  if (!enabled) {
    return { page: null, loading: false, error: null, refresh: load };
  }

  return {
    page: state.status === "ready" ? state.page : null,
    loading: state.status === "loading",
    error: state.status === "error" ? state.message : null,
    refresh: load,
  };
}
