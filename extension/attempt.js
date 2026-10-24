// Runs on unmarked quiz attempt pages: shows a suggested answer letter per question. Answering and submitting stay manual.
(() => {
  const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  // Diagrams are ignored; matching and suggestions use only the stem text around them.
  function questionText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('img, object, svg, canvas, video').forEach((node) => node.replaceWith(' '));
    return textOf(clone);
  }

  function parseAttemptQuestions(root = document) {
    return [...root.querySelectorAll('.que.multichoice')]
      .filter((que) => !/\b(correct|incorrect|partiallycorrect)\b/.test(que.className))
      .map((que, index) => {
        const qtext = que.querySelector('.qtext');
        const rawOptions = [...que.querySelectorAll('.answer > div')].map((el) => {
          const label = (el.querySelector('label') || el).cloneNode(true);
          const marker = textOf(label.querySelector('.answernumber')).replace(/[.)\s]/g, '');
          label.querySelectorAll('.answernumber, input').forEach((node) => node.remove());
          return { marker, text: textOf(label), hasImage: Boolean(el.querySelector('img')) };
        }).filter((option) => option.text || option.hasImage);

        // Final choice letters come from the option labels; statement labels in the question text are never used.
        const markers = rawOptions.map((option) => option.marker.toUpperCase());
        const usable = markers.every((m) => /^[A-Z]$/.test(m)) && new Set(markers).size === markers.length;
        const options = rawOptions.map((option, i) => ({ letter: usable ? markers[i] : String.fromCharCode(65 + i), text: option.text }));

        return {
          number: textOf(que.querySelector('.qno')) || String(index + 1),
          el: que,
          text: questionText(qtext),
          options,
          hasImage: Boolean(qtext?.querySelector('img')) || rawOptions.some((option) => option.hasImage),
        };
      });
  }
  window.KCQAttempt = { parseAttemptQuestions };

  const attemptId = new URLSearchParams(location.search).get('attempt') || 'unknown';
  const storeKey = `kcqAttempt:${attemptId}`;
  const moduleName = textOf(document.querySelector('.page-header-headings h1, #page-header h1, h1')) || document.title.split(':')[0].trim();
  const signature = (q) => `${q.text}|${q.options.map((o) => `${o.letter}${o.text}`).join('|')}`;

  let state = {};
  let currentNumber = '';
  const pending = new Set();
  const visibleHeights = new Map();
  const bySignature = new Map();

  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    * { font: 14px system-ui, sans-serif; box-sizing: border-box; }
    .box { background: #fff; color: #1f2937; border: 1px solid #d1d5db; border-radius: 10px; padding: 10px; margin-top: 12px; }
    h3 { margin: 0 0 6px; font-size: 14px; }
    .line { margin: 4px 0; }
    .line.current { font-weight: 700; }
    .letter { color: #166534; font-weight: 700; }
    .needs { color: #b45309; font-weight: 700; }
    small { color: #6b7280; font-weight: 400; }
    button { margin-left: 6px; font-size: 12px; cursor: pointer; }
  </style><div class="box"><h3>KCQ suggested answers</h3><div class="list"></div></div>`;
  const nav = document.querySelector('#mod_quiz_navblock, .block_quiz_navigation');
  if (nav) nav.after(host);
  else { host.style.cssText = 'position:fixed;top:70px;right:16px;width:260px;z-index:99998'; document.body.append(host); }
  const listEl = root.querySelector('.list');

  const save = () => chrome.storage.local.set({ [storeKey]: state });

  function render() {
    listEl.replaceChildren();
    Object.keys(state).sort((a, b) => Number(a) - Number(b)).forEach((number) => {
      const entry = state[number];
      const line = document.createElement('div');
      line.className = `line${number === currentNumber ? ' current' : ''}`;
      const label = document.createElement('span');
      label.textContent = `Question ${number}: `;
      const value = document.createElement('span');
      const detail = document.createElement('small');

      if (entry.pending) { value.textContent = '...'; }
      else if (entry.needsChecking) {
        value.className = 'needs';
        value.textContent = 'Needs checking';
        detail.textContent = ` ${entry.reason || ''}`;
      } else {
        value.className = 'letter';
        value.textContent = entry.letter;
        const eliminated = (entry.eliminated || []).map((option) => option.letter).join(', ');
        const via = entry.source === 'saved' ? ' (KCQ Cloud)'
          : entry.source === 'elimination' ? ' (only one left)'
            : entry.source === 'guess' || entry.confidence === 'medium' ? ' (likely)' : '';
        const not = eliminated ? `; not ${eliminated}` : '';
        detail.textContent = ` ${entry.optionText.slice(0, 60)}${via}${not}`;
      }
      line.append(label, value, detail);
      if (entry.needsChecking && bySignature.has(number)) {
        const retry = document.createElement('button');
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => ask(bySignature.get(number), true));
        line.append(retry);
      }
      listEl.append(line);
    });
  }

  function ask(question, force = false) {
    const sig = signature(question);
    bySignature.set(question.number, question);
    const existing = state[question.number];
    if (!force && (pending.has(question.number) || existing?.sig === sig)) return;

    pending.add(question.number);
    state[question.number] = { sig, pending: true };
    render();
    chrome.runtime.sendMessage({
      type: 'answer', moduleName, force,
      question: { text: question.text, options: question.options, hasImage: question.hasImage },
    }, (response) => {
      pending.delete(question.number);
      if (!response || response.needsChecking) {
        state[question.number] = { sig, needsChecking: true, reason: response?.reason || chrome.runtime.lastError?.message || 'No response.' };
      } else {
        const option = question.options.find((o) => o.letter === response.letter);
        state[question.number] = {
          sig,
          letter: response.letter,
          optionText: option?.text || '',
          confidence: response.confidence,
          source: response.source,
          eliminated: response.eliminated || [],
        };
      }
      save();
      render();
    });
  }

  const observed = new WeakSet();
  const byElement = new Map();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const question = byElement.get(entry.target);
      if (!question) return;
      if (entry.isIntersecting && entry.intersectionRect.height >= Math.min(120, entry.boundingClientRect.height)) {
        visibleHeights.set(question.number, entry.intersectionRect.height);
        ask(question);
      } else {
        visibleHeights.delete(question.number);
      }
    });
    currentNumber = [...visibleHeights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || currentNumber;
    render();
  }, { threshold: [0, 0.25, 0.5, 0.75] });

  function scan() {
    parseAttemptQuestions().forEach((question) => {
      byElement.set(question.el, question);
      bySignature.set(question.number, question);
      if (!observed.has(question.el)) { observed.add(question.el); observer.observe(question.el); }
    });
  }

  chrome.storage.local.get(storeKey).then((stored) => {
    state = stored[storeKey] || {};
    Object.keys(state).forEach((number) => { if (state[number].pending) delete state[number]; });
    render();
    scan();
  });

  let scanTimer;
  new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
})();
