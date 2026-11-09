# Video Translate Extension

Extensão Chrome (Manifest V3) que captura o áudio de um vídeo tocando na aba, transcreve o inglês localmente no navegador e (nas próximas fases) mostra a tradução em português. O plano completo está em [PLANO.md](PLANO.md).

## Estado atual: Fase 1 (MVP) implementada

O que a extensão faz hoje:

- **Clique no ícone** numa aba com vídeo: o service worker pede `chrome.tabCapture.getMediaStreamId`, cria o documento offscreen, começa a captura e abre a **janela do viewer** (popup 480×720). O ícone mostra o selo `REC`. Clicar de novo só foca a janela.
- **Áudio**: o offscreen faz `getUserMedia` com o stream da aba, liga o som de volta no `AudioContext.destination` (o vídeo continua audível) e um `AudioWorklet` gera mono 16 kHz.
- **Transcrição local** com `@huggingface/transformers` num Web Worker: Moonshine tiny por padrão (WebGPU, com fallback para WASM), Moonshine base ou Whisper base.en nas opções. Um VAD por energia fecha trechos com ~400 ms de silêncio ou 6 s no máximo; enquanto um trecho está aberto, a cada 1,5 s sai um **texto provisório** (cinza, itálico) na última linha.
- **Frases**: os finais são divididos por `. ? !` (respeitando abreviações, iniciais e decimais); restos sem pontuação são juntados ao próximo final ou fechados após 120 caracteres / 5 s.
- **Tradução EN→PT** na janela: **LibreTranslate** se houver URL configurada e a instância responder, senão a **Translator API do Chrome** (138+, local, sem chave). O cabeçalho mostra qual está ativo. Cache por frase.
- **Parar**: botão na janela ou fechar a janela. Fechar a aba capturada também encerra.
- **Opções** (`chrome://extensions` → Detalhes → Opções da extensão): URL e chave do LibreTranslate com "testar conexão", modelo de transcrição, tamanho da fonte.

Ainda não há seleção do vídeo na página (Fase 2) nem exportação/legenda sobreposta (Fase 3).

### Tradução: como a extensão escolhe o provedor

Ordem, a cada abertura da janela (o cabeçalho mostra qual ficou ativo e, no tooltip, por que os anteriores foram pulados):

1. **LibreTranslate**, se houver URL nas opções (padrão `http://localhost:5000`) e a instância responder em `/languages`.
2. **Translator API do Chrome** (138+, local, sem chave), se o pacote EN→PT já estiver instalado e o tradutor for criado. Tenta os códigos `pt`, `pt-BR` e `pt-PT`. Se o pacote só precisar ser baixado, a janela mostra "Baixar agora".
3. **Fallback 2**, escolhido nas opções:
   - **Google Tradutor** (padrão): endpoint público não oficial, sem chave, instantâneo. O texto das frases vai para o Google e não há garantia de disponibilidade.
   - **Tradução local no navegador**: `Xenova/opus-mt-en-ROMANCE` via transformers.js (~113 MB em q8, baixado uma vez, offline depois). Mais lenta (WASM) e qualidade um pouco menor.
   - **Nenhum**: só o inglês.

**LibreTranslate local** (melhor controle; nada sai do computador):

```bash
docker run -d --name libretranslate --restart unless-stopped -p 5000:5000 libretranslate/libretranslate --load-only en,pt
```

O primeiro start baixa os modelos de idioma (alguns minutos). Confira com `curl http://localhost:5000/languages`. A extensão já tem permissão fixa para `http://localhost:5000`; para outra URL, em Opções → "Testar conexão" → "Salvar" o Chrome pede permissão só para essa origem (`optional_host_permissions`). A instância pública libretranslate.com exige chave paga.

**Translator API do Chrome indisponível?** Em Opções o campo "Fallback 1" mostra o diagnóstico (API ausente, par EN→PT não suportado, pacote não baixado ou erro ao criar). Confira `chrome://on-device-translation-internals` e `chrome://flags/#translation-api`; a API existe só no Chrome desktop 138+ (Edge/Brave podem não ter).

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
- `pnpm test` roda os testes do segmentador de frases (node:test).

## Como testar no Chrome

1. Rode `pnpm build`.
2. Abra `chrome://extensions`, ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `.output/chrome-mv3`.

   **Para atualizar**: rode `pnpm build` de novo e clique no ícone de recarregar no card da extensão (ou no botão "Atualizar" no topo da página). Confira a **versão** no card: ela sobe a cada mudança (`package.json` → manifest) e aparece também no cabeçalho da janela, no rodapé das opções e no console do service worker (`[background] video-translate vX.Y.Z`). Se a versão não mudou, o Chrome ainda está com a build antiga.
4. Abra uma aba com um vídeo em inglês tocando (YouTube, Prime Video, etc.) e clique no ícone da extensão (fixe-o pelo menu de extensões, se não aparecer). Abre a janela do viewer; o som do vídeo continua normal.
5. Na janela: o cabeçalho mostra o carregamento do modelo (barra de progresso na primeira vez), depois "Ouvindo · moonshine-tiny (GPU)". As frases em inglês aparecem em cards com a tradução embaixo; a última linha em cinza é o texto provisório.
6. Para parar: botão **Parar** ou fechar a janela.

### Depuração

