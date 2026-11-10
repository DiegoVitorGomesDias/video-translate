import { defineConfig } from 'wxt';

// Documentação: https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Video Translate',
    description:
      'Transcreve o áudio em inglês de um vídeo que está tocando na aba e mostra a tradução em português.',
    permissions: ['tabCapture', 'offscreen', 'activeTab', 'scripting', 'storage'],
    // A URL do LibreTranslate é configurável; a permissão de host é pedida só ao salvar.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // Último recurso de tradução (endpoint público do Google Tradutor).
    // LibreTranslate local padrão e último recurso (Google Tradutor público).
    // LibreTranslate local padrão, servidor de transcrição local padrão e último recurso (Google Tradutor público).
    host_permissions: ['http://localhost:5000/*', 'http://localhost:8080/*', 'https://translate.googleapis.com/*'],
    // Ação sem popup: o clique no ícone dispara browser.action.onClicked no background.
    action: {
      default_title: 'Video Translate: iniciar / parar transcrição',
    },
    // O runtime ONNX (transformers.js) precisa de wasm-unsafe-eval.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // O painel lateral é um iframe com viewer.html dentro da página do vídeo.
    web_accessible_resources: [{ resources: ['viewer.html'], matches: ['<all_urls>'] }],
    minimum_chrome_version: '116',
  },
  vite: () => ({
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@huggingface/transformers'] },
    resolve: {
      // Usa a variante do onnxruntime-web sem o loader WASM embutido; os arquivos
      // .mjs/.wasm vêm de public/onnx (ver scripts/copy-ort.mjs), evitando duplicar 26 MB.
      conditions: ['onnxruntime-web-use-extern-wasm', 'module', 'browser', 'development|production'],
    },
  }),
});
