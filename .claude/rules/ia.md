---
paths:
  - "src/lib/cb-radar/**"
  - "src/app/api/cb/radar/**"
  - "src/app/*/radar/**"
  - "src/components/radar/**"
  - "src/hooks/use-radar*"
  - "src/lib/transcricao/**"
  - "src/app/api/cb/transcricao/**"
  - "src/lib/ai/**"
  - "src/app/api/ai/**"
  - "src/lib/integracoes/montar*"
  - "src/app/api/cb/integracoes/**"
  - "src/components/settings/integracoes-panel.tsx"
  - "src/components/settings/ai-config.tsx"
  - "src/components/settings/ai-knowledge.tsx"
  - "src/components/agents/**"
  - "src/app/*/agents/**"
  - "src/lib/ia-chaves/**"
  - "src/lib/ia-agentes/**"
  - "src/components/agentes-de-ia/**"
  - "src/app/api/cb/ia/**"
  - "src/components/inbox/ai-thread-banner*"
---

# IA (Radar, transcrição, Integrações, assistente) — regras

Radar (`src/lib/cb-radar/`, `/radar`), transcrição (`src/lib/transcricao/`),
assistente e provedores (`src/lib/ai/`), Integrações (`montar.ts`) e agentes
de IA (`src/lib/ia-agentes/`). Chave por provedor, da conta (BYO), cifrada com
`ENCRYPTION_KEY`. História: `git show f5879b3f:CLAUDE.md` e
`docs/PLANO-radar-de-atendimento.md`.

### Radar de Atendimento (941): worker + tabela + aba `/radar`

A IA lê as conversas dos últimos 7 dias e grava `cb_conversation_insights`
(UMA linha viva por conversa); o painel só lê. `src/lib/cb-radar/` (puro,
testado) e `worker.ts`, no servidor.

**O que aparece no painel**

- ⚠️⚠️ **O painel só mostra quem tem GATILHO** (`temGatilho`): insatisfação,
  pedido sem resposta, urgência média/alta ou espera ≥ `LIMIAR_ALARME_MS`.
  Fora, de propósito: nota baixa sozinha (julgamento, não pendência),
  `mencaoProcesso` sozinha (quase toda conversa cita processo) e
  `pontosDeAtencao` (o resumo do caso). A análise saudável continua gravada
  (a nota média sai dela).
- ⚠️ **Duas réguas de espera — trocá-las é o erro fácil.** `LIMIAR_ALARME_MS`
  (24 h CORRIDAS) abre o cartão; `LIMIAR_PENDENCIA_SEG` (30 min ÚTEIS) só
  decide a etiqueta (em úteis, o alarme de sexta chegaria tarde). No vão entre
  as duas a etiqueta cai para o INSTANTE (`semRespostaDesde`); mexer numa
  constante sem esse ramo devolve o cartão MUDO.
- ⚠️ **A pendência é conferida AO VIVO na tela** (`respostasDepoisDaPendencia`,
  `use-radar.ts`): `aguardando_desde` é o retrato da última análise. Falha
  para o lado do ALARME (erro mantém o cartão; lista truncada vale — DESC, o
  teto só omite resposta antiga). Mensagem apagada não conta como resposta.
- ⚠️⚠️ **"Resposta de gente" = `sender_id` preenchido OU `from_device = true`**
  (o celular pareado grava `from_device` sem `sender_id`). Não fecham a
  pendência: broadcast, automação, fluxo e a AGENDADA — que sai COM
  `sender_id` e é excluída, no worker e ao vivo, por
  `cb_scheduled_messages.message_id`. ⚠️ `houveHumanoNaJanela` do worker usa
  só `sender_id` de propósito (decide se preserva a análise congelada): não
  unificar as duas réguas. ⚠️ **A resposta do AGENTE DE IA (`bot` com
  `ia_agente_id`, F2a) FECHA a pendência, mas NÃO entra no tempo de resposta
  da equipe** (`porAgenteDeIa` em `metricas.ts`; ao vivo, o ramo `bot` +
  `ia_agente_id` de `RESPOSTA_QUE_FECHA_A_PENDENCIA`). Robô de fluxo não fecha.
- ⚠️ **Análise `failed` aparece INDEPENDENTE de gatilho** (sumida, o vazio
  afirmaria "nenhum sinal aberto" sobre conversa que o Radar não leu). O
  resgate filtra `estado = 'aberto'` (pino `use-radar.resgate.test.ts`).
