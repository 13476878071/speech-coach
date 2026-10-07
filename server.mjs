import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const KIMI_URL = "https://api.moonshot.cn/v1/chat/completions";
const MODEL = "kimi-k2.6";
const MAX_BODY_BYTES = 8192;
const TOKEN_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/analysis-service.js", ["analysis-service.js", "text/javascript; charset=utf-8"]],
  ["/analyzer.js", ["analyzer.js", "text/javascript; charset=utf-8"]],
  ["/audio.js", ["audio.js", "text/javascript; charset=utf-8"]]
]);

// The model returns only linguistic annotations. The server owns the sentence,
// token boundaries and final AnalysisResult shape.
const string = { type: "string" };
const index = { type: "integer" };
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false
});
const array = (items) => ({ type: "array", items });

const AI_ANNOTATION_SCHEMA = object({
  stresses: array(object({
    tokenIndex: index,
    stress: { type: "string", enum: ["primary", "secondary", "unstressed"] },
    reason: string
  })),
  weakForms: array(object({ tokenIndex: index, spoken: string, reason: string })),
  reductions: array(object({ startToken: index, endToken: index, spoken: string, reason: string })),
  connections: array(object({ fromToken: index, toToken: index, kind: string, reason: string })),
  rhythmGroups: array(object({
    startToken: index,
    endToken: index,
    focusToken: { type: ["integer", "null"] }
  })),
  rhythmTip: string,
  explanation: string
});
const TOP_LEVEL_FIELDS = ["sentence", "source", "tokens", "weakForms", "reductions", "connections", "rhythm", "explanation"];
const ANNOTATION_FIELDS = Object.keys(AI_ANNOTATION_SCHEMA.properties);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(new HttpError(413, "请求内容过大。"));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "请求必须是有效的 JSON。"));
      }
    });
    req.on("error", reject);
  });
}

function validatedSentence(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.sentence !== "string") {
    throw new HttpError(400, "sentence 必须是字符串。");
  }
  const sentence = body.sentence.trim();
  if (!sentence) throw new HttpError(400, "sentence 不能为空。");
  if (sentence.length > 200) throw new HttpError(400, "sentence 不能超过 200 个字符。");
  if (!/[A-Za-z]/.test(sentence)) throw new HttpError(400, "sentence 必须包含英文字母。");
  return sentence;
}

function expectedTokens(sentence) {
  return [...sentence.matchAll(TOKEN_PATTERN)].map((match) => ({
    text: match[0], start: match.index, end: match.index + match[0].length
  }));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasFields(value, fields) {
  return isRecord(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value < length;
}

function safeDiagnostic(value, apiKey) {
  if (value === null || value === undefined) return value;
  if (!["string", "number", "boolean"].includes(typeof value)) return typeof value;
  let text = String(value);
  if (apiKey) text = text.split(apiKey).join("[redacted]");
  return text
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bAuthorization\s*[:=]\s*\S+/gi, "Authorization: [redacted]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+/gi, "credential: [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .slice(0, 2000);
}

function logKimiFailure(stage, details, apiKey) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, safeDiagnostic(value, apiKey)])
  );
  console.error(`[Kimi] ${stage}`, safeDetails);
}

function errorDetails(error) {
  if (!error || typeof error !== "object") return { message: error };
  const cause = error.cause && typeof error.cause === "object" ? error.cause : null;
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    causeCode: cause?.code,
    causeMessage: cause?.message,
    stack: error.stack
  };
}

function tokenTextsForLog(tokens, apiKey) {
  let truncated = tokens.length > 20;
  const texts = tokens.slice(0, 20).map((token) => {
    if (typeof token?.text !== "string") return "<invalid>";
    const safeText = safeDiagnostic(token.text, apiKey);
    if (token.text.length > 60) truncated = true;
    return safeText.slice(0, 60);
  });
  return { texts: JSON.stringify(texts), truncated };
}

function topLevelFieldsForLog(result, fields, apiKey) {
  const record = isRecord(result);
  const actual = record ? Object.keys(result) : [];
  const names = (fields) => JSON.stringify(fields.slice(0, 20).map((field) => safeDiagnostic(field, apiKey).slice(0, 60)));
  const types = Object.fromEntries(fields.map((field) => {
    if (!record || !Object.hasOwn(result, field)) return [field, "missing"];
    const value = result[field];
    return [field, value === null ? "null" : Array.isArray(value) ? "array" : typeof value];
  }));
  return {
    expectedFields: names(fields),
    actualFields: names(actual),
    missingFields: names(fields.filter((field) => !record || !Object.hasOwn(result, field))),
    unexpectedFields: names(actual.filter((field) => !fields.includes(field))),
    fieldTypes: JSON.stringify(types),
    actualType: record ? "object" : result === null ? "null" : Array.isArray(result) ? "array" : typeof result,
    truncated: actual.length > 20 || actual.some((field) => field.length > 60)
  };
}

