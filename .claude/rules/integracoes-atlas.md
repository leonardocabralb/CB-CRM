---
paths:
  - "src/lib/atlas/**"
  - "src/app/api/cb/atlas/**"
  - "src/components/settings/atlas-card*"
  - "src/components/automations/atlas-trigger-config*"
  - "src/components/inbox/painel/negociacoes-do-atlas*"
  - "src/app/api/cb/asaas/cron/**"
  - "supabase/migrations/10*_cb_atlas*.sql"
  - "supabase/migrations/atlas-10*.test.ts"
  - "src/hooks/use-atlas*"
  - "src/components/inbox/abrir-no-atlas*"
  - "src/components/inbox/painel/aba-atlas*"
---

# Integração com o Atlas Gestor — regras

Vale no cliente da API do Atlas (`src/lib/atlas/`), no cartão "Atlas" de
Integrações, no passo de automação "Criar cliente no Atlas", na leitura
periódica das situações e na tela (botão, faixa e aba Atlas) da Fase 2, e no
gatilho "Situação mudou no Atlas" (Fase 4). Plano, fases e decisões do operador:
`docs/PLANO-integracao-atlas.md`. O motor e o construtor:
`.claude/rules/automacoes.md`.

### A chave e a conexão (1071)

- ⚠️⚠️ **Só pela API do Atlas, nunca pelo banco dele** (decisão do operador):
  o CRM é vendido a quem também usa o Atlas, e a única coisa que o escritório
  faz é colar a chave. Um endpoint só (`client-webhook`), ação no corpo
  (`{ action, data }`), chave no cabeçalho `x-api-key`, `redirect: 'manual'`,
  toda mensagem por `semSegredo`.
- **A chave é do ESCRITÓRIO**, não da pessoa: gerada pelo admin do Atlas,
  colada uma vez no cartão, guardada cifrada em `cb_atlas_config` (FECHADA ao
  navegador, sem policy — pino `atlas-1071.test.ts`). Nenhuma rota a devolve,
  nem mascarada. As permissões também são do escritório, no Atlas: conectar
  recusa (`permissoes_faltando`, com a lista) sem Consultar, Criar e
  Atualizar clientes.
- **Conectar = `whoami`**, que não grava nada no Atlas. Nunca sondar
  permissão com ação de escrita: dependeria da ordem de validação de OUTRO
  produto e, se ela mudar, cada conexão criaria um cliente vazio.
- ⚠️ **Chave de outro escritório é RECUSADA** (`outro_escritorio`, com
  `vinculosAnteriores`) enquanto houver ficha ligada, NESTE ambiente, a
  cliente do escritório anterior: os ids são de lá. O cartão oferece "Apagar
  os N vínculos do escritório anterior e conectar" (confirmação;
  `apagarVinculosAnteriores`, só depois do `whoami` provar a chave nova).
  Desconectar apaga só a conexão; os vínculos ficam para o mesmo escritório
  reconectado.
- ⚠️⚠️ **Conectar ZERA o estado da leitura** (`ESTADO_DA_LEITURA_ZERADO`,
  1072): o cursor do Atlas vale em qualquer ambiente, e um cursor ou um
  `situacoes_lidas_ate` herdado do staging (ou do escritório anterior) faria
  a produção pular a primeira listagem completa sem erro. O ciclo em curso
  perde a cerca de posse e para na próxima prova dela (a seção abaixo).
- **O endereço é constante do produto** (`API_DO_ATLAS`); `ATLAS_API_URL`
  (servidor, só https) aponta para outro AMBIENTE do Atlas (o staging).
- ⚠️⚠️ **A conexão guarda o ambiente** (`cb_atlas_config.api_url`, nulo = o
  Atlas de verdade), porque o preview grava no banco da PRODUÇÃO (CLAUDE.md
  8b): a instância de teste não conecta por cima nem desconecta a conexão de
  outro ambiente (`outro_ambiente`), nenhuma lê a chave do outro, e o staging
  recusando uma chave não marca a de verdade em erro. A de verdade substitui
  ou apaga uma de teste esquecida.

### Ambiente em toda linha (1072)

- ⚠️⚠️ **`cb_atlas_clientes` e `cb_atlas_recusas` guardam o ambiente**
  (`api_url`, nulo = o Atlas de verdade), e TODA consulta e escrita delas
  passa por `noAmbiente(query, amb)` (`enderecos.ts`); INSERT grava `api_url:
  ambienteDoAtlas()`. O staging tem o MESMO id de escritório e ids copiados:
  sem a cerca, a leitura do preview escreveria por cima dos vínculos reais.
  Pino default-deny `ambiente.chamadores.test.ts` (por arquivo: a consulta
  nova num arquivo que já tem a cerca fica para a revisão).
