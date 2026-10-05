import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import Tesseract from 'tesseract.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const archiveRoot = process.env.KCQ_ARCHIVE_ROOT || path.resolve('E:/00_archive/kcq-cloud');
const uploadsDir = path.join(rootDir, 'uploads');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'kcq-data.json');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(archiveRoot, { recursive: true });
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({ modules: [] }, null, 2));
}

const app = express();
const PORT = Number(process.env.PORT || 4010);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(uploadsDir));
app.use('/archive', express.static(archiveRoot));

const slugify = (value = '') => String(value)
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'module';

const persistModuleArchive = (moduleRecord) => {
  const archiveFile = path.join(moduleRecord.storagePath, 'module-data.json');
  const payload = {
    id: moduleRecord.id,
    name: moduleRecord.name,
    storagePath: moduleRecord.storagePath,
    updatedAt: new Date().toISOString(),
    questionBank: moduleRecord.questionBank || [],
    entries: (moduleRecord.entries || []).map((entry) => ({
      ...entry,
      ocrText: entry.ocrText || '',
    })),
  };
  fs.writeFileSync(archiveFile, JSON.stringify(payload, null, 2));
};

const persistModuleOcrArchive = (moduleRecord, entries = []) => {
  const ocrDataFile = path.join(moduleRecord.storagePath, 'module-ocr.json');
  const payload = {
    moduleId: moduleRecord.id,
    moduleName: moduleRecord.name,
    generatedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      id: entry.id,
      question: entry.question,
      screenshotName: entry.screenshotName,
      ocrText: entry.ocrText || '',
      uploadedBy: entry.uploadedBy,
      createdAt: entry.createdAt,
    })),
  };
  fs.writeFileSync(ocrDataFile, JSON.stringify(payload, null, 2));
};

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const moduleId = req.params?.moduleId || 'shared';

    try {
      const data = readDb();
      const moduleRecord = data.modules.find((module) => module.id === moduleId);
      const targetDir = moduleRecord?.storagePath || path.join(archiveRoot, moduleId);
      fs.mkdirSync(targetDir, { recursive: true });
      cb(null, targetDir);
      return;
    } catch (_error) {
      const fallbackDir = path.join(archiveRoot, moduleId);
      fs.mkdirSync(fallbackDir, { recursive: true });
      cb(null, fallbackDir);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  },
});

const upload = multer({ storage });

const ensureModuleStorage = (moduleRecord) => {
  if (!moduleRecord?.storagePath) {
    return null;
  }

  fs.mkdirSync(moduleRecord.storagePath, { recursive: true });
  return moduleRecord.storagePath;
};

const readDb = () => JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const writeDb = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

const normalizeText = (value = '') => String(value).trim().replace(/\s+/g, ' ');

export function inferQuestionAnswerFromText(rawText = '') {
  const text = normalizeText(String(rawText || ''));
  if (!text) {
    return { question: '', answer: '', options: [] };
  }

  const matches = [
    /(.+?)(?:\s+)?(?:A\.|B\.|C\.|D\.|\s+)(?:A\.|B\.|C\.|D\.)/i,
    /(.+?)(?:\s+)?(?:A\)|B\)|C\)|D\))/i,
    /(.+?)(?:\s+)?(?:\?|:)/i,
  ].map((pattern) => text.match(pattern)).find(Boolean);

  let question = matches ? matches[1].trim() : text;
  const answerMatch = text.match(/(?:answer|correct|option)\s+(?:is\s+)?([A-D])/i);
  const answer = answerMatch ? answerMatch[1].toUpperCase() : '';

  const optionMatches = [...text.matchAll(/\b([A-D])\.?\s*[-:)]?\s*([^A-D\n]+?)(?=(?:\s+[A-D]\.?\s*[-:)]?)|$)/gi)];
  const options = optionMatches.map((match) => normalizeText(match[2])).filter(Boolean);

  if (question && question.endsWith('?') === false && text.includes('?')) {
    question = `${question}?`;
  }

  return { question: question.replace(/\s+\?$/, '?').trim(), answer, options };
}

async function extractImageText(filePath) {
  try {
    const result = await Tesseract.recognize(filePath, 'eng', {
      logger: () => undefined,
    });
    return normalizeText(result?.data?.text || '');
  } catch (error) {
    console.warn(`OCR failed for ${filePath}: ${error.message}`);
    return '';
  }
}