- ⚠️ **O painel recarrega a cada 2 min com a aba visível** (o tique de 1 min
  só re-renderiza): é o que descobre que um colega respondeu.
- ⚠️ **Insatisfação exige evidência recente — 2 dias de expediente, em TEMPO
  ÚTIL** (`JANELA_INSATISFACAO_UTIL_SEG`; em corridas, a de sexta expirava no
  domingo). Escrita e leitura SE SOMAM (~4 dias úteis). ⚠️ A âncora é o
  INSTANTE DA ANÁLISE (`agoraMs`, 3º argumento de `interpretarAnalise`), não a
  última linha — senão a conversa que morre depois da resposta ficava acesa
  para sempre. Pino dos dois lados.
- ⚠️ **Não existe aba "Todos"** (decisão do operador): o descarte errado tem
  duas saídas — o "Desfazer" do toast e o cartão que FICA, apagado, com
  "Reabrir" enquanto a tela está aberta (`mexidasAqui`). **Falso NEGATIVO da
  IA não tem botão** (decisão fechada): reanalisar repete o veredito, pago.
- **O painel aplica a régua do worker na leitura** (7 dias, `radar_enabled`).
  ⚠️ Exceção: **pendência aberta não expira** — parada além da janela com
  `aguardando_desde` e `estado='aberto'` FICA, e os cartões ignoram urgência,
  insatisfação e nota dela (`foraDaJanela`).

**O worker e a tabela**

- **NADA dispara sozinho**: o agendador bate em `/api/cb/radar/cron` (laço
  lento); mudar o `command` do agendador só vale com `docker stack deploy`.
- ⚠️ **`cb_channels.radar_enabled` nasce FALSE e é `=== true`** — exceção
  DELIBERADA a "escopo vazio = todos" (conversa de cliente vai a provedor
  externo, e há canal pessoal na conta). Não "corrigir".
- **`authenticated` só tem SELECT** em `cb_conversation_insights`: tratar e
  descartar passam por `PATCH /api/cb/radar/[conversationId]/estado` (UPDATE
  do navegador volta "0 linhas" com cara de sucesso).
- **Sinal sem evidência é DESCARTADO pelo parser** (`interpretarAnalise`,
  `rubrica.ts`; evidência = índice de linha do transcrito → `messages.id`).
  Quem mexer na rubrica mantém, senão o painel vira gerador de alarme falso.
- ⚠️ **Feedback por atendente exige AUTORIA**: a observação só passa se citar
  linha ESCRITA pelo atendente nomeado (`LinhaDoTranscrito.autor`) — senão
  "a Ana demorou", do cliente, viraria auditoria da Ana. Nome não resolvido =
  "Equipe", sem avaliação. Na tela, só `useCan('manage-members')`. ⚠️ **O gate
  é SÓ de renderização** (qualquer membro lê `detalhes.analise`); a barreira
  real é PENDÊNCIA, com a receita, em `docs/PLANO-radar-de-atendimento.md`.
- **Tempos em segundos ÚTEIS com fuso FIXO -03:00**: `horario-comercial.ts` é
  o único arquivo a mudar se o horário de verão voltar; intervalo negativo
  vira zero lá dentro.
- ⚠️ **Ciclo de vida do sinal, três regras assimétricas**: `tratado` reabre SÓ
  com mensagem DO CLIENTE posterior ao `estado_em` (UPDATE condicional
  separado); `descartado` NUNCA reabre sozinho; `aberto` fica. ⚠️ Exceção:
  descarte sobre `failed` que NUNCA teve análise (`descarteFoiSobreFalha`)
  reabre na primeira análise boa. Não é inconsistência.
- ⚠️ **Toda escrita pós-claim tem CERCA DE POSSE**
  (`.eq('status','running').eq('running_desde', <carimbo do claim>)`), e o
  RECOLHEDOR tem a dele (o `running_desde` velho que o SELECT viu; `is null`
  quando nulo — `.eq()` nunca casa NULL). ⚠️ "Mensagem nova" exige
  `janela_fim` NÃO nulo: nulo como novidade virava retentativa paga infinita.
- **A janela de mensagens lê DESC + reverse**: com ASC, o teto cortava as
  mensagens de HOJE.
