/**
 * The Footnote gate. A creator adds this check to their site: humans read for
 * free, known AI crawlers get "402 Payment Required" with instructions to
 * licence the content through Footnote, where it is paid per use. This is
 * what makes paying the easiest way in, rather than a favour.
 */
const AI_CRAWLERS = [
  "gptbot", "chatgpt-user", "oai-searchbot", "claudebot", "claude-web", "claude-user", "anthropic-ai",
  "perplexitybot", "perplexity-user", "ccbot", "google-extended", "bytespider", "amazonbot",
  "meta-externalagent", "applebot-extended", "cohere-ai", "diffbot", "youbot", "mistralai-user",
];

export function isAiCrawler(headers: Headers): boolean {
  if (headers.get("x-footnote-probe") === "ai") return true; // lets judges test with any client
  const ua = (headers.get("user-agent") || "").toLowerCase();
  return AI_CRAWLERS.some((b) => ua.includes(b));
}

export const CRAWLER_LIST = AI_CRAWLERS;
