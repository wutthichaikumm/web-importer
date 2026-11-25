const TEXT_DECODERS = [
  { label: "UTF-8", decoder: "utf-8" },
  { label: "GB18030", decoder: "gb18030" },
  { label: "GBK", decoder: "gbk" },
  { label: "Big5", decoder: "big5" },
];

function decoderCandidates(preferredEncoding) {
  const requested = String(preferredEncoding ?? "auto").trim().toLowerCase();
  if (!requested || requested === "auto") return [TEXT_DECODERS[0]];

  const candidate = TEXT_DECODERS.find(
    ({ label, decoder }) =>
      label.toLowerCase() === requested || decoder.toLowerCase() === requested,
  );
  return candidate ? [candidate] : [];
}

export function decodeTextBuffer(buffer, preferredEncoding = "auto") {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const candidates = decoderCandidates(preferredEncoding);

  for (const candidate of candidates) {
    try {
      const decoder = new TextDecoder(candidate.decoder, { fatal: true });
      return {
        encoding: candidate.label,
        text: decoder.decode(bytes),
      };
    } catch {
      // Try the next supported encoding.
    }
  }

  if (String(preferredEncoding ?? "auto").trim().toLowerCase() === "auto") {
    throw new Error(
      "อ่านไฟล์แบบอัตโนมัติไม่สำเร็จ กรุณาเลือก encoding ของไฟล์",
    );
  }
  throw new Error("ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบ encoding ของไฟล์");
}

const CHAPTER_HEADING_LINE_PATTERN = /(^|\n)[ \t]*(第\d+章[^\n]*?)[ \t]*(?=\n|$)/g;
const CHAPTER_HEADING_PATTERN = /^[ \t]*第(\d+)章[^\n]*$/gm;

export function formatNovelText(value) {
  let text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/第(\d+)(?!章)([^\d\n])/g, "第$1章$2")
    .replace(CHAPTER_HEADING_LINE_PATTERN, "\n\n$2\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text ? `${text}\n` : "\n";
}

