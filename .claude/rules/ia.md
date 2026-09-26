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

Chave por provedor, da conta (BYO), cifrada com `ENCRYPTION_KEY`. História:
`git show f5879b3f:CLAUDE.md` e `docs/PLANO-radar-de-atendimento.md`.

### Radar de Atendimento (941): worker + tabela + aba `/radar`

A IA lê as conversas dos últimos 7 dias e grava `cb_conversation_insights`
(UMA linha viva por conversa, pelo `worker.ts`); o painel só lê.

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
- ⚠️ **A pendência é conferida AO VIVO na tela** (`respostasDepoisDaPendencia`):
  `aguardando_desde` é o retrato da última análise. Falha para o lado do
  ALARME (erro mantém o cartão; lista truncada vale — DESC, o teto só omite
  resposta antiga). Mensagem apagada não conta como resposta.
- ⚠️⚠️ **"Resposta de gente" = `sender_id` preenchido OU `from_device = true`**
  (o celular pareado não tem `sender_id`). Não fecham a pendência: broadcast,
  automação, fluxo e a AGENDADA — que sai COM `sender_id` e é excluída, no
  worker e ao vivo, por `cb_scheduled_messages.message_id`. ⚠️
  `houveHumanoNaJanela` usa só `sender_id` de propósito (preserva a análise
  congelada): não unificar. ⚠️ **A resposta do AGENTE DE IA (`bot` com
  `ia_agente_id`) FECHA a pendência, mas NÃO entra no tempo de resposta da
  equipe** (`porAgenteDeIa`; ao vivo, `RESPOSTA_QUE_FECHA_A_PENDENCIA`).
- ⚠️ **Análise `failed` aparece INDEPENDENTE de gatilho** (sumida, o vazio
  afirmaria "nenhum sinal aberto" sobre conversa que o Radar não leu). O
  resgate filtra `estado = 'aberto'` (pino `use-radar.resgate.test.ts`).
- ⚠️ **O painel recarrega a cada 2 min com a aba visível** (o tique de 1 min
  só re-renderiza): é o que vê que um colega respondeu.
- ⚠️ **Insatisfação exige evidência recente — 2 dias de expediente, em TEMPO
  ÚTIL** (`JANELA_INSATISFACAO_UTIL_SEG`; em corridas, a de sexta expirava no
  domingo). Escrita e leitura SE SOMAM (~4 dias úteis). ⚠️ A âncora é o
  INSTANTE DA ANÁLISE (`agoraMs`, 3º argumento de `interpretarAnalise`), não a
  última linha — senão a conversa que morre depois da resposta ficava acesa
  para sempre.
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
  lento).
- ⚠️ **`cb_channels.radar_enabled` nasce FALSE e é `=== true`** — exceção
  DELIBERADA a "escopo vazio = todos" (conversa de cliente vai a provedor
  externo, e há canal pessoal na conta). Não "corrigir".
- **`authenticated` só tem SELECT** em `cb_conversation_insights`: tratar e
  descartar passam por `PATCH /api/cb/radar/[conversationId]/estado` (UPDATE
  do navegador volta 0 linhas).
- **Sinal sem evidência é DESCARTADO pelo parser** (`interpretarAnalise`,
  `rubrica.ts`; evidência = índice de linha do transcrito → `messages.id`):
  sem isso o painel vira gerador de alarme falso.
- ⚠️ **Feedback por atendente exige AUTORIA**: a observação só passa se citar
  linha ESCRITA pelo atendente nomeado (`LinhaDoTranscrito.autor`) — senão
  "a Ana demorou", do cliente, viraria auditoria da Ana. Nome não resolvido =
  "Equipe", sem avaliação. Na tela, só `useCan('manage-members')`. ⚠️ **O gate
  é SÓ de renderização** (qualquer membro lê `detalhes.analise`); a barreira
  real é PENDÊNCIA, com a receita, em `docs/PLANO-radar-de-atendimento.md`.
