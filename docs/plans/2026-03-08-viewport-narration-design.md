# Viewport-Aware Narration Design

**Date:** 2026-03-08

## Problem

Narration gets stuck on long pages (e.g. 34,677 chars / 27 min read) because:
1. ElevenLabs `eleven_turbo_v2` has a ~5,000 character limit per request
2. Claude + ElevenLabs sequential processing of large content risks service worker timeout
3. Readability clones the entire document on every narration click (~50–200ms overhead)

## Solution

Narrate only what is currently visible in the viewport. The user scrolls to the section they want to hear, clicks Narrate, and hears that section. No chunking, no queues, no state machine changes.

## Architecture

### Content Extraction: IntersectionObserver

Replace Readability with an `IntersectionObserver` registered once when the content script is injected.

**Setup (on inject):**
- Observe all block-level elements: `p`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `li`, `blockquote`, `td`
- Maintain a live `Set<Element>` of elements currently intersecting the viewport
- Observer threshold: `0` (element is at least 1px visible)

**On `EXTRACT_CONTENT` message:**
- Read `.innerText` from each element in the Set, in DOM order
- Join with newlines, trim
- Return `{ title: document.title, content, readTimeMinutes }`

**Latency at click time:** ~1ms (reads pre-built Set, no DOM traversal)

### Content Size Guarantee

Viewport content is naturally bounded (~500–2,000 chars for a typical screen), always under ElevenLabs' limit. No truncation logic needed.

### Fallback

If the observer Set is empty (e.g. script injected but no elements observed yet), fall back to `document.body.innerText.slice(0, 4000)`.

## UX Flow

1. User opens side panel
2. User scrolls to section they want narrated
3. User clicks **Narrate** — hears only what's on screen
4. User scrolls to next section → clicks **Narrate** again

No changes to pause/resume behavior. Existing `AudioContext` + `pauseOffsetRef` pattern unchanged.

## Files Changed

| File | Change |
|------|--------|
| `content-script.ts` | Replace Readability extraction with IntersectionObserver |
| All other files | No changes |

## Files NOT Changed

- `background.ts` — message protocol unchanged
- `useNarrator.ts` — playback logic unchanged
- `useChat.ts` — chat logic unchanged
- `manifest.json` — no new permissions needed
- `types.ts` — `ExtractedPage` shape unchanged

## Trade-offs

| | Before | After |
|---|---|---|
| Extraction latency | ~50–200ms | ~1ms |
| Max content size | Full page (can exceed 34k chars) | Viewport only (~500–2k chars) |
| ElevenLabs limit risk | High | None |
| Service worker timeout risk | High for long pages | None |
| User control | Read all or nothing | Read section by section |
