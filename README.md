# Vocis

A Chrome extension that narrates any webpage and lets you have a voice conversation with Claude about it.

## Features

- **Narrate** — click Play to have the visible page content read aloud in a natural voice
- **Chat** — ask questions about the page in text or voice; Claude answers with context from the page
- **Voice conversation mode** — fully hands-free back-and-forth: Claude speaks, then the mic opens automatically so you can reply
- **Three input modes** — Auto (voice reply when you speak, text reply when you type), Text, Voice

## How it works

The extension runs as a Chrome side panel. When you open it on any page:

1. A content script extracts the visible text from the page
2. For narration, Claude rewrites the content as natural spoken prose, then ElevenLabs synthesizes it
3. For chat, your message and the page content are sent to Claude, and the response is spoken back via ElevenLabs
4. Speech recognition is delegated to the content script (which runs in the page's security context) so Chrome's microphone permission prompt works correctly

## Tech stack

- Chrome MV3 — side panel, service worker, content script
- TypeScript + React 18 + Vite
- [Claude](https://anthropic.com) (`claude-sonnet-4-6`) for narration rewriting and chat
- [ElevenLabs](https://elevenlabs.io) for text-to-speech
- Web Speech API for voice input

## Setup

**Prerequisites:** Node.js ≥ 18, a Chromium-based browser (Chrome, Arc, Brave, etc.)

```bash
git clone https://github.com/siddharthparmar7/vocis.git
cd vocis
npm install
npm run build
```

Load the extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder

Enter your API keys:

The extension will prompt you for your API keys the first time you open it. Paste your Anthropic key and ElevenLabs key and click Save.

## Spending limits

Both APIs charge per use. We recommend setting monthly budget limits so you don't get surprised:

- **Anthropic:** [console.anthropic.com/settings/limits](https://console.anthropic.com/settings/limits)
- **ElevenLabs:** [elevenlabs.io/app/subscription](https://elevenlabs.io/app/subscription)

## Security

Your API keys are stored locally in your browser's extension storage. They are not sent to any server we control and are not accessible to websites you visit. They are not encrypted on disk — anyone with access to your machine's Chrome profile directory can read them. We plan to improve this in a future version.

## Development

```bash
npm run dev   # watch mode — rebuilds on every file change
```

After each rebuild, go to `chrome://extensions` and click the refresh button on the Vocis card.

## Microphone permissions

When you first use voice input, Chrome will show a microphone permission prompt for the current website. Grant it once per site — the browser remembers it. The extension itself does not need a separate mic permission.
