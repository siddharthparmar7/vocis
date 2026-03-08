import { useState, useEffect, useCallback } from "react";
import type { ExtractedPage } from "../types";

type State =
  | { status: "loading" }
  | { status: "ready"; page: ExtractedPage }
  | { status: "error"; message: string };

export function usePageContent() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const response = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT" });
    if (response?.success) {
      setState({ status: "ready", page: response.data as ExtractedPage });
    } else {
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
