export const MAX_TRANSCRIBE_SECONDS = 600;

export type MediaKind = "video" | "image" | "carousel";

export type PostMeta = {
  shortcode: string;
  url: string;
  kind: MediaKind;
  kindLabel: string;
  caption: string;
  hashtags: string[];
  mentions: string[];
  altText: string | null;
  owner: {
    username: string;
    verified: boolean;
    followers: number | null;
    avatarUrl: string | null;
  };
  likes: number | null;
  comments: number | null;
  views: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  postedAt: string | null;
  music: { artist: string; title: string; original: boolean } | null;
  hasAudio: boolean;
  overLimit: boolean;
};

export type Cue = {
  start: number;
  end: number;
  text: string;
  speaker: number | null;
};

export type Transcript = {
  text: string;
  paragraphs: string[];
  language: string | null;
  durationSeconds: number | null;
  cues: Cue[];
  wordCount: number;
  speakerCount: number;
};

export type ReadResult =
  | { ok: true; post: PostMeta }
  | { ok: false; error: string };

export type TranscribeResult =
  | { ok: true; transcript: Transcript }
  | { ok: false; error: string };

export type Lesson = {
  claim: string;
  concepts: { name: string; meaning: string }[];
  practice: { action: string; proves: string }[];
  check: string;
};

export type LearnResult = { ok: true; lesson: Lesson } | { ok: false; error: string };
