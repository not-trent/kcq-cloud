import { loadImageElement } from './loadImage';

export async function compressToWebp(file, quality = 0.82) {
  const { image, objectUrl } = await loadImageElement(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);

    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error(`WebP compression failed for ${file.name}`));
          return;
        }
        resolve(blob);
      }, 'image/webp', quality);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
