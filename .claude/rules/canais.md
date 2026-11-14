---
paths:
  - "src/lib/cb-channels/**"
  - "src/components/channels/**"
  - "src/hooks/use-channels*"
  - "src/hooks/use-channel-health*"
  - "src/components/settings/cb-channels-panel.tsx"
  - "src/components/settings/dependencias-da-conexao.tsx"
  - "src/app/api/cb/channels/**"
---

# Conexões (canais): UI e saúde — regras

Vale ao mexer em `src/lib/cb-channels/`, nos componentes e hooks de canal, no painel de Conexões e nas rotas `/api/cb/channels`. Qual número nesta conversa, cor do canal, janela de 24h e ampulheta da lista: `.claude/rules/canal-na-conversa.md`. Predicados de transporte: `.claude/rules/instagram.md`. Carimbo de canal e roteamento para o funil na entrada: `.claude/rules/ingestao.md`. Nome da instância Evolution: `.claude/rules/whatsapp-evolution.md`. Canal da Meta no envio: `.claude/rules/whatsapp-envio.md`.

### UI de canal: peças próprias, prefira reusá-las

`src/hooks/use-channels.ts`, `src/lib/cb-channels/display.ts` (puro) e `src/components/channels/` (`ChannelBadge`, `ChannelCell`, `ChannelScopeBadge`, `ChannelSelect`, `ChannelMultiSelect`, `ChannelFilter`).

- **Escopo vazio = TODOS os canais, nunca "nenhum"** — igual ao motor (`channelInScope`, `findEntryFlow`). Tela que diz "nenhum" onde o motor lê "todos" faz o operador desativar a regra errada.
- **Seletor some com menos de 2 canais:** numa conta de um número ele não decide nada.
- **Registro sem `channel_id` mostra travessão, nunca o canal padrão:** registro anterior à 903 pode ter vindo de outro número.
- **Filtro não esconde o irrestrito:** automação sem escopo dispara em todos os números e continua visível sob qualquer filtro.
- ⚠️ **`useChannels` tem DUAS metades no erro:** `channels: []`, cosmético para quem usa a lista como rótulo ou filtro; e `loading`/`falhou`, para quem converte a lista numa AFIRMAÇÃO (janela de 24h, "sem conexão" da nova conversa, recorte do Radar) — ali "não consegui perguntar" e "a conta não tem canal" são respostas opostas. O 200 com `{ channels: [], unavailable: true }` é FALHA.
- ⚠️ **Coluna nova de configuração entra em `CB_CHANNEL_SAFE_COLUMNS` (`repo.ts`) e na allowlist do PATCH**, senão salva e some no reload.
- ⚠️ **`radar_enabled` nasce FALSE e é `=== true` no PATCH** — a exceção DELIBERADA a "vazio = todos": o Radar manda conversa de cliente a um provedor de IA externo, e há canal de uso PESSOAL na conta. Não "corrigir" para a convenção.
- ⚠️ **O canal padrão recusa conexão do Instagram** (`set-default.ts`): o padrão responde conversa sem canal e alimenta o espelho `whatsapp_config`.
- **`channelsUsingPipeline`/`channelsUsingStage` (`display.ts`) dizem que conexão depende de qual funil ou etapa.** Apagar funil ou etapa zera `default_pipeline_id`/`default_stage_id` por SET NULL e o roteamento para em silêncio: caminho novo de exclusão avisa.
- ⚠️ **O DELETE de conexão (`/api/cb/channels/[id]`) barra ANTES de qualquer passo destrutivo quando há agendada na FILA** (`pending`/`sending`, 409 `scheduled_pending`): a FK da 925 é RESTRICT, e estourando no fim a instância da Evolution já teria sido destruída e o padrão promovido. O acervo (`sent`/`failed`) é apagado SÓ com o filtro de status — a agendada criada no meio estoura a RESTRICT em vez de sumir. Apagar a conexão PADRÃO exige sucessor NOMEADO no corpo (`promote_to`, escolhido na tela, e de WhatsApp): promover em silêncio faria o escritório disparar por outro número sem pedir. Sem outro WhatsApp, 409 `last_channel` (quem clica está tentando consertar — "Reparear").
- **`cb_channels` está na publicação realtime com LISTA FIXA de colunas** (909): coluna nova não viaja no payload. `use-channel-health` assina e só refaz a sonda; quem precisar LER coluna nova do payload reescreve a entrada na publicação.

