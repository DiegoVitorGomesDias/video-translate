// Copia os binários WASM do onnxruntime-web para public/onnx.
// A CSP da extensão não permite carregar scripts de CDN, então o runtime ONNX
// precisa ser servido de dentro da própria extensão (chrome-extension://...).
// transformers.js usa a variante "asyncify" por padrão (CPU/WASM e WebGPU).
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Resolve o onnxruntime-web a partir do pacote transformers (mesma versão que ele usa).
// (os pacotes têm "exports" restritos, então resolvemos pelo diretório real do pacote)
const transformersDir = realpathSync(join(root, 'node_modules', '@huggingface', 'transformers'));
const ortRequire = createRequire(join(transformersDir, 'package.json'));
const ortEntry = ortRequire.resolve('onnxruntime-web');
const ortDist = dirname(ortEntry);

const files = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];
// Extensão (public/onnx) e PWA (pwa/public/onnx).
for (const outDir of [join(root, 'public', 'onnx'), join(root, 'pwa', 'public', 'onnx')]) {
  mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const src = join(ortDist, f);
    if (!existsSync(src)) {
      console.error(`[copy-ort] arquivo não encontrado: ${src}`);
      process.exit(1);
    }
    copyFileSync(src, join(outDir, f));
    console.log(`[copy-ort] ${f} -> ${outDir.replace(root + '/', '')}/`);
  }
}
