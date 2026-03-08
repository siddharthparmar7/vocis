import { Readability } from "@mozilla/readability";

const log = (...args: unknown[]) => console.log("[AI Narrator:content]", ...args);
const err = (...args: unknown[]) => console.error("[AI Narrator:content]", ...args);

function extractContent(): { title: string; content: string; readTimeMinutes: number } {
  log("Extracting page content from", document.location.href);
  const documentClone = document.cloneNode(true) as Document;
  const reader = new Readability(documentClone);
  const article = reader.parse();

  const title = article?.title ?? document.title;
  const content = article?.textContent?.trim() ?? document.body?.innerText?.trim() ?? "";
  const wordCount = content.length > 0 ? content.split(/\s+/).length : 0;
  const readTimeMinutes = Math.ceil(wordCount / 200); // ~200 wpm

  log(`Extracted: "${title}" — ${wordCount} words, ${readTimeMinutes} min read`);
  if (!article) log("Readability could not parse article — falling back to body text");

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
