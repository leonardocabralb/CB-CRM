# INFRA-VPS — o que existe na VPS e como reconstruir

> ⚠️ **Leia este documento INTEIRO antes de qualquer comando na VPS** —
> `docker service`/`docker stack`, reinício de contêiner ou de instância,
> Redis, `crm.env`. É a leitura obrigatória que a raiz do `CLAUDE.md` aponta
> (seção 0, item c). Documento INTERNO: descreve a nossa operação e não vai
> para quem instala. A operação da imagem da Evolution 2.4 e a receita do
> `docker stack deploy` do CRM estão nas §9 e §10; o que envelheceu nesta
> página está anotado na §11; a sentinela do WhatsApp (o cron de hora em hora
> que avisa no sino do CRM), na §12.

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
| **Sessão do WhatsApp** (o pareamento) | ⚠️ **só se o disco sobreviver** | `postgres_data` + Redis db 8. Desde 09/09/2026 há dumps manuais em `/root/backups/` (banco `evolution`, Redis db 8, `RuntimeConfig` da licença), mas no **mesmo disco** e sem rotina |
| **Fluxos do n8n** | ❌ **não** | `postgres_data`, sem backup |
| Bots do Typebot | ❌ não | `typebot_typebot-db-data`, sem backup |
| Base vetorial (pgvector) | ❌ não | `pgvector`, sem backup |
| **Definições das stacks** (8 de 10) | ❌ **não** | só em `/root/*.yaml`, fora do git. A da Evolution está versionada desde 09/09/2026 (`ops/vps/evolution-stack.yml`; segredos em `/root/evolution.env`) |
| Certificados TLS | ⚠️ regeneráveis | Let's Encrypt reemite sozinho |
| Cache do Redis | ⚠️ descartável | por definição |

⚠️ **O maior risco não é o banco — é `/root/*.yaml`.** Nove das dez stacks
(Traefik, Postgres, Redis, pgvector, Evolution, n8n, Typebot, Portainer,
Chatwoot) existem **apenas como arquivo solto na VPS**. Só a do CRM está
versionada (`docker-stack.yml`). Perder o disco significa reescrever tudo de
memória.

⚠️ **Não existe backup automático.** Conferido em 2026-08-04 e de novo em
09/09/2026: sem crontab do root, sem tarefa de dump, sem volume espelhado. O
`/etc/cron.d` tem `certbot`, `docker-image-prune`, `docker-builder-prune`,
`e2scrub_all` e `popularity-contest` — nenhum faz backup (desde 13/10/2026
há também o `saude-whatsapp`, a sentinela da §12, e desde 11/11/2026 o
`ligacoes-imagem`, a remontagem semanal do computador de ligações da §4 —
nenhum dos dois faz backup). O que existe são os
**dumps manuais de 09/09** em `/root/backups/` (do plano da Baileys 7), no
mesmo disco.

⚠️ **`docker-image-prune` roda todo dia às 00:17 com `-a --filter until=24h`**:
apaga TODA imagem sem contêiner e com mais de 24 h — inclusive as imagens de
**rollback** da Evolution (`homolog@1e656f95…` e `lidfix@dd3e46…`). Elas são
públicas (Docker Hub e GHCR) e voltam com `docker pull`, mas o rollback passa
a depender de rede no pior momento. Ver §7.

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
5. Evolution, n8n, Typebot, pgvector, Portainer   (o OpenClaw saiu em 10/11/2026, §8)
6. CRM  (crm_crm + crm_agendador)
```

### 3.1 Rede

| Nome | Driver | Sub-rede | Attachable |
|---|---|---|---|
| `CBAdvNet` | overlay | 10.0.1.0/24 | **false** |
| `ingress` | overlay | 10.0.0.0/24 | false |
| `typebot_typebot_internal` | overlay | 10.0.2.0/24 | false |
| `LigacoesNet` | overlay | 10.0.3.0/24 | **true** |

`LigacoesNet` (desde 10/11/2026) é a rede SÓ do CRM e dos computadores de
ligações (§4): anexável porque eles são contêineres avulsos. Nunca pôr nela o
Postgres, o Redis ou a Evolution. Criada com
`docker network create --driver overlay --attachable LigacoesNet`. Nela
ficam os computadores de ligações e, desde a 4b (10/11/2026), o `crm_crm` (o
`docker-stack.yml` tem a rede; o deploy foi o das três linhas, §10). A máquina
chama o CRM por `http://crm_crm:3000`; o CRM chama a máquina pelo nome do
contêiner (`http://ligacoes-<nome>:8080`, gravado em
`cb_computadores_de_ligacao`).

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
| ~~`openclaw.cbadvogados.com`~~ | removido em 10/11/2026 (§8); o registro DNS ainda aponta para cá e o Traefik responde 404 | — |

---

## 4. Inventário completo (2026-08-04)

**10 stacks, 16 serviços** (desde 10/11/2026, 9 e 15: o OpenClaw saiu, §8).

| Stack | Serviço | Imagem | Réplicas |
|---|---|---|---|
| `traefik` | `traefik_traefik` | `traefik:v2.11.2` | 1 |
| `postgres` | `postgres_postgres` | `postgres:14` | 1 |
| `redis` | `redis_redis` | `redis:latest` | 1 |
| `pgvector` | `pgvector_pgvector` | `pgvector/pgvector:pg16` | 1 |
| `evolution` | `evolution_evolution` | `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto-sessao-status-recibo` (por digest) | 1 |
| `crm` | `crm_crm` | `ghcr.io/leonardocabralb/cb-crm:<sha>` | 1 |
| `crm` | `crm_agendador` | `curlimages/curl:8.11.1` | 1 |
| `n8n` | `n8n_n8n_editor` / `_webhook` / `_worker` | `n8nio/n8n:latest` | 1 / 1 / 1 |
| `typebot` | `typebot_typebot-builder` / `-viewer` / `-db` | `baptistearno/*`, `postgres:16` | 1 cada |
| `portainer` | `portainer_portainer` / `_agent` | `portainer/*` | 1 / global |
| ~~`openclaw`~~ | ~~`openclaw_openclaw-gateway`~~ | removido em 10/11/2026 (§8) | — |

⚠️ **Computador de ligações `ligacoes-previdenciario` (contêiner AVULSO,
desde 10/11/2026, a 4a de `docs/PLANO-ligar-pelo-crm.md`):** o Chrome com o
WhatsApp Web da conexão Previdenciario - Comercial (um aparelho conectado a
mais nesse número) e o orquestrador do subprojeto `maquina-de-ligacoes/`.
PARADO fora das sessões de teste (o CRM fala com ele desde a 4b e tem a tela
de ligar e atender desde a 4c, 11/11/2026; parado, o "Ligar" fica desligado
e a recebida não toca no CRM). Desde a 4e, o CRM só o usa com o INTERRUPTOR
"Ligações pelo CRM" ligado na tela Conexões (1137), e a sentinela (§12) vigia
o contêiner do computador ligado.
Desde 11/11/2026 (23:29 UTC): imagem `maquina-de-ligacoes:20261111-11` (a
etiqueta `CB_SOM` com o som medido de cada lado, contra a fala que o Gemini
inventa sobre áudio sem voz — `.claude/rules/ligacoes-transcricao.md`; montada
à mão, abaixo, em 8 s, e conferida DENTRO da imagem com o ffmpeg 5.1 dela
antes da troca; a cópia anterior do subprojeto ficou em
`/root/ligacoes/imagem.anterior`), URL do CRM `http://crm_crm:3000`, segredo
próprio em `previdenciario/segredo.env`. Rollback = recriar com a
`20261111-10` (a 4e: o `POST /desconectar` do Reparear, o QR vencido que se
recarrega e o sinal de vida na hora em que o WhatsApp muda; o CRM, sem a
etiqueta, só deixa de filtrar).

- **Pastas** (`/root/ligacoes`, 700): `imagem/` (cópia do subprojeto, de onde
  a imagem é montada), `criar-maquina.sh` (= `ops/vps/ligacoes/`),
  `previdenciario/segredo.env` (600, gravado pelo `criar-maquina.sh`: o
  segredo DESTE computador, HMAC do `LIGACOES_SEGREDO` do `crm.env` com o
  nome; nunca impresso), `previdenciario/perfil` (a SESSÃO do WhatsApp:
  protegê-la como o `postgres_data`; dono 1000) e `previdenciario/gravacoes`
  (só até o CRM confirmar o envio). O `segredo.env` compartilhado da 4a, na
  raiz da pasta, foi APAGADO em 11/11/2026, com o "pode" do operador (nada o
  lia desde a 4b).