- As chaves 1:1 são POR AMBIENTE, `NULLS NOT DISTINCT` (nulo é um ambiente):
  `(account_id, api_url, atlas_client_id)` e, parcial (`contact_id IS NOT
  NULL`, as órfãs convivem), `(account_id, api_url, contact_id)`. Não servem
  de alvo de upsert (o parcial nunca serve): INSERT + 23505.
- Vínculo de OUTRO escritório (mesmo ambiente) é invisível à leitura e ao
  passo (`atlas_tenant_id` da conexão), mas ocupa a chave da ficha: por isso
  conectar outro escritório exige apagá-lo.

### Leitura das situações (1072, `situacoes.ts` + `leitura.ts`)

- ⚠️⚠️ **Roda num `after()` da rota `cb/asaas/cron`** (laço lento, ~15 min;
  forma de CALLBACK, depois do laço do Asaas — pino em `route.test.ts`):
  tirar a rota do laço cala o Atlas. "Ler situações agora" no cartão
  (`/api/cb/atlas/leitura`, admin, só a conta, ~45 s, balde POR CONTA
  `LEITURA_AGORA`). Nunca bater no cron do Asaas pelo preview.
- **Cadeado** `sincronizando_desde` (`UPDATE … RETURNING` cercado, carimba
  `last_sync_attempt_at` — o rodízio); toda escrita na conexão leva a posse e
  confere a linha (zero = `cadeado_perdido`, para), e cada página, cada
  vínculo automático e cada escrita da lixeira a PROVAM logo antes
  (`provarPosse`), e o vínculo automático também DEPOIS (a prova que falha
  apaga a linha recém-gravada): sem isso, o ciclo que perdeu a conta para
  "Apagar os N vínculos e conectar" gravaria vínculo do escritório antigo,
  que ocupa a chave da ficha. A marca na conexão (`registrarConferencia`) vai
  com a MESMA cerca de posse, antes do fechamento: a chave velha recusada não
  põe a conexão nova em erro. Chave ilegível ANTES do cadeado (sem cerca) não
  escreve nada — quem marca é o passo e o "Conferir de novo". Recolhimento de
  10 min, com teste cobrando a margem sobre prazo + timeout.
- **Dois passos, cada um com cursor PRÓPRIO gravado a cada página**:
  mudanças (`statusChangedSince` = última leitura − 5 min, fixo em
  `mudancas_desde` até a varredura acabar; acabou → `situacoes_lidas_ate` =
  quando a VARREDURA começou, `mudancas_iniciada_em` — o início do último
  ciclo perderia quem ela pulou por ser `recente`) e listagem completa (a primeira, a diária das 03:00, a em
  curso; acabou → `listagem_completa_em` = quando COMEÇOU). Teto de 10
  páginas e pausa de 3 s: a cota (60/min) é do escritório, e o passo "Criar
  cliente" não repete um 429. Prazo pelo relógio REAL.
- **Escritório com mais de ~900 clientes**: a diária divide as 10 páginas
  com as mudanças e nunca cabe num ciclo — o telefone não liga, e o link só
  pela confirmação. O cartão e a INSTALACAO dizem isso.
- ⚠️ **Nada de dado pessoal do Atlas no banco**: o parser do `list_clients`
  (`lerPaginaDaListagem`) devolve só id, situação, `status_changed_at`,
  `app_url` e dois sinais em memória (uuids do `chat_link`, telefone
  canônico). Cliente ilegível ou página sem `status_changed_at` (a API
  ANTIGA, `api_antiga`) param sem gravar nada.
- **`decidirMudanca`**: `recente` (< 2 min: não grava — a sobreposição relê;
  fecha a corrida com o passo), `antiga`, `igual` (`em_negociacao` compara
  como `ativo`, gravado como veio), `primeira` (inclusive `importado →
  ativo`), `mudou_sem_data`, `corrigida`, `mudou` — só esta é evento
  (`viraEvento`, Fase 4). Escrita UMA linha por vez, cercada por recência
  (`situacao_lida_em` anterior ao PEDIDO da página).