### Trocar o número: "Reparear" na MESMA conexão, nunca remover e recriar (03/10/2026)

Decisão do operador. Tudo aponta para a CONEXÃO (`cb_channels.id`), não para o número: escopo e passos das automações, robôs, agentes de IA, filtros salvos, esperas, conversas, funil de entrada, padrão da conta. O "Reparear" (`/restart` → `/connect`) pareia a mesma instância com o chip novo e grava o `display_phone` novo — nada precisa ser refeito.

- ⚠️ **Na Meta não há QR: número novo = `phone_number_id` novo = conexão NOVA** (o PATCH só renomeia e roteia; o POST só atualiza a linha com o MESMO `phone_number_id`). O que dependia da antiga se refaz à mão — a tela de remover lista o quê. Modelos são da WABA: outra WABA, modelos aprovados de novo.
- ⚠️⚠️ **O número novo chega por DUAS vias, e as duas gravam** (`troca-de-numero.ts`): a `/connect`, pela linha de `fetchInstances` (`numeroDoPareamento`), e o aviso `connection.update` com o `wuid` (`registrarNumeroDoAviso`, condição no WHERE). A Evolution responde "aberta" ANTES de gravar o número do pareamento novo (busca a foto de perfil no meio): nessa janela o `ownerJid` é o do chip ANTERIOR, com `connectionStatus` ainda não `open` — a `/connect` então NÃO grava o número e responde `numeroPendente` (a tela consulta de novo, com teto de 6). Ler sem conferir o status gravava o número velho, e a variável do número seguia mandando o velho.
- ⚠️ **`own_lid` é aprendido UMA vez, sobre nulo** (`aprenderNossoLid`, sincronização dos grupos). As duas vias o ZERAM quando o número muda, senão a ligação do aparelho novo deixa de ser "do escritório" e a menção em grupo não acende. A `/connect` leva `numeroAnterior` (só quando havia um e mudou) e a tela confirma a troca — também no "Ressincronizar".
- **Número no TEXTO da automação: `{{channel.<id com _>.phone}}`** (`automacoes-variaveis.md`), nunca escrito à mão — acompanha a troca de chip.
- ⚠️ **A tela de remover lista o que depende, com nome** (`GET /api/cb/channels/[id]/dependencias`, classificação em `dependencias.ts`, `ListaDeDependencias`). Lê em SERVICE ROLE cercada pela conta: filtros salvos são de cada membro e a fila das automações é service-role only — pela sessão, voltariam zero com cara de certo. Leitura que falha é 500 e a tela diz "não deu para conferir", nunca "nada depende". O botão "Remover" fica DESATIVADO enquanto a lista carrega (`useDependenciasDaConexao`, no painel) e volta na falha — conexão quebrada não fica sem saída. Execução em andamento = `pending` E `running` (o cron reivindica antes de retomar). `citaAConexao` acha o id no `step_config`/config do nó nas DUAS formas (com `-` e com `_`, a da variável). Gatilho novo que mexe em referência à conexão no DELETE: a classificação muda junto.
- ⚠️ **Robô restrito à conexão apagada vai a `draft` (1077, BEFORE DELETE)**: o SET NULL da FK o deixaria CURINGA (`channel_id` nulo = todo número em `findEntryFlow`). Num AFTER, o SET NULL já teria rodado e o robô não seria achado.
- **Grupos são do NÚMERO**: o chip novo não está nos grupos do velho; `cb_groups` da conexão param de receber. Nenhum código resolve isso.

### Parear e Reparear sem sessão duplicada (06/10/2026)

`evolution-admin.ts` (`channelConnectionState`, `repairChannelPairing`), as
rotas `/connect` e `/restart` e o laço do QR no painel. Por que a Evolution
duplica a sessão: `.claude/rules/whatsapp-evolution.md`, "Pareamento".

