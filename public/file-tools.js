import {
  checkChapterNumbers,
  convertChapterNumbers,
  decodeTextBuffer,
  describeChapterCheck,
  hasChapterProblems,
  extractChapterRange,
  formatNovelText,
  formatPostProcessFilename,
  removeEmptyChapters,
} from "./app-core.js";
import { copyText } from "./clipboard.js";

const COPY_LABEL = "คัดลอกผลลัพธ์";
const COPIED_LABEL_MS = 2000;

const dom = {};
let copiedLabelTimer;

const state = {
  file: null,
  text: "",
  encoding: "",
  processedText: "",
  outputFilename: "",
};

function announce(message) {
  dom.liveRegion.textContent = "";
  window.setTimeout(() => {
    dom.liveRegion.textContent = message;
  }, 0);
}

function setStatus(message, error = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle("is-error", error);
}

function clearResult() {
  state.processedText = "";
  state.outputFilename = "";
  dom.downloadButton.disabled = true;
  dom.copyButton.disabled = true;
  dom.preview.textContent = "ยังไม่มีผลลัพธ์";
}

function clearFile() {
  state.file = null;
  state.text = "";
  state.encoding = "";
  dom.formatButton.disabled = true;
  dom.checkButton.disabled = true;
  dom.report.hidden = true;
  clearResult();
}

function readSourceFile(file) {
  clearFile();

  const preferredEncoding = dom.encoding.value;
  const encodingLabel = preferredEncoding === "auto" ? "อัตโนมัติ" : preferredEncoding;
  setStatus(`กำลังอ่าน ${file.name} (${encodingLabel})...`);

  const isCurrentRead = () =>
    dom.fileInput.files?.[0] === file && dom.encoding.value === preferredEncoding;

  file
    .arrayBuffer()
    .then((buffer) => {
      if (!isCurrentRead()) return;
      const decoded = decodeTextBuffer(buffer, preferredEncoding);
      state.file = file;
      state.text = decoded.text;
      state.encoding = decoded.encoding;
      dom.formatButton.disabled = false;
      dom.checkButton.disabled = false;
      setStatus(`${file.name} · ${file.size.toLocaleString()} bytes · ${decoded.encoding}`);
      announce(`อ่านไฟล์ ${file.name} แล้ว`);
    })
    .catch((error) => {
      if (!isCurrentRead()) return;
      const message = error instanceof Error ? error.message : "อ่านไฟล์ไม่สำเร็จ";
      setStatus(message, true);
      announce(message);
    });
}

function selectedTextFile() {
  const file = dom.fileInput.files?.[0] || null;
  if (!file) {
    clearFile();
    setStatus("เลือกไฟล์ .txt เพื่อเริ่มต้น");
    return null;
  }
  if (!/\.txt$/i.test(file.name)) {
    clearFile();
    setStatus("กรุณาเลือกไฟล์นามสกุล .txt", true);
    return null;
  }
  return file;
}

function handleFileOrEncodingChange() {
  const file = selectedTextFile();
  if (file) readSourceFile(file);
}

function processFile() {
  if (!state.file) {
    setStatus("กรุณาเลือกไฟล์ .txt ก่อน", true);
    return;
  }

  const convert = dom.stepConvert.checked;
  const format = dom.stepFormat.checked;
  const clean = dom.stepClean.checked;
  const range = dom.stepRange.checked;
  if (!(convert || format || clean || range)) {
    setStatus("เลือกอย่างน้อย 1 ขั้นตอน", true);
    return;
  }

  try {
    // Same order as running the fn/*.py scripts one after another.
    let text = state.text;
    const notes = [];
    if (convert) text = convertChapterNumbers(text, { inline: dom.stepInline.checked });
    if (format) text = formatNovelText(text);
    if (clean) {
      const cleaned = removeEmptyChapters(text);
      text = cleaned.text;
      notes.push(`ลบตอนว่าง ${cleaned.removed} ตอน`);
    }

    let filename = "formatted-chapters.txt";
    if (range) {
      const startValue = dom.start.value.trim();
      const endValue = dom.end.value.trim();
      text = extractChapterRange(text, startValue, endValue);
      filename = formatPostProcessFilename(Number(startValue), Number(endValue));
      notes.push(`ตอน ${Number(startValue)}-${Number(endValue)}`);
    }

    state.processedText = text;
    state.outputFilename = filename;
    dom.preview.textContent = text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text;
    dom.downloadButton.disabled = false;
    dom.copyButton.disabled = false;
    const summary = ["ประมวลผลแล้ว", ...notes, state.encoding].join(" · ");
    setStatus(summary);
    announce(summary);
  } catch (error) {
    clearResult();
    const message = error instanceof Error ? error.message : "ประมวลผลไฟล์ไม่สำเร็จ";
    setStatus(message, true);
    announce(message);
  }
}