- **Erros**: nenhum avança o cursor da página. `limite` não marca a conexão;
  "Listar clientes" desligada é `sem_permissao_listar` (em `sync_erro`, SEM
  `registrarConferencia`: a permissão é opcional); chave recusada e plano sem
  API marcam; `sem_permissao` do `get_client` (lixeira) e do `find_clients`
  (confirmação do link) marca — "Consultar" é obrigatória. `sync_erro` é separado de `last_error`.

### Vínculo automático, recusa e lixeira

- **Pelo link da conversa**, só em ciclo sem falha: os uuids do `chat_link`
  acham a dona da conversa (grupo não tem) ou a ficha direto; UMA ficha por
  cliente e UM cliente por ficha, senão ambíguo (ninguém liga). ⚠️ A
  unicidade vale contra o escritório INTEIRO: na listagem completa que
  começou e terminou no ciclo, contra todos os clientes dela (ligados e
  recentes também disputam a ficha); fora dela, a página não prova nada (o
  ex-cliente tem o cadastro velho e o novo com o mesmo link, e só um muda),
  e o par só liga se o `find_clients` pela ficha e pelas conversas dela achar
  SÓ ele (até 5 por ciclo; ficha com mais de 9 conversas espera a listagem
  inteira). **Pelo telefone** (decisão do operador, 30/09): `telefoneDigitado` →
  `telefoneCanonico`, 12 dígitos ou mais, único na listagem INTEIRA e em
  `contacts.telefone_canonico`, fora os números das conexões (pela mesma
  régua; sem eles, não roda) — só quando a listagem começou e terminou no
  mesmo ciclo. Marcado `origem = 'automatica'` e `casou_por`; nasce com a
  situação (nunca evento). Fica fora: ficha já ligada neste ambiente, par em
  `cb_atlas_recusas`, cliente `recente`, e — no telefone — TODA ficha que
  algum link citou, também a disputada (`fichasTocadas`). 23505 = conflito,
  pula.
- `cb_atlas_recusas` (FECHADA, sem policy): o par desvinculado à mão não
  volta pela leitura nem pelo passo.
- ⚠️ **Lixeira**: a listagem não mostra cliente excluído; depois de uma
  listagem completa, os vínculos que ela não viu (`visto_na_listagem_em`)
  são relidos, no máximo 5 por ciclo. Só o `not_found` do Atlas marca
  `excluido_no_atlas_em` — o vínculo NUNCA é apagado (restaurável por 7
  dias); o cliente que volta na página limpa a marca.

### A tela: botão, faixa e aba Atlas (PR B da Fase 2)

- **Uma rota só de banco** (`GET /api/cb/atlas/contato/[contactId]`, qualquer
  membro, balde próprio `LEITURA_DO_CONTATO` de 120/min — o fio e o painel leem
  juntos a cada troca de conversa, e o `execucao` de 30/min cortava a faixa):
  nunca chama o Atlas. A forma e o parser
  moram em `do-contato.ts` (puro, o hook o importa); `velha` é calculada no
  SERVIDOR e `appUrl` só sai `https:` com o id (vira `href`). Cerca de conta,
  ambiente e escritório; conexão de outro ambiente = `conectado: false`.
- **`useAtlasDoContato`** (molde `useCobrancasDoContato`, carimbo `{ de }`,
  `conectado` da CONTA que sobrevive à troca), em TRÊS lugares: o fio (a
  faixa), o painel (botão e aba) e a ficha de /contatos. Relê a cada 5 min, ao
  voltar à aba e no `cb:atlas-mudou` (`aviso.ts`) que a aba emite.
- ⚠️ **A faixa junta as fontes em `juntarSituacoes`** (`situacao-na-faixa.ts`):
  cada fonte cala sozinha (hooks separados, nunca o mesmo `Promise.all`); a
  linha do Atlas só com vínculo fora da lixeira e situação em
  `SITUACOES_NA_FAIXA`; o Atlas "ativo" NÃO apaga a linha do funil; a do
  Atlas aparece a todos (sem recorte de perfil). Sem botão na faixa (D7).
- ⚠️ **Vincular/desvincular à mão: só admin** — `requireRole('admin')` no
  `PUT …/vinculo`, `useCan("edit-settings")` na tela (`vinculo.ts`). O id sai
  do link (`idDoLink`: `#/clients/<uuid>`, `?tab=` ou o uuid solto); o que se
  grava sai da RESPOSTA do `get_client` (outro escritório dá `not_found`). Os
  conflitos locais vêm ANTES do Atlas (a cota); ficha com vínculo do
  escritório anterior = `outro_escritorio`. Desvincular grava a RECUSA
  ANTES de apagar o vínculo; vincular apaga a recusa do par.