- ⚠️ **Janela sem mensagem do cliente NÃO chama a IA** (só métricas;
  `detalhes.sem_cliente_na_janela`) — senão um broadcast disparava dezenas de
  análises pagas. Janela COM fala do cliente reanalisa. ⚠️ Janela só de
  MÁQUINA sobre análise completa: UPDATE preservador (avança `janela_fim`,
  mantém a análise, `aguardando_desde` incluído) — senão um broadcast apagava
  o alarme do cliente esquecido.
- **O transcrito colapsa repetição EXATA do robô** (`botRepetidas`; fica a
  mais RECENTE, e o prompt declara). Humano nunca é colapsado (insistência é
  o sinal), nem a resposta do AGENTE DE IA, que é `bot` mas é conteúdo
  ("IA (Nome)", `porAgenteDeIa`).
- **A legenda (`como-funciona.tsx`) IMPORTA as constantes reais**
  (`JANELA_DIAS`, `THROTTLE_MS` em `ordenacao.ts`, client-safe,
  `TETO_MENSAGENS`, `CICLO_MINUTOS`): número no dicionário mente.
- **`loadAiConfig` do Radar usa `requireActive: false`** (precisa da
  CREDENCIAL; `is_active` é do assistente) ⚠️ e SEM `channelId` (1042): a
  configuração do Radar é da conta — pelo canal, um agente de uma conexão
  trocaria a chave e o modelo do Radar ali (pino
  `src/lib/ia-chaves/chaves.chamadores.test.ts`).
- **O upsert em `cb_conversation_insights` funciona** porque o UNIQUE de
  `conversation_id` é TOTAL.

### Transcrição de áudio (943): função ÚNICA, Gemini-only, chave BYO

`transcrever.ts` (testado), `POST /api/cb/transcricao/[messageId]`, colunas
`transcricao_*` em `messages`. A MESMA função idempotente serve ao botão da
bolha e ao worker do Radar.

- **A transcrição NUNCA vai para `content_text`**: o que o cliente escreveu e o
  que a máquina ouviu são coisas diferentes, e sobrescrever é irreversível.
- ⚠️ **O cadeado `UPDATE…RETURNING` não é opcional**: no deploy há dois
  processos Node e o rate limit é por processo — só o banco impede pagar o
  mesmo áudio duas vezes. Teto de tentativas DENTRO do WHERE; travada de
  10 min recolhida pelo cadeado; escrita final e falha com cerca
  (`transcricao_desde`).
- ⚠️ **Problema de CONFIGURAÇÃO devolve `recusada` SEM GRAVAR** (sem chave
  Gemini, chave ilegível, apagada, não-áudio, conta errada, áudio ainda sem
  `media_url` — janela de 2 min): gravar mataria o botão para sempre.
  `recusada` GRAVADA é só o irreversível da mensagem (URL relativa antiga,
  grande demais, `MAX_TOKENS`, tentativas esgotadas). ⚠️ A chave é a do GEMINI
  da conta (`lerChave(conta, 'gemini')`, 1042); erro de LEITURA dela é
  `falhou` sem gravar, nunca "sem chave".
- ⚠️ **O modelo é FIXADO em `MODELO_TRANSCRICAO`**, UM para os dois
  chamadores, de propósito: não há "transcrever de novo", quem chega primeiro
  fixa o modelo daquele áudio, nenhuma coluna o registra, e o teto de 3
  tentativas é compartilhado. Trocar é mexer só neste módulo (plano B e
  medições no comentário da constante).
- ⚠️ **Não desligar o raciocínio** (`thinkingBudget: 0` piora o erro,
  medido). ⚠️ **Trocar o modelo NÃO refaz o já transcrito** — quem trocar
  decide, na mesma passada, se limpa `transcricao*` do acervo.
- ⚠️ **`gemini-3.5-transcribe` NÃO serve pelo `generateContent`** (200 com
  `parts: [{}]` vazio, cobrando a entrada — vive noutra API).
- **O worker do Radar transcreve SÓ áudio do CLIENTE e SÓ nunca-tentado**
  (`transcricao_status` nulo), até 5 por análise, dentro do `deadlineMs`. ⚠️
  `falhou` fica para o botão HUMANO (a retentativa por ciclo queimava o teto e
  uma cota estourada carimbava `recusada` em tudo). Falha não derruba a
  análise; o texto entra com `PREFIXO_AUDIO` (contrato com a rubrica: 2.000
  caracteres por linha de áudio, truncamento declarado ao modelo).
