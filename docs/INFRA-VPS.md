# INFRA-VPS — o que existe na VPS e como reconstruir

O banco tem migrations, histórico e ordem de aplicação. A infraestrutura não
tinha nada disso. Este documento é a resposta: **inventário do que roda hoje +
runbook para levantar do zero**.

> **Regra de manutenção, no molde das migrations: toda mudança na VPS ganha uma
> linha aqui, no mesmo PR.** Documento de infra que mente é pior que ausente —
> ele é lido justamente no dia em que ninguém tem tempo de conferir.

**Levantado em:** 2026-08-04, com [`scripts/vps-inventario.sh`](../scripts/vps-inventario.sh).
Para atualizar: `bash scripts/vps-inventario.sh`.

---

## 1. A resposta curta (leia isto primeiro)

**Se a VPS morrer agora, o que se perde?**

| | Sobrevive? | Onde está |
|---|---|---|
| Contatos, conversas, mensagens, funis, automações do **CB CRM** | ✅ **sim** | Supabase (gerenciado, fora da VPS) |
| Arquivos de mídia do CRM | ✅ sim | Supabase Storage |
| **Sessão do WhatsApp** (o pareamento) | ❌ **não** | `postgres_data` + `evolution_instances`, sem backup |
| **Fluxos do n8n** | ❌ **não** | `postgres_data`, sem backup |
| Bots do Typebot | ❌ não | `typebot_typebot-db-data`, sem backup |
| Base vetorial (pgvector) | ❌ não | `pgvector`, sem backup |
| **Definições das stacks** (9 de 10) | ❌ **não** | só em `/root/*.yaml`, fora do git |
| Certificados TLS | ⚠️ regeneráveis | Let's Encrypt reemite sozinho |
| Cache do Redis | ⚠️ descartável | por definição |

⚠️ **O maior risco não é o banco — é `/root/*.yaml`.** Nove das dez stacks
(Traefik, Postgres, Redis, pgvector, Evolution, n8n, Typebot, Portainer,
Chatwoot) existem **apenas como arquivo solto na VPS**. Só a do CRM está
versionada (`docker-stack.yml`). Perder o disco significa reescrever tudo de
memória.

⚠️ **Não existe backup de nada.** Conferido em 2026-08-04: sem crontab do root,
sem tarefa de dump, sem volume espelhado. O `/etc/cron.d` só tem `certbot`,
`docker-image-prune`, `e2scrub_all` e `popularity-contest` — nenhum deles faz
backup.

**O que isso custa na prática:** perder `postgres_data` significa **reler o QR
code** de cada número de WhatsApp, com o escritório sem atendimento até alguém
com o celular na mão refazer o pareamento — e refazer os fluxos do n8n do zero.

---

## 2. A máquina

| | |
|---|---|
| Endereço | `82.25.76.63` = `vps.cbadvogados.com` |
| SO | Ubuntu 20.04.6 LTS (Focal), kernel 5.4.0-216 |
| Disco | 97 GB, 29% usado |
| Memória | 7,8 GB, **sem swap** |
| Docker | 28.0.1, Swarm de **nó único** (`vps`, Leader) |
| Acesso | `ssh root@82.25.76.63`; a chave `~/.ssh/cb-crm-vps` (`claude-leitura-cb-crm`) foi autorizada em 2026-08-04 |

⚠️ **O Ubuntu 20.04 saiu do suporte padrão em 31/05/2025.** Em 2026-08-04 havia
27 atualizações comuns e **163 de segurança** pendentes (estas só via ESM). Não
é urgência de hoje, mas é dívida que só cresce — e uma migração de SO numa
máquina sem backup e sem stacks versionadas é exatamente o cenário que este
documento existe para evitar.

⚠️ **Nó único.** Não há redundância: a máquina é o ponto único de falha de tudo
que não seja o Supabase.

---

## 3. As camadas, na ordem em que dependem umas das outras

Esta é a ordem de reconstrução. Cada camada precisa da anterior de pé.

```
1. Docker + Swarm init
2. Rede overlay CBAdvNet
3. Traefik            (TLS, roteamento)  ─┐
4. Postgres, Redis    (dados)             ├─ infra compartilhada
5. Evolution, n8n, Typebot, pgvector, Portainer, OpenClaw
6. CRM  (crm_crm + crm_agendador)
```

### 3.1 Rede

| Nome | Driver | Sub-rede | Attachable |
|---|---|---|---|
| `CBAdvNet` | overlay | 10.0.1.0/24 | **false** |
| `ingress` | overlay | 10.0.0.0/24 | false |
| `typebot_typebot_internal` | overlay | 10.0.2.0/24 | false |

