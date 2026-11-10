# Teste A de docs/PLANO-ligar-pelo-crm.md: um Chrome com o WhatsApp Web, numa
# tela virtual (Xvfb) e com áudio virtual (PulseAudio). Só para o teste: não é
# a máquina de ligações de produção.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=pt_BR.UTF-8 \
    TZ=America/Sao_Paulo

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates wget locales tzdata procps \
      xvfb x11vnc novnc websockify \
      pulseaudio pulseaudio-utils sox \
      fonts-noto-core fonts-noto-color-emoji \
 && sed -i 's/^# *pt_BR.UTF-8/pt_BR.UTF-8/' /etc/locale.gen && locale-gen \
 && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
 && apt-get install -y --no-install-recommends /tmp/chrome.deb \
 && rm -f /tmp/chrome.deb \
 && rm -rf /var/lib/apt/lists/*

COPY politica.json /etc/opt/chrome/policies/managed/politica.json
COPY iniciar.sh /usr/local/bin/iniciar.sh
RUN chmod 755 /usr/local/bin/iniciar.sh \
 && useradd -m -u 1000 -s /bin/bash chrome

USER chrome
ENV HOME=/home/chrome \
    XDG_RUNTIME_DIR=/tmp/runtime-chrome \
    DISPLAY=:99
ENTRYPOINT ["/usr/local/bin/iniciar.sh"]
