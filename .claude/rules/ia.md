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
  pedido sem resposta, urgência média/alta ou espera ≥ `LIMIAR_ALARME_MS`. Fora,
  de propósito: nota baixa sozinha (é julgamento, não pendência),
  `mencaoProcesso` sozinha (num escritório quase toda conversa cita processo) e
  `pontosDeAtencao` (a IA resume o caso ali). Mostrar toda análise virava
  boletim de conversa saudável. A análise saudável continua gravada (a nota
  média sai dela).
- ⚠️ **Duas réguas de espera — trocá-las é o erro fácil.** `LIMIAR_ALARME_MS`
  (24 h CORRIDAS) abre o cartão; `LIMIAR_PENDENCIA_SEG` (30 min ÚTEIS) só
  decide a etiqueta — "24 h úteis" chegaria tarde para quem escreveu na sexta.
  No vão entre as duas a etiqueta cai para o INSTANTE (`semRespostaDesde`);
  mexer numa constante sem esse ramo devolve o cartão MUDO.
- ⚠️ **A pendência é conferida AO VIVO na tela** (`respostasDepoisDaPendencia`,
  `use-radar.ts`): `aguardando_desde` é o retrato da última análise. Falha
  para o lado do ALARME (erro mantém o cartão; lista truncada vale — DESC, o
  teto só omite resposta antiga). Mensagem apagada não conta como resposta.
- ⚠️⚠️ **"Resposta de gente" = `sender_id` preenchido OU `from_device = true`.**
  O celular pareado grava `from_device` sem `sender_id`, e é por onde o
  escritório mais responde. Não fecham a pendência: broadcast, automação,
  fluxo e a AGENDADA — que sai COM `sender_id` (o de quem a criou) e é
  excluída, no worker e na conferência ao vivo, por
  `cb_scheduled_messages.message_id`. ⚠️ `houveHumanoNaJanela` do worker usa
  só `sender_id` de propósito (decide se preserva a análise congelada): não
  unificar as duas réguas sem entender a pergunta de cada uma.
  ⚠️ **A resposta do AGENTE DE IA (`bot` com `ia_agente_id`, F2a) FECHA a
  pendência, mas NÃO entra no tempo de resposta da equipe** (`porAgenteDeIa`
  em `metricas.ts`; na conferência ao vivo, o ramo `bot` + `ia_agente_id` de
  `RESPOSTA_QUE_FECHA_A_PENDENCIA`). Robô de fluxo continua não fechando.
- ⚠️ **Análise `failed` aparece INDEPENDENTE de gatilho**: com os defaults do
  schema ela sumiria, e o vazio afirmaria "nenhum sinal aberto" sobre conversa
  que o Radar não conseguiu ler. A consulta de resgate filtra
  `estado = 'aberto'` (pino `use-radar.resgate.test.ts`).
- ⚠️ **O painel recarrega a cada 2 min com a aba visível** (o tique de 1 min
  só re-renderiza): é o que descobre que um colega respondeu.
- ⚠️ **Insatisfação exige evidência recente — 2 dias de expediente, em TEMPO
  ÚTIL** (`JANELA_INSATISFACAO_UTIL_SEG`): em corridas, a de sexta expirava no
  domingo; "48 h úteis" viraria ~6 dias. Escrita e leitura SE SOMAM (~4 dias
  úteis). ⚠️ A âncora é o INSTANTE DA ANÁLISE (`agoraMs`, 3º argumento de
  `interpretarAnalise`), não a última linha — senão a conversa que morre
  depois da resposta ficava acesa para sempre. Pino dos dois lados.
- ⚠️ **Não existe aba "Todos"** (decisão do operador): o descarte errado tem
  duas saídas — o "Desfazer" do toast e o cartão que FICA, apagado, com
  "Reabrir" enquanto a tela está aberta (`mexidasAqui`). **Falso NEGATIVO da
  IA não tem botão** (decisão fechada): reanalisar o mesmo transcrito repete o
  veredito, pago; quem reabrir começa por um "reanalisar tudo" de conta.
