import {
  MAX_TRANSCRIBE_SECONDS,
  type Cue,
  type LearnResult,
  type Lesson,
  type MediaKind,
  type PostMeta,
  type ReadResult,
  type Transcript,
  type TranscribeResult,
} from "./extract-types";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const MEDIA_TTL_MS = 12 * 60 * 1000;
const TRANSCRIPT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_HITS = 20;
const HIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_LESSONS = 12;

type RawMedia = {
  __typename?: string;
  id?: string;
  shortcode?: string;
  is_video?: boolean;
  display_url?: string;
  video_url?: string;
  video_duration?: number;
  video_view_count?: number;
  dimensions?: { width?: number; height?: number };
  accessibility_caption?: string | null;
  product_type?: string;
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  edge_media_to_comment?: { count?: number };
  edge_liked_by?: { count?: number };
  clips_music_attribution_info?: {
    artist_name?: string;
    song_name?: string;
    uses_original_audio?: boolean;
  } | null;
  owner?: {
    username?: string;
    is_verified?: boolean;
    profile_pic_url?: string;
    edge_followed_by?: { count?: number };
  };
  edge_sidecar_to_children?: { edges?: { node?: RawMedia }[] };
};

type ContextPayload = {
  context?: { copyright_blocked?: boolean };
  gql_data?: { shortcode_media?: RawMedia };
};

type Resolved = PostMeta & { videoUrl: string | null; copyrightBlocked: boolean };

type Word = { text?: string; start?: number; end?: number; speaker?: number };

const mediaCache = new Map<string, { at: number; resolved: Resolved }>();
const transcriptCache = new Map<string, { at: number; transcript: Transcript }>();
const inflight = new Map<string, Promise<TranscribeResult>>();
const hits: number[] = [];

function countHit(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0]! > HIT_WINDOW_MS) hits.shift();
  if (hits.length >= MAX_HITS) return false;
  hits.push(now);
  return true;
}

const lessonHits: number[] = [];
const lessonCache = new Map<string, { at: number; lesson: Lesson }>();

function countLesson(): boolean {
  const now = Date.now();
  while (lessonHits.length && now - lessonHits[0]! > HIT_WINDOW_MS) lessonHits.shift();
  if (lessonHits.length >= MAX_LESSONS) return false;
  lessonHits.push(now);
  return true;
}

export function parseInstagramInput(input: string): {
  shortcode: string;
  kind: "reel" | "p" | "tv";
} | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{5,30}$/.test(trimmed) && !trimmed.includes(".")) {
    return { shortcode: trimmed, kind: "reel" };
  }
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const allowed =
    host === "instagram.com" ||
    host === "instagr.am" ||
    host.endsWith(".instagram.com") ||
    host === "ddinstagram.com";
  if (!allowed) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const markers = new Set(["reel", "reels", "p", "tv"]);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.toLowerCase();
    if (!markers.has(part) || !parts[i + 1]) continue;
    const code = parts[i + 1]!.replace(/[^A-Za-z0-9_-]/g, "");
    if (code.length < 5) return null;
    const kind = part === "p" ? "p" : part === "tv" ? "tv" : "reel";
    return { shortcode: code, kind };
  }
  return null;
}

function readJsonString(source: string, start: number): string | null {
  let j = start;
  let raw = "";
  while (j < source.length) {
    const c = source[j];
    if (c === "\\") {
      if (j + 1 >= source.length) return null;
      raw += source.slice(j, j + 2);
      j += 2;
      continue;
    }
    if (c === '"') break;
    raw += c;
    j += 1;
  }
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}