- Console do **service worker**: link "service worker" no card da extensão (erros de captura, início/fim).
- Console do **documento offscreen** (transcrições com latências): no card, "Inspecionar visualizações" → `offscreen.html`; só existe enquanto a captura está ativa. Alternativa: `chrome://inspect/#other`.
- Console da **janela do viewer**: botão direito na janela → Inspecionar.
- No console do offscreen cada trecho aparece como:

   ```
   [transcrição] Hello and welcome back to the channel.
      áudio 2310 ms | inferência 410 ms | latência total 455 ms
   ```

   e os provisórios como `[parcial #12] Hello and wel...`.

### Resultado da Fase 0 (09/11/2026, Chrome com GPU)

- Moonshine tiny carregou em **WebGPU**: download ~2 s (já em cache depois), aquecimento ~0,8 s, provedor pronto em ~2,7 s.
- Inferência de ~100 ms por segundo de áudio (1,9 s de fala → 181 ms; 8 s → 877 ms). Fila sempre em 1, ou seja, o modelo acompanha o áudio em tempo real.
- Transcrição legível em fala limpa (3Blue1Brown): pontuação ok, erros pontuais em palavras raras ("tailored" em vez de "Taylor").
- O som da aba continuou tocando normalmente.
- Prime Video (DRM) também funciona: o áudio chega ao `tabCapture` e é transcrito; trechos só com música saem vazios e são descartados pela janela. Com música de fundo e várias vozes a qualidade do tiny cai; o Moonshine base ou o Whisper base.en nas opções ajudam.

Conclusão: os dois riscos da Fase 0 (tabCapture + offscreen, e latência do modelo local) estão resolvidos; dá para seguir para a Fase 1.

### Autoteste do modelo sem capturar áudio

Para checar só o runtime ONNX, o download do modelo e a inferência (sem `tabCapture`):

- No Chrome, com a extensão carregada, abra `chrome-extension://<id-da-extensão>/offscreen.html?selftest` numa aba e veja o console. O id aparece no card em `chrome://extensions`.
- Sem interação, com um Chrome/Chromium instalado:

```bash
node scripts/selftest-chrome.mjs /caminho/para/chrome
```

O script também abre `viewer.html` e `options.html` (falha se houver exceção ou `console.error`; falhas de rede, como o LibreTranslate desligado, não contam), cria a janela do viewer pelo service worker e testa os dois fallbacks de tradução pela página de opções.

Resultado de referência (Chrome for Testing 146 headless, GPU por software): Moonshine tiny carregou em WebGPU em ~17 s na primeira vez (download + aquecimento) e transcreveu 1 s de áudio em ~1,2 s.

### Problemas conhecidos

- WebGPU dentro de um Web Worker de documento offscreen pode não estar disponível em todas as versões do Chrome; nesse caso o worker cai para WASM automaticamente (mais lento).
- O VAD é por energia, então música de fundo alta pode manter o trecho "aberto" até o limite de 6 s, e trechos só de música podem virar texto sem sentido.
- A Translator API do Chrome pode falhar com `NotSupportedError` para EN→PT em alguns Chromes (observado num Chrome em Linux); nesse caso a extensão usa o fallback 2. Em Edge/Brave a API pode não existir.
- Os modelos Moonshine base e Whisper base.en foram configurados mas ainda não medidos nesta máquina; o Whisper processa janelas de 30 s, então a latência é maior.
- A extensão ainda não tem ícones próprios (Chrome usa o padrão).
- Em `chrome://` e páginas da Chrome Web Store o `tabCapture` não funciona.

## Estrutura

```
video-translate/
├── wxt.config.ts                 # manifest MV3 (permissões, CSP com wasm-unsafe-eval, action sem popup)
├── scripts/copy-ort.mjs          # copia o runtime ONNX para public/onnx
├── scripts/selftest-chrome.mjs   # autoteste em Chrome headless (modelo + páginas)
├── tests/segmenter.test.ts       # testes do segmentador (pnpm test)
├── public/onnx/                  # .mjs/.wasm do onnxruntime-web (gerado, ignorado no git)
└── src/
    ├── entrypoints/
    │   ├── background.ts         # service worker: clique → streamId → offscreen → janela
    │   ├── offscreen/            # captura, AudioWorklet, VAD, parciais, provedor de STT
    │   ├── viewer/               # janela com as frases EN + PT (React)
    │   ├── options/              # LibreTranslate, modelo, fonte (React)
    │   └── pcm-worklet.ts        # gera /pcm-worklet.js para audioWorklet.addModule
    └── lib/
        ├── messages.ts           # tipos das mensagens entre as partes
        ├── options.ts            # chrome.storage.local
        ├── segmenter.ts          # junta finais em frases
        ├── audio/pcm-worklet.ts  # AudioWorkletProcessor: mono 16 kHz
        ├── audio/vad.ts          # VAD por energia (400 ms silêncio / 6 s máx)
        ├── stt/
        │   ├── SpeechProvider.ts        # interface comum dos provedores de transcrição
        │   ├── models.ts                # catálogo de modelos (tiny, base, whisper)
        │   ├── local-transformers.ts    # provedor local (fala com o worker)
        │   └── local-stt.worker.ts      # Web Worker com @huggingface/transformers
        └── translate/
            ├── TranslationProvider.ts   # interface + cache
            ├── libretranslate.ts
            ├── chrome-translator.ts     # Translator API do Chrome
            ├── google-free.ts           # endpoint público do Google Tradutor
            ├── local-opus.ts, local-mt.worker.ts  # tradução local (opus-mt) em Web Worker
            └── index.ts                 # createTranslator(): escolhe e faz fallback
```

## Próximas fases

Ver [PLANO.md](PLANO.md), seção 9: seleção do vídeo (Fase 2), acabamento (Fase 3), publicação (Fase 4).
