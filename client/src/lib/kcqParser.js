// Turns Tesseract line boxes from a quiz screenshot into question blocks (question, options, picked option, score).
const SCORE_RE = /(\d+(?:[.,]\d+)?|[OoIl])\s*(?:\/|out\s+of)\s*(\d+(?:[.,]\d+)?|[OoIl])/i;
const INFO_RE = /^(question\s*\d+|correct|incorrect|partially correct|mark(?:ed)?\b|flag|not yet answered|answer saved|\d+(?:[.,]\d+)?\s*(?:\/|out\s+of))/i;
const LETTER_RE = /^[^\p{L}\p{N}]*([A-Da-d])[.)]\s+/u;
const RADIO_GLYPH_RE = /^[^\p{L}\p{N}]*[oO©®@Q0]\s+(?=\S)/u;

const toNumber = (token) => {
  if (/^[Oo]$/.test(token)) return 0;
  if (/^[Il]$/.test(token)) return 1;
  return parseFloat(token.replace(',', '.'));
};

export function parseScore(text) {
  const match = String(text).match(SCORE_RE);
  if (!match) return null;
  const got = toNumber(match[1]);
  const max = toNumber(match[2]);
  if (!(max > 0) || got > max || max > 10) return null;
  return got >= max ? 1 : 0;
}

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// Splits Tesseract lines wherever words are far apart (separate columns) or a '|' divider appears.
function toSegments(line) {
  const words = line.words || [];
  if (!words.length) return [{ text: line.text, ...line.bbox }];
  const height = Math.max(line.bbox.y1 - line.bbox.y0, 8);
  const segments = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    segments.push({
      text: current.map((word) => word.text).join(' '),
      x0: current[0].bbox.x0,
      y0: Math.min(...current.map((word) => word.bbox.y0)),
      x1: current[current.length - 1].bbox.x1,
      y1: Math.max(...current.map((word) => word.bbox.y1)),
    });
    current = [];
  };
  words.forEach((word, index) => {
    if (/^[|¦]+$/.test(word.text)) { flush(); return; }
    if (index > 0 && current.length && word.bbox.x0 - words[index - 1].bbox.x1 > height * 3) flush();
    current.push(word);
  });
  flush();
  return segments;
}

const INLINE_OPTION_RE = /\s[—–-]\s*[aA][.)]\s+/;

const cleanOptionText = (text) => String(text)
  .replace(LETTER_RE, '')
  .replace(RADIO_GLYPH_RE, '')
  .replace(/\s+/g, ' ')
  .trim();

function splitBlocks(lines) {
  if (!lines.length) return [];
  const gapLimit = Math.max(median(lines.map((line) => line.y1 - line.y0)), 8) * 2.2;
  const blocks = [[lines[0]]];
  for (let i = 1; i < lines.length; i += 1) {
    const gap = lines[i].y0 - lines[i - 1].y1;
    if (gap > gapLimit) blocks.push([]);
    blocks[blocks.length - 1].push(lines[i]);
  }
  return blocks;
}

function splitQuestionAndOptions(block, optionCount) {
  const lettered = block.map((line, index) => (LETTER_RE.test(line.text) ? index : -1)).filter((index) => index >= 0);

  if (lettered.length === optionCount) {
    const first = lettered[0];
    const options = [];
    for (let i = first; i < block.length; i += 1) {
      if (LETTER_RE.test(block[i].text) || !options.length) options.push({ lines: [block[i]] });
      else options[options.length - 1].lines.push(block[i]);
    }
    return { questionLines: block.slice(0, first), optionGroups: options.slice(0, optionCount) };
  }

  if (block.length > optionCount) {
    return {
      questionLines: block.slice(0, block.length - optionCount),
      optionGroups: block.slice(block.length - optionCount).map((line) => ({ lines: [line] })),
    };
  }

  return { questionLines: block, optionGroups: [] };
}

// Compares ink density at the radio-button column of each option; the filled one is the picked answer.
function detectPicked(optionGroups, gray) {
  if (optionGroups.length < 2) return -1;
  const columnX = Math.min(...optionGroups.map((group) => group.lines[0].x0));
  const scores = optionGroups.map((group) => {
    const line = group.lines[0];
    const h = Math.max(line.y1 - line.y0, 8);
    const x0 = Math.max(0, Math.floor(columnX - 0.6 * h));
    const x1 = Math.min(gray.width, Math.ceil(columnX + 1.3 * h));
    const y0 = Math.max(0, Math.floor(line.y0));
    const y1 = Math.min(gray.height, Math.ceil(line.y1));
    if (x1 <= x0 || y1 <= y0) return 0;
    const { data } = gray.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 140) dark += 1;
    return dark / ((x1 - x0) * (y1 - y0));
  });

  const ranked = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
  if (ranked[0].score < 0.02) return -1;
  return ranked[0].score >= ranked[1].score * 1.25 ? ranked[0].index : -1;
}

export function parseQuizPage(result, gray, { optionCount = 4 } = {}) {
  const raw = (result?.data?.lines || [])
    .flatMap(toSegments)
    .flatMap((segment) => {
      const match = segment.text.match(INLINE_OPTION_RE);
      if (!match) return [segment];
      return [
        { ...segment, text: segment.text.slice(0, match.index) },
        { ...segment, text: `a. ${segment.text.slice(match.index + match[0].length)}` },
      ];
    })
    .map((line) => ({ ...line, text: String(line.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((line) => line.text)
    .sort((a, b) => a.y0 - b.y0);

  const markers = [];
  const content = [];
  raw.forEach((line) => {
    const score = parseScore(line.text);
    const inInfoColumn = line.x0 < gray.width * 0.25 && INFO_RE.test(line.text);
    if (score !== null && (inInfoColumn || line.text.length < 40)) markers.push({ y: line.y0, score });
    else if (!inInfoColumn) content.push(line);
  });

  const blocks = splitBlocks(content).filter((block) => block.length >= 2);

  const questions = blocks.map((block) => {
    const { questionLines, optionGroups } = splitQuestionAndOptions(block, optionCount);
    const options = optionGroups.map((group) => cleanOptionText(group.lines.map((line) => line.text).join(' '))).filter(Boolean);
    return {
      question: questionLines.map((line) => line.text).join(' ').replace(/^question\s*\d+\s*/i, '').trim(),
      options,
      pickedIndex: detectPicked(optionGroups, gray),
      score: null,
      _top: block[0].y0,
    };
  });

  // Each marker belongs to the last block that starts at or above it.
  markers.forEach((marker) => {
    const owner = [...questions].reverse().find((item) => item._top <= marker.y + 20);
    if (owner && owner.score === null) owner.score = marker.score;
  });

  return questions.map(({ _top, ...rest }) => rest);
}
