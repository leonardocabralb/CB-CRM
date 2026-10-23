---
paths:
  - ".github/**"
  - "Dockerfile"
  - "docker-stack.yml"
  - "docker/**"
  - "ops/**"
  - "next.config.ts"
  - ".nvmrc"
  - "package.json"
  - "mcp-server/package.json"
  - "scripts/produto-gate.test.ts"
  - "scripts/env-documentado.test.ts"
  - "scripts/stack-env.test.ts"
  - "scripts/vps-inventario.sh"
  - ".env.local.example"
---

# Deploy, CI e toolchain — regras

Vale para o pipeline, o Dockerfile, a stack do Swarm, o agendador, a versão do
Node e a operação da VPS. O essencial (push no `main` publica; build-arg; as
três linhas do `stack deploy`) está na raiz, seção 10. ⚠️ Antes de QUALQUER
comando na VPS: `docs/INFRA-VPS.md` inteiro — domínio, endereços e digests
moram lá, não aqui.

### Pipeline: um workflow só
- `.github/workflows/pipeline.yml`: verificar (lint, typecheck, test, build e os
  portões de i18n) → migrations (replay num Postgres limpo) → deploy, com
  `needs: [verificar, migrations]`. Pino `.github/workflows/pipeline.test.ts`:
  tirar `migrations` do `needs` reprova — migration quebrada seria descoberta
  só pela PRÓXIMA instalação, a que monta o banco do zero.
- ⚠️ `ci.yml` e `migrations.yml` são do upstream e voltam a cada merge: apagar
  de novo, senão as etapas rodam duas vezes por push e sem portão.
- ⚠️⚠️ Push no `main` = produção. O rollout é `docker service update --image
  <repo>:<sha>`.
- Vários merges seguidos não geram um deploy por PR: o GitHub guarda UM run
  pendente por grupo de concorrência, o do meio morre na FILA e o último
  publica todos. O histórico do Actions não diz o que foi publicado quando.
- ⚠️ `NEXT_PUBLIC_*` é inlinado no BUILD (idioma, Supabase, endereço do
  site): muda no `pipeline.yml` e exige rebuild; o `crm.env` não muda nada
  disso. "Produção diferente do meu local": confira o build-arg antes do
  env. Nome e logo NÃO são build-arg: são dado (`.claude/rules/marca.md`).

### Node: uma major, no `.nvmrc`
Teste de Intl, fuso ou colação muda entre majors do V8 (já reprovou no CI o que
passou na máquina). Por isso:
- O CI lê `node-version-file: .nvmrc`. Merge do upstream traz `node-version:
  <n>` cravado: trocar de volta.
- `ARG NODE_VERSION` do `Dockerfile` é o único número duplicado (`FROM` não lê
  arquivo do contexto): mudou um, muda o outro.
- `engines` `>=22.12.0` (raiz E `mcp-server/`) é piso DERIVADO dos `engines` de
  `vite`/`rolldown`: não baixar sem conferir as dependências.
- `packageManager: npm@10.9.9` é o npm do Node 22: subir a major sem subir o pin
  descasa CI e Dependabot.
- Máquina nova: `nvm use` na raiz; asdf precisa de `legacy_version_file = yes`.

### `next.config.ts`
- ⚠️ `agentRules: false`: sem ela, o `next dev` (16.3+) reescreve o
  `AGENTS.md` rastreado — que o `CLAUDE.md` importa — e toda worktree com dev
  server fica suja. Merge que traga o arquivo cru do upstream tira a linha; o
  sintoma é ` M AGENTS.md` sozinho no `git status`.
