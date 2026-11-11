#!/bin/sh
# Sobe a tela virtual, o áudio virtual e o Chrome, e entrega o processo ao
# orquestrador (docs/PLANO-ligar-pelo-crm.md, §8.13). Se o orquestrador sai, o
# contêiner para e a Docker o reinicia (--restart unless-stopped): um caminho
# só de recuperação.
set -e

mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
# A trava do perfil leva o nome do contêiner: recriado, o Chrome acharia o
# perfil "em uso noutro computador" e não abriria. Apagá-la desarma a proteção
# do Chrome contra DOIS processos no mesmo perfil: UM perfil por contêiner,
# nunca dois contêineres montando o mesmo /perfil (corrompe a sessão do
# WhatsApp).
rm -f /perfil/SingletonLock /perfil/SingletonSocket /perfil/SingletonCookie

# Tamanho da tela (LARGURAxALTURA, só números). 800x600 é o medido no Teste A:
# menos pixels para o Chrome desenhar no processador (não há placa de vídeo).
TELA="${TELA:-800x600}"
LARGURA="${TELA%%x*}"
ALTURA="${TELA#*x}"
case "$LARGURA" in '' | *[!0-9]*) echo "TELA inválida: '$TELA' (use LARGURAxALTURA, ex. 800x600)" >&2; exit 1 ;; esac
case "$ALTURA" in '' | *[!0-9]*) echo "TELA inválida: '$TELA' (use LARGURAxALTURA, ex. 800x600)" >&2; exit 1 ;; esac

Xvfb :99 -screen 0 "${LARGURA}x${ALTURA}x24" -nolisten tcp &
# Espera a tela existir (um sleep fixo falhava com a VPS ocupada).
i=0
until [ -S /tmp/.X11-unix/X99 ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then echo "a tela virtual (Xvfb) não subiu em 10 s" >&2; exit 1; fi
  sleep 0.1
done

# Áudio virtual (medido nos Testes A e B):
# - "alto_falante": a saída do Chrome, onde sai a voz do CLIENTE;
# - "entrada_mic": recebe a voz do ATENDENTE (a ponte toca nela), e o monitor
#   dela, remapeado como "microfone", é o microfone do WhatsApp;
# - "voz_cliente": o monitor do alto-falante remapeado, porque o Chrome
#   esconde os monitores da lista de dispositivos e a ponte precisa capturá-lo.
pulseaudio --daemonize=yes --exit-idle-time=-1 -n \
  --load="module-native-protocol-unix" \
  --load="module-null-sink sink_name=alto_falante sink_properties=device.description=AltoFalante" \
  --load="module-null-sink sink_name=entrada_mic sink_properties=device.description=EntradaMic" \
  --load="module-remap-source master=entrada_mic.monitor source_name=microfone source_properties=device.description=Microfone" \
  --load="module-remap-source master=alto_falante.monitor source_name=voz_cliente source_properties=device.description=VozDoCliente"
pactl set-default-sink alto_falante
pactl set-default-source microfone

# COM a caixa de areia (nada de --no-sandbox): o contêiner precisa do perfil
# seccomp de seccomp/chrome.json, de no-new-privileges e de SYS_CHROOT
# (ops/vps/ligacoes/criar-maquina.sh). A porta de depuração escuta só no
# loopback do contêiner, e só o orquestrador a usa.
# ⚠️ O Chrome nasce SEM o segredo no ambiente: ele abre o que qualquer pessoa
# manda ao número, e uma página comprometida leria o próprio ambiente. Só o
# orquestrador (o `exec node`, abaixo) precisa do segredo.
env -u LIGACOES_SEGREDO google-chrome \
  --user-data-dir=/perfil \
  --no-first-run --no-default-browser-check \
  --disable-dev-shm-usage \
  --window-position=0,0 --window-size="${LARGURA},${ALTURA}" \
  --lang=pt-BR \
  --autoplay-policy=no-user-gesture-required \
  --force-prefers-reduced-motion --disable-smooth-scrolling \
  --disable-background-timer-throttling --disable-renderer-backgrounding \
  --remote-debugging-port=9222 \
  https://web.whatsapp.com/ &

exec node /app/dist/index.js