- ⚠️⚠️ **QR só com a instância FECHADA CONFIRMADA**: lida `close`, espera
  `ESPERA_FECHADA_MS` (6 s), lê de novo, e só então `client.connect()`. Um
  `close` de passagem é a Evolution reconectando sozinha (3 s), e o connect ali
  abria o segundo socket. `connecting` → connect só devolve o QR guardado (sem
  socket). A espera ESTREITA a janela; a garantia é o patch da imagem.
- ⚠️ **Uma operação de estado/QR por instância** (`umaPorInstancia`, Map no
  módulo): duas abas ou dois admins recebem a mesma promessa. É por RÉPLICA
  (`replicas: 1`). O Reparear espera a que estiver em curso antes do logout.
- ⚠️⚠️ **Logout que não pegou + connect = sessão duplicada.** O Reparear lê o
  estado quando o logout lança (`open` → `SessaoAindaDePe`) e, depois do
  logout, espera `ESPERA_FECHADA_MS` e lê de novo (`open` = a sessão antiga
  voltou → `LogoutNaoPegou`): 502, nada gravado, sem connect. Falha DEPOIS do
  logout (`FalhaDepoisDoLogout`) grava `connecting` e abre o diálogo sem QR —
  o número já caiu. Dois Reparear simultâneos dividem a mesma promessa
  (`reparoEmCurso`): o segundo logout derrubaria o pareamento do primeiro.
- ⚠️ **Na imagem SEM o 3º patch (o rollback), o diálogo é quem termina o
  Reparear** (o `isDeleting` impede o 515 de reconectar): fechá-lo antes de
  "Número conectado" deixa a conexão parada em `close` com credencial válida. E
  o Reparear de instância que a Evolution já dá como `close` não desloga e pode
  religar o chip antigo. A imagem em produção desde 08/10/2026 tem o patch
  (`docs/INFRA-VPS.md` §9). Provado em produção em 06/10: o "Parear" de uma
  conexão sem credencial, pelo CRM corrigido, abriu um socket só (515 →
  reconexão em 3 s → `open`).
- ⚠️ **O laço do QR é `setTimeout` ENCADEADO, nunca `setInterval`**: a rota leva
  mais de 5 s com a instância fechada, e com intervalo duas consultas corriam
  juntas. Pino: `cb-channels-panel.laco-do-qr.test.ts`.
- **O webhook é reaplicado UMA vez por abertura do diálogo** (corpo
  `{ reaplicarWebhook }` da `/connect`; só `false` pula — sem corpo reaplica,
  que é a tela aberta antes do deploy) e no "Ressincronizar".
- ⚠️ **`detail_pairing` é "conectando ao WhatsApp" e `status_connecting` é
  "Conectando", nunca "aguardando o QR"/"aguardando pareamento"**:
  `connecting` também é a reconexão sozinha com a credencial válida, e o texto
  antigo levava o operador a abrir o QR (e a duplicar a sessão) numa conexão
  que funcionava.
- `provisionEvolutionInstance` (criar ou adotar) ainda chama connect direto
  fora de `open`: instância nova não tem credencial, mas adotar uma existente
  pode cair na janela — se o caminho de adoção voltar a ser usado, passar pela
  fechada confirmada.

### Saúde das conexões: TRÊS eixos, e o terceiro é "está entregando EM DIA?" (1002)

`src/lib/cb-channels/atraso-de-entrega.ts` (puro + `registrarEntrega`), as colunas `entrega_carimbo_em`/`entrega_recebida_em`, o ramo `lagging` de `toneFor` e a linha âmbar no popover do cabeçalho. Os dois eixos antigos (o estado do provedor × o frescor dessa informação) respondem "está DE PÉ?"; uma conexão `open` e fresca pode entregar com meia hora de atraso.

