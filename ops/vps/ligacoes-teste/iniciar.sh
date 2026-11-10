#!/bin/sh
# Sobe a tela virtual, o áudio virtual, o VNC (só local) e o Chrome.
set -e

mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
# A trava do perfil leva o nome do contêiner: recriado, o Chrome acharia o
# perfil "em uso noutro computador" e não abriria. Só este Chrome usa o perfil.
rm -f /perfil/SingletonLock /perfil/SingletonSocket /perfil/SingletonCookie

# Tamanho da tela (LARGURAxALTURA). Menor = menos pixels para o Chrome
# desenhar no processador (não há placa de vídeo).
TELA="${TELA:-1280x800}"
LARGURA="${TELA%x*}"
ALTURA="${TELA#*x}"

Xvfb :99 -screen 0 "${TELA}x24" -nolisten tcp &
sleep 1

# Áudio virtual:
# - "alto_falante" é a saída do Chrome: o que o CLIENTE fala sai aqui (gravar
#   pelo "alto_falante.monitor");
# - "entrada_mic" recebe o que o ATENDENTE fala (no teste, um arquivo tocado
#   com `paplay --device=entrada_mic`), e o monitor dela vira o "microfone"
#   do Chrome.
pulseaudio --daemonize=yes --exit-idle-time=-1 -n \
  --load="module-native-protocol-unix" \
  --load="module-null-sink sink_name=alto_falante sink_properties=device.description=AltoFalante" \
  --load="module-null-sink sink_name=entrada_mic sink_properties=device.description=EntradaMic" \
  --load="module-remap-source master=entrada_mic.monitor source_name=microfone source_properties=device.description=Microfone"
pactl set-default-sink alto_falante
pactl set-default-source microfone

# A tela sai só por dentro: o VNC escuta no localhost do contêiner, e o
# noVNC (6080) é publicado só no 127.0.0.1 da VPS (acesso por túnel SSH).
x11vnc -display :99 -forever -shared -nopw -localhost -rfbport 5900 -quiet -bg -o /tmp/x11vnc.log
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &

# O perfil (a sessão do WhatsApp) fica em /perfil, montado da VPS.
# CHROME_EXTRA: opções a mais, para medir (ex.: --force-prefers-reduced-motion).
# shellcheck disable=SC2086
exec google-chrome \
  --user-data-dir=/perfil \
  --no-sandbox \
  --no-first-run --no-default-browser-check \
  --disable-dev-shm-usage \
  --window-position=0,0 --window-size="${LARGURA},${ALTURA}" \
  --lang=pt-BR \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9222 \
  ${CHROME_EXTRA:-} \
  https://web.whatsapp.com/
