import type { Lesson, PostMeta, Transcript } from "@/lib/extract-types";

const STORAGE_KEY = "scriptline.log.v1";
const LEGACY_KEY = "scriptline.v1";

export type LogStatus = "reading" | "saved" | "failed";

export type LogEntry = {
  id: string;
  enteredAt: string;
  input: string;
  status: LogStatus;
  error: string | null;
  post: PostMeta | null;
  transcript: Transcript | null;
  transcriptError: string | null;
  lesson?: Lesson | null;
};

function isEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as LogEntry;
  return typeof entry.id === "string" && typeof entry.input === "string" && typeof entry.enteredAt === "string";
}

function parse(raw: string): LogEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function write(items: LogEntry[]): LogEntry[] {
  let next = items;
  while (next.length > 0) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    } catch {
      next = next.slice(0, -1);
    }
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode can reject storage entirely. The in-memory list still works.
  }
  return [];
}

function fromLegacy(raw: string): LogEntry[] {
  try {
    const parsed = JSON.parse(raw) as Array<{
      post?: PostMeta;
      transcript?: Transcript | null;
      transcriptError?: string | null;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index) => {
      if (!item?.post?.shortcode || !item.post.owner?.username) return [];
      const entry: LogEntry = {
        id: `legacy-${item.post.shortcode}-${index}`,
        enteredAt: item.post.postedAt ?? new Date(0).toISOString(),
        input: item.post.url,
        status: "saved",
        error: null,
        post: item.post,
        transcript: item.transcript ?? null,
        transcriptError: item.transcriptError ?? null,
      };
      return [entry];
    });
  } catch {
    return [];
  }
}

export function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parse(raw);
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return [];
    const migrated = fromLegacy(legacy);
    if (migrated.length > 0) write(migrated);
    return migrated;
  } catch {
    return [];
  }
}

export function commitLog(entry: LogEntry): LogEntry[] {
  const items = loadLog().filter((item) => {
    if (item.id === entry.id) return false;
    if (entry.post && item.post?.shortcode === entry.post.shortcode) return false;
    return true;
  });
  return write([entry, ...items]);
}

export function clearLog() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Ignore. The caller still clears the on-screen list.
  }
}

export function logTitle(entry: LogEntry): string {
  if (entry.post?.owner.username) return `@${entry.post.owner.username}`;
  try {
    const path = new URL(entry.input).pathname.replace(/\/$/, "");
    return path || entry.input;
  } catch {
    return entry.input;
  }
}

export function logDetail(entry: LogEntry): string {
  if (entry.status === "reading") return "Reading this link…";
  if (entry.status === "failed") return entry.error ?? "Couldn't read that link.";
  if (entry.lesson?.claim) return entry.lesson.claim;
  const spoken = entry.transcript?.paragraphs[0] || entry.transcript?.text;
  if (spoken) return spoken;
  if (entry.post?.caption) return entry.post.caption;
  return entry.transcriptError ?? "Saved. No spoken script.";
}
