# Friend Distribution & Per-User Key Setup — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable friends to clone, build, and use Vocis with their own API keys — with a first-run Settings gate, no env-var key leakage, and a clearer README.

**Architecture:** Strip the `VITE_*` env fallback from `background.ts`, add a `useKeyStatus` hook that reads `chrome.storage.local`, gate the entire UI behind it in `App.tsx`, and redesign `SettingsPanel` with per-field guidance and inline validation. `usePageContent` gets an `enabled` param so it won't fire until keys are present.

**Tech Stack:** TypeScript, React 19, Chrome MV3 (`chrome.storage.local`), Vite, Tailwind v3

---

## Chunk 1: Foundation Changes (background + hooks)

### Task 1: Strip VITE_* env var fallback from `getKeys()`

**Files:**
- Modify: `background.ts` (lines 50–62)

This is a pure deletion — remove two `|| import.meta.env.VITE_*` fallback expressions. After this change, keys come exclusively from `chrome.storage.local`. If no keys are set, both strings are `""` and the handler already logs `"MISSING"`.

- [ ] **Step 1: Edit `background.ts`**

Replace the `getKeys` function body:

```ts
async function getKeys(): Promise<{ claudeKey: string; elevenLabsKey: string }> {
  const result = await chrome.storage.local.get(["claudeKey", "elevenLabsKey"]);
  const claudeKey: string = (result.claudeKey as string | undefined) ?? "";
  const elevenLabsKey: string = (result.elevenLabsKey as string | undefined) ?? "";
  log("Keys resolved — claude:", claudeKey ? `set (${claudeKey.slice(0, 10)}...)` : "MISSING",
    "| elevenlabs:", elevenLabsKey ? `set (${elevenLabsKey.slice(0, 8)}...)` : "MISSING");
  return { claudeKey, elevenLabsKey };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add background.ts
git commit -m "fix: remove VITE_* env var fallback from getKeys — keys from storage only"
```

---

### Task 2: Add `enabled` param to `usePageContent`

**Files:**
- Modify: `sidebar/usePageContent.ts`

Add an `enabled?: boolean` param. When `false`/`undefined`, return idle state immediately and skip `GET_PAGE_CONTENT`. Include `enabled` in the `useEffect` dep array so the hook fires when it flips `false → true` (after first-run key entry).

- [ ] **Step 1: Replace `sidebar/usePageContent.ts`**

```ts
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. Note: `App.tsx` currently calls `usePageContent()` with no args — this still works because `enabled` defaults to `true`.

- [ ] **Step 3: Commit**

```bash
git add sidebar/usePageContent.ts
git commit -m "feat: add enabled param to usePageContent — skip fetch when keys not set"
```

---

### Task 3: Create `useKeyStatus` hook

**Files:**
- Create: `sidebar/useKeyStatus.ts`

New hook that reads `chrome.storage.local` on mount and exposes `{ keysSet, keysLoading, claudeKey, elevenLabsKey, refresh }`. This is the single source of truth for key presence across the app.

- [ ] **Step 1: Create `sidebar/useKeyStatus.ts`**

```ts
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add sidebar/useKeyStatus.ts
git commit -m "feat: add useKeyStatus hook — reads stored API keys from chrome.storage.local"
```

---

## Chunk 2: UI Changes (SettingsPanel + App)

### Task 4: Redesign `SettingsPanel`

**Files:**
- Modify: `sidebar/SettingsPanel.tsx`

Full replacement. Key changes from current:
- All props become optional (`onClose?: () => void`)
- New props: `firstRun?`, `onSaved?`, `claudeKey?`, `elevenLabsKey?`
- Per-field descriptions with links
- Inline validation (Claude `sk-ant-` prefix; ElevenLabs non-empty)
- Cancel hidden in first-run mode
- Error banner on `SET_KEYS` failure
- 1500ms auto-close after save in normal mode (was 1000ms)
- `useEffect` syncs prop values → local state for pre-population in normal mode

- [ ] **Step 1: Replace `sidebar/SettingsPanel.tsx`**

```tsx
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. The existing `App.tsx` passes `onClose` which is still valid since `onClose` is now optional (not breaking).

- [ ] **Step 3: Commit**

```bash
git add sidebar/SettingsPanel.tsx
git commit -m "feat: redesign SettingsPanel — first-run mode, field guidance, inline validation, error handling"
```

---

### Task 5: Wire first-run gate in `App.tsx`

**Files:**
- Modify: `sidebar/App.tsx`

Replace `App.tsx` to use `useKeyStatus`, pass `enabled={keysSet}` to `usePageContent`, render spinner while loading, render first-run `SettingsPanel` when keys missing, and pass stored key values to `SettingsPanel` in normal mode.

- [ ] **Step 1: Replace `sidebar/App.tsx`**

```tsx
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: clean build, no warnings about missing exports.

- [ ] **Step 4: Manual verify — first-run path**

1. Go to `chrome://extensions`, click the refresh icon on Vocis
2. Open the side panel — it should show "Welcome to Vocis" with two key fields
3. Try saving with an invalid Claude key (no `sk-ant-` prefix) — expect inline field error
4. Try saving with empty ElevenLabs key — expect inline field error
5. Save with valid keys — expect Settings to disappear and main UI to appear
6. Close the panel, reopen — should go straight to main UI (keys persisted)

- [ ] **Step 5: Manual verify — gear icon path**

