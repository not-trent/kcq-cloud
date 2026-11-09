// Classification policy tests: only module guides may reach the library.
// Run: node guides/test/classify.test.mjs
import assert from 'node:assert/strict';
import { classify, reviewStatus } from '../scripts/lib/classify.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const mancosaGuide = {
  title: 'HCPM - Public Finance.pdf',
  text_chars: 219149,
  text_start: 'Higher Certificate in Public Management\n\nPUBLIC FINANCE\n\nModule Guide\n\nCopyright © 2025 MANCOSA\n\nAll rights reserved...\n\nmodulefeedback@mancosa.co.za\n\nTable of Contents\n',
};

test('MANCOSA module guide template is a guide', () => {
  assert.equal(classify(mancosaGuide).classification, 'guide');
  assert.equal(reviewStatus('guide'), 'approved');
});

test('SANTS curriculum and learning guide is a guide', () => {
  const record = {
    title: 'E-ASS 120 Curriculum Learning Guide.pdf',
    text_chars: 23419,
    text_start: 'HIGHER CERTIFICATE IN EARLY CHILDHOOD CARE AND EDUCATION\n\nASSESSMENT IN THE EARLY YEARS\n\nE-ASS 120\n\nLEVEL 5\n\nCREDITS 8\n\nCURRICULUM AND LEARNING GUIDE\n',
  };
  assert.equal(classify(record).classification, 'guide');
});

test('filename "SG" (including underscore suffixes) is a guide', () => {
  assert.equal(classify({ title: 'POM100_POMD152 2026 01 SG_9502199_260910_101038.pdf', text_chars: 29640, text_start: 'Module 1' }).classification, 'guide');
});

test('question papers and assignments are assessments, never guides', () => {
  for (const title of [
    'F-HLZ 313 2026 S2 A1 QP.pdf',
    'F-MAT 323 Assignment 2 Semester 2 2026.pdf',
    'MAND152 2026 02 ASGMT.pdf',
    'B-EDS 315 2026 S2 A1 QP.pdf',
  ]) {
    const verdict = classify({ title, text_chars: 20000, text_start: 'Question One consists of three (3) questions.' });
    assert.equal(verdict.classification, 'assessment', title);
    assert.equal(reviewStatus(verdict.classification), 'excluded');
  }
});

test('tutorial letters and rubrics are assessments', () => {
  for (const title of ['MANAGEMENT ACCOUNTING TUTORIAL LETTER 2026 (2).docx', 'ACC  FIN MAN TUTORIAL 2026 Rubric (1).pdf']) {
    assert.equal(classify({ title, text_chars: 5000, text_start: 'Dear student' }).classification, 'assessment', title);
  }
});

test('copy of an answer sheet that merely mentions the guide is not a guide', () => {
  const record = {
    title: 'Question Two consists of three (3) questions. - Filo',
    text_chars: 10168,
    text_start: 'Read Unit 3 & 4 in your B-EDS 111 Curriculum and Learning Guide (CLG) before answering...',
  };
  assert.equal(classify(record).classification, 'assessment');
});

test('resale exam packs are generated material, never guides', () => {
  for (const title of ['AUI4862 EXAM PACK 2026 - DISTINCTION GUARANTEED', 'MNG3702 EXAM PACK 2026 - Stuvia']) {
    assert.equal(classify({ title, text_chars: 9000, text_start: 'Study notes' }).classification, 'generated', title);
  }
});

test('a "Guideline" filename alone does not make a module guide', () => {
  const record = {
    title: 'HONOURS_How to Write a Research Report_Guideline_2025 (1).pdf',
    text_chars: 106644,
    text_start: 'This guideline explains how to structure a research report. It is not a module guide.',
  };
  assert.notEqual(classify(record).classification, 'guide');
});

test('short fragments and bibliography scraps stay ambiguous', () => {
  assert.equal(classify({ title: '2. The module guide is not a primary source of re…', text_chars: 312, text_start: 'The module guide is not a primary source of reference.' }).classification, 'ambiguous');
  assert.equal(classify({ title: 'References', text_chars: 1872, text_start: 'Alexander, M., Ball, D.' }).classification, 'ambiguous');
});

test('a reviewed override can admit or reject a specific source', () => {
  const record = { id: 'S9999', title: 'Some scan.pdf', text_chars: 5000, text_start: '' };
  assert.equal(classify(record, { S9999: { classification: 'guide', reason: 'checked by hand' } }).classification, 'guide');
  assert.equal(classify({ ...record, id: 'S9998' }, { S9998: { classification: 'assessment' } }).classification, 'assessment');
});

console.log(`\n${passed} tests passed`);
