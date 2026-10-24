// Runs on Moodle quiz review pages: reads each multiple-choice question and sends it to KCQ Cloud.
const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

// Diagrams are ignored; only the visible stem text around them is saved and matched.
function questionText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('img, object, svg, canvas, video').forEach((node) => node.replaceWith(' '));
  return textOf(clone);
}

function parseOption(el) {
  const input = el.querySelector('input[type=radio], input[type=checkbox]');
  const label = (el.querySelector('label') || el).cloneNode(true);
  label.querySelectorAll('.answernumber, input').forEach((node) => node.remove());
  return { text: textOf(label).replace(/^[a-z]\.\s+/i, ''), checked: Boolean(input?.checked) };
}

function parseScore(que) {
  const grade = textOf(que.querySelector('.grade')).match(/([\d.,]+)\s*out of\s*([\d.,]+)/i);
  if (grade) {
    const got = parseFloat(grade[1].replace(',', '.'));
    const max = parseFloat(grade[2].replace(',', '.'));
    if (max > 0) return got >= max ? 'correct' : got === 0 ? 'wrong' : 'partial';
  }
  const state = textOf(que.querySelector('.state')).toLowerCase();
  if (state === 'correct') return 'correct';
  if (state === 'incorrect') return 'wrong';
  return null;
}

function parseQuestions() {
  return [...document.querySelectorAll('.que.multichoice')].map((que) => {
    const question = questionText(que.querySelector('.qtext'));
    const options = [...que.querySelectorAll('.answer > div')].map(parseOption).filter((o) => o.text);
    if (!question || !options.length) return null;
    return {
      question,
      options: options.map((o) => o.text),
      picked: options.filter((o) => o.checked).map((o) => o.text),
      score: parseScore(que),
    };
  }).filter(Boolean);
}

function detectModuleName() {
  const heading = document.querySelector('.page-header-headings h1, #page-header h1, h1');
  return textOf(heading) || document.title.split(':')[0].trim();
}

function addButton() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;font:14px system-ui,sans-serif;display:grid;gap:6px;justify-items:start';
  const status = document.createElement('div');
  status.style.cssText = 'background:#111827;color:#fff;padding:6px 10px;border-radius:6px;max-width:320px;display:none';
  const button = document.createElement('button');
  button.textContent = 'Save to KCQ Cloud';
  button.style.cssText = 'background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 14px;cursor:pointer;font:inherit';
  box.append(status, button);
  document.body.append(box);

  const say = (text) => { status.textContent = text; status.style.display = 'block'; };

  button.addEventListener('click', () => {
    const items = parseQuestions();
    if (!items.length) { say('No multiple-choice questions found on this page.'); return; }

    const moduleName = window.prompt(`Save ${items.length} question(s) to which module?`, detectModuleName());
    if (!moduleName?.trim()) return;

    button.disabled = true;
    say('Saving...');
    const giveUp = setTimeout(() => {
      button.disabled = false;
      say('No response from the extension. Reload the extension and this page, then try again.');
    }, 30000);
    chrome.runtime.sendMessage({ type: 'save', moduleName: moduleName.trim(), items }, (response) => {
      clearTimeout(giveUp);
      button.disabled = false;
      if (!response?.ok) { say(`Failed: ${response?.error || chrome.runtime.lastError?.message}`); return; }
      const paged = document.querySelector('a[href*="showall=1"]') ? ' This page is only part of the quiz; use "Show all questions on one page" and save again.' : '';
      say(`Saved to "${response.moduleName}": ${response.added} new, ${response.updated} updated.${paged}`);
    });
  });
}

function addLookupBubble() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;text-align:right';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font: 14px system-ui, sans-serif; }
      .toggle { background: #166534; color: #fff; border: 0; border-radius: 999px; padding: 10px 14px; cursor: pointer; }
      .panel { display: none; text-align: left; width: 340px; max-height: 70vh; overflow: auto; background: #fff; color: #1f2937; border: 1px solid #d1d5db; border-radius: 10px; padding: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.2); margin-bottom: 8px; }
      .panel.open { display: block; }
      input { width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; margin-top: 8px; }
      small, .muted { color: #6b7280; }
      .q { margin: 4px 0; font-weight: 600; }
      .a { margin: 4px 0; color: #166534; font-size: 16px; font-weight: 700; }
      .u { margin: 4px 0; color: #b45309; }
      .g { margin: 4px 0; color: #1d4ed8; font-weight: 600; }
    </style>
    <div class="panel"><input placeholder="First words of the question..."><div class="status muted"></div><div class="results"></div></div>
    <button class="toggle" title="Alt+K">KCQ</button>`;
  document.body.append(host);

  const panel = root.querySelector('.panel');
  const input = root.querySelector('input');
  const statusEl = root.querySelector('.status');
  const resultsEl = root.querySelector('.results');
  let rows = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  };

  const render = () => {
    resultsEl.replaceChildren();
    if (!rows) return;
    const found = KCQ.search(rows, input.value);
    if (input.value.trim().length >= 2 && !found.length) resultsEl.append(el('p', 'muted', 'No match.'));
    found.forEach((row) => {
      const card = el('div', 'card', '');
      card.append(el('small', '', row.moduleName), el('p', 'q', row.question));
      card.append(row.answer
        ? el('p', 'a', `Answer: ${row.answer}`)
        : el('p', 'u', `Answer not confirmed${row.wrong.length ? ` — wrong: ${row.wrong.join(' / ')}` : ''}`));
      const guess = KCQ.suggest(row);
      if (guess) {
        const how = guess.remaining === 1 ? 'only option left after eliminating wrong picks' : `most likely of ${guess.remaining} left after eliminating wrong picks`;
        card.append(el('p', 'g', `Likely answer: ${guess.option} (${how})`));
      }
      resultsEl.append(card);
    });
  };

  const load = () => {
    statusEl.textContent = 'Loading...';
    chrome.runtime.sendMessage({ type: 'load' }, (response) => {
      if (!response?.ok) { statusEl.textContent = response?.error || chrome.runtime.lastError?.message || 'Could not load.'; return; }
      rows = response.rows;
      statusEl.textContent = `${rows.length} questions loaded.`;
      render();
    });
  };

  const toggle = () => {
    panel.classList.toggle('open');
    if (!panel.classList.contains('open')) return;
    const selected = String(getSelection()).trim();
    if (selected) input.value = selected.slice(0, 200);
    if (!rows) load(); else render();
    input.focus();
  };

  root.querySelector('.toggle').addEventListener('click', toggle);
  input.addEventListener('input', render);
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggle(); }
  });
}

if (location.pathname.endsWith('/review.php')) addButton();
addLookupBubble();