- ⚠️⚠️ **A fronteira SÓ AVANÇA:** conexão represada drena o backlog FORA DE ORDEM; guardando "a última que chegou", a mensagem antiga apagaria o alarme que a nova acendeu e a tela piscaria. A cerca é do BANCO (`entrega_carimbo_em.lt.<novo>` no UPDATE), nunca ler-então-escrever: o webhook trabalha em `after()`, e duas mensagens do mesmo canal correm em paralelo.
- ⚠️⚠️ **TODA condição de gravação vive no WHERE, e não pode depender do VALOR LIDO.** O espaçamento é predicado SQL; a transição que APAGA o alarme dispensa o espaçamento com `entrega_carimbo_em < corteDoAlarme(agora)` — coluna contra CONSTANTE. Sem cerca, concorrentes escrevem todos; compare-and-swap do valor lido PERDE a amostra saudável que corre com uma atrasada, e o alarme fica aceso até expirar. "recebida − carimbo > limiar" seria comparação entre duas colunas, que o filtro do PostgREST não faz; como alarme aceso exige medição fresca, `agora − carimbo` diz o mesmo. O SELECT anterior só decide se vale tentar; quem serializa é o banco.
- ⚠️ **`atrasoSeg` NULO é "não sei", nunca zero.** Nada é retroativo: `messages.created_at` guarda o carimbo do WhatsApp, e o instante da gravação não existia no acervo.
- ⚠️⚠️ **A medição TEM VALIDADE (1 h, `VALIDADE_DA_MEDICAO_MS`)**, senão uma amostra atrasada seguida de silêncio manteria `lagging` para sempre. `alarmeDeAtraso` (atraso E frescor) é o que a tela e o `toneFor` usam; `entregaAtrasada` fala da AMOSTRA, não do presente — confundir as duas é o defeito. Este eixo NÃO detecta a conexão que para de receber de vez (a medição envelhece e o alarme apaga): o `sem_recibo` (abaixo) a vê quando há envio do CRM; sem envio, "não chega mensagem há tempo demais" é outro alarme.
- ⚠️⚠️ **A TELA lê `detail === 'lagging'`, nunca reavalia a régua:** recalcular no render precisa de `Date.now()` (o React Compiler reprova), e uma segunda cópia discordaria do glifo ao lado.
- ⚠️⚠️ **`lagging` NÃO impede ENVIAR:** `vivaParaEnviar` (`viva-para-enviar.ts`, UMA régua para a cobrança do Asaas e a troca de número da conversa) aceita `ok` e `ENVIA_MESMO_EM_AMARELO` = {`webhook`, `lagging`} — os dois descrevem a ENTRADA; sem isso, um atraso de entrega adiava em silêncio as cobranças do dia. `pairing`/`stale`/`lastError` ficam fora. Amarelo novo: decidir por escrito de que lado fica.
- ⚠️ **O espaçamento de 1 min entre gravações é pelo REALTIME:** todo UPDATE em `cb_channels` faz `use-channel-health` refazer a sonda, e um backlog drenando sondaria dezenas de vezes por minuto.
- ⚠️ **Carimbo no FUTURO além de 2 min é recusado** (`TOLERANCIA_DE_RELOGIO_SEG`): o relógio do aparelho torto travaria a fronteira à frente e mascararia atraso real.
- ⚠️⚠️ **GRUPO fica de fora:** em grupo o `channel_id` gravado é o do webhook que CHEGOU PRIMEIRO; creditar por ali daria sempre ao número mais rápido a medição e deixaria de medir o lento.
- ⚠️ **São QUATRO call sites de `registrarEntrega`**, um por caminho de ingestão (`persistInboundMessage`, `persistDeviceMessage`, webhook da Meta, `instagram/persistir.ts`); o celular pareado conta. Quinto caminho de ingestão repete a chamada, senão a conexão deixa de ser medida sem erro nenhum.
- ⚠️ **`registrarEntrega` NUNCA lança** (`catch` para o que o supabase-js lança, leitura do `error` para o que ele devolve): é o que torna seguro o `await` na ingestão.
- **O limiar é 5 min, folgado de propósito:** o atraso normal é de segundos e os episódios, de dezenas de minutos — o limiar só precisa não dar falso positivo.
- ⚠️ **`useChannelHealth` expõe `falhou`:** o zero de uma sonda que não respondeu não autoriza afirmar "tudo em ordem"; o `unavailable: true` entra em `falhou`.
- ⚠️⚠️ **`useChannelHealth` é UMA sonda por ABA** (estado no módulo, `useSyncExternalStore`; pino `use-channel-health.test.ts`), e a RAJADA do realtime vira uma busca (`AGRUPAR_REALTIME_MS`): a sonda grava uma linha por conexão, e cada linha é um evento. Com uma instância por leitor (cabeçalho + fio, desde a trava da conexão fora do ar, `canal-na-conversa.md`), medido: 18 buscas em 23 s contra o teto de 40/min da rota; depois, 4 em 60 s. Leitor novo usa o hook, nunca um `fetch` próprio da rota. O canal realtime leva a GERAÇÃO no nome (religar com o nome antigo derruba a página).
- ⚠️ **Meta: só a RESPOSTA sobre o número ou o token prova queda** (`estadoDaFalhaDaMeta`). Rede, o prazo da sonda (4 s por `AbortSignal.timeout`, que CANCELA a chamada — só largar a espera deixava uma requisição pendurada por sonda; o `signal` de `verifyPhoneNumber` é NOSSO), 5xx, 429 e o limite de chamadas e o erro passageiro — que a Meta manda com HTTP 400 e se reconhecem pelo CÓDIGO, via `explainMetaError` (`limite`/`temporario`) — são "não sei". Antes, todo erro era `close` — e "fora do ar" agora TRAVA o compositor.
- ⚠️ **No Meu dia, atraso é fonte SEPARADA de "fora do ar"** (`conexoesAtrasadas`): o conserto é outro, e "N conexões fora do ar" seria falso sobre conexão de pé. O teste lá é `detail === 'lagging'`, não `tone === 'warn'` (`warn` inclui estados transitórios).
- ⚠️ **`tone_*` e `detail_*` são chaves MONTADAS** e escapam do portão de i18n. Pino: `src/components/channels/rotulo-da-saude.test.ts`, que COLHE os motivos do próprio `toneFor` em vez de digitá-los.

