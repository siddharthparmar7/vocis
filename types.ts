export type ExtractedPage = {
  title: string;
  content: string;
  readTimeMinutes: number;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type MessageRequest =
  | { type: "GET_PAGE_CONTENT" }
  | { type: "NARRATE"; page: ExtractedPage; voice: string }
  | { type: "CHAT"; page: ExtractedPage; history: ChatMessage[]; userMessage: string; voice: string; voiceReply: boolean }
  | { type: "GET_VOICES" }
  | { type: "SET_KEYS"; claudeKey: string; elevenLabsKey: string };

export type MessageResponse =
  | { success: true; data: unknown }
  | { success: false; error: string };
