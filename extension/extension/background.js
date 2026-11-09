importScripts('shared.js', 'ai.js');

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

let bankCache = { rows: null, at: 0 };
const getBank = async () => {
  if (!bankCache.rows || Date.now() - bankCache.at > 10 * 60 * 1000) {
    bankCache = { rows: await KCQ.loadAll().catch(() => []), at: Date.now() };
  }
  return bankCache.rows;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One model, one retry. Free providers drop connections and 429 under load.
async function askModel({ endpoint, key, model, prompt }) {
  const isOpenRouter = /openrouter\.ai/i.test(endpoint);
  const body = JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 64,
    // OpenRouter's free tier is mostly reasoning models; disabling reasoning is
    // what makes them return the letter instead of spending every token thinking.
    ...(isOpenRouter ? { reasoning: { enabled: false } } : {}),
    messages: [{ role: 'user', content: prompt }],
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const last = attempt === 1;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        if (response.status === 429 && !last) { await sleep(900); continue; }
        if (response.status === 429) throw new Error(`${model}: rate-limited (429)`);
        throw new Error(`${model}: request failed (${response.status})`);
      }
      const data = await response.json();
      return data?.choices?.[0]?.message?.content || '';
    } catch (error) {
      const retriable = /fetch failed|network|socket|aborted|timeout/i.test(error.message || '');
      if (!last && retriable) { await sleep(700); continue; }
      throw error;
    }
  }
  return '';
}

// Model may be a comma-separated priority list. Free models fail one by one
// (429, dropped connection, empty content), so fall through until one answers.
const FREE_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const FREE_MODELS = 'dots-studio/dots-3-note-preview:free, nvidia/nemotron-3.5-lightning:free, google/gemma-4-31b-it:free';

async function callModel(prompt) {
  const stored = await chrome.storage.local.get(['aiEndpoint', 'aiKey', 'aiModel']);
  const aiEndpoint = stored.aiEndpoint || FREE_ENDPOINT;
  const aiKey = stored.aiKey;
  const aiModel = stored.aiModel || FREE_MODELS;
  if (!aiKey) throw new Error('Add a free API key in Options to get AI answers.');

  const models = String(aiModel).split(',').map((entry) => entry.trim()).filter(Boolean).slice(0, 4);
  const failures = [];
  for (const model of models) {
    try {
      const content = await askModel({ endpoint: aiEndpoint, key: aiKey, model, prompt });
      if (content && content.trim()) return content;
      failures.push(`${model}: empty reply`);
    } catch (error) {
      failures.push(error.message);
    }
  }
  throw new Error(failures[0] || 'No model answered.');
}

const answerer = KCQAI.createAnswerer({
  getGuides: async () => (await chrome.storage.local.get('guides')).guides || {},
  getExcerpts: (payload) => KCQ.searchGuidePassages(payload),
  getBank,
  callModel,
  cacheGet: async () => (await chrome.storage.local.get('aiCache')).aiCache || {},
  cacheSet: (aiCache) => chrome.storage.local.set({ aiCache }),
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'answer') {
    answerer.answer(message).then(sendResponse);
    return true;
  }
  if (message?.type === 'load') {
    KCQ.loadAll()
      .then((rows) => sendResponse({ ok: true, rows }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== 'save') return false;
  KCQ.saveQuestions(message.moduleName, message.items)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
