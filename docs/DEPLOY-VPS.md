# Deploy do CRM na VPS (Docker Swarm + Traefik)

O CRM roda como um serviço no Swarm que **já existe** na VPS, atrás do
Traefik (que já cuida do TLS). Arquivos: [`Dockerfile`](../Dockerfile),
[`docker-stack.yml`](../docker-stack.yml), CI em
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

**Estado hoje:** `crm.cbadvogados.com` ainda aponta para a hospedagem
compartilhada da Hostinger (`91.108.127.34`), **não** para a VPS
(`82.25.76.63`, = `vps.cbadvogados.com`). O passo 1 corrige isso.

---

## 1. DNS — apontar o subdomínio para a VPS  *(sua mão)*

No gerenciador de DNS de `cbadvogados.com` (hPanel → Domínios → DNS, ou
onde o domínio é gerido), no registro **`crm`**:

- Remova o apontamento atual (Hostinger compartilhada).
- Crie: `crm` → **A** → `82.25.76.63`  (ou **CNAME** → `vps.cbadvogados.com`).

Confirme (propaga em minutos):

```bash
dig +short crm.cbadvogados.com   # deve retornar 82.25.76.63
```

O Traefik emite o certificado Let's Encrypt sozinho assim que o DNS
apontar para a VPS e o serviço subir.

## 2. Confirmar os 3 valores do Traefik  *(na VPS)*

O [`docker-stack.yml`](../docker-stack.yml) assume `traefik-public` /
`websecure` / `letsencrypt`. Confira contra um serviço que já funciona:

```bash
docker service inspect evolution_evolution --format '{{ json .Spec.Labels }}' \
  | tr ',' '\n' | grep -i -E 'traefik.docker.network|entrypoints|certresolver'
docker network ls | grep -i traefik
```

Ajuste `NETWORK (1)`, `ENTRYPOINT (2)` e `CERTRESOLVER (3)` no
`docker-stack.yml` para bater com o que aparecer.

## 3. Segredos de runtime na VPS  *(sua mão)*

Crie `crm.env` na VPS (fora do git) com os valores do seu `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://hxnhakmyxyhalbsktzwe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service-role>
ENCRYPTION_KEY=<a mesma 64-hex do .env.local — NÃO gere outra>
AUTOMATION_CRON_SECRET=<cron secret>
# META_APP_SECRET=<vem na virada para a Meta>
# EVOLUTION_WEBHOOK_SECRET=<gerado quando o webhook Evolution entrar>
```

> ⚠️ `ENCRYPTION_KEY` **tem que ser idêntica** à do `.env.local` — o banco
> é o mesmo, e uma chave diferente torna ilegíveis os tokens já salvos.

## 4. Primeiro deploy  *(na VPS)*

```bash
docker login ghcr.io -u <seu-usuario-github>        # se a imagem for privada
set -a && source crm.env && set +a
export CRM_IMAGE=ghcr.io/<owner>/<repo>:latest       # ou deixe o default do stack
docker stack deploy -c docker-stack.yml crm
docker service logs -f crm_crm                       # acompanhar o boot
```

Verifique:

```bash
curl -I https://crm.cbadvogados.com/login            # 200 e cadeado válido
```

## 5. CI/CD (deploys seguintes automáticos)

No GitHub → Settings → Secrets and variables → Actions, adicione:

| Secret | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | mesma do `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | mesma do `.env.local` |
| `VPS_SSH_HOST` | `82.25.76.63` |
| `VPS_SSH_USER` | usuário SSH (ex. `root` ou um deploy user) |
| `VPS_SSH_KEY` | chave privada SSH autorizada na VPS |

A partir daí, todo push na `main` builda a imagem, publica no GHCR e faz
o **rolling update** do serviço (`start-first`, com rollback automático se
o container novo não ficar saudável).

⚠️ **O CI só troca a IMAGEM de `crm_crm`.** O último passo do workflow é
`docker service update --image … crm_crm`. Serviço **novo** no
`docker-stack.yml` (como o `agendador` abaixo) não nasce por push nenhum —
precisa de um `docker stack deploy` à mão, uma vez.

## 6. Agendador  *(na VPS, uma vez)*

⚠️ **Sem este serviço, mensagem agendada não sai.** A migration `925` guarda
a linha; quem a transforma em mensagem é `/api/cb/scheduled/cron`, e nada no
projeto chama essa rota sozinho: o Next não tem agendador embutido, não há
`vercel.json` e o `pg_cron` não está instalado no Supabase. A tabela ficaria
enchendo em silêncio, que é exatamente o que `broadcasts.scheduled_at` faz
desde a migration 001.

```bash
set -a && source crm.env && set +a
export CRM_IMAGE=$(docker service inspect crm_crm \
  --format '{{index .Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)
docker stack deploy -c docker-stack.yml crm
docker service logs -f crm_agendador
```

⚠️ **O `export CRM_IMAGE` não é enfeite.** `docker stack deploy` reconcilia
**todos** os serviços do arquivo, não só o novo. Sem essa linha o `crm_crm`
volta do `:<sha>` que o CI fixou para o `:latest` do arquivo e reinicia. Hoje
o conteúdo é o mesmo (o CI publica as duas tags no mesmo build), mas o
serviço deixa de estar preso à versão que foi testada.

Conferir que ele **alcança** o CRM — o serviço subir não prova nada, porque
o laço engole erro de curl de propósito (para o CRM reiniciando não derrubar
o agendador):

```bash
# Tem de responder {"enviadas":0,"falhas":0,"atrasadas":0}
docker run --rm --network CBAdvNet curlimages/curl:8.11.1 \
  -sS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" \
  http://crm_crm:3000/api/cb/scheduled/cron
```

- `401` → o `AUTOMATION_CRON_SECRET` do agendador não bate com o do `crm.env`.
- `503` → o CRM subiu sem a variável.
- Erro de DNS → o nome do serviço não é `crm_crm` nesta máquina. Confira com
  `docker service ls` e ajuste o `command` do agendador no
  `docker-stack.yml`.

⚠️ **Ele também ressuscita automações e fluxos.** O laço bate em
`/api/flows/cron` e `/api/automations/cron` junto — duas rotas que existem
desde o upstream e **nunca foram chamadas em produção**. Automação com
espera e fluxo com timeout estão parados desde sempre, e ninguém percebeu
porque nada dependia deles. Medido em 2026-08-01, antes de ligar:
`automation_pending_executions` com **0 linhas** e **nenhuma** `flow_runs`
ativa — não há fila represada para drenar de uma vez no primeiro ciclo.

## Notas

- O `HEALTHCHECK` do container bate em `/login`; o Swarm só troca o
  serviço quando o novo container responde.
- Os assets estáticos são servidos pelo próprio Next (standalone) —
  o Traefik faz só o TLS/proxy, não hospeda arquivos.
- Endurecimento futuro: mover `crm.env` para **Docker secrets** em vez de
  variáveis de ambiente.
