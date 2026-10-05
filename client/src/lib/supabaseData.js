import { supabase } from './supabaseClient';
import { slugify } from './slugify';

async function createSignedUrlMap(paths) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!uniquePaths.length) return {};

  const { data, error } = await supabase.storage.from('screenshots').createSignedUrls(uniquePaths, 60 * 60);
  if (error) throw error;

  const map = {};
  data.forEach((item, index) => {
    map[uniquePaths[index]] = item.signedUrl;
  });
  return map;
}

function mapQuestionRow(row, signedUrlMap) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    uploadedBy: row.uploaded_by,
    screenshot: row.image_path ? signedUrlMap[row.image_path] || '' : '',
    screenshotName: row.image_path ? row.image_path.split('/').pop() : '',
    imagePath: row.image_path,
    imageHash: row.image_hash,
    status: row.status,
    createdAt: row.created_at,
    ocrText: row.ocr_text,
    inferredOptions: row.options || [],
  };
}

export async function fetchModulesWithEntries() {
  const { data: moduleRows, error: modulesError } = await supabase
    .from('modules')
    .select('id, name, slug, created_at')
    .order('created_at', { ascending: true });
  if (modulesError) throw modulesError;

  const { data: questionRows, error: questionsError } = await supabase
    .from('questions')
    .select('*')
    .order('created_at', { ascending: true });
  if (questionsError) throw questionsError;

  const signedUrlMap = await createSignedUrlMap(questionRows.filter((row) => row.image_path).map((row) => row.image_path));

  return moduleRows.map((moduleRow) => ({
    id: moduleRow.id,
    name: moduleRow.name,
    slug: moduleRow.slug,
    createdAt: moduleRow.created_at,
    entries: questionRows
      .filter((row) => row.module_id === moduleRow.id && row.image_path)
      .map((row) => mapQuestionRow(row, signedUrlMap)),
  }));
}

export async function createModule(name) {
  const trimmed = name.trim();
  const { data: existing, error: findError } = await supabase
    .from('modules')
    .select('id')
    .ilike('name', trimmed)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) {
    throw new Error('A module with that name already exists.');
  }

  const { data, error } = await supabase
    .from('modules')
    .insert({ name: trimmed, slug: slugify(trimmed) })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Only the display name changes on rename — storage paths keep the original slug so existing images stay valid.
export async function renameModule(moduleId, name) {
  const trimmed = name.trim();
  const { data, error } = await supabase
    .from('modules')
    .update({ name: trimmed })
    .eq('id', moduleId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteModule(moduleId) {
  const { data: rows, error: findError } = await supabase
    .from('questions')
    .select('image_path')
    .eq('module_id', moduleId);
  if (findError) throw findError;

  const paths = (rows || []).map((row) => row.image_path).filter(Boolean);
  if (paths.length) {
    await supabase.storage.from('screenshots').remove(paths);
  }

  const { error } = await supabase.from('modules').delete().eq('id', moduleId);
  if (error) throw error;
}

export async function findDuplicateQuestion(moduleId, imageHash) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('module_id', moduleId)
    .eq('image_hash', imageHash)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const signedUrlMap = await createSignedUrlMap([data.image_path]);
  return mapQuestionRow(data, signedUrlMap);
}

export async function uploadQuestionEntry({ moduleId, slug, file, question, answer, options, ocrText, imageHash, uploadedBy }) {
  const objectPath = `${slug}/${Date.now()}-${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await supabase.storage
    .from('screenshots')
    .upload(objectPath, file, { contentType: 'image/webp' });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('questions')
    .insert({
      module_id: moduleId,
      question,
      answer,
      options,
      status: 'unreviewed',
      image_path: objectPath,
      image_hash: imageHash,
      ocr_text: ocrText,
      uploaded_by: uploadedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadModulePhoto({ moduleId, slug, file }) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100) || 'photo';
  const objectPath = `${slug}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from('screenshots')
    .upload(objectPath, file, { contentType: file.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase
    .from('questions')
    .insert({ module_id: moduleId, image_path: objectPath, uploaded_by: 'Shared library' });
  if (insertError) {
    await supabase.storage.from('screenshots').remove([objectPath]);
    throw insertError;
  }
}

export async function deleteQuestionEntry(entryId, imagePath) {
  if (imagePath) {
    const { error: storageError } = await supabase.storage.from('screenshots').remove([imagePath]);
    if (storageError) throw storageError;
  }
  const { error } = await supabase.from('questions').delete().eq('id', entryId);
  if (error) throw error;
}