### Envios sem recibo: o quarto eixo (04/11/2026, 1120)

`src/lib/cb-channels/sem-recibo.ts` (régua pura + `lerEnviosRecentes`), o motivo `sem_recibo` do `toneFor`, a linha do popover e o tipo `sem_recibo` da faixa da conversa. Pergunta "esta conexão envia e nada volta?". O atraso (1002) apaga quando a entrada para de vez. Plano, incidente e medição: `docs/PLANO-alarmes-de-conexao.md`.

- ⚠️⚠️ **A régua (decisão do operador, 04/11/2026):** os 5 envios mais recentes com mais de 15 min, das últimas 3 h, em pelo menos 3 conversas, sem recibo de entrega ou leitura. APAGA no 1º recibo: a sequência é a dos envios depois do último confirmado, inclusive os novos.
- ⚠️ **Fora, de propósito:** Instagram (sem recibo de entrega), grupo (o ✓✓ espera TODOS os participantes de fora, 1119, e sem o 5º patch da Evolution nem vem: não mede a conexão), envio pelo CELULAR (chega pela mesma fila parada), `failed` e `nao_saiu` (não saíram).
- ⚠️⚠️ **Duas leituras, e o teto só nos MADUROS**: o envio confirmado mais novo dos últimos 15 min (sozinho, ele apaga o alarme) e os envios com mais de 15 min das 24 h, com teto de 100. ⚠️ E uma 3ª com o episódio aberto há mais de 24 h (`desdeDoEpisodioIso`): o confirmado mais novo entre o começo dele e a janela (a prova que ela não vê). Numa leitura só, uma rajada recente ou de envios a grupo ocupava o teto, e o alarme deixava de acender ou apagava com os recibos parados. O grupo sai NA CONSULTA (`conversations!inner` com `contact_id` não nulo, o embutido com filtro que o webhook da Evolution já usa).
- ⚠️ **Leitura que falha é `null` ("não sei") e nunca acende**; `lerEnviosRecentes` nunca lança, porque a sonda inteira depende dela.
- **Cache por CONTA, 1 min** (`TTL_SEM_RECIBO_MS`): a RLS de `messages` é por conta, e a régua conta envios com mais de 15 min.
- ⚠️⚠️ **O índice `messages_canal_e_data_idx` (1120) entra ANTES do deploy.** Sem ele, cada leitura custou 973 ms medidos (Trabalhista - Comercial), uma por conexão por minuto por conta.
- **No `toneFor` fica atrás de `webhook`, `lastError` e `lagging`** (o atraso diz quantos minutos) e vale também quando o provedor não respondeu: é dado do nosso banco.
- ⚠️ **`sem_recibo` está em `ENVIA_MESMO_EM_AMARELO`:** os envios SAEM. Fora dele, uma fila de recibos parada adiaria as cobranças do Asaas.
- ⚠️ **`semReciboDesde` vai sempre que a régua acende, também atrás de outro motivo** (com a fila represada, `lagging`, os recibos param junto): a faixa da conversa só o lê com o `detail` `sem_recibo`; o botão das conexões e a ficha do popover (E1), direto. A sonda de antes do deploy não manda o campo, e a faixa sem o `desde` cala.
- ⚠️ **O texto manda NÃO reenviar:** no incidente as mensagens tinham chegado, e reenviar mandaria em dobro (raiz, 8e).
- O Meu dia fica como está (decisão do operador): `conexoesAtrasadas` só lê `lagging`.

