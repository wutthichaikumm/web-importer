import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExportText,
  chaptersToRetry,
  checkChapterNumbers,
  chapterContentProblem,
  chaptersToStart,
  convertChapterNumbers,
  decodeTextBuffer,
  describeChapterCheck,
  exportableChapters,
  findRepeatedChapter,
  formatExportText,
  hasChapterProblems,
  extractChapterRange,
  formatNovelText,
  formatExportFilename,
  formatPostProcessFilename,
  importerControls,
  isActiveRequest,
  removeEmptyChapters,
  retryUntilValid,
  runProgress,
  runWithConcurrency,
  selectChapterRange,
} from "../public/app-core.js";

test("decodeTextBuffer reads UTF-8 BOM text", () => {
  const buffer = new TextEncoder().encode("\uFEFF第205章 起点").buffer;

  assert.deepEqual(decodeTextBuffer(buffer), {
    encoding: "UTF-8",
    text: "第205章 起点",
  });
});

test("decodeTextBuffer honors an explicit legacy encoding", () => {
  const buffer = Uint8Array.from([0xa4, 0xa4, 0xa4, 0xe5]).buffer;

  assert.deepEqual(decodeTextBuffer(buffer, "Big5"), {
    encoding: "Big5",
    text: "中文",
  });
});

test("decodeTextBuffer does not guess ambiguous legacy bytes in auto mode", () => {
  const buffer = Uint8Array.from([0xa4, 0xa4, 0xa4, 0xe5]).buffer;

  assert.throws(
    () => decodeTextBuffer(buffer),
    /กรุณาเลือก encoding/,
  );
});

test("formatNovelText adds missing chapter markers and normalizes spacing", () => {
  assert.equal(
    formatNovelText("前言\r\n第899抱一下吧\r\n正文\r\n\r\n\r\n第900章 下一章"),
    "前言\n\n第899章抱一下吧\n\n正文\n\n第900章 下一章\n",
  );
});

test("formatNovelText does not promote inline chapter mentions", () => {
  assert.equal(
    formatNovelText("正文提到第123章但不是标题\n第205章 起点"),
    "正文提到第123章但不是标题\n\n第205章 起点\n",
  );
});

test("extractChapterRange includes the requested chapters only", () => {
  const text = formatNovelText(
    "第204章 ก่อนหน้า\nเนื้อหา\n第205章 起点\nเนื้อหา 205\n第400章 จบช่วง\nเนื้อหา 400\n第401章 ถัดไป\nเนื้อหา 401",
  );

  assert.equal(
    extractChapterRange(text, 205, 400),
    "第205章 起点\n\nเนื้อหา 205\n\n第400章 จบช่วง\n\nเนื้อหา 400\n",
  );
  assert.doesNotMatch(extractChapterRange(text, 205, 400), /第401章/);
});

test("extractChapterRange stops at the first later chapter", () => {
  const text = formatNovelText(
    "第205章 起点\nเนื้อหา 205\n第402章 ถัดไป\nเนื้อหา 402",
  );

  assert.equal(
    extractChapterRange(text, 205, 400),
    "第205章 起点\n\nเนื้อหา 205\n",
  );
});

test("extractChapterRange rejects invalid or missing ranges", () => {
  assert.throws(
    () => extractChapterRange("第205章 起点", 400, 205),
    /ตอนเริ่มต้นต้องไม่มากกว่าตอนสิ้นสุด/,
  );
  assert.throws(
    () => extractChapterRange("第205章 起点", 204, 205),
    /ไม่พบตอนเริ่มต้น 第204章/,
  );
  assert.throws(
    () => extractChapterRange("第205章 起点", 0, 205),
    /ช่วงตอนต้องเป็นจำนวนเต็มบวก/,
  );
});

test("formatPostProcessFilename includes the selected range", () => {
  assert.equal(
    formatPostProcessFilename(205, 400),
    "formatted-chapters-205-400.txt",
  );
});

