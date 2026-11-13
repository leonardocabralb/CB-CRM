#!/bin/sh
# Cria o computador de ligações de UM número (docs/PLANO-ligar-pelo-crm.md,
# §8.13; docs/INFRA-VPS.md, §4). Roda na VPS, como root.
#
# Uso: criar-maquina.sh <nome> <imagem> [url-do-crm]
#   nome        o número, em minúsculas e sem espaço (ex.: previdenciario):
#               vira o contêiner ligacoes-<nome> e a pasta /root/ligacoes/<nome>
#   imagem      a imagem montada na VPS (ex.: maquina-de-ligacoes:20261110)
#   url-do-crm  para onde vão os avisos da máquina (vazio = só no log); da
#               4b em diante, o CRM pela rede interna: http://crm_crm:3000
#
# O segredo é POR computador (4b): HMAC-SHA256 do LIGACOES_SEGREDO do CRM
# (no /root/crm.env) com o nome — o mesmo cálculo de `segredoDoComputador`
# (src/lib/whatsapp/ligacoes/computador.ts). Vai para <pasta>/segredo.env
# (só root lê); o segredo do CRM nunca entra no contêiner. Recriar o
# contêiner (docker rm + este script) refaz o arquivo.
#
# O contêiner nasce PARADO (docker create): ligar é `docker start
# ligacoes-<nome>` e desligar, `docker stop` — com ele parado, o "Ligar" do
# CRM fica desligado ("fora do ar") e a recebida não toca no CRM. O
# --restart unless-stopped respeita o stop, inclusive depois de um reinício
# da VPS. A remontagem semanal (atualizar-maquinas.sh) usa este script e
# devolve o contêiner ao estado em que o achou.
#
# O teto de memória é 1536m; a máquina que precisa de mais o põe no arquivo
# <pasta>/memoria (ex.: 2560m), que este script lê a cada recriação — também
# na remontagem semanal. Medido em 13/11/2026: o WhatsApp Web da Trabalhista -
# Comercial, com muitas conversas, passou de 1,1 GB só na aba ao sincronizar,
# e o sistema matava o Chrome em laço com o teto de 1536m (a máquina nunca
# ficava pronta); com 2560m, pico de 2 GB e ~1,7 GB depois de sincronizar.
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
[ -f /root/crm.env ] || { echo "falta /root/crm.env" >&2; exit 1; }
[ -f "$SECCOMP" ] || { echo "falta $SECCOMP" >&2; exit 1; }
MEMORIA=1536m
if [ -f "$PASTA/memoria" ]; then
  MEMORIA="$(tr -d ' \t\r\n' < "$PASTA/memoria")"
  expr "$MEMORIA" : '[1-9][0-9]*m$' >/dev/null || { echo "memória inválida em $PASTA/memoria: '$MEMORIA' (ex.: 2560m)" >&2; exit 1; }
fi

# Num subshell, como o `stack deploy` o carrega: as outras chaves não saem dele.
SEGREDO_DO_CRM="$(set -a; . /root/crm.env; printf %s "${LIGACOES_SEGREDO:-}")"
[ "${#SEGREDO_DO_CRM}" -ge 32 ] || { echo "falta LIGACOES_SEGREDO (32+ caracteres) no /root/crm.env" >&2; exit 1; }
SEGREDO="$(printf %s "$NOME" | openssl dgst -sha256 -hmac "$SEGREDO_DO_CRM" -r | cut -d' ' -f1)"
case "$SEGREDO" in *[!0-9a-f]* | '') echo "o openssl não devolveu o HMAC" >&2; exit 1 ;; esac
[ "${#SEGREDO}" -eq 64 ] || { echo "o openssl não devolveu o HMAC" >&2; exit 1; }
( umask 077 && printf 'LIGACOES_SEGREDO=%s\n' "$SEGREDO" > "$PASTA/segredo.env" )

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
  --memory "$MEMORIA" --memory-swap "$MEMORIA" --cpus 2 --cpu-shares 256 --pids-limit 1024 --shm-size 256m \
  -v "$PASTA/perfil:/perfil" -v "$PASTA/gravacoes:/gravacoes" \
  --env-file "$PASTA/segredo.env" \
  -e "LIGACOES_COMPUTADOR=$NOME" -e "LIGACOES_URL_DO_CRM=$URL_DO_CRM" -e TELA=800x600 \
  --log-opt max-size=10m --log-opt max-file=3 \
  "$IMAGEM"
