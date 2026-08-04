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

⚠️ **NÃO use `docker run --network CBAdvNet`.** A rede foi criada sem
`--attachable`, então contêiner avulso é recusado com *"network CBAdvNet not
manually attachable"* — só serviço do Swarm entra nela. (Este comando já
esteve escrito aqui e falhou em produção.)

Duas formas que funcionam, em ordem de preferência:

**1. Pelo batimento, sem tocar na VPS.** É a melhor: prova a corrente
inteira — o agendador subiu, alcançou o CRM pela rede interna, o segredo
bateu, e o ciclo terminou. Basta abrir o CRM: **o aviso âmbar no cabeçalho
some sozinho** em até um ciclo. Por SQL, no Supabase:

```sql
select ultimo_ciclo, now() - ultimo_ciclo as ha_quanto_tempo
  from cb_agendador_batimento;
```

`ultimo_ciclo` em `1970-01-01` = nunca rodou.

**2. Por dentro do próprio contêiner do CRM**, quando quiser ver a resposta
crua. Usa a variável de ambiente do contêiner, então também confere o
segredo:

```bash
docker exec $(docker ps -q -f name=crm_crm | head -1) node -e \
  "fetch('http://localhost:3000/api/cb/scheduled/cron',{headers:{'x-cron-secret':process.env.AUTOMATION_CRON_SECRET}}).then(r=>r.text()).then(console.log)"
```

Tem de responder `{"enviadas":0,"falhas":0,"atrasadas":0,"travadas":0}`.

- `{"error":"Unauthorized"}` → o segredo do agendador não bate com o do CRM.
- `{"error":"cron not configured"}` → o CRM subiu sem `AUTOMATION_CRON_SECRET`.
- Erro de DNS no log do agendador → o serviço não se chama `crm_crm` nesta
  máquina. Confira com `docker service ls` e ajuste o `command` do agendador
  no `docker-stack.yml`.

⚠️ **Ele também ressuscita automações e fluxos.** O laço bate em
`/api/flows/cron` e `/api/automations/cron` junto — duas rotas que existem
desde o upstream e **nunca foram chamadas em produção**. Automação com
espera e fluxo com timeout estão parados desde sempre, e ninguém percebeu
porque nada dependia deles. Medido em 2026-08-01, antes de ligar:
`automation_pending_executions` com **0 linhas** e **nenhuma** `flow_runs`
ativa — não há fila represada para drenar de uma vez no primeiro ciclo.

⚠️ **São DOIS laços desde 2026-08-03, e a separação é proposital.**

| Laço | Bate em | Cada | Por quê |
| --- | --- | --- | --- |
| rápido | `/api/automations/cron` | **60 s** | Acorda o passo "Aguardar", drena a fila de eventos de funil (933) e varre os lembretes por data (935). Num ciclo de 15 min, "esperar 2 minutos" viraria "esperar até 15", e o lembrete de reunião erraria a hora pelo mesmo tanto |
| lento | `/api/cb/scheduled/cron`, `/api/flows/cron` | **900 s** | O número **tem** de bater com `CICLO_MINUTOS` em `src/lib/scheduled/display.ts`, que define a grade de horários que a tela de agendadas oferece. Encolher aqui faz a tela prometer o que o servidor não cumpre |

**Subir os dois exige `docker stack deploy` à mão na VPS** — o `deploy.yml`
só troca a imagem do serviço `crm_crm` e não mexe no `agendador`. Enquanto o
laço rápido não subir, automação com espera e lembrete por data continuam
saindo no ritmo antigo, de 15 em 15 minutos: funcionam, só chegam atrasados.

✅ **Feito em 2026-08-04 17:10 UTC.** Confere assim (a linha do banner só é
impressa quando a tarefa nasce, então use `--since`):

```bash
docker service logs --since 10m -t crm_agendador
```

Tem de aparecer `[agendador] laço rápido (60s) para automações + laço de 15min…`.
Depois disso, **silêncio no log é sinal de saúde**: o `curl -fsS` só imprime
quando falha.

⚠️ **`Could not resolve host: crm_crm` logo após um deploy é normal** e passa
sozinho — o agendador reinicia junto com o `crm_crm` e passa alguns segundos
sem DNS. Só investigue se persistir depois que o rollout terminar; aí sim é o
caso do `docker service ls` descrito acima.

⚠️ **O laço rápido pode morrer em silêncio.** Ele roda em segundo plano (`&`);
o lento, em primeiro. Se o lento cair, o contêiner cai e o Swarm reinicia — dá
para ver. Se o rápido cair sozinho, o contêiner segue de pé fazendo metade do
trabalho e **nada avisa**: só a rota de agendadas tem batimento. Até existir um
carimbo próprio para `/api/automations/cron`, a conferência é manual:

```bash
docker service logs --since 3m -t crm_agendador
```

Três minutos sem nenhuma linha de erro = os dois laços passando.

## Notas

- O `HEALTHCHECK` do container bate em `/login`; o Swarm só troca o
  serviço quando o novo container responde.
- Os assets estáticos são servidos pelo próprio Next (standalone) —
  o Traefik faz só o TLS/proxy, não hospeda arquivos.
- Endurecimento futuro: mover `crm.env` para **Docker secrets** em vez de
  variáveis de ambiente.
