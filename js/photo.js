// Shrinks a menu photo before it is sent: JPEG, about 1600 px on the long side, well under the
// backend's size cap. Phones take 4000 px photos of several MB; menus stay readable at 1600 px.
const MAX_B64 = 2_800_000; // the backend refuses more than 3,000,000 characters

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** @returns {Promise<{ base64: string, width: number, height: number, preview: string }>} */
export async function photoToJpeg(file, { maxSide = 1600 } = {}) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('That file is not a photo.');
  const img = await decode(file);
  const w0 = img.width, h0 = img.height;
  if (!w0 || !h0) throw new Error('That photo could not be opened. Try another one.');
  for (const [side, quality] of [[maxSide, 0.82], [maxSide, 0.7], [1300, 0.68], [1000, 0.65]]) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w0 * scale); canvas.height = Math.round(h0 * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, quality);
    if (!blob) continue;
    const base64 = await toBase64(blob);
    if (base64.length <= MAX_B64) {
      img.close?.();
      return { base64, width: canvas.width, height: canvas.height, preview: `data:image/jpeg;base64,${base64}` };
    }
  }
  img.close?.();
  throw new Error('That photo is too large to send. Try a closer, simpler shot.');
}