### Alarmes no sino: o (c) e o (b) com estado (04/11/2026, 1122)

`alarmes-no-sino.ts` (régua pura) e `avisar-alarmes.ts` (o passo do ciclo, o PRIMEIRO do `rodarManutencaoDoCiclo`, laço lento, com prazo próprio de 60 s e as conexões em ordem EMBARALHADA a cada ciclo — com ordem fixa, o prazo deixaria sempre as mesmas de fora), com o estado em `cb_alarmes_de_conexao`, lido paginado. Grava `whatsapp_alert` (1085) com título e corpo já escritos, no idioma da instalação, como a sentinela. Decisões D2, D5, D6 e P3b do plano.

- ⚠️⚠️ **As regras da sentinela:** um aviso por episódio; "Continua" a cada 24 h; "Normalizou" só com PROVA (no (c), um envio confirmado depois do começo do episódio; no (b), medição FRESCA com até 5 min). "Não sei" (leitura que falhou, medição vencida, ninguém enviando) não encerra nada. ⚠️ HISTERESE no (c) e no (b): o avisado só normaliza com a prova de pé há 1 h (`FIRMEZA_DA_PROVA_MS`, em `normalizou_em`); reacender antes é o MESMO episódio (os recibos em lote da queda a cada ~50 min davam 9 a 14 pares por dia). O botão e o computador não esperam. A prova firme com o aviso recusado fica em `normalizou_em` e sai no ciclo seguinte.
- ⚠️⚠️ **O (b) conta a DURAÇÃO, não o tamanho** (D5; revisão do PR): acende quando o âmbar da tela (mais de 5 min, medição fresca) está aceso há 30 min (`DURACAO_DO_ATRASO_NO_SINO_MS`), a contar de quando a mensagem MEDIDA chegou (`entrega_recebida_em`).
- ⚠️ **Horário útil só no (c)** (P3b): segunda a sexta, 8h–20h de Brasília (`FUSO_PADRAO` em toda instalação; feriado conta como útil). Aceso à noite, a linha fica guardada e o aviso sai na abertura SE ainda estiver aceso; o (c) ainda não avisado acompanha o "desde" da sequência de agora. O "Normalizou" de aviso já enviado vai a qualquer hora.
- ⚠️⚠️ **"Aconteceu e já normalizou" só com `devido_em`**: o aviso que ficou devido e não entrou (o sino recusou, ou não havia a quem). Sem ele, o fim de um episódio que nunca valeu aviso (o (c) de sexta à noite com o recibo só na segunda; o (b) de 10 min) sai CALADO — era o falso positivo noturno que o P3b mandou calar.
- ⚠️⚠️ **O estado e o aviso vão numa transação só** (`cb_gravar_alarme_de_conexao`, 1122): a escrita cercada pelo `avisado_em`, `normalizou_em` e `devido_em` lidos é a reivindicação (raiz, 8e) — só quem a ganha avisa — e, se o INSERT no sino falha, o estado também não muda. O texto é montado ANTES. Em duas escritas, um processo que morresse entre elas daria o episódio por avisado sem aviso. A função confere de novo que cada destinatário é membro ATIVO da conta.
- **Quem recebe (D2):** owner/admin e os membros cujo perfil vê a conexão (`canalNoEscopo` sobre o perfil REAL); o suspenso fica fora já na leitura. Sem destinatário, o episódio fica guardado como devido. ⚠️ Membros e perfis por CHAVE (`buscarPorChave`): cortado em 1000, o perfil de fora virava "vê todas".
- ⚠️ **O estado não mora em `cb_channels`**: todo UPDATE ali refaz a sonda de cada aba. A tabela é fechada ao navegador e fora da publicação, e a conexão apagada leva a linha (CASCADE).
- **As conexões se leem de TODAS as contas, de propósito**, e cada uma é tratada só com a conta dona dela; as leituras da conta (membros, perfis, estado) e a escrita são cercadas pela conta (a service role não tem RLS). A conexão vem pelo predicado (`ehEvolution`/`ehMeta`): o Instagram fica fora.
- ⚠️ **A régua do (c) é a da sonda** (`semRecibo` + `lerEnviosRecentes`): mudar uma muda as duas. No nosso servidor, a sentinela avisa o mesmo incidente com outro texto: aceito (plano §6).