- **Tempos em segundos ÚTEIS com fuso FIXO -03:00**: só `horario-comercial.ts`
  muda se o horário de verão voltar; intervalo negativo vira zero lá.
- ⚠️ **Ciclo de vida do sinal, três regras assimétricas**: `tratado` reabre SÓ
  com mensagem DO CLIENTE posterior ao `estado_em` (UPDATE condicional
  separado); `descartado` NUNCA reabre sozinho; `aberto` fica. ⚠️ Exceção:
  descarte sobre `failed` que NUNCA teve análise (`descarteFoiSobreFalha`)
  reabre na primeira análise boa.
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
  CREDENCIAL; `is_active` é do assistente) ⚠️ e SEM `channelId` (1047): a
  configuração do Radar é da conta — pelo canal, um agente de uma conexão
  trocaria a chave e o modelo do Radar ali (pino `chaves.chamadores.test.ts`).
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
  da conta (`lerChave(conta, 'gemini')`, 1047), direto — nem agente nem canal
  (um agente de outro provedor na conexão fazia recusar tudo); erro de
  LEITURA dela é `falhou` sem gravar, nunca "sem chave".
- ⚠️ **O modelo é FIXADO em `MODELO_TRANSCRICAO`**, UM para os dois
  chamadores, de propósito: não há "transcrever de novo", quem chega primeiro
  fixa o modelo daquele áudio, nenhuma coluna o registra, e o teto de 3
  tentativas é compartilhado. Plano B: no comentário da constante.
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
`integracoes-panel.tsx`. O COMPORTAMENTO do agente fica em Agentes de IA.

- ⚠️⚠️ **A CHAVE é do PROVEDOR, uma por conta, em `cb_ia_chaves` (1047)** —
  nunca por conexão (D1). FECHADA ao navegador: só `src/lib/ia-chaves/repo.ts`
  a toca, com o cliente de SERVIÇO (a sessão leria zero linhas); pino
  `chaves.chamadores.test.ts`. A de embeddings é a da OpenAI, MENOS a recusada
  para embeddings ao gravar (`serve_embeddings = false`), e a DEDICADA herdada
  (`cb_ia_chaves.embeddings_api_key`) vence (`lerChaveDeEmbeddings`).
  `ai_configs.api_key`/`embeddings_api_key`: nada as LÊ, `gravarChave` as
  ESPELHA (volta atrás). A chave nova é conferida em CADA modelo em uso;
  recusada num que a atual alcança, nada troca (`modelo_em_uso_recusado`). A
  da OpenAI que nenhum chat usa e só gera embedding grava a marca "só da
  base" (`soDaBase`: o mesmo cifrado nas duas colunas) — nenhuma tela a
  oferece ao chat, onde toda geração falharia.
- ⚠️ **A linha PADRÃO de `ai_configs` é a configuração dos MÓDULOS** (provedor
  e modelo do Radar) e do assistente legado, para a conta inteira. `montar.ts`
  monta um cartão por provedor a partir da CHAVE e lê só a linha padrão; a
  lista de canais aparece SÓ no Radar (o `radar_enabled`).
  O `PUT /api/cb/ia/chaves` a cria (assistente DESLIGADO) quando falta: sem
  ela o Radar fica em `sem_ia` com a chave cadastrada.
- ⚠️ **Só o Radar tem coluna própria (`ai_configs.radar_model`; NULL = herda
  `model`).** Transcrição e RAG têm constante (`MODELO_TRANSCRICAO`,
  `EMBEDDING_MODEL`), que entra em `montarCartoes` por PARÂMETRO, importada na
  rota — nunca redigitada no módulo puro nem no dicionário.
- ⚠️ **O modelo do Radar aparece em TRÊS lugares do worker** (a chamada a
  `generateStructured`, o `logAiUsage` e a coluna `model` do insight):
  resolver `config.radarModel ?? config.model` UMA vez; deixar um para trás
  atribui o custo ao modelo errado.