function validAnalysis(result, sentence, onFailure = () => {}) {
  const fail = (location, details) => { onFailure(location, details); return false; };
  if (!hasFields(result, TOP_LEVEL_FIELDS)) return fail("top-level fields");
  if (result.sentence !== sentence) return fail("sentence mismatch");
  if (result.source !== "ai") return fail("source");
  if (!isText(result.explanation)) return fail("explanation");
  if (![result.tokens, result.weakForms, result.reductions, result.connections].every(Array.isArray)) return fail("analysis arrays");

  const expected = expectedTokens(sentence);
  const count = expected.length;
  if (result.tokens.length !== count) return fail("tokens length", { expected, actual: result.tokens });
  for (let i = 0; i < count; i += 1) {
    const token = result.tokens[i];
    const original = expected[i];
    if (!hasFields(token, ["text", "start", "end", "stress", "reason"]) ||
        token.text !== original.text || token.start !== original.start || token.end !== original.end ||
        !["primary", "secondary", "unstressed"].includes(token.stress) || !isText(token.reason)) return fail(`tokens[${i}]`);
  }

  for (const [i, form] of result.weakForms.entries()) {
    if (!hasFields(form, ["tokenIndex", "spoken", "reason"]) ||
        !validIndex(form.tokenIndex, count) || !isText(form.spoken) || !isText(form.reason)) return fail(`weakForms[${i}]`);
  }
  for (const [i, item] of result.reductions.entries()) {
    if (!hasFields(item, ["startToken", "endToken", "spoken", "reason"]) ||
        !validIndex(item.startToken, count) || !validIndex(item.endToken, count) ||
        item.startToken > item.endToken || !isText(item.spoken) || !isText(item.reason)) return fail(`reductions[${i}]`);
  }
  for (const [i, item] of result.connections.entries()) {
    if (!hasFields(item, ["fromToken", "toToken", "kind", "reason"]) ||
        !validIndex(item.fromToken, count) || !validIndex(item.toToken, count) ||
        item.fromToken >= item.toToken || !isText(item.kind) || !isText(item.reason)) return fail(`connections[${i}]`);
  }
  if (!hasFields(result.rhythm, ["groups", "tip"]) ||
      !Array.isArray(result.rhythm.groups) || !isText(result.rhythm.tip)) return fail("rhythm fields");
  for (const [i, group] of result.rhythm.groups.entries()) {
    if (!hasFields(group, ["startToken", "endToken", "focusToken"]) ||
        !validIndex(group.startToken, count) || !validIndex(group.endToken, count) ||
        group.startToken > group.endToken ||
        (group.focusToken !== null &&
          (!validIndex(group.focusToken, count) ||
            group.focusToken < group.startToken || group.focusToken > group.endToken))) return fail(`rhythm.groups[${i}]`);
  }
  return true;
}

