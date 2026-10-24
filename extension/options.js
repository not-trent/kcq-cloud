const url = document.getElementById('url');
const key = document.getElementById('key');
const status = document.getElementById('status');

chrome.storage.local.get(['supabaseUrl', 'anonKey']).then((stored) => {
  url.value = stored.supabaseUrl || KCQ.DEFAULTS.supabaseUrl;
  key.value = stored.anonKey || KCQ.DEFAULTS.anonKey;
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ supabaseUrl: url.value.trim(), anonKey: key.value.trim() });
  status.textContent = 'Saved.';
});

const $ = (id) => document.getElementById(id);

chrome.storage.local.get(['aiEndpoint', 'aiModel', 'aiKey']).then((stored) => {
  $('aiEndpoint').value = stored.aiEndpoint || '';
  $('aiModel').value = stored.aiModel || '';
  $('aiKey').value = stored.aiKey || '';
});

$('saveAi').addEventListener('click', async () => {
  const endpoint = $('aiEndpoint').value.trim();
  try {
    const granted = await chrome.permissions.request({ origins: [`${new URL(endpoint).origin}/*`] });
    if (!granted) { $('aiStatus').textContent = 'Permission for that endpoint was denied.'; return; }
  } catch {
    $('aiStatus').textContent = 'Enter a valid https:// endpoint.';
    return;
  }
  await chrome.storage.local.set({ aiEndpoint: endpoint, aiModel: $('aiModel').value.trim(), aiKey: $('aiKey').value.trim() });
  $('aiStatus').textContent = 'Saved.';
});

async function renderGuides() {
  const { guides = {} } = await chrome.storage.local.get('guides');
  $('guideList').replaceChildren(...Object.keys(guides).map((name) => {
    const item = document.createElement('li');
    item.textContent = `${name} (${guides[name].length} characters) `;
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      delete guides[name];
      await chrome.storage.local.set({ guides });
      renderGuides();
    });
    item.append(remove);
    return item;
  }));
}

$('guideFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $('guideText').value = await file.text();
  if (!$('guideName').value) $('guideName').value = file.name.replace(/\.[^.]+$/, '');
});

$('saveGuide').addEventListener('click', async () => {
  const name = $('guideName').value.trim();
  const text = $('guideText').value.trim();
  if (!name || !text) return;
  const { guides = {} } = await chrome.storage.local.get('guides');
  guides[name] = text;
  await chrome.storage.local.set({ guides });
  $('guideName').value = '';
  $('guideText').value = '';
  renderGuides();
});

renderGuides();
