---
paths:
  - "supabase/**"
  - "scripts/reparar-historico-de-migrations.sql"
  - "scripts/kommo/**"
  - "src/lib/migracao/**"
---

# Supabase — regras

Vale ao escrever migration, função, policy ou gatilho, e ANTES de qualquer
escrita manual ou em lote no banco de PRODUÇÃO (SQL pelo conector MCP,
Management API, script). O núcleo (nome, número, ordem de aplicação) está na
raiz, seção 7; aqui ficam os detalhes e os modelos SQL. Texto integral
anterior, com a história: `git show f5879b3f:CLAUDE.md`.

## Escrita manual ou em lote no banco de PRODUÇÃO

Gatilho dispara POR LINHA, também para SQL escrito à mão. Antes de um
UPDATE/INSERT/DELETE fora do app, saiba o que ele aciona:

- ⚠️⚠️ **`deals`** — INSERT, ou UPDATE que MUDA `pipeline_id`/`stage_id`/
  `status`: enfileira `cb_automation_events` (`cb_enfileira_evento_de_funil`).
  O cron drena a fila, dispara as automações da etapa (mensagem a CLIENTE) e os
  avisos `deal.*` ao n8n, com `origem = 'system'`. Grava também a trilha
  `cb_lead_events` (912). Card novo entra como `deal_stage_changed` sem origem
  (é o `deal.created`). Só calar os gatilhos de `deals` evita isso (a carga da
  Kommo cala — e por isso o delta dela não avisa o n8n).
- **`deals` BEFORE INSERT/UPDATE OF stage_id** (950/1031): etapa com
  `resultado` grava ganho/perdido; perdido que entra em etapa neutra volta
  `open`.
- **`set_updated_at`** (BEFORE UPDATE sem lista de colunas, em deals,
  contacts, conversations e outras) sobrescreve `updated_at` com `now()`: data
  antiga só com o gatilho calado.
- **`contacts.name`** → renomeia o card ABERTO mais recente (1007–1009), salvo
  título fixado. **`contacts.email` ↔ campo "E-mail"**: espelho nos dois
  sentidos (1000), aparado (1001).
- **`contact_tags`** INSERT/DELETE → trilha 912 com `origin = 'sistema'`. NÃO
  dispara a automação `tag_added`: essa sai do código (`tag-events.ts`).
- **`messages`** AFTER INSERT → `conversations.aguardando_desde` (972, pela
  ORDEM DE INSERÇÃO) e `janela_meta` (993); `gravada_em` nasce `now()`. UPDATE
  de `deleted_at` recalcula a espera.
- **`conversations`**: encerrar limpa a espera; atribuir (`assigned_agent_id`
  novo, não nulo, por outra pessoa ou por SQL) cria aviso no sino do
  responsável.
- **DELETE em `cb_channels`** solta os pinos, tira a conexão das automações,
  dobra a janela em `sem_carimbo` e anula `messages.channel_id`; agendada que
  aponta para ela BLOQUEIA (FK RESTRICT da 925 — a rota limpa o acervo antes).
  **DELETE em `pipeline_stages`** tira a etapa das automações e zera
  `default_stage_id` das conexões; card na etapa bloqueia.
- **`accounts`** INSERT semeia o campo "E-mail".
- Apagar CONTATO leva conversa e mensagens e deixa 15 tabelas com ponteiro
  nulo — ver "APAGAR CONTATO". Fundir fichas: só pela receita.

## Carga em lote e importação

- ⚠️⚠️ **Calar gatilho = `ALTER TABLE … DISABLE TRIGGER <nome>` DENTRO da
  transação do lote.** É DDL transacional: o rollback religa sozinho, não
  existe "desligado e esquecido". Trava ShareRowExclusive (leitor não espera)
  e as FKs ficam de pé. Nunca `session_replication_role = 'replica'`: derruba
  as FKs junto. Com o gatilho calado, escreva à mão o que ele faria (status da
  950, `updated_at`, trilha).
- ⚠️⚠️ **A carga NÃO passa pela ingestão.** `persistInboundMessage` é o pacote
  inteiro (robô, automações, IA, funil, reabertura) e dispararia tudo por
  mensagem antiga.
