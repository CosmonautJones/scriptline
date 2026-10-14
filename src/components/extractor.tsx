import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowUpRight,
  AudioLines,
  BadgeCheck,
  Check,
  Clapperboard,
  Copy,
  Eye,
  FileJson,
  FileText,
  Heart,
  ListChecks,
  MessageCircle,
  Music2,
  Subtitles,
} from "lucide-react";
import { learnPost, readPost, transcribePost } from "@/lib/extract.functions";
import type { Lesson, PostMeta, Transcript } from "@/lib/extract-types";
import { toJson, toMarkdown, toNotebook, toSrt, toText } from "@/lib/export-script";
import { formatClock, formatCount, languageName } from "@/lib/format";
import { clearLog, commitLog, loadLog, logDetail, logTitle, type LogEntry } from "@/lib/log";

const SAMPLE_URL = "https://www.instagram.com/reel/Dd7XBExRZQy/";
const BATCH_LIMIT = 12;

function splitLinks(raw: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const link = part.trim();
    if (!link || seen.has(link)) continue;
    seen.add(link);
    links.push(link);
  }
  return links;
}

type Phase = "idle" | "reading" | "transcribing" | "done";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

function postedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "MMM d, yyyy");
}

function enteredLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "MMM d, h:mm a");
}

export function Extractor() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [post, setPost] = useState<PostMeta | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [view, setView] = useState<"script" | "timed" | "practice">("script");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const [learning, setLearning] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const items = loadLog();
    setHistory(items);
    const latest = items.find((item) => item.post);
    if (!latest?.post) return;
    setPost(latest.post);
    setTranscript(latest.transcript);
    setTranscriptError(latest.transcriptError);
    setLesson(latest.lesson ?? null);
    setUrl(latest.input);
    setPhase("done");
  }, []);

  function openSaved(item: LogEntry) {
    setPost(item.post);
    setTranscript(item.transcript);
    setTranscriptError(item.transcriptError);
    setLesson(item.lesson ?? null);
    setLessonError(null);
    setUrl(item.input);
    setError(item.status === "failed" ? item.error : null);
    setView("script");
    setThumbFailed(false);
    setAvatarFailed(false);
    setPhase(item.post ? "done" : "idle");
  }

  async function extractOne(target: string): Promise<string | null> {
    const entryId = crypto.randomUUID();
    const started: LogEntry = {
      id: entryId,
      enteredAt: new Date().toISOString(),
      input: target,
      status: "reading",
      error: null,
      post: null,
      transcript: null,
      transcriptError: null,
    };
    setHistory(commitLog(started));
    setPhase("reading");
    setError(null);
    setTranscript(null);
    setTranscriptError(null);
    setLesson(null);
    setLessonError(null);
    setThumbFailed(false);
    setAvatarFailed(false);
    setView("script");

    try {
      const read = await readPost({ data: { url: target } });
      if (!read.ok) {
        setHistory(commitLog({ ...started, status: "failed", error: read.error }));
        return read.error;
      }
      setPost(read.post);
      let nextTranscript: Transcript | null = null;
      let nextError: string | null = null;
      if (read.post.hasAudio && !read.post.overLimit) {
        setPhase("transcribing");
        const spoken = await transcribePost({ data: { url: read.post.url } });
        if (spoken.ok) nextTranscript = spoken.transcript;
        else nextError = spoken.error;
      } else if (read.post.overLimit) {
        nextError = "This video is longer than 10 minutes, so the spoken script was skipped.";
      }
      setTranscript(nextTranscript);
      setTranscriptError(nextError);
      const previous = loadLog().find((item) => item.post?.shortcode === read.post.shortcode);
      setLesson(previous?.lesson ?? null);
      setHistory(
        commitLog({
          ...started,
          input: read.post.url,
          status: "saved",
          post: read.post,
          transcript: nextTranscript,
          transcriptError: nextError,
          lesson: previous?.lesson ?? null,
        }),
      );
      setPhase("done");
      return null;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Something went wrong reading that link.";
      setHistory(commitLog({ ...started, status: "failed", error: message }));
      return message;
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const links = splitLinks(url);
    if (!links.length) {
      setError("Paste a public Instagram reel or post link.");
      return;
    }
    if (links.length > BATCH_LIMIT) {
      setError(`Paste up to ${BATCH_LIMIT} links at a time.`);
      return;
    }
    const failures: string[] = [];
    for (let index = 0; index < links.length; index++) {
      setProgress({ index, total: links.length });
      const failure = await extractOne(links[index]!);
      if (failure) failures.push(failure);
    }
    setProgress(null);
    if (links.length === 1) {
      setUrl(links[0]!);
      setError(failures[0] ?? null);
      return;
    }
    setUrl(links.join("\n"));
    setError(failures.length ? `${failures.length} of ${links.length} links couldn't be read.` : null);
    setPhase("done");
  }

  async function pasteLink() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setUrl(text);
    } catch {
      setError("Clipboard is blocked. Paste the link into the field.");
    }
  }

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600);
    } catch {
      setError("Couldn't copy from here. Select the script and copy it manually.");
    }
  }

  async function pullLesson() {
    if (!post || learning) return;
    const script = transcript?.text || post.caption;
    setLearning(true);
    setLessonError(null);
    setView("practice");
    try {
      const result = await learnPost({ data: { url: post.url, script } });
      if (!result.ok) {
        setLessonError(result.error);
        return;
      }
      setLesson(result.lesson);
      const current = loadLog().find((item) => item.post?.shortcode === post.shortcode);
      if (current) setHistory(commitLog({ ...current, lesson: result.lesson }));
    } catch (caught) {
      setLessonError(caught instanceof Error ? caught.message : "The ideas couldn't be pulled.");
    } finally {
      setLearning(false);
    }
  }

  function lessonText(item: Lesson): string {
    const concepts = item.concepts.map((concept) => `${concept.name}: ${concept.meaning}`).join("\n");
    const practice = item.practice
      .map((step, index) => `${index + 1}. ${step.action}\n${step.proves}`)
      .join("\n\n");
    return `Claim\n${item.claim}\n\nConcepts\n${concepts}\n\nPractice\n${practice}\n\nCheck\n${item.check}`;
  }

  const busy = phase === "reading" || phase === "transcribing" || progress !== null;
  const portrait = post ? (post.height ?? 1) >= (post.width ?? 0) : true;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? history.filter((item) =>
        [logTitle(item), logDetail(item), item.input, item.post?.caption, item.transcript?.text, item.lesson?.claim]
          .filter(Boolean)
          .join("\n")
          .toLowerCase()
          .includes(needle),
      )
    : history;

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-fg">
      <div className="h-1 bg-accent" />
      <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-widest text-accent uppercase">Instagram</p>
          <h1 className="font-display text-4xl leading-none font-medium sm:text-5xl">Scriptline</h1>
          <p className="max-w-xl text-base leading-relaxed text-muted">
            Paste one public link, or a list. Pull the script, then the idea worth practicing.
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label htmlFor="reel-url" className="text-sm font-medium">
            Reel or post links
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <textarea
              id="reel-url"
              name="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="One link, or several on their own lines"
              rows={url.includes("\n") ? Math.min(8, url.split("\n").length) : 1}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              className="min-h-12 w-full min-w-0 flex-1 resize-none rounded-xl border border-line bg-surface px-4 py-3 text-base leading-6 text-fg outline-none placeholder:text-muted focus-visible:border-accent disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy}
              className="h-12 shrink-0 rounded-xl bg-accent px-5 text-base font-semibold text-accent-fg disabled:opacity-60"
            >
              {progress && progress.total > 1
                ? `${progress.index + 1} of ${progress.total}`
                : phase === "reading"
                  ? "Reading…"
                  : phase === "transcribing"
                    ? "Transcribing…"
                    : "Extract"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={pasteLink}
              disabled={busy}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-sm font-medium disabled:opacity-60"
            >
              Paste
            </button>
            <button
              type="button"
              onClick={() => setUrl(SAMPLE_URL)}
              disabled={busy}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-sm font-medium disabled:opacity-60"
            >
              Try a sample reel
            </button>
          </div>
        </form>

        <p role="status" className="sr-only">
          {phase === "reading"
            ? "Reading the post"
            : phase === "transcribing"
              ? "Transcribing speech"
              : error
                ? error
                : ""}
        </p>

        {error ? (
          <div className="flex gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : null}

        {post ? (
          <article className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex gap-4 p-4 sm:p-5">
              <div
                className={`relative shrink-0 overflow-hidden rounded-xl bg-surface-2 ${
                  portrait ? "aspect-reel w-24 sm:w-32" : "aspect-video w-36 sm:w-48"
                }`}
              >
                {post.thumbnailUrl && !thumbFailed ? (
                  <img
                    src={post.thumbnailUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setThumbFailed(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted">
                    <Clapperboard className="size-6" aria-hidden="true" />
                  </div>
                )}
                {post.durationSeconds != null ? (
                  <span className="absolute right-1.5 bottom-1.5 rounded-md bg-bg px-1.5 py-0.5 text-xs font-medium text-fg tabular-nums">
                    {formatClock(post.durationSeconds)}
                  </span>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-2">
                  {post.owner.avatarUrl && !avatarFailed ? (
                    <img
                      src={post.owner.avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarFailed(true)}
                      className="size-9 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold">
                      {post.owner.username.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <a
                      href={`https://www.instagram.com/${post.owner.username}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 truncate font-semibold"
                    >
                      @{post.owner.username}
                      {post.owner.verified ? (
                        <BadgeCheck className="size-4 shrink-0 text-accent" aria-label="Verified" />
                      ) : null}
                    </a>
                    <p className="truncate text-sm text-muted">
                      {[
                        post.kindLabel,
                        postedLabel(post.postedAt),
                        post.owner.followers != null
                          ? `${formatCount(post.owner.followers)} followers`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {post.views != null ? (
                    <div className="flex items-center gap-1.5">
                      <Eye className="size-3.5 text-muted" aria-hidden="true" />
                      <dt className="sr-only">Views</dt>
                      <dd className="font-medium tabular-nums">{formatCount(post.views)}</dd>
                    </div>
                  ) : null}
                  {post.likes != null ? (
                    <div className="flex items-center gap-1.5">
                      <Heart className="size-3.5 text-muted" aria-hidden="true" />
                      <dt className="sr-only">Likes</dt>
                      <dd className="font-medium tabular-nums">{formatCount(post.likes)}</dd>
                    </div>
                  ) : null}
                  {post.comments != null ? (
                    <div className="flex items-center gap-1.5">
                      <MessageCircle className="size-3.5 text-muted" aria-hidden="true" />
                      <dt className="sr-only">Comments</dt>
                      <dd className="font-medium tabular-nums">{formatCount(post.comments)}</dd>
                    </div>
                  ) : null}
                </dl>
                {post.music ? (
                  <p className="flex items-start gap-1.5 text-sm text-muted">
                    <Music2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      {post.music.original
                        ? `Original audio · ${post.music.artist}`
                        : `${post.music.title} — ${post.music.artist}`}
                    </span>
                  </p>
                ) : null}
                <a
                  href={post.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-auto inline-flex h-11 items-center gap-1 self-start text-sm font-medium text-accent"
                >
                  Open on Instagram
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="border-t border-line px-4 py-4 sm:px-5">
              <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Caption</h2>
              <p className="mt-2 text-base leading-relaxed whitespace-pre-wrap break-words">
                {post.caption || "No caption."}
              </p>
              {post.altText ? (
                <p className="mt-2 text-sm leading-relaxed text-muted">Alt text: {post.altText}</p>
              ) : null}
              {post.hashtags.length || post.mentions.length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {post.hashtags.map((tag) => (
                    <li key={`h-${tag}`}>
                      <a
                        href={`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-11 items-center rounded-full border border-line px-3 text-sm text-muted"
                      >
                        #{tag}
                      </a>
                    </li>
                  ))}
                  {post.mentions.map((name) => (
                    <li key={`m-${name}`}>
                      <a
                        href={`https://www.instagram.com/${name}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-11 items-center rounded-full border border-line px-3 text-sm text-muted"
                      >
                        @{name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="border-t border-line px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl leading-none font-medium">Script</h2>
                  {transcript && transcript.wordCount > 0 ? (
                    <p className="mt-2 text-sm text-muted">
                      {languageName(transcript.language)} · {transcript.wordCount} words
                      {transcript.speakerCount > 1 ? ` · ${transcript.speakerCount} speakers` : ""}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-muted">Spoken words from the audio</p>
                  )}
                </div>
                {transcript?.text || post.caption ? (
                  <div className="flex rounded-xl border border-line p-1" role="tablist" aria-label="Script view">
                    {transcript && transcript.wordCount > 0 ? (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={view === "script"}
                        onClick={() => setView("script")}
                        className={`h-10 rounded-lg px-3 text-sm font-medium ${
                          view === "script" ? "bg-surface-2 text-fg" : "text-muted"
                        }`}
                      >
                        Prose
                      </button>
                    ) : null}
                    {transcript && transcript.cues.length > 0 ? (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={view === "timed"}
                        onClick={() => setView("timed")}
                        className={`h-10 rounded-lg px-3 text-sm font-medium ${
                          view === "timed" ? "bg-surface-2 text-fg" : "text-muted"
                        }`}
                      >
                        Timed
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === "practice"}
                      onClick={() => setView("practice")}
                      className={`h-10 rounded-lg px-3 text-sm font-medium ${
                        view === "practice" ? "bg-surface-2 text-fg" : "text-muted"
                      }`}
                    >
                      Practice
                    </button>
                  </div>
                ) : null}
              </div>

              {phase === "transcribing" ? (
                <div className="mt-4">
                  <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="scriptline-bar h-full w-1/3 bg-accent" />
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                    <AudioLines className="size-4 text-accent" aria-hidden="true" />
                    Listening to the audio…
                  </p>
                </div>
              ) : null}

              {phase !== "transcribing" && view === "practice" ? (
                <div className="mt-4 flex flex-col gap-5">
                  {!lesson && !learning ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-base leading-relaxed text-muted">
                        The script is the raw material. Pull the claim, the ideas worth keeping, and
                        something you can do today without their product.
                      </p>
                      <button
                        type="button"
                        onClick={() => void pullLesson()}
                        disabled={!transcript?.text && !post.caption}
                        className="h-12 rounded-xl bg-accent px-5 text-base font-semibold text-accent-fg disabled:opacity-60"
                      >
                        Extract the ideas
                      </button>
                    </div>
                  ) : null}
                  {learning ? (
                    <p className="text-sm text-muted">Reading for the idea, not a recap…</p>
                  ) : null}
                  {lessonError ? <p className="text-base leading-relaxed text-muted">{lessonError}</p> : null}
                  {lesson ? (
                    <div className="flex flex-col gap-5">
                      <div>
                        <h3 className="text-xs font-semibold tracking-widest text-accent uppercase">Claim</h3>
                        <p className="mt-2 text-base leading-relaxed">{lesson.claim}</p>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">Concepts</h3>
                        <ul className="mt-2 flex flex-col gap-3">
                          {lesson.concepts.map((concept) => (
                            <li key={concept.name}>
                              <p className="text-sm font-semibold">{concept.name}</p>
                              <p className="mt-1 text-sm leading-relaxed text-muted">{concept.meaning}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">Do this</h3>
                        <ol className="mt-2 flex flex-col gap-3">
                          {lesson.practice.map((step) => (
                            <li key={step.action}>
                              <p className="text-sm leading-relaxed">{step.action}</p>
                              <p className="mt-1 text-sm leading-relaxed text-muted">{step.proves}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">Check</h3>
                        <p className="mt-2 text-base leading-relaxed">{lesson.check}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copyText("lesson", lessonText(lesson))}
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm font-medium"
                        >
                          {copied === "lesson" ? (
                            <Check className="size-4 text-accent" aria-hidden="true" />
                          ) : (
                            <Copy className="size-4" aria-hidden="true" />
                          )}
                          {copied === "lesson" ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {phase !== "transcribing" && transcript && transcript.wordCount > 0 && view === "script" ? (
                <div className="mt-4 flex flex-col gap-4">
                  {transcript.paragraphs.map((paragraph, index) => (
                    <p key={index} className="text-base leading-relaxed break-words">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ) : null}

              {phase !== "transcribing" && transcript && transcript.wordCount > 0 && view === "timed" ? (
                <ol className="mt-2">
                  {transcript.cues.map((cue, index) => (
                    <li key={`${cue.start}-${index}`} className="flex gap-3 border-b border-line py-3">
                      <span className="w-14 shrink-0 text-sm text-muted tabular-nums">
                        {formatClock(cue.start)}
                      </span>
                      <p className="min-w-0 text-sm leading-relaxed break-words">
                        {transcript.speakerCount > 1 && cue.speaker != null ? (
                          <span className="mr-2 font-semibold text-accent">S{cue.speaker + 1}</span>
                        ) : null}
                        {cue.text}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : null}

              {phase !== "transcribing" && transcript && transcript.wordCount === 0 ? (
                <p className="mt-4 text-base leading-relaxed text-muted">
                  No speech detected. This may be music or a silent clip. The caption above is the
                  copy.
                </p>
              ) : null}

              {phase !== "transcribing" && !transcript && transcriptError ? (
                <p className="mt-4 text-base leading-relaxed text-muted">{transcriptError}</p>
              ) : null}

              {phase !== "transcribing" && !transcript && !transcriptError && !post.hasAudio ? (
                <p className="mt-4 text-base leading-relaxed text-muted">
                  This post has no video audio. The caption is the copy.
                </p>
              ) : null}

              {transcript && transcript.text && view !== "practice" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        "script",
                        transcript.paragraphs.join("\n\n") || transcript.text,
                      )
                    }
                    className="inline-flex h-11 min-w-28 flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-medium"
                  >
                    {copied === "script" ? (
                      <Check className="size-4 text-accent" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                    {copied === "script" ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        `${post.owner.username}-${post.shortcode}.md`,
                        toMarkdown(post, transcript, lesson),
                        "text/markdown",
                      )
                    }
                    className="inline-flex h-11 min-w-28 flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-medium"
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    Markdown
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        `${post.owner.username}-${post.shortcode}.txt`,
                        toText(transcript),
                        "text/plain",
                      )
                    }
                    className="inline-flex h-11 min-w-28 flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-medium"
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    Text
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        `${post.owner.username}-${post.shortcode}.srt`,
                        toSrt(transcript),
                        "application/x-subrip",
                      )
                    }
                    disabled={transcript.cues.length === 0}
                    className="inline-flex h-11 min-w-28 flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-medium disabled:opacity-40"
                  >
                    <Subtitles className="size-4" aria-hidden="true" />
                    SRT
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        `${post.owner.username}-${post.shortcode}.json`,
                        toJson(post, transcript, lesson),
                        "application/json",
                      )
                    }
                    className="inline-flex h-11 min-w-28 flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-medium"
                  >
                    <FileJson className="size-4" aria-hidden="true" />
                    JSON
                  </button>
                </div>
              ) : null}

              {transcript && transcript.wordCount > 0 && view !== "practice" ? (
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Speech-to-text of the audio. Names and music can come through imperfectly.
                </p>
              ) : null}
            </div>
          </article>
        ) : (
          <section className="grid gap-3 sm:grid-cols-3" aria-label="What you get">
            <Feature
              icon={<Clapperboard className="size-5" aria-hidden="true" />}
              title="Metadata"
              body="Creator, date, caption, views, likes, comments, and the audio credit."
            />
            <Feature
              icon={<AudioLines className="size-5" aria-hidden="true" />}
              title="Spoken script"
              body="The words said in the reel, not just the caption under it."
            />
            <Feature
              icon={<ListChecks className="size-5" aria-hidden="true" />}
              title="What to practice"
              body="The claim, the ideas you can reuse, and one thing to do today. Not another summary."
            />
          </section>
        )}

        {history.length > 0 ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
                Log · {needle ? `${shown.length} of ${history.length}` : history.length}
              </h2>
              <button
                type="button"
                onClick={() => {
                  clearLog();
                  setHistory([]);
                  setQuery("");
                }}
                className="h-11 px-2 text-sm text-muted"
              >
                Clear
              </button>
            </div>
            <label className="sr-only" htmlFor="log-search">
              Search the log
            </label>
            <input
              id="log-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search creators, scripts, claims"
              className="h-11 w-full rounded-xl border border-line bg-surface px-4 text-base text-fg outline-none placeholder:text-muted focus-visible:border-accent"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => download("scriptline-log.md", toNotebook(history), "text/markdown")}
                className="h-11 flex-1 rounded-xl border border-line bg-surface px-3 text-sm font-medium"
              >
                Download notebook
              </button>
              <button
                type="button"
                onClick={() =>
                  download("scriptline-log.json", JSON.stringify(history, null, 2), "application/json")
                }
                className="h-11 flex-1 rounded-xl border border-line bg-surface px-3 text-sm font-medium"
              >
                Download JSON
              </button>
            </div>
            {shown.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">Nothing in the log matches that.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map((item) => {
                  const active = item.post ? post?.shortcode === item.post.shortcode : url === item.input && !post;
                  const when = enteredLabel(item.enteredAt);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openSaved(item)}
                        className={`flex w-full min-w-0 flex-col gap-1 rounded-2xl border px-4 py-3 text-left ${
                          active ? "border-accent bg-surface" : "border-line bg-surface"
                        }`}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-semibold">{logTitle(item)}</span>
                          <span className="shrink-0 text-xs text-muted tabular-nums">{when}</span>
                        </span>
                        <span className="line-clamp-2 text-sm leading-relaxed text-muted">{logDetail(item)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        <p className="text-sm leading-relaxed text-muted">
          Public posts only. Private, deleted, and login-walled links won't open.
        </p>
      </main>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-accent">{icon}</div>
      <h2 className="mt-3 text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}