- **A transcrição NÃO entra no índice da busca (929).** O mime enviado é
  `messages.media_type` → `Content-Type` do Storage → `audio/ogg`.

### Integrações é o lar das CHAVES e dos modelos por MÓDULO (946)

`montar.ts` (puro, testado), `GET /api/cb/integracoes/status` e
`integracoes-panel.tsx`. Agentes de IA ficou com o COMPORTAMENTO do agente de
conversa.

- ⚠️⚠️ **A CHAVE é do PROVEDOR, uma por conta, em `cb_ia_chaves` (1042)** —
  nunca por conexão (D1 do `docs/PLANO-agentes-de-ia.md`). FECHADA ao
  navegador: só `src/lib/ia-chaves/repo.ts` a toca, com o cliente de SERVIÇO
  (a sessão leria zero linhas sem erro); pino `chaves.chamadores.test.ts`. A
  de embeddings é a da OpenAI, MENOS a recusada para embeddings ao gravar
  (`serve_embeddings = false`), e a DEDICADA herdada
  (`cb_ia_chaves.embeddings_api_key`) vence — `lerChaveDeEmbeddings`.
  `ai_configs.api_key`/`embeddings_api_key` só servem à volta atrás: nada as
  LÊ, e `gravarChave` as ESPELHA. A chave nova é conferida em CADA modelo em
  uso; recusada num que a atual alcança, nada troca (`modelo_em_uso_recusado`).
- ⚠️ **A linha PADRÃO de `ai_configs` é a configuração dos MÓDULOS** (provedor
  e modelo do Radar) e do assistente legado, para a conta inteira. `montar.ts`
  monta um cartão por provedor a partir da CHAVE e lê só a linha padrão; a
  lista de canais aparece SÓ no Radar (o `radar_enabled`).
  O `PUT /api/cb/ia/chaves` cria a linha padrão (assistente DESLIGADO) quando
  falta: sem ela o Radar ficaria em `sem_ia` com a chave cadastrada.
- ⚠️ **Só o Radar tem coluna própria (`ai_configs.radar_model`; NULL = herda
  `model`).** Transcrição e RAG têm constante (`MODELO_TRANSCRICAO`,
  `EMBEDDING_MODEL`), que entra em `montarCartoes` por PARÂMETRO, importada na
  rota — nunca redigitada no módulo puro nem no dicionário.
- ⚠️ **O modelo do Radar aparece em TRÊS lugares do worker** (a chamada a
  `generateStructured`, o `logAiUsage` e a coluna `model` do insight):
  resolver `config.radarModel ?? config.model` UMA vez; deixar um para trás
  atribui o custo ao modelo errado.
- ⚠️ **`generateStructured` recebe o modelo por PARÂMETRO explícito**, nunca
  por `{...config, model}`: o spread não deixa rastro no tipo, e um merge que
  reescreva `structured.ts` devolveria o Radar ao modelo do chat sem quebrar o
  typecheck.
- ⚠️ **`POST /api/ai/config` reescreve a linha** (campo ausente vira NULL ou
  false): Integrações não passa por ele — chave por `/api/cb/ia/chaves`,
  modelo do Radar por `PATCH /api/cb/ia/radar` (só `radar_model`). Outra tela
  que volte ao POST ecoa o que não edita. Ele ignora `api_key` e recusa com
  `sem_chave`; o `DELETE` dele saiu (apagava a chave do Radar e da
  transcrição) — apagar chave é em Integrações, com confirmação.
- ⚠️ **`radar_model` ausente do corpo = "não mexe"** (a convenção de
  `handoff_agent_id`): senão um save vindo de Agentes zeraria o modelo do Radar.
- ⚠️ **O modelo do Radar é validado no SAVE, contra o provedor** — inclusive
  quando só o PROVEDOR muda. O ping da aba testa só o modelo do CHAT (pingar o
  do Radar seria outra chamada paga a cada carga).
- ⚠️ **`?ping=0` existe porque cada ping é uma geração PAGA**: a tela carrega
  em dois tempos (config, depois pings), o botão repete só os pings, e o
  `useEffect` tem guarda própria (`disparouRef`) contra o StrictMode.
- **Nenhuma chave sai da rota de STATUS nem da de chaves, nem mascarada**: a
  falha volta como CÓDIGO, nunca como `AiError.message` (a OpenAI ecoa a
  chave). ⚠️ O SAVE do modelo do Radar devolve a mensagem do provedor (é ela
  que diz "modelo não encontrado") — EXCETO `code === 'invalid_key'`, que vira
  texto genérico. Preservar a exceção.