- **Montar a imagem** (na própria VPS, ~2 min; só as camadas do código, ~10 s):
  copiar o subprojeto para `/root/ligacoes/imagem/` e
  `docker build -t maquina-de-ligacoes:<data> /root/ligacoes/imagem`. O `tar`
  do Mac leva arquivos `._*` (metadados) sem `COPYFILE_DISABLE=1`: os que já
  estão lá são inofensivos (o TypeScript ignora nome começado por ponto).
- **Criar** (nasce parado): `sh /root/ligacoes/criar-maquina.sh previdenciario
  maquina-de-ligacoes:<data> http://crm_crm:3000` (exige o `LIGACOES_SEGREDO`
  no `/root/crm.env`; deriva e grava o segredo da máquina). O script tem o `docker create`
  inteiro: o perfil seccomp do Chrome (`imagem/seccomp/chrome.json`),
  `no-new-privileges`, `--cap-drop ALL --cap-add SYS_CHROOT` (a caixa de
  areia do Chrome, §8.12 do plano), `--init`, `--restart unless-stopped`, a
  rede `LigacoesNet`, os tetos do teste (1,5 GB sem swap, `--cpus 2
  --cpu-shares 256`, 1.024 processos) e NENHUMA porta publicada. Trocar de
  imagem = `docker rm -f ligacoes-previdenciario` e criar de novo (o perfil
  fica na pasta).
- **Ligar e parar:** `docker start ligacoes-previdenciario` /
  `docker stop ligacoes-previdenciario` (o `unless-stopped` respeita o stop,
  inclusive depois de reiniciar a VPS). ⚠️ Imagem anterior à `20261111-9` não
  voltava do stop (laço de reinício: "Daemon startup failed" do PulseAudio);
  a saída era recriar o contêiner. Conferir depois de ligar:
  `docker inspect -f '{{.RestartCount}}' ligacoes-previdenciario` = 0.
- **Remontagem semanal com o Chrome do dia** (§8.7 do plano: o Chrome de uma
  imagem não se atualiza sozinho): `/root/ligacoes/atualizar-maquinas.sh`
  (= `ops/vps/ligacoes/`) monta `maquina-de-ligacoes:semanal-<data>` sem cache
  e com a base nova (~2 min) e troca cada `ligacoes-*` (menos a bancada) pelo
  `criar-maquina.sh`: só com a linha LIVRE (pergunta o `/estado` à máquina;
  ocupada, tenta por até 1 h), devolve o contêiner ligado ou parado como
  estava e, ligado, volta à imagem anterior se a nova não responder em 2 min.
  Log em `/root/ligacoes/atualizar.log`. Rodado à mão em 11/11/2026 com a
  máquina ligada: `20261111-8` → `semanal-20261111` em 2 min 13 s, a máquina
  respondendo. O cron `/etc/cron.d/ligacoes-imagem` (=
  `ops/vps/ligacoes/ligacoes-imagem.cron`: domingo 07:10 UTC, com `flock` e
  `timeout` de 2 h) foi instalado em 11/11/2026, com o "pode" do operador.
  Atualizar o script = copiar o versionado por cima (700); desligar = apagar
  o arquivo do `/etc/cron.d`.
- **No CRM (4b):** cada computador é uma linha de `cb_computadores_de_ligacao`
  (fechada ao navegador): `account_id` e `channel_id` da conexão, `nome` (o
  `LIGACOES_COMPUTADOR`, ex. `previdenciario`) e `endereco`
  (`http://ligacoes-previdenciario:8080`). Gravada à mão (SQL pelo conector,
  com autorização). O CRM só liga e atende com o INTERRUPTOR ligado
  (`ligado_em`, 1137 — o admin liga e desliga em Configurações → Conexões →
  "Ligações pelo CRM"), sinal de vida de menos de 3 min e o WhatsApp da
  máquina conectado: com o contêiner parado, as rotas respondem
  `computador_fora`.
- **Computador para um número NOVO (D17, 4e):** a tela não cria contêiner —
  é aqui. Conferir a memória antes (cada um ocupa ~0,8–1 GiB parado e ~1
  núcleo em ligação; a VPS tem 2 núcleos, D8). Depois: `criar-maquina.sh
  <nome> <imagem> http://crm_crm:3000` (o `<nome>` em `[a-z0-9-]`), a linha em
  `cb_computadores_de_ligacao` (conta, conexão, `nome`, `endereco`
  `http://ligacoes-<nome>:8080`; nasce DESLIGADA), `docker start
  ligacoes-<nome>` e, na tela Conexões, ligar o interruptor e ler o QR com o
  celular do número. O "Reparear" da mesma tela desconecta o WhatsApp da
  máquina para um QR novo.
- **Medido em 10/11:** com o WhatsApp aberto, 840–900 MiB e 170–210
  processos; a caixa de areia ativa (as páginas em outro namespace de usuário
  e de processos).
- **A bancada (aposentada na 4b, 10/11/2026: o CRM faz o papel dela).** Os
  arquivos seguem em `ops/vps/ligacoes/bancada/` para depurar a máquina sem o
  CRM: recriar a máquina com a URL `http://ligacoes-bancada:8091` e trocar,
  no comando abaixo, o `--env-file` pelo `/root/ligacoes/<nome>/segredo.env`.
  Na 4a: `ligacoes-bancada`, um
  `node:22-bookworm-slim` com `/root/ligacoes/bancada` (=
  `ops/vps/ligacoes/bancada/`), na `LigacoesNet`, publicado SÓ em
  `127.0.0.1:8091` (túnel SSH do Mac: `ssh -L 8091:127.0.0.1:8091 …`) e com
  `--rm`: faz o papel do CRM e guarda as gravações em
  `/root/ligacoes/bancada-gravacoes` (dono 1000). A página dela NÃO tem
  senha: fica de pé só durante a sessão (`docker stop ligacoes-bancada`
  remove). A máquina aponta para ela com a URL `http://ligacoes-bancada:8091`
  no `criar-maquina.sh`.

```bash
docker run -d --rm --name ligacoes-bancada --hostname ligacoes-bancada --network LigacoesNet \
  -p 127.0.0.1:8091:8091 --env-file /root/ligacoes/segredo.env -e MAQUINA=http://ligacoes-previdenciario:8080 \
  -v /root/ligacoes/bancada:/bancada:ro -v /root/ligacoes/bancada-gravacoes:/gravacoes \
  --user node --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m \
  node:22-bookworm-slim node /bancada/servidor.mjs
```

~~Contêiner avulso `ligacoes-teste`~~ (os Testes A e B do plano, 10/11/2026):
**removido em 10/11/2026**, com o "pode" do operador — `docker rm`, `docker
rmi ligacoes-teste:5` e `rm -rf /root/ligacoes-teste`. A sessão do WhatsApp
tinha saído dele antes, MOVIDA para o `ligacoes-previdenciario` (é o mesmo
aparelho conectado no celular: nada a tirar em "Aparelhos conectados"). Com
ele saíram a tela remota (noVNC) e a sinalização sem senha que ele expunha e o
Chrome sem a caixa de areia. Os arquivos da montagem seguem em
`ops/vps/ligacoes-teste/`, como registro dos testes.

