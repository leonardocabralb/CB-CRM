#!/bin/sh
# Sobe a tela virtual, o áudio virtual, o VNC (só local) e o Chrome.
set -e

mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
# A trava do perfil leva o nome do contêiner: recriado, o Chrome acharia o
# perfil "em uso noutro computador" e não abriria. Apagá-la desarma a proteção
# do Chrome contra DOIS processos no mesmo perfil, então: UM perfil por
# contêiner, nunca dois contêineres montando o mesmo /perfil (corrompe a
# sessão do WhatsApp).
rm -f /perfil/SingletonLock /perfil/SingletonSocket /perfil/SingletonCookie

# Tamanho da tela (LARGURAxALTURA, só números). Menor = menos pixels para o
# Chrome desenhar no processador (não há placa de vídeo).
TELA="${TELA:-1280x800}"
LARGURA="${TELA%%x*}"
ALTURA="${TELA#*x}"
case "$LARGURA" in '' | *[!0-9]*) echo "TELA inválida: '$TELA' (use LARGURAxALTURA, ex. 800x600)" >&2; exit 1 ;; esac
case "$ALTURA" in '' | *[!0-9]*) echo "TELA inválida: '$TELA' (use LARGURAxALTURA, ex. 800x600)" >&2; exit 1 ;; esac

Xvfb :99 -screen 0 "${LARGURA}x${ALTURA}x24" -nolisten tcp &
# Espera a tela existir (um sleep fixo falhava com a VPS ocupada, e o set -e
# derrubava o contêiner sem dizer por quê).
i=0
until [ -S /tmp/.X11-unix/X99 ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then echo "a tela virtual (Xvfb) não subiu em 10 s" >&2; exit 1; fi
  sleep 0.1
done

# Áudio virtual:
# - "alto_falante" é a saída do Chrome: o que o CLIENTE fala sai aqui (gravar
#   pelo "alto_falante.monitor");
# - "entrada_mic" recebe o que o ATENDENTE fala (no teste, um arquivo tocado
#   com `paplay --device=entrada_mic`), e o monitor dela vira o "microfone"
#   do Chrome.
# - "voz_cliente" é o monitor do alto-falante REMAPEADO: o Chrome esconde os
#   monitores da lista de dispositivos (medido no Teste B), e a página-ponte
#   precisa capturar a voz do cliente por um dispositivo que ele mostre.
pulseaudio --daemonize=yes --exit-idle-time=-1 -n \
  --load="module-native-protocol-unix" \
  --load="module-null-sink sink_name=alto_falante sink_properties=device.description=AltoFalante" \
  --load="module-null-sink sink_name=entrada_mic sink_properties=device.description=EntradaMic" \
  --load="module-remap-source master=entrada_mic.monitor source_name=microfone source_properties=device.description=Microfone" \
  --load="module-remap-source master=alto_falante.monitor source_name=voz_cliente source_properties=device.description=VozDoCliente"
pactl set-default-sink alto_falante
pactl set-default-source microfone

# A tela: o VNC escuta só no localhost do contêiner; o noVNC (6080) é
# publicado só no 127.0.0.1 da VPS (acesso por túnel SSH). ⚠️ SEM senha, e o
# websockify escuta em todas as interfaces DO CONTÊINER: qualquer processo da
# VPS chega nele pela bridge (172.17.0.x; medido). Os serviços do Swarm não
# chegam (isolamento entre redes da Docker; medido). Por isso o contêiner
# fica PARADO entre as sessões de teste. O log do VNC vai para o do contêiner.
x11vnc -display :99 -forever -shared -nopw -localhost -rfbport 5900 -quiet &
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &

# Teste B: a sinalização da ponte de áudio e as duas páginas, na 8090 (mesma
# exposição do noVNC, também sem senha). O log dela sai no log do contêiner.
python3 /ponte/sinal.py 8090 &

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
