import { Readability } from "@mozilla/readability";

function extractContent(): { title: string; content: string; readTimeMinutes: number } {
  const documentClone = document.cloneNode(true) as Document;
  const reader = new Readability(documentClone);
  const article = reader.parse();

  const title = article?.title ?? document.title;
  const content = article?.textContent?.trim() ?? document.body?.innerText?.trim() ?? "";
  const wordCount = content.length > 0 ? content.split(/\s+/).length : 0;
  const readTimeMinutes = Math.ceil(wordCount / 200); // ~200 wpm

  return { title, content, readTimeMinutes };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTENT") {
    try {
      sendResponse({ success: true, data: extractContent() });
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
    return true; // keep channel open for async
  }
});
