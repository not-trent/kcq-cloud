import Tesseract from 'tesseract.js';
import { loadImageElement } from './loadImage';
import { normalizeText } from './textParsing';

// Grayscale + contrast stretch improves OCR accuracy; only used for recognition, not the stored image.
function preprocessForOcr(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  const range = Math.max(max - min, 1);
  for (let i = 0; i < data.length; i += 4) {
    const stretched = ((data[i] - min) / range) * 255;
    data[i] = data[i + 1] = data[i + 2] = stretched;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function getContentLines(result, canvas) {
  const lines = result?.data?.lines || [];
  const hasLeftColumn = lines.some((line) => line.bbox?.x0 < canvas.width * 0.08);
  const hasMainColumn = lines.some((line) => line.bbox?.x0 > canvas.width * 0.1);

  if (hasLeftColumn && hasMainColumn) {
    return lines.filter((line) => line.bbox?.x0 >= canvas.width * 0.08);
  }

  return lines;
}

function detectSelectedOption(lines, canvas) {
  const candidates = lines
    .map((line) => {
      const match = String(line.text || '').match(/(?:^|\s)([A-D])\s*[.)\-:]/i);
      if (!match || !line.bbox) return null;

      const centerX = Math.max(0, line.bbox.x0 - Math.max(8, Math.round(canvas.width * 0.015)));
      const centerY = Math.round((line.bbox.y0 + line.bbox.y1) / 2);
      const radius = Math.max(5, Math.round(canvas.height * 0.025));
      const pixels = canvas.getContext('2d').getImageData(
        Math.max(0, centerX - radius),
        Math.max(0, centerY - radius),
        Math.min(radius * 2 + 1, canvas.width - Math.max(0, centerX - radius)),
        Math.min(radius * 2 + 1, canvas.height - Math.max(0, centerY - radius))
      ).data;
      let darkPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 135) darkPixels += 1;
      }

      return { letter: match[1].toUpperCase(), darkPixels };
    })
    .filter(Boolean);

  if (candidates.length < 2) return '';

  const ranked = [...candidates].sort((a, b) => b.darkPixels - a.darkPixels);
  const average = candidates.reduce((sum, candidate) => sum + candidate.darkPixels, 0) / candidates.length;
  return ranked[0].darkPixels > average * 1.2 ? ranked[0].letter : '';
}

export async function extractTextFromImage(file) {
  let objectUrl;
  try {
    const { image, objectUrl: url } = await loadImageElement(file);
    objectUrl = url;
    const canvas = preprocessForOcr(image);
    const result = await Tesseract.recognize(canvas, 'eng', { logger: () => undefined });
    const lines = getContentLines(result, canvas);
    return normalizeText(lines.map((line) => line.text).join(' '));
  } catch (error) {
    console.warn(`Browser OCR failed for ${file.name}: ${error.message}`);
    return '';
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export async function extractQuestionDataFromImage(file) {
  let objectUrl;
  try {
    const { image, objectUrl: url } = await loadImageElement(file);
    objectUrl = url;
    const canvas = preprocessForOcr(image);
    const result = await Tesseract.recognize(canvas, 'eng', { logger: () => undefined });
    const lines = getContentLines(result, canvas);

    return {
      text: normalizeText(lines.map((line) => line.text).join(' ')),
      selectedOption: detectSelectedOption(lines, canvas),
    };
  } catch (error) {
    console.warn(`Browser OCR failed for ${file.name}: ${error.message}`);
    return { text: '', selectedOption: '' };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