- ⚠️⚠️ **Mensagem ANTIGA**: cale pelo nome os dois AFTER INSERT de
  `messages` — o da 972 decide "em atraso" pela ordem de inserção e um eco
  antigo apagaria uma espera verdadeira. Pegue as travas no COMEÇO, `messages`
  e depois `conversations` (a ordem do gatilho), com `lock_timeout` de 1 s:
  na ordem inversa a ingestão viva fecha um ciclo com o lote e o detector de
  deadlock aborta a INGESTÃO (mensagem de cliente perdida).
- `gravada_em` vai NULA na importação: com `now()`, `clienteRespondeuDesde`
  leria a fala antiga como resposta de agora e cancelaria a sequência.
  Consequência: `gravada_em IS NULL` não distingue "antes da 1003" de
  "importado" — pergunte ao registro.
- Teto por conversa, mantendo as MAIS RECENTES (a do histórico do WhatsApp
  usou 600): o PostgREST corta em 1000 linhas, então confira como o fio lê a
  conversa antes de subir o número.
- Conversa que não existia nasce ENCERRADA (dono durável, sem responsável,
  sem não lida); encerrada existente só ganha prévia quando o histórico é mais
  novo, com `set_updated_at` calado; conversa ABERTA nunca é tocada. Mídia sem
  arquivo: `media_url` e `media_state` nulos — nunca `failed`/`pending` em 1:1
  (acende botão que só existe em grupo), nunca `too_large` (motivo falso).
- Insert em BLOCO pelo PostgREST preenche coluna ausente com NULL: `from_device`
  e `mentions_us` (NOT NULL) estouram se as linhas não forem uniformes. NULL
  explícito anula o default (`deals.value` é NOT NULL); `deals.currency` nasce
  `'USD'`.
- Chave de reexecução em COLUNA com índice único parcial
  (`deals.kommo_lead_id`, 1012), nunca em JSON: sem restrição única, quem pula
  a pergunta "já importei?" duplica em silêncio.
- Dado de carga (livro-razão, fotos de antes) em schema PRÓPRIO
  (`migracao_kommo`), nunca em `public`: lá herdaria a concessão padrão e
  nasceria legível do navegador.
- ⚠️ **Decisão da carga se toma SOB TRAVA** (`FOR UPDATE` + a regra repetida
  no UPDATE): um escritor concorrente seria sobrescrito.
- ⚠️ **Desfazer devolve só o INTOCADO desde a carga**: `updated_at <=
  criado_em` da linha do livro (deals, contacts); em tabela sem `updated_at`
  (`contact_custom_values`), o livro guarda o VALOR. O desfazer cala só o
  `set_updated_at` e devolve `updated_at` à mão; trava a linha ANTES de
  perguntar "tem conversa?" (o CASCADE levaria a conversa sendo criada).
  Limite conhecido: `updated_at` é o INÍCIO da transação de quem escreveu.
- `cb_lead_events.deal_id` não tem FK: o desfazer apaga a trilha
  explicitamente antes do card. Não registre no `livro_razao` linha de tabela
  que `cb_kommo_desfazer` não conhece: ele aborta (o backfill do WhatsApp tem
  registro e desfazer próprios).
- Ordem: `cb_desfazer_historico_whatsapp` ANTES de `cb_kommo_desfazer` e de
  `cb_desfazer_encerramento_em_lote`. Encerramento em lote (1018) deixa GRUPO
  de fora por padrão (`p_incluir_grupos`): grupo encerrado não reabre com
  mensagem no grupo.
- Reunião histórica NUNCA vai no campo "Data e Hora Reunião" (é do Calendly;
  os lembretes o leem): tabela própria (1036). Antes de
  `cb_desfazer_historico_whatsapp`, conferir `cb_scheduled_messages`
  pendentes com `reply_to_message_id` apontando para mensagem do registro — a
  retenção do desfazer só olha citação em `messages`, e a agendada perderia a
  citação.

## Workflow de migrations — detalhes

### Número e nome
- `NNNN_cb_<descricao>.sql`, 4 dígitos, número NOVO = maior do `main` + 1.
  Migration do original chega com 3 dígitos: RENUMERE para maior+1 com `cb_`,
  nunca com zero à esquerda (ordenaria antes das aplicadas e o `db push` de
  quem instalou recusa). Pino `nomes-das-migrations.test.ts`.
