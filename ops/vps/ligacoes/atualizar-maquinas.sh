#!/bin/sh
# A imagem do computador de ligações REMONTADA toda semana, com o Chrome do dia
# (docs/PLANO-ligar-pelo-crm.md §8.7; docs/INFRA-VPS.md §4). O Chrome de uma
# imagem não se atualiza sozinho, e ele abre o que qualquer pessoa manda ao
# número: a imagem velha é falha de segurança conhecida e não corrigida.
#
# Roda na VPS, como root, pelo cron (`ligacoes-imagem.cron`, em
# /etc/cron.d/ligacoes-imagem). Monta a imagem a partir de
# /root/ligacoes/imagem (a cópia do subprojeto) sem cache e com a base nova, e
# troca cada computador (contêiner ligacoes-<nome>, menos a bancada):
# - ⚠️ NUNCA no meio de uma ligação: pergunta à máquina (/estado) e, ocupada
#   ou sem resposta, espera e tenta de novo, até 1 h; não deu, fica para a
#   semana seguinte (no log);
# - recria pelo criar-maquina.sh, com a URL do CRM que o contêiner já tinha (o
#   perfil do WhatsApp e as gravações ficam na pasta); estava ligado, liga de
#   novo; parado, continua parado;
# - confere: ligado, a máquina tem de responder o /estado em 2 min. Não
#   respondeu, VOLTA para a imagem anterior (ainda no disco: o prune da
#   madrugada só apaga imagem sem contêiner depois de 24 h).
# Limite aceito: entre o "livre" e o `docker rm` cabem segundos; uma ligação
# pedida exatamente nessa janela (domingo de madrugada) cai.
set -eu
DATA="$(date -u +%Y%m%d)"
IMAGEM="maquina-de-ligacoes:semanal-$DATA"
LOG=/root/ligacoes/atualizar.log
CRIAR=/root/ligacoes/criar-maquina.sh

registrar() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

# livre | ocupada | (vazio: a máquina não respondeu). O segredo é o DELA, do
# ambiente do contêiner; nunca passa pela linha de comando.
situacao() {
  docker exec "$1" node -e '
    fetch("http://127.0.0.1:8080/estado", {
      headers: { authorization: "Bearer " + process.env.LIGACOES_SEGREDO },
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((e) => process.stdout.write(e ? (e.ligacao ? "ocupada" : "livre") : ""))
      .catch(() => {})' 2>/dev/null || true
}

recriar() { # <contêiner> <nome> <imagem> <url> <ligado>
  docker rm -f "$1" >/dev/null 2>&1 || true
  sh "$CRIAR" "$2" "$3" "$4" >> "$LOG" 2>&1 || return 1
  if [ "$5" = true ]; then docker start "$1" >/dev/null || return 1; fi
}

registrar "montando $IMAGEM"
if ! docker build --pull --no-cache -t "$IMAGEM" /root/ligacoes/imagem >> "$LOG" 2>&1; then
  registrar "a montagem falhou; nada foi trocado"
  exit 1
fi

for c in $(docker ps -a --format '{{.Names}}' | grep '^ligacoes-' | grep -vx 'ligacoes-bancada'); do
  nome=${c#ligacoes-}
  anterior=$(docker inspect -f '{{.Config.Image}}' "$c")
  [ "$anterior" = "$IMAGEM" ] && continue
  url=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c" | sed -n 's/^LIGACOES_URL_DO_CRM=//p')
  ligado=$(docker inspect -f '{{.State.Running}}' "$c")

  if [ "$ligado" = true ]; then
    tentativas=0
    while [ "$(situacao "$c")" != livre ]; do
      tentativas=$((tentativas + 1))
      if [ "$tentativas" -gt 12 ]; then
        registrar "$c ocupado ou sem resposta por 1 h; fica para a próxima semana"
        continue 2
      fi
      sleep 300
    done
  fi

  if ! recriar "$c" "$nome" "$IMAGEM" "$url" "$ligado"; then
    registrar "$c: a recriação com $IMAGEM falhou; volta a $anterior"
    recriar "$c" "$nome" "$anterior" "$url" "$ligado" || registrar "$c: a VOLTA também falhou — conferir à mão"
    continue
  fi

  if [ "$ligado" = true ]; then
    ok=""
    i=0
    while [ "$i" -lt 24 ]; do
      sleep 5
      i=$((i + 1))
      if [ -n "$(situacao "$c")" ]; then ok=1; break; fi
    done
    if [ -z "$ok" ]; then
      registrar "$c não respondeu com $IMAGEM em 2 min; volta a $anterior"
      recriar "$c" "$nome" "$anterior" "$url" true || registrar "$c: a VOLTA também falhou — conferir à mão"
      continue
    fi
  fi
  registrar "$c: $anterior → $IMAGEM ($( [ "$ligado" = true ] && echo ligado || echo parado ))"
done