function validAnnotations(result, count, onFailure = () => {}) {
  const fail = (location, details) => { onFailure(location, details); return false; };
  if (!hasFields(result, ANNOTATION_FIELDS)) return fail("top-level fields");
  if (!isText(result.rhythmTip) || !isText(result.explanation)) return fail("summary text");
  if (![result.stresses, result.weakForms, result.reductions, result.connections, result.rhythmGroups].every(Array.isArray)) {
    return fail("annotation arrays");
  }
  if (result.stresses.length !== count) {
    return fail("stresses length", { expectedCount: count, actualCount: result.stresses.length });
  }
  for (let i = 0; i < count; i += 1) {
    const item = result.stresses[i];
    if (!hasFields(item, ["tokenIndex", "stress", "reason"]) ||
        item.tokenIndex !== i ||
        !["primary", "secondary", "unstressed"].includes(item.stress) || !isText(item.reason)) {
      return fail(`stresses[${i}]`);
    }
  }
  for (const [i, form] of result.weakForms.entries()) {
    if (!hasFields(form, ["tokenIndex", "spoken", "reason"]) ||
        !validIndex(form.tokenIndex, count) || !isText(form.spoken) || !isText(form.reason)) return fail(`weakForms[${i}]`);
  }
  for (const [i, item] of result.reductions.entries()) {
    if (!hasFields(item, ["startToken", "endToken", "spoken", "reason"]) ||
        !validIndex(item.startToken, count) || !validIndex(item.endToken, count) ||
        item.startToken > item.endToken || !isText(item.spoken) || !isText(item.reason)) return fail(`reductions[${i}]`);
  }
  for (const [i, item] of result.connections.entries()) {
    if (!hasFields(item, ["fromToken", "toToken", "kind", "reason"]) ||
        !validIndex(item.fromToken, count) || !validIndex(item.toToken, count) ||
        item.fromToken >= item.toToken || !isText(item.kind) || !isText(item.reason)) return fail(`connections[${i}]`);
  }
  for (const [i, group] of result.rhythmGroups.entries()) {
    if (!hasFields(group, ["startToken", "endToken", "focusToken"]) ||
        !validIndex(group.startToken, count) || !validIndex(group.endToken, count) ||
        group.startToken > group.endToken ||
        (group.focusToken !== null &&
          (!validIndex(group.focusToken, count) ||
            group.focusToken < group.startToken || group.focusToken > group.endToken))) return fail(`rhythmGroups[${i}]`);
  }
  return true;
}

function assembleAnalysis(sentence, tokens, annotations) {
  return {
    sentence,
    source: "ai",
    tokens: tokens.map((token, i) => ({
      ...token,
      stress: annotations.stresses[i].stress,
      reason: annotations.stresses[i].reason
    })),
    weakForms: annotations.weakForms,
    reductions: annotations.reductions,
    connections: annotations.connections,
    rhythm: { groups: annotations.rhythmGroups, tip: annotations.rhythmTip },
    explanation: annotations.explanation
  };
}

const FENCED_JSON_PATTERN = /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*\s*$/;

function parseStructuredContent(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const fenced = FENCED_JSON_PATTERN.exec(content);
    if (!fenced) throw error;
    return JSON.parse(fenced[1]);
  }
}

