import { useState, useEffect, useCallback } from "react";
import type { ExtractedPage } from "../types";

type State =
  | { status: "loading" }
  | { status: "ready"; page: ExtractedPage }
  | { status: "error"; message: string };

export function usePageContent() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    console.log("[AI Narrator] usePageContent: requesting page content");
    setState({ status: "loading" });
    const response = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT" });
    if (response?.success) {
      console.log("[AI Narrator] usePageContent: ready —", response.data.title);
      setState({ status: "ready", page: response.data as ExtractedPage });
    } else {
      console.error("[AI Narrator] usePageContent: failed —", response?.error);
      setState({ status: "error", message: response?.error ?? "Failed to extract page content" });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return {
    page: state.status === "ready" ? state.page : null,
    loading: state.status === "loading",
    error: state.status === "error" ? state.message : null,
    refresh: load,
  };
}