⚠️ **`CBAdvNet` foi criada SEM `--attachable`**, então contêiner avulso
(`docker run --network CBAdvNet`) é recusado com *"network CBAdvNet not manually
attachable"*. Só serviço do Swarm entra nela. Isso já quebrou um comando de
diagnóstico documentado no `DEPLOY-VPS.md`.

```bash
docker network create --driver overlay --subnet 10.0.1.0/24 CBAdvNet
```

### 3.2 Traefik — `traefik:v2.11.2`

Faz o TLS e o roteamento de **tudo**. Argumentos em uso:

- entrypoints: `web` (:80, redireciona permanente para https) e `websecure` (:443)
- certresolver: `letsencryptresolver`, desafio **HTTP**, e-mail `contato@cbadvogados.com`
- armazenamento ACME: `/etc/traefik/letsencrypt/acme.json`
- provider: `docker` em modo Swarm, `exposedbydefault=false`, rede `CBAdvNet`
- monta `/var/run/docker.sock` e o volume `volume_swarm_certificates`

⚠️ **O volume dos certificados é `volume_swarm_certificates`, não
`traefik-letsencrypt`.** Os dois existem; o segundo é órfão (8 KB, nada monta).
Confundir na hora de restaurar faz o Traefik nascer sem certificado.

### 3.3 Domínios e rotas

Todos apontam para `82.25.76.63` e entram pelo `websecure`.

| Domínio | Serviço | Porta interna |
|---|---|---|
| `crm.cbadvogados.com` | `crm_crm` | 3000 |
| `api.cbadvogados.com` | `evolution_evolution` | 8080 |
| `n8n.cbadvogados.com` | `n8n_n8n_editor` | 5678 |
| `webhook.cbadvogados.com` | `n8n_n8n_webhook` | 5678 |
| `painel.cbadvogados.com` | `portainer_portainer` | 9000 |
| `typebot.cbadvogados.com` | `typebot_typebot-builder` | 3000 |
| `bot.cbadvogados.com` | `typebot_typebot-viewer` | 3000 |
| `openclaw.cbadvogados.com` | `openclaw_openclaw-gateway` | 18789 |

---

## 4. Inventário completo (2026-08-04)

**10 stacks, 16 serviços.**

| Stack | Serviço | Imagem | Réplicas |
|---|---|---|---|
| `traefik` | `traefik_traefik` | `traefik:v2.11.2` | 1 |
| `postgres` | `postgres_postgres` | `postgres:14` | 1 |
| `redis` | `redis_redis` | `redis:latest` | 1 |
| `pgvector` | `pgvector_pgvector` | `pgvector/pgvector:pg16` | 1 |
| `evolution` | `evolution_evolution` | `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix` | 1 |
| `crm` | `crm_crm` | `ghcr.io/leonardocabralb/cb-crm:<sha>` | 1 |
| `crm` | `crm_agendador` | `curlimages/curl:8.11.1` | 1 |
| `n8n` | `n8n_n8n_editor` / `_webhook` / `_worker` | `n8nio/n8n:latest` | 1 / 1 / 1 |
| `typebot` | `typebot_typebot-builder` / `-viewer` / `-db` | `baptistearno/*`, `postgres:16` | 1 cada |
| `portainer` | `portainer_portainer` / `_agent` | `portainer/*` | 1 / global |
| `openclaw` | `openclaw_openclaw-gateway` | `ghcr.io/openclaw/openclaw:latest` | 1 |

⚠️ **A Evolution é um FORK NOSSO**, não a imagem oficial:
`ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix`. Ela carrega a
correção do `@lid` (ver `docs/EVOLUTION-LID-FIX.md`). Restaurar com a imagem
oficial `evoapicloud/evolution-api` **traz o defeito de volta** — e o label
`com.docker.stack.image` da stack ainda aponta para a oficial, o que engana.

⚠️ **Várias imagens estão em `:latest`** (n8n, redis, portainer, typebot,
openclaw). Um `docker service update --force` nelas pode trazer versão nova sem
ninguém pedir. O CRM e a Evolution estão fixados por digest — que é o certo.

### Arquivos de stack, todos em `/root/`

`docker-stack.yml` (CRM, **versionado**), `traefik.yaml`, `postgres.yaml`,
`redis.yaml`, `pgvector.yaml`, `evolution.yaml`, `n8n.yaml`, `typebot.yml`,
`portainer.yaml`, `chatwoot.yaml` (stack desativada).

### Volumes — o que morre com a máquina