- **A aba no painel** (depois de Relacionados) some sem Atlas e — pela
  largura dos 360 px — para quem não vincula quando a ficha não tem
  vínculo; na ficha de /contatos aparece a todos. A fileira do painel
  QUEBRA linha (`flex-wrap`): com números acesos, o Histórico ficava cortado.
  ⚠️ `abaAtlasNoPainel` decide pela `ultimaLeitura` do hook (na carga, a do
  contato ANTERIOR: sem ela a aba piscava entre fichas vinculadas) e a
  mantém na FALHA (o "Tentar de novo", nunca a aba sumida).
- **Lixeira na aba**: restaurar no Atlas não muda o `status_changed_at`, e
  só a listagem completa limparia a marca. O admin tem "Conferir no Atlas"
  (o `PUT ligar` com o id do vínculo): o par já ligado NA LIXEIRA relê o
  `get_client` e tira SÓ a marca (a situação fica para a leitura, que decide
  o evento); `not_found` = `ainda_na_lixeira`, a marca fica.
  Chaves montadas `situacao.`, `origem.`, `casouPor.`, `erro.` cobradas por
  `do-contato.test.ts`; situação desconhecida = texto de reserva.

### Aba de negociação (Fase 3, `negociacoes.ts`)

- **Lida NA HORA, nada gravado**: `GET /api/cb/atlas/contato/[contactId]/negociacoes`
  (qualquer membro que vê a conversa, decisão do operador, 30/09 — pela API
  a chave do escritório vê tudo, o recorte por time do Atlas não vale)
  chama `get_client_negotiations` com o vínculo DESTE ambiente e escritório.
  ⚠️⚠️ **Allowlist campo a campo** (`lerNegociacoes`, idempotente: o
  navegador relê a resposta da rota pelo mesmo filtro): anotação, canal,
  remetente, link, simulação, processo, a trilha e campo novo do Atlas
  nunca passam (pino `negociacoes.test.ts`); item ilegível derruba a
  leitura inteira, nunca some.
- ⚠️ **Dois baldes, por usuário e POR CONTA** (20/min cada,
  `NEGOCIACOES_POR_*`, fora de `rate-limit.ts`): a cota do Atlas é do
  escritório, e o passo "Criar cliente" não repete um 429. O 429 do Atlas
  traz `esperaSegundos` (`retry_after_seconds` ou `Retry-After`) e trava o
  "Atualizar" pelo tempo pedido. ⚠️ A tela diz QUEM recusou (`EsperaPedida`):
  o balde do CRM nunca vira "o Atlas pediu" (a equipe iria atrás do n8n).
- ⚠️ **`read_negotiations` é OPCIONAL** (fora de `PERMISSOES_NECESSARIAS`,
  senão as conexões atuais seriam recusadas): desligada é 403 SEM
  `registrarConferencia`; só `read_client`, chave recusada e plano sem API
  marcam. `not_found` (lixeira) é 404 e nunca mexe no vínculo.
- **A seção busca só MONTADA** (a aba Atlas a monta só no vínculo fora da
  lixeira, e a desmonta com a aba fechada), com
  `key={contact.id}`, `cache: 'no-store'` e o carimbo `{ de }`; um pedido
  por contato montado (o StrictMode rodaria dois). Datas por
  `diaPorExtenso`, dinheiro por `Intl.NumberFormat(undefined, …BRL)`,
  nulo = travessão, desconto negativo como veio; situação e tipo são chave
  montada com reserva (`outra`). O log leva só contagens.

### O passo "Criar cliente no Atlas" (`criar-cliente.ts`)

- ⚠️⚠️ **Procura antes de escrever** (o n8n criava sempre): o vínculo que já
  existe manda (relê o cliente); sem ele, `find_clients` pelo link das
  conversas do CRM (a da execução primeiro: o Atlas aceita 10 ids) + o id da
  ficha, pelo telefone e pelo e-mail (critério que
  o Atlas recusaria — e-mail sem @, telefone com menos de 10 dígitos — fica
  fora: derrubaria a busca inteira). `decisao.ts`: nada → criar; UM
  rescindido, finalizado ou inativo → REATIVAR o mesmo cadastro (D3: nunca
  criar outro para quem volta; inativo por decisão do operador, 30/09); UM
  em curso → só vincular (D2: o Atlas manda no contrato); PARA com motivo,
  sem escrever, quando há mais de um (ou a lista veio cortada), quando está
  SUSPENSO (a equipe suspendeu lá, de propósito), ou quando o casamento é
  FRACO.