test("buildExportText creates ordered chapter sections", () => {
  assert.equal(
    buildExportText([
      {
        chapterNumber: 1,
        title: "第一章",
        content: "เนื้อหาแรก",
      },
      {
        chapterNumber: 2,
        title: "第二章",
        content: "เนื้อหาที่สอง",
      },
    ]),
    "第一章\n\nเนื้อหาแรก\n\n\n第二章\n\nเนื้อหาที่สอง",
  );
});

test("buildExportText removes a duplicated leading chapter title", () => {
  const title = "第101章 哪怕他想不起我，但我記得他就好";

  assert.equal(
    buildExportText([
      {
        chapterNumber: 101,
        title,
        content: `${title}\n\n姜清漪離開之後，嚴如雪將馬車帶回了事發地點。`,
      },
    ]),
    `${title}\n\n姜清漪離開之後，嚴如雪將馬車帶回了事發地點。`,
  );
});

test("buildExportText merges a truncated TOC title with the full content title", () => {
  assert.equal(
    buildExportText([
      {
        title: "第221章 若你再跟著我，下一個斬的就是你（",
        content:
          "第221章 若你再跟著我，下一個斬的就是你（二章合一，4600字）\n\n“給我滾！”",
      },
    ]),
    "第221章 若你再跟著我，下一個斬的就是你（二章合一，4600字）\n\n“給我滾！”",
  );
});

test("buildExportText keeps the TOC chapter number when the content heading differs", () => {
  assert.equal(
    buildExportText([
      {
        title: "第215章 蕭大哥，你真的沒事嗎？",
        content: "第214章 蕭大哥，你真的沒事嗎？\n\n看著面前的女子，蕭墨神色微動。",
      },
      {
        title: "第217章 為了修行，真的什麼都不需要在乎嗎",
        content: "第216章 為了修行，真的什麼都不需要在乎嗎？\n\n當天晚上。",
      },
    ]),
    "第215章 蕭大哥，你真的沒事嗎？\n\n看著面前的女子，蕭墨神色微動。" +
      "\n\n\n" +
      "第217章 為了修行，真的什麼都不需要在乎嗎？\n\n當天晚上。",
  );
});

test("buildExportText matches a TOC title that dropped inner punctuation", () => {
  assert.equal(
    buildExportText([
      {
        title: "第229章 人家對成為宗主夫人倒是很有興趣",
        content: "第228章 人家對成為宗主夫人……倒是很有興趣\n\n本文",
      },
      {
        title: "第187章 我我想跟你一起走",
        content: "第187章 我.我想跟你一起走\n\n本文",
      },
    ]),
    "第229章 人家對成為宗主夫人……倒是很有興趣\n\n本文" +
      "\n\n\n" +
      "第187章 我.我想跟你一起走\n\n本文",
  );
});

test("buildExportText tolerates one variant character in the TOC title", () => {
  assert.equal(
    buildExportText([
      {
        title: "第355章 既然天下女子都沒我好看，那蕭墨隻",
        content: "第355章 既然天下女子都沒我好看，那蕭墨只能選我呀~\n\n本文",
      },
      {
        title: "第1章 天下",
        content: "第1章 大道\n\n本文",
      },
    ]),
    "第355章 既然天下女子都沒我好看，那蕭墨只能選我呀~\n\n本文" +
      "\n\n\n" +
      "第1章 天下\n\n第1章 大道\n\n本文",
  );
});

test("buildExportText keeps a first paragraph that only starts with the title", () => {
  assert.equal(
    buildExportText([{ title: "序", content: "序幕拉開，眾人入座。\n\n下一段" }]),
    "序\n\n序幕拉開，眾人入座。\n\n下一段",
  );
});

test("formatExportFilename uses local date and time", () => {
  assert.equal(
    formatExportFilename(new Date(2026, 8, 1, 14, 5)),
    "chapters-20260901-1405.txt",
  );
});

test("runWithConcurrency never exceeds active worker count", async () => {
  let active = 0;
  let maxActive = 0;
  const completed = [];

  await runWithConcurrency(
    [1, 2, 3, 4, 5],
    2,
    async (entry) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed.push(entry);
      active -= 1;
    },
    0,
  );

  assert.equal(maxActive, 2);
  assert.deepEqual(
    completed.sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );
});

