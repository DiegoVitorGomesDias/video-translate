# Video Translate: plano da extensão

Extensão de navegador que captura o áudio de um vídeo que está tocando na página, transcreve o inglês em tempo real e mostra cada frase com a tradução em português logo abaixo, numa janela da extensão.

```
This is amazing!
Isso é incrível!

Let's continue our project next Monday
Vamos continuar nosso projeto na próxima segunda
```

---

## 1. Fluxo do usuário

1. O usuário está numa página com um vídeo tocando (YouTube, curso, reunião gravada etc.) e clica no ícone da extensão.
2. A página ganha um destaque sobre cada `<video>` visível ("Clique no vídeo que deseja traduzir"). Se só houver um vídeo, ele é escolhido direto.
3. Ao clicar no vídeo, abre a janela da extensão.
4. A janela mostra a legenda em inglês sendo escrita ao vivo (texto provisório em cinza). Quando a frase termina, ela fica fixa e a tradução aparece embaixo.
5. Pausar o vídeo pausa a transcrição. Fechar a janela (ou clicar em "Parar") encerra a captura.

## 2. Navegador alvo

**Chrome (e Edge, Brave, Opera, que usam a mesma base).** A captura de áudio de aba (`chrome.tabCapture`) e o documento offscreen são APIs do Chromium. O Firefox não tem `tabCapture`; dá para suportar depois por outro caminho, mas não vale começar por ele.

Manifest V3, que é o obrigatório hoje na Chrome Web Store.

## 3. Arquitetura

```
┌──────────────── Aba com o vídeo ────────────────┐
│ content script                                   │
│  • destaca os <video> e captura o clique         │
│  • escuta play / pause / seek do vídeo escolhido │
└───────────────┬──────────────────────────────────┘
                │ mensagens
┌───────────────▼──────────────┐
│ service worker (background)  │  orquestra tudo, guarda estado da sessão
│  • tabCapture.getMediaStreamId│
│  • cria offscreen e janela    │
└──────┬─────────────────┬─────┘
       │ streamId        │ eventos
┌──────▼───────────────┐ │   ┌──────────────────────────────┐
│ offscreen document   │ │   │ janela da extensão (UI)      │
│  • getUserMedia(tab) │ └──►│  • lista de frases EN + PT   │
│  • AudioWorklet→PCM  │────►│  • texto provisório ao vivo  │
│  • WebSocket do STT  │     │  • tradução de cada frase    │
│  • devolve o áudio   │     │  • iniciar / pausar / parar  │
│    para os alto-     │     └──────────────────────────────┘
│    falantes          │
└──────────────────────┘
```

### Peças

| Peça | Papel |
|---|---|
| **content script** | Injetado sob demanda (`activeTab` + `scripting`) quando o usuário clica no ícone. Desenha o overlay de seleção, avisa qual vídeo foi escolhido e repassa eventos de play/pause/seek. |
| **service worker** | Ponto central. Pede o `streamId` da aba, cria o documento offscreen, abre a janela e roteia as mensagens. Não guarda nada importante só em memória, porque o MV3 pode desligar o worker. |
| **offscreen document** | Única página "invisível" que pode usar `getUserMedia` com o stream da aba. Converte o áudio para PCM 16 kHz mono e manda para o serviço de transcrição por WebSocket. |
| **janela da extensão** | `chrome.windows.create({ type: "popup" })` com uma página da extensão. Recebe os textos, separa em frases, pede a tradução e renderiza. |

### Captura de áudio

1. No clique do ícone, o service worker chama `chrome.tabCapture.getMediaStreamId({ targetTabId })`. Isso precisa acontecer logo após a ação do usuário, então pedimos o ID **antes** do overlay de seleção.
2. O ID vai para o offscreen document, que faz:
   ```js
   navigator.mediaDevices.getUserMedia({
     audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }
   })
   ```
3. **Importante:** quando a aba é capturada, o Chrome deixa de tocar o som dela. É preciso ligar o stream de volta no `AudioContext.destination` para o usuário continuar ouvindo.
4. Um `AudioWorklet` converte o Float32 para PCM Int16 a 16 kHz e envia pacotes de ~100 ms pelo WebSocket.

