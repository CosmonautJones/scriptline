import type { Lesson, PostMeta, Transcript } from "./extract-types";
import { formatClock, formatCount, formatSrtTime, languageName } from "./format";

function stamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function toMarkdown(post: PostMeta, transcript: Transcript | null, lesson?: Lesson | null): string {
  const lines: string[] = [];
  lines.push(`# @${post.owner.username}`);
  const bits = [post.kindLabel, stamp(post.postedAt), formatClock(post.durationSeconds)].filter(
    (bit) => bit && bit !== "—",
  );
  lines.push(bits.join(" · "));
  lines.push("");
  lines.push(post.url);
  lines.push("");
  const stats = [
    post.views != null ? `${formatCount(post.views)} views` : "",
    post.likes != null ? `${formatCount(post.likes)} likes` : "",
    post.comments != null ? `${formatCount(post.comments)} comments` : "",
  ].filter(Boolean);
  if (stats.length) lines.push(stats.join(" · "), "");
  if (post.music) {
    lines.push(
      post.music.original
        ? `Audio: original · ${post.music.artist}`
        : `Audio: ${post.music.title} — ${post.music.artist}`,
    );
    lines.push("");
  }
  lines.push("## Caption", "", post.caption || "_No caption._", "");
  if (post.replies?.length) {
    lines.push("## Replies", "");
    for (const reply of post.replies) {
      lines.push(`- **@${reply.username}.** ${reply.text}`);
    }
    lines.push("");
  }
  if (transcript && transcript.text) {
    lines.push(
      `## Script`,
      "",
      transcript.language ? `_${languageName(transcript.language)}_ · ${transcript.wordCount} words` : "",
      "",
      transcript.paragraphs.join("\n\n") || transcript.text,
      "",
    );
    if (transcript.cues.length) {
      lines.push("## Timed", "");
      for (const cue of transcript.cues) {
        const who =
          transcript.speakerCount > 1 && cue.speaker != null ? `S${cue.speaker + 1} ` : "";
        lines.push(`- ${formatClock(cue.start)} ${who}${cue.text}`);
      }
      lines.push("");
    }
  }
  if (lesson) {
    if (lesson.brief) lines.push("## The post", "", lesson.brief, "");
    if (lesson.learnings?.length) {
      lines.push("## What you can learn", "");
      for (const item of lesson.learnings) {
        const from =
          item.from === "said"
            ? "audio"
            : item.from === "caption"
              ? "caption"
              : item.from === "reply"
                ? "reply"
                : "frame";
        lines.push(`- ${item.point} _(${from})_`);
      }
      lines.push("");
    }
    lines.push("## Claim", "", lesson.claim, "", "## Concepts", "");
    for (const concept of lesson.concepts) {
      lines.push(`- **${concept.name}.** ${concept.meaning}`);
    }
    lines.push("", "## Practice", "");
    lesson.practice.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.action}`, "", step.proves, "");
    });
    lines.push("## Check", "", lesson.check, "");
  }
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n").trim() + "\n";
}

export function toSrt(transcript: Transcript): string {
  return (
    transcript.cues
      .map((cue, index) => {
        const who =
          transcript.speakerCount > 1 && cue.speaker != null ? `S${cue.speaker + 1}: ` : "";
        return `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${who}${cue.text}\n`;
      })
      .join("\n") + (transcript.cues.length ? "" : "")
  );
}

export function toText(transcript: Transcript): string {
  return `${transcript.paragraphs.join("\n\n") || transcript.text}\n`;
}

export function toJson(post: PostMeta, transcript: Transcript | null, lesson?: Lesson | null): string {
  return JSON.stringify({ post, transcript, lesson: lesson ?? null }, null, 2);
}

export function toNotebook(
  entries: {
    enteredAt: string;
    input: string;
    post: PostMeta | null;
    transcript: Transcript | null;
    lesson?: Lesson | null;
    error: string | null;
  }[],
): string {
  const blocks = entries.flatMap((entry) => {
    if (!entry.post) {
      return entry.error ? [`# Failed\n\n${entry.input}\n\n${entry.error}\n`] : [];
    }
    return [toMarkdown(entry.post, entry.transcript, entry.lesson)];
  });
  return blocks.join("\n---\n\n");
}
