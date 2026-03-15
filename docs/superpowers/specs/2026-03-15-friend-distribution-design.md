# Vocis — Friend Distribution & Per-User Key Setup

**Date:** 2026-03-15
**Status:** Approved

## Problem

The extension currently falls back to build-time `VITE_*` env vars for API keys. This is a dev convenience but a footgun for sharing: friends who clone the repo might silently inherit keys from their environment, and there is no first-run guidance telling them to set their own keys.

## Goal

Enable friends to clone the repo, build it themselves, and use the extension with their own Anthropic and ElevenLabs API keys — with no friction and no risk of key leakage.

## Distribution Model

- **Install:** `git clone` → `npm install` → `npm run build` → Chrome `Load unpacked` on `dist/`
- **Updates:** `git pull` → `npm run build` → reload extension in `chrome://extensions`
- No Chrome Web Store, no pre-built zips, no backend infra

## Scope

### 1. Strip VITE_* env var fallback from `getKeys()`

Remove `import.meta.env.VITE_CLAUDE_API_KEY` and `VITE_ELEVENLABS_API_KEY` fallbacks from `background.ts`. Keys must come from `chrome.storage.local` only.

```ts
// After
const claudeKey: string = (result.claudeKey as string | undefined) ?? "";
const elevenLabsKey: string = (result.elevenLabsKey as string | undefined) ?? "";
```

**Why:** Eliminates any risk of env var keys leaking into a shared build, and ensures every user is prompted to enter their own keys.

### 2. `useKeyStatus` hook

New hook: `sidebar/useKeyStatus.ts`

- Reads `chrome.storage.local.get(["claudeKey", "elevenLabsKey"])` on mount.
- Returns `{ keysSet: boolean, loading: boolean }`.
- `keysSet` is true only when both keys are non-empty strings.
- Exposes a `refresh()` function so `App.tsx` can re-check after the user saves.

### 3. First-run gate in `App.tsx`

- While `loading` is true: render nothing (prevents flash).
- If `!keysSet`: force-show the Settings panel, hide the main UI (narrator + chat tabs).
- If `keysSet`: render normally.
- Pass `onSaved={refresh}` to `SettingsPanel` so saving keys triggers a re-check.

### 4. Redesigned `SettingsPanel`

Replace the current minimal form with a more informative panel:

- **Header:** "Welcome to Vocis" when shown as first-run gate; "API Keys" when opened via gear icon.
- **Claude field:** label + short description ("Powers narration and chat") + link to console.anthropic.com.
- **ElevenLabs field:** label + short description ("Powers voice synthesis") + link to elevenlabs.io.
- **Inline validation on save:** Claude key must start with `sk-ant-`; ElevenLabs key must be non-empty. Show field-level error message on failure — do not call `SET_KEYS`.
- **Success state:** after save, show "✓ Saved" badge on each field briefly before closing.
- No "Test connection" button — format validation only.

### 5. README overhaul

Replace the current (developer-focused) README with a clear setup guide covering:

- Prerequisites (Node.js, Chrome)
- Clone + install + build steps (copy-paste commands)
- How to load unpacked in Chrome
- How to get API keys (Anthropic Console, ElevenLabs dashboard)
- How to update the extension
- Spending limits recommendation (Anthropic + ElevenLabs both support this)
- **Security note:** keys are stored in `chrome.storage.local` (not encrypted at rest, local-only, inaccessible to web pages). This will be replaced with a more secure storage mechanism in a future version.

### 6. `.env.example`

Add a minimal `.env.example` with placeholder values and a comment:

```
# Dev only — set these to use your keys during local development
# In production (Load unpacked from dist/), set keys via the extension settings panel
VITE_CLAUDE_API_KEY=sk-ant-...
VITE_ELEVENLABS_API_KEY=...
```

## Security

`chrome.storage.local` is the standard approach for Chrome extension credential storage. It is isolated from web pages, other extensions, and `chrome.storage.sync` (which would push to Google's servers). It is **not encrypted at rest** — keys are stored as LevelDB files on disk. Mitigations:

- Each user stores their own keys (no shared credentials).
- Keys can be revoked from provider dashboards instantly.
- Users should set spending limits on both Anthropic and ElevenLabs accounts.
- A future version will replace this with a more secure storage mechanism.

## Out of Scope

- Chrome Web Store publishing
- Backend proxy (keys never leave the client)
- Key encryption at rest
- Auto-update mechanism
