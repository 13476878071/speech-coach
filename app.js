import { analyzeSentence } from "./analysis-service.js";
import { audioPreviewSupported, playAudioPreview, stopAudioPreview } from "./audio.js";

const form = document.querySelector("#sentence-form");
const input = document.querySelector("#sentence-input");
const submitButton = form.querySelector('button[type="submit"]');
const error = document.querySelector("#input-error");
const results = document.querySelector("#results");
const markedSentence = document.querySelector("#marked-sentence");
const stressList = document.querySelector("#stress-list");
const linkingList = document.querySelector("#linking-list");
const reductionList = document.querySelector("#reduction-list");
const summaryText = document.querySelector("#summary-text");
const rhythmText = document.querySelector("#rhythm-text");
const sourceBadge = document.querySelector("#analysis-source");
const audioStatus = document.querySelector("#audio-status");
const naturalButton = document.querySelector("#natural-audio");
const slowButton = document.querySelector("#slow-audio");
const exampleButton = document.querySelector("#example-button");
const submitButtonContent = [...submitButton.childNodes];

let currentSentence = "";
let latestRequest = 0;
let isAnalyzing = false;

function renderMarkedSentence(sentence, tokens) {
  markedSentence.replaceChildren();
  let position = 0;

  tokens.forEach((token) => {
    markedSentence.append(document.createTextNode(sentence.slice(position, token.start)));
    const span = document.createElement("span");
    span.textContent = token.text;
    if (token.stress !== "unstressed") span.className = `stress-${token.stress}`;
    span.title = token.reason;
    markedSentence.append(span);
    position = token.end;
  });

  markedSentence.append(document.createTextNode(sentence.slice(position)));
}

function renderItems(container, items, emptyMessage) {
  container.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }

  items.forEach((item) => {
    const box = document.createElement("div");
    box.className = "detail-item";
    const heading = document.createElement("div");
    heading.className = "detail-item-heading";
    const title = document.createElement("strong");
    title.textContent = item.title;
    heading.append(title);
    if (item.kind) {
      const kind = document.createElement("span");
      kind.className = "detail-kind";
      kind.textContent = item.kind;
      heading.append(kind);
    }
    const note = document.createElement("p");
    note.textContent = item.note;
    box.append(heading, note);
    container.append(box);
  });
}

function renderAnalysis(analysis) {
  const { sentence, tokens } = analysis;
  renderMarkedSentence(sentence, tokens);
  sourceBadge.textContent = analysis.source === "ai" ? "AI 分析" : "本地规则分析";

  renderItems(
    stressList,
    tokens.filter((token) => token.stress !== "unstressed").map((token) => ({
      title: token.text,
      kind: token.stress === "primary" ? "主要重读" : "次要重读",
      note: token.reason
    })),
    "没有明显的默认重读词；强调哪个词取决于你想表达的意思。"
  );

  renderItems(
    linkingList,
    analysis.connections.map((connection) => ({
      title: `${tokens[connection.fromToken].text}‿${tokens[connection.toToken].text}`,
      note: connection.reason
    })),
    "没有发现明显的连读线索。"
  );

  const forms = [
    ...analysis.weakForms.map((form) => ({
      position: form.tokenIndex,
      title: `${tokens[form.tokenIndex].text} → ${form.spoken}`,
      kind: "弱读",
      note: form.reason
    })),
    ...analysis.reductions.map((reduction) => ({
      position: reduction.startToken,
      title: `${tokens.slice(reduction.startToken, reduction.endToken + 1).map((token) => token.text).join(" ")} → ${reduction.spoken}`,
      kind: "缩读",
      note: reduction.reason
    }))
  ].sort((first, second) => first.position - second.position);
  renderItems(reductionList, forms, "没有发现常见的弱读或缩读提示。");

  summaryText.textContent = analysis.explanation;
  rhythmText.textContent = `节奏提示：${analysis.rhythm.tip}`;
}

function showError(message) {
  error.textContent = message;
  error.hidden = false;
  results.hidden = true;
  stopAudioPreview();
  input.focus();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isAnalyzing) return;
  const requestId = ++latestRequest;
  const sentence = input.value.trim();
  if (!sentence) return showError("请先输入一句英文。");
  if (!/[A-Za-z]/.test(sentence)) return showError("请输入包含英文字母的句子。");

  error.hidden = true;
  isAnalyzing = true;
  submitButton.disabled = true;
  submitButton.replaceChildren("正在分析…");
  submitButton.setAttribute("aria-busy", "true");
  try {
    const analysis = await analyzeSentence(sentence);
    if (requestId !== latestRequest) return;
    stopAudioPreview();
    currentSentence = analysis.sentence;
    renderAnalysis(analysis);
    audioStatus.textContent = audioPreviewSupported() ? "" : "当前浏览器不支持语音预览。";
    results.hidden = false;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    if (requestId === latestRequest) showError("分析暂时不可用，请稍后重试。");
  } finally {
    isAnalyzing = false;
    submitButton.disabled = false;
    submitButton.replaceChildren(...submitButtonContent);
    submitButton.removeAttribute("aria-busy");
  }
});

input.addEventListener("input", () => { error.hidden = true; });

exampleButton.addEventListener("click", () => {
  input.value = "I want to go to the store.";
  form.requestSubmit();
});

const audioAvailable = audioPreviewSupported();
naturalButton.disabled = !audioAvailable;
slowButton.disabled = !audioAvailable;

naturalButton.addEventListener("click", () => {
  playAudioPreview(currentSentence, "natural", (message) => { audioStatus.textContent = message; });
});

slowButton.addEventListener("click", () => {
  playAudioPreview(currentSentence, "slow", (message) => { audioStatus.textContent = message; });
});