- **O painel aplica a MESMA régua do worker na leitura**: esconde insight fora
  dos 7 dias e de canal com `radar_enabled` desligado. ⚠️ Exceção:
  **pendência aberta não expira** — parada além da janela com
  `aguardando_desde` e `estado='aberto'` FICA ("parada há mais de N dias"),
  e os cartões ignoram urgência, insatisfação e nota dela (`foraDaJanela`).

**O worker e a tabela**

- **NADA dispara sozinho**: o agendador bate em `/api/cb/radar/cron` (laço
  lento); mudar o `command` do agendador só vale com `docker stack deploy`
  manual.
- ⚠️ **`cb_channels.radar_enabled` nasce FALSE e é `=== true`** — a exceção
  DELIBERADA à convenção "escopo vazio = todos": o Radar manda conversa de
  cliente a provedor externo, e há canal de uso pessoal na conta. Não
  "corrigir" para a convenção.
- **`authenticated` só tem SELECT** em `cb_conversation_insights`: tratar e
  descartar passam por `PATCH /api/cb/radar/[conversationId]/estado`. UPDATE
  do navegador volta "0 linhas" com cara de sucesso.
- **Sinal sem evidência é DESCARTADO pelo parser** (`interpretarAnalise`,
  `rubrica.ts`): evidência = índice de linha do transcrito, mapeado para
  `messages.id`. É o princípio do produto — quem mexer na rubrica mantém a
  regra, senão o painel vira gerador de alarme falso.
- ⚠️ **Feedback por atendente exige AUTORIA**: a observação só passa se citar
  linha ESCRITA pelo atendente nomeado ("Equipe (Nome)";
  `LinhaDoTranscrito.autor`) — senão "a Ana demorou", do cliente, viraria
  auditoria da Ana. Nome não resolvido = "Equipe", sem avaliação. Na tela, só
  `useCan('manage-members')`. ⚠️ **O gate é SÓ de renderização** (qualquer
  membro lê `detalhes.analise`); a barreira real é PENDÊNCIA, com a receita,
  em `docs/PLANO-radar-de-atendimento.md` ("Fora do MVP").
- **Tempos em segundos ÚTEIS com fuso FIXO -03:00**: `horario-comercial.ts` é
  o único arquivo a mudar se o horário de verão voltar; intervalo negativo
  (relógio do aparelho × `now()` do banco) vira zero lá dentro.
- ⚠️ **Ciclo de vida do sinal, três regras assimétricas**: `tratado` reabre SÓ
  com mensagem DO CLIENTE posterior ao `estado_em` (UPDATE condicional
  separado — o clique durante a análise não é atropelado); `descartado` NUNCA
  reabre sozinho; `aberto` fica. ⚠️ Exceção estreita: descarte sobre `failed`
  que NUNCA teve análise (`descarteFoiSobreFalha`) reabre na primeira análise
  boa — descartou-se o aviso de falha, não um veredito. Não é inconsistência.
- ⚠️ **Toda escrita pós-claim tem CERCA DE POSSE**
  (`.eq('status','running').eq('running_desde', <carimbo do claim>)`), e o
  RECOLHEDOR tem a dele (o mesmo `running_desde` velho que o SELECT viu; `is
  null` quando nulo — `.eq()` nunca casa NULL). ⚠️ "Mensagem nova" exige
  `janela_fim` NÃO nulo: tratar nulo como novidade furava o teto de
  tentativas e virava retentativa paga infinita.
- **A janela de mensagens lê DESC + reverse**: com ASC, o teto cortava as
  mensagens de HOJE e `aguardando_desde` mentia "ninguém aguardando".