test("runWithConcurrency spaces starts by the delay without growing it", async () => {
  const delay = 5;
  const startedAt = [];

  await runWithConcurrency(
    Array.from({ length: 40 }, (_, index) => index),
    4,
    async () => {
      startedAt.push(Date.now());
    },
    delay,
  );

  const gaps = startedAt.slice(1).map((time, index) => time - startedAt[index]);
  assert.ok(
    gaps.every((gap) => gap >= delay),
    `starts closer than ${delay}ms: ${gaps.join(",")}`,
  );

  const average = (values) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const early = average(gaps.slice(0, 10));
  const late = average(gaps.slice(-10));
  assert.ok(late < early * 2 + delay, `gaps grew from ~${early}ms to ~${late}ms`);
});

test("runWithConcurrency stops queued work after abort", async () => {
  const controller = new AbortController();
  const started = [];

  await runWithConcurrency(
    [1, 2, 3],
    1,
    async (entry) => {
      started.push(entry);
      controller.abort();
    },
    0,
    { signal: controller.signal },
  );

  assert.deepEqual(started, [1]);
});

test("isActiveRequest rejects stale or aborted requests", () => {
  const controller = new AbortController();

  assert.equal(isActiveRequest(controller, controller), true);

  controller.abort();
  assert.equal(isActiveRequest(controller, controller), false);
  assert.equal(isActiveRequest(null, controller), false);
  assert.equal(isActiveRequest(null, null), false);
});

const chapter = (idx, overrides = {}) => ({
  idx,
  title: `第${idx + 1}章`,
  url: `https://example.com/${idx + 1}`,
  chapterNumber: idx + 1,
  selected: true,
  status: "idle",
  content: "",
  error: "",
  ...overrides,
});
const ids = (chapters) => chapters.map(({ idx }) => idx);

test("selectChapterRange selects the inclusive range without mutating input", () => {
  const chapters = Array.from({ length: 5 }, (_, i) =>
    chapter(i, { selected: i === 0 }),
  );

  assert.deepEqual(
    selectChapterRange(chapters, "2", "4").map((item) => item.selected),
    [false, true, true, true, false],
  );
  assert.equal(chapters[0].selected, true);
});

test("selectChapterRange matches displayed chapter numbers", () => {
  const chapters = Array.from({ length: 5 }, (_, i) =>
    chapter(i, { chapterNumber: 101 + i }),
  );

  assert.deepEqual(
    selectChapterRange(chapters, 102, 103).map((item) => item.selected),
    [false, true, true, false, false],
  );
});

test("selectChapterRange rejects invalid ranges", () => {
  const chapters = Array.from({ length: 5 }, (_, i) => chapter(i));

  for (const [from, to] of [
    ["", "3"],
    ["0", "3"],
    ["1.5", "3"],
    ["2", "x"],
  ]) {
    assert.throws(
      () => selectChapterRange(chapters, from, to),
      /ช่วงตอนต้องเป็นจำนวนเต็มบวก/,
    );
  }
  assert.throws(
    () => selectChapterRange(chapters, "4", "2"),
    /ตอนเริ่มต้นต้องไม่มากกว่าตอนสิ้นสุด/,
  );
  assert.throws(
    () => selectChapterRange(chapters, "50", "60"),
    /ไม่พบตอนในช่วง 50–60/,
  );
});

test("chaptersToStart returns selected chapters never fetched", () => {
  const chapters = [
    chapter(0),
    chapter(1, { selected: false }),
    chapter(2, { status: "done" }),
    chapter(3, { status: "error" }),
    chapter(4, { status: "stopped" }),
  ];

  assert.deepEqual(ids(chaptersToStart(chapters)), [0]);
});

test("chaptersToRetry returns selected failed or stopped chapters", () => {
  const chapters = [
    chapter(0, { status: "done" }),
    chapter(1, { status: "error", selected: false }),
    chapter(2, { status: "error" }),
    chapter(3, { status: "stopped" }),
    chapter(4),
  ];

  assert.deepEqual(ids(chaptersToRetry(chapters)), [2, 3]);
});