⚠️ **A Evolution é uma IMAGEM NOSSA**, não a oficial — desde **05/11/2026
09:20 BRT**: `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto-sessao-status-recibo@sha256:5cbbfe22fe402644a6f9c7cec7224c8f67af73562934604e0fccf7773cac0507`
(Evolution **2.4.0** / Baileys **7.0.0-rc13**, construída pelo workflow
`.github/workflows/evolution-cb.yml` a partir do commit `e273b904` do
`develop` oficial, com CINCO patches — a citação do cliente, a foto de perfil
que travava a fila de entrada em 1 msg/min (`docs/PLANO-baileys-7.md`, 5.10),
a sessão única com a reconexão depois do logout e do 408 (§8, 06/10), na
Baileys, o ack do stanza `<status>` (§8, 04/11) e o recibo de grupo por
participante repassado ao webhook (§8, 05/11) — e o `prisma.config.ts`
dentro — ver `docker/evolution-cb/README.md`). De 04/11 10:04 a 05/11 09:20
rodou a `…-citacao-foto-sessao-status@sha256:fdfa22fab01147d67f2b6b9d1752efa991b1c36f9b62e0c266f8151966b069ac`
(os quatro primeiros), que é o **rollback curto** de hoje: mesmo commit, mesmas
migrations, `docker service update --image <ela> evolution_evolution`, sem
mount — e devolve a mensagem de grupo parada em ✓ (o CRM deixa de receber o
recibo por participante; §8, 05/11). Antes dela, de 08/10 10:41 a 04/11 10:04,
a `…-citacao-foto-sessao@sha256:f73197c61fe2ea227df45d6117f101fddd1f2f367709b1817389dba6a3c43805`
(os três primeiros) devolve também a queda a cada 50 min na conta que recebe
`<status>` (§8, 04/11). De 17/09 12:39 a 08/10 10:41, a
`…-citacao-foto@sha256:a7d56788ba127de3c7f759e57addf97bb54c71fedb1e955ab60d672753924126`
(os dois primeiros patches) devolve também os defeitos de sessão da §8
(06/10). Um passo atrás, a
`…-citacao@sha256:dc0f4e8b12de706414609464131b4099de5f0dd29d16bd011b74206089ff1adf`
(só o primeiro patch; 09/09 21:11 a 17/09 12:39) devolve também o teto de 1
msg/min. ⚠️ Qualquer troca de imagem só com a
fronteira de entrega da 1002 em ~0 s em todas as conexões: a Baileys confirma
a mensagem ao servidor ANTES do handler, e o que está na fila em memória morre
com o contêiner (medido em 17/09). O pacote no GHCR é **público**: a VPS o
puxou sem `docker login`. Restaurar com a `evoapicloud/evolution-api:homolog`
oficial exige montar `/root/evolution/prisma.config.ts` em `/evolution/prisma.config.ts`
(sem ele o Prisma 7 não migra e o serviço entra em laço) e perde os dois
patches; restaurar com a 2.3.2 (`lidfix`) traz de volta o "Aguardando mensagem".
A 2.4 exige **licença** (gratuita, cadastro no `/manager`); a ativação fica na
tabela `RuntimeConfig` do banco `evolution` — restaurado o banco, ela volta;
banco novo = cadastrar de novo. O label `com.docker.stack.image` ainda diz
`evoapicloud/evolution-api:latest` — **engana**, nunca pinar por ele. O que
foi medido, decidido e testado está em `docs/PLANO-baileys-7.md`.

⚠️ **Várias imagens estão em `:latest`** (n8n, redis, portainer, typebot).
Um `docker service update --force` nelas pode trazer versão nova sem
ninguém pedir. O CRM e a Evolution estão fixados por digest — que é o certo.

### Arquivos de stack, todos em `/root/`