- ⚠️ **`generateStructured` recebe o modelo por PARÂMETRO explícito**, nunca
  por `{...config, model}`: o spread não deixa rastro no tipo, e um merge em
  `structured.ts` devolveria o Radar ao modelo do chat sem erro nenhum.
- ⚠️ **`POST /api/ai/config` reescreve a linha** (campo ausente vira NULL ou
  false): Integrações não passa por ele — chave por `/api/cb/ia/chaves`,
  modelo do Radar por `PATCH /api/cb/ia/radar`; outra tela que volte a ele
  ecoa o que não edita. Ignora `api_key` (recusa `sem_chave`); o `DELETE`
  saiu (apagava a chave do Radar e da transcrição).
- ⚠️ **`radar_model` ausente do corpo = "não mexe"** (a convenção de
  `handoff_agent_id`): senão um save vindo de Agentes zeraria o modelo do Radar.
- ⚠️ **O modelo do Radar é validado no SAVE, contra o provedor** — inclusive
  quando só o PROVEDOR muda. O ping da aba testa o modelo do CHAT, o do Radar
  quando difere e o Radar está ligado em alguma conexão (pode sair do ar
  depois do save), e, na chave do Gemini, o `MODELO_TRANSCRICAO`.
- ⚠️ **`?ping=0` existe porque cada ping é uma geração PAGA**: a tela carrega
  em dois tempos (config, depois pings), o botão repete só os pings, e o
  `useEffect` tem guarda própria (`disparouRef`) contra o StrictMode.
- **Nenhuma chave sai da rota de STATUS nem da de chaves, nem mascarada**: a
  falha volta como CÓDIGO, nunca como `AiError.message` (a OpenAI ecoa a
  chave). ⚠️ O SAVE do modelo do Radar devolve a mensagem do provedor (é ela
  que diz "modelo não encontrado") — EXCETO `code === 'invalid_key'`, que vira
  texto genérico (nunca tirar a exceção).
- **Módulo sem uso ativo NÃO some**: aparece com o motivo (o Radar desligado
  na conexão).
- **Radar exige `radar_enabled === true`; transcrição é Gemini-only; RAG é
  OpenAI-only** (modelo fixo, `vector(1536)`), no cartão da OpenAI mesmo com
  outro provedor.
- **`AI_PROVIDER_MODELS` é SUGESTÃO (`<datalist>`), nunca allow-list**: o
  servidor grava qualquer texto não vazio — ids de modelo mudam rápido.
- **Google Agenda é cartão "não conectado" de propósito** (não existe).

### Agentes de IA (1048, `src/lib/ia-agentes/`, `/agents`)

Plano vivo: `docs/PLANO-agentes-de-ia.md` (D1–D23, E1–E14). F2a (1049): eles
RESPONDEM cliente; a resposta automática do assistente anterior saiu (E2), e
o ✨ do rascunho segue nele.

- ⚠️⚠️ **"Agente" no código é PESSOA** (`assigned_agent_id`, o papel `agent`).
  Agente de IA leva `ia_agente` no nome (`cb_ia_agentes`, `ia_agente_id`).
- ⚠️ **`cb_ia_agentes` só dá SELECT ao ADMINISTRADOR** (D14, forma da 1032) e
  nenhuma escrita ao navegador: `repo.ts` escreve com o cliente de serviço,
  a conta em toda consulta e os ids das listas conferidos contra a conta
  (arrays sem FK). Quem não é admin lê nome e id por rota.
- ⚠️ **`conexoes` vazio = NENHUMA conexão**, nunca "todas" (a exceção do
  `radar_enabled`). Apagar conexão a tira dos agentes por gatilho.
- **Apagar é ARQUIVAR**: o uso antigo guarda o nome CONGELADO
  (`ai_usage_log.ia_agente_nome`); o nome é único só entre os não arquivados.
- **Instruções e regras (D23) em campos separados**; o pedido ao modelo sai
  de UMA função pura, a do turno e do Playground (`montarPedidoDoAgente`).