- **Módulo sem uso ativo NÃO some**: aparece com o motivo (é quando o
  operador descobre que o Radar está desligado na conexão).
- **Radar exige `radar_enabled === true`; transcrição é Gemini-only; RAG é
  OpenAI-only** e aparece no cartão da OpenAI mesmo com outro provedor.
- **`AI_PROVIDER_MODELS` é SUGESTÃO (`<datalist>`), nunca allow-list**: o
  servidor grava qualquer texto não vazio — ids de modelo mudam rápido.
- **Google Agenda é cartão "não conectado" de propósito** (a integração não
  existe; será o ponto de conexão).

### Agentes de IA (1043, `src/lib/ia-agentes/`, `/agents`)

O plano vivo é `docs/PLANO-agentes-de-ia.md` (D1–D23, E1–E14). F1b: criados,
testados no Playground e medidos. F2a (1044): RESPONDEM cliente — ver "Quem
responde"; a resposta automática do assistente anterior saiu (E2,
`dispatchInboundToAiReply`), e o ✨ do
rascunho segue nele.

- ⚠️⚠️ **"Agente" no código é PESSOA** (`assigned_agent_id`, o papel `agent`).
  Agente de IA leva `ia_agente` no nome (`cb_ia_agentes`, `ia_agente_id`).
- ⚠️ **`cb_ia_agentes` só dá SELECT ao ADMINISTRADOR** (D14, forma da 1032) e
  nenhuma escrita ao navegador: `src/lib/ia-agentes/repo.ts` escreve com o
  cliente de serviço, a conta em toda consulta e os ids das listas conferidos
  contra a conta (arrays sem FK). Nome e id para quem não é admin saem por
  rota, nunca pela tabela.
- ⚠️ **`conexoes` vazio = NENHUMA conexão**, nunca "todas" (a exceção do
  `radar_enabled`). Apagar conexão a tira dos agentes por gatilho.
- **Apagar é ARQUIVAR**: o uso antigo guarda o nome CONGELADO
  (`ai_usage_log.ia_agente_nome`); o nome é único só entre os não arquivados.
- **Instruções e regras (D23) em campos separados**; o pedido ao modelo sai
  de UMA função pura (`montarPedidoDoAgente`): texto-base em inglês (o modelo
  responde no idioma do cliente), data e hora no fuso do escritório,
  instruções, regras numeradas, base de conhecimento. O Playground usa a mesma
  montagem — testa o que a produção vai mandar.
- **O gasto do Playground é `agente_teste`** (D13), separado de `agente`. A
  soma do uso é no BANCO (`cb_ia_uso`): linha a linha, o PostgREST cortava
  em 1000.
- ⚠️ **Custo em R$ (D21) é ESTIMATIVA**: preço de lista em US$ com VIGÊNCIA por
  linha (`precos.ts` — preço novo é linha nova, senão o histórico muda) × a
  cotação de hoje (`ai_configs.cotacao_dolar`). Modelo fora da tabela é "sem
  preço", NUNCA zero; a saída do Gemini é `max(saída, total − entrada)`.

### Quem responde (F2a, 1044): a regra, a fila e o turno

`quem-responde.ts` (puro), `entrada.ts` (a porta das DUAS ingestões),
`fila.ts`, `turno.ts`, `rede.ts` (no topo de `/api/automations/cron`).

- ⚠️⚠️ **A ingestão só ENFILEIRA** (RPC `cb_ia_enfileirar_turno`, pendente
  POR CONEXÃO; a rajada de 8 s empurra o mesmo pendente). Executa o disparo
  em `after()` depois da espera e, como rede, o cron. Nada segura a ingestão
  (o `message.received` vem atrás).
- ⚠️⚠️ **A ordem das regras É a regra** (`quemResponde`): robô consumiu →
  automação FALOU (`ResultadoDoDisparo.falou`, somado em TODOS os gatilhos da
  mensagem — E4; soma o `tag_added` aninhado no `add_tag` e a fala ADIADA do
  funil, `etapaTemQuemFale`: `create_deal`/`move_deal_stage` para etapa que
  automação ligada escuta) → pausada → agente ATIVO (ligado, não arquivado,
  dono da conexão) → ENTRADA só SEM agente ativo, sem resposta de gente (D16),
  contato criado depois de a entrada ligar (P8) E junto com a conversa (±2 min;
  o importado não). Agente ativo que não responde aqui NÃO é substituído pela
  entrada — desligar é freio.