test("exportableChapters keeps list order of selected done chapters", () => {
  const chapters = [
    chapter(2, { status: "done" }),
    chapter(0, { status: "done" }),
    chapter(1, { status: "done", selected: false }),
    chapter(3, { status: "error" }),
  ];

  assert.deepEqual(ids(exportableChapters(chapters)), [2, 0]);
});

test("runProgress counts the chapters of a run", () => {
  const statuses = ["done", "done", "error", "stopped", "fetching", "queued"];

  assert.deepEqual(
    runProgress(statuses.map((status, i) => chapter(i, { status }))),
    { total: 6, finished: 4, done: 2, error: 1, stopped: 1, remaining: 2 },
  );
});

test("importerControls enables start as soon as the TOC has loaded", () => {
  const controls = importerControls({
    chapters: [chapter(0), chapter(1), chapter(2)],
    tocLoading: false,
    running: false,
    stopping: false,
  });

  assert.deepEqual(controls.start, { visible: true, disabled: false, count: 3 });
  assert.equal(controls.stop.visible, false);
  assert.equal(controls.retry.visible, false);
  assert.deepEqual(controls.download, { disabled: true, count: 0 });
  assert.equal(controls.locked, false);
  assert.equal(controls.selected, 3);
  assert.equal(controls.total, 3);
});

test("importerControls disables start while the TOC is loading", () => {
  const controls = importerControls({
    chapters: [chapter(0)],
    tocLoading: true,
    running: false,
    stopping: false,
  });

  assert.equal(controls.start.disabled, true);
  assert.equal(controls.locked, true);
});

test("importerControls swaps start for stop while running and keeps download", () => {
  const controls = importerControls({
    chapters: [
      chapter(0, { status: "done" }),
      chapter(1, { status: "fetching" }),
      chapter(2, { status: "queued" }),
    ],
    tocLoading: false,
    running: true,
    stopping: false,
  });

  assert.equal(controls.start.visible, false);
  assert.deepEqual(controls.stop, { visible: true, disabled: false });
  assert.deepEqual(controls.download, { disabled: false, count: 1 });
  assert.equal(controls.retry.visible, false);
  assert.equal(controls.locked, true);
});

test("importerControls disables stop once stopping", () => {
  const controls = importerControls({
    chapters: [chapter(0, { status: "fetching" })],
    tocLoading: false,
    running: true,
    stopping: true,
  });

  assert.equal(controls.stop.disabled, true);
});

test("importerControls offers retry for failed chapters after a run", () => {
  const controls = importerControls({
    chapters: [
      chapter(0, { status: "done" }),
      chapter(1, { status: "error" }),
      chapter(2, { status: "stopped" }),
      chapter(3, { selected: false }),
    ],
    tocLoading: false,
    running: false,
    stopping: false,
  });

  assert.deepEqual(controls.retry, { visible: true, disabled: false, count: 2 });
  assert.deepEqual(controls.start, { visible: true, disabled: true, count: 0 });
});

test("importerControls lets the start number be set before a TOC loads", () => {
  const idle = importerControls({ chapters: [], tocLoading: false, running: false, stopping: false });
  const running = importerControls({
    chapters: [chapter(0, { status: "fetching" })],
    tocLoading: false,
    running: true,
    stopping: false,
  });

  assert.deepEqual(idle.numbering, { disabled: false });
  assert.deepEqual(running.numbering, { disabled: true });
});

test("importerControls warns before leaving when fetched work would be lost", () => {
  const controlsFor = (chapters, running = false) =>
    importerControls({ chapters, tocLoading: false, running, stopping: false });

  assert.equal(controlsFor([]).leaveWarning, false);
  assert.equal(controlsFor([chapter(0)]).leaveWarning, false);
  assert.equal(controlsFor([chapter(0, { status: "done", selected: false })]).leaveWarning, true);
  assert.equal(controlsFor([chapter(0, { status: "queued" })], true).leaveWarning, true);
});