- ⚠️ **Janela sem mensagem do cliente NÃO chama a IA** (só métricas;
  `detalhes.sem_cliente_na_janela`) — senão um broadcast disparava dezenas de
  análises pagas. Janela COM fala do cliente reanalisa mesmo quando a novidade
  é só nossa. ⚠️ Janela só de MÁQUINA sobre linha com análise completa: UPDATE
  preservador (avança `janela_fim` e mantém a análise congelada inteira,
  `aguardando_desde` incluído) — senão um broadcast apagava o alarme do
  cliente esquecido.
- **O transcrito colapsa repetição EXATA do robô** (`botRepetidas`), mantendo
  a ocorrência mais RECENTE; o prompt declara a omissão. Humano (cliente ou
  equipe) nunca é colapsado — insistência é o sinal que o Radar caça —, nem a
  resposta do AGENTE DE IA, que é `bot` mas é conteúdo (rótulo "IA (Nome)",
  `porAgenteDeIa`).
- **A legenda (`como-funciona.tsx`) IMPORTA as constantes reais**
  (`JANELA_DIAS`, `THROTTLE_MS` — por isso em `ordenacao.ts`, client-safe —,
  `TETO_MENSAGENS`, `CICLO_MINUTOS`): número no dicionário mente.
- **`loadAiConfig` do Radar usa `requireActive: false`**: o Radar precisa da
  CREDENCIAL; `is_active` é o interruptor do assistente de conversa, e
  amarrar os dois calava a análise quando o auto-reply era desligado. ⚠️ E
  SEM `channelId` (1042): a configuração do Radar é do módulo, da conta
  inteira — pelo canal, um agente criado para uma conexão trocaria em
  silêncio a chave e o modelo do Radar ali (pino
  `src/lib/ia-chaves/chaves.chamadores.test.ts`).
- **O upsert em `cb_conversation_insights` funciona** porque o UNIQUE de
  `conversation_id` é TOTAL.

### Transcrição de áudio (943): função ÚNICA, Gemini-only, chave BYO

`transcrever.ts` (testado), `POST /api/cb/transcricao/[messageId]`, colunas
`transcricao_*` em `messages`. A MESMA função idempotente serve ao botão da
bolha e ao worker do Radar.

- **A transcrição NUNCA vai para `content_text`**: o que o cliente escreveu e o
  que a máquina ouviu são coisas diferentes, e sobrescrever é irreversível.
  Inegociável num CRM jurídico.
- ⚠️ **O cadeado `UPDATE…RETURNING` não é opcional**: no deploy há dois
  processos Node e o rate limit é por processo — só o banco impede pagar o
  mesmo áudio duas vezes. Teto de tentativas DENTRO do WHERE; travada de
  10 min recolhida pelo próprio cadeado; escrita final e falha com cerca
  (`transcricao_desde`).
- ⚠️ **Problema de CONFIGURAÇÃO devolve `recusada` SEM GRAVAR** (sem chave
  Gemini, chave ilegível, apagada, não-áudio, conta errada, áudio ainda sem
  `media_url` — janela de 2 min): gravar mataria o botão para sempre.
  `recusada` GRAVADA é só o irreversível da própria mensagem (URL relativa
  antiga, grande demais, `MAX_TOKENS`, tentativas esgotadas). ⚠️ A chave é a
  do GEMINI da conta (`lerChave(conta, 'gemini')`, 1042), sem agente nem
  canal. Erro de LEITURA da chave é `falhou` sem gravar, nunca "sem chave".
- ⚠️ **O modelo é FIXADO em `MODELO_TRANSCRICAO`**, separado do modelo de chat
  e de análise, e é UM para os dois chamadores, de propósito: não existe
  "transcrever de novo", quem chega primeiro fixa o modelo daquele áudio,
  nenhuma coluna registra qual escreveu, e o teto de 3 tentativas é
  compartilhado. Trocar de modelo ou provedor é mexer só neste módulo (plano B
  e medições no comentário da constante).