1. With keys set, click ⚙ — should show "API Keys" panel with fields pre-filled (masked)
2. Change one key to something invalid — expect field error on save
3. Save valid keys — expect "✓ Saved" badge, panel closes after 1500ms

- [ ] **Step 6: Update `CLAUDE.md` file map**

Add `useKeyStatus.ts` to the sidebar file map:

```
sidebar/
  useKeyStatus.ts       Reads chrome.storage.local for key presence; drives first-run gate
```

- [ ] **Step 7: Commit**

```bash
git add sidebar/App.tsx CLAUDE.md
git commit -m "feat: add first-run gate — auto-show Settings when no API keys are stored"
```

---

## Chunk 3: Docs

### Task 6: Update `README.md` and `.env.example`

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Update `README.md`**

Preserve the existing Features, How it works, Tech stack, and Microphone permissions sections verbatim. Make these targeted changes:

**In Prerequisites**, change:
```
**Prerequisites:** Node.js, a Chromium-based browser (Chrome, Arc, Brave, etc.)
```
to:
```
**Prerequisites:** Node.js ≥ 18, a Chromium-based browser (Chrome, Arc, Brave, etc.)
```

**In "Enter your API keys"**, replace the three current steps with:
```markdown
Enter your API keys:

The extension will prompt you for your API keys the first time you open it.
Paste your **Anthropic API key** and **ElevenLabs API key** and click Save.

You can update your keys later by clicking the gear icon (⚙) in the top-right corner.
```

**Add a new "Spending limits" section** after the Setup section:
```markdown
## Spending limits

Both providers let you set monthly cost limits — set these before sharing your key with yourself across devices or leaving the extension running frequently.

- Anthropic: https://console.anthropic.com/settings/limits
- ElevenLabs: https://elevenlabs.io/app/subscription
```

**Add a new "Security" section** after Spending limits:
```markdown
## Security

Your API keys are stored locally in your browser's extension storage. They are not sent to any server we control and are not accessible to websites you visit. They are not encrypted on disk — anyone with access to your machine's Chrome profile directory can read them. We plan to improve this in a future version.
```

- [ ] **Step 2: Replace `.env.example`**

```
# These vars are no longer read by the extension at runtime.
# They document the shape of keys used by the settings panel.
# If you need them for local tooling, copy this file to .env.

# Anthropic (Claude) API key — get one at: https://console.anthropic.com/
VITE_CLAUDE_API_KEY=sk-ant-...

# ElevenLabs API key — get one at: https://elevenlabs.io/app/settings/api-keys
VITE_ELEVENLABS_API_KEY=...
```

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: update README for friend distribution — first-run flow, spending limits, security note"
```

---

## Chunk 4: Progress Log

### Task 7: Append to `docs/PROGRESS.md`

- [ ] **Step 1: Append entry**

```markdown
### 2026-03-15 — Friend distribution & per-user key setup

**What was built:**
- Stripped `VITE_*` env var fallback from `getKeys()` in `background.ts` — keys come from `chrome.storage.local` only.
- New `useKeyStatus` hook (`sidebar/useKeyStatus.ts`) — reads stored keys on mount, exposes `{ keysSet, keysLoading, claudeKey, elevenLabsKey, refresh }`.
- First-run gate in `App.tsx` — spinner while loading, auto-show redesigned SettingsPanel if keys missing.
- Redesigned `SettingsPanel` — first-run vs normal modes, per-field descriptions + links, inline validation, error banner on SET_KEYS failure, 1500ms auto-close.
- `usePageContent` gains `enabled?: boolean` param — skips `GET_PAGE_CONTENT` until keys are set; `enabled` in dep array so hook fires when keys are saved.
- README updated with `Node ≥ 18`, first-run flow description, spending limits, security note.
- `.env.example` updated to clarify vars are documentation-only.

**Key decisions:**
- `useKeyStatus` is pull-only (no `storage.onChanged`) — keys are only written by this extension via SettingsPanel which always calls `refresh()` after saving.
- `onClose` on SettingsPanel is now optional — required when called from gear icon, omitted in first-run mode.
- ElevenLabs key validation is presence-only (format not publicly documented); Claude key checks for `sk-ant-` prefix as a best-effort hint.

**Bugs / gotchas:**
- `useEffect` dep array for `usePageContent` must include `enabled` — otherwise flipping `false → true` after key entry doesn't trigger `load()`.
- SettingsPanel pre-population uses `useEffect` to sync props → state to handle cases where prop values arrive after initial render.

**What was tried and didn't work:** N/A
```

- [ ] **Step 2: Commit**

```bash
git add docs/PROGRESS.md
git commit -m "docs: add progress entry for friend distribution feature"
```

---

## Verification Checklist

Before marking complete, confirm all of the following manually in Chrome:

- [ ] Fresh install (no keys stored): side panel opens directly to "Welcome to Vocis"
- [ ] Invalid Claude key (no `sk-ant-` prefix): field error shown, keys NOT saved
- [ ] Empty ElevenLabs key: field error shown, keys NOT saved
- [ ] Valid keys saved on first-run: Settings panel disappears, main UI appears, page content loads
- [ ] Reopen panel after keys saved: goes straight to main UI (no first-run screen)
- [ ] Gear icon → Settings: shows "API Keys" header with fields pre-filled (masked)
- [ ] Update keys via gear icon: "✓ Saved" badge shown, panel auto-closes after ~1.5s
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `npm run build` completes cleanly
