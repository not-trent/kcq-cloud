// Classifies recovered exports before ingestion. Rules are deliberately narrow:
// a document is only a "guide" when its own wording or template says so.
// Anything else is excluded or held for review rather than guessed into the library.

const GENERATED = /stuvia|exam pack|complete answers|distinction guaranteed/i;
const GUIDE_TEMPLATE = /modulefeedback@mancosa\.co\.za|^\s*CURRICULUM AND LEARNING GUIDE\s*$|^\s*(?:MODULE|STUDY) GUIDE\s*$/im;
// Only explicit guide wording counts. "Guideline" alone is not a module guide:
// it also names assignment briefs and how-to notes.
const GUIDE_TITLE = /study guide|module guide|learning guide|\bCLG\b|\bMG\s*[-–]|(?<![A-Za-z])SGs?(?![A-Za-z])/i;
const ASSESSMENT = /\bASGMT\b|assignment|question paper|\bQP\b|tutorial letter|rubric|case study|\bassessment\b|marking|proposal|template|checklist|study plan|question one|question two|question three|read unit/i;

export function classify(record, overrides = {}) {
  const id = record.id;
  const override = overrides[id];
  const title = String(record.title || '');
  const head = String(record.text_start || '').slice(0, 1000);

  if (override?.classification) {
    return { classification: override.classification, reason: override.reason || 'reviewed override' };
  }
  if (GENERATED.test(`${title}\n${head}`)) {
    return { classification: 'generated', reason: 'resale exam pack or copied answers' };
  }
  if (/^(references|bibliography)$/i.test(title.trim())) {
    return { classification: 'ambiguous', reason: 'bibliography fragment, not a guide' };
  }
  if (Number(record.text_chars || 0) < 1000) {
    return { classification: 'ambiguous', reason: 'too little text to classify' };
  }
  if (GUIDE_TEMPLATE.test(head)) {
    return { classification: 'guide', reason: 'guide template markers in the opening' };
  }
  if (GUIDE_TITLE.test(title) && !ASSESSMENT.test(title)) {
    return { classification: 'guide', reason: 'guide wording in the filename' };
  }
  if (ASSESSMENT.test(`${title}\n${head.slice(0, 600)}`)) {
    return { classification: 'assessment', reason: 'assessment, question-paper or rubric wording' };
  }
  return { classification: 'ambiguous', reason: 'no reliable guide or assessment marker' };
}

// Review policy: only guide-classified sources are ingested by default. Ambiguous
// items are reported and stay out of the database until someone approves them.
export function reviewStatus(classification) {
  return classification === 'guide' ? 'approved' : 'excluded';
}