- **O gasto do Playground é `agente_teste`** (D13), separado de `agente`. A
  soma do uso é no BANCO (`cb_ia_uso`): linha a linha, o PostgREST cortava
  em 1000.
- ⚠️ **Custo em R$ (D21) é ESTIMATIVA**: preço de lista em US$ com VIGÊNCIA por
  linha (`precos.ts` — preço novo é linha nova, senão o histórico muda) × a
  cotação de hoje (`ai_configs.cotacao_dolar`). Modelo fora da tabela é "sem
  preço", NUNCA zero; a saída do Gemini é `max(saída, total − entrada)`.

### Quem responde (F2a, 1049): a regra, a fila e o turno

`quem-responde.ts` (puro), `entrada.ts` (a porta das DUAS ingestões),
`fila.ts`, `turno.ts`, `rede.ts` (no topo de `/api/automations/cron`).

- ⚠️⚠️ **A ingestão só ENFILEIRA** (RPC `cb_ia_enfileirar_turno`, pendente
  POR CONEXÃO; a rajada de 8 s empurra o mesmo pendente). Executa o disparo
  em `after()` depois da espera e, como rede, o cron. Nada segura a ingestão
  (o `message.received` vem atrás).
- ⚠️⚠️ **A ordem das regras É a regra** (`quemResponde`): robô consumiu →
  automação FALOU (`ResultadoDoDisparo.falou`, somado em TODOS os gatilhos da
  mensagem, E4, com o `tag_added` aninhado e a fala ADIADA do funil: card
  criado ou movido para etapa que automação ligada escuta,
  `etapaTemQuemFale`) → pausada → agente ATIVO (ligado, não arquivado,
  dono da conexão) → ENTRADA só SEM agente ativo, sem resposta de gente (D16),
  contato criado depois de a entrada ligar (P8) E junto com a conversa (±2 min;
  o importado não). Agente ativo que não responde aqui NÃO é substituído pela
  entrada — desligar é freio.
- ⚠️ **O card que o FUNIL cria na ingestão também é fala adiada**:
  `routeContactToPipeline` devolve a etapa do card que CRIOU (nulo = não
  criou), e TODA ingestão de cliente a passa por `etapaTemQuemFale` antes da
  entrada (pino `pipeline-routing.chamadores.test.ts`). ⚠️ A mensagem
  SEGUINTE da rajada abre turno: `conferir` REAGENDA enquanto o contato tem
  `deal_stage_changed` não drenado em etapa com quem fale
  (`funilAindaVaiFalar`), até `JANELA_DO_AUDIO_MS` do gatilho (leitura que
  falha reagenda). O dreno carimba `processado_em` ANTES de rodar a
  automação: nesse vão só a reserva (`robo_falou`) pega, com a fala gravada.
- ⚠️⚠️ **UMA régua de conteúdo, `abreTurno`, na entrada E no turno** (E9/E10):
  não abrem turno (nem descartam o em curso) a figurinha (`image` +
  `image/webp`), localização, botão, texto sem nada visível e o rótulo do
  tipo que o webhook da Meta não lê — MONTADO com
  `PREFIXO_DE_TIPO_NAO_SUPORTADO` e recusado pelo COMEÇO (reescrito num lado
  só, volta a abrir turno). Duas réguas = texto + figurinha sem resposta.
- ⚠️ **Robô ou automação que respondeu cala o agente**: a entrada descarta o
  PENDENTE da conexão (`descartarPendente`), e o turno e a reserva descartam
  se há `bot` sem `ia_agente_id` gravado depois do gatilho, na MESMA conexão
  (D4) — senão o botão na rajada daria duas respostas.