export function parseEmbedHtml(html: string): ContextPayload | null {
  const marker = 'contextJSON":"';
  let from = 0;
  while (from < html.length) {
    const i = html.indexOf(marker, from);
    if (i < 0) break;
    const decoded = readJsonString(html, i + marker.length);
    if (decoded) {
      try {
        const parsed = JSON.parse(decoded) as ContextPayload;
        if (parsed?.gql_data?.shortcode_media?.shortcode) return parsed;
      } catch {
        /* keep scanning */
      }
    }
    from = i + marker.length;
  }
  return null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function postedAtFromId(id: string | undefined): string | null {
  if (!id || !/^\d+$/.test(id)) return null;
  try {
    const ms = (BigInt(id) >> 23n) + 1314220021721n;
    const date = new Date(Number(ms));
    const year = date.getUTCFullYear();
    if (Number.isNaN(date.getTime()) || year < 2010 || year > 2036) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

function pickStrings(text: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

function kindOf(media: RawMedia): MediaKind {
  if ((media.edge_sidecar_to_children?.edges?.length ?? 0) > 0) return "carousel";
  if (media.is_video || media.__typename === "GraphVideo") return "video";
  return "image";
}

function kindLabel(kind: MediaKind, productType: string | undefined): string {
  if (productType === "clips") return "Reel";
  if (productType === "igtv") return "IGTV";
  if (kind === "carousel") return "Carousel";
  if (kind === "image") return "Photo";
  return "Video";
}

function firstVideo(media: RawMedia): RawMedia | null {
  if (media.is_video && media.video_url) return media;
  for (const edge of media.edge_sidecar_to_children?.edges ?? []) {
    const node = edge.node;
    if (node?.is_video && node.video_url) return node;
  }
  return null;
}

function toResolved(media: RawMedia, blocked: boolean): Resolved | null {
  const shortcode = media.shortcode?.trim();
  const username = media.owner?.username?.trim();
  if (!shortcode || !username) return null;
  const caption =
    media.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() ?? "";
  const video = firstVideo(media);
  const duration = finiteOrNull(video?.video_duration ?? media.video_duration);
  const kind = kindOf(media);
  const hasAudio = Boolean(video?.video_url) && !blocked;
  const musicInfo = media.clips_music_attribution_info;
  const music =
    musicInfo && (musicInfo.song_name || musicInfo.artist_name)
      ? {
          artist: musicInfo.artist_name?.trim() || username,
          title: musicInfo.song_name?.trim() || "Audio",
          original: Boolean(musicInfo.uses_original_audio),
        }
      : null;
  const alt = media.accessibility_caption?.trim() || null;
  const page =
    media.product_type === "clips" || media.is_video ? "reel" : "p";
  return {
    shortcode,
    url: `https://www.instagram.com/${page}/${shortcode}/`,
    kind,
    kindLabel: kindLabel(kind, media.product_type),
    caption,
    hashtags: pickStrings(caption, /#([\p{L}\p{N}_]+)/gu),
    mentions: pickStrings(caption, /@([A-Za-z0-9._]+)/g).filter(
      (name) => name.toLowerCase() !== username.toLowerCase(),
    ),
    altText: alt && alt !== caption ? alt : null,
    owner: {
      username,
      verified: Boolean(media.owner?.is_verified),
      followers: finiteOrNull(media.owner?.edge_followed_by?.count),
      avatarUrl: media.owner?.profile_pic_url || null,
    },
    likes: finiteOrNull(media.edge_liked_by?.count),
    comments: finiteOrNull(media.edge_media_to_comment?.count),
    views: finiteOrNull(video?.video_view_count ?? media.video_view_count),
    durationSeconds: duration,
    width: finiteOrNull(media.dimensions?.width),
    height: finiteOrNull(media.dimensions?.height),
    thumbnailUrl: media.display_url || null,
    postedAt: postedAtFromId(media.id),
    music,
    hasAudio,
    overLimit: duration != null && duration > MAX_TRANSCRIBE_SECONDS,
    videoUrl: hasAudio ? video!.video_url! : null,
    copyrightBlocked: blocked,
  };
}

function publicPost(resolved: Resolved): PostMeta {
  const { videoUrl: _video, copyrightBlocked: _blocked, ...post } = resolved;
  return post;
}

async function fetchEmbed(shortcode: string, kind: "reel" | "p" | "tv"): Promise<Resolved> {
  const order: Array<"reel" | "p" | "tv"> =
    kind === "p" ? ["p", "reel", "tv"] : kind === "tv" ? ["tv", "reel", "p"] : ["reel", "p", "tv"];
  let sawRateLimit = false;
  for (const path of order) {
    const endpoint = `https://www.instagram.com/${path}/${shortcode}/embed/captioned/`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      continue;
    }
    if (response.status === 429) {
      sawRateLimit = true;
      continue;
    }
    if (!response.ok) continue;
    const html = await response.text();
    const payload = parseEmbedHtml(html);
    const media = payload?.gql_data?.shortcode_media;
    if (!media) continue;
    const resolved = toResolved(media, Boolean(payload?.context?.copyright_blocked));
    if (resolved) return resolved;
  }
  throw new Error(
    sawRateLimit
      ? "Instagram is rate-limiting requests. Wait a moment and try again."
      : "Couldn't read that post. It may be private, deleted, or not a public reel or post.",
  );
}

async function resolveInput(rawUrl: string): Promise<Resolved> {
  const parsed = parseInstagramInput(rawUrl);
  if (!parsed) {
    throw new Error("Paste a public Instagram reel or post link.");
  }
  const cached = mediaCache.get(parsed.shortcode);
  if (cached && Date.now() - cached.at < MEDIA_TTL_MS) return cached.resolved;
  const resolved = await fetchEmbed(parsed.shortcode, parsed.kind);
  mediaCache.set(resolved.shortcode, { at: Date.now(), resolved });
  return resolved;
}

export async function readPostInner(rawUrl: string): Promise<ReadResult> {
  try {
    const resolved = await resolveInput(rawUrl);
    return { ok: true, post: publicPost(resolved) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Couldn't read that post.",
    };
  }
}

function keytermsFor(post: PostMeta): string[] {
  const terms: string[] = [];
  const push = (value: string | null | undefined) => {
    const term = value?.trim() ?? "";
    if (!term || term.length > 50 || terms.includes(term)) return;
    if (terms.length >= 12) return;
    terms.push(term);
  };
  push(post.owner.username);
  for (const tag of post.hashtags) push(tag);
  if (post.music && !post.music.original) {
    push(post.music.artist);
    push(post.music.title);
  }
  return terms;
}

function joinWords(words: string[]): string {
  return words.join(" ").replace(/\s+([.,!?;:…])/g, "$1").replace(/\s+/g, " ").trim();
}

function buildTranscript(payload: {
  text?: string;
  language?: string;
  duration?: number;
  words?: Word[];
}): Transcript {
  const words = (payload.words ?? []).filter(
    (word) => typeof word.text === "string" && word.text.trim() && typeof word.start === "number",
  );
  const cues: Cue[] = [];
  let bucket: Word[] = [];
  const flush = () => {
    if (!bucket.length) return;
    const text = joinWords(bucket.map((word) => word.text!.trim()));
    if (!text) {
      bucket = [];
      return;
    }
    cues.push({
      start: bucket[0]!.start ?? 0,
      end: bucket[bucket.length - 1]!.end ?? bucket[bucket.length - 1]!.start ?? 0,
      text,
      speaker: typeof bucket[0]!.speaker === "number" ? bucket[0]!.speaker! : null,
    });
    bucket = [];
  };
  for (const word of words) {
    const prev = bucket[bucket.length - 1];
    const gap = prev && typeof prev.end === "number" ? (word.start ?? 0) - prev.end : 0;
    const speakerChange =
      prev != null &&
      typeof word.speaker === "number" &&
      typeof prev.speaker === "number" &&
      word.speaker !== prev.speaker;
    const length = bucket.reduce((sum, item) => sum + (item.text?.length ?? 0) + 1, 0);
    const endPunct = prev?.text ? /[.!?]$/.test(prev.text) && length > 48 : false;
    if (bucket.length && (gap > 0.7 || speakerChange || length > 96 || endPunct)) flush();
    bucket.push(word);
  }
  flush();

  const paragraphs: string[] = [];
  let para: string[] = [];
  let lastEnd = 0;
  for (const cue of cues) {
    if (para.length && cue.start - lastEnd > 1.15) {
      paragraphs.push(para.join(" "));
      para = [];
    }
    para.push(cue.text);
    lastEnd = cue.end;
  }
  if (para.length) paragraphs.push(para.join(" "));

  const text = (payload.text ?? "").trim() || paragraphs.join("\n\n");
  const speakers = new Set(cues.map((cue) => cue.speaker).filter((n) => n != null));
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return {
    text,
    paragraphs: paragraphs.length ? paragraphs : text ? [text] : [],
    language: payload.language?.trim() || null,
    durationSeconds: finiteOrNull(payload.duration),
    cues,
    wordCount,
    speakerCount: speakers.size,
  };
}

async function postStt(form: FormData): Promise<{ ok: true; body: unknown } | { ok: false; status: number; detail: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 0, detail: "Speech transcription isn't available in this environment." };
  }
  const response = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(170_000),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 400);
    } catch {
      detail = "";
    }
    return { ok: false, status: response.status, detail };
  }
  return { ok: true, body: await response.json() };
}