function positiveInteger(value) {
  const stringValue = String(value ?? "").trim();
  if (!/^\d+$/.test(stringValue)) return null;

  const parsed = Number(stringValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function chapterHeadings(text) {
  return [...text.matchAll(CHAPTER_HEADING_PATTERN)].map((match) => ({
    index: match.index,
    number: Number(match[1]),
  }));
}

export function extractChapterRange(value, start, end) {
  const startNumber = positiveInteger(start);
  const endNumber = positiveInteger(end);
  if (startNumber === null || endNumber === null) {
    throw new Error("ช่วงตอนต้องเป็นจำนวนเต็มบวก");
  }
  if (startNumber > endNumber) {
    throw new Error("ตอนเริ่มต้นต้องไม่มากกว่าตอนสิ้นสุด");
  }

  const text = String(value ?? "");
  const headings = chapterHeadings(text);
  const startHeading = headings.find(({ number }) => number === startNumber);
  if (!startHeading) {
    throw new Error(`ไม่พบตอนเริ่มต้น 第${startNumber}章`);
  }

  const nextHeading = headings.find(
    ({ index, number }) => index > startHeading.index && number > endNumber,
  );
  const result = text
    .slice(startHeading.index, nextHeading?.index ?? text.length)
    .trim();
  return result ? `${result}\n` : "\n";
}

// Ports of fn/convert_chapter_numbers.py and fn/remove_empty_chapters.py.
const DIGIT_VALUES = new Map([..."零一二三四五六七八九"].map((char, value) => [char, value]));
[["〇", 0], ["两", 2], ["兩", 2]].forEach(([char, value]) => DIGIT_VALUES.set(char, value));
["", "壹", "贰貳弍", "叁參叄", "肆", "伍", "陆陸", "柒", "捌", "玖"].forEach((chars, value) =>
  [...chars].forEach((char) => DIGIT_VALUES.set(char, value)),
);
const SMALL_UNITS = new Map([["十", 10n], ["拾", 10n], ["百", 100n], ["佰", 100n], ["千", 1000n], ["仟", 1000n]]);
const LARGE_UNITS = [..."万亿兆京垓秭穰沟涧正载极"].map((char, index) => [char, 10n ** BigInt(4 * (index + 1))]);
const TRADITIONAL_UNITS = { 萬: "万", 億: "亿", 溝: "沟", 澗: "涧", 載: "载", 極: "极" };
const NUMBER_CHARS = [
  ...DIGIT_VALUES.keys(), ...SMALL_UNITS.keys(), ...LARGE_UNITS.map(([char]) => char), ...Object.keys(TRADITIONAL_UNITS),
].join("");
// ponytail: only ASCII and full-width digits (python's \d accepts every Unicode digit).
const ARABIC_DIGITS = "0-9０-９";
const NUMERIC_HEADING = `^[^\\S\\r\\n]*第([${ARABIC_DIGITS}]+)章?([^\\n]*)`;

function chineseNumber(text) {
  const number = text.replace(/[萬億溝澗載極]/g, (char) => TRADITIONAL_UNITS[char]);
  for (const [unit, value] of [...LARGE_UNITS].reverse()) {
    const at = number.lastIndexOf(unit);
    if (at !== -1) {
      const prefix = number.slice(0, at);
      return (prefix ? chineseNumber(prefix) : 1n) * value + chineseNumber(number.slice(at + 1));
    }
  }

  let section = 0n;
  let digits = 0n;
  for (const char of number) {
    if (DIGIT_VALUES.has(char)) {
      digits = digits * 10n + BigInt(DIGIT_VALUES.get(char));
    } else {
      section += (digits || 1n) * SMALL_UNITS.get(char);
      digits = 0n;
    }
  }
  return section + digits;
}

function headingBlock(number, title) {
  const cleanTitle = title.trim();
  return `\n\n第${number}章${cleanTitle ? ` ${cleanTitle}` : ""}\n\n`;
}

export function convertChapterNumbers(value, { inline = false } = {}) {
  let text = String(value ?? "").replace(/\r\n?/g, "\n");
  const numeric = (number, title) => headingBlock(number.normalize("NFKC"), title);

  if (inline) {
    const pattern = new RegExp(`^([^\\n]*?)第([${NUMBER_CHARS}]+)章([^\\n]*)|${NUMERIC_HEADING}`, "gm");
    text = text.replace(pattern, (_match, prefix, chinese, title, number, numericTitle) =>
      chinese === undefined
        ? numeric(number, numericTitle)
        : prefix.trimEnd() + headingBlock(chineseNumber(chinese), title),
    );
  } else {
    text = text
      .replace(new RegExp(`^([^\\S\\r\\n]*第)([${NUMBER_CHARS}]+)章`, "gm"), (_match, lead, chinese) =>
        `${lead}${chineseNumber(chinese)}章`,
      )
      .replace(new RegExp(NUMERIC_HEADING, "gm"), (_match, number, title) => numeric(number, title));
  }

  return `${text.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

const EMPTY_CHECK_HEADING = new RegExp(`^[^\\S\\r\\n]*第[${ARABIC_DIGITS}${NUMBER_CHARS}]+章`);

export function removeEmptyChapters(value) {
  const text = String(value ?? "");
  // ponytail: splits on \n only (python also splits on a lone \r and a few rarer separators).
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const starts = lines.flatMap((line, index) => (EMPTY_CHECK_HEADING.test(line) ? [index] : []));
  if (starts.length === 0) return { text, removed: 0 };

  let result = lines.slice(0, starts[0]).join("");
  let removed = 0;
  starts.forEach((start, position) => {
    const end = starts[position + 1] ?? lines.length;
    if (lines.slice(start + 1, end).some((line) => line.trim())) {
      result += lines.slice(start, end).join("");
    } else {
      removed += 1;
    }
  });
  return { text: result, removed };
}

// The same three steps as the .txt tab (convert numbers with inline headings, add 章, drop empty chapters).
export function formatExportText(text) {
  return removeEmptyChapters(formatNovelText(convertChapterNumbers(text, { inline: true }))).text;
}

const SHORT_CHAPTER_CHARS = 100;
const NUMBERED_HEADING = new RegExp(`^[^\\S\\r\\n]*第([${ARABIC_DIGITS}${NUMBER_CHARS}]+)章`);

function headingNumber(text) {
  return /^[0-9０-９]+$/.test(text) ? Number(text.normalize("NFKC")) : Number(chineseNumber(text));
}

// Checks chapter numbering: gaps, repeats, out-of-order headings, and chapters
// with no body or a suspiciously short one (not real content).
export function checkChapterNumbers(value) {
  const chapters = [];
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const match = NUMBERED_HEADING.exec(line);
    if (match) chapters.push({ number: headingNumber(match[1]), body: "" });
    else if (chapters.length) chapters.at(-1).body += line;
  }

  const counts = new Map();
  chapters.forEach(({ number }) => counts.set(number, (counts.get(number) ?? 0) + 1));
  const unique = [...counts.keys()].sort((a, b) => a - b);

  const missing = [];
  unique.forEach((number, index) => {
    if (index > 0 && number - unique[index - 1] > 1) missing.push([unique[index - 1] + 1, number - 1]);
  });

  const sizes = chapters.map(({ number, body }) => ({ number, length: body.replace(/\s/g, "").length }));

  // Short = under 100 chars, or (with enough chapters) under 40% of the median chapter.
  const sortedLengths = sizes.map(({ length }) => length).sort((a, b) => a - b);
  const median = sortedLengths[Math.floor(sortedLengths.length / 2)] ?? 0;
  const shortLimit = Math.max(SHORT_CHAPTER_CHARS, sizes.length >= 5 ? Math.round(median * 0.4) : 0);

  // Real chapters never match another chapter word for word; identical bodies mean a
  // wrong page (ad, menu, error) was saved instead of the chapter.
  const sameBody = new Map();
  chapters.forEach(({ number, body }) => {
    const key = body.replace(/\s/g, "");
    if (key) sameBody.set(key, [...(sameBody.get(key) ?? []), number]);
  });

  return {
    headings: chapters.length,
    first: unique[0] ?? null,
    last: unique.at(-1) ?? null,
    missing,
    duplicates: [...counts].filter(([, count]) => count > 1).map(([number, count]) => ({ number, count })),
    outOfOrder: chapters.flatMap(({ number }, index) =>
      index > 0 && number < chapters[index - 1].number ? [{ number, after: chapters[index - 1].number }] : [],
    ),
    empty: sizes.filter(({ length }) => length === 0).map(({ number }) => number),
    short: sizes.filter(({ length }) => length > 0 && length < shortLimit),
    shortLimit,
    repeated: [...sameBody.values()].filter((numbers) => numbers.length > 1),
  };
}

const SCRIPTS = [
  ["cjk", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ["hangul", /\p{Script=Hangul}/gu],
  ["thai", /\p{Script=Thai}/gu],
  ["latin", /\p{Script=Latin}/gu],
  ["cyrillic", /\p{Script=Cyrillic}/gu],
];
const countLetters = (text, pattern) => (text.match(pattern) ?? []).length;

// A fetched page is only a chapter if it is written in the script of its title
// (a Chinese title with a Latin or Thai page means an ad/menu page was saved).
// Returns the reason when it is not, or null when it looks like the chapter.
export function chapterContentProblem(title, content) {
  const [script, titleLetters] = SCRIPTS.map(([name, pattern]) => [name, countLetters(title, pattern)]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  if (titleLetters < 2) return null;

  const pattern = SCRIPTS.find(([name]) => name === script)[1];
  const letters = SCRIPTS.reduce((sum, [, scriptPattern]) => sum + countLetters(content, scriptPattern), 0);
  return countLetters(content, pattern) < letters * 0.4 || letters === 0
    ? "ไม่ใช่เนื้อหา (ตัวอักษรไม่ตรงกับชื่อตอน)"
    : null;
}

// Real chapters never repeat word for word, so a finished chapter with the same body is a wrong page.
export function findRepeatedChapter(chapters, content, exceptIdx) {
  const key = content.replace(/\s/g, "");
  if (!key) return undefined;
  return chapters.find(
    (chapter) =>
      chapter.idx !== exceptIdx && chapter.status === "done" && chapter.content.replace(/\s/g, "") === key,
  );
}

// Runs `attempt(number)` until it returns { ok: true, value }. A { ok: false, problem } result is
// retried after a growing pause, up to maxAttempts; `fatal: true` stops at once.
export async function retryUntilValid(attempt, { maxAttempts = 5, delayMs = 1000, signal, onAttempt } = {}) {
  let problem = "";
  for (let number = 1; number <= Math.max(1, maxAttempts); number += 1) {
    onAttempt?.(number);
    const outcome = await attempt(number);
    if (outcome.ok) return { ok: true, value: outcome.value, attempts: number };

    problem = outcome.problem;
    if (outcome.fatal || number >= maxAttempts) return { ok: false, problem, attempts: number };
    if (!(await sleep(delayMs * number, signal))) return { ok: false, aborted: true, problem, attempts: number };
  }
}

export function hasChapterProblems(check) {
  return (
    check.headings === 0 ||
    [check.missing, check.duplicates, check.outOfOrder, check.empty, check.short, check.repeated].some(
      (list) => list.length > 0,
    )
  );
}

function formatRanges(ranges) {
  return ranges.map(([from, to]) => (from === to ? String(from) : `${from}–${to}`)).join(", ");
}

export function describeChapterCheck(check) {
  if (check.headings === 0) return "ไม่พบหัวตอน (第N章) ในไฟล์";

  const lines = [`ตรวจ ${check.headings} หัวตอน (第${check.first}–第${check.last})`];
  const missingCount = check.missing.reduce((sum, [from, to]) => sum + to - from + 1, 0);
  if (missingCount) lines.push(`ขาดเลข ${missingCount} ตอน: ${formatRanges(check.missing)}`);
  if (check.duplicates.length) {
    lines.push(`เลขซ้ำ: ${check.duplicates.map(({ number, count }) => `${number} (${count} ครั้ง)`).join(", ")}`);
  }
  if (check.outOfOrder.length) {
    lines.push(`เรียงผิดลำดับ: ${check.outOfOrder.map(({ number, after }) => `${number} (ต่อจาก ${after})`).join(", ")}`);
  }
  if (check.empty.length) {
    lines.push(`ตอนว่าง (ไม่มีเนื้อหา) ${check.empty.length} ตอน: ${check.empty.join(", ")}`);
  }
  if (check.short.length) {
    const items = check.short.map(({ number, length }) => `${number} (${length} ตัว)`).join(", ");
    lines.push(`ตอนสั้นผิดปกติ (น้อยกว่า ${check.shortLimit} ตัวอักษร) ${check.short.length} ตอน: ${items}`);
  }
  if (check.repeated.length) {
    const total = check.repeated.reduce((sum, group) => sum + group.length, 0);
    lines.push(
      `เนื้อหาซ้ำกันทั้งตอน (น่าจะดึงผิดหน้าเว็บ) ${total} ตอน ใน ${check.repeated.length} กลุ่ม:`,
      ...check.repeated.map((group) => `  ${group.join(" = ")}`),
    );
  }
  if (!hasChapterProblems(check)) lines.push("✓ เลขเรียงครบ ไม่พบตอนว่าง ตอนสั้น หรือเนื้อหาซ้ำ");
  return lines.join("\n");
}

export function formatPostProcessFilename(start, end) {
  return `formatted-chapters-${String(start).trim()}-${String(end).trim()}.txt`;
}

function sleep(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    let timeoutId;
    const finish = (completed) => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);

    timeoutId = setTimeout(() => finish(true), milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isActiveRequest(activeController, controller) {
  return Boolean(
    controller && activeController === controller && !controller.signal.aborted,
  );
}

export async function runWithConcurrency(
  entries,
  concurrency,
  worker,
  delayMs = 0,
  options = {},
) {
  const limit = Math.min(12, Math.max(1, Number(concurrency) || 1));
  const delay = Math.max(0, Number(delayMs) || 0);
  const signal = options?.signal;
  let nextIndex = 0;
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  await Promise.all(
    Array.from({ length: Math.min(limit, entries.length || 1) }, async () => {
      while (nextIndex < entries.length && !signal?.aborted) {
        const index = nextIndex;
        nextIndex += 1;

        // Keep starts at least `delay` apart across all workers. Re-check after
        // waking because coarse timers can wake several workers on one tick.
        let wait = lastStartedAt + delay - Date.now();
        while (wait > 0) {
          if (!(await sleep(wait, signal))) return;
          wait = lastStartedAt + delay - Date.now();
        }

        if (signal?.aborted) {
          return;
        }

        lastStartedAt = Date.now();
        await worker(entries[index], index);
      }
    }),
  );
}

function normalizeExportText(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .trim();
}

const CHAPTER_MARKER_PATTERN =
  /^第\s*[0-9０-９零〇一二兩两三四五六七八九十百千萬万]+\s*[章节節回]/;

function splitChapterTitle(line) {
  const marker = line.match(CHAPTER_MARKER_PATTERN)?.[0] ?? "";
  const name = normalizeExportText(line.slice(marker.length));
  return { marker, name, key: name.replace(/[\p{P}\p{S}]/gu, "") };
}

function isSameTitleKey(left, right) {
  const length = Math.min(left.length, right.length);
  let differences = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) differences += 1;
  }
  // Allow one variant character (e.g. 隻/只) once the title is long enough.
  return length > 0 && differences <= (length >= 4 ? 1 : 0);
}

// Chapter pages often repeat the title as their first line, but the TOC
// version may be truncated, lose punctuation, or carry a different chapter
// number. Treat those as the same title so the export keeps a single
// heading: the TOC chapter number with the most complete name.
function mergeLeadingTitle(title, content) {
  const [firstLine, ...remainingLines] = content.split(/\r?\n/);
  const heading = firstLine.trim();
  const remainingContent = remainingLines.join("\n").trim();
  if (normalizeExportText(heading) === normalizeExportText(title)) {
    return { title, content: remainingContent };
  }

  const fromTitle = splitChapterTitle(title);
  const fromContent = splitChapterTitle(heading);
  if (!fromContent.marker || !isSameTitleKey(fromTitle.key, fromContent.key)) {
    return { title, content };
  }

  const mergedTitle =
    fromContent.name.length > fromTitle.name.length
      ? `${fromTitle.marker || fromContent.marker}${heading.slice(fromContent.marker.length)}`
      : title;
  return { title: mergedTitle, content: remainingContent };
}

export function buildExportText(entries) {
  return entries
    .map(({ title, content }) => {
      const cleanTitle = String(title ?? "").trim();
      const cleanContent = String(content ?? "").trim();
      const merged =
        cleanTitle && cleanContent
          ? mergeLeadingTitle(cleanTitle, cleanContent)
          : { title: cleanTitle, content: cleanContent };
      return `${merged.title}\n\n${merged.content}`;
    })
    .join("\n\n\n");
}

export function selectChapterRange(chapters, from, to) {
  const fromNumber = positiveInteger(from);
  const toNumber = positiveInteger(to);
  if (fromNumber === null || toNumber === null) {
    throw new Error("ช่วงตอนต้องเป็นจำนวนเต็มบวก");
  }
  if (fromNumber > toNumber) {
    throw new Error("ตอนเริ่มต้นต้องไม่มากกว่าตอนสิ้นสุด");
  }

  const inRange = ({ chapterNumber }) =>
    chapterNumber >= fromNumber && chapterNumber <= toNumber;
  if (!chapters.some(inRange)) {
    throw new Error(`ไม่พบตอนในช่วง ${fromNumber}–${toNumber}`);
  }

  return chapters.map((chapter) => ({ ...chapter, selected: inRange(chapter) }));
}

export function chaptersToStart(chapters) {
  return chapters.filter(
    ({ selected, status }) => selected && status === "idle",
  );
}

export function chaptersToRetry(chapters) {
  return chapters.filter(
    ({ selected, status }) =>
      selected && (status === "error" || status === "stopped"),
  );
}

export function exportableChapters(chapters) {
  return chapters.filter(
    ({ selected, status }) => selected && status === "done",
  );
}

export function runProgress(chapters) {
  const count = (status) =>
    chapters.filter((chapter) => chapter.status === status).length;
  const done = count("done");
  const error = count("error");
  const stopped = count("stopped");

  return {
    total: chapters.length,
    finished: done + error + stopped,
    done,
    error,
    stopped,
    remaining: count("queued") + count("fetching"),
  };
}

export function importerControls({ chapters, tocLoading, running, stopping }) {
  const startCount = chaptersToStart(chapters).length;
  const retryCount = chaptersToRetry(chapters).length;
  const downloadCount = exportableChapters(chapters).length;

  return {
    total: chapters.length,
    selected: chapters.filter((chapter) => chapter.selected).length,
    locked: tocLoading || running,
    numbering: { disabled: tocLoading || running },
    leaveWarning: running || chapters.some((chapter) => chapter.status === "done"),
    start: {
      visible: !running,
      disabled: tocLoading || startCount === 0,
      count: startCount,
    },
    stop: { visible: running, disabled: stopping },
    retry: {
      visible: !running && retryCount > 0,
      disabled: tocLoading,
      count: retryCount,
    },
    download: { disabled: downloadCount === 0, count: downloadCount },
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatExportFilename(date) {
  return [
    "chapters-",
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    ".txt",
  ].join("");
}