**Sobre "selecionar o vídeo":** o `tabCapture` pega todo o áudio da aba, não de um `<video>` específico. Na prática quase sempre só um vídeo toca por vez, então a seleção serve para saber qual vídeo acompanhar (pausa, título, posição). Como melhoria, dá para tentar `video.captureStream()` para isolar só aquele elemento; isso falha em vídeos de outro domínio ou com DRM (Netflix, Prime), então fica como opção e o `tabCapture` é o padrão.

## 4. Transcrição (speech-to-text)

Primeiro um ponto que elimina a opção "grátis e fácil": a **Web Speech API** (`webkitSpeechRecognition`) só escuta o microfone, não aceita um stream de áudio da aba. Não serve aqui.

| Opção | Prós | Contras |
|---|---|---|
| **Local no navegador** ⭐ escolhido (Moonshine ou Whisper via transformers.js + WebGPU) | Grátis, privado, sem chave, funciona offline | Mais latência (1 a 3 s), usa CPU/GPU, qualidade menor em áudio difícil, download do modelo na primeira vez (50 a 250 MB) |
| Deepgram / AssemblyAI (streaming) | Latência baixa (~300 ms), pontuação automática, ótimo em inglês | Pago por minuto, precisa de chave de API |
| OpenAI Realtime (transcrição) | Boa qualidade | Protocolo mais complexo, custo maior |
| Azure Speech Translation | Faz transcrição **e** tradução no mesmo stream | SDK mais pesado, configuração do Azure |

**Decisão:** transcrição **local e gratuita**, dentro do offscreen document, atrás de uma interface `SpeechProvider` (um provedor pago pode ser adicionado depois como opção).

Como funciona o modo local:

- **Biblioteca:** `@huggingface/transformers` (transformers.js), que roda modelos ONNX com WebGPU e cai para WASM quando não há WebGPU.
- **Modelo:** começar com **Moonshine Tiny/Base** (feito para streaming, rápido em inglês, ~30 a 60 MB) e deixar **Whisper (base/small, inglês)** como alternativa mais precisa e mais pesada. Ambos só em inglês, que é o caso de uso.
- **Pipeline:** o `AudioWorklet` acumula áudio a 16 kHz; um detector simples de fala (VAD, ex.: Silero VAD em ONNX, ~2 MB) fecha um trecho quando há ~400 ms de silêncio ou quando o trecho passa de ~8 s. Cada trecho vai para um **Web Worker** que roda o modelo e devolve o texto. Trechos ainda em andamento são transcritos a cada ~1,5 s para gerar o texto provisório em cinza.
- **Cache:** o modelo é baixado uma vez e fica no cache do navegador (Cache API). A primeira execução mostra uma barra de download na janela.
- **Permissão extra:** o manifest precisa liberar `wasm-unsafe-eval` na CSP da extensão para o runtime ONNX funcionar.

## 5. Tradução EN → PT

| Opção | Prós | Contras |
|---|---|---|
| **LibreTranslate** ⭐ escolhido | Open source, grátis quando self-hosted, API REST simples (`POST /translate`), sem conta | Qualidade um pouco abaixo do DeepL/Google; a instância pública (libretranslate.com) exige chave paga e tem limite de requisições, então na prática precisa rodar a própria instância (Docker) ou usar um espelho da comunidade |
| **Translator API nativa do Chrome** (fallback) | Grátis, roda no próprio computador, rápida, sem chave | Só Chrome desktop recente (138+); baixa o modelo de idioma na primeira vez |
| DeepL API | Tradução muito natural, plano gratuito com cota mensal | Precisa de chave; cota limitada |
| LLM (ex.: Claude Haiku) | Usa as frases anteriores como contexto, traduz gírias melhor | Mais lento e mais caro por frase |

**Decisão:** **LibreTranslate como padrão**, com a URL da instância (e chave opcional) configurável na tela de opções. Se a instância não responder ou não estiver configurada, a extensão cai automaticamente para a **Translator API do Chrome**, que roda local e sem chave. Tudo atrás de uma interface `TranslationProvider`.

**Atualização (09/11/2026):** a Translator API do Chrome falhou com `NotSupportedError` para EN→PT no Chrome do usuário (Linux), então entrou um terceiro nível, configurável nas opções: **tradução local no navegador** com `Xenova/opus-mt-en-ROMANCE` via transformers.js (~113 MB, padrão; WebGPU com fallback para WASM), **Google Tradutor** por endpoint público não oficial (opcional, envia o texto para fora) ou **nenhum**. Ordem final: LibreTranslate → Chrome → fallback escolhido.

