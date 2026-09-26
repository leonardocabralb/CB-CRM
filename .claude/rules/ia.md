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
---

# IA (Radar, transcrição, Integrações, assistente) — regras

Vale no Radar de Atendimento (`src/lib/cb-radar/`, `/radar`, `/api/cb/radar`,
`use-radar`), na transcrição de áudio (`src/lib/transcricao/`), no assistente e
nos provedores (`src/lib/ai/`, `/api/ai`, Agentes de IA) e em Configurações →
Integrações (`montar.ts`, `/api/cb/integracoes`). A chave de cada provedor é
da conta (BYO), cifrada com `ENCRYPTION_KEY`. O texto antigo, com a história,
está em `git show f5879b3f:CLAUDE.md`; a do Radar também em
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
  = 24 h CORRIDAS decide se abre cartão; `LIMIAR_PENDENCIA_SEG` = 30 min
  ÚTEIS decide só se a etiqueta aparece (em horas úteis, "24 h" viraria dias
  de calendário e o alarme chegaria tarde para quem escreveu na sexta).
  ⚠️ No vão entre as duas o cartão ficava MUDO: quando a régua útil não
  alcança o piso, a etiqueta cai para o INSTANTE (`semRespostaDesde`). Mexer
  numa constante sem olhar esse ramo devolve o cartão mudo.
- ⚠️ **A pendência é conferida AO VIVO na tela** (`respostasDepoisDaPendencia`,
  em `use-radar.ts`): `aguardando_desde` é o retrato da última análise, e o
  cartão mostrava "aguardando há 26 h" sobre cliente já atendido. A
  conferência falha para o lado do ALARME: erro de rede mantém o cartão, e
  lista truncada continua valendo (a consulta é DESC — o teto só omite
  resposta antiga). Mensagem apagada não conta como resposta.
- ⚠️⚠️ **"Resposta de gente" = `sender_id` preenchido OU `from_device = true`.**
  O celular pareado grava `from_device` sem `sender_id`, e é por onde o
  escritório mais responde. Não fecham a pendência: broadcast, automação,
  fluxo e a AGENDADA — que sai COM `sender_id` (o de quem a criou) e é
  excluída, no worker e na conferência ao vivo, por
  `cb_scheduled_messages.message_id`. ⚠️ `houveHumanoNaJanela` do worker usa
  só `sender_id` de propósito (decide se preserva a análise congelada): não
  unificar as duas réguas sem entender a pergunta de cada uma.
- ⚠️ **Análise `failed` aparece INDEPENDENTE de gatilho**: com os defaults do
  schema ela sumiria, e o vazio afirmaria "nenhum sinal aberto" sobre conversa
  que o Radar não conseguiu ler. A consulta de resgate filtra
  `estado = 'aberto'` (pino `use-radar.resgate.test.ts`).
- ⚠️ **O painel recarrega a cada 2 min com a aba visível** (o tique de 1 min
  só re-renderiza): é o que descobre que um colega respondeu.
- ⚠️ **Insatisfação exige evidência recente — 2 dias de expediente, em TEMPO
  ÚTIL** (`JANELA_INSATISFACAO_UTIL_SEG`, via `segundosUteisEntre`): em
  corridas, a reclamação de sexta expirava no domingo, antes de alguém abrir o
  painel; "48 h úteis" inflaria para ~6 dias corridos. As réguas de escrita e
  de leitura SE SOMAM (~4 dias úteis, por desenho). ⚠️ A âncora é o INSTANTE
  DA ANÁLISE (`agoraMs`, 3º argumento de `interpretarAnalise`), não a última
  linha do transcrito — senão, na conversa que morre depois da resposta, o
  sinal ficava aceso para sempre. Há pino dos dois lados.
- ⚠️ **Não existe aba "Todos"** (decisão do operador). Sem ela, um descarte
  errado esconderia o alarme para sempre, e as saídas são duas: o "Desfazer"
  do toast e o cartão que FICA na lista enquanto a tela está aberta, apagado e
  com "Reabrir" (`mexidasAqui`, em `radar/page.tsx`).