export function deriveQuestionFromFile(filename = '') {
  return normalizeText(
    String(filename)
      .replace(/\.[^/.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b(screenshot|img|image|photo|pic)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function checkQuestionExists(modules, moduleId, question) {
  const targetModule = modules.find((m) => m.id === moduleId);
  if (!targetModule) return null;

  const normalizedQuestion = normalizeText(question);
  return targetModule.entries.find((entry) => normalizeText(entry.question || '') === normalizedQuestion) || null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'KCQ Cloud server is running' });
});

app.get('/api/modules', (_req, res) => {
  const data = readDb();
  res.json(data.modules || []);
});

app.post('/api/modules', (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Module name is required.' });
  }

  const data = readDb();
  const normalizedName = name.trim();
  const existing = data.modules.find((module) => module.name.toLowerCase() === normalizedName.toLowerCase());
  if (existing) {
    return res.status(409).json({ message: 'A module with that name already exists.' });
  }

  const moduleRecord = {
    id: uuidv4(),
    name: normalizedName,
    entries: [],
    questionBank: [],
    storagePath: path.join(archiveRoot, slugify(normalizedName)),
    createdAt: new Date().toISOString(),
  };

  fs.mkdirSync(moduleRecord.storagePath, { recursive: true });
  persistModuleArchive(moduleRecord);
  data.modules.push(moduleRecord);
  writeDb(data);
  res.status(201).json(moduleRecord);
});

app.get('/api/modules/:moduleId', (req, res) => {
  const { moduleId } = req.params;
  const data = readDb();
  const moduleRecord = data.modules.find((module) => module.id === moduleId);

  if (!moduleRecord) {
    return res.status(404).json({ message: 'Module not found.' });
  }

  res.json(moduleRecord);
});

app.patch('/api/modules/:moduleId', (req, res) => {
  const { moduleId } = req.params;
  const { name } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Module name is required.' });
  }

  const data = readDb();
  const moduleRecord = data.modules.find((module) => module.id === moduleId);
  if (!moduleRecord) {
    return res.status(404).json({ message: 'Module not found.' });
  }

  const normalizedName = String(name).trim();
  const duplicate = data.modules.find((module) => module.id !== moduleId && module.name.toLowerCase() === normalizedName.toLowerCase());
  if (duplicate) {
    return res.status(409).json({ message: 'A module with that name already exists.' });
  }

  const previousPath = moduleRecord.storagePath;
  const targetPath = path.join(archiveRoot, slugify(normalizedName));

  if (previousPath !== targetPath && fs.existsSync(previousPath) && !fs.existsSync(targetPath)) {
    fs.renameSync(previousPath, targetPath);
  }

  moduleRecord.name = normalizedName;
  moduleRecord.storagePath = targetPath;
  moduleRecord.entries = (moduleRecord.entries || []).map((entry) => ({
    ...entry,
    storagePath: entry.storagePath
      ? entry.storagePath.replace(previousPath, targetPath)
      : entry.storagePath,
  }));

  persistModuleArchive(moduleRecord);
  writeDb(data);
  res.json(moduleRecord);
});

app.delete('/api/modules/:moduleId', (req, res) => {
  const { moduleId } = req.params;
  const data = readDb();
  const moduleRecord = data.modules.find((module) => module.id === moduleId);

  if (!moduleRecord) {
    return res.status(404).json({ message: 'Module not found.' });
  }

  if (moduleRecord.storagePath && fs.existsSync(moduleRecord.storagePath)) {
    fs.rmSync(moduleRecord.storagePath, { recursive: true, force: true });
  }

  data.modules = data.modules.filter((module) => module.id !== moduleId);
  writeDb(data);
  res.json({ message: 'Module deleted successfully.' });
});

app.get('/api/modules/:moduleId/question-bank', (req, res) => {
  const { moduleId } = req.params;
  const data = readDb();
  const moduleRecord = data.modules.find((module) => module.id === moduleId);

  if (!moduleRecord) {
    return res.status(404).json({ message: 'Module not found.' });
  }

  res.json(moduleRecord.questionBank || []);
});

app.post('/api/modules/:moduleId/question-bank', (req, res) => {
  const { moduleId } = req.params;
  const { question, options, answer } = req.body || {};

  if (!question || !String(question).trim()) {
    return res.status(400).json({ message: 'Question is required.' });
  }

  const data = readDb();
  const moduleRecord = data.modules.find((module) => module.id === moduleId);
  if (!moduleRecord) {
    return res.status(404).json({ message: 'Module not found.' });
  }

  const normalizedOptions = Array.isArray(options)
    ? options.map((option) => String(option).trim()).filter(Boolean)
    : [];

  if (!normalizedOptions.length) {
    return res.status(400).json({ message: 'At least one answer option is required.' });
  }

  const questionRecord = {
    id: uuidv4(),
    question: String(question).trim(),
    options: normalizedOptions,
    answer: String(answer || normalizedOptions[0]).trim(),
    createdAt: new Date().toISOString(),
  };

  moduleRecord.questionBank = Array.isArray(moduleRecord.questionBank) ? moduleRecord.questionBank : [];
  moduleRecord.questionBank.push(questionRecord);
  persistModuleArchive(moduleRecord);
  writeDb(data);
  res.status(201).json(questionRecord);
});

