# Servidores locais (Docker)

Dois serviços opcionais que rodam na sua máquina e deixam a extensão mais rápida:

| Serviço | Porta | O que faz | Onde configurar na extensão |
|---|---|---|---|
| `whisper` (whisper.cpp) | 8080 | Transcrição com Whisper fora do navegador, janela de 15 s | Opções → Motor de transcrição → "Servidor local (Docker)" |
| `libretranslate` (opcional, perfil `translate`) | 5000 | Tradução EN→PT | Opções → Tradução → URL do LibreTranslate |

## Subir

```bash
cd docker
docker compose up -d                        # só o whisper
docker compose logs -f whisper              # na primeira vez baixa o modelo (~470 MB no small.en)
```

O LibreTranslate não sobe por padrão: quem já tem um na porta 5000 (erro `Bind for 0.0.0.0:5000 failed: port is already allocated`) continua usando o que já roda. Para subir os dois juntos:

```bash
docker compose --profile translate up -d
```

Porta ocupada? Mude no `.env`: `WHISPER_PORT=8081` ou `LT_PORT=5001` (e ajuste a URL nas opções da extensão).

Há um `.env.example` ao lado: `cp .env.example .env` e edite. Comentários depois do valor (`# ...`) são ignorados pelo docker compose.

## Se não subir

`docker ps` mostrando `Restarting (...)` sem portas significa que o `whisper-server` saiu logo ao iniciar. Veja o motivo com:

```bash
docker compose logs --tail 30 whisper
```

- `error: unknown argument: ...` seguido do texto de uso: a imagem `:main` mudou as opções do servidor (ele aceita menos flags que o `whisper-cli`). Rode `docker compose pull && docker compose up -d` para pegar o compose atualizado deste repositório.
- `failed to open '/models/ggml-...bin'`: o download do modelo foi interrompido. Apague o volume (`docker compose down -v`) e suba de novo.
- A extensão mostra `Failed to fetch` em "Testar servidor": o container não está ouvindo na porta. Confira com `curl -s http://localhost:8080/ | head -c 100`. O whisper-server já responde com `Access-Control-Allow-Origin: *`, então CORS não é o problema.

Teste: `curl -s http://localhost:8080/ | head -c 200` deve devolver a página do whisper-server. Na extensão, em Opções → "Testar servidor", ele transcreve 1 s de silêncio e mostra o tempo.

## Escolher modelo e janela

Crie um arquivo `docker/.env` (ou exporte as variáveis) e rode `docker compose up -d` de novo:

```
WHISPER_MODEL=small.en              # em CPU: small.en (padrão) ou base.en (mais rápido); large-v3-turbo-q5_0 só com GPU
WHISPER_AUDIO_CTX=768               # 1500 = janela original de 30 s; 768 ≈ 15 s (mais rápido); 0 = padrão do modelo
WHISPER_THREADS=8                   # use o número de núcleos físicos (não os lógicos)
```

Tempo de um trecho de 5 s de fala (`whisper-cli`, só CPU, Ryzen 7 5700X de 8 núcleos, `-ac 768`, sem contar o carregamento do modelo). A transcrição só acompanha a fala se esse tempo ficar bem abaixo da duração do trecho:

| Modelo | 4 threads | 8 threads | Observação |
|---|---|---|---|
| `large-v3-turbo-q5_0` | 6,5 s | 3,9 s | mais lento que o próprio áudio: a legenda atrasa e se acumula |
| `small.en` | — | 0,7 s | padrão; `small.en-q5_1` não é mais rápido (o encoder domina) |
| `base.en` | — | 0,2 s | erra mais com ruído e nomes; use se a CPU for fraca |

Com `-ac 1500` (janela de 30 s) o tempo dobra. 16 threads num processador de 8 núcleos foi mais lento que 8. O `large-v3-turbo` só vale a pena com GPU (abaixo).

O `--audio-ctx` reduzido é uma otimização do whisper.cpp: o encoder processa menos frames, a resposta chega mais rápido e trechos curtos (os da extensão têm no máximo 6 s) não perdem qualidade perceptível. Para frases muito longas, volte para 1500.

## GPU

- **NVIDIA:** o driver na máquina não basta; o Docker precisa do [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) (sem ele, `docker info` mostra só o runtime `runc` e a imagem CUDA não enxerga a placa). Depois de instalar e rodar `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`, troque a imagem para `ghcr.io/ggml-org/whisper.cpp:main-cuda`, descomente o bloco `deploy:` no `docker-compose.yml` e volte para `WHISPER_MODEL=large-v3-turbo-q5_0` no `.env`. Confira com `docker compose logs whisper | grep -i cuda`.
- **AMD/Intel (Vulkan):** imagem `ghcr.io/ggml-org/whisper.cpp:main-vulkan` e descomente `devices: /dev/dri`.

Se a imagem com GPU não iniciar, volte para `:main` (CPU) com `WHISPER_MODEL=small.en`: um trecho de 5 s sai em menos de 1 s com 8 threads.

## Outros servidores

A extensão também fala o formato da OpenAI (`POST /v1/audio/transcriptions`), usado por Speaches, ScribeCrate (faster-whisper) e LocalAI. Nas opções, escolha "Compatível com OpenAI" e informe o nome do modelo que o servidor espera.