- ⚠️ **Falso NEGATIVO da IA não tem botão — decisão fechada, não pendência.**
  Reanalisar o mesmo transcrito tende a repetir o veredito (uma geração paga
  para nada), e os casos em que a reanálise muda algo já têm caminho (`failed`
  com botão, `sem_ia` com aviso, mensagem nova reanalisa sozinha). Quem
  reabrir isto começa por um "reanalisar tudo" de conta, nunca pela aba
  "Todos".
- **O painel aplica a MESMA régua do worker na leitura**: esconde insight fora
  da janela de 7 dias e de canal com `radar_enabled` desligado (desligar o
  canal some com as análises antigas dele). ⚠️ Exceção: **pendência aberta não
  expira** — conversa parada além da janela com `aguardando_desde` e
  `estado='aberto'` FICA (selo "parada há mais de N dias"), mas os cartões
  ignoram urgência, insatisfação e nota dessas linhas (`foraDaJanela`).

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
- ⚠️ **Feedback por atendente exige AUTORIA, não só evidência**: a observação
  só passa se citar linha ESCRITA pelo atendente nomeado (o transcrito rotula
  "Equipe (Nome)"; `LinhaDoTranscrito.autor` é o que o parser confere) —
  senão o cliente que digita "a Ana demorou" viraria auditoria da Ana. Nome
  não resolvido vira "Equipe" e a IA não avalia. Na tela, só para
  `useCan('manage-members')`. ⚠️ **O gate é SÓ de renderização**: o dado
  viaja em `detalhes.analise` e qualquer membro o lê. A barreira real é
  PENDÊNCIA registrada, com a receita, em `docs/PLANO-radar-de-atendimento.md`
  ("Fora do MVP").
- **Tempos em segundos ÚTEIS com fuso FIXO -03:00**: `horario-comercial.ts` é
  o único arquivo a mudar se o horário de verão voltar; intervalo negativo
  (relógio do aparelho × `now()` do banco) vira zero lá dentro.
- ⚠️ **Ciclo de vida do sinal, três regras assimétricas**: `tratado` reabre SÓ
  com mensagem DO CLIENTE posterior ao `estado_em` (reset por UPDATE
  condicional separado, para um clique dado durante a análise não ser
  atropelado); `descartado` NUNCA reabre sozinho (a reanálise repetiria o
  falso positivo); `aberto` fica. ⚠️ Exceção estreita: descarte sobre linha
  `failed` que NUNCA teve análise concluída (`descarteFoiSobreFalha`,
  `analisado_em` nulo no claim) reabre na primeira análise boa — ali se
  descartou o aviso de falha, não um veredito. Não remover como
  "inconsistência".
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
  a ocorrência mais RECENTE; o prompt declara a omissão; humano (cliente ou
  equipe) nunca é colapsado — insistência é o sinal que o Radar caça.