`docker-stack.yml` (CRM, **versionado**), `evolution-stack.yml` + `evolution.env`
(Evolution, **versionado** em `ops/vps/` sem os segredos, desde 09/09/2026),
`traefik.yaml`, `postgres.yaml`, `redis.yaml`, `pgvector.yaml`, `n8n.yaml`,
`typebot.yml`, `portainer.yaml`, `chatwoot.yaml` (stack desativada).
⚠️ `evolution.yaml` (28/07/2026) está **obsoleto** — imagem 2.3.2, sem as
variáveis novas; não usar.

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
`EVOLUTION_GLOBAL_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `LIGACOES_SEGREDO`
(desde 10/11/2026: o segredo de onde sai o de cada computador de ligações),
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

1. **DNS** — apontar `crm`, `api`, `n8n`, `webhook`, `painel`, `typebot` e `bot`
   (todos `.cbadvogados.com`) para o IP novo.
2. **Docker + Swarm** — `docker swarm init`.
3. **Rede** — `docker network create --driver overlay --subnet 10.0.1.0/24 CBAdvNet`.
4. **Volumes** — restaurar do backup. ⚠️ **Hoje não existe backup**; ver §7.
5. **Traefik** — `docker stack deploy -c traefik.yaml traefik`. Sem certificado
   restaurado, ele reemite sozinho assim que o DNS apontar.
6. **Postgres e Redis** — as stacks próprias, com os volumes já restaurados.
7. **Evolution** — recriar `/root/evolution.env` a partir de
   `ops/vps/evolution.env.example` (os valores: `AUTHENTICATION_API_KEY` é a
   mesma `EVOLUTION_GLOBAL_API_KEY` do `crm.env`; `DATABASE_CONNECTION_URI` e
   `CACHE_REDIS_URI` apontam para `postgres`/`redis` desta rede) e
   `docker stack deploy -c /root/evolution-stack.yml evolution` (imagem por
   digest, pública no GHCR — sem login). Depois:
   - com `postgres_data` **e** Redis db 8 restaurados: as 4 conexões voltam
     `open` sozinhas e a licença já está ativa (`RuntimeConfig`);
   - sem eles: o banco nasce vazio (as 59 migrations rodam no boot), a licença
     tem de ser **ativada no `/manager`** (`leonardocabralb@gmail.com`;
     telefone com o operador) e cada número precisa ser reconectado pelo CRM
     (Conexões → Reconectar → **ler o QR**, 4 celulares).
   Os backups de 09/09 (`/root/backups/evolution-*.dump`, `redis-*.rdb`,
   `evolution-runtimeconfig-*.dump`) restauram os dois pedaços — se o disco
   tiver sobrevivido, ou se tiverem sido copiados para fora.
8. **Demais** (n8n, Typebot, pgvector, Portainer).
9. **CRM** — recriar `/root/crm.env` (⚠️ com a **mesma** `ENCRYPTION_KEY`),
   `docker login ghcr.io`, e o `stack deploy` do `docker-stack.yml`.
10. **Segredos do GitHub** — se o IP mudar, atualizar `VPS_SSH_HOST` (e a chave,
    se for outra). Lista no cabeçalho do `deploy.yml`.

---

## 7. Dívidas conhecidas (em ordem de risco)

1. ⚠️ **Sem backup automático, e nada fora da máquina.** `postgres_data` carrega
   a sessão do WhatsApp e os fluxos do n8n. Desde 09/09/2026 há o roteiro de
   dump manual (banco `evolution` em 3–5 s, Redis db 8 → db 9 + RDB, `RuntimeConfig`,
   spec do serviço — Anexo B do `PLANO-baileys-7.md`), tudo em `/root/backups/`
   no **mesmo disco**. Falta: cron diário + cópia para fora (destino a decidir
   pelo operador).
2. ⚠️ **8 das 10 stacks só existem em `/root/`.** A da Evolution já está em
   `ops/vps/`; um `git add` dos outros `*.yaml` (sem segredos) fecha o resto.
   ⚠️ **O cron `docker image prune -af --filter until=24h` apaga as imagens de
   rollback** da Evolution na madrugada seguinte a qualquer troca. Ou o cron
   perde o `-a` (prune só do que está pendurado, ao custo de imagens velhas do
   CRM acumularem), ou as imagens de rollback ganham um contêiner parado que as
   segure (`docker create --name manter-<nome> <imagem@digest> true`) — decisão
   do operador.
3. ⚠️ **Nada monitora o WhatsApp.** Em 2026-08-04 o escritório ficou ~1 h sem
   atendimento e a descoberta foi acidental. O CRM respondia 200 o tempo todo,
   então qualquer monitor de "o site está no ar?" teria dito que estava tudo bem.
   O sinal certo é o fluxo de mensagens no Supabase, não o HTTP.
   **Desde 13/10/2026:** a sentinela da §12 confere de hora em hora e avisa no
   sino do CRM. Ela roda NESTA máquina, então a VPS inteira fora do ar não é
   avisada por ela.
4. **Ubuntu 20.04 fora de suporte** (163 atualizações de segurança pendentes).
5. **3,7 GB de volumes órfãos** (`chatwoot_*`, `traefik-letsencrypt`).
6. **Imagens em `:latest`** em 4 serviços — atualização silenciosa num
   `--force`.
7. **`crm.env` como variável de ambiente**, não Docker secret.
8. **Sem swap** em 7,8 GB de RAM.

---

## 8. Histórico de incidentes

### 2026-11-10 — OpenClaw removido

Não foi incidente: o operador confirmou que não usa o OpenClaw e pediu a
remoção, para liberar memória para o teste de ligações
(`docs/PLANO-ligar-pelo-crm.md`, Fase 0).

- **O que havia:** um gateway de agente de IA (stack `openclaw`, desde
  08/04/2026), com os arquivos em `/opt/openclaw` (montados no contêiner) e a
  rota `openclaw.cbadvogados.com`. O canal de WhatsApp estava habilitado mas
  nunca foi pareado (sem credencial: não ocupava vaga de aparelho em nenhum
  número). O agente, pelo OpenRouter, falhava por falta de crédito. Nenhum
  fluxo do n8n e nada no CRM o citavam.
- **Cópia** em `/root/backups/openclaw-20261110T172838Z.tar.gz` (1,3 MB, só
  root): config, workspace, os dois arquivos de stack, o `.env` e o
  `auto-approve.sh`. O resto era um clone do código público (commit
  `fdf60c06b0`), sem mudança local.
- **Remoção:** `docker stack rm openclaw`, as imagens (3,17 GB) e
  `rm -rf /opt/openclaw`.
- **Depois:** memória disponível de 3,7 GB para 4,9 GB; disco de 36 GB para
  32 GB usados. Os 15 serviços em 1/1, o CRM em 307, a Evolution em 200, o
  cron em 401 e o domínio do OpenClaw em 404.
- **Falta (operador):** apagar o registro DNS `openclaw`, revogar a chave do
  OpenRouter (está na cópia) e apagar a cópia quando quiser.

### 2026-11-05 — troca para o 5º patch: o recibo de grupo por participante

Não foi incidente: é a Fase 2 de `docs/PLANO-recibos-de-grupo.md` (1119, PR
#457). Mensagem a grupo nunca passava de ✓ no CRM: a Baileys emite o recibo de
cada participante em `message-receipt.update`, e a Evolution só o usava para
marcar as RECEBIDAS como lidas, sem webhook. O 5º patch
(`docker/evolution-cb/recibo-de-grupo.patch`) repassa cada recibo como
`messages.update` com `reciboDoGrupo` e sem `status`, e manda o código do
ERROR (`messageStubParameters`).

- **Imagem** `…-citacao-foto-sessao-status-recibo@sha256:5cbbfe22…` (run
  41925896448), baixada na véspera e conferida DENTRO dela: o ack do
  `<status>`, o recibo de grupo, o `prisma.config.ts` e a Baileys rc13.
- **A espera pela fila.** Na noite de 04/11 a Bancário - Comercial passou 4 h
  sem mensagem 1:1 de cliente, a medição da 1002 venceu, e a troca esperou.
  Em 05/11 às 09:17 BRT a coluna dela tinha 2h31, mas a conexão recebera às
  08:56 uma mensagem de GRUPO com 0,4 s de atraso (`messages.gravada_em −
  created_at`; grupo não alimenta a coluna, `.claude/rules/canais.md`),
  recibos às 09:06 e uma queda 428 de rotina às 09:07, reaberta em 5 s, fora
  da janela de reentrega na hora da troca. As outras três tinham medição 1:1
  de 0,9–1,5 s em até 43 min. A mensagem de grupo valeu como a medição
  fresca da Comercial.
- **Backups** em `/root/backups/*20261105T121940Z*`: o log (26 MB), o dump do
  banco `evolution` (44 MB, 38 tabelas com dados), a spec do serviço e a
  cópia da stack. No db 9, as chaves
  `backup:evolution:instance:<id>:20261105T121940Z`.
- **Troca** por `docker service update --image` (stop-first), de 09:20:42 a
  09:20:53 BRT (11 s). As 4 conexões reabriram no contêiner novo às
  09:21:08–09, 21 s depois de ele subir, sem QR, sem queda e sem erro de
  stream ou de licença; `prisma migrate deploy` sem pendência. As primeiras
  mensagens de cliente foram gravadas com 2,5–2,7 s de atraso.
  `/root/evolution-stack.yml` atualizado; a imagem de rollback, puxada de
  novo para o disco.
- ⚠️ **Custo da janela:** um envio da equipe às 09:21:09, no segundo da
  reabertura, esperou os 15 s do cliente e ficou como entrega incerta. A
  tabela `Message` da Evolution não tem nada dele (tem os envios de 09:21:28
  em diante): NÃO saiu, e o texto precisa ser reenviado à mão. Troca em
  horário de expediente custa isso: antes do expediente, ou com a equipe
  avisada para não enviar no minuto da troca.
- **Prova (14:03 BRT):** uma mensagem pelo CRM num grupo interno liberado
  pelo operador chegou a ✓✓ em 8 s, com os 5 participantes de fora. Nenhum
  recibo dos números do escritório virou linha. Os detalhes estão no fim de
  `docs/PLANO-recibos-de-grupo.md`.

### 2026-11-04 — o `<status>` sem ack: queda a cada 50 min e entrada 23 h atrasada

**Sintoma.** Na Trabalhista e Previdenciário - Jurídico (`trabalhista-juridico-bf8a08`),
o cabeçalho do CRM dizia "Entregando com 23 h de atraso" com a conexão
"Funcionando". As mensagens de cliente chegavam em lotes de 1 a 8 a cada ~50 min
(até 23 h de atraso), e os 73 envios da equipe de 03/11 10h BRT em diante ficaram
em 1 ✓, sem recibo nem `SERVER_ACK`. As outras 3 conexões, no mesmo contêiner,
entregavam em 0,5–1,8 s. A sentinela avisou "sem receber" às 10:05 BRT de 03/11.

**Causa (medida).**
- 19 das 22 quedas da instância no log (03/11 13:03 BRT → 04/11) eram
  `stream:error` com `<ack class="status" type="media|text">`, que a Baileys
  mapeia para 500 (`badSession`, porque `ack` não está no `CODE_MAP`). Em 15 delas
  a sessão durou 49:59–50:11; as outras 3 eram 428/503 comuns. Nas outras
  instâncias, nenhuma: só 428/503 (10 no período).
- O WhatsApp passou a entregar o Status (stories) dos contatos a ESTA conta como
  um stanza `<status>` de topo, e não como `<message from="status@broadcast">`.
  É uma mudança gradual, conta por conta: WhiskeySockets/Baileys#2858, e a
  whatsmeow o trata desde 20/07/2026. A Baileys 7.0.0-rc13 só registra
  `message`, `call`, `receipt`, `notification` e `ack,class:message` (0
  ocorrências de `CB:status` na Baileys e na Evolution do contêiner): o
  `<status>` nunca recebia ack, e ~50 min depois o servidor encerrava o stream
  cobrando-o.
- Em TODAS as 22 sessões, a Evolution repassou eventos da instância só no 1º
  minuto depois de abrir. Do 3º minuto até a queda não passou nenhum, nem
  mensagem nem recibo: a entrega offline, em lotes (`offline_batch` de 100),
  parava no lote com o `<status>` pendente, e cada reconexão andava um lote. As
  6 primeiras sessões do log não trouxeram nenhuma mensagem. Uma sessão de
  03/11 durou 4 h (18:23 → 22:25 UTC), também sem nada depois do 1º minuto.
- Começo: as quedas de hora em hora aparecem na coleta da sentinela na janela
  de 16:05–17:05 UTC de 02/11 (feriado, pouco movimento). No CRM, de 19/10 a
  02/11 nenhuma mensagem dessa conexão passou de 5 min; a primeira atrasada tem
  carimbo de 02/11 20:06 UTC.
- Não adianta: reiniciar a instância (é o que a própria queda faz a cada 50
  min), parear de novo pelo QR (a conta continua recebendo `<status>`) nem o
  `readStatus` (o stanza não chega ao `handleMessage`) — os três medidos por
  outras instalações em #2858.

**Conserto (04/11, autorizado pelo operador).** Quarto patch da imagem, na
Baileys compilada: `docker/evolution-cb/baileys+7.0.0-rc13.patch`, o do PR
WhiskeySockets/Baileys#2866. `ws.on('CB:status')` responde pelo
`sendMessageAck` sem código de erro. Teste local antes: com o patch, o
`<status>` sai com `ack class=status` e o `type`; sem ele, nenhum ack. A imagem
`…-citacao-foto-sessao-status@sha256:fdfa22fa…` (run 41833798488) entrou às
10:04 BRT, com a fronteira da 1002 das outras 3 em 0,6–1,8 s e fora da janela
de reconexão da Jurídico: 11 s de troca, as 4 `open` em 14 s, sem QR, sem
migration pendente.
- Backups em `/root/backups/*20261104T130147Z*`: o log (`.jsonl`, 26 MB), o
  dump do banco `evolution`, a spec do serviço e a cópia da stack. No db 9, as
  chaves `backup:evolution:instance:<id>:20261104T130147Z`.
- `/root/evolution-stack.yml` foi atualizado para o digest novo.

**Depois.**
- **A fila andou em todos os minutos desde a troca.** Antes, ela parava depois
  do 1º minuto de cada sessão. Ritmo de ~12 mensagens por minuto, uma a cada
  ~5 s: o teto da foto de perfil do 2º patch, porque, durante a reentrega, o
  WhatsApp não respondia à consulta da foto.
- **Alcançou o tempo real às 10:34 BRT**, com a fronteira da 1002 em 1,5 s.
  Até então, nenhuma queda nem `stream:error`.
- **Recibos.** Dos 75 envios da equipe desde 03/11 10h, 62 viraram entregue ou
  lido: as mensagens tinham chegado aos clientes, e o recibo é que estava preso.
- **Efeito no CRM.** 31 conversas reabertas com mensagens do acúmulo e nenhuma
  execução de automação ligada à conexão. O LID foi casado em 197 de 197, sem
  nenhuma retida.
- ⚠️ **Em aberto: 143 mensagens chegaram com carimbo de 10:04–10:10 BRT** (59
  de clientes e 84 enviadas pelo celular; as 84 com 2 a 3 por segundo, de
  10:08:30 a 10:09:06). Nenhum desses ids existia antes no banco `evolution` ou
  no CRM, e só 1 aparece no log do contêiner antigo, numa falha ao decifrar.
  São mensagens que o CRM nunca tinha recebido. O horário real em que foram
  escritas NÃO é conhecido: o ritmo indica reentrega em lote do que falhou
  durante a queda, e elas aparecem no fio às 10:04–10:10.

### 2026-10-06 — sessão duplicada no pareamento, `isDeleting` preso e 408 que desfaz o pareamento

Três defeitos da Evolution 2.4 (`e273b904`), vistos no mesmo dia.

**1. Laço 440 na Bancário - Comercial.** O número voltou da suspensão de 24 h
e foi reconectado pelo diálogo de QR do CRM.
- O diálogo chama `/connect` a cada 5 s fora de `open`, e `GET /instance/connect`
  com a memória em `close` SEMPRE abre um socket novo, sem fechar o anterior.
- Logo depois da leitura do QR (o 515) e a cada 440, a Evolution fica 3 s em
  `close` com a reconexão agendada. O connect do CRM nessa janela abriu o
  segundo socket com a mesma credencial: `conflict type=replaced` → 440 →
  reconecta, em laço.
- O "Reparear" cortou o laço, porque o logout liga `isDeleting`. Mas nada o
  desliga: depois disso nenhuma queda reconectava sozinha. Um socket extra de QR
  ainda gravou `connecting` no banco dela, e o CRM mostrou "aguardando leitura
  do QR Code" sobre uma conexão que enviava e recebia.
- Curado às 14:28 BRT com o reinício do contêiner (`docker service update
  --force evolution_evolution`, 14 s, fila em ~1 s nas 3 conexões; as 3 com
  credencial voltaram em ~10 s, sem QR).

**2. A Trabalhista e Previdenciário - Jurídico caiu às 14:05 BRT com 408**
(tempo esgotado de rede) e não voltou.
- 408 está em `codesToNotReconnect`, e esse ramo emite `logout.instance`. O
  `cleaningUp` apagou a linha `Session` (as credenciais: `DATABASE_SAVE_DATA_INSTANCE=true`,
  `CACHE_REDIS_SAVE_INSTANCES=false`) e DEIXOU o hash de chaves Signal
  `evolution:instance:<id>` no Redis db 8.
- Duas leituras de QR depois disso abriram e foram desfeitas pelo lado do WhatsApp
  (`conflict type=device_removed`, 2 e 7 min depois; o celular avisava "não foi
  possível conectar" já na leitura). O hash foi apagado às
  14:46 BRT, com autorização (cópias: `backup:evolution:instance:<id>:20261006T174610Z`
  no db 9 e `/root/backups/redis-juridico-trabalhista-20261006T174610Z.txt`).
- A relação entre as chaves velhas e a remoção não está provada; o pareamento
  seguinte fica para depois do deploy do CRM.
- Mensagens recebidas pelo número enquanto ele estava fora não chegam ao CRM
  sozinhas: o histórico recente que o celular manda num pareamento novo vai só
  para o banco da Evolution (o CRM não assina o evento) e se importa à mão (ver
  "Depois", abaixo).

**Conserto.**
- Imagem: `docker/evolution-cb/sessao-unica-e-reconexao.patch` (um socket por
  instância, `isDeleting` zerado no connect, 408 com pareamento reconecta,
  logout que sempre desloga e zera o QR, limpeza que leva as chaves junto).
- CRM: só pede QR com a instância fechada CONFIRMADA (duas leituras, 6 s entre
  elas), uma operação por instância, o laço do QR encadeado, e o Reparear para
  se o logout falhar com a sessão aberta.
- A troca da imagem, com a fila vazia e o operador ciente, foi um passo à parte
  (abaixo).

Backup do dia: `/root/backups/evolution-20261006T172735Z.dump` (banco `evolution`)
e `/root/backups/evolution-log-20261006T172735Z.txt` (o log do contêiner antigo,
desde 12:44 BRT, com o defeito).

**Depois (06–08/10).**
- 06/10 16:19 BRT: a Jurídico foi pareada PELO "Parear" do CRM já corrigido (um
  socket, 515 → reconexão em 3 s → `open`, sem 440 nem `device_removed`). O
  celular mandou o histórico recente, e as 45 mensagens do intervalo (14:21–16:19,
  8 conversas, 5 mídias) foram importadas em 08/10 pela receita da 1033, lote
  `queda-trabalhista-juridico-2026-10-06`.
- 08/10 10:41 BRT: imagem trocada para a `…-citacao-foto-sessao@sha256:f73197c6…`
  (§4), com a fila em ~1–2 s nas 4 conexões, `docker service update --image`
  stop-first, 11 s de troca; as 4 voltaram `open` sozinhas, sem QR, migrations em
  dia, licença ativa. Antes: log (`/root/backups/evolution-log-20261008T134109Z.txt`),
  dump do banco (`/root/backups/evolution-20261008T134109Z.dump`) e cópia dos 4
  hashes de chaves no db 9 (`backup:evolution:instance:<id>:20261008T134109Z`);
  `/root/evolution-stack.yml` atualizado (cópia anterior em `/root/backups/`).

### 2026-09-30 — sessão legada `.99` descartava toda mensagem de um cliente

**Sintoma.** Nenhuma mensagem de um cliente da Bancário - Comercial (conta
comercial que usa a IA da Meta) chegava ao CRM desde ~10/09, nem as respostas
da equipe pelo celular na conversa dele. O resto da conexão, normal.

**Causa.** A Baileys 6 (2.3.2) gravou a sessão do aparelho HOSPEDADO dele
(aparelho 99) no formato de telefone, `session-<telefone>.99`, no hash
`evolution:instance:<id>` do Redis db 8. Na Baileys 7.0.0-rc13, o
`handleMessage` chama `migrateSession(telefone→LID)` antes de decifrar; quando a
`device-list-<telefone>` traz "99" (ela é gravada no primeiro ENVIO pela
Baileys 7 — aqui, um envio normal do CRM), a migração gera `<lid>:99@lid`,
`jidToSignalProtocolAddress` lança e a mensagem leva NACK, antes da tabela
`Message` e do webhook. Log: `{"error":{},"msg":"transaction failed, rolling
back"}` seguido de `error in handling message` com o nó cru. O master e a rc14
da Baileys têm o mesmo código. Detalhe e reprodução: `PLANO-baileys-7.md`, 9.8.

**Conserto (30/09/2026, 10:09 BRT, autorizado pelo operador).** Um `HDEL` no
db 8 com 8 campos do hash da Bancário - Comercial: os 5 `session-<n>.99` legados
(de 4 contatos) e as 3 sessões de telefone (`.0`/`.2`) dos 2 contatos que já têm
`lid-mapping` — só a `migrateSession` as lia, e ela as copiaria por cima das
sessões LID em uso. Sem reinício. Backup campo a campo, root-only, em
`/root/backups/redis-8campos-20260930T124041Z/` (restauração: `HSET` campo a campo, nunca o hash
inteiro). As mensagens recusadas não voltam: só existem no celular.

⚠️ **Os backups de 09/09 (Redis db 9 e `/root/backups/redis-20260909-*.rdb`)
contêm os `.99` legados.** Restaurá-los recoloca o defeito (além de voltar no
tempo todas as sessões). Depois de qualquer restauração, varrer cada hash
`evolution:instance:*` por campos `^session-[0-9]+\.99$` e tratá-los como
acima. Verificação de uma semana marcada para 07/10/2026.

### 2026-09-09 — upgrade da Evolution para 2.4 (Baileys 7)

Planejado e executado em `docs/PLANO-baileys-7.md`: 2 paradas de ~1 min
(tentativa 1 falhou por falta do `prisma.config.ts` na imagem oficial; a
segunda subiu com o arquivo montado) e uma terceira de 71 s para a troca pela
imagem própria `evolution-api-cb`. Nenhuma conexão pediu QR. Lições que
valem para esta doc: `docker service update --image` começa a troca na hora
(escalar a 0 antes); a foto do Redis envelhece a cada mensagem (tirar com o
serviço parado); `| grep -q` sob `pipefail` é trava falsa; e nos ~6 primeiros
minutos depois de (re)conectar a Baileys 7 entrega a entrada em lotes de
30–120 s antes de normalizar.

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

---

## 9. Evolution 2.4 — operação da imagem

Movido do `CLAUDE.md` em 24/09/2026 (a seção "Baileys 7 / Evolution 2.4"),
sem reescrever. É estado que envelhece: confira com `docker service inspect`
antes de agir. O que foi medido e decidido está em `docs/PLANO-baileys-7.md`.

- Operação (estado em 05/11/2026 09:20 BRT): a imagem é a NOSSA,
  `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto-sessao-status-recibo@sha256:5cbbfe22…`
  (commit `e273b904` do `develop` + patch da citação do cliente + patch da
  foto de perfil + patch da sessão única + o ack do `<status>` na Baileys +
  o recibo de grupo por participante + `prisma.config.ts` dentro —
  `docker/evolution-cb/`), SEMPRE por digest; `TELEMETRY_ENABLED=false`;
  a licença está ativa (tabela `RuntimeConfig` do banco `evolution`); a stack
  completa está em `ops/vps/evolution-stack.yml` (= `/root/evolution-stack.yml`,
  segredos em `/root/evolution.env`), e `docker stack deploy` da Evolution só
  vale para RECRIAR o serviço com esse arquivo, nunca para atualizar (o `.yml`
  não acompanha o `service update`); backup do Redis é SÓ do db 8 (o Redis é
  compartilhado com outros serviços); o log da Evolution morre no reinício do
  contêiner; o cron `docker image prune -af` apaga as imagens de rollback na
  madrugada seguinte (são públicas, voltam com `pull`).
  ⚠️ **Desde 05/11/2026 09:20 BRT a imagem carrega CINCO patches** (o da
  citação; o da foto de perfil que travava a fila de entrada — ver o
  `docs/PLANO-baileys-7.md`, 5.10 e a seção 16; o da sessão única com a
  reconexão — §8, 06/10; o ack do `<status>`, aplicado na Baileys pelo
  `patch-package` — §8, 04/11; e o recibo de grupo por participante — §8,
  05/11). Trocada por `docker service update --image …@sha256:5cbbfe22…`
  (stop-first: 11 s de troca, as 4 conexões voltaram `open` sozinhas 21 s
  depois de o contêiner subir, sem QR, `prisma migrate deploy` sem pendência;
  as anteriores, a `-status` em 04/11 e a `-sessao` em 08/10, entraram do
  mesmo jeito, em 11 s). Rollback = o digest anterior,
  `…citacao-foto-sessao-status@sha256:fdfa22fa…` (mesmo commit, mesmas
  migrations; devolve o grupo parado em ✓). Dois passos atrás, a
  `…citacao-foto-sessao@sha256:f73197c6…` devolve também a queda de 50 min da
  §8, 04/11; três passos atrás, a `…citacao-foto@sha256:a7d56788…` devolve
  também os avisos sem o patch da sessão, abaixo. O `.yml` da stack acompanha
  o digest. ⚠️⚠️ **Trocar o
  contêiner com a fila de entrada represada PERDE a fila para o CRM** (a
  Baileys acka ao servidor ANTES do handler; medido em 17/09: os ~27 min
  represados da Bancário-Comercial ficaram só no celular). Reinício de
  contêiner ou troca de imagem SÓ com `entrega_recebida_em − entrega_carimbo_em`
  da 1002 em ~0 s em todas as conexões.

**Antes de reiniciar o contêiner ou trocar a imagem, confira a fila** (no
Supabase do CRM):

```sql
select label, entrega_carimbo_em, entrega_recebida_em,
       entrega_recebida_em - entrega_carimbo_em as atraso
from cb_channels
where kind = 'evolution'
order by label;
```

Só com `atraso` perto de zero em TODAS as conexões. A medição vale por 1 h (a
régua da 1002): `entrega_recebida_em` velho não diz nada sobre agora —
espere chegar uma mensagem nova.

- `POST /instance/restart/<instância>` (a API da Evolution) segue como
  PALIATIVO do atraso de entrega: drena a fila (16 min em 1 min, medido em
  16/09), não tira a causa. Causa e conserto: `docs/PLANO-baileys-7.md`, 5.10.
- ⚠️ **Na imagem SEM `sessao-unica-e-reconexao.patch`** (a de antes de 08/10/2026
  10:41 BRT — o rollback de três passos acima — ou qualquer outra que o perca):
  - toda instância que passou por um logout (o "Reparear") desde a subida do
    contêiner fica com `isDeleting` ligado. Nela, queda nenhuma reconecta
    sozinha, e o `POST /instance/restart` a deixa FECHADA (o restart derruba o
    socket e conta com a reconexão automática). Só o reinício do contêiner zera;
  - um 408 desfaz o pareamento de vez, e a conexão pede QR novo. 408 é o
    keepalive perdido (~35 s sem resposta) E qualquer erro de rede, DNS ou
    tempo esgotado do handshake numa reconexão de rotina — não precisa de queda
    longa;
  - depois do "Reparear", quem completa o pareamento é o DIÁLOGO aberto (o 515
    da leitura do QR não reconecta sozinho): manter o diálogo aberto até
    "Número conectado". Fechado antes, a conexão fica parada em "Conectando" —
    "Parear" de novo;
  - "Reparear" numa instância que a Evolution já dá como fechada não desloga
    (ela responde "already disconnected") e pode religar o chip ANTIGO sem QR.
    Para trocar de chip, reiniciar o contêiner antes (com a fila vazia);
  - antes de ler um QR numa instância cuja credencial foi apagada por uma queda,
    o hash `evolution:instance:<id>` do db 8 fica com as chaves do aparelho
    morto (ver §8, 06/10).
  Com o patch (a imagem de hoje): o primeiro repareamento depois da troca é a
  prova em produção — procurar no log `Reconnect skipped`, `Ignoring
  connection.update from a superseded socket` e `createClient superseded`. O
  logout SEMPRE apaga credencial e chaves, mesmo com o socket já morto — e aí o
  WhatsApp não é avisado: depois de um Reparear, conferir "Aparelhos conectados"
  no celular e remover o aparelho antigo (conta no limite de 4). ⚠️ A imagem de
  rollback (`…-status@sha256:fdfa22fa…`, desde 05/11) ficou sem contêiner e o
  `docker image prune -af` da madrugada a apaga: rollback = `docker pull` antes
  (pública) — segurá-la com um contêiner parado é a P12, decisão do operador.
- ⚠️ **Voltar de versão da imagem está DESCARTADO por decisão do operador**:
  a atual foi escolhida para resolver o "Aguardando mensagem" (mensagens que
  não chegavam ao cliente). O rollback curto é o digest anterior, no mesmo
  commit (acima).

## 10. Deploy do CRM por `docker stack deploy`

Movido do `CLAUDE.md` (seção "Deploy"), que guarda só a versão curta. O CI
publica com `docker service update --image` e NÃO relê o `docker-stack.yml`:
mudança no `command` do agendador, em variável ou em serviço exige este
deploy à mão (ver também o `docs/DEPLOY-VPS.md`).

- ⚠️⚠️ **`docker stack deploy` SEM carregar o `crm.env` ZERA TODOS os segredos
  de produção — e o site continua respondendo 200.** O `docker-stack.yml` usa
  `${VAR}`, que o Docker substitui pelo **ambiente do shell**: variável ausente
  vira **string vazia**, sem erro nem aviso. O front sobrevive porque todo
  `NEXT_PUBLIC_*` foi inlinado no build, então a tela de login pinta normal
  enquanto o servidor inteiro está sem credencial — webhook não grava mensagem,
  envio não sai, IA não roda, e **as quatro rotas de cron passam a devolver 503**
  (`if (!expected) return 503`), o que derruba agendadas, automações, fluxos e
  Radar de uma vez. Aconteceu em 2026-08-27 e passou despercebido por horas
  porque as verificações usuais (site 200, digest da imagem intocado) **não
  cobrem env vars**. A forma correta, sempre as três linhas juntas:
  ```bash
  set -a; . /root/crm.env; set +a          # sem isto, tudo vira ""
  export CRM_IMAGE="$(docker service inspect crm_crm \
    --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)"  # senão volta para :latest
  docker stack deploy -c /root/docker-stack.yml crm
  ```
  ⚠️ **A imagem sai de `.Spec.TaskTemplate.ContainerSpec.Image`, NUNCA do
  rótulo `com.docker.stack.image`.** Esse rótulo só é reescrito por
  `docker stack deploy`; o CI publica com `docker service update --image`
  (`pipeline.yml`), que não o toca — então ele guarda a imagem do último
  deploy MANUAL e envelhece a cada merge. Medido em 2026-08-29, minutos
  depois de um deploy pelo CI: o rótulo dizia `30bf0b6` (PR #37, dois dias e
  **dez merges** atrás) enquanto o serviço rodava `823061a`. Pinar pelo
  rótulo aqui **rola a produção para trás em silêncio** — e esta é
  justamente a receita que se roda quando algo já está quebrado. O
  `docs/DEPLOY-VPS.md` já usava o campo certo; era esta seção que estava
  fora de passo.
  **Conferir DEPOIS, dentro do container** (o spec do serviço engana — mostra o
  nome da variável mesmo com valor vazio):
  ```bash
  cid=$(docker ps --filter name=crm_crm --format '{{.ID}}' | head -1)
  docker exec $cid printenv SUPABASE_SERVICE_ROLE_KEY | wc -c   # 0 = quebrado
  curl -s -o /dev/null -w '%{http_code}\n' https://crm.cbadvogados.com/api/cb/scheduled/cron
  # 401 = segredo no lugar · 503 = env vazia, produção cega
  ```

⚠️ **`META_APP_SECRET` com vários segredos: sem espaço depois da vírgula.**
Carregado pelo shell (`set -a; . /root/crm.env`), `a, b` faz a variável
SUMIR — todo webhook da Meta vira 401 com o site respondendo 200. Confira no
contêiner com `printenv META_APP_SECRET | wc -c`.

## 11. Divergências conhecidas desta página (conferido em 24/09/2026)

Nada acima foi apagado. O que envelheceu fica anotado aqui até alguém
reescrever a seção.

- §5.2: o laço rápido do agendador é de **15 s** (`sleep 15`), não 60 s. O
  lento (900 s) chama `cb/scheduled`, `flows`, `cb/radar`, `cb/meta-ads`,
  `cb/tldv` e `cb/asaas`. Conferido no `docker-stack.yml`.
- §4 (Segredos), §5.3 e §6 item 10 citam `deploy.yml`: desde 26/08/2026 o
  workflow é o `.github/workflows/pipeline.yml` (o antigo foi consolidado
  nele).

## 12. Sentinela do WhatsApp (desde 13/10/2026)

Pedido do operador: um problema do WhatsApp chegou a correr de 1 a 4 semanas
sem ninguém perceber. A sentinela roda **nesta máquina, de hora em hora**, só
lendo, e avisa no **sino do CRM**: os avisos de UMA conexão vão aos owner/admin
da conta e aos membros cujo perfil vê a conexão (D2), e aparecem também no
**botão das conexões** do cabeçalho do CRM (E1, desde a Fase 4 de
`docs/PLANO-alarmes-de-conexao.md`); os do servidor, aos owner/admin. A análise
semanal aprofundada continua fora daqui (uma rotina no Mac do operador, que lê
os arquivos abaixo por ssh).

**Versionada em `ops/vps/saude-whatsapp/`** (`sentinela.py` e
`saude-whatsapp.cron`). Na VPS:

| Arquivo | O quê |
|---|---|
| `/etc/cron.d/saude-whatsapp` | `5 * * * *`, com `nice -n 10 timeout 300` (a execução leva ~10 s) |
| `/root/saude-whatsapp/sentinela.py` | cópia do versionado (700) |
| `/root/saude-whatsapp/estado.json` | problemas ativos, último aviso de cada um, até onde a coleta leu e as quedas com `ack` das últimas 6 h por instância |
| `/root/saude-whatsapp/coleta/AAAA-MM-DD.jsonl` | uma linha por execução: o TIPO de cada linha de erro/aviso dos logs da Evolution, do CRM e do agendador, com contagem, os recibos ERROR por (conexão, tipo, código) e as QUEDAS por (instância, código, classe do `stream:error`: só a tag e os atributos `class`/`type`/`code` do `reasonNode`, nunca id, to, from nem conteúdo — a instância vem do `Connection update received` logo depois). Nunca o conteúdo: a assinatura corta no primeiro `{`/`[` (o nó cru da mensagem vem por aí), troca o que está entre aspas por `<…>`, apaga e-mail e mascara número, id e chave; objeto impresso na linha seguinte a um ERROR vira `(objeto omitido)`. Apagadas depois de 90 dias |
| `/root/saude-whatsapp/sentinela.log` | uma linha por execução; aparado acima de 2 MB |

**O que lê:** o banco `evolution` (`Instance`, `Message`, `MessageUpdate`);
`docker service ls`; o json-file dos contêineres da Evolution, do `crm_crm` e
do `crm_agendador` (inclusive os parados, enquanto o Docker os guardar); o
Redis db 8 (`HSCAN … MATCH 'session-*.99'` nos hashes `evolution:instance:*`,
uma vez por dia, às 10h de Brasília); `/proc/meminfo` e o disco; e, pelo
PostgREST com a service role do `/root/crm.env`, `cb_channels`, `profiles`
(papel e perfil dos membros ativos), `cb_perfis_de_acesso` (as conexões de cada
perfil), `messages.message_id` (a conferência por id) e os computadores de
ligações ligados (`cb_computadores_de_ligacao`, 4e), com `docker inspect` do
contêiner de cada um. **O que grava:** só
`/root/saude-whatsapp`, linhas `whatsapp_alert` em `notifications` (1085) e os
alarmes de conexão abertos em `cb_alarmes_da_sentinela` (1123): upsert pela
chave (conexão, tipo) a cada execução e, das conexões de produção, apaga o que
a execução não confirmou. Nunca imprime segredo, telefone nem conteúdo de
mensagem.

**Os avisos** (só conexões que casam CRM × Evolution e cujo rótulo ou
instância não tem "teste"):

| Chave | Acende quando | Normaliza quando |
|---|---|---|
| `conexao:<instância>` | `connectionStatus` ≠ `open`, ou a instância nem existe mais no servidor (apagada ou renomeada), conferido de novo 60 s depois | `open` |
| `sem_entrada:<instância>` | dia útil, janela de 2 h inteira entre 8h e 20h: 0 mensagem de cliente e ≥ 5 nossas saindo | chegou mensagem de cliente nas últimas 2 h |
| `nao_gravadas:<instância>` | ≥ 3 mensagens de cliente (1:1, com conteúdo, fora o LID SEM telefone) das últimas 2 h, com mais de 10 min, que a Evolution tem e `messages.message_id` não — conferidas PELO ID (pega também a perda parcial) | só com PROVA: chegou mensagem na janela e todas estão no CRM (conexão quieta não decide nada). O "Normalizou" lembra que as que faltaram precisam ser importadas à mão |
| `falhas:<instância>` | ≥ 3 ERROR do envio PRINCIPAL em 1:1 sem entrega em 24 h (a régua do CRM: `remoteJid` com "@" e sem ":") | < 3 |
| `quedas:<instância>` | ≥ 2 quedas em 6 h com `stream:error` de nó `ack` (o servidor cobrou a confirmação de um aviso sem resposta; o incidente de 03–04/11, §8), a classe no corpo. As 6 h vêm do `estado.json`, sem repetir a mesma queda | < 2, só com PROVA: a coleta da hora em dia, a conexão `open` agora e o log da Evolution com linhas na hora (Evolution parada ou conexão fechada também não têm queda: "não sei" não encerra). A classe só vale do `stream:error` de 0 a 5 s antes da queda e compatível com o código (o `ack` fecha com 500), usado uma vez |
| `descartadas` | "error in handling message" no log da Evolution (mensagem descartada antes do banco: o caso da §8, 30/09). O log não diz de quem é: o aviso traz a conexão PROVÁVEL | é evento: no máximo um aviso a cada 6 h; o que chega dentro do intervalo, ou que o sino recusa, fica em `eventos_pendentes` e sai somado depois, para os destinatários de então |
| `sessao99` | campo `session-<n>.99` em algum hash (§8), por `HSCAN … MATCH` (nunca `HKEYS`: o Redis é compartilhado), uma vez por dia a partir das 10h — e de novo a cada hora até dar certo no dia. ⚠️ Só chave do tipo HASH: a Evolution grava também `evolution:instance:whatsapp_web_version` como texto, e o `redis-cli` devolve o `WRONGTYPE` com código 0 — em 13/10 isso virou um laço que travou a execução das 15:05 (encerrada à mão) | 0 |
| `replica:<serviço>` | só os vigiados — `crm_crm`, `crm_agendador`, `evolution_evolution`, `postgres_postgres`, `redis_redis`, `traefik_traefik` — com réplicas rodando ≠ esperadas, desligados (`scale …=0`, que aparece como "0/0") ou ausentes do Swarm, conferido de novo 60 s depois. Os outros serviços (n8n, Typebot…) ficam na semanal | iguais e diferentes de zero (⚠️ manutenção que escala a Evolution a 0 acende o aviso — é o esperado) |
| `maquina:<nome>` | (4e) o computador de ligações com o INTERRUPTOR ligado no CRM (`cb_computadores_de_ligacao.ligado_em`, 1137) cujo contêiner avulso `ligacoes-<nome>` não está rodando (fora do Swarm, ele não aparece no `docker service ls`), conferido de novo 60 s depois. Desligado no CRM, não é vigiado. Vai aos owner/admin da conta dona; o botão das conexões do CRM já mostra o "sem sinal" por conta própria | rodando |
| `disco` / `memoria` | disco > 85% / `MemAvailable` < 300 MB (conferida de novo) | abaixo do limite |
| `sentinela_cega` | alguma medição falhou ("não medido") em 3 execuções seguidas — sem isto, a sentinela cega só deixaria uma linha no `sentinela.log` | uma execução sem "não medido" |

Um aviso por problema novo, um lembrete ("Continua — …") a cada 24 h enquanto
durar e um "Normalizou — …" quando passa. Todo problema entra em `ativos` no
momento em que é VISTO, avisado ou não (`avisado_em` nulo = o sino ainda não
recebeu): o aviso recusado sai na execução seguinte e, se o problema já
passou, vira "Aconteceu e já normalizou — …". Do mesmo jeito, a normalização
vista fica guardada (`normalizou_em`) até o "Normalizou" entrar: sem isso, uma
hora sem medição decisiva voltaria a afirmar o problema. Problema avisado e sem medição
nova (conexão quieta, banco fora) também ganha o lembrete — só a prova de
normalização o encerra. O que deixou de ser vigiado (conexão apagada do CRM)
sai em silêncio.

**Quem recebe.** O aviso de uma conexão (`conexao:`, `sem_entrada:`,
`nao_gravadas:`, `falhas:`, `quedas:`) vai só à conta DONA dela (a da medição
mais recente; nunca somada a um dono anterior), do primeiro aviso ao
"Normalizou": aos owner/admin e aos membros ATIVOS cujo perfil vê a conexão
(D2: sem perfil, ou com a lista de conexões vazia, vê todas), a mesma régua do
sino do CRM. Conexão que saiu do CRM: só os owner/admin. O do computador de
ligações (`maquina:`) vai só aos owner/admin da conta DONA dele
(`PREFIXOS_DA_CONTA`). Os do servidor (réplica, memória, disco, `sessao99`,
`descartadas`, `sentinela_cega`) vão aos owner/admin de toda conta com conexão
de produção.

**O botão das conexões do CRM (1123).** Os avisos de conexão ABERTOS (vistos,
avisados ou não, e sem a prova do fim) de `sem_entrada:`, `nao_gravadas:`,
`falhas:` e `quedas:` viram linhas de `cb_alarmes_da_sentinela`, com o `desde` e
o `visto_em` desta execução; o `conexao:` fica de fora (a sonda do CRM vê a
queda ao vivo). A sonda da saúde ignora linha com `visto_em` de mais de 3 h: a
sentinela parada, ou a VPS fora, não deixa alarme preso no botão. Falha na
gravação vai ao `sentinela.log` e não derruba a execução. Em 13/10/2026 só a conta do escritório tinha conexão de produção: as
outras duas contas com conexão na Evolution só têm conexão de teste.

**Calibragem (13/10/2026).** O `sem_entrada` foi medido contra 5 semanas de
histórico: disparou 3 vezes, 2 delas no incidente de 16/09 (a fila de entrada
presa). Sem a exigência de saídas, dispararia em todo dia parado e em todo
feriado. O log da Evolution cobria só ~6 h nesse dia (rotação de 10m × 3 com o
log em VERBOSE): por isso a coleta é de hora em hora.

**Cada parte falha sozinha.** Réplica, memória, disco e conexão rodam mesmo
com o banco da Evolution fora (o Postgres parado aparece como
`replica:postgres_postgres`, não como checagem pulada); sem o banco, conexão e
mensagens ficam `NÃO MEDIDO` — nunca "normalizou". Sem o `crm.env` (ou com o
Supabase fora) a coleta segue. Erro de rede ao gravar o aviso não derruba a
execução (o aviso fica para a seguinte). A coleta entra inteira ou não entra
(linha parcial seria contada duas vezes), e arquivo de log que não abre (a
rotação no meio da leitura) faz a coleta da hora falhar — a seguinte relê a
janela. As consultas ao banco da Evolution rodam em transação só de leitura.

**Limites conhecidos.** A VPS inteira fora do ar não avisa (a sentinela roda
nela). Sem o `/root/crm.env` (ou com a service role vazia, §10), a coleta
continua, mas o aviso não sai: o `sentinela.log` registra `NÃO MEDIDO: CRM`.
O log de um contêiner REMOVIDO some com ele (o parado o Docker guarda no
histórico de tarefas, e a coleta o lê). O `sem_entrada` não tem histerese:
numa conexão de pouco volume pode alternar entre aviso e "Normalizou"; e os
feriados em dia útil não estão no calendário (a exigência de ≥ 5 saídas é o
que os cala). Os avisos do servidor podem citar conexão de outra conta (o
`descartadas` traz a conexão provável, e a `sentinela_cega` o erro da
medição): uma segunda conta com conexão de produção pede revisão disso.

**Comandos** (na VPS):

```bash
install -d -m 700 /root/saude-whatsapp
```

```bash
install -m 700 /tmp/sentinela.py /root/saude-whatsapp/sentinela.py
```

```bash
install -m 644 /tmp/saude-whatsapp.cron /etc/cron.d/saude-whatsapp
```

Conferir sem gravar nada (nem estado): `python3 /root/saude-whatsapp/sentinela.py --simular`.
Atualizada em 11/11/2026 (21:52 UTC) com a checagem do computador de ligações
(4e); a anterior ficou em `/root/saude-whatsapp/sentinela.py.anterior`, e o
`--simular` depois da troca saiu sem problema e sem "não medido".
Mandar um aviso de teste aos administradores: `--teste-aviso`. Atualizar =
copiar o `sentinela.py` novo por cima. Desligar = apagar
`/etc/cron.d/saude-whatsapp` (a pasta fica; o histórico da coleta está nela).