- ⚠️ **O card que o FUNIL cria na ingestão também é fala adiada**:
  `routeContactToPipeline` devolve a etapa do card que CRIOU (nulo = não
  criou), e as DUAS ingestões de cliente (`persistInboundMessage`, webhook da
  Meta) a passam por `etapaTemQuemFale` antes da entrada. Ingestão nova que
  chame o roteador repete (pino `pipeline-routing.chamadores.test.ts`).
- ⚠️⚠️ **UMA régua de conteúdo, `abreTurno`, na entrada E no turno** (E9/E10):
  não abrem turno — e por isso não descartam o turno em curso — a figurinha
  (`image` + `image/webp`, já no insert da Evolution), localização, botão,
  texto sem nada visível e o rótulo que o webhook da Meta grava para tipo que
  não lê ("[Unsupported message type: contacts]"): o webhook o MONTA com
  `PREFIXO_DE_TIPO_NAO_SUPORTADO` e `abreTurno` recusa pelo COMEÇO — rótulo
  reescrito num lado só volta a abrir turno. Duas réguas = texto + figurinha
  sem resposta nenhuma.
- ⚠️ **Robô ou automação que respondeu cala o agente nas duas pontas**: a
  entrada descarta o PENDENTE da conexão (`descartarPendente`) e o turno
  descarta se há `bot` sem `ia_agente_id` gravado depois do gatilho, na MESMA
  conexão (D4) — senão o botão na rajada daria duas respostas.
- ⚠️⚠️ **O turno NUNCA reenvia.** Erro depois da primeira chamada ao provedor
  (`antesDoProvedor`) que não seja recusa comprovada (4xx) é `incerto` e
  transfere para gente; o recolhedor (`rede.ts`) decide pelo que o turno
  carimbou (`enviando_desde`, `mensagem_enviada_id`), nunca re-executa. Dono e
  contato vêm ANTES da reserva (`cb_ia_reservar_envio`: teto, pausa, agente
  e encerrada numa escrita, na linha que a pausa por gente trava).
- ⚠️ **Falha de CONFIGURAÇÃO não transfere** (E8): chave, modelo, provedor
  fora do ar → `falhou`, e o alerta de atraso chama a equipe. Transferem: o
  sentinela, a resposta vazia, o teto, o áudio que não se ouve e o envio
  incerto — pausa `'transferencia'`, destino só sem responsável (e membro),
  anotação de autor sem usuário ("IA · <agente>"). ⚠️ NUNCA por cima de pausa
  que já existe (`transferirParaGente` cerca `ai_autoreply_disabled = false`;
  zero linhas = sem nota nem atribuição, turno `pausado_no_meio`): a de
  gente é a que a automação retoma (D17).
- ⚠️ **Cerca de posse em TODA escrita no turno** (`status = 'rodando'` e o
  `rodando_desde` do próprio claim) — MENOS o id do provedor
  (`gravarIdEnviado`, cercado por turno e id nulo): o eco precisa dele mesmo
  com o turno recolhido, e ele não mexe no status.
- ⚠️ **Só o turno passa `iaAgenteId` ao `engineSendText`** (pino
  default-deny): a 972 (redefinida na 1044) conta `bot` COM `ia_agente_id`
  como "respondido" e apaga o alerta de atraso — fluxo ou automação que o
  passassem calariam o alerta de todo cliente esperando.
- ⚠️ **O contexto é SÓ da conexão do turno** (D4), sem as apagadas; áudio
  pela transcrição (reagenda até 2 min de `gravada_em`), mídia como
  descrição (`contexto.ts`).
- ⚠️⚠️ **A D17 ("gente respondeu em 24 h?") é UMA função SQL,
  `cb_ia_gente_respondeu_em_24h`**, usada por `cb_atribuir_agente_de_ia`
  ("Atribuir agente", passo e entrada: conversa travada, relê o agente, nunca
  toca `assigned_agent_id`) e por `cb_retomar_ia_por_automacao` (o "ligar" do
  `set_ai`, E13). Nunca copiar a consulta (pino na 1044). O "ligar" retoma só
  `gente`/`automacao` sem gente em 24 h (`automacao` + gente recente vira
  `gente`); `botao`, `transferencia` e pausa sem motivo, nunca; sem pausa, só
  zera o teto (D10). UPDATE solto no motor põe a IA por cima do advogado; erro
  ou resposta desconhecida da RPC = falha visível do passo.