| Volume | Tamanho | Conteúdo |
|---|---|---|
| `chatwoot_storage` | **3,6 G** | ⚠️ órfão — nenhum serviço Chatwoot roda |
| `postgres_data` | 882 M | **Evolution + n8n** — o mais crítico |
| `pgvector` | 157 M | base vetorial |
| `chatwoot_public` | 51 M | ⚠️ órfão |
| `typebot_typebot-db-data` | 48 M | bots |
| `redis_data` | 34 M | cache (descartável) |
| `portainer_data` | 836 K | config do painel |
| `chatwoot_mailers` / `chatwoot_mailer` | 268 K | ⚠️ órfãos |
| `volume_swarm_certificates` | 128 K | **certificados TLS em uso** |
| `evolution_instances` | 20 K | sessão do WhatsApp (arquivos) |
| `traefik-letsencrypt` | 8 K | ⚠️ órfão |

⚠️ **`evolution_instances` ter só 20 KB não quer dizer que a sessão é
descartável.** Com `DATABASE_ENABLED=true`, a Evolution guarda o grosso da
sessão no **Postgres** (banco `evolution`). O par que importa é
`evolution_instances` **+** `postgres_data`; restaurar um sem o outro não
recupera o pareamento.

### Segredos de runtime

`/root/crm.env` (fora do git, **corretamente**). Variáveis:

`AUTOMATION_CRON_SECRET`, `ENCRYPTION_KEY`, `EVOLUTION_BASE_URL`,
`EVOLUTION_GLOBAL_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`,
`NEXT_PUBLIC_APP_LOCALE`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`.

⚠️ **`META_APP_SECRET` está no `docker-stack.yml` mas NÃO no `crm.env`** —
opcional hoje, porque a produção roda no transporte Evolution. Vira obrigatória
na virada para a Meta.

⚠️ **`ENCRYPTION_KEY` não pode ser regenerada.** Ela decifra os tokens do
WhatsApp já gravados no Supabase; uma chave nova torna todos ilegíveis e exige
reconectar tudo. Numa migração, **copie a existente** — não gere outra.

⚠️ **`NEXT_PUBLIC_*` são build-arg, não runtime.** Editar o `crm.env` não muda
locale nem URL: eles são inlinados na imagem em tempo de build, no
`deploy.yml`/`docker-stack.yml`. Isso já mordeu (produção inteira em inglês até
2026-07-25).

---

## 5. Runbooks

### 5.1 ⚠️ Depois de um reboot: Evolution e n8n em laço de reinício

**Sintoma.** O CRM responde 200 normalmente, mas **nenhuma mensagem de WhatsApp
entra ou sai**. `docker service ps evolution_evolution` mostra `Failed` a cada
~10 segundos, com `non-zero exit (1)`. O log da Evolution diz:

```
Error: P1001: Can't reach database server at `postgres:5432`
Migration failed
```

**Causa.** A rede overlay do Swarm volta pela metade depois do reinício e a
descoberta de serviços quebra para as tarefas novas. O banco está saudável — o
que não funciona é resolver o nome. Já apareceu neste Swarm também como
*"network sandbox join failed: subnet sandbox join failed for 10.0.1.0/24:
error creating vxlan interface: file exists"*.

**Diagnóstico (2 segundos, sem risco).**

```bash
docker exec $(docker ps -q -f name=postgres_postgres | head -1) pg_isready -U postgres
```

`accepting connections` → o banco está bem; é rede. Siga abaixo.

**Cura.** Forçar a tarefa a nascer de novo e re-entrar na rede:

```bash
docker service update --force evolution_evolution
```

```bash
docker service update --force n8n_n8n_editor
```

**Verificação — a que vale é o fluxo de mensagem, não o HTTP.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -m 10 https://api.cbadvogados.com/
```

E, no Supabase, a prova de ponta a ponta:

```sql
select max(created_at), now() - max(created_at) as ha_quanto_tempo,
       count(*) filter (where created_at > now() - interval '10 minutes') as ultimos_10min
  from messages;
```

Ritmo normal do escritório: ~10 mensagens por 10 minutos em horário comercial.

⚠️ **Não reinicie o `postgres_postgres` depois de os dependentes voltarem** —
derruba a conexão deles de novo. Se precisar, reinicie o Postgres **primeiro** e
só então force os dependentes.

⚠️ **Ignore `deadlock detected` no log do Postgres.** São da tabela `Message` da
própria Evolution e aparecem há semanas sem relação com queda.

⚠️ **Se o `--force` não resolver**, o problema é a rede em si e o remédio derruba
tudo que está de pé, inclusive o que está funcionando. Não faça em horário
comercial sem avisar.