async function analyzeWithKimi(sentence, apiKey, kimiFetch) {
  const tokens = expectedTokens(sentence);
  let upstream;
  try {
    upstream = await kimiFetch(KIMI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        thinking: { type: "disabled" },
        max_tokens: 2048,
        messages: [
          {
            role: "system",
            content: "Analyze likely natural American English speech flow for the provided sentence and indexed tokens. Return only the requested linguistic annotations. Use only the supplied zero-based token indexes for all token references. Give exactly one stresses entry for each token in tokenIndex order. For ranges, endToken is inclusive and startToken must not exceed endToken; connections require fromToken less than toToken. A focusToken must be null or inside its rhythm group. Provide cautious, context-dependent stress, weak forms, reductions, linking and rhythm explanations. Use empty arrays when a phenomenon is absent. Do not invent or modify tokens."
          },
          { role: "user", content: JSON.stringify({
            sentence,
            tokens: tokens.map((token, tokenIndex) => ({ tokenIndex, text: token.text }))
          }) }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "speech_coach_annotations",
            strict: true,
            schema: AI_ANNOTATION_SCHEMA
          }
        }
      }),
      signal: AbortSignal.timeout(120_000)
    });
  } catch (error) {
    logKimiFailure("request failed", errorDetails(error), apiKey);
    throw new HttpError(502, "AI 服务暂时不可用。");
  }

  if (!upstream.ok) {
    let errorBody;
    try {
      errorBody = await upstream.json();
    } catch (error) {
      logKimiFailure("HTTP error body could not be parsed", { status: upstream.status, ...errorDetails(error) }, apiKey);
    }
    const kimiError = isRecord(errorBody?.error) ? errorBody.error : errorBody;
    logKimiFailure("HTTP error", {
      status: upstream.status,
      type: kimiError?.type,
      code: kimiError?.code,
      message: kimiError?.message
    }, apiKey);
    throw new HttpError(502, "AI 服务暂时不可用。");
  }
  let response;
  try {
    response = await upstream.json();
  } catch (error) {
    logKimiFailure("response JSON parse failed", errorDetails(error), apiKey);
    throw new HttpError(502, "AI 服务暂时不可用。");
  }
  if (!isRecord(response) || response.error) {
    const kimiError = isRecord(response?.error) ? response.error : null;
    logKimiFailure("unexpected response envelope", {
      type: kimiError?.type,
      code: kimiError?.code,
      message: kimiError?.message,
      responseType: Array.isArray(response) ? "array" : typeof response
    }, apiKey);
    throw new HttpError(502, "AI 服务暂时不可用。");
  }
  const choice = Array.isArray(response.choices) ? response.choices[0] : null;
  if (!isRecord(choice) || choice.finish_reason !== "stop") {
    logKimiFailure("structured output did not finish", {
      choicePresent: isRecord(choice),
      finishReason: choice?.finish_reason
    }, apiKey);
    throw new HttpError(502, "AI 服务暂时不可用。");
  }
  const content = isRecord(choice.message) ? choice.message.content : null;
  if (!isText(content)) {
    logKimiFailure("structured output content missing", {
      contentType: Array.isArray(content) ? "array" : typeof content,
      refusalPresent: Boolean(choice.message?.refusal)
    }, apiKey);
    throw new HttpError(502, "AI 服务暂时不可用。");
  }
  let annotations;
  try {
    annotations = parseStructuredContent(content);
  } catch (error) {
    logKimiFailure("structured output JSON parse failed", {
      name: error?.name,
      fencedContent: FENCED_JSON_PATTERN.test(content),
      contentLength: content.length
    }, apiKey);
    throw new HttpError(502, "AI 服务暂时不可用。");
  }
  if (!validAnnotations(annotations, tokens.length, (location, details) => {
    const diagnostic = { location, ...details };
    if (location === "top-level fields") {
      Object.assign(diagnostic, topLevelFieldsForLog(annotations, ANNOTATION_FIELDS, apiKey));
    }
    logKimiFailure("annotation validation failed", diagnostic, apiKey);
  })) {
    throw new HttpError(502, "AI 服务暂时不可用。");
  }
  const result = assembleAnalysis(sentence, tokens, annotations);
  if (!validAnalysis(result, sentence, (location, details) => {
    const diagnostic = { location };
    if (location === "top-level fields") {
      Object.assign(diagnostic, topLevelFieldsForLog(result, TOP_LEVEL_FIELDS, apiKey));
    } else if (details) {
      const expected = tokenTextsForLog(details.expected, apiKey);
      const actual = tokenTextsForLog(details.actual, apiKey);
      Object.assign(diagnostic, {
        expectedCount: details.expected.length,
        actualCount: details.actual.length,
        expected: expected.texts,
        actual: actual.texts,
        truncated: expected.truncated || actual.truncated
      });
    }
    logKimiFailure("analysis validation failed", diagnostic, apiKey);
  })) {
    throw new HttpError(502, "AI 服务暂时不可用。");
  }
  return result;
}

async function serveStatic(req, res, pathname) {
  const file = STATIC_FILES.get(pathname);
  if (!file) return sendJson(res, 404, { error: "未找到该资源。" });
  const [filename, contentType] = file;
  const body = await readFile(new URL(`./${filename}`, import.meta.url));
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "X-Content-Type-Options": "nosniff"
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

export function createAppServer({ kimiFetch = fetch } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === "/api/analyze") {
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          return sendJson(res, 405, { error: "只支持 POST。" });
        }
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
          throw new HttpError(415, "请使用 application/json。");
        }
        const sentence = validatedSentence(await readJsonBody(req));
        const apiKey = process.env.KIMI_API_KEY?.trim();
        if (!apiKey) throw new HttpError(503, "服务器尚未配置 KIMI_API_KEY。");
        return sendJson(res, 200, await analyzeWithKimi(sentence, apiKey, kimiFetch));
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        return sendJson(res, 405, { error: "不支持该请求方法。" });
      }
      await serveStatic(req, res, pathname);
    } catch (error) {
      if (!(error instanceof HttpError)) {
        logKimiFailure("server runtime error", errorDetails(error), process.env.KIMI_API_KEY?.trim());
      }
      if (!res.headersSent) {
        sendJson(res, error instanceof HttpError ? error.status : 500, {
          error: error instanceof HttpError ? error.message : "服务器内部错误。"
        });
      } else {
        res.destroy();
      }
    }
  });
  server.requestTimeout = 15_000;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error("PORT 必须是 1 到 65535 之间的整数。");
    process.exitCode = 1;
  } else {
    createAppServer().listen(PORT, HOST, () => {
      console.log(`Speech Coach: http://${HOST}:${PORT}`);
    });
  }
}