Para desenvolvimento e uso local, a instância sobe com um comando:

```bash
docker run -d -p 5000:5000 libretranslate/libretranslate --load-only en,pt
```

A extensão vem pré-configurada com `http://localhost:5000`. O manifest precisa de `host_permissions` para a URL da instância; para permitir qualquer URL configurada pelo usuário sem pedir permissão ampla na loja, usamos `optional_host_permissions` e pedimos a permissão só quando ele salvar a URL.

## 6. Como montar as frases

- O STT manda dois tipos de resultado: **provisório** (muda enquanto a pessoa fala) e **final** (fechado).
- O provisório aparece em cinza na última linha, sem tradução.
- Quando chega um final, o texto é dividido por pontuação (`.`, `?`, `!`) em frases. Cada frase completa vira um card com o inglês e é enviada para tradução; a tradução entra embaixo quando voltar.
- Se a pessoa falar muito sem pausa, cortamos a frase num limite de tamanho/tempo para não esperar demais.
- Auto-scroll para a última frase, a não ser que o usuário tenha rolado para cima.

## 7. Stack sugerida

- **WXT** (framework de extensões em cima do Vite): gera o manifest, faz hot reload e simplifica o content script, background e páginas.
- **TypeScript**.
- **React** na janela da extensão (ou Svelte/vanilla, se preferir algo mais leve).
- `@huggingface/transformers` para o modelo de transcrição, rodando num Web Worker dentro do offscreen document.
- `chrome.storage.local` para configurações (URL do LibreTranslate, modelo de STT, tamanho da fonte).

Permissões: `tabCapture`, `offscreen`, `activeTab`, `scripting`, `storage`, mais `optional_host_permissions` para a URL do LibreTranslate e CSP com `wasm-unsafe-eval`.

## 8. Estrutura de pastas

```
video-translate/
├── wxt.config.ts
├── package.json
├── src/
│   ├── entrypoints/
│   │   ├── background.ts          # service worker
│   │   ├── picker.content.ts      # overlay de seleção do vídeo
│   │   ├── offscreen/             # captura de áudio + worker de transcrição
│   │   ├── viewer/                # janela com as legendas
│   │   └── options/               # URL do LibreTranslate, modelo, preferências
│   ├── lib/
│   │   ├── audio/pcm-worklet.ts, vad.ts
│   │   ├── stt/SpeechProvider.ts, local-whisper.worker.ts
│   │   ├── translate/TranslationProvider.ts, libretranslate.ts, chrome-translator.ts
│   │   ├── segmenter.ts           # junta resultados em frases
│   │   └── messages.ts            # tipos das mensagens entre as partes
└── README.md
```

## 9. Etapas

**Fase 0: prova de conceito (2 a 3 dias)** ✅ concluída em 09/11/2026
Clicar no ícone, capturar o áudio da aba no offscreen, manter o som tocando e ver a transcrição do modelo local no console. Serve para validar os dois pontos mais arriscados: tabCapture + offscreen, e se Moonshine/Whisper roda com latência aceitável na sua máquina (WebGPU vs WASM).

Resultado medido (Chrome com GPU): Moonshine tiny em WebGPU, modelo pronto em 2,7 s (download em cache depois), inferência de ~0,1 s por segundo de áudio (8 s → 877 ms; 2 s → 180 ms), fila nunca acumulou. Validado no YouTube e no Prime Video (DRM): o áudio chega ao tabCapture e é transcrito; trechos só com música saem vazios. Qualidade do tiny cai com música de fundo e várias vozes.

**Fase 1: MVP** ✅ implementada em 09/11/2026 (falta teste manual)
Janela da extensão com frases em inglês e tradução abaixo (via LibreTranslate, com fallback para o Chrome), texto provisório ao vivo, botões iniciar/parar, barra de download do modelo, tela de opções com a URL do LibreTranslate. Extras: seletor de modelo (Moonshine tiny/base, Whisper base.en), tamanho da fonte, segmentador de frases com testes.

**Fase 1b: painel lateral** ✅ 10/11/2026
A pedido do usuário, o viewer passou a abrir como painel lateral (drawer) dentro da própria página do vídeo, em vez de janela separada: content script injetado sob demanda com Shadow DOM + iframe de `viewer.html` (que continua página da extensão). Redimensionável, recolhível, reinjetado ao navegar na aba. A janela separada continua disponível nas opções e por um atalho no cabeçalho.

