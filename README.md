# Video Translate Extension

Extensão Chrome (Manifest V3) que captura o áudio de um vídeo tocando na aba, transcreve o inglês localmente no navegador e (nas próximas fases) mostra a tradução em português. O plano completo está em [PLANO.md](PLANO.md).

## Estado atual: Fase 0 (prova de conceito)

O que já funciona (ou deveria funcionar; precisa de teste manual no Chrome):

- Clique no ícone da extensão → o service worker pede `chrome.tabCapture.getMediaStreamId` para a aba ativa, cria o documento offscreen e manda ele começar a captura. Um segundo clique para a captura (o ícone mostra o selo `REC` enquanto captura).
- O offscreen faz `getUserMedia` com o stream da aba, liga o áudio de volta no `AudioContext.destination` (o som continua tocando) e passa o sinal por um `AudioWorklet` que gera mono 16 kHz.
- Um VAD por energia fecha trechos com ~400 ms de silêncio ou 8 s no máximo.
- Cada trecho vai para um Web Worker que roda `@huggingface/transformers` com o modelo **Moonshine tiny** (tenta WebGPU, depois WASM) e cai para **Whisper tiny.en** se o Moonshine não carregar.
- O texto e a latência são impressos no **console do documento offscreen**. Ainda não há interface.

## Requisitos

- Node 22 (há um `.nvmrc`; com nvm: `nvm use`).
- pnpm (o projeto foi montado com pnpm 11).
- Chrome 116+ (Chromium: Edge, Brave, Opera também devem servir).

## Comandos

```bash
pnpm install
```

```bash
node scripts/copy-ort.mjs
```

```bash
pnpm build
```

- `pnpm install` instala as dependências e roda `wxt prepare` (gera os tipos em `.wxt/`).
- `node scripts/copy-ort.mjs` copia o runtime ONNX (`.mjs` + `.wasm`, ~27 MB) do `node_modules` para `public/onnx/`. É obrigatório antes da primeira build e sempre que a versão do `@huggingface/transformers` mudar. A pasta `public/onnx/` está no `.gitignore`.
- `pnpm build` gera a extensão em `.output/chrome-mv3/`.
- `pnpm dev` roda o WXT em modo de desenvolvimento (abre um Chrome próprio com a extensão carregada e recarrega a cada mudança).
- `pnpm compile` só roda o `tsc --noEmit`.

## Como testar no Chrome

1. Rode `pnpm build`.
2. Abra `chrome://extensions`, ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `.output/chrome-mv3`.
4. Abra uma aba com um vídeo em inglês tocando (YouTube, por exemplo) e clique no ícone da extensão (fixe-o pelo menu de extensões, se não aparecer). O ícone ganha o selo `REC` e o som do vídeo deve continuar saindo normalmente.
5. Para ver a transcrição, abra o console do documento offscreen:
   - Em `chrome://extensions`, no card da extensão, clique em **Inspecionar visualizações** → `offscreen.html`. Se o link não aparecer, use `chrome://inspect/#other` ou `chrome://inspect/#pages` e procure `offscreen.html`.
   - Alternativa: clique em **service worker** no card para ver o console do background (lá aparecem os erros de captura e o status reportado pelo offscreen).
6. No console do offscreen, a primeira vez mostra o download do modelo (`modelo: Baixando ... %`). Depois de `modelo [ready]`, cada trecho aparece como:

   ```
   [transcrição] Hello and welcome back to the channel.
      áudio 2310 ms | inferência 410 ms | latência total 455 ms
   ```

   - **áudio**: duração do trecho transcrito.
   - **inferência**: tempo só do modelo.
   - **latência total**: ms entre o VAD fechar o trecho e o texto chegar (inclui fila; some os ~400 ms do silêncio que o VAD espera para ter a latência percebida).

7. Clique de novo no ícone para parar. O offscreen é fechado.

### O que observar / medir na Fase 0