function checkFile() {
  if (!state.file) return;

  // Same text the steps would see, before empty chapters are removed or the range is cut.
  let text = state.text;
  if (dom.stepConvert.checked) text = convertChapterNumbers(text, { inline: dom.stepInline.checked });
  if (dom.stepFormat.checked) text = formatNovelText(text);

  const check = checkChapterNumbers(text);
  const report = describeChapterCheck(check);
  const problems = hasChapterProblems(check);
  dom.report.textContent = report;
  dom.report.hidden = false;
  dom.report.classList.toggle("is-warning", problems);
  dom.report.classList.toggle("is-ok", !problems);
  announce(problems ? `พบปัญหา: ${report.split("\n")[1] ?? report}` : "เลขเรียงครบ ไม่พบปัญหา");
}

function syncOptions() {
  dom.stepInline.disabled = !dom.stepConvert.checked;
  dom.start.disabled = !dom.stepRange.checked;
  dom.end.disabled = !dom.stepRange.checked;
}

function handleOptionChange() {
  syncOptions();
  if (!state.processedText) return;

  clearResult();
  setStatus("เปลี่ยนตัวเลือกแล้ว · กดประมวลผลอีกครั้ง");
}

async function copyResult() {
  if (!state.processedText) {
    announce("ยังไม่มีผลลัพธ์ให้คัดลอก");
    return;
  }

  try {
    await copyText(state.processedText);
  } catch {
    setStatus("คัดลอกไม่สำเร็จ ลองกดดาวน์โหลดผลลัพธ์แทน", true);
    announce("คัดลอกไม่สำเร็จ");
    return;
  }

  dom.copyButton.textContent = "คัดลอกแล้ว ✓";
  window.clearTimeout(copiedLabelTimer);
  copiedLabelTimer = window.setTimeout(() => {
    dom.copyButton.textContent = COPY_LABEL;
  }, COPIED_LABEL_MS);
  announce("คัดลอกผลลัพธ์แล้ว");
}

function downloadResult() {
  if (!state.processedText || !state.outputFilename) {
    announce("ยังไม่มีผลลัพธ์ให้ดาวน์โหลด");
    return;
  }

  const blob = new Blob([state.processedText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.outputFilename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  announce(`ดาวน์โหลด ${state.outputFilename} แล้ว`);
}

export function initFileTools() {
  Object.assign(dom, {
    fileInput: document.querySelector("#source-text-file"),
    encoding: document.querySelector("#file-tools-encoding"),
    start: document.querySelector("#file-tools-start"),
    end: document.querySelector("#file-tools-end"),
    stepConvert: document.querySelector("#file-step-convert"),
    stepInline: document.querySelector("#file-step-inline"),
    stepFormat: document.querySelector("#file-step-format"),
    stepClean: document.querySelector("#file-step-clean"),
    stepRange: document.querySelector("#file-step-range"),
    formatButton: document.querySelector("#format-file-button"),
    checkButton: document.querySelector("#check-file-button"),
    report: document.querySelector("#file-tools-report"),
    downloadButton: document.querySelector("#download-formatted-button"),
    copyButton: document.querySelector("#copy-formatted-button"),
    status: document.querySelector("#file-tools-status"),
    preview: document.querySelector("#file-tools-preview"),
    liveRegion: document.querySelector("#live-region"),
  });

  dom.fileInput.addEventListener("change", handleFileOrEncodingChange);
  dom.encoding.addEventListener("change", handleFileOrEncodingChange);
  dom.start.addEventListener("input", handleOptionChange);
  dom.end.addEventListener("input", handleOptionChange);
  [dom.stepConvert, dom.stepInline, dom.stepFormat, dom.stepClean, dom.stepRange].forEach((step) =>
    step.addEventListener("change", handleOptionChange),
  );
  syncOptions();
  dom.formatButton.addEventListener("click", processFile);
  dom.checkButton.addEventListener("click", checkFile);
  dom.downloadButton.addEventListener("click", downloadResult);
  dom.copyButton.addEventListener("click", copyResult);
}
