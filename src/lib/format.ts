const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  hi: "Hindi",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  tr: "Turkish",
  vi: "Vietnamese",
  id: "Indonesian",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  el: "Greek",
  he: "Hebrew",
  th: "Thai",
};

export function formatCount(value: number | null): string {
  if (value == null || value < 0 || !Number.isFinite(value)) return "—";
  if (value < 1000) return Math.round(value).toLocaleString("en-US");
  const units = [
    { v: 1e9, s: "B" },
    { v: 1e6, s: "M" },
    { v: 1e3, s: "k" },
  ];
  for (const unit of units) {
    if (value >= unit.v) {
      const scaled = value / unit.v;
      const digits = scaled >= 100 ? 0 : 1;
      return scaled.toFixed(digits).replace(/\.0$/, "") + unit.s;
    }
  }
  return Math.round(value).toLocaleString("en-US");
}

export function formatClock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatSrtTime(seconds: number): string {
  const msTotal = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(msTotal / 3_600_000);
  const m = Math.floor((msTotal % 3_600_000) / 60_000);
  const s = Math.floor((msTotal % 60_000) / 1000);
  const ms = msTotal % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function languageName(code: string | null): string {
  if (!code) return "Unknown";
  const base = code.toLowerCase().split("-")[0] ?? code;
  return LANGUAGE_NAMES[base] ?? code.toUpperCase();
}
