#!/usr/bin/env bash
# ============================================================
# Inventário SÓ DE LEITURA da VPS.
#
# Existe porque a infra da VPS não tem nada equivalente às migrations do banco:
# o `docs/DEPLOY-VPS.md` cobre apenas a stack do CRM e assume de pé tudo por
# baixo (Traefik, a rede `CBAdvNet`, a Evolution). Este script é o que responde
# "o que está rodando ali, de fato", e é dele que sai o `docs/INFRA-VPS.md`.
#
# ⚠️ TODO COMANDO AQUI É DE LEITURA. Nada cria, altera, reinicia ou apaga.
# A lista é FIXA de propósito: é ela que o operador revisa uma vez em vez de
# revisar cada comando SSH avulso. Quem acrescentar comando aqui está
# ampliando uma permissão já concedida — trate como tal.
#
# ⚠️ SEGREDO NUNCA SAI DAQUI. O `crm.env` tem a service-role key do Supabase e
# a `ENCRYPTION_KEY` (que, se rotacionada, torna ilegíveis todos os tokens do
# WhatsApp já salvos). O inventário lista apenas os NOMES das variáveis, nunca
# os valores — ver a seção 8. Um `cat crm.env` aqui despejaria os segredos no
# terminal, no histórico e na transcrição da sessão.
#
# Uso:
#   bash scripts/vps-inventario.sh
#   VPS_USER=deploy bash scripts/vps-inventario.sh    # outro usuário
# ============================================================

set -euo pipefail

VPS_HOST="${VPS_HOST:-82.25.76.63}"
VPS_USER="${VPS_USER:-root}"
VPS_KEY="${VPS_KEY:-$HOME/.ssh/cb-crm-vps}"

if [[ ! -f "$VPS_KEY" ]]; then
  echo "ERRO: chave não encontrada em $VPS_KEY" >&2
  exit 1
fi

# `BatchMode=yes` é load-bearing: sem ele, uma chave não autorizada faz o ssh
# PARAR pedindo senha, e um script chamado por automação fica pendurado até o
# tempo esgotar, sem dizer o que houve. Com ele, falha na hora e com motivo.
SSH=(ssh -i "$VPS_KEY" -o BatchMode=yes -o ConnectTimeout=10
     -o StrictHostKeyChecking=accept-new "$VPS_USER@$VPS_HOST")

if ! "${SSH[@]}" true 2>/dev/null; then
  cat >&2 <<AVISO
ERRO: não consegui entrar como $VPS_USER@$VPS_HOST usando $VPS_KEY.

A causa provável é que esta chave nunca foi instalada na VPS — o par existe na
sua máquina desde 2026-07-29, mas o acesso vinha sendo feito por senha.

Autorize-a uma vez (vai pedir a senha do servidor):

    ssh-copy-id -i $VPS_KEY.pub $VPS_USER@$VPS_HOST

Depois rode este script de novo. Se o acesso for por outro usuário:

    VPS_USER=<usuario> bash scripts/vps-inventario.sh
AVISO
  exit 1
fi

secao() { printf '\n\n========== %s ==========\n' "$1"; }

echo "# Inventário da VPS $VPS_USER@$VPS_HOST"
echo "# Gerado em: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# O bloco remoto inteiro numa conexão só. `bash -s` recebe o script por stdin,
# então nada aqui é interpretado pelo shell local.
"${SSH[@]}" 'bash -s' <<'REMOTO'
set -uo pipefail
secao() { printf '\n\n========== %s ==========\n' "$1"; }

secao "1. MÁQUINA"
hostname; uname -srm; uptime
echo "--- disco ---"; df -h / /var/lib/docker 2>/dev/null | head -5
echo "--- memória ---"; free -h 2>/dev/null | head -3

secao "2. DOCKER E SWARM"
docker version --format 'client={{.Client.Version}} server={{.Server.Version}}' 2>/dev/null
docker node ls 2>/dev/null || echo "(não é um manager do Swarm)"

secao "3. STACKS E SERVIÇOS"
docker stack ls 2>/dev/null
echo
docker service ls 2>/dev/null

secao "4. SERVIÇOS EM DETALHE (imagem, réplicas, redes, portas)"
for s in $(docker service ls --format '{{.Name}}' 2>/dev/null); do
  echo "--- $s ---"
  docker service inspect "$s" --format \
'imagem:   {{index .Spec.TaskTemplate.ContainerSpec.Image}}
comando:  {{json .Spec.TaskTemplate.ContainerSpec.Command}} {{json .Spec.TaskTemplate.ContainerSpec.Args}}
replicas: {{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}global{{end}}
redes:    {{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}
montagens:{{range .Spec.TaskTemplate.ContainerSpec.Mounts}} {{.Type}}:{{.Source}}->{{.Target}}{{end}}
labels:   {{json .Spec.Labels}}' 2>/dev/null
  # ⚠️ Só os NOMES das variáveis. O valor fica na VPS.
  echo -n "env (nomes): "
  docker service inspect "$s" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' 2>/dev/null \
    | cut -d= -f1 | tr '\n' ' '
  echo
done

secao "5. REDES"
docker network ls 2>/dev/null
echo
for n in $(docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null); do
  echo "--- $n ---"
  docker network inspect "$n" --format \
    'driver={{.Driver}} attachable={{.Attachable}} escopo={{.Scope}} subnet={{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null
done

secao "6. VOLUMES (o que morre junto com a máquina)"
docker volume ls 2>/dev/null
echo
echo "--- tamanho por volume ---"
du -sh /var/lib/docker/volumes/*/ 2>/dev/null | sort -rh | head -20

secao "7. ARQUIVOS DE STACK ENCONTRADOS"
find /root /home /opt /srv -maxdepth 3 \
     \( -name '*.yml' -o -name '*.yaml' \) -not -path '*/node_modules/*' 2>/dev/null

secao "8. VARIÁVEIS DE AMBIENTE — SÓ OS NOMES"
# ⚠️ NUNCA o valor. `crm.env` guarda a service-role do Supabase e a
# ENCRYPTION_KEY, que decifra todos os tokens do WhatsApp.
for f in $(find /root /home /opt /srv -maxdepth 3 -name '*.env' 2>/dev/null); do
  echo "--- $f ---"
  grep -oE '^[A-Za-z_][A-Za-z0-9_]*' "$f" 2>/dev/null | sort
done

secao "9. TRAEFIK — ROTAS PUBLICADAS"
docker service ls --format '{{.Name}}' 2>/dev/null | while read -r s; do
  docker service inspect "$s" --format '{{$n := .Spec.Name}}{{range $k, $v := .Spec.Labels}}{{if eq $k "traefik.http.routers.'"$s"'.rule"}}{{$n}}: {{$v}}{{end}}{{end}}' 2>/dev/null
done | grep -v '^$' || echo "(nenhuma regra casada pelo nome do serviço — ver labels na seção 4)"

secao "10. AGENDAMENTO EXTERNO (cron do sistema)"
crontab -l 2>/dev/null || echo "(sem crontab do root)"
ls -la /etc/cron.d/ 2>/dev/null | head

secao "11. REINÍCIOS RECENTES DOS SERVIÇOS"
for s in $(docker service ls --format '{{.Name}}' 2>/dev/null); do
  echo "--- $s ---"
  docker service ps "$s" --no-trunc --format \
    '{{.Name}} {{.CurrentState}} {{.Error}}' 2>/dev/null | head -5
done
REMOTO

echo
echo "# Fim do inventário."