function sttForm(terms: string[], videoUrl: string | null, file?: Blob): FormData {
  const form = new FormData();
  form.set("model", "grok-voice-transcribe-2.0");
  form.set("diarize", "true");
  for (const term of terms) form.append("keyterm", term);
  if (file) form.append("file", file, "reel.mp4");
  else if (videoUrl) form.set("url", videoUrl);
  return form;
}

async function transcribeVideo(videoUrl: string, terms: string[]): Promise<Transcript> {
  let attempt = await postStt(sttForm(terms, videoUrl));
  if (!attempt.ok && attempt.status !== 401 && attempt.status !== 403 && attempt.status !== 0) {
    const media = await fetch(videoUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(70_000),
    });
    if (media.ok) {
      const length = Number(media.headers.get("content-length") || "0");
      if (length > 0 && length < 80_000_000) {
        const bytes = await media.arrayBuffer();
        attempt = await postStt(sttForm(terms, null, new Blob([bytes], { type: "video/mp4" })));
      }
    }
  }
  if (!attempt.ok) {
    if (attempt.status === 0) throw new Error(attempt.detail);
    if (attempt.status === 401 || attempt.status === 403) {
      throw new Error("Speech transcription isn't available right now.");
    }
    throw new Error("The audio couldn't be transcribed. The caption and metadata are still here.");
  }
  const body = attempt.body as {
    text?: string;
    language?: string;
    duration?: number;
    words?: Word[];
  };
  return buildTranscript(body);
}

