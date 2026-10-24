/**
 * Curated seed list of well-known AI products and their official URLs. Used only by the
 * deterministic planner when the instruction names no specific products or URLs. It is a
 * starting point the user reviews and edits in the plan preview, never presented as research,
 * and every URL is still fetched live. URLs can go stale: failures are reported, not hidden.
 */
export interface CatalogEntry {
  name: string;
  aliases: string[];
  tags: string[];
  urls: string[];
}

export const PRODUCT_CATALOG: CatalogEntry[] = [
  { name: "ChatGPT", aliases: ["chatgpt", "openai"], tags: ["assistant", "general"], urls: ["https://chatgpt.com/pricing", "https://openai.com/chatgpt/overview/"] },
  { name: "Claude", aliases: ["claude", "anthropic"], tags: ["assistant", "general", "coding"], urls: ["https://claude.com/pricing", "https://www.anthropic.com/claude"] },
  { name: "Google Gemini", aliases: ["gemini", "bard"], tags: ["assistant", "general"], urls: ["https://gemini.google/subscriptions/", "https://gemini.google.com/"] },
  { name: "Microsoft Copilot", aliases: ["microsoft copilot", "copilot pro", "bing chat"], tags: ["assistant", "general", "productivity"], urls: ["https://www.microsoft.com/en-us/microsoft-copilot/for-individuals", "https://www.microsoft.com/en-us/microsoft-365/copilot"] },
  { name: "Perplexity", aliases: ["perplexity"], tags: ["assistant", "research", "search"], urls: ["https://www.perplexity.ai/pro", "https://www.perplexity.ai/"] },
  { name: "Notion AI", aliases: ["notion"], tags: ["productivity", "writing", "teams"], urls: ["https://www.notion.com/product/ai", "https://www.notion.com/pricing"] },
  { name: "GitHub Copilot", aliases: ["github copilot"], tags: ["coding"], urls: ["https://github.com/features/copilot", "https://github.com/features/copilot/plans"] },
  { name: "Cursor", aliases: ["cursor"], tags: ["coding"], urls: ["https://cursor.com/pricing", "https://cursor.com/"] },
  { name: "Jasper", aliases: ["jasper"], tags: ["writing", "marketing"], urls: ["https://www.jasper.ai/pricing", "https://www.jasper.ai/"] },
  { name: "Mistral Le Chat", aliases: ["le chat", "mistral"], tags: ["assistant", "general"], urls: ["https://mistral.ai/pricing", "https://mistral.ai/products/le-chat"] },
  { name: "Grammarly", aliases: ["grammarly"], tags: ["writing"], urls: ["https://www.grammarly.com/plans", "https://www.grammarly.com/"] },
  { name: "Otter.ai", aliases: ["otter"], tags: ["meetings", "productivity"], urls: ["https://otter.ai/pricing", "https://otter.ai/"] },
];

const TOPIC_TAGS: [RegExp, string][] = [
  [/\b(cod(e|ing)|developer|programming|ide)\b/i, "coding"],
  [/\b(writ(e|ing)|copy|content|marketing)\b/i, "writing"],
  [/\b(meeting|transcri)/i, "meetings"],
  [/\b(search|research)\b/i, "research"],
  [/\b(notes?|docs?|productivity|workspace)\b/i, "productivity"],
];

export function pickCatalogTargets(prompt: string, count: number): CatalogEntry[] {
  const lower = prompt.toLowerCase();
  const named = PRODUCT_CATALOG.filter((e) => e.aliases.some((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)));
  if (named.length > 0) return named.slice(0, count);
  const tags = TOPIC_TAGS.filter(([re]) => re.test(prompt)).map(([, t]) => t);
  const scored = PRODUCT_CATALOG.map((e, i) => ({ e, i, score: e.tags.filter((t) => tags.includes(t)).length }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, count).map((s) => s.e);
}