// Expected values below were produced by running fn/convert_chapter_numbers.py
// and fn/remove_empty_chapters.py on the same inputs.
const CONVERT_INPUT = "前言\r\n第三百五十章 起點\r\n內容A\r\n  第12抱一下吧\r\n內容B\r\n第１２３章 全形\r\n第十章\r\n正文第二十章 黏在一起\r\n\r\n\r\n\r\n尾";

test('convertChapterNumbers turns Chinese chapter numbers into digits like the python script', () => {
  for (const [chinese, value] of Object.entries({"三百五十":350,"十":10,"二十":20,"一千零一":1001,"两百":200,"兩千零五十":2050,"壹佰贰拾叁":123,"一万二千":12000,"萬":10000,"一万零一":10001,"九":9,"零":0,"三十五":35,"一百一十":110,"二千零二十六":2026,"十一":11,"一亿二千万":120000000})) {
    assert.equal(convertChapterNumbers(`第${chinese}章 t`), `第${value}章 t\n`, chinese);
  }
});

test('convertChapterNumbers formats numeric headings like the python script', () => {
  assert.equal(convertChapterNumbers(CONVERT_INPUT), "前言\n\n第350章 起點\n\n內容A\n\n第12章 抱一下吧\n\n內容B\n\n第123章 全形\n\n第10章\n\n正文第二十章 黏在一起\n\n尾\n");
});

test('convertChapterNumbers can split headings glued to the previous text', () => {
  assert.equal(convertChapterNumbers(CONVERT_INPUT, { inline: true }), "前言\n\n第350章 起點\n\n內容A\n\n第12章 抱一下吧\n\n內容B\n\n第123章 全形\n\n第10章\n\n正文\n\n第20章 黏在一起\n\n尾\n");
});

test('removeEmptyChapters drops chapters without body text like the python script', () => {
  assert.deepEqual(removeEmptyChapters("前言\n第1章 有內容\n內容\n第2章 空\n\n\n第3章\n   \n第4章 有內容\r\n字\r\n第五章 中文\n"), {
    text: "前言\n第1章 有內容\n內容\n第4章 有內容\r\n字\r\n",
    removed: 3,
  });
});

test('removeEmptyChapters leaves text without chapter headings untouched', () => {
  assert.deepEqual(removeEmptyChapters("沒有任何標題的文字\n第一段"), { text: "沒有任何標題的文字\n第一段", removed: 0 });
});

const FILLER = (id) => `${"字".repeat(120)}${id}`; // distinct per chapter: identical bodies are flagged
const CHECK_TEXT = [
  "前言",
  "第1章 a", FILLER(1),
  "第2章 b", FILLER(2),
  "第3章 c", "",
  "第5章 e", FILLER(5),
  "第5章 e2", FILLER(52),
  "第7章 g", FILLER(7),
  "第6章 f", FILLER(6),
  "第8章 h", "短",
  "第十章 j", FILLER(10),
].join("\n");

test("checkChapterNumbers finds gaps, repeats, order problems and non-content chapters", () => {
  assert.deepEqual(checkChapterNumbers(CHECK_TEXT), {
    headings: 9,
    first: 1,
    last: 10,
    missing: [[4, 4], [9, 9]],
    duplicates: [{ number: 5, count: 2 }],
    outOfOrder: [{ number: 6, after: 7 }],
    empty: [3],
    short: [{ number: 8, length: 1 }],
    shortLimit: 100,
    repeated: [],
  });
});

const chapterBlock = (number, body) => `第${number}章 t\n${body}`;
const unique = (char) => char.repeat(150);

