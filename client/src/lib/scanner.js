import Tesseract from 'tesseract.js';
import { loadImageElement } from './loadImage';
import { parseQuizPage } from './kcqParser';

let workerPromise;
const getWorker = () => {
  if (!workerPromise) workerPromise = Tesseract.createWorker('eng');
  return workerPromise;
};

// Grayscale + contrast stretch; the same canvas is used for radio-button detection.
// Small screenshots OCR badly; upscale to ~2400px wide first.
function toStretchedGray(image) {
  const scale = Math.min(3, Math.max(1, 2400 / image.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
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
    data[i] = data[i + 1] = data[i + 2] = ((data[i] - min) / range) * 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export async function scanImage(file) {
  const { image, objectUrl } = await loadImageElement(file);
  try {
    const canvas = toStretchedGray(image);
    const worker = await getWorker();
    const result = await worker.recognize(canvas);
    return {
      fileName: file.name,
      rawText: result?.data?.text || '',
      questions: parseQuizPage(result, canvas),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
