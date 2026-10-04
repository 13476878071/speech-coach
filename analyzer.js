// 本地规则是离线备用分析，不代表真实发音或语境理解。
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "as", "at", "by", "for", "from", "in",
  "into", "of", "on", "onto", "over", "than", "that", "through", "to",
  "under", "with", "about", "after", "before", "because", "if", "while",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "this", "these", "those",
  "am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did",
  "have", "has", "had", "can", "could", "will", "would", "shall", "should",
  "may", "might", "must"
]);

const COMMON_BASE_VERBS = new Set([
  "ask", "be", "buy", "call", "come", "cook", "do", "eat", "find", "get", "give",
  "go", "have", "help", "leave", "look", "make", "meet", "play", "read", "say",
  "see", "send", "sleep", "start", "study", "take", "talk", "tell", "try", "use",
  "visit", "wait", "walk", "watch", "work", "write"
]);

const WEAK_FORMS = new Map([
  ["a", { spoken: "/ə/", reason: "不强调时，元音通常弱化。" }],
  ["an", { spoken: "/ən/", reason: "不强调时，元音通常弱化。" }],
  ["and", { spoken: "/ən/", reason: "快速语流中，d 也可能变弱。" }],
  ["are", { spoken: "/ər/", reason: "不强调时常读得更轻。" }],
  ["at", { spoken: "/ət/", reason: "不强调时，元音通常弱化。" }],
  ["can", { spoken: "/kən/", reason: "不强调时，元音通常弱化。" }],
  ["for", { spoken: "/fər/", reason: "不强调时，元音通常弱化。" }],
  ["of", { spoken: "/əv/", reason: "通常轻读；快速语流中 v 也可能变弱。" }],
  ["the", { spoken: "/ðə/ 或 /ði/", reason: "通常轻读；后接元音时常接近 /ði/。" }],
  ["to", { spoken: "/tə/", reason: "不强调时，元音通常弱化。" }],
  ["was", { spoken: "/wəz/", reason: "不强调时，元音通常弱化。" }]
]);

const PHRASE_REDUCTIONS = [
  { words: ["going", "to"], spoken: "gonna", reason: "在 going to + 动词结构中，口语常这样缩读。" },
  { words: ["want", "to"], spoken: "wanna", reason: "快速口语中常连成接近 wanna 的声音。" },
  { words: ["got", "to"], spoken: "gotta", reason: "快速口语中常缩成接近 gotta。" },
  { words: ["have", "to"], spoken: "hafta", reason: "口语中常听起来接近 hafta。" },
  { words: ["kind", "of"], spoken: "kinda", reason: "非正式口语中常缩成接近 kinda。" },
  { words: ["sort", "of"], spoken: "sorta", reason: "非正式口语中常缩成接近 sorta。" },
  { words: ["let", "me"], spoken: "lemme", reason: "快速口语中可能连成接近 lemme。" },
  { words: ["give", "me"], spoken: "gimme", reason: "快速口语中可能连成接近 gimme。" }
];

const WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const VOWEL_LETTERS = /^[aeiou]/i;
const CONSONANT_LETTERS = /[bcdfghjklmnpqrstvwxyz]$/i;

function hasPause(text) {
  return /[,.!?;:\n]/.test(text);
}

function tokenize(sentence) {
  return [...sentence.matchAll(WORD_PATTERN)].map((match) => ({
    text: match[0],
    normalized: match[0].toLowerCase().replace(/’/g, "'"),
    start: match.index,
    end: match.index + match[0].length
  }));
}

function canReducePhrase(rule, words, index, sentence) {
  const first = words[index];
  const second = words[index + 1];
  if (rule.words[0] !== first.normalized || rule.words[1] !== second.normalized) return false;
  if (first.normalized !== "going") return true;

  // "going to the store" 是表示方向；这里只给常见的 going to + 动词提供 gonna 提示。
  const next = words[index + 2];
  return Boolean(next &&
    !hasPause(sentence.slice(second.end, next.start)) &&
    COMMON_BASE_VERBS.has(next.normalized));
}