- ⚠️⚠️ **Só casamento FORTE age sozinho** (`matched_by` com `chat_link`,
  `phone` ou `doc_id`): `phone_last8` (telefone guardado sem DDD) e `email`
  casam pessoas diferentes (cônjuge com o mesmo e-mail), e reativar gravaria
  o contrato de uma no cadastro da outra. Sem `matched_by` = fraco (falha
  fechada).
- ⚠️⚠️ **O dono se confere ANTES da escrita**: cadastro achado já ligado a
  OUTRA ficha → em curso, devolve `ligado_a_outra_ficha` sem gravar nada;
  encerrado, PARA (provável ficha duplicada: fundir pela receita). Vínculo
  órfão (a ficha antiga foi apagada) é adotado.
- ⚠️⚠️ **Vínculo com o cliente na LIXEIRA do Atlas PARA o passo** (`ler` →
  null, o `not_found` do Atlas): o vínculo NÃO sai e ganha
  `excluido_no_atlas_em`, e o motivo manda restaurar lá ou desvincular. A
  busca não enxerga a lixeira: procurar criaria um segundo cadastro (contra a
  D3). Vínculo de OUTRO escritório conta como sem vínculo e fica (só a
  reconexão confirmada o apaga). O único candidato forte RECUSADO para esta
  ficha (`cb_atlas_recusas`) também PARA. 404 do gateway (sem o código,
  endereço errado) e 200 sem o cliente LANÇAM (CLAUDE.md 8b). 2xx sem o que
  se esperava é `resposta_inesperada` — pode ter gravado.
  Cliente ILEGÍVEL na lista do `find_clients` também: descartá-lo mudaria a
  contagem que decide (dois viram um e reativa; um vira zero e cria).
- ⚠️ **Campo de data ESCOLHIDO no passo que sumiu do catálogo** (apagado ou
  mudou de tipo), ou PREENCHIDO com o que não é data, FALHA o passo; só o
  campo vazio NA FICHA cai na reserva
  (criação do card, o dia de hoje) — senão a reserva iria ao Atlas como se
  fosse a data certa.
- **Nunca repete sozinho**: fica FORA de `PASSOS_DE_ENVIO` (criar pode ter
  acontecido com tempo esgotado). As escritas levam `Idempotency-Key`
  `<logId>:<stepId>:criar|reativar`; rodar de novo por gente acha o cliente
  pelo link da conversa e não duplica. Duas execuções SIMULTÂNEAS do mesmo
  contato não se enxergam e podem criar dois cadastros (a segunda falha no
  vínculo, com o motivo): conhecido, não tratado, como o `create_deal`.
- ⚠️ **Só cria o que a busca reencontra** (link da conversa, telefone ou
  e-mail válidos): sem nenhum, o passo PARA — se o vínculo falhasse depois,
  a nova execução (outra chave de idempotência) criaria um segundo cadastro.
- **O formato é o do n8n** (`formatar.ts`): telefone com DDI e o nono dígito
  (`telefoneCanonico`), estado pelo DDD SÓ de número brasileiro, datas
  `aaaa-mm-dd` no fuso do escritório (nunca `toISOString().slice`), valor do
  card (0 sem card), "fixo" por padrão, vazio vai `null`. A nota leva o nome
  do app de `marca.ts`, nunca literal. A reativação não mexe em nome,
  telefone, e-mail nem nota que a equipe cuida no Atlas.
- **O motivo da falha vai para o "Já rodou" da aba Automações e para os
  registros** (qualquer membro lê; o fio não mostra motivo cru): só o código
  traduzido (`motivoDaFalha`) e, na validação, os NOSSOS nomes de campo —
  nunca texto da resposta do Atlas. Falha depois de escrever no Atlas diz o
  que já foi escrito ("o cliente foi criado no Atlas, mas…"). Chave recusada,
  ilegível ou permissão desligada no Atlas marca a conexão em erro
  (`registrarConferencia`), e o cartão diz o motivo; o próximo sucesso limpa
  — menos `sem_permissao`: um sucesso prova só a permissão que usou. Ele sai
  pelo "Conferir de novo" do cartão (`PATCH /api/cb/atlas`, refaz o `whoami`
  com a chave guardada) ou reconectando.