- **Pausa por gente é GATILHO** (1044), pelo `gravada_em` (não o relógio do
  aparelho) com o `created_at` na janela de 24 h da D17; o eco do turno fica
  fora pelo `mensagem_enviada_id`. O turno relê a mensagem-gatilho a cada
  conferência (apagada: descarta). O eco da Evolution que chega antes do INSERT é gravado
  COMO a resposta do agente por `eco.ts` — o SEGUNDO escritor de `messages`
  com `ia_agente_id`; nenhum motor (pino `eco.test.ts`).
- **FK anulável de `cb_ia_turnos`/`ai_usage_log` ganha índice PARCIAL**
  (`WHERE col IS NOT NULL`) na mesma migration (`mensagem_gatilho_id`,
  `mensagem_inicial_id`, `turno_id`; `conversation_id` cheio, pela cascata):
  sem ele, apagar mensagem ou conversa varre a tabela. Sem índice, decisão do
  operador: `messages.ia_agente_id` (travaria as escritas) e `canal_id`.
- ⚠️ **A faixa do fio (`ai-thread-banner.tsx`) lê a CONVERSA**:
  `ia_agente_id` acende, `ai_autoreply_disabled` pausa, `ia_pausada_por`
  explica — nunca `/api/ai/config` nem `is_active`/`auto_reply_enabled`. O
  responsável humano NÃO a esconde; o "Retomar" não toca `assigned_agent_id`
  (`patchDoClique`), só o "Assumir" atribui. Erro da rota vira frase por
  `erroDaResposta`, nunca o `error` cru; chaves de motivo e erro LITERAIS.
  Pinos em `ai-thread-banner.test.tsx`.
- ⚠️ **A tela legada (`ai-config.tsx`) não tem controle de auto-reply**: o
  corpo (`corpoDoSalvamento`) ECOA `auto_reply_*` como lidos (o POST reescreve
  a linha) e NÃO manda `handoff_agent_id` (presente, a rota exige membro atual,
  e um ex-membro travaria o Salvar sem seletor). Pino `ai-config.test.ts`.

### Assistente e provedores (`src/lib/ai/`)

- ⚠️ **O "digitando…" (#527) sai pelo MESMO canal da resposta**
  (`mostrarDigitando`, `src/lib/ai/digitando.ts`): a resolução de
  `engineSendText` com o canal da entrada, só em canal Meta e só com id
  `wamid.` (o turno relê o `message_id` do gatilho). Nunca as credenciais da
  CONTA, como no original. Melhor esforço, sem `await`: nunca lança nem segura
  a resposta, e o log passa por `semTokenDaMeta`. ⚠️ A Meta marca a mensagem
  do cliente como LIDA junto (decisão do operador, P6). Chamado pelo TURNO
  (`turno.ts`) depois das conferências, logo antes de gerar a resposta.
- **`generateStructured` (`structured.ts`) é separado de `generateReply` DE
  PROPÓSITO**: o turno e o rascunho não herdam regressão da análise.
- **Gemini é o terceiro provedor** (o upstream conhece só OpenAI e Anthropic;
  `structured.ts` e `providers/gemini.ts` são nossos): chave SEMPRE no
  cabeçalho `x-goog-api-key`, nunca `?key=` (vaza em log de proxy); em
  produção, chave do tier PAGO (a faixa gratuita pode usar os dados enviados).
  Embeddings/RAG exigem chave OpenAI (modelo fixo, `vector(1536)`).
- **Modo ou provedor novo exige migration no CHECK** de `ai_usage_log`
  (`mode`, `provider`): senão
  `logAiUsage` engole o erro e o custo some da aba Uso.
- ⚠️ **`ai_configs` tem índices únicos PARCIAIS (903: global + por canal).**
  `.upsert(..., { onConflict })` não serve (use lookup + insert/update), e
  `.maybeSingle()` só por `account_id` estoura quando existir uma segunda
  linha — escopar o canal, ou `.is('channel_id', null)` para o padrão.
- Agente por canal, interruptor, RAG por canal, `radarModel` em
  `CONFIG_COLUMNS` e a opção Gemini (`ai-config.tsx`, `/api/ai/config`) são
  trechos NOSSOS em arquivos do upstream (`docs/MERGE-UPSTREAM.md`).