- ⚠️⚠️ **A `041_fix_broadcast_contact_id_ambiguity` do original é APAGADA, não
  renumerada**: recria a função de disparo de 8 parâmetros que a 0940 apagou,
  e a produção (ordem cronológica) ficaria com as duas. Pino
  `funcao-de-disparo-1030.test.ts`. O `supabase/ci/verify-schema.sql` fica com
  as NOSSAS asserções (policies da 964; a função de 9 parâmetros com
  `p_template_params JSONB`) e UMA instrução: o `::regprocedure` do original
  sobre a de 8 estoura no replay e trava o deploy.
- As 040/042 do original viraram 1038/1039 com cabeçalho reescrito, e o Git não
  as pareia: edição do original volta como conflito modify/delete — apague o
  arquivo de 3 dígitos e porte à mão numa migration nova. As nossas 0040–0042
  (037–039 deles) recebem edição EM SILÊNCIO: `git diff --summary` em
  `supabase/migrations/` a cada merge.
- `0037_evolution_transport` é exceção histórica fora da faixa 0900+: não
  renumerar.
- ⚠️ **Colisão entre branches em paralelo**: nomes diferentes, então o Git não
  acusa; quem pega é o replay (número duplicado, `schema_migrations_pkey`) e o
  pino. Rode `ls supabase/migrations` E `list_migrations` logo antes de escolher
  o número — a do outro pode existir só no banco. Renumere a que ainda NÃO foi
  aplicada.
- Lacunas não se preenchem (não existem 938/939 nem 1025–1029).
- Arquivo ≠ versão aplicada em alguns casos (1033 aplicada como 1027; 1034/1035
  como 1025/1026; 906 registrada como 904; 037 e 947 sem registro). Nunca
  reaplicar por isso. Para saber se algo está aplicado, consulte o SCHEMA.
- Instalação que atualiza por `supabase db push` com histórico por PREFIXO de
  3 dígitos: `scripts/reparar-historico-de-migrations.sql` (só versão de
  exatamente 3 dígitos). Mudou o formato do nome: repita script,
  `docs/ATUALIZAR.md` e `CHANGELOG.md`.
- Aplicou: entrada em `docs/MIGRATIONS-APLICADAS.md`.

### Ordem de aplicação e forma
- ADITIVA (o app novo lê ou grava a coluna): ANTES do deploy — sem ela o
  PostgREST recusa a escrita (a fila do funil pararia sem a coluna da 1040).
- RESTRITIVA (tira permissão, índice único que o app antigo viola): DEPOIS do
  deploy (981, 1024) — senão o app antigo quebra no intervalo.
- Função que muda de ASSINATURA (parâmetro novo, coluna de saída): DROP +
  CREATE, nunca `CREATE OR REPLACE` — sobraria um overload ambíguo para o RPC.
  Parâmetro novo com DEFAULT mantém o app anterior funcionando.
- CHECK escrito inline tem nome implícito: DROP pela FORMA (a definição
  renderizada), ADD com nome (989). Nome que não casa deixa o CHECK velho de pé.
- Gatilho que engole erro com WARNING e grava valor sob CHECK: alargue o CHECK
  ANTES de trocar a função (1040).
- Tabela quente: `SET LOCAL lock_timeout` — ALTER POLICY e ADD COLUMN travam
  exclusivo até o fim da transação.
- Índice PARCIAL cujo predicado espelha o filtro da consulta: mudar um sem o
  outro deixa o índice de pé e inútil (pino `indices-1006.test.ts`). Fila que
  não é podada precisa de índice para a pergunta por `log_id` (1004).

### ⚠️ Migration tem de aplicar num banco VAZIO
O CI (`pipeline.yml`) reaplica tudo num Postgres limpo e SEGURA o deploy.
Conferir antes do PR: `supabase db start` (Docker, ~2 GB).

**1. Privilégio herdado do Supabase não existe em banco novo.** O default
privilege do ambiente não se repete, e `REVOKE … FROM PUBLIC` numa função tira
o EXECUTE até do `service_role`. Todo privilégio que a migration CONFERE, ela
CONCEDE:

```sql
REVOKE EXECUTE ON FUNCTION cb_minha_rpc(uuid) FROM PUBLIC, anon, authenticated;
-- O motor/cron chama com service_role, que perdeu o EXECUTE junto com PUBLIC.
GRANT  EXECUTE ON FUNCTION cb_minha_rpc(uuid) TO service_role;
```

