# Servidores locais (Docker)

Dois serviços opcionais que rodam na sua máquina e deixam a extensão mais rápida:

| Serviço | Porta | O que faz | Onde configurar na extensão |
|---|---|---|---|
| `whisper` (whisper.cpp) | 8080 | Transcrição com Whisper fora do navegador, janela de 15 s | Opções → Motor de transcrição → "Servidor local (Docker)" |
| `libretranslate` | 5000 | Tradução EN→PT | Opções → Tradução → URL do LibreTranslate |

## Subir

```bash
cd docker
docker compose up -d
docker compose logs -f whisper      # na primeira vez baixa o modelo (~550 MB no q5_0)
```

Teste: `curl -s http://localhost:8080/ | head -c 200` deve devolver a página do whisper-server. Na extensão, em Opções → "Testar servidor", ele transcreve 1 s de silêncio e mostra o tempo.

## Escolher modelo e janela

Crie um arquivo `docker/.env` (ou exporte as variáveis) e rode `docker compose up -d` de novo:

```
WHISPER_MODEL=large-v3-turbo-q5_0   # ou large-v3-turbo (mais pesado, um pouco melhor), small.en, base.en
WHISPER_AUDIO_CTX=768               # 1500 = janela original de 30 s; 768 ≈ 15 s (mais rápido); 0 = padrão do modelo
WHISPER_THREADS=4                   # use o número de núcleos físicos
```

O `--audio-ctx` reduzido é uma otimização do whisper.cpp: o encoder processa menos frames, a resposta chega mais rápido e trechos curtos (os da extensão têm no máximo 6 s) não perdem qualidade perceptível. Para frases muito longas, volte para 1500.

## GPU

- **NVIDIA:** instale o NVIDIA Container Toolkit, troque a imagem para `ghcr.io/ggml-org/whisper.cpp:main-cuda` e descomente o bloco `deploy:` no `docker-compose.yml`.
- **AMD/Intel (Vulkan):** imagem `ghcr.io/ggml-org/whisper.cpp:main-vulkan` e descomente `devices: /dev/dri`.

Se a imagem com GPU não iniciar, volte para `:main` (CPU): com `large-v3-turbo-q5_0`, `-ac 768` e 4 a 8 threads, um trecho de 5 s costuma sair em 1 a 2 s.

## Outros servidores

A extensão também fala o formato da OpenAI (`POST /v1/audio/transcriptions`), usado por Speaches, ScribeCrate (faster-whisper) e LocalAI. Nas opções, escolha "Compatível com OpenAI" e informe o nome do modelo que o servidor espera.
