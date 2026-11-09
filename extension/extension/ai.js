// Answer suggestions for unmarked questions. Sends only the question, options and a few guide excerpts to the model.
const KCQAI = (() => {
  const norm = (text = '') => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const STOP = new Set('the and for are was were with that this from which what when does not you your have has had can will would should could into than then them they their there these those been being also only such'.split(' '));
  const tokens = (text) => norm(text).split(' ').filter((word) => word.length > 2 && !STOP.has(word));

  // Ignores spacing and punctuation, so "workers.b. It" and "workers. b. It" match.
  const squash = (text = '') => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
  function sameQuestion(a, b) {
    const x = squash(a);
    const y = squash(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const shorter = x.length < y.length ? x : y;
    const longer = x.length < y.length ? y : x;
    if (shorter.length >= 60 && longer.includes(shorter)) return true;
    const ta = new Set(tokens(a));
    const tb = new Set(tokens(b));
    const shared = [...ta].filter((t) => tb.has(t)).length;
    return ta.size > 0 && shared / Math.max(ta.size, tb.size) >= 0.9;
  }
  const CACHE_LIMIT = 300;
  const chunkMemo = new Map();

  // One chunk per paragraph (short headings join the paragraph after them) so excerpts stay tight.
  function chunkGuide(text, size = 700) {
    if (chunkMemo.has(text)) return chunkMemo.get(text);
    const chunks = [];
    let current = '';
    String(text).split(/\n\s*\n|\r\n\s*\r\n/).forEach((paragraph) => {
      const piece = paragraph.replace(/\s+/g, ' ').trim();
      if (!piece) return;
      if (current && current.length >= 80) { chunks.push(current); current = ''; }
      current = current ? `${current} ${piece}` : piece;
      while (current.length > size) { chunks.push(current.slice(0, size)); current = current.slice(size); }
    });
    if (current) chunks.push(current);
    chunkMemo.set(text, chunks);
    return chunks;
  }

  function topChunks(guideText, query, limit = 3) {
    const chunks = chunkGuide(guideText);
    if (!chunks.length) return [];
    const chunkTokens = chunks.map((chunk) => new Set(tokens(chunk)));
    const queryTokens = [...new Set(tokens(query))];
    const weight = (word) => {
      const df = chunkTokens.filter((set) => set.has(word)).length;
      return df ? Math.log(1 + chunks.length / df) : 0;
    };
    return chunks
      .map((chunk, i) => ({ chunk, score: queryTokens.reduce((sum, word) => sum + (chunkTokens[i].has(word) ? weight(word) : 0), 0) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.chunk.slice(0, 900));
  }

  function guideFor(guides, moduleName) {
    const target = norm(moduleName);
    const names = Object.keys(guides || {});
    const key = names.find((name) => norm(name) === target) || names.find((name) => target.includes(norm(name)) || norm(name).includes(target));
    return key ? guides[key] : '';
  }

  // Passages come from the shared guide library when it is reachable, and from
  // any locally stored guide text otherwise.
  function normalizeExcerpt(row = {}) {
    return {
      text: String(row.text || row.chunk_text || ''),
      title: row.title || null,
      section: row.heading || row.section || null,
      pageRef: Number.isInteger(row.page_ref) ? row.page_ref : null,
      completeness: row.completeness || null,
      sourceId: row.source_id || null,
    };
  }

  async function findExcerpts(deps, moduleName, query) {
    let libraryError = null;
    if (typeof deps.getExcerpts === 'function') {
      try {
        const rows = await deps.getExcerpts({ moduleName, query, limit: 4 });
        const found = (rows || []).map(normalizeExcerpt).filter((row) => row.text);
        if (found.length) return { excerpts: found, source: 'library' };
      } catch (error) {
        // Keep the reason: a silent fallback looks identical to "no material".
        libraryError = error.message || String(error);
      }
    }
    const local = topChunks(guideFor(await deps.getGuides?.(), moduleName), query);
    return {
      excerpts: local.map((text) => normalizeExcerpt({ text })),
      source: local.length ? 'local' : 'none',
      libraryError,
    };
  }

  function excerptLabel(excerpt, index) {
    const parts = [excerpt.title || 'Saved guide'];
    if (excerpt.section) parts.push(excerpt.section);
    if (excerpt.pageRef) parts.push(`p. ${excerpt.pageRef}`);
    return `[${index + 1}] ${parts.join(' — ')}: ${excerpt.text}`;
  }

  // No model needed: score each option against the retrieved passages and pick
  // the one the guide actually supports. Used when the AI endpoint is missing
  // or unreachable, so the panel still shows a best option.
  function pickFromGuide(question, excerpts) {
    const texts = excerpts.map((excerpt) => excerpt.text).filter(Boolean);
    if (!texts.length) return null;

    const bag = texts.join(' ').toLowerCase();
    const chunkSets = texts.map((text) => new Set(tokens(text)));
    const df = new Map();
    chunkSets.forEach((set) => set.forEach((word) => df.set(word, (df.get(word) || 0) + 1)));
    const idf = (word) => Math.log(1 + texts.length / (df.get(word) || texts.length));

    const bigrams = (text) => {
      const words = String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
      return words.slice(1).map((word, i) => `${words[i]} ${word}`);
    };

    const scored = question.options.map((option) => {
      const words = [...new Set(tokens(option.text))];
      const hits = words.filter((word) => df.has(word));
      const phraseHits = bigrams(option.text).filter((gram) => bag.includes(gram));
      let score = hits.reduce((sum, word) => sum + idf(word) * (word.length >= 8 ? 1.5 : 1), 0);
      score += phraseHits.length * 2.5;
      return {
        letter: option.letter,
        text: option.text,
        hits: hits.length,
        phrases: phraseHits.length,
        words: words.length,
        score: score ? score / Math.sqrt(words.length || 1) : 0,
      };
    }).sort((a, b) => b.score - a.score);

    const [best, second] = scored;
    // No overlap with the guide at all: nothing to base a verdict on.
    if (!best || best.score <= 0) return null;

    const margin = second && second.score > 0 ? best.score / second.score : 3;
    const strong = best.hits >= 2 && (best.phrases > 0 || best.hits >= 3) && margin >= 1.6;
    return {
      letter: best.letter,
      optionText: best.text,
      confidence: strong ? 'medium' : 'low',
      // A weak match is still a verdict, but it is labelled so it can be checked.
      weak: !strong,
      source: 'guide-match',
      margin: Number(margin.toFixed(2)),
    };
  }

  function buildPrompt({ text, options }, excerpts = []) {
    const reference = excerpts.length ? excerpts.map(excerptLabel).join('\n') : '(none)';
    const partial = excerpts.some((excerpt) => excerpt.completeness === 'partial');
    return [
      'Reference excerpts (primary source):', reference, '',
      ...(partial ? ['Some excerpts come from an incomplete export of the guide. Do not state that the full guide lacks a topic just because it is missing here.', ''] : []),
      `Question: ${text}`, 'Options:',
      ...options.map((option) => `${option.letter}. ${option.text}`), '',
      'Statement labels inside the question (a, b, i, ii...) are not answer choices. Choose one option letter.',
      'Reply with exactly one of: LETTER|high, LETTER|medium, UNSURE.',
      'Use the reference excerpts first. Reply UNSURE if neither they nor well-established knowledge supports one option.',
    ].join('\n');
  }

  // Free models are chattier than paid ones, so accept the LETTER|CONFIDENCE
  // pair anywhere in the reply as long as the letter is a real option.
  function parseReply(reply, letters) {
    const match = String(reply).trim().toUpperCase().match(/(?:^|[^A-Z])([A-Z])\s*\|\s*(HIGH|MEDIUM)\b/);
    if (!match || !letters.includes(match[1])) return null;
    return { letter: match[1], confidence: match[2].toLowerCase() };
  }

  function comboSet(text) {
    const raw = String(text).toLowerCase();
    const roman = raw.match(/\b(viii|vii|iii|ii|iv|ix|vi|i|v|x)\b/g);
    if (roman?.length && /only|,|\band\b/.test(raw)) return new Set(roman);
    if (/^[a-z](\s*,\s*[a-z])*$/i.test(raw.trim())) return new Set(raw.match(/\b[a-z]\b/g) || []);
    return null;
  }

  function bestRemaining(questionText, options, remaining) {
    const texts = options.map((option) => option.text);
    const combo = texts.length > 0 && texts.every((text) => comboSet(text));
    const questionTokens = new Set(tokens(questionText));
    const scoreOf = (option) => {
      if (combo) {
        const mine = comboSet(option.text);
        return texts.filter((other) => norm(other) !== norm(option.text))
          .reduce((sum, other) => sum + [...comboSet(other)].filter((part) => mine.has(part)).length, 0);
      }
      const words = tokens(option.text);
      return words.length ? words.filter((word) => questionTokens.has(word)).length / words.length : 0;
    };
    return remaining.slice().sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  }

  // Confirmed answers win. Otherwise drop known-wrong options and pick the remaining / most likely one.
  function fromKnown(question, row) {
    if (!row) return null;
    const { text, options } = question;
    const wrongKeys = new Set((row.wrong || []).map(norm));
    const eliminated = options.filter((option) => option.text && wrongKeys.has(norm(option.text)));
    const withEliminated = (result) => (eliminated.length ? { ...result, eliminated } : result);

    if (row.answer) {
      const savedOption = options.find((option) => norm(option.text) === norm(row.answer));
      if (savedOption) return withEliminated({ letter: savedOption.letter, confidence: 'high', source: 'saved' });
    }

    const remaining = options.filter((option) => option.text && !wrongKeys.has(norm(option.text)));
    if (!eliminated.length || remaining.length < 1) return null;
    if (remaining.length === 1) {
      return withEliminated({ letter: remaining[0].letter, confidence: 'high', source: 'elimination' });
    }
    const best = bestRemaining(text, options, remaining);
    return best ? withEliminated({ letter: best.letter, confidence: 'medium', source: 'guess' }) : null;
  }

  async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // deps: getGuides(), getBank(), callModel(prompt), cacheGet(), cacheSet(map)
  function createAnswerer(deps) {
    const inflight = new Map();

    async function resolve({ moduleName, question, force }) {
      const { text, options } = question;
      if (!text || options.length < 2) return { needsChecking: true, reason: 'Incomplete question.' };
      const letters = options.map((option) => option.letter);

      // Images/diagrams are ignored. The extracted stem text is used for saved matches and optional AI.
      const bank = (await deps.getBank?.()) || [];
      const known = fromKnown(question, bank.find((row) => sameQuestion(row.question, text)));
      if (known) return known;

      const { excerpts, source: evidence, libraryError } = await findExcerpts(deps, moduleName, `${text} ${options.map((option) => option.text).join(' ')}`);
      const citations = excerpts.map(({ title, section, pageRef, sourceId, completeness }) => ({ title, section, pageRef, sourceId, completeness }));
      const extra = libraryError ? { libraryError } : {};
      const prompt = buildPrompt(question, excerpts);
      const key = await sha256(prompt);

      const cache = await deps.cacheGet();
      if (!force && key in cache) {
        return cache[key]
          ? { ...cache[key], source: 'cache', citations, evidence, ...extra }
          : { needsChecking: true, reason: 'Not enough evidence.', source: 'cache', citations, evidence, ...extra };
      }

      const parsed = await (async () => {
        try {
          return parseReply(await deps.callModel(prompt), letters);
        } catch (error) {
          // No model (or it failed): still name the best option from the guide.
          return { error };
        }
      })();
      if (parsed?.error) {
        const picked = pickFromGuide(question, excerpts);
        if (picked) return { ...picked, citations, evidence, modelError: parsed.error.message, ...extra };
        return { needsChecking: true, reason: parsed.error.message, citations, evidence, ...extra };
      }
      delete cache[key];
      cache[key] = parsed;
      Object.keys(cache).slice(0, Math.max(0, Object.keys(cache).length - CACHE_LIMIT)).forEach((old) => delete cache[old]);
      await deps.cacheSet(cache);
      return parsed
        ? { ...parsed, source: 'ai', citations, evidence, ...extra }
        : { needsChecking: true, reason: 'Not enough evidence.', citations, evidence, ...extra };
    }

    // One request per unchanged question at any time; no automatic retries.
    async function answer(payload) {
      const id = `${payload.moduleName}|${norm(payload.question.text)}|${payload.question.options.map((o) => norm(o.text)).join('|')}`;
      if (inflight.has(id)) return inflight.get(id);
      const promise = resolve(payload)
        .catch((error) => ({ needsChecking: true, reason: error.message }))
        .finally(() => inflight.delete(id));
      inflight.set(id, promise);
      return promise;
    }

    return { answer };
  }

  return { createAnswerer, chunkGuide, topChunks, guideFor, buildPrompt, parseReply, sameQuestion, fromKnown };
})();
