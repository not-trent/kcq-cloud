// One-time migration: copies existing local screenshots + kcq-data.json into Supabase.
// Usage: node --env-file=.env scripts/migrate-to-supabase.mjs
// Safe to re-run: modules are matched by name, images by hash, question-bank items by question text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dbPath = path.join(rootDir, 'data', 'kcq-data.json');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env scripts/migrate-to-supabase.mjs');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const slugify = (value = '') => String(value)
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'module';

const guessContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
};

const summary = { modulesInserted: 0, imagesUploaded: 0, questionsInserted: 0, skipped: 0, errors: [] };

async function upsertModule(moduleRecord) {
  const slug = slugify(moduleRecord.name);
  const { data: existing, error: findError } = await supabase
    .from('modules')
    .select('id')
    .eq('name', moduleRecord.name)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from('modules')
    .insert({ name: moduleRecord.name, slug })
    .select('id')
    .single();
  if (insertError) throw insertError;

  summary.modulesInserted += 1;
  return inserted.id;
}

async function uploadScreenshot(slug, entry) {
  if (!entry.storagePath || !fs.existsSync(entry.storagePath)) {
    summary.errors.push(`Missing file on disk for entry ${entry.id}: ${entry.storagePath}`);
    return null;
  }

  const fileBuffer = fs.readFileSync(entry.storagePath);
  const objectPath = `${slug}/${path.basename(entry.storagePath)}`;
  const { error } = await supabase.storage
    .from('screenshots')
    .upload(objectPath, fileBuffer, { upsert: true, contentType: guessContentType(entry.storagePath) });

  if (error) {
    summary.errors.push(`Upload failed for ${objectPath}: ${error.message}`);
    return null;
  }

  summary.imagesUploaded += 1;
  return objectPath;
}

async function migrateImageEntries(moduleId, slug, entries = []) {
  for (const entry of entries) {
    const { data: existing, error: findError } = await supabase
      .from('questions')
      .select('id')
      .eq('module_id', moduleId)
      .eq('image_hash', entry.imageHash || '__none__')
      .maybeSingle();
    if (findError) throw findError;
    if (existing) {
      summary.skipped += 1;
      continue;
    }

    const imagePath = await uploadScreenshot(slug, entry);
    const { error: insertError } = await supabase.from('questions').insert({
      module_id: moduleId,
      question: entry.question || '',
      answer: entry.answer || '',
      options: entry.inferredOptions || [],
      status: 'unreviewed',
      image_path: imagePath,
      image_hash: entry.imageHash || null,
      ocr_text: entry.ocrText || '',
      uploaded_by: entry.uploadedBy || 'Anonymous',
      created_at: entry.createdAt || new Date().toISOString(),
    });

    if (insertError) {
      summary.errors.push(`Insert failed for entry ${entry.id}: ${insertError.message}`);
      continue;
    }
    summary.questionsInserted += 1;
  }
}

async function migrateQuestionBank(moduleId, questionBank = []) {
  for (const item of questionBank) {
    const { data: existing, error: findError } = await supabase
      .from('questions')
      .select('id')
      .eq('module_id', moduleId)
      .eq('question', item.question || '')
      .is('image_path', null)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) {
      summary.skipped += 1;
      continue;
    }

    const { error: insertError } = await supabase.from('questions').insert({
      module_id: moduleId,
      question: item.question || '',
      answer: item.answer || '',
      options: item.options || [],
      status: 'unreviewed',
      image_path: null,
      uploaded_by: 'Anonymous',
      created_at: item.createdAt || new Date().toISOString(),
    });

    if (insertError) {
      summary.errors.push(`Insert failed for question-bank item ${item.id}: ${insertError.message}`);
      continue;
    }
    summary.questionsInserted += 1;
  }
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(`No local data file found at ${dbPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  for (const moduleRecord of data.modules || []) {
    const slug = slugify(moduleRecord.name);
    const moduleId = await upsertModule(moduleRecord);
    await migrateImageEntries(moduleId, slug, moduleRecord.entries);
    await migrateQuestionBank(moduleId, moduleRecord.questionBank);
  }

  console.log('Migration complete.');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Local files under server/data and server/uploads were NOT deleted — verify the data in Supabase first, then remove them yourself.');
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
