import { Readability } from "@mozilla/readability";

const log = (...args: unknown[]) => console.log("[AI Narrator:content]", ...args);
const err = (...args: unknown[]) => console.error("[AI Narrator:content]", ...args);

function extractContent(): { title: string; content: string; readTimeMinutes: number } {
  log("Extracting page content from", document.location.href);

  // Run Readability on a clone to identify the article area
  const documentClone = document.cloneNode(true) as Document;
  const reader = new Readability(documentClone);
  const article = reader.parse();

  const title = article?.title ?? document.title;

  let content = "";

  if (article?.content) {
    // Parse Readability's cleaned HTML and read innerText — this gives only
    // what is visually rendered (respects display:none, skips hidden metadata).
    const div = document.createElement("div");
    div.innerHTML = article.content;
    content = div.innerText.trim();
    log("Used Readability + innerText extraction");
  }

  if (!content) {
    // Fallback: find the best visible content container on the real DOM
    const mainEl = (
      document.querySelector("main") ||
      document.querySelector("article") ||
      document.querySelector("[role='main']") ||
      document.body
    ) as HTMLElement;
    content = mainEl.innerText.trim();
    log("Readability produced no content — fell back to", mainEl.tagName);
  }

  const wordCount = content.length > 0 ? content.split(/\s+/).length : 0;
  const readTimeMinutes = Math.ceil(wordCount / 200);

  log(`Extracted: "${title}" — ${wordCount} words, ${readTimeMinutes} min read`);

  return { title, content, readTimeMinutes };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTENT") {
    try {
      sendResponse({ success: true, data: extractContent() });
    } catch (e) {
      err("Extraction failed:", e);
      sendResponse({ success: false, error: String(e) });
    }
    return true; // keep channel open for async
  }
});
