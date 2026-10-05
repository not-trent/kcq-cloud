import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';

process.env.NODE_ENV = 'test';

const { app, deriveQuestionFromFile, inferQuestionAnswerFromText } = await import('../src/index.js');

const makeUploadFile = () => {
  const png = new PNG({ width: 8, height: 8, colorType: 2 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 255;
    }
  }

  return {
    name: 'sample-image.png',
    data: PNG.sync.write(png),
    type: 'image/png',
  };
};

async function deleteTestModule(port, moduleId) {
  if (!moduleId) return;
  await fetch(`http://127.0.0.1:${port}/api/modules/${moduleId}`, { method: 'DELETE' });
}

test('deriveQuestionFromFile strips extensions and normalizes names', () => {
  assert.equal(deriveQuestionFromFile('project-planning-001.png'), 'project planning 001');
  assert.equal(deriveQuestionFromFile('Q1_What_is_the_primary_purpose_of_project_planning.jpg'), 'Q1 What is the primary purpose of project planning');
});

test('upload flow does not require manual answer typing', () => {
  const result = deriveQuestionFromFile('module-2-screenshot-02.jpeg');
  assert.equal(result, 'module 2 02');
  assert.doesNotThrow(() => deriveQuestionFromFile('Screenshot-001.png'));
});

test('module question-bank API stores question entries in the module record', async () => {
  const server = app.listen(0);
  const { port } = server.address();
  const moduleName = `Physics Test Module ${Date.now()}`;
  let moduleId = '';

  try {
    const moduleResponse = await fetch(`http://127.0.0.1:${port}/api/modules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: moduleName }),
    });

    const modulePayload = await moduleResponse.json();
    assert.equal(moduleResponse.status, 201);
    moduleId = modulePayload.id;

    const bankResponse = await fetch(`http://127.0.0.1:${port}/api/modules/${modulePayload.id}/question-bank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'What is the SI unit of force?',
        options: ['Joule', 'Newton', 'Watt', 'Volt'],
        answer: 'Newton',
      }),
    });

    const bankPayload = await bankResponse.json();
    assert.equal(bankResponse.status, 201);
    assert.equal(bankPayload.question, 'What is the SI unit of force?');
    assert.equal(bankPayload.answer, 'Newton');

    const fetchModule = await fetch(`http://127.0.0.1:${port}/api/modules/${modulePayload.id}`);
    const storedModule = await fetchModule.json();
    assert.equal(storedModule.questionBank.length, 1);
  } finally {
    await deleteTestModule(port, moduleId);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('uploaded images are saved under the target module archive and their OCR text is stored in JSON', async () => {
  const server = app.listen(0);
  const { port } = server.address();
  const moduleName = `OCR Archive Module ${Date.now()}`;
  let moduleId = '';

  try {
    const moduleResponse = await fetch(`http://127.0.0.1:${port}/api/modules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: moduleName }),
    });

    const modulePayload = await moduleResponse.json();
    assert.equal(moduleResponse.status, 201);
    moduleId = modulePayload.id;

    const form = new FormData();
    const file = makeUploadFile();
    form.append('images', new Blob([file.data], { type: file.type }), file.name);
    form.append('uploadedBy', 'tester');

    const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/modules/${modulePayload.id}/entries`, {
      method: 'POST',
      body: form,
    });

    const uploadPayload = await uploadResponse.json();
    assert.equal(uploadResponse.status, 201);
    assert.equal(uploadPayload.entries.length, 1);
    assert.equal(typeof uploadPayload.entries[0].ocrText, 'string');

    const storedModule = await (await fetch(`http://127.0.0.1:${port}/api/modules/${modulePayload.id}`)).json();
    const savedEntry = storedModule.entries[0];
    assert.ok(savedEntry.storagePath.includes(path.basename(storedModule.storagePath)) || savedEntry.storagePath.startsWith(storedModule.storagePath));
    assert.ok(fs.existsSync(savedEntry.storagePath));

    const moduleArchivePath = path.join(storedModule.storagePath, 'module-ocr.json');
    assert.ok(fs.existsSync(moduleArchivePath));
    const ocrArchive = JSON.parse(fs.readFileSync(moduleArchivePath, 'utf8'));
    assert.equal(ocrArchive.entries.length, 1);
    assert.equal(typeof ocrArchive.entries[0].ocrText, 'string');
  } finally {
    await deleteTestModule(port, moduleId);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('OCR text is transformed into a usable question and answer record', () => {
  const parsed = inferQuestionAnswerFromText('What is the SI unit of force? A. Watt B. Newton C. Joule D. Volt The answer is B');
  assert.equal(parsed.question, 'What is the SI unit of force?');
  assert.equal(parsed.answer, 'B');
});

test('duplicate uploads are flagged before saving the second copy', async () => {
  const server = app.listen(0);
  const { port } = server.address();
  const moduleName = `Duplicate Review Module ${Date.now()}`;
  let moduleId = '';

  try {
    const moduleResponse = await fetch(`http://127.0.0.1:${port}/api/modules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: moduleName }),
    });

    const modulePayload = await moduleResponse.json();
    assert.equal(moduleResponse.status, 201);
    moduleId = modulePayload.id;

    const file = makeUploadFile();
    const formA = new FormData();
    formA.append('images', new Blob([file.data], { type: file.type }), file.name);

    const firstUpload = await fetch(`http://127.0.0.1:${port}/api/modules/${modulePayload.id}/entries`, {
      method: 'POST',
      body: formA,
    });
    assert.equal(firstUpload.status, 201);

    const formB = new FormData();
    formB.append('images', new Blob([file.data], { type: file.type }), file.name);

    const secondUpload = await fetch(`http://127.0.0.1:${port}/api/modules/${modulePayload.id}/entries`, {
      method: 'POST',
      body: formB,
    });

    const duplicatePayload = await secondUpload.json();
    assert.equal(secondUpload.status, 409);
    assert.ok(duplicatePayload.duplicate);
    assert.ok(duplicatePayload.existingEntry);
  } finally {
    await deleteTestModule(port, moduleId);
    await new Promise((resolve) => server.close(resolve));
  }
});