app.post('/api/modules/:moduleId/entries', upload.array('images', 20), async (req, res) => {
  const { moduleId } = req.params;
  const { uploadedBy } = req.body || {};
  const files = req.files || [];

  if (!files.length) {
    return res.status(400).json({ message: 'At least one screenshot is required.' });
  }

  const data = readDb();
  const moduleRecord = data.modules.find((module) => module.id === moduleId);
  if (!moduleRecord) {
    return res.status(404).json({ message: 'Module not found.' });
  }

  ensureModuleStorage(moduleRecord);

  const seenHashes = new Set();
  for (const entry of moduleRecord.entries || []) {
    if (entry.imageHash) seenHashes.add(entry.imageHash);
  }

  const savedEntries = [];
  for (const file of files) {
    const fullPath = path.join(moduleRecord.storagePath, file.filename);
    const fileBuffer = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const existingDuplicate = (moduleRecord.entries || []).find((entry) => entry.imageHash === hash || entry.screenshotName === file.originalname);
    if (existingDuplicate) {
      fs.unlinkSync(fullPath);
      return res.status(409).json({
        duplicate: true,
        message: 'This image already exists in the module.',
        existingEntry: existingDuplicate,
      });
    }

    const ocrText = await extractImageText(fullPath);
    const inferred = inferQuestionAnswerFromText(ocrText);
    const question = inferred.question || deriveQuestionFromFile(file.originalname);
    const answer = inferred.answer || '';

    const fileUrl = `/archive/${slugify(moduleRecord.name)}/${file.filename}`;
    const entry = {
      id: uuidv4(),
      question,
      answer,
      uploadedBy: uploadedBy || 'Anonymous',
      screenshot: fileUrl,
      screenshotName: file.originalname,
      storagePath: fullPath,
      imageHash: hash,
      status: 'STORED',
      createdAt: new Date().toISOString(),
      duplicateOf: null,
      ocrText: '',
      inferredOptions: inferred.options,
    };

    savedEntries.push(entry);
    seenHashes.add(hash);
  }

  moduleRecord.entries.push(...savedEntries);
  persistModuleArchive(moduleRecord);
  persistModuleOcrArchive(moduleRecord, savedEntries);
  writeDb(data);
  res.status(201).json({ entries: savedEntries });
});

app.get('/api/search', (req, res) => {
  const { q = '', moduleId } = req.query;
  const data = readDb();
  const searchTerm = normalizeText(String(q || '')).toLowerCase();

  const modules = moduleId
    ? data.modules.filter((module) => module.id === moduleId)
    : data.modules;

  const results = modules.flatMap((module) => {
    const questionMatches = (module.questionBank || []).filter((entry) => {
      if (!searchTerm) return true;
      const haystack = `${entry.question} ${entry.answer || ''} ${entry.options.join(' ')}`.toLowerCase();
      return haystack.includes(searchTerm);
    }).map((entry) => ({ ...entry, moduleId: module.id, moduleName: module.name, source: 'question-bank' }));

    const imageMatches = (module.entries || []).filter((entry) => {
      if (!searchTerm) return true;
      const haystack = `${entry.question} ${entry.answer || ''} ${entry.uploadedBy}`.toLowerCase();
      return haystack.includes(searchTerm);
    }).map((entry) => ({ ...entry, moduleId: module.id, moduleName: module.name, source: 'image-bank' }));

    return [...questionMatches, ...imageMatches];
  });

  res.json(results);
});

app.delete('/api/modules/:moduleId/entries/:entryId', (req, res) => {
  const { moduleId, entryId } = req.params;
  const data = readDb();
  const moduleRecord = data.modules.find((module) => module.id === moduleId);

  if (!moduleRecord) {
    return res.status(404).json({ message: 'Module not found.' });
  }

  const fileEntry = moduleRecord.entries.find((entry) => entry.id === entryId);
  if (fileEntry) {
    const filePath = path.join(moduleRecord.storagePath, path.basename(fileEntry.screenshot));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  moduleRecord.entries = moduleRecord.entries.filter((entry) => entry.id !== entryId);
  persistModuleArchive(moduleRecord);
  writeDb(data);
  res.json({ success: true });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KCQ Cloud server running on http://0.0.0.0:${PORT}`);
  });
}

export { app };