test("checkChapterNumbers finds chapters whose whole body is repeated in other chapters", () => {
  const junkX = "垃圾頁面".repeat(40);
  const junkY = "廣告頁面".repeat(40);
  const text = [
    chapterBlock(1, unique("甲")),
    chapterBlock(2, unique("乙")),
    chapterBlock(3, junkX),
    chapterBlock(4, `${junkX}\n`),
    chapterBlock(5, unique("丙")),
    chapterBlock(6, junkY),
    chapterBlock(7, `  ${junkY}`),
  ].join("\n");

  const check = checkChapterNumbers(text);
  assert.deepEqual(check.repeated, [[3, 4], [6, 7]]);
  assert.deepEqual([check.empty, check.short, check.missing], [[], [], []]);
  assert.match(
    describeChapterCheck(check),
    /เนื้อหาซ้ำกันทั้งตอน \(น่าจะดึงผิดหน้าเว็บ\) 4 ตอน ใน 2 กลุ่ม:\n {2}3 = 4\n {2}6 = 7/,
  );
});

test("checkChapterNumbers flags chapters far shorter than the typical chapter", () => {
  const text = [
    ...["甲", "乙", "丙", "丁", "戊"].map((char, index) => chapterBlock(index + 1, char.repeat(1000))),
    chapterBlock(6, "己".repeat(300)),
  ].join("\n");

  const check = checkChapterNumbers(text);
  assert.equal(check.shortLimit, 400);
  assert.deepEqual(check.short, [{ number: 6, length: 300 }]);
  assert.match(describeChapterCheck(check), /ตอนสั้นผิดปกติ \(น้อยกว่า 400 ตัวอักษร\) 1 ตอน: 6 \(300 ตัว\)/);
});

test("hasChapterProblems tells a clean file from a problem file", () => {
  assert.equal(hasChapterProblems(checkChapterNumbers(CHECK_TEXT)), true);
  assert.equal(hasChapterProblems(checkChapterNumbers([chapterBlock(1, unique("甲")), chapterBlock(2, unique("乙"))].join("\n"))), false);
  assert.equal(hasChapterProblems(checkChapterNumbers("ไม่มีหัวตอน")), true);
});

test("checkChapterNumbers merges long gaps into ranges", () => {
  const text = ["第1章", FILLER(1), "第50章", FILLER(50)].join("\n");
  assert.deepEqual(checkChapterNumbers(text).missing, [[2, 49]]);
});

test("describeChapterCheck summarizes problems in Thai", () => {
  assert.equal(
    describeChapterCheck(checkChapterNumbers(CHECK_TEXT)),
    [
      "ตรวจ 9 หัวตอน (第1–第10)",
      "ขาดเลข 2 ตอน: 4, 9",
      "เลขซ้ำ: 5 (2 ครั้ง)",
      "เรียงผิดลำดับ: 6 (ต่อจาก 7)",
      "ตอนว่าง (ไม่มีเนื้อหา) 1 ตอน: 3",
      "ตอนสั้นผิดปกติ (น้อยกว่า 100 ตัวอักษร) 1 ตอน: 8 (1 ตัว)",
    ].join("\n"),
  );
});

test("describeChapterCheck reports a clean file and a file without headings", () => {
  const clean = ["第1章", FILLER(1), "第2章", FILLER(2), "第3章", FILLER(3)].join("\n");
  assert.equal(
    describeChapterCheck(checkChapterNumbers(clean)),
    "ตรวจ 3 หัวตอน (第1–第3)\n✓ เลขเรียงครบ ไม่พบตอนว่าง ตอนสั้น หรือเนื้อหาซ้ำ",
  );
  assert.equal(describeChapterCheck(checkChapterNumbers("ไม่มีหัวตอน")), "ไม่พบหัวตอน (第N章) ในไฟล์");
});

const STORY = "他走進房間，看見桌上放著一封信。".repeat(20);
const STEAM_MENU = "Home Discovery Queue Wishlist Points Shop News Charts Install Steam 简体中文 繁體中文 日本語 한국어 ไทย ".repeat(5);
const THAI_AD = "รับฟังความคิดเห็นจากผู้ใช้ WPS Office สำรวจข้อมูลเชิงลึก ประสบการณ์".repeat(10);

