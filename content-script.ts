const log = (...args: unknown[]) => console.log("[AI Narrator:content]", ...args);
const err = (...args: unknown[]) => console.error("[AI Narrator:content]", ...args);

// Block-level elements whose text represents readable content
const CONTENT_SELECTORS = "p, h1, h2, h3, h4, h5, h6, li, blockquote, td";

// Live set of elements currently intersecting the viewport
const visibleElements = new Set<Element>();

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        visibleElements.add(entry.target);
      } else {
        visibleElements.delete(entry.target);
      }
    }
  },
  { threshold: 0 }
);

// Observe all matching elements currently in the DOM
const targets = document.querySelectorAll(CONTENT_SELECTORS);
targets.forEach((el) => observer.observe(el));
log("IntersectionObserver registered on", targets.length, "elements");

function extractContent(): { title: string; content: string; readTimeMinutes: number } {
  log("Extracting viewport content from", document.location.href);

  const title = document.title;
  let content = "";

  if (visibleElements.size > 0) {
    // Re-query to get stable DOM order, then filter to visible set
    const allElements = Array.from(document.querySelectorAll(CONTENT_SELECTORS));
    const ordered = allElements.filter((el) => visibleElements.has(el));
    content = ordered
      .map((el) => (el as HTMLElement).innerText.trim())
      .filter(Boolean)
      .join("\n");
    log("IntersectionObserver: extracted from", ordered.length, "visible elements");
  }

  if (!content) {
    // Fallback: first 4000 chars of body text (observer not yet populated)
    content = document.body.innerText.trim().slice(0, 4000);
    log("Observer Set empty — fell back to body.innerText (first 4000 chars)");
  }

  const wordCount = content.length > 0 ? content.split(/\s+/).length : 0;
  const readTimeMinutes = Math.ceil(wordCount / 200);

  log(`Extracted: "${title}" — ${wordCount} words, ${readTimeMinutes} min read`);

  return { title, content, readTimeMinutes };
}

// --- Speech recognition bridge ---
// Content script runs in the web-page context and inherits the page's mic
// permission. The extension side panel (chrome-extension:// origin) cannot
// trigger Chrome's mic permission dialog itself, so we delegate here.
let activeRecog: { stop(): void } | null = null;

function startSpeech(lang: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    chrome.runtime.sendMessage({ type: "SPEECH_ERROR", error: "not-supported" }).catch(() => {});
    return;
  }
  if (activeRecog) { activeRecog.stop(); activeRecog = null; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recog = new Ctor() as any;
  recog.lang = lang;
  recog.interimResults = false;
  recog.onresult = (e: { results: { 0: { 0: { transcript: string } } } }) => {
    const transcript = e.results[0][0].transcript;
    chrome.runtime.sendMessage({ type: "SPEECH_RESULT", transcript }).catch(() => {});
  };
  recog.onerror = (e: { error: string }) => {
    chrome.runtime.sendMessage({ type: "SPEECH_ERROR", error: e.error }).catch(() => {});
    activeRecog = null;
  };
  recog.onend = () => {
    activeRecog = null;
    chrome.runtime.sendMessage({ type: "SPEECH_END" }).catch(() => {});
  };
  recog.start();
  activeRecog = recog;
  log("SpeechRecognition started (lang:", lang, ")");
}

function stopSpeech() {
  if (activeRecog) {
    activeRecog.stop();
    activeRecog = null;
    log("SpeechRecognition stopped by extension");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({});
    return false;
  }
  if (message.type === "EXTRACT_CONTENT") {
    try {
      sendResponse({ success: true, data: extractContent() });
    } catch (e) {
      err("Extraction failed:", e);
      sendResponse({ success: false, error: String(e) });
    }
    return true; // keep channel open for async
  }
  if (message.type === "SPEECH_START") {
    startSpeech((message as { lang?: string }).lang ?? "en-US");
    sendResponse({});
    return false;
  }
  if (message.type === "SPEECH_STOP") {
    stopSpeech();
    sendResponse({});
    return false;
  }
});