Vale para RLS: policy roda com o privilégio de quem chamou (a de `messages`
lê `conversations`, então `authenticated` precisa de SELECT nas duas). Função
`SECURITY INVOKER` conferida trocando de papel = GRANT nas tabelas que ela lê.

**2. Conferência não exige dado que só existe aqui.** Derive o dado e pule:

```sql
SELECT substr(content_text, 1, 6) INTO v_termo FROM messages LIMIT 1;
IF v_termo IS NULL THEN
  RAISE NOTICE 'NNNN: banco vazio, nada a provar.';
ELSE
  -- a prova de verdade
END IF;
```

Afirmar ausência é sempre seguro. "O DROP não levou nada": contagem ANTES numa
variável do bloco — nunca número absoluto, nunca `CREATE TEMP TABLE` (quebra a
idempotência).

**3. Função plpgsql nova ou recriada é CHAMADA pela conferência.** O corpo só é
analisado quando roda: a função de disparo atravessou três migrations com um
`RETURNING` ambíguo (42702). Chame num subbloco desfeito por SQLSTATE PRÓPRIO,
capturado por `WHEN SQLSTATE 'P1030'` — nunca `WHEN OTHERS`, que engoliria o
erro. Modelo: `1030_cb_funcao_de_disparo_executavel.sql`.
- O replay não exercita a chamada (banco vazio pula). A prova antes de aplicar
  é um Postgres descartável COM DADO e com as restrições REAIS da tabela — o
  dublê que imita a forma suposta prova o defeito errado.
- ⚠️ Função chamada por `.rpc()` se testa pelo caminho do PostgREST
  (`json_to_record`): o TIPO do argumento decide o que chega. Lista de listas =
  argumento `JSONB`, nunca `JSONB[]` (vira array de duas dimensões).
- ⚠️ Ler o que a função inseriu exige OUTRA instrução: na mesma, a foto é
  anterior ao INSERT e a conferência acusa a função certa.
- Gatilho e função que lê `auth.uid()`: prove no descartável e diga isso no
  cabeçalho.

### Fechar EXECUTE de função: revogar de PUBLIC e dos papéis
A forma da concessão varia por função, e olhar só uma metade engana:

```
funções cb_* (901/903/912)
  {=X/postgres, postgres=X/postgres, service_role=X/postgres}
   ^^ `=X` é PUBLIC — `FROM anon, authenticated` não tira nada

merge_duplicate_* (upstream 022/036)
  {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...}
   ^^ concessão por papel — `FROM PUBLIC` não tira nada
```

```sql
REVOKE EXECUTE ON FUNCTION minha_funcao(args) FROM PUBLIC, anon, authenticated;
SELECT has_function_privilege('anon', 'minha_funcao(uuid)', 'EXECUTE');  -- tem de dar false
```

- Confira o RESULTADO (`get_advisors` security, lints 0028/0029, também pegam).
- Revogar não impede gatilho de disparar (o privilégio é checado no
  `CREATE TRIGGER`).
- ⚠️ `SECURITY INVOKER` checa TUDO o que roda dentro como quem chamou: fechar
  uma auxiliar derruba a principal, e a conferência (que roda como dono) passa
  verde. Teste trocando de papel:

```sql
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM 1 FROM public.minha_funcao('x');
  RESET ROLE;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'authenticated não consegue executar: %', SQLERRM;
END $$;
```

### Tabela cb_* nova nasce sem nada para anon
- Tabela `cb_*` nasce com `REVOKE ALL ON TABLE … FROM anon`; confira as duas
  metades (anon perdeu; authenticated/service_role não). Tabela do upstream
  também pode vir aberta (a 985 fechou o anon em `automation_logs`).
- Tabela FECHADA ao navegador (dado sensível, chave cifrada): RLS ligada, zero
  policy, REVOKE de anon e authenticated; a tela lê por rota. Leitura do
  navegador ali volta 0 linhas com `error: null`.