### O alarme no botão das conexões do cabeçalho (E1, 05/11/2026)

`alarmes-do-cabecalho.ts` (régua pura), o `ChannelHealthIndicator` e o campo `episodios` da sonda (`episodioAberto`, lido de `cb_alarmes_de_conexao` em `health.ts`). Decisão do operador: no lugar da faixa fixa no topo do plano, o botão se ALARGA com o alarme (fundo da cor dele e, do `md` para cima, "qual conexão e o quê"); no popover, cada alarme mora na ficha da PRÓPRIA conexão, como os outros avisos dela (os cartões no topo ficaram grosseiros).

- ⚠️⚠️ **Duas fontes:** o AO VIVO (fora do ar e não recebe por `avisoDaConexao`; sem recibo pelo `semReciboDesde`) e os EPISÓDIOS do sino ainda abertos (`episodioAberto`, as regras do `decidir`). O episódio é o que faz o alarme da madrugada ser visto às 8h: só a prova o fecha (a de agora, ou a guardada em `normalizou_em`, que a medição acesa de novo anula; o botão não espera o ciclo apagar a linha).
- ⚠️ **O (c) que o sino CALA (P3b: visto fora do horário útil, nunca avisado nem devido) só aparece ACESO**: guardado e apagado, o robô noturno para lead frio pintaria o botão até o 1º recibo da manhã. Conexão desligada de propósito deixa o botão vermelho até ser apagada, como o glifo.
- ⚠️ **O atraso só entra pelo episódio de 30 min** (confirmado pelo operador): o atraso ao vivo acende a cada reinício da Evolution. O glifo e a faixa da conversa seguem com o ao vivo, e os estados de passagem (reconectando, frescor) só mudam a cor do glifo, nunca alargam.
- ⚠️ **O estado é lido pela ROTA da saúde com a service role**, cercado pela conta da sessão: a tabela é fechada ao navegador. Cache de 1 min por conta (o estado só muda no ciclo lento), e a falha NÃO fica no cache: `episodios: null` = "não sei", e o botão fica só com o ao vivo. Sem a service role (a régua do Asaas chama a sonda), `null`.
- **O BOTÃO recorta pelo acesso EFETIVO** (D2: owner/admin veem todas; o membro, as do perfil) e mostra o pior e "+N" (`alarmesDoCabecalho`); sonda carregando ou que falhou não alarga nada. A ficha mostra os da conexão a quem a vê, sem recorte, como as outras linhas dela (`alarmesPorConexao`); fora do ar e não recebe não ganham linha (o status já diz).
- No celular o texto não cabe ao lado do título: o botão só ganha o fundo colorido. Do `lg` para cima o texto encolhe (o menu lateral come a largura) e volta no `xl`.
- **O computador de ligações** (4e, 1137): `ligacoes-operacao.md`.
- **Os alarmes de conexão da SENTINELA** (Fase 4, só na nossa VPS) vêm pelo campo `sentinela` da sonda: ela grava os abertos em `cb_alarmes_da_sentinela` (1123) a cada execução, e a leitura ignora linha não confirmada há 3 h (`alarmes-da-sentinela.ts`). Entram no "pior da conexão" com os outros (`GRAVIDADE`). Escrita e contrato: `deploy.md` e `docs/INFRA-VPS.md` §12.

