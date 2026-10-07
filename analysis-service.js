import { analyzeLocally } from "./analyzer.js";

/**
 * V0.2 的统一结果格式。位置都是 tokens 的下标；endToken 为包含在内的末尾词。
 * @typedef {"primary" | "secondary" | "unstressed"} StressLevel
 * @typedef {{text: string, start: number, end: number, stress: StressLevel, reason: string}} Token
 * @typedef {{sentence: string, source: "local" | "ai", tokens: Token[],
 *   weakForms: {tokenIndex: number, spoken: string, reason: string}[],
 *   reductions: {startToken: number, endToken: number, spoken: string, reason: string}[],
 *   connections: {fromToken: number, toToken: number, kind: string, reason: string}[],
 *   rhythm: {groups: {startToken: number, endToken: number, focusToken: number | null}[], tip: string},
 *   explanation: string}} AnalysisResult
 */

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTokenIndex(value, count) {
  return Number.isInteger(value) && value >= 0 && value < count;
}

function isRenderableAnalysis(analysis, sentence) {
  if (!isRecord(analysis) || analysis.sentence !== sentence || analysis.source !== "ai" ||
      !Array.isArray(analysis.tokens) || !Array.isArray(analysis.weakForms) ||
      !Array.isArray(analysis.reductions) || !Array.isArray(analysis.connections) ||
      !isRecord(analysis.rhythm) || !Array.isArray(analysis.rhythm.groups) ||
      typeof analysis.rhythm.tip !== "string" || typeof analysis.explanation !== "string") return false;

  const count = analysis.tokens.length;
  return analysis.tokens.every((token) => isRecord(token) && typeof token.text === "string" &&
      Number.isInteger(token.start) && Number.isInteger(token.end) &&
      ["primary", "secondary", "unstressed"].includes(token.stress) && typeof token.reason === "string") &&
    analysis.weakForms.every((form) => isRecord(form) && validTokenIndex(form.tokenIndex, count) &&
      typeof form.spoken === "string" && typeof form.reason === "string") &&
    analysis.reductions.every((item) => isRecord(item) && validTokenIndex(item.startToken, count) &&
      validTokenIndex(item.endToken, count) && typeof item.spoken === "string" && typeof item.reason === "string") &&
    analysis.connections.every((item) => isRecord(item) && validTokenIndex(item.fromToken, count) &&
      validTokenIndex(item.toToken, count) && typeof item.reason === "string");
}

/** @returns {Promise<AnalysisResult>} */
export async function analyzeSentence(sentence) {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence }),
      signal: AbortSignal.timeout(150_000)
    });
    if (response.ok) {
      const analysis = await response.json();
      if (isRenderableAnalysis(analysis, sentence)) return analysis;
    }
  } catch {
    // 网络、超时或响应解析失败时使用本地分析。
  }
  return analyzeLocally(sentence);
}