### ⚠️⚠️ Policy de LEITURA pergunta a conta UMA vez por consulta (1032)
`account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario()))`, com papel
mínimo quando precisar (`cb_contas_do_usuario('admin'::public.account_role_enum)`).
Nunca `is_account_member(account_id)` numa policy de leitura: é SECURITY
DEFINER e roda POR LINHA (quadro do funil e caixa de entrada levavam segundos).
Pino `rls-leitura-1032.test.ts`.
- ⚠️⚠️ `= ANY (ARRAY(SELECT …))`, NÃO `IN (SELECT …)`: dentro de um EXISTS o
  planejador desdobra o `IN` numa semi-junção e a função volta a rodar por
  linha; `ARRAY(...)` vira InitPlan, calculado uma vez.
- `user_id = auth.uid()` em leitura vira `(SELECT auth.uid())`.
- FOR ALL vale também para SELECT, e as permissivas somam com OU: reescreva o
  predicado das FOR ALL também. `is_account_member` continua nas de ESCRITA.
- As 61 são policies DO UPSTREAM: merge que recrie uma delas devolve a
  lentidão sem quebrar tela — converta no próprio merge (o pino reprova).
- Meça uma policy pela RLS (`SET ROLE authenticated` + claims), nunca pelo
  predicado escrito à mão como `postgres`.
- ⚠️⚠️ `lock_timeout` limita só a ESPERA: tudo depois da primeira ALTER roda com
  a trava exclusiva. Verificação cara vai ANTES da primeira ALTER; depois dela,
  só catálogo e EXPLAIN. Há pino.

### Storage
- Policy de caminho com `IS DISTINCT FROM`, nunca `<>`: em anexo comum a
  segunda pasta é NULA, `<>` vira NULL e a policy reprova (ninguém mais apagaria
  rascunho). As policies da 020/023 casam só o 1º segmento: subpasta com regra
  própria repete o par rota + policy (954).

### A 903 removeu dois índices únicos
`message_templates(user_id, name, language)` e `ai_configs(account_id)` viraram
pares PARCIAIS (global + por canal): `.upsert(onConflict)` não serve (índice
parcial não é alvo de ON CONFLICT — use lookup + insert/update) e
`.maybeSingle()` só por `account_id` estoura com a segunda linha (escope o
canal ou `.is('channel_id', null)`).

### A trilha de auditoria (912) é escrita por TRIGGER
- Não existe "logger": escrita normal em `deals`/`contact_tags` já gera o
  evento. `authenticated` só tem SELECT em `cb_lead_events` (sem o REVOKE, um
  DELETE voltaria "0 linhas" e pareceria certo).
- Transferência de funil = UM UPDATE (`pipeline_id` + `stage_id`): em dois, a
  trilha conta que o lead saiu e voltou.
- Falha assimétrica: com `auth.uid()` estoura (gente vê o erro); sem, WARNING
  (a ingestão não pode deixar de abrir card em silêncio).
- `AFTER UPDATE OF …` dispara quando a coluna é MENCIONADA: o `IS NOT DISTINCT
  FROM` no topo evita linha falsa — não remova.
- Rótulos gravados junto com os IDs (etapa apagada/renomeada não reescreve o
  passado); posição só se compara no MESMO funil (`direcaoDoMovimento` devolve
  `null` entre funis). `deal_deleted` e `reconstructed` ficam fora do chat.
- CHECK de forma nunca exige `contact_id`: apagar contato faz SET NULL (UPDATE),
  o UPDATE revalida o CHECK e a exclusão falharia.

### Gatilhos que espelham regra de TS
Escritor demais para espelhar em código: a regra mora no banco, e o TS guarda
um espelho com pino lendo o SQL. Mudou um lado, muda o outro.
- **E-mail (1000/1001)**: `pg_trigger_depth() > 1` separa gente (profundidade
  1, espelha) de eco e cascata (2, para); o eco também termina pelo `IS
  DISTINCT FROM`. Campo espelhado não se apaga nem troca tipo/chave/espelho
  (gatilho BEFORE UPDATE OR DELETE — policy não alcança service role); a
  cascata de apagar a conta passa. Os BEFORE da 1001 aparam as duas origens
  antes do espelho. ⚠️⚠️ `redeem_invitation` ignora o campo espelhado
  (`AND espelho IS NULL`): sem isso TODO convite seria recusado com 409. Quem
  recriar a função (ou mesclar a do upstream) mantém a linha — pino
  `convite-ignora-campo-espelhado.test.ts`.
  UM campo espelhado por conta (índice único parcial), no FIM do bloco Geral,
  chave `email` quando livre. ⚠️ O gatilho em `accounts` que o semeia NUNCA
  derruba a criação da conta (falha vira WARNING): quem mexer nele mantém o
  engolir, senão todo cadastro novo quebra por causa de um campo.