- **A legenda da tela (`como-funciona.tsx`) IMPORTA as constantes reais**
  (`JANELA_DIAS`/`THROTTLE_MS` de `ordenacao.ts`, `TETO_MENSAGENS`,
  `CICLO_MINUTOS`) — por isso `THROTTLE_MS` mora em `ordenacao.ts`
  (client-safe). Número digitado no dicionário mente na primeira mudança.
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
  Gemini, chave ilegível, mensagem apagada, não-áudio, conta errada, áudio
  recém-chegado ainda sem `media_url` — janela de 2 min): gravar o estado
  terminal mataria o botão para sempre por um problema passageiro. `recusada`
  GRAVADA é só para o irreversível da própria mensagem (URL relativa antiga,
  áudio grande demais, `MAX_TOKENS`, tentativas esgotadas). ⚠️ A chave é a do
  GEMINI da conta (`lerChave(conta, 'gemini')`, 1042), direto — não depende de
  agente nem do canal (um agente de outro provedor na conexão fazia recusar
  tudo). Erro de LEITURA da chave é `falhou` sem gravar, nunca "sem chave".
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
  nunca por conexão (decisão do operador, 28/08/2026, mantida na D1 do
  `docs/PLANO-agentes-de-ia.md`). A tabela é FECHADA ao navegador (RLS sem
  policy): só `src/lib/ia-chaves/repo.ts` a toca, com o cliente de SERVIÇO (a
  sessão do usuário leria zero linhas sem erro — "sem chave" com cara de
  certo); pino `chaves.chamadores.test.ts`. A de embeddings é a chave da
  OpenAI da conta, MENOS a que a OpenAI recusou para embeddings ao ser
  gravada (`serve_embeddings = false`: chave de projeto restrita), e a chave
  DEDICADA herdada da 1042 (`cb_ia_chaves.embeddings_api_key`) vence —
  `lerChaveDeEmbeddings`. `ai_configs.api_key`/`embeddings_api_key` ficaram só
  para o app anterior poder voltar atrás: nada as LÊ, e `gravarChave` as
  ESPELHA (sem isso a volta atrás traria a chave velha, quase sempre revogada
  na troca). A chave nova é conferida em CADA modelo em uso (assistente e
  Radar); recusada num que a atual alcança, nada é trocado
  (`modelo_em_uso_recusado`).
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
- ⚠️ **`POST /api/ai/config` reescreve a linha** (`system_prompt` ausente vira
  NULL, `is_active` ausente vira false): por isso Integrações NÃO passa mais
  por ele — a chave vai por `/api/cb/ia/chaves` e o modelo do Radar por
  `PATCH /api/cb/ia/radar`, que grava SÓ `radar_model`. Quem voltar a usar o
  POST de outra tela ecoa os campos que não edita. O POST ignora `api_key` no
  corpo e recusa com `sem_chave` quando o provedor não tem chave; o `DELETE`
  dele foi REMOVIDO (apagava, sem aviso, a chave do Radar e da transcrição).
  Apagar chave é em Integrações, com confirmação que diz o que para.
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
- **Módulo sem uso ativo NÃO some da lista**: aparece marcado com o motivo —
  é quando o operador mais precisa descobrir que o Radar está desligado na
  conexão.
- **Radar exige `radar_enabled === true`; transcrição é Gemini-only; RAG é
  OpenAI-only** e aparece no cartão da OpenAI mesmo com outro provedor no
  chat.
- **`AI_PROVIDER_MODELS` é SUGESTÃO (`<datalist>`), nunca allow-list**: o campo
  aceita qualquer id e o servidor grava qualquer texto não vazio — ids de
  modelo mudam mais rápido que a lista.
- **Google Agenda é cartão "não conectado" de propósito**: a integração não
  existe (as colunas `google_*` da 945 nascem nulas); quando existir, é este
  cartão que vira o ponto de conexão.

### Assistente e provedores (`src/lib/ai/`)

- ⚠️ **O "digitando…" (#527) sai pelo MESMO canal da resposta**
  (`mostrarDigitando`, `src/lib/ai/digitando.ts`): a resolução de
  `engineSendText` com o canal da entrada, só em canal Meta e só com id
  `wamid.` (o webhook da Meta o passa; a Evolution não tem o recurso). Nunca as
  credenciais da CONTA, como no original. Melhor esforço, sem `await`: nunca
  lança nem segura a resposta, e o log passa por `semTokenDaMeta`. ⚠️ A Meta
  marca a mensagem do cliente como LIDA junto (decisão do operador, P6).
  Chamado depois de TODOS os portões, antes de gerar a resposta.
- **`generateStructured` (`structured.ts`) é separado de `generateReply` DE
  PROPÓSITO**: o auto-reply e o rascunho não podem herdar regressão do caminho
  de análise. Não fundir.
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
- Agente por canal, interruptor, RAG por canal e o `radarModel` em
  `CONFIG_COLUMNS` são trechos NOSSOS em arquivos do upstream (lista completa
  em `docs/MERGE-UPSTREAM.md`); a opção Gemini no seletor e na validação do
  provedor (`ai-config.tsx`, `/api/ai/config`) também.