- ⚠️⚠️ **A última palavra é da reserva (`cb_ia_reservar_envio`)**: UMA
  escrita na linha travada (`FOR NO KEY UPDATE`; a `FOR UPDATE` disputaria com
  a FK de quem insere mensagem) — teto, pausa, agente, encerrada, OUTRO turno
  pendente da conexão (`p_turno_id`, `p_canal_id`) e saída do robô depois do
  gatilho (`p_gatilho_gravada_em`). Dono e contato vêm antes. `mais_nova` e
  `robo_falou` DESCARTAM; só `teto` transfere, e só com o contador lido sob a
  trava no teto (prova sumida = `mais_nova`: teto falso é pausa que só gente
  desfaz); resultado desconhecido = `falhou`. Nulo compara por `IS NOT
  DISTINCT FROM` (o lado que recusa).
- ⚠️⚠️ **O turno NUNCA reenvia.** Erro depois da primeira chamada ao provedor
  (`antesDoProvedor`) que não seja recusa comprovada (4xx) é `incerto` e
  transfere para gente; o recolhedor (`rede.ts`) decide pelo que o turno
  carimbou (`enviando_desde`, `mensagem_enviada_id`), nunca re-executa. A
  vaga do teto volta só quando nada saiu (`nadaSaiu` → `devolverVaga`,
  compare-and-swap: o PostgREST não escreve `x - 1`); o incerto a mantém.
- ⚠️ **Falha de CONFIGURAÇÃO não transfere** (E8): chave, modelo, provedor
  fora do ar → `falhou`, e o alerta de atraso chama a equipe. Transferem: o
  sentinela, a resposta vazia, o teto, o áudio que não se ouve e o envio
  incerto — pausa `'transferencia'`, destino só sem responsável (e membro),
  anotação sem usuário ("IA · <agente>"). ⚠️ NUNCA por cima de pausa que já
  existe (`transferirParaGente` cerca `ai_autoreply_disabled = false`; zero
  linhas = sem nota nem atribuição, turno `pausado_no_meio`): a de gente é a
  que a automação retoma (D17).
- ⚠️ **Cerca de posse em TODA escrita no turno** (`status = 'rodando'` e o
  `rodando_desde` do próprio claim) — MENOS o id do provedor
  (`gravarIdEnviado`, cercado por turno e id nulo): o eco precisa dele mesmo
  com o turno recolhido, e ele não mexe no status.
- ⚠️ **Só o turno passa `iaAgenteId` ao `engineSendText`** (pino
  default-deny): a 972 (redefinida na 1049) conta `bot` COM `ia_agente_id`
  como "respondido" — com ele, fluxo ou automação calariam o alerta de
  atraso de todo cliente esperando.
- ⚠️ **O contexto é SÓ da conexão do turno** (D4), sem as apagadas; áudio
  pela transcrição (reagenda até 2 min de `gravada_em`), mídia como
  descrição (`contexto.ts`).
- ⚠️⚠️ **A D17 ("gente respondeu em 24 h?") é UMA função SQL,
  `cb_ia_gente_respondeu_em_24h`**, usada por `cb_atribuir_agente_de_ia`
  (conversa travada, relê o agente, nunca toca `assigned_agent_id`; a ENTRADA
  passa `p_so_se_vazio` e desiste sem enfileirar no `ocupada`, o passo
  "Atribuir agente" TROCA) e por `cb_retomar_ia_por_automacao` (o "ligar" do
  `set_ai`, E13). Nunca copiar a consulta (pino na 1049). O "ligar" retoma só
  `gente`/`automacao` sem gente em 24 h (`automacao` + gente recente vira
  `gente`); `botao`, `transferencia` e pausa sem motivo, nunca; sem pausa, só
  zera o teto (D10). UPDATE solto no motor põe a IA por cima do advogado; erro
  ou resposta desconhecida da RPC = falha visível do passo.
- **Pausa por gente é GATILHO** (1049), pelo `gravada_em` (não o relógio do
  aparelho), com o `created_at` na janela de 24 h da D17; o eco do turno fica
  fora pelo `mensagem_enviada_id`. O turno relê o gatilho a cada conferência
  (apagado: descarta). O eco da Evolution que chega antes do INSERT é gravado
  COMO a resposta do agente por `eco.ts` — 2º escritor de `messages` com
  `ia_agente_id`; nenhum motor (pino `eco.test.ts`).