- Páginas saem com `Cache-Control: private, no-store` (#626 do original):
  `public` deixaria um cache compartilhado servir a página de uma pessoa a
  outra. Exceções: `opus/`, `inbox-doodle.svg` e `marca/` (o logo padrão em
  toda página), senão o navegador baixa o gravador a cada nota de voz.
  Arquivo novo de `public/` usado a toda hora entra na exceção. Pino NOSSO
  `src/next-config.excecoes.test.ts` (o `next-config.test.ts` é o do
  original, igual).

### Agendador: nada dispara sozinho
- O serviço `agendador` do `docker-stack.yml` bate nas rotas de cron em dois
  laços SEQUENCIAIS (curl e só então sleep — ciclo lento não empilha): o
  RÁPIDO (`curl -m 50`, `sleep 15`) e o LENTO (`-m 120`, `sleep 900`). Rota de
  cron nova entra num deles, senão nunca roda.
- ⚠️ `maxDuration` das rotas é DECORATIVO em produção (standalone,
  `node server.js`): o teto real é o `-m` do curl. Worker novo orça o ciclo
  contra ele.
- ⚠️⚠️ O CI NÃO relê o `command` do agendador: mudar um laço só vale depois de
  `docker stack deploy` manual na VPS, com o `crm.env` carregado.
- ⚠️ A rota `cb/asaas/cron` carrega a leitura do Atlas em `after()`
  (`integracoes-atlas.md`): tirá-la do laço lento cala o Atlas junto.
- ⚠️ A rota `cb/scheduled/cron` (laço lento) roda no `after()`
  `rodarManutencaoDoCiclo` (`src/lib/scheduled/manutencao-do-ciclo.ts`): sob
  UM prazo comum (`PRAZO_DA_MANUTENCAO_MS`) e nesta ordem, cada passo
  isolado, as tarefas recorrentes (1074) → o vencimento da Lixeira de
  contatos (`cb_vencer_lixeira`, UM item por chamada, repetida enquanto há
  prazo) → a drenagem da fila de arquivos (`midia.md`). O prazo fica abaixo
  dos 10 min em que a fila recolhe o lote reivindicado e dos 15 min do laço.
  O `after()` não disputa o `-m 120` com o disparo. Tirar a rota do laço cala
  os três sem erro: a Lixeira deixa de vencer e os arquivos ficam no bucket
  (também os anexos das anotações apagadas, 1102).

### Ambiente do contêiner
- O `docker-stack.yml` passa o ambiente por `environment:` EXPLÍCITO, sem
  `env_file`: variável que está no `crm.env` e não na lista nunca chega ao
  contêiner, sem erro. Pino `scripts/stack-env.test.ts` (toda `process.env.X`
  lida pelo servidor está repassada; `NEXT_PUBLIC_*` ficam de fora).
- `scripts/env-documentado.test.ts`: toda `process.env.X` lida em `src/`
  aparece no `.env.local.example` como `X=` (comentada ou não) — quem copia o
  exemplo tem de saber o que falta. `mcp-server/` tem `.env.example` próprio.
- ⚠️⚠️ **`docker stack deploy` sem carregar o `crm.env` zera TODOS os
  segredos** (o `${VAR}` ausente vira string vazia) e o site continua em 200:
  webhook não grava, envio não sai, as rotas de cron devolvem 503. Sempre as
  três linhas da raiz. ⚠️ A imagem sai de
  `.Spec.TaskTemplate.ContainerSpec.Image`, NUNCA do rótulo
  `com.docker.stack.image`: o CI publica por `service update`, que não
  atualiza o rótulo — pinar por ele rola a produção para trás em silêncio.
- Conferir DENTRO do contêiner (o spec mostra o nome mesmo com valor vazio):
  `printenv SUPABASE_SERVICE_ROLE_KEY | wc -c` (0 = quebrado) e `curl` numa
  rota de cron (401 = segredo no lugar; 503 = env vazia).
- ⚠️ `META_APP_SECRET` com vários segredos: vírgula SEM espaço. Com `a, b`, o
  `set -a; . crm.env` faz a variável SUMIR e todo webhook da Meta vira 401 —
  conferir `printenv META_APP_SECRET | wc -c`.
- Webhook do WhatsApp exige HTTPS (o Traefik termina o TLS).

### Evolution (serviço próprio no mesmo Swarm)
- Imagem NOSSA (`docker/evolution-cb/`: um commit do `develop` + os patches),
  sempre por DIGEST; vigente e rollback em `docs/INFRA-VPS.md`. A stack está em
  `ops/vps/evolution-stack.yml`, e `docker stack deploy` da Evolution só serve
  para RECRIAR o serviço (o `.yml` não acompanha `service update`): trocou o
  digest, atualize o `.yml` junto.
- ⚠️⚠️ Nunca trocar a imagem nem reiniciar o contêiner com a fila de entrada
  represada: a Baileys confirma ao servidor ANTES do handler, e a fila se perde
  para o CRM. Só com `entrega_recebida_em − entrega_carimbo_em` perto de 0 s em
  todas as conexões.
- Voltar de versão da imagem está DESCARTADO (decisão do operador): a atual
  resolveu o "Aguardando mensagem".
- O cron `docker image prune -af` apaga as imagens de rollback na madrugada
  (voltam por `pull`). O log da Evolution morre no reinício do contêiner. O
  Redis é compartilhado com outros serviços: backup só do banco da Evolution.
  `TELEMETRY_ENABLED=false`.

### Sentinela do WhatsApp (`ops/vps/saude-whatsapp/`)
- Cron de hora em hora NA VPS (`docs/INFRA-VPS.md` §12): só lê e avisa no
  sino (`whatsapp_alert`, 1085). ⚠️ O CI NÃO a publica: mudou o
  `sentinela.py`, copie para `/root/saude-whatsapp/` e confira com
  `--simular` (não grava nada). Mudou limiar ou aviso, atualize a tabela da
  §12 no mesmo PR.
- ⚠️ Python 3.8 (Ubuntu 20.04) e só biblioteca padrão: nada de `match`,
  `str.removeprefix` nem tipo `list[str]` em tempo de execução.
- Ela é a coleta dos logs para a varredura semanal: o log da Evolution cobria
  ~6 h em 13/10. Desligar o cron abre buraco no histórico.

### Código que viaja para quem instala
- `scripts/produto-gate.test.ts` reprova a NOSSA infraestrutura (domínio,
  rede, endereço, ref do Supabase, contas) em `src/`, `messages/`,
  `supabase/` e na raiz. Escopo estreito de propósito — `docs/`, `ops/`,
  `CLAUDE.md`, `docker-stack.yml` e os workflows ainda descrevem a nossa infra.
  Exceção nova entra em `EXCECOES` com o motivo, nunca alargando o padrão.
- A marca é DADO da instalação (`cb_marca`, 1094), nunca build-arg: a
  mesma imagem serve a qualquer marca, e a nossa produção usa o padrão do
  produto (Atlas CRM, `src/lib/marca.ts`). Build-arg de nome ou logo que
  volte ao `pipeline.yml`/`Dockerfile` não é lido por nada.
- `scripts/vps-inventario.sh` é SÓ leitura, com lista fixa de comandos, e
  imprime os NOMES das variáveis, nunca os valores. Acrescentar comando ali é
  ampliar uma permissão já concedida.
