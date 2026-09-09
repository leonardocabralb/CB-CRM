# PLANO — Baileys 7 na Evolution: o conserto do "Aguardando mensagem"

> **Plano vivo.** Atualizar a cada fase: marcar as caixas, registrar as medições e
> as decisões com data. Foi escrito para sobreviver à compactação do contexto de
> quem o executa — tudo o que foi medido e decidido até aqui está registrado, com
> a fonte. Quem retomar o trabalho começa por **"Estado"** e **"Próximo passo"**.

| | |
| --- | --- |
| **Criado** | 09/09/2026 |
| **Estado** | **Fase 0 CONCLUÍDA** (09/09/2026): backup com restauração de prova, limpeza das órfãs/hashes e amostras feitos na VPS; ajustes 1–3 do CRM mesclados no `main` (PR #161) e este plano mesclado (PR #162). **Pré-voo, parte só de leitura, feita em 09/09 18:10** (9.2): imagem candidata intacta (rc13), 4 conexões `open`, serviço atualiza em `stop-first`. Versão da Evolution **não** mudou — continua 2.3.2 + `lidfix`. |
| **Próximo passo** | **Fase 1** (seção 6.2), numa janela marcada pelo operador com os 4 celulares à mão. Antes: a parte de backup do pré-voo (6.2.0, item 4 — dump novo, db 9 renovado, restauração de prova) e a decisão P2. A ordem do upgrade e do rollback mudou em 09/09 (revisão do Codex): **escalar a 0 antes de trocar a imagem**, e tirar a **foto final** com o serviço parado. |
| **Como retomar sem contexto** | Ler a **seção 0** abaixo primeiro; o prompt de retomada está no **Anexo C**. A memória privada do executor (`baileys-7-plano-e-decisoes.md`) guarda o telefone do cadastro. |
| **Estudo de origem** | seções 2–4 deste documento condensam o estudo de 09/09 |
| **Docs relacionadas** | `docs/EVOLUTION-LID-FIX.md` (fica OBSOLETA com este plano), `docs/INFRA-VPS.md`, `docs/DEPLOY-VPS.md`, `docs/INSTALACAO.md` |

## 0. Como retomar este plano sem o contexto de quem o escreveu

Quem pega este plano depois de uma compactação de contexto (ou outra pessoa)
precisa só do que está aqui, da memória privada do executor e dos acessos
abaixo. Nada foi deixado implícito de propósito.

### 0.1 Onde está cada coisa

| O quê | Onde |
| --- | --- |
| Repositório / trunk | `leonardocabralb/CB-CRM`, branch `main`. **Nunca** PR ou push para `ArnasDon/wacrm`. Branch nova sai só de `origin/main`, e numa **worktree separada** — em 09/09 outra sessão deixou o checkout principal em `feat/instagram-receptor-de-teste`; não mexer nele. |
| VPS (Swarm) | `ssh -i ~/.ssh/cb-crm-vps root@vps.cbadvogados.com`. Serviços: `evolution_evolution` (Evolution), `crm_crm` (CRM), `postgres_postgres` (banco `evolution`, `psql -U postgres` pelo socket entra sem senha), `redis_redis` (db 8 = Evolution; **db 9 = cópia de backup**; db0/db2 são de outros serviços). |
| Banco do CRM (Supabase) | projeto `hxnhakmyxyhalbsktzwe`, pelo conector MCP (`execute_sql`). |
| Backups da Fase 0 | `/root/backups/` na VPS, carimbo `20260909-1704` (dump, RDB, instances, log, env, imagem, migrations, amostras). |
| Imagem candidata | já **puxada** na VPS: `evoapicloud/evolution-api:homolog@sha256:1e656f95aa1a2b7c2455a6a36d654637ddc2658c263794a5074ada798412a549` (Evolution 2.4.0, Baileys 7.0.0-rc13, Node 24). |
| Imagem atual (rollback) | `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694` |
| Cadastro da licença | e-mail `leonardocabralb@gmail.com`; **telefone só na memória privada** (`baileys-7-plano-e-decisoes.md`) ou com o operador. |
| Contato para testes reais | "Leonardo Cabral Baptista" (memória `lead-de-teste-autorizado`; único destinatário autorizado para mensagem de teste). Testar num contato endereçado por LID: conferir em `IsOnWhatsapp`. |
| Código do CRM que este plano mexeu | `src/lib/whatsapp/transport/evolution-inbound.ts` (`lidJidFromKey`), `evolution-group-inbound.ts` (`lidDoRemetente`, `senderLid`), `src/lib/cb-groups/persist.ts` (`aprenderNossoLid`), `src/lib/cb-groups/sync.ts` (`parseGroupInfo`), `src/app/api/whatsapp/evolution/webhook/route.ts`; nota em `CLAUDE.md` antes de "## Branches". |
| Regras que não se negociam | `docker stack deploy` **proibido** para a Evolution (só `service update`); imagem **por digest**; backup do Redis **só do db 8**; log da Evolution morre no reinício do contêiner; `GROUP_UPDATE` só entra na lista de eventos **depois** do upgrade; ação destrutiva pede autorização explícita do operador **naquela conversa**. |

### 0.2 O que já foi feito (linha do tempo)

| Quando | O quê | Prova |
| --- | --- | --- |
| 09/09 tarde | Diagnóstico: sessões duplicadas por aparelho na Baileys 6.7.19; imagens, 463, WA Web e celular do cliente descartados | seção 2 |
| 09/09 | Decisões do operador: rc13 via `develop`/`homolog`, cadastro aceito (e-mail/telefone informados), upgrade **no lugar** com backup testado, 2.3.7 pura descartada | seção 3 |
| 09/09 17:04 | Backup completo em `/root/backups/` | 9.1 |
| 09/09 17:25 | Restauração de prova: **todas as tabelas batem** no mesmo corte, 0 avisos | 9.1 |
| 09/09 17:27 | Instâncias órfãs `Bancario` e `CBAdv` apagadas; 6 hashes do Redis apagados (cópias no db 9); laço de QR parou; 4 conexões `open` | 9.1, Anexo A |
| 09/09 | Amostras de payload da 2.3.2 guardadas na VPS (600) | 9.1 |
| 09/09 | Ajustes 1–3 do CRM + testes (95/95, lint, typecheck) — **PR #161 mesclado no `main`** | seção 5 |
| 09/09 | Este plano — **PR #162 mesclado** | — |
| 09/09 18:43 | Segunda passada do pré-voo (itens 11–15): linhas de base de latência/entrada/decifragem, migrations da imagem, endpoint de licença, `DEL_INSTANCE`, `Chat` sem duplicata | 9.2 |
| 09/09 noite | Revisão adversarial do roteiro (3 lentes + crítico): 6.2, 8.4, 10 e Anexo B reescritos — script por passo com preâmbulo, foto final conferida, rollback por **rename** de banco (sem `dropdb`), portão de licença só HTTP, `EVOLUTION_OPERATOR_EMAIL` morto, `AUTHENTICATION_API_KEY` exposta no boot (P9), migration em laço, `BGSAVE` | 0.4, 6.2, 8.4, 10, 14 |
| 09/09 18:24 | Pré-voo, parte de backup: dump novo (14,3 MB), db 9 renovado (36 = 36), RDB, restauração de prova **bate em todas as tabelas, 0 avisos**. Achado da cascata do `DELETE` das órfãs (9.3) | 9.3 |
| 09/09 18:10 | Revisão do Codex no #162 avaliada: rollback **reordenado** (escalar a 0 antes de trocar a imagem — procede); `FLUSHDB` do db 9 já estava no commit final; participante por `id` telefone já coberto no código do #161 (o texto de 5.3 estava defasado e foi sincronizado). Pré-voo **só de leitura** executado na VPS | 9.2, seção 10 |

### 0.3 O que NÃO foi feito (e é o próximo trabalho)

- A **Fase 1** inteira (seção 6.2): trocar a imagem, ativar a licença, conferir as 4 conexões, rodar T1–T22, observar 48 h.
- O **pré-voo** da Fase 1 (seção 6.2.0), no dia da janela.
- P2 (forma de `group_sender_jid`), ajuste 4 (`fileLength`, depende de medição), ajuste 5 (`GROUP_UPDATE`, depois do upgrade), docs da seção 5.6, fixtures anonimizadas a partir das amostras.
- A parte de **backup** do pré-voo (6.2.0, item 4) — só faz sentido no dia da janela, porque a foto envelhece.
- **Apagar TODAS as worktrees paralelas ao fim de todo o trabalho** (pedido do operador em 09/09, para não ocupar espaço): `git worktree list` no checkout principal e `git worktree remove` de cada uma, inclusive as de outras sessões já encerradas (em 09/09 havia `wt-tldv`, `wt-calendly`, `wt-codex-2`, `migracao-kommo`, `wf_…/ensaio-2` e a desta sessão, `wt-pv`). As duas desta sessão da Fase 0 (`wt-plano`, `wt-fix`) já foram removidas em 09/09. Item na Fase 2.

### 0.4 Armadilhas encontradas na execução (para não repetir)

- `docker service logs evolution_evolution` (sem `--since`) **trava depois de imprimir tudo**; usar `--since` ou `timeout`.
- No `psql` do contêiner, `-d <banco>` vem **antes** de `-Atc`, senão o `-d` vira o SQL.
- `Message.id` da Evolution é **cuid (texto)**, não inteiro; e a produção continua recebendo enquanto se confere — comparar contagens no **mesmo corte de `messageTimestamp`** (Anexo B).
- `DELETE /instance/delete` responde `Instance deleted` mas a remoção é **assíncrona** (5 s depois ainda aparecia `close`); conferir 1 min depois.
- As chaves `evolution:baileys:*` têm TTL e expiram também na cópia do db 9; os hashes `evolution:instance:*` não têm TTL — são eles que importam.
- Comandos longos por SSH (dump + restore) passam de 10 min: rodar em segundo plano e ler a saída depois.
- O checkout principal pode estar em outra branch por causa de sessões paralelas: **sempre `git branch --show-current` antes de qualquer `checkout -b`**, e preferir worktree.
- `docker service update --image` **começa a troca na hora** (o serviço está em `stop-first`, medido em 09/09): num rollback, trocar a imagem com o serviço vivo sobe a 2.3.2 contra o banco já migrado pela 2.4 e o Redis com estado v7 — **escalar a 0 primeiro** (achado do Codex no PR #162; seção 10).
- **Apagar instância na Evolution apaga o histórico dela no banco da Evolution** (`onDelete: Cascade` em todas as tabelas filhas de `Instance`): as 2 órfãs levaram ~278 mil `Message`, 4,4 mil `Chat` e 11 mil `Contact` — invisíveis para as conexões vivas e duplicados no Supabase, mas o executor **não avisou isso antes** de pedir a autorização. Regra: antes de apagar instância, contar as linhas dela e dizer ao operador o que vai junto. Preservado no dump de 17:04 (9.3).
- **Variável de shell envelhece**: `$CID` aponta para OUTRO contêiner depois de cada `scale`/`update` (e é vazio a 0 réplicas); sessão SSH nova não tem as variáveis da anterior; `docker exec $CID … > arquivo` com `$CID` vazio cria o arquivo **vazio** sem parar nada. Por isso o Anexo B virou blocos com preâmbulo, a `KEY` sai da especificação do serviço e os passos mandam **reler `CID`**. E o `pg_restore` da prova apontava para `evolution-$(date +%F).dump` enquanto o dump gravava `evolution-$CARIMBO.dump` — pego pela revisão adversarial antes de doer.
- **O portão de licença só barra a API HTTP**: entre o `scale=1` e a ativação a Evolution **recebe** (instâncias conectam, webhooks chegam ao CRM) e o CRM **não consegue enviar nem baixar mídia** (503). Ativar imediatamente e recolher o intervalo (6.2, passos 4 e 8). O `fetchInstances` também responde 503 — o gatilho "open em 10 min" se mede no banco/log.
- **Migration que falha vira laço**: `RestartPolicy any/5 s` recria o contêiner para sempre, cada subida repete o `prisma migrate deploy` (P3009), e `docker service scale` sem `--detach` espera uma convergência que não vem. Sempre `--detach` + `docker service ps`.
- Cópia local de fonte pode ser **página de erro**: `baileys-v7-migration.md` e `CHANGELOG.md` no scratchpad eram um 503 do Varnish (470 bytes) até a noite de 09/09 — a revisão adversarial pegou. Conferir tamanho e `<title>` de tudo que se baixa antes de citar. Re-baixados: o guia v7 (283 KB, real) e `messages-recv.ts` da rc13 e da 6.7.19.
- O estado Signal no Redis **muda a cada mensagem** (ratchet): uma cópia tirada horas antes restaura sessões velhas e o cliente não decifra o que vem depois. Por isso a **foto final** (dump + db 8 → db 9 + RDB) é tirada com o serviço **a 0**, segundos antes da troca (6.2, passo 1). A do pré-voo serve de prova de restauração.

**Sumário**

1. [O que acontece hoje](#1-o-que-acontece-hoje)
2. [O problema (diagnóstico com medições)](#2-o-problema-diagnóstico-com-medições)
3. [A resposta (decisões)](#3-a-resposta-decisões)
4. [O que muda de contrato entre o CRM e a Evolution](#4-o-que-muda-de-contrato-entre-o-crm-e-a-evolution)
5. [O que vai ser alterado no CRM](#5-o-que-vai-ser-alterado-no-crm)
6. [O que vai ser mexido na infraestrutura](#6-o-que-vai-ser-mexido-na-infraestrutura)
7. [Riscos](#7-riscos)
8. [Testes de aceitação](#8-testes-de-aceitação)
9. [Fases e checklist](#9-fases-e-checklist)
10. [Rollback](#10-rollback)
11. [Plano B de emergência (paliativo)](#11-plano-b-de-emergência-paliativo)
12. [Decisões pendentes e perguntas em aberto](#12-decisões-pendentes-e-perguntas-em-aberto)
13. [Anexo A — estado medido em 09/09/2026](#13-anexo-a--estado-medido-em-09092026)
14. [Anexo B — comandos de referência](#14-anexo-b--comandos-de-referência)
15. [Fontes](#15-fontes)

---

## 1. O que acontece hoje

**Sintoma.** Mensagens enviadas pelo CRM chegam ao celular do cliente como
*"Aguardando mensagem. Essa ação pode levar alguns instantes."* — com ✓✓ — e
o cliente responde "não está chegando suas mensagens". O **celular do
escritório** (aparelho pareado à mesma conta) mostra o mesmo aviso nas
próprias mensagens. É intermitente: numa mesma conversa, duas falham e a
terceira é lida.

**Casos medidos (09/09/2026, conexão Bancário - Comercial):**

| Hora | Cliente | Tipo | Origem | Status no CRM | No aparelho |
| --- | --- | --- | --- | --- | --- |
| 14:05:40 | Vitor | texto | CRM via Evolution (`from_device=false`) | `delivered` | "Aguardando mensagem" |
| 14:06:51 | Vitor | texto | CRM via Evolution | `delivered` | "Aguardando mensagem" |
| 14:08:35 | Vitor | texto | CRM via Evolution | **`read`** | chegou normal |
| 14:46:53 | Humberto | texto (com citação) | CRM via Evolution | `delivered` | "Aguardando mensagem" |

**Correção de premissa.** A queixa original falava em imagens. Os quatro casos
são **texto**. O problema não é de mídia.

**Por que o CRM não vê.** Em 12 dias, **zero** mensagens `failed`. O ✓✓ é
verdadeiro: os bytes chegaram; a **chave** para abri-los é que não serviu. O
WhatsApp não avisa o remetente disso. Hoje a única forma de descobrir é o
cliente reclamar. `Message.status = PENDING` no banco da Evolution **não**
indica falha (a mensagem lida de 14:08 também está `PENDING`; os acks chegam
pelo LID e a coluna não é atualizada).

**Contexto de uso.** O CRM **ainda não é o sistema principal**. O escritório
trabalha pelo celular pareado e por outro CRM: em 09/09 foram 105 textos pelo
celular contra 1 pelo CRM (08/09: 265 × 15). A Evolution está pareada como um
dispositivo vinculado nos 4 números reais do escritório.

---

## 2. O problema (diagnóstico com medições)

### 2.1 A causa

A Evolution 2.3.2 embarca a biblioteca **Baileys 6.7.19 (31/08/2025)** — o
`package.json` da tag declara `"baileys": "github:WhiskeySockets/Baileys"`,
**sem versão**; a nossa imagem congelou na data em que foi construída. Essa
versão **não conhece o endereçamento LID** que o WhatsApp adotou desde então.
Resultado: ela trata o LID como se fosse *outro telefone* e mantém **duas
sessões de criptografia para o mesmo aparelho** — uma pelo número, outra pelo
LID. Cada envio escolhe uma delas; quando cai na que o aparelho já descartou,
o cliente recebe os bytes sem a chave.

**Provas (Redis da instância Bancário - Comercial, hash `evolution:instance:44982408-…`):**

| Contato | Sessões gravadas | Leitura |
| --- | --- | --- |
| Vitor (5511995313317 ↔ LID 276819265749011) | `session-5511995313317.0`, `.99`, `session-276819265749011.0`, `.99` | **4 sessões para 2 aparelhos** |
| Humberto (555491761508 ↔ LID 29266007871686) | `session-555491761508.0`, `session-29266007871686.0` | **2 sessões para 1 aparelho** |
| Nosso número (5511964102992) | `.0 .21 .22 .29` | celular + **3 aparelhos vinculados** — cada envio é cifrado 4 vezes a mais |
| Em todos os hashes | sessões em formato LID (`_1`): **0**; `lid-mapping`: **0** | a biblioteca não faz ideia do que é LID |

- Enviamos para `…@s.whatsapp.net`; os recibos (`MessageUpdate`) voltam por
  `…@lid`. A Evolution **sabe** o mapeamento (`IsOnWhatsapp`:
  `5511995313317@s.whatsapp.net` ↔ `276819265749011@lid`); a biblioteca não o usa.
- Escala: **3.325 dos 7.019 chats** e **12.267 dos 22.618 `IsOnWhatsapp`** já são
  LID; **6.103 das 6.501** mensagens do CRM em 30 dias têm `remote_jid_lid`
  (medição das 16h de 09/09).
- Log da Evolution 4 min depois de subir: `Closing stale open session for new
  outgoing prekey bundle` — a linha exata das issues da Baileys.

### 2.2 O que foi descartado

| Hipótese | Por que não |
| --- | --- |
| Imagens | os quatro casos são texto |
| Bloqueio 463 / `tctoken` ("PENDING para sempre") | tudo é entregue (✓✓) e mensagens vizinhas são lidas |
| `CONFIG_SESSION_PHONE_VERSION` antiga | a variável está cravada em `2.3000.1025193442`, mas o log mostra a 2.3.2 buscando a atual (`2.3000.1047094411`, 10×) — ignorada |
| Celular do cliente | dois clientes e o nosso próprio aparelho falharam juntos |
| `Message.status = PENDING` como sinal | a de 14:08, lida, também é `PENDING` |

### 2.3 Achados de carona (não são a causa; entram na Fase 0)

- **Duas instâncias órfãs em laço de QR** (a cada ~45 s, `QRCODE_LIMIT=1902`):
  `Bancario` (id `385dac9a-…`, criada 06/2025, `ownerJid` **5511964102992 — o
  mesmo número da Bancário - Comercial**, 9.454 chaves no Redis) e `CBAdv`
  (`c68ecb8d-…`, `ownerJid` 558386262646 — o mesmo da Trabalhista - Jurídico,
  3.074 chaves). Não existem no CRM.
- **4 hashes no Redis de instâncias já apagadas**: `f71807c0-…` (3.078
  campos), `7fc75fe2-…` (86), `dcbf9851-…` (30), `60a309e7-…` (2.720).
- **1 duplicata em `Chat(instanceId, remoteJid)`**, na órfã `Bancario` — a
  migration da 2.4.0 cria índice único ali (com dedup antes).
- **O log da Evolution morre no reinício**: driver `json-file` (10 MB × 3), e o
  Swarm recria o contêiner — o log da hora da falha (14:05) se perdeu com o
  reboot da VPS às 14:47:59. Um `0` num grep sobre esse log não prova nada.
- A VPS foi **reiniciada em 09/09 às 14:47:59** (boot anterior desde 03/09
  09:00). O reinício funciona como o paliativo "reconectar" (sem QR).
- O celular do escritório tem **3 aparelhos vinculados** além do celular
  (Evolution, outro CRM, WhatsApp Web/Desktop) — desligar o outro CRM, já
  planejado, reduz o número de sessões a manter em dia.

---

## 3. A resposta (decisões)

### 3.1 O conserto

**Baileys ≥ 7.0.0-rc13.** É a linha que (a) cria as sessões no formato LID e
migra as existentes sozinha, (b) recria sessão quebrada automaticamente
(`enableAutoSessionRecreation: true` por padrão) e (c) manda o `tctoken`/
`cstoken` que o WhatsApp exige para não contar cada mensagem como "abordagem a
desconhecido" (o erro 463). A própria linha 6 foi abandonada para isso: a nota
da v6.7.21 diz *"Move to 7.0.0-rc.6 as soon as possible."*

A Baileys só chega até nós por dentro da Evolution:

| Versão da Evolution | Baileys | "Aguardando" | 463 | Cadastro obrigatório | Migrations novas | Prisma / Node | Release |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **2.3.2 + `lidfix` (hoje)** | 6.7.19 + patch nosso | tem | não tem (tolerado) | não | — | 6 / 20 | sim |
| 2.3.7 | 7.0.0-rc.9 | resolve | **cria** | não | +2 | 6 / 20 | sim (05/12/2025) |
| 2.4.0-rc2 | 7.0.0-rc.9 | resolve | **cria** | sim | +4 | 7 / 24 | pré-release (17/05/2026) |
| **`develop` = imagem `homolog`** | **7.0.0-rc13** | resolve | resolve | sim | +4 | 7 / 24 | não — branch (último commit 14/07/2026) |

**Descartadas:** 2.3.7 pura e 2.4.0-rc2 (rc.9 traz o "PENDING para sempre":
sem o carimbo, o WhatsApp conta toda mensagem como abordagem a estranho, o
limite estoura em dias e o número entra numa quarentena que dura dias — e o
risco de restrição do número é exatamente o que o escritório não pode correr).

**Escolhida (09/09/2026, confirmada pelo operador):** `develop`/`homolog`, com
o cadastro (seção 7.3) — e-mail do cadastro `leonardocabralb@gmail.com`; o
telefone foi informado e fica fora deste documento de propósito (pedir ao
operador na hora da ativação). **Alternativa** descartada, registrada para
histórico: 2.3.7 com `npm install baileys@7.0.0-rc13` no entrypoint — sem
cadastro, combinação não testada pelo projeto, e a 2.3.7 **perde o LID no
payload** (seção 4.2).

**Imagem candidata, conferida em 09/09 na própria VPS** (`docker pull` +
inspeção, sem tocar no serviço):
`evoapicloud/evolution-api:homolog@sha256:1e656f95aa1a2b7c2455a6a36d654637ddc2658c263794a5074ada798412a549`
— criada 14/07/2026, 1,53 GB, **Evolution 2.4.0, Baileys 7.0.0-rc13,
`tc-token-utils` presente, Node 24.18.0, `patches/` vazio**. (Um relato de
21/07 dizia que o `homolog` ainda tinha rc.9 — era imagem antiga em cache; a
conferência local decide.)

### 3.2 Como aplicar

**Upgrade no lugar, com backup testado — sem ambiente paralelo.** Decisão do
operador em 09/09/2026, porque o CRM ainda não é o sistema principal: o
escritório continua atendendo pelo celular e pelo outro CRM durante a obra, e
o pior caso realista do rollback é **ler 4 QRs** num momento em que ninguém
depende do CRM. Daqui a meses, com a equipe dentro do sistema, esse custo não
caberia — é o argumento para fazer agora.

O paliativo (purga de sessões, seção 11) **não** foi escolhido como resposta:
é reset, a duplicidade volta em dias ou semanas. Fica documentado como plano
de emergência.

---

## 4. O que muda de contrato entre o CRM e a Evolution

### 4.1 O que NÃO muda (conferido nos fontes das três versões)

- **21 endpoints** que o CRM chama: `message/sendText`, `message/sendMedia`,
  `message/sendWhatsAppAudio`, `message/sendReaction`, `chat/markMessageAsRead`,
  `chat/deleteMessageForEveryone`, `chat/updateMessage`, `chat/sendPresence`,
  `chat/getBase64FromMediaMessage`, `chat/findChats`, `chat/fetchProfilePictureUrl`,
  `group/findGroupInfos`, `group/updateGroupSubject`, `webhook/set`, `webhook/find`,
  `instance/connectionState`, `instance/connect`, `instance/logout`,
  `instance/delete`, `instance/create`, `instance/fetchInstances` — todos
  existem no `develop`, mesmas rotas e corpos. `sendMessage.dto` só ganhou
  opcionais (`messageId`, `gifPlayback`); `webhook.schema.ts` é **byte a byte
  igual** ao da 2.3.2; `instance.dto` aceita `integration`, `qrcode`, `token` e
  o `webhook` aninhado.
- **8 eventos** assinados (`MESSAGES_UPSERT`, `MESSAGES_UPDATE`,
  `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `MESSAGES_DELETE`, `MESSAGES_EDITED`,
  `GROUPS_UPSERT`, `GROUP_PARTICIPANTS_UPDATE`): todos no enum do `develop`,
  que ganhou `GROUP_UPDATE` (nome do grupo mudou; a 2.3.2 não tem).
- Forma dos payloads de ack (`keyId` + `status`), exclusão (chave achatada ou
  aninhada em `key`) e edição (`protocolMessage` com `key` + `editedMessage`).
- `getBase64FromMediaMessage`: `m?.message ? m : getMessage(m.key)` — igual.
- Auth state (`use-multi-file-auth-state-prisma.ts`): **idêntico entre 2.3.7 e
  `develop`**, só cosmética desde a 2.3.2 — creds na tabela `Session`, chaves de
  sinal num hash do Redis por instância. A v7 grava os tipos novos
  (`lid-mapping`, `device-list`, `tctoken`) no mesmo hash.
- `AUTHENTICATION_API_KEY` continua sendo a chave HTTP (`auth.guard.ts` lê do
  env); a licença não a substitui. As chaves **por instância** (tabela
  `Instance.token`, guardadas cifradas em `cb_channels.api_key`) e a
  configuração de webhook de cada instância (tabela `Webhook`) ficam no banco
  da Evolution e sobrevivem ao upgrade — nada a refazer no CRM.
- Prisma 7 tirou a URL do banco do schema, mas o `prisma.config.ts` do
  `develop` lê **`DATABASE_CONNECTION_URI`** e **`DATABASE_PROVIDER`** — as duas
  variáveis que o nosso serviço já tem. O entrypoint da imagem roda
  `Docker/scripts/deploy_database.sh` (`npm run db:deploy` → `prisma migrate
  deploy`, depois `db:generate`) e só então `start:prod`; o log diz
  `Migration succeeded` ou `Migration failed` (e nesse caso o contêiner sai
  com erro — o serviço não sobe com banco pela metade).

### 4.2 O que muda: onde o telefone e o LID aparecem

| Versão | Mensagem endereçada por LID chega ao webhook como |
| --- | --- |
| **2.3.2 (+ patch)** | `key.remoteJid = senderPn` (telefone); LID em `key.previousRemoteJid` |
| **2.3.7** | `key.remoteJid = key.remoteJidAlt` (telefone). **O LID é perdido**: `remoteJidAlt` fica igual ao telefone, `previousRemoteJid` não existe |
| **`develop`** | **Troca**: `remoteJid` = telefone, `remoteJidAlt` = LID, `addressingMode = 'pn'`. O LID sobrevive |

O parser do CRM (`phoneJidFromKey`) já aceita `remoteJidAlt`/`senderPn`/
`participantPn`/`participantAlt` para achar o telefone — a mensagem **entra**
nas três versões. O que se perde sem ajuste é o `remote_jid_lid` (migration
917), que apagar/editar em conversa migrada exige.

### 4.3 O que muda: participantes de grupo

Baileys 7, tipo `Contact`: `{ id, lid?, phoneNumber?, … }` — `id` é o
identificador preferido (LID ou telefone), `phoneNumber` vem quando `id` é
LID, `lid` vem quando `id` é telefone. **Não existe mais `.jid`.** O `develop`
devolve `group.participants` cru em `findGroup`. Em mensagens de grupo, quando
`participant` é LID, `participantAlt` é o telefone (e vice-versa).

### 4.4 O que pode mudar: tamanho declarado do anexo

Hoje `fileLength` chega como **string**. Dentro do `develop` o campo é um
`Long {low, high}` (ele lê `size.fileLength?.low`). A forma no webhook só a
medição dirá. `mediaBytesOf` já devolve `null` para forma desconhecida, e
`null` cai em "tamanho desconhecido = baixa e confere no backstop".

### 4.5 Comportamentos novos da biblioteca que interessam

- Sessões nascem em formato LID; as PN existentes são migradas sozinhas, sem
  re-parear (guia v7; relato de campo rc.x → rc13 sem QR).
- `enableAutoSessionRecreation` e `enableRecentMessageCache` ligados por
  padrão: o *retry receipt* do aparelho que não decifrou vira reenvio automático.
- **Recibo de entrega continua sendo enviado** para toda mensagem recebida
  (conferido no fonte da rc13, `src/Socket/messages-recv.ts` 1740–1758); o guia
  fala em "parou de mandar acknowledgments", mas a opção `sendActiveReceipts`
  controla só o "lido". O cliente continua vendo ✓✓ ao nos escrever.
- 2.3.7: "Resolve *waiting for message* state after reconnection" — chaves
  velhas deixam de ser carregadas na reconexão.
- 2.4.0-rc2: bypass do `onWhatsApp` para `@lid` (`sendMessageWithTyping` e
  `sendPresence` deixam de lançar 400 para JID LID); `quoted` passa a valer em
  `sendWhatsAppAudio` (hoje áudio com citação não sai encadeado — melhora).
- `develop`: `sendMessageWithTyping` recebe o número, `createJid` monta o JID
  de telefone e a Baileys 7 resolve o LID por baixo; `deleteMessage` chama
  `client.sendMessage(del.remoteJid, { delete })` direto; `updateMessage` exige
  `oldMessage.key.remoteJid === createJid(number)` (a Evolution grava telefone
  no `key.remoteJid` — igual a hoje); `reactionMessage` passa por
  `sendMessageWithTyping(data.key.remoteJid, …)`; a mensagem citada é buscada
  **por `key.id`** no banco dela (`m?.message ? m : getMessage(m.key, true)`).

---

## 5. O que vai ser alterado no CRM

Todos os ajustes são **retrocompatíveis** (funcionam com a 2.3.2 de hoje) e
entram **antes** do upgrade, num PR próprio, para que uma falha nos testes
seja atribuível à Evolution e não ao CRM.

### 5.1 Ajuste 1 — reter o LID (`src/lib/whatsapp/transport/evolution-inbound.ts`)

- Em `normalizeUpsert`, `remoteJidLid` passa a ser o **primeiro** LID entre
  `key.previousRemoteJid` (2.3.2), `key.remoteJidAlt` (`develop`) e
  `key.remoteJid` cru (caso a Evolution não troque e o telefone tenha vindo de
  um campo alternativo). Na 2.3.7 os dois são telefone → continua `null`
  (limitação documentada daquela versão).
- `EvolutionMessageKey` ganha `addressingMode?: 'pn' | 'lid'` (informativo).
- Testes: fixtures com as três formas (2.3.2 medida hoje; `develop` conforme
  o código das linhas 1668–1675; "sem troca").
- Sem isso: `remote_jid_lid` nasce `NULL` e **apagar/editar mensagem do
  celular em conversa LID volta a não fazer nada** (o bug de 28/07).

### 5.2 Ajuste 2 — nosso LID e o remetente de grupo (`evolution-group-inbound.ts`, `src/lib/cb-groups/persist.ts`, `webhook/route.ts`)

- `normalizeGroupUpsert` passa a expor **`senderLid`** (o `participant` ou
  `participantAlt` que for `@lid`) separado de `senderJid`.
- `aprenderNossoLid` recebe `senderLid` (hoje recebe `senderJid`, que com a
  Baileys 7 passa a ser o telefone — e a função só aceita `@lid`, então nunca
  mais aprenderia). Hoje só o canal Bancário - Jurídico tem `own_lid`
  (`40373380473043@lid`, 12 grupos); os outros três estão `NULL`.
- **Decisão proposta (confirmar):** `group_sender_jid` continua sendo o **LID**
  quando houver — identidade estável e igual a 100% das linhas existentes
  (`remetenteDoGrupo` hoje prefere o telefone dos campos alternativos, que na
  6.7.19 não vêm; na v7 viriam e trocariam a forma da coluna). O telefone, se
  um dia for gravado, ganha coluna própria — fora deste plano.

### 5.3 Ajuste 3 — participantes de grupo (`src/lib/cb-groups/sync.ts`, `parseGroupInfo`)

- **Como ficou no código (PR #161)** — o telefone do participante sai de
  **três** lugares, nesta ordem: `p.phoneNumber` (v7, quando o `id` preferido
  é o LID), `p.jid` (2.3.2) e o **próprio `p.id` quando termina em
  `@s.whatsapp.net`** (v7, quando o `id` preferido é o telefone — aí o LID vem
  em `p.lid`). A nossa linha é a que tem `soDigitos(telefone) === nosso`.
- `ourLid` = `p.lid` se for `@lid`, senão `p.id` se for `@lid`, senão `null`.
- Teste com participante nas **três** formas: `{id: lid, jid, lid}` de hoje,
  `{id: lid, phoneNumber}` e `{id: telefone, lid}` da v7 (`sync.test.ts`).
  ⚠️ Uma versão anterior deste item dizia só `phoneNumber ?? jid` — o Codex
  apontou (PR #162) que a forma `{id: telefone, lid}` ficaria sem casar; o
  código já cobria, o texto é que estava atrás. O `develop` devolve
  `participants: group.participants` **cru** da Baileys (`findGroup`, conferido
  no fonte), então a forma é a do tipo `GroupParticipant` da biblioteca.

### 5.4 Ajuste 4 — `fileLength` como objeto (`src/lib/whatsapp/transport/anexo-declarado.ts`)

- **Só depois de medir** (T5). Se vier `{low, high, unsigned}`: bytes =
  `high × 2³² + low`. Teste com as três formas (string, número, objeto).

### 5.5 Ajuste 5 — `GROUP_UPDATE` (`evolution-provision.ts`) — **DEPOIS do upgrade**

- ⚠️ **Não antes.** A 2.3.2 recusa o pedido de webhook INTEIRO quando a lista
  traz evento que ela não conhece (conferido em 28/07/2026 com `GROUPS_UPDATE`):
  incluir agora quebraria a criação de conexão nova.
- Depois do upgrade: incluir e clicar "Ressincronizar" nas 4 conexões (a
  Evolution guarda a lista no momento do registro).

### 5.6 Documentação e regras

- `docs/EVOLUTION-LID-FIX.md`: marcar **obsoleto** (o `remoteJidAlt` é nativo
  na v7); manter como histórico. O workflow `.github/workflows/evolution-lid-fix.yml`
  **falha de propósito** com base ≠ 6.7.19 — não aplicar sobre a imagem nova.
- `docs/INFRA-VPS.md` (linha da imagem), `docs/INSTALACAO.md` (versão da
  Evolution: 2.3.2 → a nova, com o passo do cadastro), `docs/DEPLOY-VPS.md`.
- `CLAUDE.md`: a nota que desaconselha a 2.3.7 fala do erro 463 e continua
  verdadeira para a 2.3.7 pura — reescrever citando este plano; registrar a
  imagem por digest, `TELEMETRY_ENABLED=false`, e que `docker stack deploy`
  segue proibido para a Evolution.
- `.env.local.example`: nada muda (as variáveis da Evolution já estão lá).

### 5.7 Testes automatizados a acrescentar

- `evolution-inbound.test.ts`: as três formas de chave (5.1).
- `evolution-group-inbound.test.ts`: `senderLid` com `participant`/`participantAlt`
  em cada ordem.
- `cb-groups/sync.test.ts`: `parseGroupInfo` com participante v6 e v7.
- `anexo-declarado.test.ts`: `fileLength` objeto (quando medido).
- Fixtures **reais** capturadas em produção antes e depois do upgrade
  (Fase 0, item 5), com telefones anonimizados.

---

## 6. O que vai ser mexido na infraestrutura

Tudo na VPS (`vps.cbadvogados.com`, Swarm). **Regra que segue valendo:
`docker stack deploy` é proibido para a Evolution** — o `/root/evolution.yaml`
(28/07) não carrega as 7 variáveis `S3_*` nem várias outras que o serviço tem
(hoje `S3_ENABLED=false`, mas a regra é a mesma). Toda mudança vai por
`docker service update`.

### 6.1 Fase 0 — preparação (sem trocar versão)

1. **Instâncias órfãs**: `DELETE /instance/delete/Bancario` e `/CBAdv` (chave
   global). Conferir depois que os hashes `evolution:instance:385dac9a-…` e
   `…c68ecb8d-…` sumiram do Redis db 8; se não, `DEL` à mão. Apagar também os
   4 hashes de instâncias inexistentes (`f71807c0-…`, `7fc75fe2-…`,
   `dcbf9851-…`, `60a309e7-…`). ⚠️ Ação destrutiva: pede autorização explícita.
2. **Backup** (criar `/root/backups/`):
   - Postgres: `pg_dump -U postgres -Fc evolution` (579 MB; 348.735 `Message`,
     317.219 `MessageUpdate`). Contém a tabela `Session` (creds das 4 conexões).
   - Redis **só o db 8** — o Redis é compartilhado (db0: 559 chaves de outros
     serviços; db2: 4). Duas cópias: (a) `COPY <chave> <chave> DB 9 REPLACE`
     para cada chave do db 8 (restauração instantânea, preserva TTL);
     (b) `SAVE` + `docker cp` do `/data/dump.rdb` para `/root/backups/`
     (cópia fora do Redis; restaurar dele restauraria os outros dbs também —
     só em último caso).
   - `docker cp` de `/evolution/instances` (28 K; volume `evolution_instances`).
   - Anotar: digest atual
     `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694`,
     a lista de env do serviço, e o `_prisma_migrations` (última:
     `20250613143000_add_lid_column_to_is_onwhatsapp`, aplicada 04/09/2025).
3. **Restauração de prova**: `createdb evolution_ensaio` + `pg_restore` +
   `select count(*) from "Message"` = 348.735 + `dropdb evolution_ensaio`.
   Backup que nunca foi restaurado é esperança, não rollback.
4. **Guardar o log atual** da Evolution (`docker service logs … > /root/backups/`).
5. **Capturar payloads reais** (upsert 1:1 do cliente, eco do celular, grupo,
   imagem, documento) como fixtures — do log do CRM ou de um webhook de
   captura temporário.
6. **Fila de agendadas**: `cb_scheduled_messages` com `status = 'pending'`
   tem de estar vazia na janela (cancelar e reagendar depois). ⚠️ Em
   09/09 às 16h havia **1 pendente** — conferir o que é antes de marcar a
   janela.
7. **Aviso à equipe**: usar celular/outro CRM na janela (a Dra. Isa mandou 17
   pelo CRM em 09/09).

### 6.2.0 Pré-voo da Fase 1 (no dia da janela, ANTES de trocar a imagem)

Todos os comandos estão no Anexo B. Ordem:

1. **Confirmar com o operador**: janela aberta agora, os 4 celulares à mão,
   equipe avisada (celular/outro CRM), decisão P2 tomada. ✅ 09/09 noite: janela
   aberta, equipe avisada, P2 = LID; **só 1 celular** — aceito porque os outros
   3 números são conexões de teste sem uso (QR em 10/09 se pedirem).
2. **CRM publicado com o PR #161**: na VPS, a imagem de `crm_crm` termina no
   sha do `main` que contém o merge do #161 (`git log origin/main`).
3. **Fila de agendadas**: só a linha de teste de 2030 (P8) pode estar
   `pending`.
4. **Backup NOVO** (o de 17:04 de 09/09 é anterior à limpeza e envelhece):
   `pg_dump` com carimbo; **`FLUSHDB` no db 9** (ele guarda a cópia antiga —
   em 09/09 18:10 ainda tinha 10 hashes, os 6 apagados inclusos) e copiar o
   db 8 de novo; `SAVE` + `docker cp` do RDB; `instances`; log; env; e a
   **restauração de prova** com o corte de tempo (Anexo B). Este backup é a
   **prova** de que a restauração funciona; o que o rollback restaura é a
   **foto final**, tirada com o serviço a 0 no passo 1 da 6.2.
5. **Imagem**: `docker image inspect evoapicloud/evolution-api:homolog` mostra
   o digest `1e656f95…`; `docker run --rm --entrypoint sh <imagem> -c 'grep
   version node_modules/baileys/package.json'` → `7.0.0-rc13`. Se a tag
   `homolog` tiver sido re-puxada e mudado, **parar e reavaliar** (é branch
   sem release). ✅ 09/09 18:10: digest intacto, `2.4.0` / `7.0.0-rc13` /
   Node `v24.18.0`.
6. **Serviço**: `docker service inspect evolution_evolution --format '{{json
   .Spec.UpdateConfig}}'` → `Order` tem de ser `stop-first` (é, medido em
   09/09) — com `start-first` duas Evolutions abririam as mesmas 4 sessões ao
   mesmo tempo. Como a 6.2 escala a 0 antes de trocar, isso vira só
   conferência.
7. **Linha de base**: `fetchInstances` 4 × `open`; contagem de sessões PN por
   hash (Anexo B) — comparar com a de 8.3. ✅ 09/09 18:10 em 9.2.
8. **Log atual guardado** (`docker service logs --since 24h > /root/backups/…`).
9. **Imagem de rollback no nó**: `docker image inspect ghcr.io/…lidfix@sha256:dd3e46…`
   responde (✅ 09/09: id `7e614b07…`, criada 28/07, 1,11 GB). Regra: **nenhum
   `docker image prune`/`system prune`** na janela nem nas 48 h; o `service
   update` do rollback não passa `--with-registry-auth`, então a imagem tem de
   estar local.
10. **Tempos medidos** (para o relógio dos gatilhos): dump **5 s**, restore de
    prova **5 s** (14 MB, 09/09 18:24). A foto final leva menos de 1 min; o
    relógio dos 10 min de 8.4 começa no `scale=1`.
11. **O que dispara sozinho na reconexão** (Supabase, só leitura): automações
    ativas com gatilho de entrada, esperas com `run_at` na janela e `flow_runs`
    ativos — o WhatsApp entrega de uma vez o que chegou durante os minutos a 0,
    e cada mensagem dispara isso contra o portão 503 (ou em rajada, se a
    ativação for rápida). ✅ 09/09 18:43: **1** automação de entrada ativa
    ("Teste do plano — follow-up (pode apagar)", `keyword_match` — só dispara
    com a palavra-chave), **0** esperas, **0** fluxos ativos. Nada a pausar.
12. **Migrations da imagem × produção**: `comm` entre `ls prisma/postgresql-
    migrations` da imagem e `_prisma_migrations` — nada de produção pode faltar
    na imagem. ✅ 09/09: imagem 59, produção 55, **as 4 novas**:
    `20250918182355_add_kafka_integration`,
    `20251122003044_add_chat_instance_remotejid_unique`,
    `20251216143054_increase_token_length`,
    `20260506184850_add_runtime_config`. E **`Chat` duplicado
    `(instanceId, remoteJid)` = 0** (a 2ª migration cria índice único ali;
    duplicata = P3009 em laço).
13. **Endpoint de licença da imagem**: o Dockerfile do `develop` diz que a
    URL entra XOR-codificada por build-arg e, vazia, cai num fallback de dev.
    ✅ 09/09: o bundle não expõe a URL em claro (XOR de produção), e o
    fallback de `endpoint.ts` **monta a mesma** `https://license.evolutionfoundation.com.br`
    de partes — os dois caminhos apontam para produção. `SERVER_URL=https://api.cbadvogados.com`
    no env, então o `register_url` que o 503 anuncia sai certo; conferir no
    corpo do primeiro 503 depois do `scale=1`.
14. **`DEL_INSTANCE`**: tem de ser `false` — instância desconectada por dias
    (as 3 de teste até 10/09) seria apagada pelo monitor, com a cascata da
    9.3. ✅ 09/09: `DEL_INSTANCE=false`, `QRCODE_LIMIT=1902`.
15. **Linhas de base de 8.3** (latência, entrada por hora, decifragem)
    registradas em 9.2. ✅ 09/09 18:43.

### 6.2 Fase 1 — o upgrade (janela combinada; celulares à mão)

Ordem revista em 09/09 (revisão do Codex no PR #162 e revisão adversarial da
noite): a Evolution é **parada antes** de qualquer troca, a foto final é
tirada com ela parada e **conferida**, e só então a imagem muda. O `stop-first`
do serviço já evitaria duas Evolutions ao mesmo tempo, mas não daria a foto no
instante certo — e é a foto que decide se o rollback devolve as sessões como
estavam (0.4). Tudo abaixo roda por SSH em **scripts** (um por passo, com as
variáveis definidas no topo — Anexo B), nunca colando linhas soltas: as
variáveis de shell envelhecem entre os passos, e `$CID` aponta para outro
contêiner depois de cada `scale`/`update`.

**Antes do passo 0, na mesma hora**: navegador já em
`https://api.cbadvogados.com/manager/login`, a caixa de e-mail
`leonardocabralb@gmail.com` aberta e o telefone do cadastro à mão (o portão
de licença bloqueia a API do CRM até a ativação — passo 4); `date` anotado a
cada passo.

```bash
# 0. parar a Evolution (janela aberta; equipe no celular/outro CRM).
#    Com 0 réplicas nada escreve no banco nem no Redis.
docker service scale evolution_evolution=0
docker service ps evolution_evolution --format '{{.Name}} {{.CurrentState}}' | head -3   # nenhuma Running

# 1. FOTO FINAL, com o serviço a 0 (medido no pré-voo: dump 5 s, restore 5 s, 14 MB).
#    Bloco "Backup" do Anexo B com CARIMBO=<data-hora>-final: dump + `pg_restore -l`
#    + referência (count/max de Message, HLEN dos 4 hashes) em foto-$CARIMBO.txt +
#    FLUSHDB do db 9 + cópia + DBSIZE 8 = DBSIZE 9 (exato, porque nada escreve) + RDB.
#    ⚠️ SÓ SEGUIR depois do "DUMP-OK": um `prisma migrate deploy` com o dump ainda
#    rodando ficaria preso atrás dos locks (a 2.4 cria índice único em Chat e a
#    tabela RuntimeConfig) e o arquivo do rollback não estaria fechado em disco.

# 2. trocar a especificação (0 réplicas: nenhuma tarefa sobe ainda)
docker service update \
  --image evoapicloud/evolution-api:homolog@sha256:1e656f95aa1a2b7c2455a6a36d654637ddc2658c263794a5074ada798412a549 \
  --env-add TELEMETRY_ENABLED=false \
  evolution_evolution

# 3. subir SEM bloquear e vigiar: o entrypoint roda `prisma migrate deploy` (4 migrations)
#    a CADA subida; com RestartPolicy any/5 s, migration que falha vira LAÇO de reinício
#    (P3009 a cada volta) e um `scale` sem --detach esperaria para sempre.
docker service scale --detach evolution_evolution=1
docker service ps evolution_evolution --no-trunc --format '{{.Name}} {{.CurrentState}} {{.Error}}' | head -4   # repetir a cada 30 s
timeout 300 docker service logs evolution_evolution --since 2m -f                      # "Migration failed" = gatilho (8.4)
CID=$(docker ps -q -f name=evolution_evolution | head -1)                              # RELER: é outro contêiner
docker exec $CID sh -c 'grep -m1 "\"version\"" package.json; grep -m1 "\"version\"" node_modules/baileys/package.json'   # 2.4.0 / 7.0.0-rc13
PGCID=$(docker ps -q -f name=postgres_postgres | head -1)
docker exec $PGCID psql -U postgres -d evolution -Atc 'select migration_name, finished_at from _prisma_migrations order by finished_at desc limit 6'
```

4. **Ativar a licença IMEDIATAMENTE.** O portão (`gateMiddleware`) é só um
   middleware HTTP de **entrada**: `main.ts` **aguarda** `initializeRuntime`
   (que apresenta a chave global ao `/v1/activate`, com timeout de 10 s) no
   começo do `bootstrap()`, sobe o HTTP e chama `initWA()` por último — e
   `initWA` conecta as instâncias **sem olhar** o resultado da licença; nada
   em `baileys.service.ts` a consulta. Ou seja, ~10–20 s depois do
   `Migration succeeded`, as 4 instâncias **conectam** ao WhatsApp, a
   migração PN→LID começa e os webhooks **chegam** ao CRM — mas **toda chamada do CRM à Evolution**
   (enviar, marcar lida, baixar mídia, `fetchInstances`) responde
   `503 LICENSE_REQUIRED` até a ativação. Consequências desse intervalo, e o
   passo 8 as recolhe: anexo 1:1 recebido fica sem arquivo (o CRM baixa pela
   API); automação/IA/agendada que dispare falha sem retentativa (5xx vira
   `evolution_error`). Anotar o `date` do `scale=1` e o da ativação.
   - `https://api.cbadvogados.com/manager/login` → cadastro com o e-mail e o
     telefone decididos → `curl -s https://api.cbadvogados.com/license/status`
     (linha de base hoje: **404**; depois tem de dizer ativo).
   - **Guardar a ativação**: `docker exec $PGCID pg_dump -U postgres -Fc -t
     '"RuntimeConfig"' evolution > /root/backups/evolution-runtimeconfig-$CARIMBO.dump`
     — a licença local mora nessa tabela (`licensing-runtime.ts`,
     `model RuntimeConfig`); a foto final é anterior à 2.4 e não a tem. Numa
     2ª tentativa depois de rollback, restaurar só essa tabela depois do
     `prisma migrate deploy` dispensa cadastrar de novo.
   - ⚠️ **`EVOLUTION_OPERATOR_EMAIL` NÃO serve nesta instalação** (uma versão
     deste plano o oferecia como alternativa): `initializeRuntime` só chama
     `tryAutoRegisterFromEnv` quando `globalApiKey` está **vazia**, e
     `globalApiKey` é a `AUTHENTICATION_API_KEY` (`main.ts:57`), que é a chave
     HTTP do CRM e nunca está vazia. O `/manager` é o **único** caminho.
   - ⚠️ **No boot sem licença a Evolution apresenta a nossa
     `AUTHENTICATION_API_KEY` ao servidor da fundação** como candidata a chave
     de licença: `POST /v1/activate` com o cabeçalho `X-Api-Key: <a chave>` em
     claro (sobre TLS) mais assinatura HMAC (`transport.ts`). Falha, imprime o
     banner e fica inativa — mas a chave HTTP do escritório viajou para um
     terceiro, e viaja de novo a cada reinício até a ativação. Decisão **P9**:
     rotacionar a chave depois da Fase 1 (é a mesma `EVOLUTION_GLOBAL_API_KEY`
     do CRM: `crm.env` + `--env-add` nos dois serviços; as chaves por instância
     em `cb_channels.api_key` não mudam).
5. **Conexões — contando do `scale=1`, não do início do rollback.** Antes da
   ativação o `fetchInstances` responde 503, então o estado sai do **banco** e
   do **log**: `docker exec $PGCID psql -U postgres -d evolution -Atc 'select
   name, "connectionStatus" from "Instance"'` (o `connection.update` grava
   `open` ali) e `timeout 60 docker service logs evolution_evolution --since
   10m 2>&1 | grep -ciE "connection.*open|CONNECTED"`. Depois da ativação, a
   `KEY` lida da **especificação** do serviço (Anexo B) e `fetchInstances` →
   4 × `open` sem QR. Se alguma pedir QR: ler (é o custo aceito; em 09/09 só 1
   celular à mão — as outras ficam para 10/09, decisão do operador).
   **Onde ler o QR**: *antes* da ativação o botão Reconectar do CRM não
   funciona (`instance/connect` está atrás do portão → 503); o QR sai pelo
   `/manager` (instância → conectar) ou pelo log em ASCII (`timeout 60 docker
   service logs evolution_evolution --since 2m 2>&1 | grep -A 40
   qrcodeCount`, num terminal com ≥ 45 linhas). *Depois* da ativação:
   Conexões → Reconectar no CRM. Ordem preferida: ativar primeiro, ler QR
   depois — o relógio de 8.4 já conta do `scale=1`. ⚠️ Instância em laço de
   QR imprime o QR no log a cada renovação (444 `qrcodeCount` em 24 h com as
   órfãs) e rotaciona o `json-file 10m×3`: **guardar o log a cada marco**
   (depois das migrations, dos `open`, da ativação, ao fim dos testes e a
   cada 12 h) e medir 8.3 sobre os arquivos, com `grep -v -E '▄|█|qrcodeCount'`.
6. **Sinais no Redis**: campos `lid-mapping-*` e `session-*_1.*` começam a
   aparecer nos hashes vivos.
7. **Prova da FOTO FINAL** (não prolonga a parada — só I/O no Postgres):
   `pg_restore --exit-on-error` da foto em `evolution_ensaio`, `count(*)` de
   `Message` **igual** ao de `foto-$CARIMBO.txt` (total exato: o serviço estava
   a 0), `dropdb evolution_ensaio`. Só depois disto o rollback tem dump
   comprovado.
8. **Recolher o intervalo `scale=1` → ativação** no Supabase: mensagens
   recebidas nesse intervalo com mídia e sem arquivo (recuperar pelo caminho da
   memória `recuperar-anexo-perdido-na-evolution`), `automation_logs` /
   `cb_calendly_eventos` com falha, agendadas em `entrega_incerta`.
9. **Testes** da seção 8 no lead de teste autorizado. **Antes do T22**, guardar
   o log (`docker service logs --since 6h > /root/backups/evolution-log-pos-upgrade-…`).
10. **Observação de 48 h** com os medidores da seção 8.3.
11. **Depois**: ajuste 5 (`GROUP_UPDATE` + Ressincronizar), atualizar
    `/root/evolution.yaml` com a imagem por digest e `TELEMETRY_ENABLED=false`
    (para um futuro `stack deploy`, ainda proibido, não regredir), docs, P9.

`CONFIG_SESSION_PHONE_VERSION` fica como está (é ignorada). Variáveis novas do
`develop` (Kafka, SQS, métricas, proxy, EvoHub) são todas opcionais e
desligadas por padrão; o EvoHub fica inerte sem chave.

---

## 7. Riscos

### 7.1 Funcionais (por funcionalidade do CRM)

**B** = baixo (contrato igual) · **M** = médio (comportamento muda ou depende
de teste) · **A** = alto (perda de mensagem/dado possível).

| # | Funcionalidade | O que muda | Risco | Cobertura |
| --- | --- | --- | --- | --- |
| 1 | Receber texto de cliente | LID muda de campo (4.2) | B | ajuste 1, T4 |
| 2 | **Mensagem enviada pelo celular pareado** (`from_device`) | mesmo caminho do item 1; o patch `lidfix` deixa de existir e a v7 entrega `remoteJidAlt` nativo | **M** — já falhou uma vez (83% dos ecos perdidos em 07/2026) e o CRM **descarta em silêncio** | **T17**; medidor `DESCARTADA` |
| 3 | Mensagem enviada pelo WhatsApp Web / Desktop / outro CRM | idêntico ao item 2 | **M** | **T18** |
| 4 | Eco do que o próprio CRM enviou (dedup) | nada (`jaGravada` por `message_id`) | B | — |
| 5 | Enviar texto | nada; a v7 resolve LID por baixo — é o conserto | B | T1 |
| 6 | Enviar imagem/vídeo/documento | nada (DTO só ganhou opcionais) | B | T2 |
| 7 | Nota de voz (gravador e acervo) | nada; citação em áudio passa a funcionar | B | T3 |
| 8 | Mensagem agendada | nada de contrato; risco de horário (dispara sem gente olhando) | B, com fila vazia | T20 |
| 9 | Receber mídia | endpoint igual; `mediaKey` mais robusto desde a 2.3.3 | B | T4, T5 |
| 10 | Tamanho declarado do anexo (`too_large`, "sob demanda") | forma de `fileLength` pode mudar (4.4) | M (degradação: baixa antes de decidir) | T5, ajuste 4 |
| 11 | Pré-visualização de mídia no CRM | nada (é o nosso Storage) | B | — |
| 12 | Link preview no envio | igual (`linkPreview` ligado por padrão) | B | T6 |
| 13 | Citação — preview no aparelho do cliente | busca por `key.id` igual; `participant` montado pela v7 em conversa LID | M (cosmético, visível) | T7, T8 |
| 14 | Reação (enviar) | passa por `sendMessageWithTyping` com bypass `@lid` | M | T9 |
| 15 | Reação (receber) | nada | B | — |
| 16 | Apagar para todos | sem ajuste 1, volta o bug de 28/07; com a v7, apagar pelo telefone pode passar a funcionar | M | T10, T11 |
| 17 | Editar | igual (Evolution grava telefone no `key.remoteJid`) | B | T12 |
| 18 | Exclusão/edição feitas pelo cliente | formas iguais | B | T13 |
| 19 | ✓/✓✓/lido das nossas mensagens | igual (casado por `keyId`); retry vira reenvio automático | B | — |
| 20 | ✓✓ que o cliente vê nas mensagens dele | recibo de entrega continua (fonte rc13) | B | T14 |
| 21 | Marcar como lida (✓✓ azul no cliente) | igual; em conversa LID depende do servidor | B/M | T15 |
| 22 | Presença (digitando/gravando) | igual, com bypass `@lid` | B | — |
| 23 | Foto de perfil | igual; `findChats` já filtra `@s.whatsapp.net` (3.325 chats LID ficam fora do botão em lote — pré-existente; o caminho por mensagem cobre) | B | — |
| 24 | Grupos — mensagens | `participantAlt` traz telefone; forma de `group_sender_jid` decidida no ajuste 2 | B/M | T19 |
| 25 | Grupos — participantes / somos admin / nosso LID | `participants[]` sem `.jid` | M | ajuste 3, T19 |
| 26 | Grupos — menção a nós (`mentions_us`) | `own_lid` deixaria de ser aprendido | M (canais novos) | ajuste 2, T19 |
| 27 | Grupos — avisos de entrada/saída | `participants` mantido + `participantsData` novo | B | — |
| 28 | Nome do grupo mudou | `GROUP_UPDATE` passa a existir | B (melhora) | ajuste 5 |
| 29 | Conexão nova / QR / estado / Ressincronizar | schemas iguais | B | T16 |
| 30 | Automações, fluxos, IA, Radar, transcrição, busca, funil, webhooks de saída | não falam com a Evolution; só dependem de a mensagem entrar | indireto | itens 1–3, 9 |
| 31 | Canal Meta Cloud API | não existe em produção | — | — |

**Onde está o risco real:** itens 2–3 e 16. Os três já quebraram uma vez,
quebram em silêncio e se resolvem com o ajuste 1 + T17/T18.

### 7.2 Operacionais

| Risco | Detalhe | Mitigação |
| --- | --- | --- |
| **Migração das sessões exigir QR** | v7 migra PN → LID sozinha (guia + relato); há relatos de re-pareamento em outros setups | 4 celulares à mão; CRM fora de uso; é o custo aceito |
| **Regressão da `develop`** (branch sem release) | `homolog` é retag; pode mudar | imagem **por digest** conferido (3.1); observação de 48 h; gatilhos de rollback (8.4) |
| **463 / quarentena do número** | só com rc.9; a rc13 manda o carimbo; hoje a 6.7.19 não manda e é tolerada | usar rc13 (conferido na imagem); volume de envio pelo CRM baixo (17 a 77 textos/dia em 09/09 e 08/09, contra 225–493 pelo celular); watch de `463` no log |
| **Efeitos colaterais reportados com rc13** | (a) entrada 1:1 em lotes de 0–60 s; (b) FK em `IntegrationSession` bloqueando `instance/create` | (a) T21 mede; (b) não usamos chatbots internos — `DELETE FROM "IntegrationSession"` é seguro |
| **Migrations sem volta** | 4 migrations; dedup de `Chat` mexe na órfã `Bancario` | backup + restauração de prova (6.1) |
| **Redis compartilhado** | restaurar o RDB inteiro regrediria db0/db2 (outros serviços) | backup por chave para o db 9 (6.1) |
| **Telemetria** | nova, ligada por padrão, manda nome do evento + versão para `log.evolution-api.com` | `TELEMETRY_ENABLED=false` no `service update` |
| **Log morre no reinício** | prova do defeito some | guardar antes; capturar depois; (futuro) log fora do contêiner |
| **`docker stack deploy`** | yaml incompleto zeraria env | proibido; só `service update` |
| **Sessão paralela no checkout** | outra sessão mudou a branch do checkout principal em 09/09 | trabalhar **só na worktree** desta branch |

### 7.3 O cadastro (licença) — decisão do operador

- **Gratuito.** Doc oficial: *"The community license is free"*, *"no usage,
  message or instance limit for the community tier"*, sem função bloqueada.
- **Obrigatório**: sem ativação, toda rota de negócio responde
  `503 LICENSE_REQUIRED` — e **só** as rotas HTTP: as instâncias conectam e
  os webhooks saem normalmente (`main.ts` aguarda `initializeRuntime` e depois
  chama `initWA()` sem olhar o resultado; `baileys.service.ts` não consulta a
  licença). Ativação
  uma vez (e-mail + telefone do operador) pelo `/manager`. ⚠️ A alternativa
  sem navegador (`EVOLUTION_OPERATOR_EMAIL`) **não vale aqui**: só é tentada
  com `AUTHENTICATION_API_KEY` vazia, e ela é a chave do CRM (6.2, passo 4).
  Depois: **portão local** (hash no banco; funciona com o servidor deles fora
  do ar — conferido em `licensing/runtime.ts`); heartbeat separado e não
  bloqueante (relato de campo com heartbeat 404 e API normal). A **primeira**
  ativação, porém, exige o servidor deles no ar (`/v1/register/*` →
  `/v1/activate`).
- **O que sai**: na ativação, e-mail, telefone, versão e UUID da instância; nos
  heartbeats, versão, **contadores agregados** (ex.: total de mensagens no
  período), features ligadas e IP. **E, a cada boot antes da ativação, a nossa
  `AUTHENTICATION_API_KEY`** — apresentada em claro (`X-Api-Key`, sobre TLS)
  ao `/v1/activate` como candidata a chave de licença (`transport.ts`,
  `licensing-runtime.ts`). Achado da revisão adversarial de 09/09 → P9. A doc diz que **não** manda mensagens,
  contatos, números de clientes, mídia nem tokens. **Não documentado**: o que
  acontece se revogarem.
- Reinstalação do zero exige ativar de novo (`RuntimeConfig`).
- **Hoje × depois**: hoje ninguém sabe que temos a Evolution e nada sai do
  servidor; depois, cadastro único + relatório periódico de volume. O preço
  não é dinheiro — é dependência e um relatório saindo do escritório.

---

## 8. Testes de aceitação

Todos no **lead de teste autorizado** (contato "Leonardo Cabral Baptista"),
num contato **endereçado por LID** (conferir em `IsOnWhatsapp`), com o log da
Evolution e do CRM abertos. Registrar resultado e data em cada linha.

### 8.1 Roteiro

| T | Teste | Passa quando | Resultado |
| --- | --- | --- | --- |
| T1 | Texto pelo CRM | legível no celular do cliente (sem "Aguardando"); ✓✓ no CRM | |
| T2 | Imagem, PDF e vídeo pelo CRM | abrem no cliente; `media_type`/`media_filename` gravados | |
| T3 | Nota de voz (gravador e acervo), com e sem citação | toca como voz; com citação, encadeada | |
| T4 | Cliente manda foto | aparece no CRM com arquivo no Storage | |
| T5 | Cliente manda documento >16 MiB e outro >50 MiB | o primeiro entra; o segundo vira `too_large` com nome; **anotar a forma de `fileLength`** | |
| T6 | Texto com URL | preview do link no cliente | |
| T7 / T8 | Responder citando mensagem do cliente / nossa | o cliente vê o preview da citação | |
| T9 | Reagir a mensagem do cliente | reação aparece no celular dele | |
| T10 / T11 | Apagar para todos: mensagem do CRM / do celular | some no cliente; `messages.delete` volta | |
| T12 | Editar mensagem nossa (<15 min) | edita no cliente; `text_before_edit` gravado | |
| T13 | Cliente apaga e edita mensagem dele | CRM risca / atualiza | |
| T14 | Cliente nos escreve | ele vê ✓✓ na mensagem dele | |
| T15 | Abrir a conversa no CRM (marcar lida) | ✓✓ azul no cliente | |
| T16 | Criar canal de teste pelo CRM, ler QR, Ressincronizar, apagar | `open`, webhook aplicado, mensagem entra | |
| **T17** | **Mensagem pelo CELULAR pareado para contato LID** | **aparece no CRM "pelo celular"; `DESCARTADA` = 0** | |
| **T18** | **Mensagem pelo WhatsApp Web para contato LID** | idem | |
| T19 | Grupo: mensagem nossa e de participante, menção a nós | entra; `mentions_us` acende no canal com `own_lid`; `findGroupInfos` acha nossa linha | |
| T20 | Agendar mensagem para +3 min | sai na hora, `sent`, sem duplicar | |
| T21 | Latência de entrada | 5 mensagens espaçadas do cliente; atraso = `conversations.last_message_at` (relógio do CRM) − `messages.created_at` (relógio do WhatsApp) da última mensagem da conversa. ⚠️ `messages.created_at` **é** o `messageTimestamp` (`inbound-store.ts`): comparar os dois dá zero por construção. Linha de base 09/09 (7 dias, n=186): **p50 1,2 s · p95 2,1 s · máx 3,5 s** | |
| T22 | Reinício do serviço (`service update --force`) | 4 instâncias voltam `open` sem QR | |

### 8.2 O que só o teste responde

1. Citação e reação em conversa LID chegam com preview? (T7–T9)
2. Apagar pelo telefone passa a funcionar, ou continua exigindo o LID? (T10–T11)
3. `fileLength`: string, número ou objeto? (T5)
4. As 4 sessões sobrevivem sem QR? (T22 e o próprio upgrade)
5. A entrada em lotes de 0–60 s acontece aqui? (T21)

### 8.3 Medidores (antes, durante e nas 48 h seguintes)

| Medidor | Onde | Esperado depois |
| --- | --- | --- |
| `Closing session` / `Closing stale open session` | log da Evolution | tende a zero após a migração das sessões |
| `"463"` / `messageStubParameters` | log da Evolution | **zero** — qualquer ocorrência é gatilho de rollback |
| `DESCARTADA: endereçada por @lid` | log do CRM (`crm_crm`) | **zero** |
| campos `session-*_1.*` e `lid-mapping-*` | Redis db 8, hashes vivos | aparecem e crescem. **Linha de base (09/09 17:30, depois da limpeza)**: `44982408` (Bancário - Comercial) PN=291, `be282022` (Bancário - Jurídico) PN=35, `200ac9ef` (Trabalhista - Comercial) PN=152, `d1d9caf5` (Trabalhista - Jurídico) PN=140; LID=0 e `lid-mapping`=0 em todos |
| acks (`MessageUpdate`) e `read` no CRM | banco da Evolution / `messages.status` | continuam chegando |
| latência de entrada | T21 (consulta em Anexo B) | segundos, não minutos. **Base 09/09: p50 1,2 s, p95 2,1 s** |
| **entrada continua chegando** | Supabase: recebidas por hora (Anexo B) | **Base 09/09 (mediana por hora do dia, 7 dias)**: 8h–17h entre 20 e 48/h; 18h 14; noite 1–9/h. Hora cheia com 0 recebidas onde a base dá ≥ 5 = investigar na hora (webhook 401/400 é descartado sem retentativa pela Evolution e o CRM não loga o 401). A **primeira** mensagem de cliente depois do `scale=1` tem de aparecer no Supabase — prova de que o `Authorization` guardado na tabela `Webhook` ainda vale |
| **falha de decifragem do NOSSO lado** (a direção silenciosa: a mensagem do cliente não vira webhook e ele vê ✓✓) | log da Evolution, contagens sobre o arquivo guardado por marco (`grep -ci`) | **Base 09/09, 24 h até 18:24** (inclui o laço de QR das órfãs até 17:27): `Bad MAC` **166**, `No matching sessions` 20, `failed to decrypt` 20, `Decrypt` 352, `SessionError` 10, `keep alive` 82, `stream:error` 4, `Closing open session` 3, `Closing stale` 24, `qrcodeCount` 444. Esperado depois: **cai ou zera**; SUBIR = sessão migrada errada para algum contato → abrir a conversa daquele JID no celular e comparar com o CRM |
| relato de "Aguardando mensagem" | **ativo, não passivo**: (a) com T1 verde, a Dra. Isa volta ao CRM e reporta QUALQUER "Aguardando" na hora; (b) 3× por dia o operador abre no **celular do escritório** as conversas em que o CRM enviou texto e confere que a cópia **não** diz "Aguardando mensagem" (é o único detector do próprio sintoma que não depende de reclamação — seção 1) | 0/N em 24 h e 48 h |

### 8.4 Gatilhos de rollback (decididos antes, sem discutir na hora)

- **`Migration failed` no log, ou a tarefa reiniciando em laço** (`docker
  service ps` mostrando `Failed`/`Shutdown` com `non-zero exit` em sequência)
  → `scale=0` na hora e seção 10. A 2ª tentativa exige o banco restaurado
  (o rollback já faz) — nunca `scale=1` de novo sobre a migration marcada
  como falha (P3009).
- **A instância do celular à mão** (nomeada antes do `scale=0` — em 09/09 o
  operador tinha 1 celular; ver P4) não volta a `open` em 10 min **contados
  do `scale=1`** (nem com QR) — medido no banco/log, porque a API responde
  503 até a ativação (6.2, passo 5). As outras 3 pedindo QR **não é
  gatilho**: são conexões de teste, ficam em `connecting` até a leitura (em
  10/09), e ao bater `QRCODE_LIMIT=1902` viram `refused` (o CRM marca
  `disconnected`) — esperado; reconectar depois é **Reconectar** no CRM
  (`instance/connect`), não recriar a conexão.
- `RuntimeConfig table was not found` no log = a migration da 2.4 não entrou
  (`initializeRuntime` faz `process.exit(1)` → laço) → primeira linha acima.
- `/license/status` não fica ativo em **15 min** depois do `scale=1` → o
  operador decide (o custo de esperar é a foto final envelhecendo); em
  **30 min** → rollback.
- Qualquer `463` no log.
- T17 ou T18 reprovando **depois** dos ajustes do CRM.
- T1 reprovando (texto do CRM não chega legível).
- Latência de entrada: **p95 das últimas 2 h > 60 s** (base 09/09: p95 2,1 s),
  pela consulta do Anexo B — não por impressão (decisão do operador).

---

## 9. Fases e checklist

### Fase 0 — preparação (sem trocar versão) — **CONCLUÍDA em 09/09/2026**

- [x] Operador: e-mail e telefone do cadastro decididos (09/09)
- [x] PR com os ajustes 1, 2, 3 + testes (5.1–5.3, 5.7) — **PR #161 mesclado no `main`** em 09/09 (95 testes verdes, lint e typecheck limpos); a publicação é o run do pipeline do `main` seguinte ao merge — conferir no pré-voo (6.2.0, item 2)
- [x] Decisão do ajuste 2 (`group_sender_jid` = LID) confirmada pelo operador em 09/09 (P2) — nada muda no código
- [x] Instâncias órfãs `Bancario` e `CBAdv` removidas (autorizado e executado 09/09 17:27; a API respondeu `Instance deleted` e a remoção completou em segundo plano — `Instance` ficou com 4 linhas)
- [x] 6 hashes do Redis removidos (2 órfãs + 4 mortos); sobraram os 4 vivos
- [x] `/root/backups/` criado (09/09 17:04): `evolution-20260909-1704.dump` (105,8 MB), `redis-20260909-1704.rdb` (33,9 MB), cópia do db 8 no **db 9**, `instances-…`, `evolution-log-…txt` (25.968 linhas), `evolution-env-…txt` (600), `evolution-image-…txt`, `evolution-migrations-…txt`
- [x] Restauração de prova feita e removida (ver registro em 9.1)
- [x] Payloads reais capturados: `/root/backups/evolution-amostras-20260909-1704.jsonl` (10 linhas, 600) — falta anonimizar e transformar em fixtures no repositório
- [x] Fila de agendadas conferida: a única pendente é um resto de teste marcado para 2030 (P8) — nada real dispara na janela
- [x] Equipe avisada para usar celular/outro CRM na janela (operador, 09/09 noite)
- [x] Janela aberta em 09/09 (noite) com **1 celular** à mão — os outros 3 são conexões de teste sem uso; QR delas, se preciso, em 10/09 (P4)
- [x] Refazer o `pg_dump` e a cópia db 8 → db 9 imediatamente antes da janela → feito no pré-voo de 09/09 18:24 (9.3); a **foto final** repete com o serviço a 0 (6.2, passo 1)

#### 9.2 Registro do pré-voo — parte só de leitura (09/09/2026, 18:10, horário de Brasília)

Executado por SSH, sem alterar nada (script no scratchpad do executor):

- **Serviço** `evolution_evolution`: imagem `…lidfix:2.3.2-lidfix@sha256:dd3e46…`, 1 réplica, `UpdateConfig` = `{Parallelism 1, FailureAction pause, Monitor 5s, Order stop-first}`, `RollbackConfig` idem, `RestartPolicy` = `any`/5 s, volume `evolution_instances` → `/evolution/instances`. Tarefa atual `Running` há 3 h; as três falhas listadas são de **5 semanas atrás**. Dentro do contêiner: Evolution `2.3.2`, Baileys `6.7.19`.
- **Imagem candidata**: `evoapicloud/evolution-api@sha256:1e656f95…` (criada 2026-07-14), `2.4.0` / Baileys `7.0.0-rc13` / Node `v24.18.0` — **intacta**.
- **Instâncias** (`fetchInstances` e tabela `Instance` batem): `comercial-trabalhista-e7c7ea`, `juridico-bancario-d5a458`, `trabalhista-juridico-bf8a08`, `cbcrm-a3af0191-…-76ac04` — **4 × `open`**; `Session` = 4 linhas. `/license/status` → **404** (linha de base da 2.3.2).
- **Redis**: db 8 = 42 chaves; db 9 = **10** chaves (só os hashes de 17:04, sem TTL — os 6 apagados ainda estão lá: daí o `FLUSHDB` do 9 antes da cópia nova). Sessões PN por hash: `200ac9ef` **154** (era 152), `d1d9caf5` **142** (era 140), `be282022` 35, `44982408` 291; LID = 0, `lid-mapping` = 0 em todos.
- **Postgres**: banco `evolution` 579 MB, 6 conexões ativas (da Evolution); última migration `20250613143000_add_lid_column_to_is_onwhatsapp`.
- **Log 24 h**: `Closing session`/`stale` = 45; `"463"` = **0**; `DESCARTADA: endereçada por @lid` no CRM = **0**.
- **CRM**: `crm_crm` roda `cb-crm:7fe112d…` (= `origin/main` com o #161 e o #162) — item 2 do pré-voo **ok**.
- **Agendadas `pending`**: só `625d0c42…` (01/01/2030, a P8) — item 3 **ok**.
- **Máquina**: 65 GB livres em disco, ~5 GB de RAM disponíveis; `/root/backups/` com os 9 artefatos de 17:04.
- **Segunda passada (18:43, itens 11–15 do pré-voo)**: `DEL_INSTANCE=false`, `QRCODE_LIMIT=1902`, `SERVER_URL=https://api.cbadvogados.com`. Log de 24 h (arquivo de 18:24, 73.722 linhas, inclui o laço das órfãs até 17:27): `Bad MAC` 166, `No matching sessions` 20, `failed to decrypt` 20, `Decrypt` 352, `SessionError` 10, `keep alive` 82, `stream:error` 4, `Closing open session` 3, `Closing stale` 24, `qrcodeCount` 444, `error` 656. Migrations: imagem 59 × produção 55, nada faltando, 4 novas (nomes no item 12). `Chat` duplicado = 0. Bundle da imagem sem URL de licença em claro; fallback = mesma URL de produção. CRM: 1 automação de entrada ativa (teste, `keyword_match`), 0 esperas, 0 fluxos ativos; recebidas em 7 dias **2.324**, mediana por hora do dia (BRT) 8h 21 · 9h 21 · 10h 20 · 11h 37 · 12h 28 · 13h 28 · 14h 39 · 15h 47 · 16h 48 · 17h 34 · 18h 14 · 19h 4 · 20h 9 · 21h 3 · 22h 2 · 23h–7h 1–7; latência de entrada (n=186) **p50 1,22 s · p90 1,82 s · p95 2,09 s · máx 3,46 s**. Imagem de rollback no nó (id `7e614b07…`, 1,11 GB).

#### 9.3 Registro do pré-voo — parte de backup (09/09/2026, 18:24–18:25, horário de Brasília)

Script `prevoo-backup.sh` em segundo plano na VPS (`/root/backups/prevoo-run.log`), com o serviço **vivo**; carimbo **`20260909-1824`**:

- `pg_dump -Fc` → `evolution-20260909-1824.dump`, **14,3 MB em 5 s** (o de 17:04 tinha 105,8 MB — ver a cascata abaixo).
- Redis: db 8 = 36 chaves (era 42 às 18:10 — chaves `evolution:baileys:*` com TTL expirando); **`FLUSHDB` do db 9** (tinha 10 hashes, os 6 apagados inclusos) e cópia nova: **36 copiadas, 0 falhas, db 9 = db 8 = 36**; os 4 hashes `evolution:instance:*` vivos conferidos no db 9. `SAVE` + `redis-20260909-1824.rdb` (3,2 MB — o de 17:04 tinha 33,9 MB porque carregava os 6 hashes mortos).
- `instances-20260909-1824` (20 K, 4 pastas), log de 24 h (73.722 linhas), env (124 linhas, `chmod 600`), imagem, 55 migrations.
- **Restauração de prova** (`evolution_ensaio`, `pg_restore` em **5 s, 0 avisos**), mesmo corte: `Message` até 1 h antes **70.482 = 70.482**, última hora **52 = 52**; `Chat` 2.607 = 2.607; `Contact` 6.220 = 6.220; `IsOnWhatsapp` 22.626 = 22.626; `Instance` 4 = 4; `Session` 4 = 4; `Webhook` 4 = 4; `Setting` 4 = 4; `MessageUpdate` 10.836 = 10.836; `Media` 0 = 0; 55 migrations; 4 instâncias `open` no ensaio. Banco de ensaio apagado. Disco: 65 GB livres.
- ⚠️⚠️ **Achado: o `DELETE /instance/delete` das órfãs levou o HISTÓRICO delas junto.** Entre a prova de 17:25 (348.805 mensagens, 7.019 chats, 17.202 contatos, 6 instâncias) e esta (70.482 / 2.607 / 6.220, 4 instâncias) o banco perdeu ~278 mil linhas de `Message`: o `schema.prisma` da Evolution tem `onDelete: Cascade` de **toda** tabela filha para `Instance` (Message, Chat, Contact, MessageUpdate, IsOnWhatsapp não — ela é global —, Label, Media…). As linhas apagadas eram das instâncias `Bancario` e `CBAdv`: já **inalcançáveis** pelas conexões vivas (a Evolution consulta sempre por `instanceId`), e o CRM tem a cópia própria de tudo no Supabase. Nada do que as 4 conexões vivas usam mudou (hoje: `trabalhista-juridico` 30.280, `cbcrm-…` 26.916, `comercial-trabalhista` 11.908, `juridico-bancario` 1.430). O dump de **17:04** continua em `/root/backups/` com as 348 mil — é o único lugar onde o histórico das órfãs existe fora do Supabase. `pg_database_size` continua dizendo 579 MB (tuplas mortas até o `VACUUM`).
  **Prova** (dump de 17:04 restaurado de novo em `evolution_ensaio` às 18:40, 20 s, 0 avisos, e apagado): `Bancario` **177.185** mensagens / 3.512 chats / 6.309 contatos, `CBAdv` **101.287** / 900 / 4.684 — as duas em `connecting` (laço de QR); as vivas tinham `trabalhista-juridico` 30.231, `cbcrm-…` 26.894, `comercial-trabalhista` 11.894, `juridico-bancario` 1.430 — hoje 30.280 / 26.916 / 11.908 / 1.430, ou seja, **só cresceram**. 177.185 + 101.287 = 278.472 = a diferença.

#### 9.1 Registro da execução da Fase 0 (09/09/2026, 17:04–17:30)

- **Prova de restauração** (`evolution_ensaio`, 0 avisos do `pg_restore`), comparando o mesmo corte:
  `Message` até 1 h antes do dump **348.805 = 348.805**, última hora **116 = 116**; `Chat` 7.019 = 7.019; `Contact` 17.202 = 17.202; `IsOnWhatsapp` 22.622 = 22.622; `Instance` 6 = 6; `Session` 6 = 6; `Webhook` 5 = 5; `Setting` 6 = 6. Banco de ensaio apagado.
  ⚠️ Duas armadilhas da conferência, para não repetir: (1) comparar a contagem TOTAL de `Message` da produção com a do dump reprova sempre — chegam mensagens entre o dump e a conta (14 em 15 min); (2) `Message.id` é **texto (cuid)**, não inteiro — o corte tem de ser por `messageTimestamp`, não por `id`.
- **Amostras** (forma real da 2.3.2 em produção): mensagem de cliente em conversa LID chega com `remoteJid` = telefone, `previousRemoteJid` = LID e o telefone repetido em `senderPn`/`remoteJidAlt`; `fileLength` chega como **string** (`'43407'`, `'148421'`); `source` ∈ {`ios`, `web`, `unknown`}.
- **Órfãs**: `DELETE /instance/delete/{Bancario,CBAdv}` → `Instance deleted`; 5 s depois ainda apareciam como `close` (remoção assíncrona); ao fim, 4 instâncias, duplicata em `Chat` = 0, **0 linhas de QR** no minuto seguinte, 4 conexões `open`.
- **Redis**: 6 `DEL` confirmados; sobraram os 4 hashes vivos; o db 9 guarda a cópia de 17:04 (as chaves `evolution:baileys:*` têm TTL e expiram também na cópia — o que interessa são os hashes das instâncias, sem TTL).
- **Log durante a Fase 0**: `error in sending keep alive` (Timed Out) às 17:14, 17:18, 17:22 e 17:25 — **antes** das exclusões, durante o dump/restore (I/O pesado no mesmo Postgres) e com as órfãs ainda em laço; `stream:error 503` às 17:26:39 seguido de `connection.update` → `state: 'open'` às 17:26:40. As 4 conexões vivas terminaram `open`.
- **Agendada pendente**: ver a linha em 12 (P8).

### Fase 1 — upgrade

- [x] Pré-voo, parte só de leitura (6.2.0, itens 2, 3, 5, 6, 7) — 09/09 18:10, registro em 9.2
- [x] Pré-voo, parte de backup (6.2.0, item 4): dump novo, `FLUSHDB` do db 9 + cópia, RDB, restauração de prova, log — 09/09 18:24, carimbo `20260909-1824`, registro em 9.3
- [x] Operador confirmou janela e equipe avisada; **1 celular** à mão (os outros 3 números são de teste — QR em 10/09 se pedirem); P2 decidida (LID) — 09/09 noite
- [ ] Instância do celular à mão **nomeada** (P4) — é a que conta em 8.4
- [ ] `docker service scale evolution_evolution=0` e **foto final** (6.2, passos 0–1)
- [ ] `service update` com a imagem por digest + `TELEMETRY_ENABLED=false` (a 0 réplicas) e `scale --detach =1`; `date` anotado
- [ ] Migrations aplicadas (log) — anotar as 4 em `_prisma_migrations`; sem laço de reinício
- [ ] Cadastro/ativação feito **imediatamente**; `/license/status` OK; `date` anotado; `pg_dump -t RuntimeConfig` guardado
- [ ] 4 conexões `open` no banco/log (QR lido em: ______; as sem celular à mão ficam para 10/09)
- [ ] `lid-mapping-*` / `session-*_1.*` no Redis
- [ ] Prova da foto final em `evolution_ensaio` (count total igual) — depois do `scale=1`
- [ ] Intervalo `scale=1` → ativação recolhido no Supabase (anexos sem arquivo, disparos com falha)
- [ ] Log guardado a cada marco (migrations, `open`, ativação, fim dos testes) e antes do T22
- [ ] T1–T22 executados e registrados (8.1)
- [ ] Forma de `fileLength` anotada; ajuste 4 decidido

### Fase 2 — observação (48 h) e fechamento

- [ ] Medidores (8.3) registrados em 24 h e 48 h
- [ ] Nenhum "Aguardando mensagem" relatado
- [ ] Ajuste 5 (`GROUP_UPDATE`) + Ressincronizar nas 4 conexões
- [ ] `/root/evolution.yaml` atualizado (imagem por digest, `TELEMETRY_ENABLED`)
- [ ] Docs e `CLAUDE.md` atualizados (5.6); `EVOLUTION-LID-FIX.md` marcado obsoleto
- [ ] Memória do projeto atualizada
- [ ] **Apagar todas as worktrees paralelas** (`git worktree list` → `git worktree remove` de cada uma, inclusive as de outras sessões já encerradas) — pedido do operador em 09/09, para não ocupar espaço
- [ ] (Depois) log da Evolution fora do contêiner; desligar o outro CRM reduz aparelhos vinculados

---

## 10. Rollback

Gatilho batido (8.4) → executar na ordem, sem discutir. Comandos prontos no
Anexo B (bloco "Rollback"), em script. ⚠️ A ordem foi **corrigida em 09/09**
(revisão do Codex no PR #162): a versão anterior trocava a imagem **antes** de
escalar a 0, e `service update --image` começa a troca na hora — a 2.3.2
subiria contra o banco já migrado pela 2.4 e o Redis com estado v7, antes do
restore. E o banco vivo **não é dropado**: a foto é restaurada num banco novo,
conferida, e os dois trocam de nome (revisão adversarial da noite de 09/09) —
um `pg_restore` interrompido no meio deixaria a Evolution sem banco nenhum.

1. `docker service scale evolution_evolution=0` — **primeiro**; conferir
   `docker service ps` sem tarefa `Running`. Com 0 réplicas nada escreve no
   banco nem no Redis, e a troca de imagem do passo 4 não sobe tarefa nenhuma.
2. Postgres, **sem dropar**: `createdb evolution_volta` → `pg_restore
   --exit-on-error` da **foto final** (o dump mais recente com `-final`) em
   `evolution_volta`, em segundo plano com log → `count(*)` de `Message` em
   `evolution_volta` **igual** ao de `foto-<carimbo>.txt` → `pg_terminate_backend`
   em `evolution` → `ALTER DATABASE evolution RENAME TO evolution_v24; ALTER
   DATABASE evolution_volta RENAME TO evolution` (instantâneo; exige só que
   ninguém esteja conectado). O `evolution_v24` fica como evidência — e guarda
   a `RuntimeConfig` da licença. As 4 migrations novas **não** são desfeitas
   pela Evolution — só o dump volta, e ele traz o `_prisma_migrations` da
   2.3.2, então a 2.3.2 sobe sem migration pendente.
3. Redis db 8: `FLUSHDB` no **8** + `COPY` de cada chave do db 9 (foto final)
   de volta para o 8; `DBSIZE` do 8 = do 9 e `HLEN` dos 4 hashes = os de
   `foto-<carimbo>.txt`.
4. `docker service update --image ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694 --env-rm TELEMETRY_ENABLED evolution_evolution`
   — a 0 réplicas, só a especificação muda. A imagem está no nó (id
   `7e614b07…`, 1,11 GB, conferido em 09/09); **nenhum `docker image prune` /
   `system prune`** na janela nem nas 48 h.
5. `docker service scale --detach evolution_evolution=1`; **reler `CID`**;
   versão `2.3.2`/`6.7.19` no contêiner; `Instance."connectionStatus"` = `open`
   nas 4 (banco), depois `fetchInstances`.
6. **Conferência obrigatória, não espera**: trocar mensagem nos dois sentidos
   com o contato autorizado por cada conexão viva e `grep -E 'Bad MAC|No
   session|Failed to decrypt|Closing stale'` no log da 2.3.2. Regra decidida
   antes: rollback executado **depois de tráfego real com a v7** (T1 em
   diante, ou minutos de mensagens do celular) → os clientes já usam as chaves
   publicadas pela v7 e o estado restaurado não as tem → **desconectar e ler
   QR** nas conexões (em 09/09 só a do celular à mão; as outras 3 em 10/09).
   O celular do escritório não é afetado. O CRM **não enxerga** "Aguardando
   mensagem" (seção 1) — por isso é conferência, não espera por reclamação.
7. Licença: a ativação **local** fica em `evolution_v24` (tabela `RuntimeConfig`)
   e no dump `evolution-runtimeconfig-…` do passo 4 da 6.2; numa 2ª tentativa,
   restaurar só essa tabela depois do `prisma migrate deploy` dispensa novo
   cadastro. O cadastro na fundação fica registrado (inofensivo para eles).
   Mensagens recebidas durante a janela quebrada ficam no celular/outro CRM,
   não no nosso.

**O que o rollback NÃO devolve:** o que o WhatsApp registrou do lado dele
(chaves/aparelho) — coberto pelo passo 6; o volume `evolution_instances`, que
fica como a 2.4 o deixou (28 K, **sem material de sessão**: as creds estão em
`Session` e as chaves Signal no hash do Redis — `auth-prisma.ts`; a cópia do
pré-voo `instances-<carimbo>` é o plano B); e as chaves `evolution:baileys:*`
com TTL, que expiram no db 9 durante a janela — são cache de dedup/ack,
recriadas sozinhas, não restauradas de propósito.

---

## 11. Plano B de emergência (paliativo)

Se a operação precisar de alívio **antes** do upgrade: purgar as sessões da
instância afetada e reiniciar a Evolution. É **reset**, não conserto — a
duplicidade volta em dias ou semanas (relatos de 1–2 dias a semanas).

1. `docker service scale evolution_evolution=0` — **obrigatório**: a Evolution
   (2.3.2 e `develop`, conferido no fonte) envolve as chaves em
   `makeCacheableSignalKeyStore`, um cache em memória; apagar no Redis com a
   instância viva deixa sessão fantasma em memória até o cache expirar.
2. No Redis db 8, no hash `evolution:instance:<id>`: apagar **só** os campos
   `session-*` (manter `pre-key-*`, `app-state-sync-*`, `sender-key-*`; as creds
   estão no Postgres e não são tocadas). Fazer a cópia para o db 9 antes.
3. `docker service scale evolution_evolution=1`. Sem QR. A primeira mensagem a
   cada contato reestabelece uma sessão única.
4. Também remover as instâncias órfãs (6.1, item 1).

---

## 12. Decisões pendentes e perguntas em aberto

| # | Pendência | De quem |
| --- | --- | --- |
| ~~P1~~ | **Resolvida 09/09**: cadastro com `leonardocabralb@gmail.com` (telefone informado ao executor, fora do repositório) | — |
| ~~P2~~ | **Resolvida 09/09 (noite)**: `group_sender_jid` continua LID (5.2) — decisão do operador; nada muda no código | — |
| ~~P3~~ | **Autorizada 09/09** e executada (seção 9, Fase 0) | — |
| ~~P4~~ | **Resolvida 09/09 (noite)**: janela aberta; o operador tem **só 1 celular à mão** e aceitou o risco — os outros 3 números foram conectados **para teste**, ninguém os usa; se pedirem QR, ficam desconectados e a leitura fica para 10/09. Equipe avisada (celular/outro CRM). **Qual instância o celular à mão atende: ______ (confirmar antes do `scale=0` — é a única que entra no gatilho de 8.4)** | operador nomeia |
| P5 | Forma de `fileLength` na versão nova → ajuste 4 | teste T5 |
| P6 | Latência de entrada com rc13 (5.6 dos riscos) | teste T21 |
| P7 | Log da Evolution fora do contêiner (fora deste plano, registrar) | depois |
| P9 | **Rotacionar a `AUTHENTICATION_API_KEY` depois da Fase 1?** Ela viaja em claro (sobre TLS) ao servidor da fundação em todo boot sem licença (7.3). Custo: novo valor em `AUTHENTICATION_API_KEY` (Evolution) e `EVOLUTION_GLOBAL_API_KEY` (`crm.env` + `service update --env-add` no `crm_crm`); as chaves por instância em `cb_channels.api_key` não mudam | operador |
| P8 | A única agendada `pending` (09/09) é **resto de teste automatizado** de 30/08 ("TESTE Fase 3 - fora do escopo", autor "TESTE AUTOMATIZADO", marcada para 01/01/**2030**) — não dispara na janela; cancelar quando quiser. Reconferida em 09/09 18:10: continua a única `pending` | operador (sem urgência) |

---

## 13. Anexo A — estado medido em 09/09/2026

### Instâncias na Evolution (tabela `Instance`) × canais do CRM (`cb_channels`)

| Instância (Evolution) | `id` | `ownerJid` | Estado | Canal no CRM | `own_lid` | Grupos | Hash Redis (campos) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cbcrm-a3af0191-5adc-4fa8-9c27-d69c2e5666d8-76ac04` | `44982408-b357-449c-adae-06ff28dc1dd3` | 5511964102992 | open | Bancário - Comercial (padrão) | NULL | 0 | 1.235 (280 sessões PN, 908 pre-keys, 13 sender-keys) |
| `juridico-bancario-d5a458` | `be282022-d83d-4800-a4da-f139ce034310` | 558388711991 | open | Bancário - Jurídico | `40373380473043@lid` | 12 | 274 |
| `comercial-trabalhista-e7c7ea` | `200ac9ef-98e0-4f35-a43e-f22ea168e7bd` | 558399673788 | open | Trabalhista - Comercial | NULL | 0 | 407 |
| `trabalhista-juridico-bf8a08` | `d1d9caf5-24db-48a6-a58c-8d0953200f7c` | 558386262646 | open | Trabalhista - Jurídico (`display_phone` NULL) | NULL | 0 | 664 |
| ~~`Bancario`~~ (órfã, **removida 09/09 17:27**) | `385dac9a-e446-44d9-be94-68ab94935e2e` | 5511964102992 | era `connecting` em laço de QR | — | — | — | 9.454 (cópia no db 9) |
| ~~`CBAdv`~~ (órfã, **removida 09/09 17:27**) | `c68ecb8d-5b13-4d0b-85b9-c3d9b89a01a2` | 558386262646 | era `connecting` em laço de QR | — | — | — | 3.074 (cópia no db 9) |
| ~~(apagadas, só hash)~~ **removidas 09/09** | `f71807c0-…`, `7fc75fe2-…`, `dcbf9851-…`, `60a309e7-…` | — | — | — | — | — | 3.078 / 86 / 30 / 2.720 (cópias no db 9) |

Canais do CRM sem instância na Evolution: "WhatsApp (QR Code)" (`Gabriel -
Teste`, padrão, 0 msgs) e "TESTE Bancario" (`teste-bancario-fase3`,
desconectado) — sobras de teste.

### Serviço `evolution_evolution`

- Imagem: `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694`
  (Evolution 2.3.2, Baileys 6.7.19 com o patch `peer_recipient_pn`, sem `tc-token-utils`).
- Label `com.docker.stack.image` diz `evoapicloud/evolution-api:latest` — **stale**, como o `CLAUDE.md` já documenta; nunca pinar por ele.
- Traefik: `Host(api.cbadvogados.com)`, entrypoint `websecure`.
- Volume: `evolution_instances` → `/evolution/instances` (28 K).
- `UpdateConfig` e `RollbackConfig` (medidos 09/09 18:10): `Order: stop-first`, `Parallelism 1`, `FailureAction pause`, `Monitor 5s`; `RestartPolicy: any`, atraso 5 s. Ou seja, um `service update` para a tarefa antiga antes de subir a nova — nunca há duas Evolutions vivas.
- Log: `json-file`, `max-size 10m`, `max-file 3`.
- Env relevante: `CACHE_REDIS_ENABLED=true`, `CACHE_LOCAL_ENABLED=false`,
  `CACHE_REDIS_SAVE_INSTANCES=false`, `CACHE_REDIS_PREFIX_KEY=evolution`,
  Redis `redis://redis:6379/8` (sem senha), Postgres host `postgres`, banco
  `evolution`, user `postgres` (PostgreSQL 14.17), `DATABASE_SAVE_DATA_NEW_MESSAGE=true`,
  `DATABASE_SAVE_MESSAGE_UPDATE=true`, `S3_ENABLED=false`, `WEBHOOK_GLOBAL_ENABLED=false`,
  `QRCODE_LIMIT=1902`, `CONFIG_SESSION_PHONE_VERSION=2.3000.1025193442` (ignorada),
  `TELEMETRY`/`TELEMETRY_URL` presentes com nome que a versão nova **não lê**
  (ela lê `TELEMETRY_ENABLED`).
- Redis 7.4.2, `dir /data`; keyspace: db0 559 chaves (outros serviços), db2 4, db8 130 (Evolution). `COPY … DB n REPLACE` conferido funcionando (teste em db descartável).
- Tabela `Session` (creds): uma linha por instância, as 6 presentes (1,2–3,2 KB cada); `psql -U postgres` pelo socket do contêiner entra sem senha.
- Postgres: bancos `evolution` (579 MB), `n8n_queue` (262 MB), `postgres`. ⚠️ Depois da remoção das órfãs (17:27) o `evolution` tem **70,5 mil** `Message` (eram 348,8 mil): a cascata do `DELETE` — ver 9.3. O tamanho em disco não caiu (tuplas mortas).
- VPS: 2 CPUs, 8 GB RAM (5 GB disponíveis), 67 GB livres em disco.
- `/root/evolution.yaml` (28/07/2026) incompleto; `/root/backups` não existe.

### Envios por origem (CRM, `messages.from_me = true`)

| Dia | Texto pelo celular | Texto pelo CRM | Áudio | Imagem | Documento |
| --- | --- | --- | --- | --- | --- |
| 09/09 (até ~15h) | 225 | 17 | 31 | 1 | 1 |
| 08/09 | 493 | 77 | 90 | 16 | 0 |
| 04/09 | 306 | 49 | 44 | 7 | 5 |

Zero `failed` em 12 dias.

---

## 14. Anexo B — comandos de referência

Acesso: `ssh -i ~/.ssh/cb-crm-vps root@vps.cbadvogados.com` (chave da máquina
do operador). Todos os comandos abaixo são de leitura, salvo onde marcado.
⚠️ **Cada bloco começa pelo preâmbulo de variáveis** e roda como **script**
(`nohup bash bloco.sh > /root/backups/bloco-$CARIMBO.log 2>&1 &`, e ler o log)
— as variáveis de uma sessão SSH não existem na seguinte, `$CID` muda a cada
`scale`/`update`, e `docker exec $CID …` sem contêiner falha em silêncio dentro
de uma redireção (o arquivo nasce vazio). A `KEY` sai da **especificação** do
serviço, que não depende de contêiner vivo.

```bash
# Preâmbulo (repetir no topo de TODO bloco/script)
set -uo pipefail
CID=$(docker ps -q -f name=evolution_evolution | head -1)        # vazio com 0 réplicas — reler depois de scale/update
RCID=$(docker ps -q -f name=redis_redis | head -1)
PGCID=$(docker ps -q -f name=postgres_postgres | head -1)
RC="docker exec $RCID redis-cli -n 8"
KEY=$(docker service inspect evolution_evolution --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | sed -n 's/^AUTHENTICATION_API_KEY=//p')
B=/root/backups; mkdir -p $B
q() { docker exec $PGCID psql -U postgres -d "$1" -Atc "$2"; }   # ⚠️ -d ANTES de -Atc

# Contêiner e imagem em execução
docker service inspect evolution_evolution --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
docker service inspect evolution_evolution --format '{{json .Spec.UpdateConfig}}'   # Order tem de ser stop-first
docker exec $CID sh -c 'grep -m1 "\"version\"" package.json; grep -m1 "\"version\"" node_modules/baileys/package.json'
docker image inspect ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694 --format '{{.Id}} {{.Created}}'   # imagem de rollback no nó

# Medidores no log (o log só cobre desde o último reinício do contêiner)
timeout 90 docker service logs evolution_evolution --since 24h 2>&1 | grep -cE 'Closing session|Closing stale'
timeout 90 docker service logs evolution_evolution --since 24h 2>&1 | grep -c '"463"'
timeout 90 docker service logs crm_crm --since 24h 2>&1 | grep -c 'DESCARTADA: endereçada por @lid'

# Estado das instâncias (token não impresso). ⚠️ Atrás do portão de licença: 503 até ativar — use o banco.
curl -s -m 20 -H "apikey: $KEY" https://api.cbadvogados.com/instance/fetchInstances | python3 -c 'import sys,json; [print(i["name"], i["connectionStatus"]) for i in json.load(sys.stdin)]'
q evolution 'select name, "connectionStatus", "ownerJid" from "Instance"'

# Redis db 8: hashes e composição (só contagens)
for h in $($RC --scan --pattern 'evolution:instance:*'); do printf '%s ' "$h"; $RC HKEYS "$h" | awk '/^session-[0-9]+_1\./{lid++} /^session-[0-9]+\./{pn++} /^lid-mapping/{lm++} END{print "PN="pn+0" LID="lid+0" lid-mapping="lm+0}'; done

# Postgres da Evolution (a senha está no env do contêiner; não imprimir)
q evolution 'select migration_name from _prisma_migrations order by finished_at desc limit 5'
q evolution 'select "remoteJid", lid from "IsOnWhatsapp" where "remoteJid" like '"'"'55119953%'"'"''

# Backup — pré-voo COM o serviço vivo (CARIMBO=<data-hora>) ou FOTO FINAL com o serviço a 0
# (CARIMBO=<data-hora>-final). Cria arquivos; não altera o serviço. Medido em 09/09: dump 5 s.
CARIMBO=$(date +%Y%m%d-%H%M)          # foto final: CARIMBO=$(date +%Y%m%d-%H%M)-final
docker exec $PGCID pg_dump -U postgres -Fc evolution > $B/evolution-$CARIMBO.dump
test -s $B/evolution-$CARIMBO.dump || { echo "DUMP VAZIO"; exit 1; }
docker exec -i $PGCID pg_restore -l < $B/evolution-$CARIMBO.dump | grep -c 'TABLE DATA'   # arquivo truncado falha aqui
ls -l $B/evolution-$CARIMBO.dump && echo DUMP-OK
q evolution 'select count(*), max("messageTimestamp") from "Message"' > $B/foto-$CARIMBO.txt      # referência para o rollback
# ⚠️ O db 9 guarda a cópia anterior: esvaziar ANTES de copiar de novo — só o db 9! (Codex, PR #162)
docker exec $RCID redis-cli -n 9 FLUSHDB
n=0; for k in $($RC --scan --pattern '*'); do r=$($RC COPY "$k" "$k" DB 9 REPLACE); n=$((n+1)); [ "$r" = 1 ] || echo "COPY falhou: $k"; done; echo "copiadas=$n"
echo "db8=$($RC DBSIZE) db9=$(docker exec $RCID redis-cli -n 9 DBSIZE)"   # foto final (serviço a 0): IGUAIS. Pré-voo: podem diferir (chaves com TTL nascendo/expirando) — compare os 4 hashes:
for h in $($RC --scan --pattern 'evolution:instance:*'); do echo "$h $($RC HLEN $h) $(docker exec $RCID redis-cli -n 9 HLEN $h)"; done | tee -a $B/foto-$CARIMBO.txt
antes=$($RC LASTSAVE); $RC BGSAVE; until [ "$($RC LASTSAVE)" != "$antes" ]; do sleep 1; done   # BGSAVE, não SAVE: o Redis é compartilhado (db0/db2)
docker cp $RCID:/data/dump.rdb $B/redis-$CARIMBO.rdb && ls -l $B/redis-$CARIMBO.rdb
[ -n "$CID" ] && docker cp $CID:/evolution/instances $B/instances-$CARIMBO   # só com o contêiner vivo (pré-voo)
timeout 120 docker service logs evolution_evolution --since 24h > $B/evolution-log-$CARIMBO.txt 2>&1
[ -n "$CID" ] && { docker exec $CID printenv | sort > $B/evolution-env-$CARIMBO.txt; chmod 600 $B/evolution-env-$CARIMBO.txt; }

# Restauração de prova (cria e apaga um banco de ensaio). Mesmo $CARIMBO do dump acima.
# Serviço VIVO: comparar Message no MESMO corte de messageTimestamp (o id é cuid; a produção
# continua recebendo). Serviço a 0 (foto final, depois do scale=1): o count(*) TOTAL bate.
docker exec $PGCID dropdb -U postgres --if-exists evolution_ensaio
docker exec $PGCID createdb -U postgres evolution_ensaio
docker exec -i $PGCID pg_restore --exit-on-error -U postgres -d evolution_ensaio < $B/evolution-$CARIMBO.dump; echo "restore rc=$?"
MTS=$(q evolution_ensaio 'select max("messageTimestamp") from "Message"')
q evolution_ensaio "select count(*) from \"Message\" where \"messageTimestamp\" < $MTS - 3600"
q evolution        "select count(*) from \"Message\" where \"messageTimestamp\" < $MTS - 3600"   # têm de bater
q evolution_ensaio 'select count(*), max("messageTimestamp") from "Message"'; cat $B/foto-$CARIMBO.txt   # foto final: iguais
docker exec $PGCID dropdb -U postgres evolution_ensaio

# Rollback (DESTRUTIVO — só com um gatilho de 8.4 batido; a ORDEM é a da seção 10). FOTO=<carimbo>-final
docker service scale evolution_evolution=0
docker service ps evolution_evolution --format '{{.Name}} {{.CurrentState}}' | head -3      # nenhuma Running
docker exec $PGCID dropdb -U postgres --if-exists evolution_volta; docker exec $PGCID createdb -U postgres evolution_volta
docker exec -i $PGCID pg_restore --exit-on-error -U postgres -d evolution_volta < $B/evolution-$FOTO.dump; echo "restore rc=$?"   # rc tem de ser 0
q evolution_volta 'select count(*), max("messageTimestamp") from "Message"'; cat $B/foto-$FOTO.txt   # IGUAIS, senão PARAR
q postgres "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('evolution','evolution_volta') and pid <> pg_backend_pid()"
q postgres 'alter database evolution rename to evolution_v24'
q postgres 'alter database evolution_volta rename to evolution'
docker exec $RCID redis-cli -n 8 FLUSHDB     # só o db 8!
for k in $(docker exec $RCID redis-cli -n 9 --scan --pattern '*'); do docker exec $RCID redis-cli -n 9 COPY "$k" "$k" DB 8 REPLACE >/dev/null; done
echo "db8=$($RC DBSIZE) db9=$(docker exec $RCID redis-cli -n 9 DBSIZE)"   # iguais
for h in $($RC --scan --pattern 'evolution:instance:*'); do echo "$h $($RC HLEN $h)"; done; cat $B/foto-$FOTO.txt   # HLEN iguais
docker service update --image ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694 --env-rm TELEMETRY_ENABLED evolution_evolution
docker service scale --detach evolution_evolution=1
sleep 20; CID=$(docker ps -q -f name=evolution_evolution | head -1)                       # RELER
docker exec $CID sh -c 'grep -m1 "\"version\"" package.json'                              # 2.3.2
q evolution 'select name, "connectionStatus" from "Instance"'                             # 4 × open
```

Consultas no Supabase do CRM (projeto `hxnhakmyxyhalbsktzwe`):

```sql
-- mensagens por origem e status (últimos dias)
select date_trunc('day', created_at at time zone 'America/Sao_Paulo')::date dia, content_type, status,
       count(*) filter (where from_device) pelo_celular, count(*) filter (where not from_device) pelo_crm
from messages where from_me and created_at > now() - interval '7 days' group by 1,2,3 order by 1 desc;

-- canais e own_lid
select label, instance_name, display_phone, own_lid, groups_enabled, status from cb_channels order by created_at;

-- agendadas pendentes (tem de ser zero na janela)
select count(*) from cb_scheduled_messages where status = 'pending';

-- latência de entrada (T21 / 8.3): última mensagem do cliente por conversa, relógio do CRM − relógio do WhatsApp
select percentile_cont(0.5) within group (order by extract(epoch from c.last_message_at - m.created_at)) p50,
       percentile_cont(0.95) within group (order by extract(epoch from c.last_message_at - m.created_at)) p95, count(*)
from conversations c join lateral (select created_at, from_me from messages where conversation_id = c.id order by created_at desc limit 1) m on true
where not m.from_me and c.last_message_at > now() - interval '2 hours';

-- entrada por hora (8.3): comparar com a mediana por hora do dia de 9.2
select date_trunc('hour', created_at at time zone 'America/Sao_Paulo') h, count(*) from messages
 where not from_me and created_at > now() - interval '48 hours' group by 1 order by 1;

-- o que dispara sozinho na reconexão (6.2.0, item 11)
select id, name, trigger_type from automations where is_active and trigger_type in ('new_message_received','first_inbound_message','keyword_match');
select count(*) from automation_pending_executions where status = 'pending' and run_at < now() + interval '3 hours';
select count(*) from flow_runs where status = 'active';

-- intervalo scale=1 → ativação (6.2, passo 8): anexos recebidos sem arquivo, disparos que falharam
select id, conversation_id, content_type, media_state, created_at from messages
 where from_me = false and media_url is null and content_type in ('image','document','audio','video')
   and created_at between '<scale=1>' and '<ativação>';
select status, count(*) from cb_scheduled_messages where updated_at between '<scale=1>' and '<ativação>' group by 1;
```

---

## Anexo C — prompt de retomada (colar numa sessão nova)

> Estamos no meio do plano `docs/PLANO-baileys-7.md` do repositório CB-CRM
> (conserto do "Aguardando mensagem": subir a Evolution para a imagem
> `homolog` com Baileys 7.0.0-rc13). Leia o plano inteiro antes de agir —
> primeiro a **seção 0** (onde está cada coisa, o que já foi feito, o que
> falta, as armadilhas), depois **6.2.0** (pré-voo), **6.2** (upgrade), **8**
> (testes e gatilhos de rollback), **10** (rollback) e o **Anexo B**
> (comandos). Leia também a memória `baileys-7-plano-e-decisoes` (tem o
> telefone do cadastro, que não está no repositório). A Fase 0 está
> concluída; o próximo trabalho é o **pré-voo e a Fase 1**. Não execute nada
> destrutivo nem troque a imagem da Evolution sem eu autorizar nesta conversa
> — comece me perguntando se a janela está aberta e se os 4 celulares estão
> à mão, e então rode o pré-voo (só leitura e backup) e me apresente o
> resultado antes do `service update`. Trabalhe numa worktree separada
> criada de `origin/main`; o checkout principal pode estar em outra branch.
> Ao terminar cada fase, atualize o plano (checklist + registro com data) e
> a memória.

## 15. Fontes

**Reverificado em 09/09 (noite)**, depois de a revisão adversarial achar que as cópias locais do guia e do changelog eram páginas 503: o guia v7 real (`baileys.wiki/migration/v7`) diz textualmente *"By default, all new Signal sessions in Baileys 7.x are created in the LID format, and existing sessions are migrated automatically"* (a premissa "sem QR" da 4.5/7.2) e descreve o `Contact` como o código do #161 implementa (*"id is the preferred identifier; phoneNumber is populated when id is a LID; lid is populated when id is a PN — these changes also affect participants on GroupMetadata"*). O guia também diz *"ACKs no longer sent"* — **não** é o recibo de entrega: `src/Socket/messages-recv.ts` da rc13 (linhas 1740–1758) manda `sendReceipt(remoteJid, participant, [id], type)` com `type` vazio (= entregue) exatamente como a 6.7.19 (linha 856); só o `read` depende de `sendActiveReceipts`. T14 continua sendo o teste. A release rc13 no GitHub é só o conserto do `protocolMessage` (`fromMe` falso) sobre a rc12.

- Evolution API — fontes por tag/branch (`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`, `src/api/dto/*`, `src/validate/instance.schema.ts`, `src/api/integrations/event/**`, `src/config/env.config.ts`, `src/utils/use-multi-file-auth-state-prisma.ts`, `src/utils/sendTelemetry.ts`, `src/licensing/runtime.ts`, `src/api/guards/auth.guard.ts`, `prisma/postgresql-migrations/**`, `Dockerfile`, `package.json`): https://github.com/evolution-foundation/evolution-api — tags `2.3.2`, `2.3.7`, `2.4.0-rc2`, branch `develop` (commit de 14/07/2026)
- Notas de release 2.3.3 → 2.4.0-rc2: https://github.com/evolution-foundation/evolution-api/releases
- Licença: https://docs.evolutionfoundation.com.br/en/licensing · issue #2534 (ativação e deploys automatizados): https://github.com/evolution-foundation/evolution-api/issues/2534
- `PENDING` para sempre / 463 (rc.9) e relatos com rc13: https://github.com/evolution-foundation/evolution-api/issues/2597
- "Aguardando mensagem" na Evolution: https://github.com/EvolutionAPI/evolution-api/issues/1731 · https://github.com/evolution-foundation/evolution-api/issues/1934
- Baileys — guia v7: https://baileys.wiki/migration/v7 · rc13: https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc13 · investigação do 463: https://github.com/WhiskeySockets/Baileys/issues/2441 · sessões: https://github.com/WhiskeySockets/Baileys/issues/1701 · https://github.com/WhiskeySockets/Baileys/issues/1964
- Baileys rc13 — fontes conferidos: `src/Socket/messages-recv.ts` (recibos), `src/Types/Contact.ts` e `src/Types/GroupMetadata.ts` (participantes), `src/Defaults/index.ts` (opções padrão)
- Docker Hub `evoapicloud/evolution-api` (tags/datas) e inspeção local da imagem `homolog` na VPS (09/09/2026)
- Medições próprias de 09/09/2026: Supabase do CRM, banco `evolution`, Redis db 8, logs e serviço na VPS, código do CRM (`src/lib/whatsapp/transport/*`, `src/app/api/whatsapp/evolution/webhook/route.ts`, `src/lib/whatsapp/inbound-store.ts`, `src/lib/cb-groups/*`, `src/lib/contacts/foto-de-perfil.ts`, `src/lib/whatsapp/send-message.ts`)
