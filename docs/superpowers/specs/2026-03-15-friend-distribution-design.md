# Vocis — Friend Distribution & Per-User Key Setup

**Date:** 2026-03-15
**Status:** Approved

## Problem

The extension currently falls back to build-time `VITE_*` env vars for API keys. Friends cloning the repo might silently inherit env keys, and there is no first-run guidance telling them to set their own keys.

## Goal

Enable friends to clone, build, and use the extension with their own Anthropic and ElevenLabs API keys — no friction, no key leakage.

## Distribution Model

- **Install:** `git clone` → `npm install` → `npm run build` → Chrome `Load unpacked` on `dist/`
- **Updates:** `git pull` → `npm run build` → reload in `chrome://extensions`
- No Chrome Web Store, no pre-built zips, no backend infra

## Scope

### 1. Strip VITE_* env var fallback from `getKeys()`

Remove `import.meta.env.VITE_CLAUDE_API_KEY` and `VITE_ELEVENLABS_API_KEY` fallbacks from `background.ts`. Keys come from `chrome.storage.local` only.

```ts
// After
const claudeKey: string = (result.claudeKey as string | undefined) ?? "";
const elevenLabsKey: string = (result.elevenLabsKey as string | undefined) ?? "";
```

**Note on `.env` at build time:** Vite still injects `VITE_*` vars into the bundle if a `.env` file is present. This is fine — the vars are injected but never read after this change. Do not delete `.env` or `.env.example`; they have no effect on the built extension.

### 2. `useKeyStatus` hook

New hook: `sidebar/useKeyStatus.ts`

Returns `{ keysSet: boolean, keysLoading: boolean, claudeKey: string, elevenLabsKey: string, refresh: () => void }`.

- Reads `chrome.storage.local.get(["claudeKey", "elevenLabsKey"])` on mount.
- `keysSet` is `true` only when both stored values are non-empty strings.
- `claudeKey` and `elevenLabsKey` are the raw stored values (empty string if unset) — used by `SettingsPanel` for pre-population, keeping chrome API access in the hook layer.
- `keysLoading` (not `loading`) to avoid collision with other loading states in `App.tsx`.
- `refresh()` re-reads storage and updates state. No `chrome.storage.onChanged` listener — pull-only is sufficient since keys are only written by this extension via the Settings panel.

**Storage key names** are confirmed as `"claudeKey"` and `"elevenLabsKey"` — matching `background.ts`.

### 3. First-run gate in `App.tsx`

- `keysLoading` true → render centered spinner (not blank white panel).
- `!keysSet` → render only `<SettingsPanel firstRun={true} onSaved={refresh} />`. Main UI and gear icon hidden entirely. Do **not** call `usePageContent` (pass `enabled={keysSet}` — see Section 5a).
- `keysSet` → render normally, including `usePageContent`.
- After `onSaved` fires → `refresh()` → `keysSet` flips true → main UI renders automatically.

### 4. Redesigned `SettingsPanel`

New prop signature: `{ firstRun?: boolean; onSaved?: () => void; onClose?: () => void; claudeKey?: string; elevenLabsKey?: string }`. All props optional — `onClose` must not be required so it can be omitted in first-run mode without a runtime error. `claudeKey` and `elevenLabsKey` are the stored values passed from `App.tsx` for pre-population.

**Layout:**
- Header: `firstRun ? "Welcome to Vocis" : "API Keys"`
- Claude field: password input + "Powers narration and chat" + link to `https://console.anthropic.com/`
- ElevenLabs field: password input + "Powers voice synthesis" + link to `https://elevenlabs.io/app/settings/api-keys`

**Field pre-population:**
- Normal mode (gear icon): `App.tsx` passes `claudeKey` and `elevenLabsKey` from `useKeyStatus` as props. Because the panel is only shown after `keysLoading` is false and `keysSet` is true, the prop values are stable before first render — `useState(props.claudeKey ?? "")` is safe. Additionally, add a `useEffect` syncing props → local state on prop change (`useEffect(() => { setClaudeKey(claudeKey ?? ""); setElevenLabsKey(elevenLabsKey ?? ""); }, [claudeKey, elevenLabsKey])`) for robustness.
- First-run mode: fields start empty (no stored values exist yet).