**Fase 1c: PWA móvel** ✅ 10/11/2026
Pedido do usuário: usar em celular e tablet. Como extensões não existem no Chrome móvel, foi feito um app web instalável (`pwa/`, Vite + React + vite-plugin-pwa) que reaproveita `src/lib` (VAD, STT local, segmentador, tradutores) e captura pelo **microfone** (echoCancellation off, noiseSuppression/autoGainControl on), com Wake Lock, tema, fonte, configurações em localStorage e cache offline do app, do runtime ONNX e dos modelos. Publicado em GitHub Pages por GitHub Actions. A extensão exporta as configurações por QR code (`#import=` na URL do app), que o app confirma antes de importar. Teste automático com microfone falso (WAV de fala).

**Fase 1d: app Android** 🚧 iniciado em 10/11/2026
Decisão do usuário para o caso "celular com fone de ouvido no YouTube": app Android nativo (`android/`, Kotlin + Compose, Android 10+) que captura o áudio interno do aparelho (MediaProjection + AudioPlaybackCapture) num serviço em primeiro plano, transcreve com sherpa-onnx (Moonshine tiny int8, download no primeiro uso), separa frases com o mesmo segmentador (portado para Kotlin com os mesmos testes), traduz com ML Kit offline (ou LibreTranslate por URL) e mostra as legendas num painel flutuante sobre o YouTube. APK compilado no GitHub Actions e publicado no release `android-latest`. Limitação: apps com DRM (Prime, Netflix) saem mudos; iPhone não tem equivalente.

**Fase 2: seleção do vídeo**
Overlay para escolher o vídeo, pausa/retomada seguindo o vídeo, título do vídeo na janela, tentativa de `captureStream()` para isolar o áudio.

**Fase 3: acabamento**
Tamanho de fonte e tema, exportar a transcrição (TXT/SRT), copiar frase, reconexão automática do WebSocket, tratamento de erros (aba fechada, sem áudio, chave inválida), opção de legenda sobreposta no próprio vídeo.

**Fase 4: publicação e opcionais**
Preparar para a Chrome Web Store (ícones, descrição, política de privacidade, justificativa de permissões), provedor de STT pago como opção para quem quiser menos latência, tradução com contexto via LLM, suporte ao Firefox.

## 10. Riscos e cuidados

- **Pronto para publicar desde o início:** nenhuma chave ou URL fixa no código; tudo vem da tela de opções. Permissões mínimas e `optional_host_permissions` em vez de `<all_urls>`. Modelos de STT baixados do Hugging Face em tempo de execução (ou empacotados na extensão, se o tamanho permitir) para não depender de servidor próprio. Página de privacidade simples: o áudio nunca sai do computador; só o texto vai para o servidor de tradução configurado pelo usuário.
- **Latência do modo local:** o alvo é 1 a 3 segundos entre a fala e a tradução. Sem WebGPU (WASM puro) pode passar disso; a fase 0 mede isso. Se ficar lento, trocar para um modelo menor ou oferecer o provedor pago como opção.
- **Service worker do MV3 pode ser desligado:** por isso o modelo, o worker e o áudio ficam no offscreen document, que permanece vivo enquanto captura.
- **LibreTranslate indisponível:** fallback automático para a Translator API do Chrome, com aviso discreto na janela.
- **Áudio difícil** (música alta, várias pessoas falando juntas) piora qualquer STT, e modelos pequenos sofrem mais.

## 11. Decisões tomadas (09/11/2026)

1. Navegador: Chrome/Edge (Chromium), Manifest V3.
2. Transcrição: modo local gratuito (Moonshine/Whisper via transformers.js). Tradução: LibreTranslate, com fallback para a Translator API do Chrome.
3. Interface: painel lateral na página do vídeo (padrão desde 10/11/2026); janela separada como opção.
4. Uso local, mas estruturado desde o começo para publicação na Chrome Web Store.
5. UI em React.
6. (09/11/2026) Último recurso de tradução: modelo local no navegador (opus-mt) por padrão; Google não oficial só se o usuário escolher.
7. (10/11/2026) Celular/tablet: app web (PWA) por microfone, publicado em GitHub Pages, com exportação das configurações da extensão por QR.
8. (10/11/2026) Fone de ouvido no celular: app Android nativo com captura do áudio interno (opção 1 escolhida pelo usuário); player dentro do PWA descartado.