export async function transcribePostInner(rawUrl: string): Promise<TranscribeResult> {
  try {
    const resolved = await resolveInput(rawUrl);
    if (resolved.copyrightBlocked) {
      return { ok: false, error: "A copyright claim blocks this audio, so there's no script." };
    }
    if (!resolved.hasAudio || !resolved.videoUrl) {
      return { ok: false, error: "This post has no video audio. The caption is the copy." };
    }
    if (resolved.overLimit) {
      return {
        ok: false,
        error: "This video is longer than 10 minutes, so the spoken script was skipped.",
      };
    }
    const cached = transcriptCache.get(resolved.shortcode);
    if (cached && Date.now() - cached.at < TRANSCRIPT_TTL_MS) {
      return { ok: true, transcript: cached.transcript };
    }
    const existing = inflight.get(resolved.shortcode);
    if (existing) return existing;
    if (!countHit()) {
      return { ok: false, error: "Too many scripts just now. Try again in a few minutes." };
    }
    const pending = transcribeVideo(resolved.videoUrl, keytermsFor(publicPost(resolved)))
      .then((transcript) => {
        transcriptCache.set(resolved.shortcode, { at: Date.now(), transcript });
        return { ok: true as const, transcript };
      })
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "The audio couldn't be transcribed.",
      }))
      .finally(() => {
        inflight.delete(resolved.shortcode);
      });
    inflight.set(resolved.shortcode, pending);
    return pending;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Couldn't transcribe that post.",
    };
  }
}

