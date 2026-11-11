#!/bin/sh
# Cria o computador de ligações de UM número (docs/PLANO-ligar-pelo-crm.md,
# §8.13; docs/INFRA-VPS.md, §4). Roda na VPS, como root.
#
# Uso: criar-maquina.sh <nome> <imagem> [url-do-crm]
#   nome        o número, em minúsculas e sem espaço (ex.: previdenciario):
#               vira o contêiner ligacoes-<nome> e a pasta /root/ligacoes/<nome>
#   imagem      a imagem montada na VPS (ex.: maquina-de-ligacoes:20261110)
#   url-do-crm  para onde vão os avisos da máquina (vazio = só no log)
#
# O contêiner nasce PARADO (docker create): até a 4c ele só liga nas sessões
# de teste (`docker start ligacoes-<nome>`; ao terminar, `docker stop`). O
# --restart unless-stopped respeita o stop, inclusive depois de um reinício
# da VPS.
set -eu

NOME="${1:-}"
IMAGEM="${2:-}"
URL_DO_CRM="${3:-}"
case "$NOME" in '' | *[!a-z0-9-]*) echo "nome inválido: '$NOME' (só a-z, 0-9 e -)" >&2; exit 1 ;; esac
[ -n "$IMAGEM" ] || { echo "falta a imagem (ex.: maquina-de-ligacoes:20261110)" >&2; exit 1; }

PASTA="/root/ligacoes/$NOME"
SECCOMP=/root/ligacoes/imagem/seccomp/chrome.json
for caminho in "$PASTA/perfil" "$PASTA/gravacoes"; do
  [ -d "$caminho" ] || { echo "falta $caminho (dono 1000, o usuário do contêiner)" >&2; exit 1; }
done
[ -f /root/ligacoes/segredo.env ] || { echo "falta /root/ligacoes/segredo.env" >&2; exit 1; }
[ -f "$SECCOMP" ] || { echo "falta $SECCOMP" >&2; exit 1; }

# - seccomp + no-new-privileges + só SYS_CHROOT: o mínimo com que a caixa de
#   areia do Chrome funciona (medido em 10/11/2026, §8.12 do plano). Serviço
#   do Swarm não aceita perfil seccomp: por isso é contêiner avulso.
# - rede LigacoesNet: só o CRM e as máquinas; nenhuma porta publicada.
# - memória com teto e sem swap: a VPS não tem swap; sem teto, um pico faria
#   o sistema matar o processo maior, que pode ser o Postgres da Evolution.
# - peso 256 no processador: o CRM e a Evolution (1024) passam na frente; com
#   1 núcleo só, a voz que sai da máquina cortava (Teste A).
docker create --name "ligacoes-$NOME" --hostname "ligacoes-$NOME" \
  --init --restart unless-stopped \
  --network LigacoesNet \
  --security-opt "seccomp=$SECCOMP" \
  --security-opt no-new-privileges \
  --cap-drop ALL --cap-add SYS_CHROOT \
  --memory 1536m --memory-swap 1536m --cpus 2 --cpu-shares 256 --pids-limit 1024 --shm-size 256m \
  -v "$PASTA/perfil:/perfil" -v "$PASTA/gravacoes:/gravacoes" \
  --env-file /root/ligacoes/segredo.env \
  -e "LIGACOES_COMPUTADOR=$NOME" -e "LIGACOES_URL_DO_CRM=$URL_DO_CRM" -e TELA=800x600 \
  --log-opt max-size=10m --log-opt max-file=3 \
  "$IMAGEM"