function makeRhythmGroups(sentence, words, tokens) {
  const groups = [];
  let groupStart = 0;

  words.forEach((word, index) => {
    const next = words[index + 1];
    if (next && !hasPause(sentence.slice(word.end, next.start))) return;

    let focusToken = null;
    for (let cursor = index; cursor >= groupStart; cursor -= 1) {
      if (tokens[cursor].stress !== "unstressed") {
        focusToken = cursor;
        break;
      }
    }
    if (focusToken !== null) {
      tokens[focusToken].stress = "primary";
      tokens[focusToken].reason = "这一节奏组靠后的信息词，默认读法里常是主要焦点。";
    }
    groups.push({ startToken: groupStart, endToken: index, focusToken });
    groupStart = index + 1;
  });

  return groups;
}

export function analyzeLocally(sentence) {
  const words = tokenize(sentence);
  const tokens = words.map((word) => {
    const unstressed = FUNCTION_WORDS.has(word.normalized);
    return {
      text: word.text,
      start: word.start,
      end: word.end,
      stress: unstressed ? "unstressed" : "secondary",
      reason: unstressed
        ? "这类小词在默认读法里通常轻读，强调时也可能重读。"
        : "这个词承载信息，通常比周围的小词更明显。"
    };
  });
  const connections = [];
  const reductions = [];
  const weakForms = [];
  const usedInReduction = new Set();

  for (let index = 0; index < words.length - 1; index += 1) {
    const first = words[index];
    const second = words[index + 1];
    if (hasPause(sentence.slice(first.end, second.start))) continue;

    const phrase = PHRASE_REDUCTIONS.find((rule) => canReducePhrase(rule, words, index, sentence));
    if (phrase && !usedInReduction.has(index)) {
      reductions.push({
        startToken: index,
        endToken: index + 1,
        spoken: phrase.spoken,
        reason: phrase.reason
      });
      usedInReduction.add(index);
      usedInReduction.add(index + 1);
      if (first.normalized === "going") {
        tokens[index].stress = "unstressed";
        tokens[index].reason = "在表示将来动作的 going to + 动词结构中，going 常弱化。";
      }
    }

    // 拼写边界只是声音边界的粗略线索，实际连读取决于发音。
    if (CONSONANT_LETTERS.test(first.text) && VOWEL_LETTERS.test(second.text)) {
      connections.push({
        fromToken: index,
        toToken: index + 1,
        kind: "consonant_to_vowel",
        reason: "前词末尾的辅音可能顺势接到后词开头的元音。"
      });
    }
  }

  words.forEach((word, index) => {
    const weak = WEAK_FORMS.get(word.normalized);
    if (weak && !usedInReduction.has(index)) {
      weakForms.push({ tokenIndex: index, spoken: weak.spoken, reason: weak.reason });
    }
  });

  const groups = makeRhythmGroups(sentence, words, tokens);
  const mainWords = tokens.filter((token) => token.stress === "primary").map((token) => token.text);
  const supportWords = tokens.filter((token) => token.stress === "secondary").map((token) => token.text);
  let focusExplanation = "这句话没有明显的信息词；具体重读取决于你想强调什么。";
  if (mainWords.length) {
    const supporting = supportWords.length
      ? `${supportWords.join("、")} 也承载信息，可以稍轻。`
      : "其余小词可以稍轻。";
    focusExplanation = `${mainWords.join("、")} 是默认读法里的主要节奏落点；${supporting}`;
  }
  const formExplanation = reductions.length
    ? `像 ${words.slice(reductions[0].startToken, reductions[0].endToken + 1).map((word) => word.text).join(" ")} 这样的组合，快速口语中可能缩读。`
    : weakForms.length ? "不强调的小词可以适当弱读。" : "按自然节奏读即可，不必刻意缩读。";

  return {
    sentence,
    source: "local",
    tokens,
    weakForms,
    reductions,
    connections,
    rhythm: {
      groups,
      tip: groups.length > 1
        ? "在标点处稍作停顿，每组突出一个主要节奏落点。"
        : "让主要重读成为节奏落点，其他词轻一些、短一些。"
    },
    explanation: `${focusExplanation}${formExplanation}`
  };
}