- Se o Moonshine carregou e em qual backend (`modelo [ready]: Pronto: onnx-community/moonshine-tiny-ONNX em webgpu|wasm`). Se caiu para Whisper, o console mostra o motivo (`falha ao carregar ...`).
- Latência de inferência típica com WebGPU vs. WASM na sua máquina. O alvo do plano é ficar abaixo de 1 a 3 s do fim da fala à tradução.
- Se o som da aba continua tocando sem cortes depois de iniciar a captura.
- Se a fila (`fila=N` nas mensagens `trecho fechado`) cresce sem parar, o modelo não acompanha o áudio em tempo real nesse backend.

### Resultado da Fase 0 (09/11/2026, Chrome com GPU, vídeo do YouTube)

- Moonshine tiny carregou em **WebGPU**: download ~2 s (já em cache depois), aquecimento ~0,8 s, provedor pronto em ~2,7 s.
- Inferência de ~100 ms por segundo de áudio (1,9 s de fala → 181 ms; 8 s → 877 ms). Fila sempre em 1, ou seja, o modelo acompanha o áudio em tempo real.
- Transcrição legível em fala limpa (3Blue1Brown): pontuação ok, erros pontuais em palavras raras ("tailored" em vez de "Taylor").
- O som da aba continuou tocando normalmente.

Conclusão: os dois riscos da Fase 0 (tabCapture + offscreen, e latência do modelo local) estão resolvidos; dá para seguir para a Fase 1.

### Autoteste do modelo sem capturar áudio

Para checar só o runtime ONNX, o download do modelo e a inferência (sem `tabCapture`):

- No Chrome, com a extensão carregada, abra `chrome-extension://<id-da-extensão>/offscreen.html?selftest` numa aba e veja o console. O id aparece no card em `chrome://extensions`.
- Sem interação, com um Chrome/Chromium instalado:

```bash
node scripts/selftest-chrome.mjs /caminho/para/chrome
```

Resultado de referência (Chrome for Testing 146 headless, GPU por software): Moonshine tiny carregou em WebGPU em ~17 s na primeira vez (download + aquecimento) e transcreveu 1 s de áudio em ~1,2 s.

### Problemas conhecidos / dúvidas a confirmar no teste

- WebGPU dentro de um Web Worker de um documento offscreen pode não estar disponível em todas as versões do Chrome; nesse caso o worker cai para WASM automaticamente.
- O VAD é por energia, então música de fundo alta pode manter o trecho "aberto" até o limite de 8 s.
- A extensão ainda não tem ícones próprios (Chrome usa o ícone padrão).
- Em `chrome://` e páginas da Chrome Web Store o `tabCapture` não funciona.

## Estrutura

```
video-translate/
├── wxt.config.ts                 # manifest MV3 (permissões, CSP com wasm-unsafe-eval, action sem popup)
├── scripts/copy-ort.mjs          # copia o runtime ONNX para public/onnx
├── public/onnx/                  # .mjs/.wasm do onnxruntime-web (gerado, ignorado no git)
└── src/
    ├── entrypoints/
    │   ├── background.ts         # service worker: clique → streamId → offscreen
    │   ├── offscreen/            # captura, AudioWorklet, VAD, chama o provedor de STT
    │   └── pcm-worklet.ts        # gera /pcm-worklet.js para audioWorklet.addModule
    └── lib/
        ├── messages.ts           # tipos das mensagens background ↔ offscreen
        ├── audio/pcm-worklet.ts  # AudioWorkletProcessor: mono 16 kHz
        ├── audio/vad.ts          # VAD por energia (400 ms silêncio / 8 s máx)
        └── stt/
            ├── SpeechProvider.ts        # interface comum dos provedores de transcrição
            ├── local-transformers.ts    # provedor local (fala com o worker)
            └── local-stt.worker.ts      # Web Worker com @huggingface/transformers
```

## Próximas fases

Ver [PLANO.md](PLANO.md), seção 9: janela com legendas e tradução (Fase 1), seleção do vídeo (Fase 2), acabamento (Fase 3), publicação (Fase 4).
