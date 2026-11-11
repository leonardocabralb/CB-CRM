# Computador de ligações (docs/PLANO-ligar-pelo-crm.md, §8.13): o Chrome com
# o WhatsApp Web de UM número, numa tela e com áudio virtuais, comandado pelo
# orquestrador em Node. Montado na própria VPS a partir desta pasta. Roda COM
# a caixa de areia do Chrome: o contêiner exige o perfil seccomp de
# seccomp/chrome.json e SYS_CHROOT (ops/vps/ligacoes/criar-maquina.sh).
#
# A major do Node é a do .nvmrc (22). `FROM` não lê arquivo do contexto, então
# o número se repete aqui, como no Dockerfile da raiz: mudou um, muda os dois.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS montagem
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=pt_BR.UTF-8 \
    TZ=America/Sao_Paulo

# O Chrome é o estável do DIA da montagem: a imagem não se atualiza sozinha.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates wget locales tzdata procps \
      xvfb pulseaudio pulseaudio-utils ffmpeg \
      fonts-noto-core fonts-noto-color-emoji \
 && sed -i 's/^# *pt_BR.UTF-8/pt_BR.UTF-8/' /etc/locale.gen && locale-gen \
 && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
 && apt-get install -y --no-install-recommends /tmp/chrome.deb \
 && rm -f /tmp/chrome.deb \
 && rm -rf /var/lib/apt/lists/*

COPY politica.json /etc/opt/chrome/policies/managed/politica.json
COPY iniciar.sh /usr/local/bin/iniciar.sh
COPY ponte.html /app/ponte.html
COPY --from=montagem /app/package.json /app/package.json
COPY --from=montagem /app/node_modules /app/node_modules
COPY --from=montagem /app/dist /app/dist
RUN chmod 755 /usr/local/bin/iniciar.sh

# O usuário `node` (uid 1000) já vem na imagem base: é o dono de /perfil e de
# /gravacoes na VPS.
USER node
ENV HOME=/home/node \
    XDG_RUNTIME_DIR=/tmp/runtime-node \
    DISPLAY=:99
ENTRYPOINT ["/usr/local/bin/iniciar.sh"]
