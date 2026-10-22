export type PageReply = {
  username: string;
  text: string;
  postedAt: string | null;
};

export function commentBody(block: string, username: string): string {
  let text = block.replace(/\s+/g, " ").trim();
  const like = text.indexOf(" Like");
  if (like >= 0) text = text.slice(0, like).trim();
  const name = username.trim();
  if (name && text.toLowerCase().startsWith(name.toLowerCase())) {
    text = text.slice(name.length).trim();
  }
  text = text.replace(/^Verified\s+/i, "").trim();
  text = text
    .replace(
      /^(?:\d+\s*[smhdw]|\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\s*/i,
      "",
    )
    .trim();
  if (!text || text.toLowerCase() === "reply") return "";
  return text;
}

export async function readPublicReplies(pageUrl: string): Promise<PageReply[]> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 1400 },
        locale: "en-US",
      });
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForSelector('a[href*="/c/"]', { timeout: 8_000 }).catch(() => undefined);
      const blocks = await page.evaluate(() => {
        const out: { username: string; postedAt: string | null; block: string }[] = [];
        const seen = new Set<string>();
        for (const link of document.querySelectorAll('a[href*="/c/"]')) {
          const href = link.getAttribute("href") || "";
          if (!/\/c\/\d+/.test(href) || seen.has(href)) continue;
          seen.add(href);
          let box = link.parentElement;
          let block = "";
          for (let i = 0; i < 8 && box; i++) {
            block = (box.innerText || "").replace(/\s+/g, " ").trim();
            if (block.includes(" Like")) break;
            box = box.parentElement;
          }
          const userHref = box?.querySelector('a[href^="/"]')?.getAttribute("href") || "";
          const username = userHref.split("/").filter(Boolean)[0] || "";
          const postedAt = box?.querySelector("time")?.getAttribute("datetime") || null;
          if (username && !username.includes("accounts")) out.push({ username, postedAt, block });
          if (out.length >= 20) break;
        }
        return out;
      });
      return blocks.flatMap((item) => {
        const text = commentBody(item.block, item.username);
        if (!text) return [];
        return [{ username: item.username, text, postedAt: item.postedAt }];
      });
    } finally {
      await browser.close();
    }
  } catch {
    return [];
  }
}
