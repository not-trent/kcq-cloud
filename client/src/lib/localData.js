const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4010';

function normalizeModule(module) {
  const entries = Array.isArray(module.entries) ? module.entries : [];

  return {
    id: module.id,
    name: module.name,
    slug: module.slug || module.name,
    createdAt: module.createdAt || module.created_at,
    entries: entries.map((entry) => ({
      id: entry.id,
      question: entry.question || '',
      answer: entry.answer || '',
      uploadedBy: entry.uploadedBy || entry.uploaded_by || 'Anonymous',
      screenshot: entry.screenshot ? (entry.screenshot.startsWith('http') ? entry.screenshot : `${API_BASE}${entry.screenshot}`) : '',
      screenshotName: entry.screenshotName || entry.screenshot_name || '',
      imagePath: entry.storagePath || entry.imagePath || '',
      imageHash: entry.imageHash || '',
      status: entry.status || 'STORED',
      createdAt: entry.createdAt || entry.created_at,
      ocrText: entry.ocrText || '',
      inferredOptions: entry.inferredOptions || entry.options || [],
    })),
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload?.message || 'Request failed.';
    throw new Error(message);
  }

  return payload;
}

export async function fetchModulesWithEntries() {
  const modules = await request('/api/modules');
  return modules.map(normalizeModule);
}

export async function createModule(name) {
  return request('/api/modules', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function renameModule(moduleId, name) {
  return request(`/api/modules/${moduleId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteModule(moduleId) {
  return request(`/api/modules/${moduleId}`, { method: 'DELETE' });
}

export async function findDuplicateQuestion(moduleId, imageHash) {
  const module = await request(`/api/modules/${moduleId}`);
  const duplicate = (module.entries || []).find((entry) => entry.imageHash === imageHash);
  if (!duplicate) return null;

  return {
    id: duplicate.id,
    question: duplicate.question || '',
    answer: duplicate.answer || '',
    uploadedBy: duplicate.uploadedBy || 'Anonymous',
    screenshot: duplicate.screenshot ? (duplicate.screenshot.startsWith('http') ? duplicate.screenshot : `${API_BASE}${duplicate.screenshot}`) : '',
    screenshotName: duplicate.screenshotName || '',
    imagePath: duplicate.storagePath || '',
    imageHash: duplicate.imageHash || '',
    status: duplicate.status || 'STORED',
    createdAt: duplicate.createdAt || duplicate.created_at,
    ocrText: duplicate.ocrText || '',
    inferredOptions: duplicate.inferredOptions || duplicate.options || [],
  };
}

export async function uploadQuestionEntry({ moduleId, slug, file, question, answer, options, ocrText, imageHash, uploadedBy }) {
  const formData = new FormData();
  formData.append('images', file);
  formData.append('uploadedBy', uploadedBy || 'Anonymous');
  formData.append('question', question || '');
  formData.append('answer', answer || '');
  formData.append('options', JSON.stringify(options || []));
  formData.append('ocrText', ocrText || '');
  formData.append('imageHash', imageHash || '');

  const response = await fetch(`${API_BASE}/api/modules/${moduleId}/entries`, {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload?.duplicate) {
      throw new Error(payload.message || 'This image already exists in the module.');
    }
    throw new Error(payload?.message || 'Upload failed.');
  }

  return payload;
}

export async function deleteQuestionEntry(moduleId, entryId) {
  return request(`/api/modules/${moduleId}/entries/${entryId}`, { method: 'DELETE' });
}
