/**
 * Downloads the orientation-detection models into MODELS_DIR (default `<repo>/models`)
 * and checks their sha256 (SPEC §5.8). Both are MIT-licensed; neither is committed.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { FACE_MODEL, ORIENTATION_MODEL } from '../src/orientation.ts';

const MODELS = [
  {
    file: FACE_MODEL,
    // UltraFace RFB-320, ONNX Model Zoo.
    url: 'https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx',
    sha256: '34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017',
  },
  {
    file: ORIENTATION_MODEL,
    // EfficientNetV2 orientation classifier, pinned to a commit.
    url: 'https://huggingface.co/DuarteBarbosa/deep-image-orientation-detection/resolve/9bc7687b9fd5152e220084ca23e13e7fa1daec38/orientation_model_v2_0.9882.onnx',
    sha256: 'cffe911c1dff47fbfbbd90110aaab9c07134645c460d35b3ae8832079bea91ba',
  },
];

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

const dir = loadConfig().modelsDir;
await mkdir(dir, { recursive: true });
for (const m of MODELS) {
  const dest = path.join(dir, m.file);
  if (existsSync(dest) && sha256(await readFile(dest)) === m.sha256) {
    console.log(`${m.file}: up to date`);
    continue;
  }
  console.log(`${m.file}: downloading…`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== m.sha256) throw new Error(`${m.file}: sha256 mismatch (got ${got})`);
  await writeFile(`${dest}.tmp`, buf);
  await rename(`${dest}.tmp`, dest);
  console.log(`${m.file}: ${(buf.length / 1e6).toFixed(1)} MB`);
}
