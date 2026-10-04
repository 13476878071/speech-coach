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

/** @returns {Promise<AnalysisResult>} */
export async function analyzeSentence(sentence) {
  // 未来可在这里调用自己控制的服务端，并在失败时继续使用本地分析。
  // API 密钥不能放在浏览器文件中。V0.2 只使用本地分析。
  return analyzeLocally(sentence);
}
