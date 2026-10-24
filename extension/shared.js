// Shared Supabase REST helpers; loaded by the background worker and the side panel.
const KCQ = (() => {
  const DEFAULTS = {
    supabaseUrl: 'https://ewcworrjwtjtmkekddbq.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3Y3dvcnJqd3RqdG1rZWtkZGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjA4NjcsImV4cCI6MjEwNTgzNjg2N30.pouenhxDfoL4vDCzJGJ2wUKstIMcDeFym1fNk4xDysg',
  };
  const norm = (text = '') => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  async function credentials() {
    const stored = await chrome.storage.local.get(['supabaseUrl', 'anonKey']);
    return {
      supabaseUrl: stored.supabaseUrl || DEFAULTS.supabaseUrl,
      anonKey: stored.anonKey || DEFAULTS.anonKey,
    };
  }

  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const { supabaseUrl, anonKey } = await credentials();
    if (!supabaseUrl || !anonKey) throw new Error('Open the extension options and enter your Supabase URL and anon key.');
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
      method,
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function hashQuestion(question) {
    const bytes = new TextEncoder().encode(norm(question));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Wrong picks live in ocr_text as JSON so no schema change is needed.
  const readWrong = (row) => {
    try { return JSON.parse(row?.ocr_text || '{}').wrong || []; } catch { return []; }
  };

  function merge(row, item) {
    const wrong = readWrong(row);
    let answer = row?.answer || '';
    const picked = item.picked.join(' | ');

    if (picked && item.score === 'correct') answer = picked;
    if (picked && item.score === 'wrong' && !wrong.some((w) => norm(w) === norm(picked))) wrong.push(picked);

    // Three known-wrong options leave the fourth as the answer.
    if (!answer && item.options.length >= 3) {
      const wrongKeys = new Set(wrong.map(norm));
      const remaining = item.options.filter((option) => !wrongKeys.has(norm(option)));
      if (remaining.length === 1) answer = remaining[0];
    }

    return {
      question: item.question,
      answer,
      options: row?.options?.length ? row.options : item.options,
      status: answer ? 'correct' : wrong.length ? 'incorrect' : 'unreviewed',
      ocr_text: JSON.stringify({ wrong }),
      uploaded_by: 'Moodle helper',
    };
  }

  async function findOrCreateModule(name) {
    const found = await api(`modules?select=id,name,slug&name=ilike.${encodeURIComponent(name.replace(/[%*]/g, ''))}`);
    if (found.length) return found[0];
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'module';
    const [created] = await api('modules', { method: 'POST', body: { name, slug }, headers: { Prefer: 'return=representation' } });
    return created;
  }

  async function saveQuestions(moduleName, items) {
    const module = await findOrCreateModule(moduleName);
    const hashes = await Promise.all(items.map((item) => hashQuestion(item.question)));
    const existing = await api(`questions?select=id,answer,options,ocr_text,image_hash&module_id=eq.${module.id}&image_hash=in.(${hashes.join(',')})`);
    const byHash = new Map(existing.map((row) => [row.image_hash, row]));

    // Repeats inside one save collapse into a single row.
    const merged = new Map();
    items.forEach((item, i) => {
      merged.set(hashes[i], merge(merged.get(hashes[i]) || byHash.get(hashes[i]), item));
    });

    const inserts = [];
    const patches = [];
    merged.forEach((data, hash) => {
      const row = byHash.get(hash);
      if (row) patches.push(api(`questions?id=eq.${row.id}`, { method: 'PATCH', body: data }));
      else inserts.push({ ...data, module_id: module.id, image_hash: hash });
    });
    await Promise.all(patches);
    const updated = patches.length;
    if (inserts.length) await api('questions', { method: 'POST', body: inserts });
    return { moduleName: module.name, added: inserts.length, updated };
  }

  async function loadAll() {
    const modules = await api('modules?select=id,name');
    const names = new Map(modules.map((m) => [m.id, m.name]));
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const page = await api('questions?select=id,module_id,question,answer,options,ocr_text,image_path&question=neq.', {
        headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
      });
      rows.push(...page);
      if (page.length < 1000) break;
    }
    // Rows with an image_path are old screenshot/OCR uploads with unreliable text.
    return rows
      .filter((row) => !row.image_path)
      .map((row) => ({ ...row, moduleName: names.get(row.module_id) || '', wrong: readWrong(row) }));
  }

  function search(rows, query) {
    const queryKey = norm(query);
    if (queryKey.length < 2) return [];
    const tokens = queryKey.split(' ');
    const results = [];
    rows.forEach((row) => {
      const key = norm(row.question);
      let score = 0;
      if (key.startsWith(queryKey)) score = 100;
      else if (key.includes(queryKey)) score = 80;
      else {
        const keyTokens = new Set(key.split(' '));
        const hits = tokens.filter((token) => keyTokens.has(token)).length;
        if (hits / tokens.length >= 0.6) score = 60 * (hits / tokens.length);
      }
      if (score > 0) results.push({ score, row });
    });
    return results
      .sort((a, b) => Number(Boolean(b.row.answer)) - Number(Boolean(a.row.answer)) || b.score - a.score)
      .slice(0, 8)
      .map((r) => r.row);
  }

  // Best guess for unconfirmed questions: never stored, only shown. Rules out known-wrong picks first.
  function suggest(row) {
    if (row.answer || !row.options?.length) return null;
    const wrongKeys = new Set((row.wrong || []).map(norm));
    const remaining = row.options.filter((option) => !wrongKeys.has(norm(option)));
    if (!remaining.length) return null;

    const comboSet = (option) => {
      const raw = String(option).toLowerCase();
      const roman = raw.match(/\b(viii|vii|iii|ii|iv|ix|vi|i|v|x)\b/g);
      if (roman?.length && /only|,|\band\b/.test(raw)) return new Set(roman);
      if (/^[a-z](\s*,\s*[a-z])*$/i.test(raw.trim())) return new Set(raw.match(/\b[a-z]\b/g) || []);
      return null;
    };
    const isCombo = row.options.every((option) => comboSet(option));
    const letters = (option) => comboSet(option) || new Set();
    const questionTokens = new Set(norm(row.question).split(' '));

    // Combination options: distractors are usually built around the true answer, so the most-shared one wins.
    const scoreOf = (option) => {
      if (isCombo) {
        const mine = letters(option);
        return row.options.filter((other) => other !== option)
          .reduce((sum, other) => sum + [...letters(other)].filter((l) => mine.has(l)).length, 0);
      }
      const tokens = norm(option).split(' ').filter(Boolean);
      return tokens.length ? tokens.filter((t) => questionTokens.has(t)).length / tokens.length : 0;
    };

    const best = remaining.map((option) => ({ option, score: scoreOf(option) })).sort((a, b) => b.score - a.score)[0];
    return { option: best.option, remaining: remaining.length };
  }

  return { saveQuestions, loadAll, search, suggest, DEFAULTS, credentials };
})();
