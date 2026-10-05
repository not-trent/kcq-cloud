// Mirrors server/src/index.js's text parsing so client-side OCR produces the same question/answer shape.
export const normalizeText = (value = '') => String(value).trim().replace(/\s+/g, ' ');

export function inferQuestionAnswerFromText(rawText = '') {
  const text = normalizeText(String(rawText || ''));
  if (!text) {
    return { question: '', answer: '', options: [] };
  }

  const optionPattern = /(?:^|\s)([A-D])\s*[.)\-:]\s*/gi;
  const optionMatches = [...text.matchAll(optionPattern)];
  const firstOptionIndex = optionMatches[0]?.index ?? -1;
  const questionText = firstOptionIndex >= 0 ? text.slice(0, firstOptionIndex) : text;
  let question = questionText.trim();
  const answerMatch = text.match(/(?:answer|correct|option)\s+(?:is\s+)?([A-D])/i);
  const answerLetter = answerMatch?.[1]?.toUpperCase() || String(selectedOption || '').toUpperCase();
  const options = optionMatches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = optionMatches[index + 1]?.index ?? text.length;
    return normalizeText(text.slice(start, end).replace(/\b(?:the\s+)?(?:answer|correct\s+answer)\s+(?:is\s+)?[A-D]\b.*$/i, ''));
  }).filter(Boolean);

  if (question && question.endsWith('?') === false && text.includes('?')) {
    question = `${question}?`;
  }

  const answerIndex = answerLetter ? answerLetter.charCodeAt(0) - 65 : -1;
  const answer = answerIndex >= 0 && options[answerIndex] ? options[answerIndex] : answerLetter;

  return {
    question: question.replace(/^question\s+\d+\s*/i, '').replace(/\s+\?$/, '?').trim(),
    answer,
    answerLetter,
    options,
  };
}

export function deriveQuestionFromFile(filename = '') {
  return normalizeText(
    String(filename)
      .replace(/\.[^/.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b(screenshot|img|image|photo|pic)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