- ⚠️ **Não desligar o raciocínio** (`thinkingBudget: 0`): corta a conta e
  piora o erro (medido). ⚠️ **Trocar o modelo NÃO refaz o já transcrito** —
  quem trocar decide, na mesma passada, se limpa `transcricao*` do acervo.
- ⚠️ **`gemini-3.5-transcribe` NÃO serve pelo `generateContent`** (200 com
  `parts: [{}]` vazio, cobrando a entrada — vive noutra API). Tentar de novo
  pede outra superfície de API, não outra configuração.
- **O worker do Radar transcreve SÓ áudio do CLIENTE e SÓ nunca-tentado**
  (`transcricao_status` nulo), até 5 por análise, dentro do `deadlineMs` do
  ciclo. ⚠️ `falhou` fica para o botão HUMANO: a retentativa por ciclo queimava
  o teto de 3 e uma cota estourada carimbava `recusada` em tudo. Falha não
  derruba a análise; o texto entra com `PREFIXO_AUDIO` (contrato com a
  rubrica: teto de 2.000 caracteres por linha de áudio, truncamento declarado
  ao modelo).
- **A transcrição NÃO entra no índice da busca (929)**: busca por conteúdo de
  áudio é migration futura.
- O mime enviado é `messages.media_type` → `Content-Type` do Storage →
  `audio/ogg`, nesta ordem.

### Integrações é o lar das CHAVES e dos modelos por MÓDULO (946)

`montar.ts` (puro, testado), `GET /api/cb/integracoes/status` e
`integracoes-panel.tsx`. Agentes de IA ficou com o COMPORTAMENTO do agente de
conversa. Nasceu de um engano real: um único campo "Modelo" servia ao chat e ao
Radar.

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
  monta um cartão por provedor a partir da CHAVE (não de um agente) e lê só a
  linha padrão; a lista de canais aparece SÓ no Radar (o `radar_enabled`, de
  privacidade). O `PUT /api/cb/ia/chaves` cria a linha padrão (assistente
  DESLIGADO) quando a conta ainda não tem: sem ela o Radar ficaria em `sem_ia`
  com a chave cadastrada.
- ⚠️ **Só o Radar tem coluna própria (`ai_configs.radar_model`; NULL = herda
  `model`).** Transcrição e RAG têm constante no código (`MODELO_TRANSCRICAO`,
  `EMBEDDING_MODEL`), que entra em `montarCartoes` por PARÂMETRO, importada na
  rota — nunca redigitada no módulo puro nem no dicionário.
- ⚠️ **O modelo do Radar aparece em TRÊS lugares do worker** (a chamada a
  `generateStructured`, o `logAiUsage` e a coluna `model` do insight):
  resolver `config.radarModel ?? config.model` UMA vez; deixar um para trás
  atribui o custo ao modelo errado, justo onde o operador confere a separação.
- ⚠️ **`generateStructured` recebe o modelo por PARÂMETRO explícito**, nunca
  por `{...config, model}`: o spread não deixa rastro no tipo, e um merge que
  reescreva `structured.ts` devolveria o Radar ao modelo do chat sem quebrar o
  typecheck.
- ⚠️ **`POST /api/ai/config` reescreve a linha** (campo ausente vira NULL ou
  false): Integrações não passa por ele — chave por `/api/cb/ia/chaves`,
  modelo do Radar por `PATCH /api/cb/ia/radar` (só `radar_model`). Outra tela
  que volte ao POST ecoa o que não edita. Ele ignora `api_key` e recusa com
  `sem_chave`; o `DELETE` dele saiu (apagava a chave do Radar e da
  transcrição sem aviso) — apagar chave é em Integrações, com confirmação.
- ⚠️ **`radar_model` ausente do corpo = "não mexe"** (a convenção de
  `handoff_agent_id`): senão um save vindo de Agentes zeraria o modelo do Radar.