### 5.2 O agendador (laços de cron)

Ver [`DEPLOY-VPS.md`](DEPLOY-VPS.md) §6. Em resumo: `crm_agendador` roda **dois
laços** — rápido (60 s, automações) em segundo plano e lento (900 s, agendadas e
fluxos) em primeiro. O CI **não** sobe serviço novo; exige `docker stack deploy`
à mão.

```bash
docker service logs --since 5m -t crm_agendador
```

Silêncio = saúde (o `curl -fsS` só imprime quando falha).

### 5.3 Deploy do CRM

Automático a cada push no `main` (`.github/workflows/deploy.yml`). O workflow
**só troca a imagem** do `crm_crm`. Qualquer mudança no `docker-stack.yml` exige
o `stack deploy` manual descrito no `DEPLOY-VPS.md`.

---

## 6. Reconstruir do zero

1. **DNS** — apontar `crm`, `api`, `n8n`, `webhook`, `painel`, `typebot`, `bot`,
   `openclaw` (todos `.cbadvogados.com`) para o IP novo.
2. **Docker + Swarm** — `docker swarm init`.
3. **Rede** — `docker network create --driver overlay --subnet 10.0.1.0/24 CBAdvNet`.
4. **Volumes** — restaurar do backup. ⚠️ **Hoje não existe backup**; ver §7.
5. **Traefik** — `docker stack deploy -c traefik.yaml traefik`. Sem certificado
   restaurado, ele reemite sozinho assim que o DNS apontar.
6. **Postgres e Redis** — as stacks próprias, com os volumes já restaurados.
7. **Evolution** — ⚠️ imagem do **nosso fork**. Sem `postgres_data` restaurado,
   exige reler o QR de cada número.
8. **Demais** (n8n, Typebot, pgvector, Portainer).
9. **CRM** — recriar `/root/crm.env` (⚠️ com a **mesma** `ENCRYPTION_KEY`),
   `docker login ghcr.io`, e o `stack deploy` do `docker-stack.yml`.
10. **Segredos do GitHub** — se o IP mudar, atualizar `VPS_SSH_HOST` (e a chave,
    se for outra). Lista no cabeçalho do `deploy.yml`.

---

## 7. Dívidas conhecidas (em ordem de risco)

1. ⚠️ **Sem backup nenhum.** `postgres_data` carrega a sessão do WhatsApp e os
   fluxos do n8n. Um `pg_dump` diário para fora da máquina é barato e resolve o
   pior caso.
2. ⚠️ **9 das 10 stacks só existem em `/root/`.** Um repositório privado com os
   `*.yaml` (sem segredos) elimina o risco de reescrever tudo de memória.
3. ⚠️ **Nada monitora o WhatsApp.** Em 2026-08-04 o escritório ficou ~1 h sem
   atendimento e a descoberta foi acidental. O CRM respondia 200 o tempo todo,
   então qualquer monitor de "o site está no ar?" teria dito que estava tudo bem.
   O sinal certo é o fluxo de mensagens no Supabase, não o HTTP.
4. **Ubuntu 20.04 fora de suporte** (163 atualizações de segurança pendentes).
5. **3,7 GB de volumes órfãos** (`chatwoot_*`, `traefik-letsencrypt`).
6. **Imagens em `:latest`** em 5 serviços — atualização silenciosa num
   `--force`.
7. **`crm.env` como variável de ambiente**, não Docker secret.
8. **Sem swap** em 7,8 GB de RAM.

---

## 8. Histórico de incidentes

### 2026-08-04 — ~1 h sem WhatsApp após reboot da VPS

**17:02 UTC** a VPS reiniciou (causa do reboot não identificada). Quase todos os
serviços voltaram; `evolution_evolution` e os três do `n8n` entraram em laço de
reinício por não resolverem `postgres:5432`.

**Impacto:** nenhuma mensagem entre 17:00 e 18:05 UTC. O ritmo normal é ~30
mensagens/hora. `api.cbadvogados.com` em timeout; `crm.cbadvogados.com`
respondendo 200 o tempo inteiro — por isso nada acusou.

**Descoberta:** acidental, durante o levantamento deste documento. O cabeçalho
do CRM chegou a mostrar *"1 conexão, 1 com problema"* uma hora antes e passou
despercebido.

**Cura:** `docker service update --force` na Evolution e no n8n (§5.1).
Confirmado pelo fluxo de mensagens voltando a 10 por 10 minutos.

**Efeito colateral registrado:** este mesmo reboot derrubou o `crm_agendador`
às ~17:03. O plano de automações havia registrado essa queda como "causa não
identificada" — era o reboot.
