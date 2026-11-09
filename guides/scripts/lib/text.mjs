// Text normalisation, section detection, chunking and page-map validation.
// All offsets are character offsets into the normalised text of one source.

export const TEXT_VERSION = 'takeout-2026-11-07/text-v1';

export function normalize(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\f/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.replace(/ +$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function blockRanges(text) {
  const ranges = [];
  const push = (from, to) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (end > start) ranges.push({ start, end, text: text.slice(start, end) });
  };

  const separator = /\n{2,}/g;
  let cursor = 0;
  let match;
  while ((match = separator.exec(text))) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  push(cursor, text.length);
  return ranges;
}

const HEADING_WORDS = /^(chapter|unit|section|part|module|appendix)\b/i;
const NUMBERED_HEADING = /^\d+(\.\d+){0,3}\s+[A-Z(]/;
const ALL_CAPS = /^[A-Z0-9][A-Z0-9 &'’()\-–—:.,/]*$/;

export function isHeading(block) {
  const text = block.text.trim();
  if (!text || text.length > 90) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (letters < 3) return false;
  // "Chapter Outcomes Upon completion of this chapter, the learner should be
  // able to:" is body text. Real structural heads are short or numbered.
  if (HEADING_WORDS.test(text)) return text.length <= 60 || /\d/.test(text);
  if (NUMBERED_HEADING.test(text) && !/[.!?]$/.test(text)) return true;
  if (ALL_CAPS.test(text) && text.split(/\s+/).length <= 14 && !/[.!?]$/.test(text)) return true;
  return false;
}

function splitSentences(text, base) {
  const parts = [];
  const regex = /[^.!?]+[.!?]+["'’)]?|\S[^.!?]*$/g;
  let match;
  while ((match = regex.exec(text))) {
    const piece = match[0];
    if (!piece.trim()) continue;
    const lead = piece.length - piece.trimStart().length;
    parts.push({ text: piece.trim(), start: base + match.index + lead, end: base + match.index + lead + piece.trim().length });
  }
  if (!parts.length) parts.push({ text: text.trim(), start: base, end: base + text.length });
  return parts;
}

function flush(state, chunks) {
  if (!state.parts.length) return;
  const text = state.parts.map((part) => part.text).join(' ');
  const start = state.parts[0].start;
  const end = state.parts[state.parts.length - 1].end;
  if (text.trim().length >= 40) {
    chunks.push({ heading: state.heading, text, char_start: start, char_end: end });
  }
  state.parts = [];
}

/**
 * Splits normalised text into passages at heading and paragraph boundaries,
 * targeting `target` characters and never merging across a heading.
 */
export function chunkText(text, { target = 1200, max = 2000 } = {}) {
  const chunks = [];
  let heading = null;
  const state = { heading: null, parts: [] };

  for (const block of blockRanges(text)) {
    if (isHeading(block)) {
      flush(state, chunks);
      heading = block.text.replace(/\s+/g, ' ').trim();
      state.heading = heading;
      continue;
    }

    const length = state.parts.reduce((sum, part) => sum + part.text.length + 1, 0);
    if (length && length + block.text.length > max) flush(state, chunks);

    if (block.text.length > max) {
      for (const sentence of splitSentences(block.text, block.start)) {
        const current = state.parts.reduce((sum, part) => sum + part.text.length + 1, 0);
        if (current && current + sentence.text.length > target) flush(state, chunks);
        state.parts.push(sentence);
      }
      continue;
    }

    state.parts.push({ text: block.text.replace(/\s+/g, ' '), start: block.start, end: block.end });
    const size = state.parts.reduce((sum, part) => sum + part.text.length + 1, 0);
    if (size >= target) flush(state, chunks);
  }
  flush(state, chunks);

  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

const PAGE_FOOTER = /^([A-Z][A-Z0-9 &'’()\-–—:.,/]{6,70}?)\s{1,6}(\d{1,3})$/;

/**
 * Finds printed-page footers such as "BACHELOR OF COMMERCE ... 148".
 * A page map is trusted only when one running header repeats at least five
 * times with strictly increasing page numbers.
 */
export function findPageMarkers(text) {
  const markers = [];
  const lines = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    lines.push({ text: line, start: offset });
    offset += line.length + 1;
  }

  for (const line of lines) {
    const match = line.text.trim().match(PAGE_FOOTER);
    if (!match) continue;
    const page = Number(match[2]);
    if (!page || page > 999) continue;
    markers.push({ header: match[1].trim(), page, start: line.start });
  }

  // Short generic running heads ("SECTION 3", "MANCOSA 12") are section or
  // imprint numbering, not page numbers. Require a distinctive header.
  const generic = /^(SECTION|MANCOSA|PAGE|CONTENTS|CHAPTER|UNIT|MODULE|TABLE OF CONTENTS|INDEX|ANNEXURE|APPENDIX)$/;
  const groups = new Map();
  for (const marker of markers) {
    const key = marker.header.toUpperCase().replace(/\s+/g, ' ');
    if (generic.test(key)) continue;
    if ((key.match(/[A-Z]/g) || []).length < 12) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(marker);
  }

  let best = null;
  for (const [header, group] of groups) {
    group.sort((a, b) => a.start - b.start);
    let increasing = true;
    for (let i = 1; i < group.length; i += 1) {
      if (group[i].page <= group[i - 1].page) increasing = false;
    }
    const span = group[group.length - 1].page - group[0].page;
    if (group.length >= 5 && increasing && span >= 5) {
      const candidate = { header, markers: group, span };
      if (!best || group.length > best.markers.length) best = candidate;
    }
  }

  if (!best) return { status: 'none', markers: [], evidence: null };
  const status = best.markers.length >= 8 ? 'continuous_footer' : 'partial_footer';
  return {
    status,
    markers: best.markers,
    evidence: `${best.markers.length} printed footers for "${best.header}" p.${best.markers[0].page}–p.${best.markers[best.markers.length - 1].page}`,
  };
}

export function pageForOffset(pageMap, offset) {
  if (!pageMap || pageMap.status === 'none') return { page_ref: null, page_ref_status: 'none', page_ref_evidence: null };
  let found = null;
  for (const marker of pageMap.markers) {
    if (marker.start <= offset) found = marker;
    else break;
  }
  if (!found) return { page_ref: null, page_ref_status: 'none', page_ref_evidence: null };
  return {
    page_ref: found.page,
    page_ref_status: 'verified_footer',
    page_ref_evidence: `${pageMap.evidence}; footer at offset ${found.start}`,
  };
}

const MODULE_LINE = /^(?:MODULE\s+NAME\s*:?|MODULE\s*:)\s*(.+)$/i;
const CODE_LINE = /\b([A-Z]{2,6}[- ]?\d{3,4})\b/;

/** Pulls the module name/edition the document states about itself. Not a module mapping. */
export function statedIdentity(text) {
  const head = text.slice(0, 4000);
  const lines = head.split('\n').map((line) => line.trim()).filter(Boolean);
  let statedModule = null;

  for (const line of lines.slice(0, 40)) {
    const match = line.match(MODULE_LINE);
    // "Module Guide" is the document type, not the module name.
    if (match && !/^(guide|study guide|module guide)$/i.test(match[2].trim())) {
      statedModule = match[2].trim();
      break;
    }
  }
  if (!statedModule) {
    const index = lines.findIndex((line) => /^module guide$/i.test(line));
    if (index > 0) {
      for (let i = index - 1; i >= Math.max(0, index - 4); i -= 1) {
        const candidate = lines[i];
        if (candidate.length >= 3 && candidate.length <= 90 && /^[A-Z0-9][A-Z0-9 &'’()\-–—:.,/]*$/.test(candidate)) {
          statedModule = candidate;
          break;
        }
      }
    }
  }

  const edition = (head.match(/copyright\s*©?\s*(\d{4})/i) || head.match(/©\s*(\d{4})/) || head.match(/\b(20\d{2})\b/)) || [];
  const code = (head.slice(0, 1200).match(CODE_LINE) || [])[1] || null;
  return {
    stated_module: statedModule || null,
    stated_edition: edition[1] || null,
    stated_code: code ? code.replace(/\s+/g, ' ').toUpperCase() : null,
  };
}

export function truncationFlags(text) {
  const flags = [];

  // Ignore trailing page footers and bare numbers before judging the ending.
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  let tail = '';
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i -= 1) {
    const line = lines[i];
    if (/^\d{1,3}$/.test(line) || PAGE_FOOTER.test(line)) continue;
    tail = line;
    break;
  }
  if (tail.length > 40 && /[a-z,;:\-–]$/.test(tail)) flags.push('text ends mid-sentence');

  const head = text.slice(0, 6000);
  if (/table of contents/i.test(head)) {
    const promised = head.match(/(?:bibliography|references)[^\n]{0,80}?(\d{1,3})\s*$/im);
    if (promised) {
      const pages = Number(promised[1]);
      if (pages >= 30 && text.length / pages < 800) {
        flags.push(`contents reference p.${pages} but the export averages ${Math.round(text.length / pages)} characters per page (possible truncation)`);
      }
    }
  }
  return flags;
}