- **FK anulável de `cb_ia_turnos`/`ai_usage_log` ganha índice PARCIAL**
  (`WHERE col IS NOT NULL`; `conversation_id` cheio): sem ele, apagar
  mensagem, conversa ou conexão varre a tabela. `messages.ia_agente_id` fica
  sem índice (decisão do operador: travaria as escritas).
- ⚠️ **Apagar conexão DESCARTA os pendentes dela** (gatilho BEFORE DELETE
  `cb_channels_descarta_turnos_de_ia`, antes do SET NULL): sem ele, dois
  pendentes da conversa em conexões apagadas colidem em (conversa, NULL) e o
  DELETE da conexão ABORTA.
- ⚠️ **A faixa do fio (`ai-thread-banner.tsx`) lê a CONVERSA**:
  `ia_agente_id` acende, `ai_autoreply_disabled` pausa, `ia_pausada_por`
  explica — nunca `/api/ai/config`. O responsável humano NÃO a esconde; só o
  "Assumir" toca `assigned_agent_id` (`patchDoClique`). Erro da rota vira
  frase (`erroDaResposta`); chaves LITERAIS. ⚠️ O clique otimista é APAGADO
  no render quando deixa de valer (`cliqueAindaVale`: outra conversa, ou o
  banco fora do `base`) — senão o banco que confirma e VOLTA (o gatilho
  pausou) devolve o clique velho; a marca nasce NO clique, e a resposta só a
  completa se ainda for a mesma. O React Compiler não analisa a faixa (o
  `finally`): a prova é o teste de sequência de renders.
- ⚠️ **A tela legada (`ai-config.tsx`) não tem controle de auto-reply**: o
  corpo (`corpoDoSalvamento`) ECOA `auto_reply_*` como lidos (o POST reescreve
  a linha) e NÃO manda `handoff_agent_id` (a rota exige membro atual: um
  ex-membro travaria o Salvar sem seletor). Pino `ai-config.test.ts`.

### Assistente e provedores (`src/lib/ai/`)

- ⚠️ **O "digitando…" (#527) sai pelo MESMO canal da resposta**
  (`mostrarDigitando`: a resolução de `engineSendText` com o canal da
  entrada), só em canal Meta com id `wamid.` — nunca as credenciais da CONTA,
  como no original. Nunca lança; log por `semTokenDaMeta`. ⚠️ A Meta marca a
  mensagem do cliente como LIDA junto (P6). O TURNO o chama depois das
  conferências, em paralelo com a geração, o ESPERA (`concluirDigitando`, até
  2 s) antes da última conferência e o cancela em toda saída sem envio
  (`finally` de `executarTurno`): solto, chegava à Meta depois da resposta.
  Pino `digitando.chamadores.test.ts`.
- **`generateStructured` (`structured.ts`) é separado de `generateReply` DE
  PROPÓSITO**: o turno e o rascunho não herdam regressão da análise.
- **Gemini é o terceiro provedor** (`structured.ts` e `providers/gemini.ts`
  são nossos): chave SEMPRE no cabeçalho `x-goog-api-key`, nunca `?key=`; em
  produção, tier PAGO (o gratuito pode usar os dados enviados).
- **Modo ou provedor novo exige migration no CHECK** de `ai_usage_log`
  (`mode`, `provider`): senão `logAiUsage` engole o erro e o custo some.
- ⚠️ **`ai_configs` tem índices únicos PARCIAIS (903: global + por canal)**:
  sem `onConflict` (lookup + insert/update); `.maybeSingle()` com o canal, ou
  `.is('channel_id', null)` para o padrão.
- Agente por canal, interruptor, RAG por canal, `radarModel` em
  `CONFIG_COLUMNS` e a opção Gemini são trechos NOSSOS em arquivos do
  upstream (`docs/MERGE-UPSTREAM.md`).
