import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const names = new Set(['original-model-data.js', 'original-model.xlsx']);
let cachedPath, cachedAssets;

// Render mounts this ordinary file across deploys. It contains a compressed
// workbook package, with no encryption or key. Keep company files out of Git.
export function readModelFile(name, directory) {
  if (!names.has(name)) throw Error('Unknown model asset.');
  if (directory) return readFileSync(path.join(directory, name));
  const bundlePath = process.env.DEAL_LENS_MODEL_FILE || '/etc/secrets/deal-lens-model.bundle';
  if (bundlePath !== cachedPath) {
    const packed = Buffer.from(readFileSync(bundlePath, 'utf8').trim(), 'base64');
    const assets = JSON.parse(gunzipSync(packed, { maxOutputLength: 8 * 1024 * 1024 }).toString('utf8'));
    if (assets.version !== 1 || typeof assets.workbookBase64 !== 'string' || typeof assets.manifest !== 'string') throw Error('Invalid workbook package.');
    const workbook = Buffer.from(assets.workbookBase64, 'base64');
    if (workbook.subarray(0, 2).toString() !== 'PK') throw Error('Invalid workbook file.');
    cachedAssets = { 'original-model.xlsx': workbook, 'original-model-data.js': Buffer.from(assets.manifest) };
    cachedPath = bundlePath;
  }
  return cachedAssets[name];
}

export function isModelConfigured() {
  try { return readModelFile('original-model.xlsx').length > 0; } catch { return false; }
}