- ⚠️ **O modelo do Radar é validado no SAVE, contra o provedor** — inclusive
  quando só o PROVEDOR muda (senão o Radar falha de madrugada). O ping da aba
  testa só o modelo do CHAT: pingar o do Radar seria outra chamada paga a cada
  carga.
- ⚠️ **`?ping=0` existe porque cada ping é uma geração PAGA**: a tela carrega
  em dois tempos (config na hora, pings depois), o botão repete só os pings, e
  o `useEffect` tem guarda própria (`disparouRef`) contra o StrictMode dobrar
  as chamadas.
- **Nenhuma chave sai da rota de STATUS nem da de chaves, nem mascarada**: a falha volta como
  CÓDIGO, nunca como `AiError.message` (a OpenAI ecoa a chave). ⚠️ O SAVE do
  modelo do Radar devolve a mensagem do provedor (é ela que diz "modelo não
  encontrado") — EXCETO com `code === 'invalid_key'`, que vira texto genérico.
  Preservar a exceção.
- **Módulo sem uso ativo NÃO some**: aparece com o motivo (é quando o
  operador precisa descobrir que o Radar está desligado na conexão).
- **Radar exige `radar_enabled === true`; transcrição é Gemini-only; RAG é
  OpenAI-only** e aparece no cartão da OpenAI mesmo com outro provedor no
  chat.
- **`AI_PROVIDER_MODELS` é SUGESTÃO (`<datalist>`), nunca allow-list**: o campo
  aceita qualquer id e o servidor grava qualquer texto não vazio — ids de
  modelo mudam mais rápido que a lista.
- **Google Agenda é cartão "não conectado" de propósito** (a integração não
  existe; quando existir, é o ponto de conexão).

### Agentes de IA (1043, `src/lib/ia-agentes/`, `/agents`)

O plano vivo é `docs/PLANO-agentes-de-ia.md` (decisões D1–D23, E1–E14). Na
F1b os agentes são criados, testados no Playground e medidos. Desde a F2a
(1044) eles RESPONDEM cliente — ver "Quem responde", abaixo; a resposta
automática do assistente anterior (`dispatchInboundToAiReply`) saiu (E2), e o
✨ do rascunho segue nele.

- ⚠️⚠️ **"Agente" no código é PESSOA** (`assigned_agent_id`, o papel `agent`).
  Agente de IA leva `ia_agente` no nome (`cb_ia_agentes`, `ia_agente_id`).
- ⚠️ **`cb_ia_agentes` só dá SELECT ao ADMINISTRADOR** (D14, forma da 1032) e
  nenhuma escrita ao navegador: `src/lib/ia-agentes/repo.ts` escreve com o
  cliente de serviço, com a conta em toda consulta e os ids das listas
  conferidos contra a conta (arrays sem FK). Nome e id para quem não é admin
  (bolha, faixa, `descreverPasso`) saem por rota, nunca pela tabela.
- ⚠️ **`conexoes` vazio = NENHUMA conexão**, nunca "todas" (a exceção do
  `radar_enabled`: dado de cliente indo a provedor externo). Apagar conexão a
  tira dos agentes por gatilho.
- **Apagar é ARQUIVAR**: o uso antigo guarda o nome CONGELADO
  (`ai_usage_log.ia_agente_nome`); o nome é único só entre os não arquivados.
- **Instruções e regras (D23) em campos separados**; o pedido ao modelo sai
  de UMA função pura (`montarPedidoDoAgente`): texto-base em inglês (é para o
  modelo; ele responde no idioma do cliente), data e hora no fuso do
  escritório, instruções, regras numeradas, base de conhecimento. O
  Playground usa a mesma montagem — ele testa o que a produção vai mandar.
- **O gasto do Playground é `agente_teste`** (D13), separado de `agente`. A
  soma do uso é no BANCO (`cb_ia_uso`): a rota antiga lia linha a linha e o
  PostgREST cortava em 1000.
- ⚠️ **Custo em R$ (D21) é ESTIMATIVA**: preço de lista em US$ com VIGÊNCIA
  por linha (`precos.ts` — mudança de preço entra como linha nova, senão o
  histórico é recalculado) × a cotação de hoje (`ai_configs.cotacao_dolar`,
  rota própria). Modelo fora da tabela é "sem preço", NUNCA zero; a saída
  cobrada do Gemini é `max(saída, total − entrada)` (os pensamentos).

### Quem responde (F2a, 1044): a regra, a fila e o turno

`quem-responde.ts` (puro), `entrada.ts` (a porta das DUAS ingestões),
`fila.ts`, `turno.ts`, `rede.ts` (no topo de `/api/automations/cron`).

- ⚠️⚠️ **A ingestão só ENFILEIRA** (RPC `cb_ia_enfileirar_turno`, pendente
  POR CONEXÃO; a rajada de 8 s empurra o mesmo pendente). Quem executa é o
  disparo em `after()` depois da espera e, como rede, o cron. Nada segura a
  ingestão: o `message.received` e o resto do lote vêm atrás dela.
- ⚠️⚠️ **A ordem das regras É a regra** (`quemResponde`): robô consumiu →
  automação FALOU (`ResultadoDoDisparo.falou`, somado em TODOS os gatilhos da
  mensagem — E4; somam também a fala do `tag_added` aninhado no `add_tag` e a
  ADIADA do funil: `move_deal_stage`/`create_deal` que muda ou cria o card
  numa etapa que alguma automação ligada escuta, `etapaTemQuemFale`) → pausada →
  agente ATIVO (ligado, não arquivado, dono da conexão) → ENTRADA só SEM
  agente ativo, conversa sem resposta de gente (D16) e contato criado depois
  de a entrada ser ligada (P8/E3, `ia_agente_entrada_desde`). Agente ativo que
  não responde aqui NÃO é substituído pela entrada — desligar é freio.
- ⚠️⚠️ **UMA régua de conteúdo, `abreTurno`, na entrada E no turno** (E9/E10):
  figurinha (gravada `image` + `image/webp` — a Evolution o grava já no
  insert), localização, botão e texto sem nada visível não abrem turno, e por
  isso não descartam o turno em curso. Duas réguas = texto + figurinha sem
  resposta nenhuma.
- ⚠️ **Robô ou automação que respondeu cala o agente nas duas pontas**: a
  entrada descarta o PENDENTE da conexão (`descartarPendente`, um UPDATE sem
  leitura) e o turno descarta se há `bot` sem `ia_agente_id` gravado depois
  do gatilho, na MESMA conexão (D4) — o toque em botão na rajada daria duas
  respostas.
- ⚠️⚠️ **O turno NUNCA reenvia.** Erro depois da primeira chamada ao provedor
  (`antesDoProvedor`) que não seja recusa comprovada (4xx) é `incerto` e
  transfere para gente; o recolhedor (`rede.ts`) decide pelo que o turno
  carimbou (`enviando_desde`, `mensagem_enviada_id`), nunca re-executa. Dono e
  contato são conferidos ANTES da vaga do teto (`claim_ai_reply_slot`).
- ⚠️ **Falha de CONFIGURAÇÃO não transfere** (E8): chave, modelo, provedor
  fora do ar → `falhou`, e o alerta de atraso chama a equipe. Transferem: o
  sentinela, a resposta vazia, o teto, o áudio que não se ouve e o envio
  incerto — pausa `'transferencia'`, destino só quando ninguém é responsável
  (e é membro), e anotação com autor sem usuário ("IA · <agente>", no idioma
  da instalação). ⚠️ NUNCA por cima de pausa que já existe
  (`transferirParaGente` cerca `ai_autoreply_disabled = false`; zero linhas =
  sem nota nem atribuição, turno `pausado_no_meio`): a de gente é a que a
  automação retoma (D17).
- ⚠️ **Cerca de posse em TODA escrita no turno** (`status = 'rodando'` e o
  `rodando_desde` do próprio claim) — MENOS o id do provedor
  (`gravarIdEnviado`, cercado por turno e id nulo): o eco precisa dele mesmo
  com o turno recolhido, e ele não mexe no status.
- ⚠️ **Só o turno passa `iaAgenteId` ao `engineSendText`** (pino
  default-deny): a 972 (redefinida na 1044) conta `bot` COM `ia_agente_id`
  como "respondido" e apaga o alerta de atraso — fluxo ou automação que o
  passassem calariam o alerta de todo cliente esperando.
- ⚠️ **O contexto é SÓ da conexão do turno** (D4), sem as apagadas; áudio
  pela transcrição (o turno reagenda até 2 min contados de `gravada_em`),
  mídia como descrição (`contexto.ts`).
- ⚠️ **"Atribuir agente" (passo e entrada) decide a D17 NO BANCO**
  (`cb_atribuir_agente_de_ia`, conversa travada), relê o agente (ligado, não
  arquivado, dono da conexão do disparo) e nunca toca `assigned_agent_id`.
- **Pausa por gente é GATILHO** (1044), com o eco do próprio turno excluído
  pelo `mensagem_enviada_id`. O eco da Evolution que chega antes do INSERT é
  gravado COMO a resposta do agente por `eco.ts` — o SEGUNDO escritor de
  `messages` com `ia_agente_id`, além do envio; nenhum motor (pino
  `eco.test.ts`).

### Assistente e provedores (`src/lib/ai/`)

- ⚠️ **O "digitando…" (#527) sai pelo MESMO canal da resposta**
  (`mostrarDigitando`, `src/lib/ai/digitando.ts`): a resolução de
  `engineSendText` com o canal da entrada, só em canal Meta e só com id
  `wamid.` (o turno relê o `message_id` do gatilho; a Evolution não o tem). Nunca as
  credenciais da CONTA, como no original. Melhor esforço, sem `await`: nunca
  lança nem segura a resposta, e o log passa por `semTokenDaMeta`. ⚠️ A Meta
  marca a mensagem do cliente como LIDA junto (decisão do operador, P6).
  Chamado pelo TURNO do agente (`turno.ts`) depois de todas as conferências,
  logo antes de gerar a resposta.
- **`generateStructured` (`structured.ts`) é separado de `generateReply` DE
  PROPÓSITO**: o turno do agente e o rascunho não podem herdar regressão do
  caminho de análise. Não fundir.
- **Gemini é o terceiro provedor** (o upstream conhece só OpenAI e Anthropic;
  `structured.ts` e `providers/gemini.ts` são nossos): chave SEMPRE no
  cabeçalho `x-goog-api-key`, nunca `?key=` (vaza em log de proxy); em
  produção, chave do tier PAGO (a faixa gratuita pode usar os dados enviados).
  Embeddings/RAG exigem chave OpenAI (modelo fixo, `vector(1536)`).
- **Modo ou provedor novo exige migration no CHECK** de `ai_usage_log`
  (`mode` tem `'radar'`, `provider` tem `'gemini'`): senão `logAiUsage` engole
  o erro e o custo some da aba Uso.
- ⚠️ **`ai_configs` tem índices únicos PARCIAIS (903: global + por canal).**
  `.upsert(..., { onConflict })` não serve (use lookup + insert/update), e
  `.maybeSingle()` só por `account_id` estoura quando existir uma segunda
  linha — escopar o canal, ou `.is('channel_id', null)` para o padrão da
  conta.
- Agente por canal, interruptor, RAG por canal, `radarModel` em
  `CONFIG_COLUMNS` e a opção Gemini (`ai-config.tsx`, `/api/ai/config`) são
  trechos NOSSOS em arquivos do upstream (`docs/MERGE-UPSTREAM.md`).