function sourceKey(shortcode: string, source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 33 + source.charCodeAt(i)) >>> 0;
  return `${shortcode}:${hash}`;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
}

function asLesson(value: unknown): Lesson | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const claim = typeof raw.claim === "string" ? clip(raw.claim, 400) : "";
  const check = typeof raw.check === "string" ? clip(raw.check, 240) : "";
  if (claim.length < 8 || check.length < 8) return null;
  const concepts = Array.isArray(raw.concepts)
    ? raw.concepts
        .flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          const name = typeof row.name === "string" ? clip(row.name, 80) : "";
          const meaning = typeof row.meaning === "string" ? clip(row.meaning, 280) : "";
          if (!name || !meaning) return [];
          return [{ name, meaning }];
        })
        .slice(0, 4)
    : [];
  const practice = Array.isArray(raw.practice)
    ? raw.practice
        .flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          const action = typeof row.action === "string" ? clip(row.action, 280) : "";
          const proves = typeof row.proves === "string" ? clip(row.proves, 220) : "";
          if (!action || !proves) return [];
          return [{ action, proves }];
        })
        .slice(0, 3)
    : [];
  if (concepts.length < 1 || practice.length < 1) return null;
  return { claim, concepts, practice, check };
}

async function askForLesson(source: string): Promise<Lesson> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("Pulling ideas isn't available right now.");
  const instructions = [
    "Turn this short video into something a person can practice. You are not writing a summary.",
    "Use only the source. Ignore follow, comment, download, and link-in-bio pitches.",
    "Concepts are ideas they could use without the creator's product.",
    "Each practice is something they can finish in under an hour on their own work.",
    "Do not invent tools, numbers, or steps the source does not support. Do not write a count unless the source stated that count.",
    "If the video is mostly a pitch, say that in the claim and practice the smallest real skill under it.",
    "Plain words. No leverage, unlock, dive in, or game-changer.",
    "Return JSON only:",
    '{"claim":"one sentence","concepts":[{"name":"","meaning":""}],"practice":[{"action":"","proves":""}],"check":"one question to answer from memory"}',
    "2 to 4 concepts. 2 practices.",
  ].join(" ");
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: instructions },
          {
            role: "user",
            content:
              attempt === 0
                ? source
                : `${source}\n\nYour last answer was not usable JSON. Return only the object.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Pulling ideas isn't available right now.");
      }
      if (attempt === 0 && response.status >= 500) continue;
      throw new Error("The ideas couldn't be pulled. The script is still here.");
    }
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    last = body.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(last.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      const lesson = asLesson(parsed);
      if (lesson) return lesson;
    } catch {
      // Retry once below.
    }
  }
  if (!last) throw new Error("The ideas couldn't be pulled. The script is still here.");
  throw new Error("The ideas came back muddled. Try again.");
}

export async function learnPostInner(rawUrl: string, script: string): Promise<LearnResult> {
  try {
    const resolved = await resolveInput(rawUrl);
    const spoken = script.trim();
    const cachedTranscript = transcriptCache.get(resolved.shortcode)?.transcript.text ?? "";
    const sourceText = clip(spoken || cachedTranscript || resolved.caption, 8000);
    if (sourceText.length < 40) {
      return { ok: false, error: "There aren't enough words here to pull an idea from." };
    }
    const source = [
      `Creator: @${resolved.owner.username}`,
      resolved.caption ? `Caption: ${clip(resolved.caption, 1200)}` : "",
      `Words:\n${sourceText}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const key = sourceKey(resolved.shortcode, source);
    const cached = lessonCache.get(key);
    if (cached && Date.now() - cached.at < TRANSCRIPT_TTL_MS) {
      return { ok: true, lesson: cached.lesson };
    }
    if (!countLesson()) {
      return { ok: false, error: "Too many idea pulls just now. Try again in a few minutes." };
    }
    const lesson = await askForLesson(source);
    lessonCache.set(key, { at: Date.now(), lesson });
    return { ok: true, lesson };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The ideas couldn't be pulled.",
    };
  }
}