- **Vínculo 1:1** (`cb_atlas_clientes`): o cliente do Atlas já ligado a
  OUTRA ficha não é roubado (`ligado_a_outra_ficha`). Lido por membro (forma
  da 1032), escrito só pelo servidor; `contact_id` SET NULL — a tabela está
  na receita de fusão (`.claude/rules/supabase.md`), como as recusas
  (CASCADE). O passo grava `crm_escreveu_em` ao criar e ao reativar; o 23505
  do MESMO par (a leitura ligou antes) é o mesmo vínculo.

### O gatilho "Situação mudou no Atlas" (1073, Fase 4)

`atlas_situacao_mudou`: `gatilho.ts` (puro), `mudancas.ts` (o disparo), a
fila `cb_atlas_mudancas` (FECHADA, sem `contact_id`: fora da receita de
fusão) e `atlas-trigger-config.tsx`. Decisões do operador (30/09): funil
OBRIGATÓRIO; card fora do funil não é mexido (`sem_card`); SEM trava de
"ficha velha" nem de 48 h (nem no CHECK).

- ⚠️⚠️ **Só a decisão `mudou` vira evento** (`viraEvento`): nunca a primeira
  leitura, o vínculo novo (nasce com a situação), `importado → ativo`,
  `em_negociacao` (vale `ativo`), a correção nem a mudança sem data. A
  `mudou` entra na fila ANTES da escrita do vínculo (`gravarDecisao`, também
  na conferência da lixeira), com a POSSE provada logo antes (reconexão com
  outro escritório no meio da página); 23505 = já registrada (a sobreposição); a
  cerca de recência que recusa a escrita marca `superada` (só `pendente`).
- ⚠️⚠️ **Dispara DEPOIS do fechamento do ciclo** (cadeado da leitura solto),
  pelo `rodarCicloDoAtlas` e pelo "Ler agora", com reivindicação PRÓPRIA
  (`pendente → processando`, cercada pelo estado E por `tentativas`) e
  janela própria de 15 s (a leitura longa gasta o prazo dela). Relê o
  vínculo (ambiente, escritório): sumiu, ficha nula, data mais nova ou outra
  situação = `superada`. Data nula ou mais velha: ainda na situação ANTERIOR
  = a escrita não chegou, volta SEM gastar tentativa; outra = `superada`.
  Decide o dado, NUNCA o relógio: trava de idade poria `feito` na chave, e a
  página relida não enfileiraria de novo. As nunca tentadas vêm primeiro
  (`processando_desde`): a espera não trava a fila.
- As automações ligadas são relidas POR MUDANÇA, logo antes do casamento
  (a edição no meio do lote casaria pela config velha; o motor aceita a do
  disparador só pelo `automation_id`).
- ⚠️⚠️ **Cards e conversa lidos UMA vez, ANTES de disparar qualquer
  automação** (a união dos funis das que casam; a conversa por consulta
  própria — `conversaDoContato` do ZapSign engole o erro). Falha aqui =
  `pendente` (teto 3 → `falhou`). Depois do primeiro disparo nunca volta
  (CLAUDE.md 8e); só "nada rodou e o motor recusou antes" volta.
  `processando` há 10 min = `falhou`, nunca repete.
- **Por automação**: o ÚNICO card do contato nos funis dela, em qualquer
  status (a RPC move o ganho com `deal_status_fixado`); nenhum = `sem_card`,
  mais de um = `card_ambiguo`. O disparo carimba `automation_id`
  (`soRodaPeloDisparador`: só ela casa; botão, agente, `run_automation` e a
  rota manual recusam). `negocioAlvo` não muda. "Aguardar" não reconfere a
  situação (a ajuda manda mover antes). Quem voltou pelo Comercial: marcar
  os dois funis.
- `validate.ts`: situações da lista do contrato e funil obrigatórios, com
  id válido (`ehIdDeFunil`; o `lerConfigDoGatilho` também descarta: um id
  malformado no `.in("pipeline_id")` derrubaria os cards de TODAS as que
  casam); recusa "Criar cliente no Atlas" e "Acionar automação" (a filha
  driblaria) na automação deste gatilho (D2). Variáveis
  `{{vars.atlas_*}}` saem de `variaveisDaMudanca` (sem dado pessoal). O
  cartão mostra as 20 últimas mudanças DA CONEXÃO ATUAL (`created_at >=
  conectado_em`, `ultimasMudancasDoCartao`: a fila não guarda o escritório)
  com o resultado traduzido.