- **Título do card (1007–1009)**: título que ainda é telefone troca por
  qualquer nome; título que já é nome só muda com nome FIXADO. `TITULO_SEM_NOME`
  ("Novo contato") vive na constante TS E no gatilho — trocar exige migration
  nova (pino `titulo-do-card-1007.test.ts`). UPDATE só de `title` não dispara
  trilha nem fila; `set_updated_at` dispara.
- **Ganho/perdido (950/1031)**: espelho `statusAoEntrarNaEtapa`
  (`src/lib/pipelines/resultado.ts`, pino lendo o SQL). Etapa IGUAL não passa
  pelo gatilho: a RPC `cb_atualizar_negocio` reabre o perdido com um CASE
  DENTRO do UPDATE e só escreve se o status ainda é o esperado
  (`p_status_esperado`) — nunca ler o status no motor e mandar `open` depois.
- **Janela da Meta (993)**: espelho de `contaParaOCanal` (`janela-24h.ts`);
  `selo-da-janela.test.ts` compara lista e fio. Só avança; conexão oficial
  apagada dobra a chave em `sem_carimbo`.
- **Espera (972)**: 1ª fala de cliente sem resposta preenche; resposta de GENTE
  (`sender_id` OU `from_device`) e encerrar limpam; grupo nunca; broadcast e
  robô não limpam. Mensagem apagada recalcula — com um defeito conhecido: a
  fórmula não sabe que encerrar limpou a espera.
- **`cb_assentar_mensagem_historica` (vigente: 1011)**: todo caminho que grava
  mensagem com `created_at` no passado a chama; ela desfaz só o que ESTA
  mensagem estragou, a partir da espera de ANTES do insert (`p_espera_antes`).
  Não é o recálculo canônico. Pinos em `mensagens-sem-telefone-1010.test.ts`.

### ⚠️⚠️ APAGAR CONTATO e merge_duplicate_contacts (receita de fusão)
- CASCADE (some sem aviso): `conversations` (e TODAS as mensagens),
  `contact_tags`, `contact_custom_values`, `cb_tasks`, `cb_conversation_notes`,
  `cb_automation_reminders`.
- SET NULL (fica órfão): `deals`, `cb_lead_events`, `cb_calendly_eventos`,
  `cb_meetings`, `cb_reunioes_transcritas`, `cb_asaas_clientes`,
  `cb_asaas_regua_envios`, `cb_automation_events`, `cb_webhook_eventos`,
  `automation_logs`, `automation_pending_executions`, `broadcast_recipients`,
  `flow_runs`, `notifications`, `cb_reunioes_da_kommo`. Card sem contato
  renderiza em BRANCO no Kanban.
- ⚠️ Fora das duas listas: `cb_mensagens_sem_telefone` não tem `contact_id`.
  O payload da retida (texto do cliente) sobrevive a apagar o contato, até
  num pedido de exclusão (ver `whatsapp-evolution.md`).
- ⚠️⚠️ `merge_duplicate_contacts` NÃO serve: reaponta só nove tabelas do
  upstream, APAGA as tarefas e lembretes do perdedor pelo CASCADE, roda em
  TODAS as contas e agrupa por grafia exata (não vê as duas grafias do nono
  dígito).
- **Receita de fusão**: reapontar TODAS as referências do perdedor para o
  sobrevivente (as 15 do SET NULL e as 6 do CASCADE; `contact_tags` e
  `contact_custom_values` com `NOT EXISTS`, por serem únicas por contato) →
  mover os campos que faltam na ficha sobrevivente — `wa_user_id`/`wa_username`/
  `wa_parent_user_id` (o BSUID) ZERADOS no perdedor ANTES de gravados no
  sobrevivente, senão o índice único por conta (1038) recusa — → apagar o negócio duplicado
  EXPLICITAMENTE → só então apagar o contato. Tabela nova com `contact_id`
  entra na receita no MESMO PR (não há pino).
