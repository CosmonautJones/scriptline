import { createServerFn } from "@tanstack/react-start";
import type { LearnResult, ReadResult, TranscribeResult } from "./extract-types";

function readUrl(input: unknown): { url: string } {
  if (!input || typeof input !== "object" || !("url" in input)) {
    throw new Error("Paste a public Instagram reel or post link.");
  }
  const url = (input as { url: unknown }).url;
  if (typeof url !== "string") {
    throw new Error("Paste a public Instagram reel or post link.");
  }
  const trimmed = url.trim();
  if (trimmed.length < 3 || trimmed.length > 2000) {
    throw new Error("That link doesn't look right.");
  }
  return { url: trimmed };
}

function readLesson(input: unknown): { url: string; script: string } {
  const { url } = readUrl(input);
  const script = (input as { script?: unknown }).script;
  if (typeof script !== "string") return { url, script: "" };
  return { url, script: script.slice(0, 12_000) };
}

export const readPost = createServerFn({ method: "POST" })
  .validator(readUrl)
  .handler(async ({ data }): Promise<ReadResult> => {
    const { readPostInner } = await import("./extract.server");
    return readPostInner(data.url);
  });

export const transcribePost = createServerFn({ method: "POST" })
  .validator(readUrl)
  .handler(async ({ data }): Promise<TranscribeResult> => {
    const { transcribePostInner } = await import("./extract.server");
    return transcribePostInner(data.url);
  });

export const learnPost = createServerFn({ method: "POST" })
  .validator(readLesson)
  .handler(async ({ data }): Promise<LearnResult> => {
    const { learnPostInner } = await import("./extract.server");
    return learnPostInner(data.url, data.script);
  });
