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

  function buildPrompt({ text, options }, excerpts) {
    const reference = excerpts.length ? excerpts.map((excerpt, i) => `[${i + 1}] ${excerpt}`).join('\n') : '(none)';
    return [
      'Reference excerpts (primary source):', reference, '',
      `Question: ${text}`, 'Options:',
      ...options.map((option) => `${option.letter}. ${option.text}`), '',
      'Statement labels inside the question (a, b, i, ii...) are not answer choices. Choose one option letter.',
      'Reply with exactly one of: LETTER|high, LETTER|medium, UNSURE.',
      'Use the reference first. Reply UNSURE if neither it nor well-established knowledge supports one option.',
    ].join('\n');
  }

  function parseReply(reply, letters) {
    const match = String(reply).trim().toUpperCase().match(/^([A-Z])\s*\|\s*(HIGH|MEDIUM)\b/);
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

      const excerpts = topChunks(guideFor(await deps.getGuides(), moduleName), `${text} ${options.map((o) => o.text).join(' ')}`);
      const prompt = buildPrompt(question, excerpts);
      const key = await sha256(prompt);

      const cache = await deps.cacheGet();
      if (!force && key in cache) {
        return cache[key] ? { ...cache[key], source: 'cache' } : { needsChecking: true, reason: 'Not enough evidence.', source: 'cache' };
      }

      const parsed = parseReply(await deps.callModel(prompt), letters);
      delete cache[key];
      cache[key] = parsed;
      Object.keys(cache).slice(0, Math.max(0, Object.keys(cache).length - CACHE_LIMIT)).forEach((old) => delete cache[old]);
      await deps.cacheSet(cache);
      return parsed ? { ...parsed, source: 'ai' } : { needsChecking: true, reason: 'Not enough evidence.' };
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
