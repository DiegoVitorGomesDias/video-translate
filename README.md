# Video Translate

Extensão Chrome (Manifest V3) que captura o áudio de um vídeo tocando na aba, transcreve o inglês localmente no navegador e mostra a tradução em português num painel lateral. Para celular e tablet há a **versão web (PWA)**, que ouve pelo microfone: https://diegovitorgomesdias.github.io/video-translate/ (ver [No celular](#no-celular-e-tablet-pwa)). O plano completo está em [PLANO.md](PLANO.md).

## Estado atual: Fase 1 (MVP) implementada

O que a extensão faz hoje:

- **Clique no ícone** numa aba com vídeo: o service worker pede `chrome.tabCapture.getMediaStreamId`, cria o documento offscreen, começa a captura e mostra o viewer como um **painel lateral** dentro da própria página (padrão) ou numa **janela separada** (opção). O ícone mostra o selo `REC`. Clicar de novo reabre/foca o painel.
- **Áudio**: o offscreen faz `getUserMedia` com o stream da aba, liga o som de volta no `AudioContext.destination` (o vídeo continua audível) e um `AudioWorklet` gera mono 16 kHz.
- **Transcrição local** com `@huggingface/transformers` num Web Worker: Moonshine tiny por padrão (WebGPU, com fallback para WASM), Moonshine base ou Whisper base.en nas opções. Um VAD por energia fecha trechos em pausas de 0,25 s ou 4 s no máximo (configurável); enquanto um trecho está aberto, a cada 1,5 s sai um **texto provisório** (cinza, itálico) na última linha.
- **Frases**: cada pausa na fala fecha a frase em aberto; os finais são divididos por `. ? !` (respeitando abreviações, iniciais e decimais) e frases coladas sem pontuação são separadas por heurística (quebra antes de iniciadores como *What*, *You*, *And* em maiúscula após palavra minúscula, sem tocar em nomes como *Doctor House* ou *New York*). Restos de trechos cortados por tamanho são juntados ao próximo final ou fechados após 90 caracteres (na vírgula/conjunção mais próxima) ou 5 s.
- **Separação de frases** (opções, extensão e PWA): Rápida (pausa de 0,2 s / trecho de 3 s), Normal (0,25 s / 4 s, padrão) ou Longa (0,4 s / 6 s). Ao atingir o máximo, o trecho é cortado no ponto mais silencioso dos últimos 1,2 s, para não partir palavras.
- **Tradução EN→PT** na janela: **LibreTranslate** se houver URL configurada e a instância responder, senão a **Translator API do Chrome** (138+, local, sem chave). O cabeçalho mostra qual está ativo. Cache por frase.
- **Painel lateral**: um content script injetado sob demanda cria um host com Shadow DOM fixo à direita (400 px, redimensionável arrastando a borda esquerda) com um iframe de `viewer.html`, que continua sendo página da extensão (workers, cache, fetch). Botão `›` recolhe (a captura continua; uma aba fina reabre), `✕` fecha e para. Se a página recarregar ou navegar (YouTube/Prime são SPAs), o painel é reinjetado. No cabeçalho dá para trocar entre "abrir em janela" e "voltar para o painel".
- **Parar**: botão Parar, fechar o painel/janela ou fechar a aba capturada.
- **Opções** (`chrome://extensions` → Detalhes → Opções da extensão): URL e chave do LibreTranslate com "testar conexão", modelo de transcrição, tamanho da fonte.

Ainda não há seleção do vídeo na página (Fase 2) nem exportação/legenda sobreposta (Fase 3).

### Tradução: como a extensão escolhe o provedor

Ordem, a cada abertura da janela (o cabeçalho mostra qual ficou ativo e, no tooltip, por que os anteriores foram pulados):