test("chapterContentProblem accepts text in the same script as the title", () => {
  assert.equal(chapterContentProblem("第1章 開始", STORY), null);
  assert.equal(chapterContentProblem("第1章 開始", `${STORY}\nAlice 與 Bob`), null);
  assert.equal(chapterContentProblem("Chapter 1 The Start", "It was a dark night. ".repeat(30)), null);
  assert.equal(
    chapterContentProblem("第1章 はじまり", "彼は部屋に入った。窓の外には雨が降っていた。".repeat(20)),
    null,
  );
});

test("chapterContentProblem rejects pages written in another script than the title", () => {
  assert.match(chapterContentProblem("第1章 開始", STEAM_MENU), /ไม่ใช่เนื้อหา/);
  assert.match(chapterContentProblem("第1章 開始", THAI_AD), /ไม่ใช่เนื้อหา/);
  assert.match(chapterContentProblem("第1章 開始", "1234 5678 !!! ".repeat(30)), /ไม่ใช่เนื้อหา/);
});

test("chapterContentProblem cannot judge a title that has no letters", () => {
  assert.equal(chapterContentProblem("123", STEAM_MENU), null);
});

test("findRepeatedChapter finds another finished chapter with the same body", () => {
  const chapters = [
    chapter(0, { status: "done", content: "甲 乙\n丙" }),
    chapter(1, { status: "error", content: "丁" }),
    chapter(2, { status: "done", content: "戊" }),
  ];

  assert.equal(findRepeatedChapter(chapters, "甲乙丙", 5)?.idx, 0);
  assert.equal(findRepeatedChapter(chapters, "甲乙丙", 0), undefined);
  assert.equal(findRepeatedChapter(chapters, "丁", 5), undefined);
  assert.equal(findRepeatedChapter(chapters, "  ", 5), undefined);
});

test("retryUntilValid returns the first valid result", async () => {
  const seen = [];
  const outcomes = [{ ok: false, problem: "a" }, { ok: false, problem: "b" }, { ok: true, value: "ok" }];

  const result = await retryUntilValid(async (number) => outcomes[number - 1], {
    delayMs: 1,
    onAttempt: (number) => seen.push(number),
  });

  assert.deepEqual(result, { ok: true, value: "ok", attempts: 3 });
  assert.deepEqual(seen, [1, 2, 3]);
});

test("retryUntilValid gives up after the maximum attempts with the last problem", async () => {
  let calls = 0;

  const result = await retryUntilValid(async () => ({ ok: false, problem: `p${(calls += 1)}` }), {
    maxAttempts: 3,
    delayMs: 1,
  });

  assert.deepEqual(result, { ok: false, problem: "p3", attempts: 3 });
  assert.equal(calls, 3);
});

test("retryUntilValid does not retry a fatal problem", async () => {
  let calls = 0;

  const result = await retryUntilValid(
    async () => ({ ok: false, problem: "down", fatal: (calls += 1) > 0 }),
    { delayMs: 1 },
  );

  assert.deepEqual(result, { ok: false, problem: "down", attempts: 1 });
  assert.equal(calls, 1);
});

test("retryUntilValid stops waiting when aborted", async () => {
  const controller = new AbortController();

  const result = await retryUntilValid(
    async () => {
      controller.abort();
      return { ok: false, problem: "x" };
    },
    { delayMs: 10000, signal: controller.signal },
  );

  assert.deepEqual(result, { ok: false, aborted: true, problem: "x", attempts: 1 });
});

test("formatExportText runs convert, format and empty-chapter removal in order", () => {
  const text =
    "第三百五十章 起點\n\n內容A\n\n\n第351章 空\n\n\n第三百五十二章 尾\n\n內容C結尾第三百五十三章 丁\n\n內容D";

  assert.equal(
    formatExportText(text),
    "第350章 起點\n\n內容A\n\n第352章 尾\n\n內容C結尾\n\n第353章 丁\n\n內容D\n",
  );
});

test("formatExportText fixes a heading missing 章 and keeps an already clean export unchanged", () => {
  assert.equal(formatExportText("第12抱一下吧\n\n內容"), "第12章 抱一下吧\n\n內容\n");

  const clean = "第1章 甲\n\n內容1\n\n第2章 乙\n\n內容2\n";
  assert.equal(formatExportText(clean), clean);
});