**Inline validation on save (best-effort hints):**
- Claude key: show field-level error if value does not start with `sk-ant-`. Best-effort — Anthropic's prefix is not a public API contract. If it changes, remove this check.
- ElevenLabs key: show field-level error if empty.
- On validation failure: do not call `SET_KEYS`. User stays on form.

**Cancel button:**
- `firstRun` mode: hidden.
- Normal mode: visible, calls `onClose?.()` without saving.

**Save flow:**
1. Run validation. On failure: show field errors, stop.
2. Wrap `chrome.runtime.sendMessage` in try/catch. `sendMessage` can throw if the extension context is invalidated (e.g. extension reloaded). Treat a throw the same as a failure response.
3. Call `SET_KEYS`. Response shape: `{ success: true, data: null }` on success; `{ success: false, error: string }` on failure. `background.ts` `await`s `chrome.storage.local.set(...)` before responding — storage is guaranteed written before `onSaved?.()` is called.
4. On `{ success: true }`:
   - First-run: call `onSaved?.()`. Do **not** call `onClose?.()`. Parent re-renders with main UI.
   - Normal: show "✓ Saved" badge for **1500ms** (changed from current 1000ms — intentional), then **automatically call `onClose?.()`**.
5. On `{ success: false }` or throw: show inline error banner ("Failed to save — please try again") at bottom of form. Do not call `onSaved?.()` or `onClose?.()`. User stays on form.

Note: `background.ts` already returns `{ success: false, error: string }` from its catch block — no background changes needed.

### 5a. `usePageContent` — add `enabled` param

Add `enabled?: boolean` param to `sidebar/usePageContent.ts`. When `enabled` is `false` (or `undefined`), the hook returns `{ loading: false, page: null, error: null }` immediately and skips `GET_PAGE_CONTENT`. `App.tsx` passes `enabled={keysSet}`.

**Critical:** `enabled` must be included in the `useEffect` dependency array (alongside `load`). When `enabled` flips `false → true` after keys are saved and `refresh()` is called, the effect must re-run to trigger `load()`. A naive implementation that only depends on `[load]` will never fetch page content after first-run key entry. The guard inside the effect: `if (!enabled) return;`.

This is the minimal change — do not refactor other hook behavior.

### 5b. README update

`README.md` exists at the repo root. Update in-place. Preserve: Features, How it works, Tech stack, Microphone permissions. Remove or replace any other existing key-setup instructions not covered by the changes below.

**Targeted changes:**
- **Prerequisites:** add `Node.js ≥ 18`
- **Enter your API keys (Setup section):** replace the current "click gear icon" instructions with: "The extension will prompt you for your API keys the first time you open it. Paste your Anthropic key and ElevenLabs key and click Save."
- **Add section — Spending limits:** recommend users set monthly budget limits on their Anthropic and ElevenLabs accounts. Include links to each provider's billing/limits settings page.
- **Add section — Security:** "Your API keys are stored locally in your browser's extension storage. They are not sent to any server we control and are not accessible to websites you visit. They are not encrypted on disk — anyone with access to your machine's Chrome profile directory can read them. We plan to improve this in a future version."

### 5c. `.env.example`

Exists at repo root — update in-place. Replace entire file content with:

```
# These vars are no longer read by the extension at runtime.
# They document the shape of keys used by the settings panel.
# If you need them for local tooling, copy this file to .env.

# Anthropic (Claude) API key — get one at: https://console.anthropic.com/
VITE_CLAUDE_API_KEY=sk-ant-...

# ElevenLabs API key — get one at: https://elevenlabs.io/app/settings/api-keys
VITE_ELEVENLABS_API_KEY=...
```

## Security

`chrome.storage.local` is isolated from web pages and other extensions. Not encrypted at rest — keys stored as LevelDB files in the Chrome profile directory. `chrome.storage.sync` is intentionally avoided (would push keys to Google's servers).

Accepted mitigations:
- Each user stores only their own keys.
- Keys revocable from provider dashboards instantly.
- Users advised to set spending limits on both accounts.
- Future encryption/secure storage improvement is planned but out of scope here.

## Out of Scope

- Chrome Web Store publishing
- Backend proxy
- Key encryption at rest
- Auto-update mechanism
- Dev-time VITE_* env var path (vars no longer read at runtime)