1. **LibreTranslate**, se houver URL nas opções (padrão `http://localhost:5000`) e a instância responder em `/languages`.
2. **Translator API do Chrome** (138+, local, sem chave), se o pacote EN→PT já estiver instalado e o tradutor for criado. Tenta os códigos `pt`, `pt-BR` e `pt-PT`. Se o pacote só precisar ser baixado, a janela mostra "Baixar agora".
3. **Fallback 2**, escolhido nas opções:
   - **Tradução local no navegador** (padrão): `Xenova/opus-mt-en-ROMANCE` via transformers.js (~113 MB em q8, baixado uma vez, offline depois). Roda em WASM, ~0,3 s por frase. O token de idioma-alvo (`>>pt_br<<`) é inserido direto nos ids de entrada, porque o tokenizador do transformers.js 4.x o quebra em pedaços e o modelo passava a responder em espanhol/francês. Enquanto baixa, os cards mostram "baixando tradutor local X%".
   - **Google Tradutor**: endpoint público não oficial, sem chave, instantâneo. O texto das frases vai para o Google e não há garantia de disponibilidade.
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
- `pnpm icons` regenera os ícones PNG (extensão e PWA).
- `pnpm test` roda os testes do segmentador de frases (node:test).

## Como testar no Chrome

1. Rode `pnpm build`.
2. Abra `chrome://extensions`, ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `.output/chrome-mv3`.

   **Para atualizar**: rode `pnpm build` de novo e clique no ícone de recarregar no card da extensão (ou no botão "Atualizar" no topo da página). Confira a **versão** no card: ela sobe a cada mudança (`package.json` → manifest) e aparece também no cabeçalho da janela, no rodapé das opções e no console do service worker (`[background] video-translate vX.Y.Z`). Se a versão não mudou, o Chrome ainda está com a build antiga.
4. Abra uma aba com um vídeo em inglês tocando (YouTube, Prime Video, etc.) e clique no ícone da extensão (fixe-o pelo menu de extensões, se não aparecer). Abre a janela do viewer; o som do vídeo continua normal.
5. No painel lateral (ou na janela, conforme as opções): o cabeçalho mostra o carregamento do modelo (barra de progresso na primeira vez), depois "Ouvindo · moonshine-tiny (GPU)". As frases em inglês aparecem em cards com a tradução embaixo; a última linha em cinza é o texto provisório.
6. Para parar: botão **Parar**, `✕` no painel ou fechar a janela.

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

O script também abre `viewer.html` e `options.html` (falha se houver exceção ou `console.error`; falhas de rede, como o LibreTranslate desligado, não contam), cria a janela do viewer pelo service worker, testa os dois fallbacks de tradução pela página de opções e injeta o painel lateral numa página http local conferindo que o iframe do viewer carrega.

Resultado de referência (Chrome for Testing 146 headless, GPU por software): Moonshine tiny carregou em WebGPU em ~17 s na primeira vez (download + aquecimento) e transcreveu 1 s de áudio em ~1,2 s.

### Problemas conhecidos

- O painel lateral some quando o vídeo entra em tela cheia (o navegador só mostra o elemento em fullscreen); use a janela separada nesse caso. Em páginas que não aceitam scripts (`chrome://`, Chrome Web Store) a extensão cai para a janela.
- O painel precisa de `web_accessible_resources` para `viewer.html` em `<all_urls>`; é só o HTML do viewer, que não expõe dados.

- WebGPU dentro de um Web Worker de documento offscreen pode não estar disponível em todas as versões do Chrome; nesse caso o worker cai para WASM automaticamente (mais lento).
- O VAD é por energia, então música de fundo alta pode manter o trecho "aberto" até o limite do perfil (3 a 6 s), e trechos só de música podem virar texto sem sentido.
- A Translator API do Chrome pode falhar com `NotSupportedError` para EN→PT em alguns Chromes (observado num Chrome em Linux); nesse caso a extensão usa o fallback 2. Em Edge/Brave a API pode não existir.
- Os modelos Moonshine base e Whisper base.en foram configurados mas ainda não medidos nesta máquina; o Whisper processa janelas de 30 s, então a latência é maior.
- A extensão ainda não tem ícones próprios (Chrome usa o padrão).
- Em `chrome://` e páginas da Chrome Web Store o `tabCapture` não funciona.

## No celular e tablet (PWA)

Extensões não existem no Chrome de Android/iOS, então a versão móvel é um app web instalável (PWA) em `pwa/`, publicado em **https://diegovitorgomesdias.github.io/video-translate/**. Ele reaproveita os mesmos módulos da extensão (`src/lib`: VAD, STT local com transformers.js, segmentador, tradutores), mas captura o som **pelo microfone**.

Como usar:

1. Abra a URL no Chrome do celular (ou leia o QR mostrado em Opções → "Celular e tablet" na extensão). No menu do Chrome, **"Adicionar à tela inicial"** para instalar.
2. Toque em **Iniciar** e permita o microfone. Deixe o som do vídeo audível (TV, notebook, outro aparelho). A tela fica acesa enquanto captura (Wake Lock).
3. Na primeira vez o app baixa o modelo (Moonshine tiny, ~28 MB em CPU / ~110 MB com WebGPU) e o tradutor local (~113 MB). Depois disso funciona offline: o service worker guarda o app, o runtime ONNX e os modelos em cache.
4. **Fone de ouvido** (Bluetooth ou com fio) pode ficar conectado: o app escolhe por padrão o microfone do próprio aparelho, que fica perto do som, e não o do fone; se o fone conectar ou desconectar no meio, ele refaz a escolha sem parar. Dá para trocar o microfone no seletor 🎤 do cabeçalho ou em ⚙. Observação: se o vídeo estiver tocando **no mesmo celular** com fone, o microfone não ouve nada; nesse caso o som precisa sair por um alto-falante.
5. ⚙ abre as configurações: URL do LibreTranslate (use o **IP do computador** na mesma rede Wi-Fi, não `localhost`), fallback de tradução (no aparelho, Google ou nenhum), modelo, fonte.

**Exportar configurações do computador para o celular**: em Opções da extensão → "Exportar configurações (QR)". O QR aponta para a URL do app com as configurações no fragmento (`#import=…`, base64url de um JSON); o app pergunta antes de importar. A chave do LibreTranslate só entra se você marcar a caixa.

Limitações: a qualidade cai com ruído do ambiente e distância do alto-falante (o modelo foi feito para áudio limpo); no iPhone não há WebGPU, então tudo roda em WASM e fica mais lento (prefira o modelo tiny); a Translator API do Chrome só existe no Chrome Android recente; o Safari precisa de iOS 16.4+ para PWA com microfone.

Desenvolvimento: `pnpm pwa:dev` (servidor local), `pnpm pwa:build` (gera `pwa/dist`), `pnpm pwa:compile` (tsc). O build é publicado automaticamente pelo workflow `.github/workflows/pages.yml` a cada push na `main`; para isso, **ative uma vez** em GitHub → Settings → Pages → Source: "GitHub Actions". Autoteste com microfone falso (um WAV de fala em inglês): `node scripts/selftest-pwa.mjs /caminho/para/chrome`.

## Estrutura

```
video-translate/
├── wxt.config.ts                 # manifest MV3 (permissões, CSP com wasm-unsafe-eval, action sem popup)
├── pwa/                          # versão web para celular (Vite + React + vite-plugin-pwa), reusa src/lib
│   ├── vite.config.ts, index.html
│   └── src/ App.tsx, capture.ts (microfone → worklet → VAD → STT), Settings.tsx, settings.ts
├── .github/workflows/pages.yml   # publica pwa/dist no GitHub Pages
├── scripts/selftest-pwa.mjs      # autoteste do PWA com microfone falso
├── scripts/copy-ort.mjs          # copia o runtime ONNX para public/onnx
├── scripts/selftest-chrome.mjs   # autoteste em Chrome headless (modelo + páginas)
├── tests/segmenter.test.ts       # testes do segmentador (pnpm test)
├── public/onnx/                  # .mjs/.wasm do onnxruntime-web (gerado, ignorado no git)
└── src/
    ├── entrypoints/
    │   ├── background.ts         # service worker: clique → streamId → offscreen → janela
    │   ├── offscreen/            # captura, AudioWorklet, VAD, parciais, provedor de STT
    │   ├── drawer.content.ts     # painel lateral (Shadow DOM + iframe do viewer), injetado sob demanda
    │   ├── viewer/               # frases EN + PT (React); roda no painel ou na janela
    │   ├── options/              # LibreTranslate, modelo, fonte (React)
    │   └── pcm-worklet.ts        # gera /pcm-worklet.js para audioWorklet.addModule
    └── lib/
        ├── messages.ts           # tipos das mensagens entre as partes
        ├── options.ts            # chrome.storage.local
        ├── segmenter.ts          # junta finais em frases
        ├── audio/pcm-worklet.ts  # AudioWorkletProcessor: mono 16 kHz
        ├── audio/vad.ts          # VAD por energia (perfis rápida/normal/longa, corte no ponto mais silencioso)
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
