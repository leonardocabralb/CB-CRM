---
paths:
  - "src/lib/ia-agentes/acesso*"
  - "src/lib/ia-agentes/conhecimento*"
  - "src/lib/ia-agentes/pedido*"
  - "src/lib/ia-agentes/acoes*"
  - "src/lib/ia-agentes/executar-acoes*"
  - "src/lib/ia-agentes/ferramentas*"
  - "src/lib/ia-agentes/agenda*"
  - "src/lib/ia-agentes/reuniao*"
  - "src/lib/ia-agentes/contexto*"
  - "src/lib/transcricao/**"
  - "src/app/api/cb/ia/agentes/**"
  - "src/components/agentes-de-ia/acesso-do-agente.tsx"
  - "src/components/agentes-de-ia/base-do-agente.tsx"
  - "src/components/agentes-de-ia/playground-do-agente.tsx"
  - "src/components/agentes-de-ia/ferramentas*"
  - "supabase/migrations/1052_cb_ia_agente_documentos.sql"
---

# Agentes de IA — o que cada agente vê (F3, 1052)

Plano: `docs/PLANO-agentes-de-ia.md` (5.5, D20, F3). O motor, a fila e a pausa
estão em `.claude/rules/ia.md`.

- ⚠️⚠️ **Nada marcado = o agente vê SÓ a conversa** (`cb_ia_agentes.acesso`,
  `lerAcesso`: só o booleano `true` liga; `campos` = ids de `custom_fields`,
  até 50). É dado de cliente indo a provedor externo: fechado por padrão,
  como o `radar_enabled`. Bloco NÃO marcado não é nem LIDO.
- ⚠️ **Os blocos são para o MODELO** (inglês, como o texto-base), com teto de
  1.500 caracteres por bloco e corte declarado. Leitura que falha vira
  "unavailable right now" — nunca "sem dívida", "sem card" ou "nenhuma
  reunião" sem a leitura (`blocoIndisponivel`; o Playground não conta esse
  bloco como visto). ⚠️ Nas cobranças, as RESSALVAS (dado velho, parcelas
  em conferência) e o total vêm ANTES das parcelas: o teto corta pelo fim.
- **Reunião**: o próximo `invitee.created` sem `invitee.canceled` para o
  mesmo `invitee_uri` (reagendar cancela o antigo), com o link de remarcar.
- **Negócio**: o card do turno (`turno.deal_id`); no Playground, o aberto
  mais recente do contato. Valor 0 não é mostrado (é o DEFAULT de `deals`).
- ⚠️⚠️ **Base por agente (D20)**: `cb_ia_agente_documentos` (fechada ao
  navegador; FKs compostas pela conta; CASCADE dos dois lados; arquivar o
  agente NÃO apaga o vínculo). A busca é pelas funções NOVAS
  `cb_ia_buscar_conhecimento_semantico`/`_fts` — agente nulo ou sem documento
  = NADA. As `match_ai_knowledge_*` (0903, "nulo = sem recorte") ficam para o
  rascunho ✨; o agente nunca passa por elas.
- ⚠️ **A busca por palavras é OU** (qualquer palavra de 3+ letras da
  pergunta, ordenado por `ts_rank`): `plainto_tsquery` da mensagem inteira
  exigia TODAS as palavras, e com o dicionário `simple` a base quase nunca
  entrava. Sem acento tirado: "horario" não casa "horário" (limite).
- **O embedding da pergunta tem teto** (`PRAZO_DO_EMBEDDING_MS`, 8 s): a base
  é melhor esforço e não pode tirar a resposta do prazo do turno.
- **Agente sem documento custa UMA leitura**: a chave de embeddings chega
  como função e só é lida quando há o que buscar.
- ⚠️ **Ordem no turno**: o teto por conta (`checkRateLimit`) vem ANTES de
  ler blocos e base — turno barrado não lê dado do cliente nem paga busca.
- **O retrato** (`cb_ia_turnos.contexto`: blocos renderizados, ids dos
  documentos e o TEXTO de cada trecho — o documento pode mudar depois) é
  gravado numa escrita separada, com a cerca de posse (zero linhas = posse
  perdida: abandona antes de gerar), e ZERADO ao reagendar. "Documento
  apagado" só com a lista de documentos completa (abaixo de 1.000). A sub-aba Turnos o mostra; ⚠️ deploy antes da 1052 =
  a aba Turnos em 500 (ela pede a coluna).
- **Playground**: `contactId` opcional (conferido na conta; fora = 404
  `contato_nao_encontrado`) e `vistos: { blocos, trechos }` — TRECHOS, não
  documentos.
- **Limite conhecido**: dois PUT simultâneos de documentos do mesmo agente
  podem deixá-lo sem documento (insere e depois apaga, sem trava).

# Agentes de IA — ações junto com a resposta (F4, D28)

Plano: `docs/PLANO-agentes-de-ia.md` (D5, D28, F4). Sem migration.

- ⚠️⚠️ **O modelo escolhe NÚMERO, nunca id** (`opcoesDoAgente` → pedido
  numerado → `resolverAcoes`). Contato, card e conversa são os DO TURNO.
  Número fora da lista = recusada. Nada ligado em `ferramentas` = só conversa.
- ⚠️⚠️ **As ações rodam DEPOIS de a resposta SAIR** (`turno.ts`). Passagem,
  transferência, link inventado, reserva recusada, envio recusado ou incerto
  = nenhuma ação (registradas como recusadas / `envio_falhou`). Cada ação é
  conferida DE NOVO na hora e deixa a anotação "IA · <agente> …"; uma falha
  não segura as outras.
- ⚠️⚠️ **A D5 inclui a CASCATA** (`motivoForaDaD5`, `ferramentas.ts`):
  `run_automation`, as automações de ENTRADA das etapas movidas e as de
  etiqueta aplicada (o motor não tem gatilho de etiqueta tirada), com trava de ciclo e o escopo ignorado. Ao salvar
  (400 com código e `itens`), nas opções do turno e na execução. "Aguardar"
  só é proibido na automação que a IA executa DIRETAMENTE. Os webhooks de
  saída `deal.*` ficam fora (assinatura da integração; limite escrito).
- **Nenhum marcador chega ao cliente** (`lerAcoes`: caixa, acento, espaço,
  colchete simples; `[[handoff]]` em qualquer forma = transferência). Teste
  para cada forma nova.
- **Link inventado** (`linkInventado`): URL da resposta que não está no
  pedido montado nem nas mensagens enviadas ao modelo → retém e transfere
  (`link_inventado`), com o link no registro do turno.
- **Campo com tipo**: data, número, lista e o e-mail espelhado são validados
  na hora (`valor_invalido`); valor vazio não apaga.
- **O registro** (`cb_ia_turnos.acoes`): `erro` é código de lista FECHADA
  (`MotivoDaRecusa` | `CODIGOS_DE_FALHA_DA_ACAO`), o cru vai em `detalhe`; a
  aba Turnos traduz por Record exaustivo — código novo sem texto não compila.
- **Playground**: as ações são SIMULADAS (nada executa) e vêm com o valor.
- **Limites**: a trilha/`deal.*` dizem `automation`/`sistema` (a origem `ia`
  exige migration); ferramentas lidas no começo do turno; agente e automação
  da etapa nova falam os dois (o agente primeiro); as ações não são
  reconferidas uma a uma depois do envio (a reserva é a conferência; #316).

# Agentes de IA — marcar reunião no Calendly (F5, D7 + D28)

Plano: `docs/PLANO-agentes-de-ia.md` (D7, D28, 5.6, F5). Sem migration. É
uma AÇÃO a mais do protocolo da F4 (`marcar_reuniao`, `[[REUNIAO:n]]`).

- ⚠️⚠️ **A EXCEÇÃO à D5 pela cascata**: marcar reunião NÃO passa por
  `motivosForaDaD5`. A automação do tipo de evento roda pelo webhook
  `invitee.created`, como quando o PRÓPRIO cliente agenda pelo link (pode
  avisar o advogado por `send_to_number` e mover o card). Escrito no código
  (`conferirFerramentas`, `marcarReuniao`, `agenda.ts`), aqui e no plano.
  O agente NÃO mexe no card, nos campos nem nos lembretes.
- **Configuração**: `ferramentas.marcar_reuniao = { tipos_de_evento: [uri] }`
  — lista para caber no código genérico, NO MÁXIMO uma, só a forma
  `https://api.calendly.com/event_types/<id>` (`ehUriDeTipoDeEvento`). Ao
  salvar, o tipo tem de ser ATIVO na conta do Calendly conectado, lido na API
  (`tipo_de_evento_invalido`; sem Calendly, `calendly_desconectado`); leitura
  que falha = `banco`. ⚠️ Só quando o tipo MUDOU em relação ao gravado
  (`conferirFerramentas(…, gravadas)`): senão o Calendly fora do ar dava 500
  ao salvar OUTRA ferramenta. A tela recebe `calendly` + `tiposDeEvento` (só
  os ativos; `null` = desconectado ou falhou, nunca lista vazia), com prazo
  total de 8 s (`PRAZO_DOS_TIPOS_NA_TELA_MS`; estourou = `falhou`, o resto do
  catálogo chega).
- **O pedido**: os horários livres (`lerAgendaDoAgente`) de agora + 1 h a 7
  dias, numa AMOSTRA espalhada (`opcoesDeHorario`: até 3 por dia — o
  primeiro, o último e o do meio —, 15 no total, em rodízio que cobre todos
  os dias antes do 2º horário de qualquer um), NUMERADOS no fuso do
  escritório. ⚠️ Dois textos por horário: `textoNoPedido` ("Mon 28/09
  15:15", para o MODELO casar "segunda às 15h") e `nome` ("28/09/2026
  15:15", o que GENTE lê: registro do turno, Playground, anotação) —
  `formatToParts`, nunca o ISO para o modelo. O pedido diz que os números
  valem SÓ para o marcador desta resposta (casar DIA e HORA com a lista
  atual; fora dela = "não está mais livre", nunca marcar outro) e que a lista
  é amostra (pedido de outro dia = dizer quais dias têm vaga). ⚠️ Leitura com
  PRAZO (`PRAZO_DOS_HORARIOS_MS`, 4 s) que falha EM SILÊNCIO para o turno: o
  pedido diz que não há horários agora e manda o link de remarcar do bloco da
  reunião, se houver (sem o marcador). "Customer e-mail on file" usa a MESMA
  régua da execução (a ficha, senão o último `invitee.created`).
- ⚠️⚠️ **Cliente que JÁ tem reunião futura não recebe horários**
  (`lerProximaReuniao`, a MESMA leitura do bloco "reuniao", lida mesmo com o
  bloco desmarcado): o pedido diz quando ela é e manda o link de remarcar
  DELA (sem link, transferir); o marcador inventado é `nao_liberada` e
  transfere. Leitura dessa reunião que falha = sem horários (`lida` falso).
- **Uma reunião por resposta**: o segundo horário é `teto`; horário fora dos
  oferecidos, `fora_da_lista` (default-deny). O `id` da opção é o
  `start_time` que o SERVIDOR leu — é ele que vai ao `POST /invitees`.
- **Execução**: por ÚLTIMO, depois do `preencher_campo` (o e-mail espelhado
  da mesma resposta), com o e-mail RELIDO. O corpo do `POST /invitees` é
  montado SÓ em `corpoDoConvidado` (a forma da doc; ⚠️ ainda não medido).
  Códigos: `sem_email`, `horario_indisponivel` (409 ou 4xx que fala do
  horário, `recusaDoHorario`), `calendly_desconectado` (sem config, token
  ilegível ou 401), `recusado`, `falhou` (rede/tempo).
- ⚠️⚠️ **O telefone vai como RESPOSTA da pergunta de telefone do formulário**
  (`respostasDoTelefone` → `questions_and_answers: [{ question, answer,
  position }]`, E.164 com `+`), além do `text_reminder_number`: o Calendly não
  tem campo de telefone, e sem a resposta o nosso webhook termina
  `sem_telefone` (card parado, lembretes desarmados, advogado sem aviso).
  Respondidas: toda pergunta ATIVA de tipo `phone_number` (a medida:
  "Telefone (Whatsapp)", obrigatória), a configurada no cartão
  (`pergunta_telefone`) e, sem nenhuma das duas, a primeira que a heurística
  do webhook reconhece — a MESMA régua (`casaComAPerguntaConfigurada`,
  `rotuloDeTelefone`, exportadas de `payload.ts`; nunca copiar a regex).
  Pergunta OBRIGATÓRIA que não é de telefone fica sem resposta: o POST falha
  e o turno transfere (não inventar).
- ⚠️⚠️ **Pedida e NÃO marcada = o turno TRANSFERE para gente**
  (`reuniaoNaoMarcada` + `transferirParaGente`, motivo
  `reuniao_nao_marcada` com o `{motivo}` do código): a resposta já saiu
  prometendo. O desfecho continua `respondeu`; a transferência não passa por
  cima de pausa existente — mas, com a conversa já pausada (`nada_mudou`), a
  ANOTAÇÃO da falha sai assim mesmo (`anotarNaConversa`). A nota manda
  conferir no Calendly se a reunião não foi criada antes de marcar de novo
  (5xx/tempo podem tê-la criado). Envio que não saiu não transfere pela
  reunião.
- **Playground**: horários AO VIVO, reunião SIMULADA (`marcarNoCalendly`
  nunca é chamado); a resposta traz `horarios: [{ n, texto }] | null` (o
  `texto` é o `nome`; nulo também para quem já tem reunião).
- **Limites**: o turno lê as ferramentas no começo (o tipo de evento
  desligado durante a geração ainda marca naquele turno, se ainda ativo no
  Calendly); 5xx ou tempo esgotado no `POST /invitees` vira falha e
  transfere, mas a reunião PODE ter nascido: a nota manda conferir no
  Calendly antes de marcar de novo.
- **Limites (F5)**: ficha sem nome manda o telefone como nome do convidado;
  o nome do perfil do WhatsApp é fixado pela automação do Calendly; o
  Playground não distingue "desligada" de "leitura falhou".

# Agentes de IA — mídia do cliente (imagem e PDF, 27/09/2026)

Plano: `docs/PLANO-agentes-de-ia.md` (Estado, "Leitura de imagem e PDF").
`src/lib/transcricao/ler-midia.ts` (I/O) e `leitores.ts` (puro), os dois
testados; `prepararMidias` em `turno.ts`; `contexto.ts` e `pedido.ts`.

- ⚠️⚠️ **A leitura vira TEXTO, uma vez, gravado na mensagem** — nas colunas
  `transcricao*` da 943 (sem migration). O agente recebe o texto, com
  QUALQUER provedor: nada de multimodal no `generateReply`. Todo leitor de
  `transcricao*` filtra `content_type = 'audio'` (a bolha, a aba Arquivos e o
  Radar já filtram — pino em `cb-radar/worker.test.ts`).
- ⚠️ **Quem LÊ é escolhido pela CHAVE da conta**, Gemini → OpenAI → Anthropic
  (`escolherLeitor`), com modelo FIXO por provedor (`MODELO_DE_LEITURA`). A
  forma de cada provedor foi conferida na documentação (URLs em
  `leitores.ts`): Gemini `inlineData`; OpenAI pela API RESPONSES
  (`input_image`/`input_file` em data URL, `store: false` — documento de
  cliente); Anthropic `image`/`document` base64. HEIC só o Gemini lê.
- **O contrato é o da transcrição**: cadeado `UPDATE…RETURNING`, 3
  tentativas, cerca de posse; `recusada` GRAVADA só o irreversível (tipo que
  ninguém lê — docx, planilha —, grande demais para o provedor escolhido, sem
  URL, tentativas esgotadas). Teto de tokens NÃO é recusa: grava o lido com o
  corte declarado. Custo em `ai_usage_log` no modo `transcricao`, com o
  provedor e o modelo usados. Três diferenças, cada uma com motivo:
  - ⚠️ **Configuração é `sem_leitor`**, sem gravar e sem gastar tentativa
    (sem chave, chave ilegível, formato de OUTRO provedor). O documento sem
    tipo que só o download revela ser desses solta o cadeado sem gastar e
    GRAVA o `media_type` do Storage: a próxima vez recusa antes de baixar.
  - ⚠️⚠️ **A falha PASSAGEIRA não gasta tentativa** (`falhaPassageira`:
    401/403/404 — chave, modelo fixo que sumiu —, 408/409/425/429, 5xx;
    tempo esgotado; rede). O turno reagenda a cada 10 s: três soluços
    carimbavam `recusada` para sempre num arquivo legível. Quem dá o ritmo é
    o turno (abaixo). Contam: 4xx do provedor que é o arquivo, resposta
    vazia, leitura bloqueada, download 404.
  - ⚠️ **Leitura BLOQUEADA é falha, nunca conteúdo** (`bloqueio`): Gemini
    fora de `STOP`/`MAX_TOKENS` ou `promptFeedback.blockReason`; OpenAI com
    parte `refusal` ou `status` que não é `completed` (o `incomplete` por
    teto é corte); Anthropic `refusal` ou fim de ferramenta. O pedaço
    recitado ou a frase de recusa nunca vão para `transcricao`.
  - **O prazo da chamada é o da leitura** (`TEMPO_DA_LEITURA_MS`: 45 s
    imagem, 90 s PDF), não os 30 s do chat, e o texto pedido vai até ~6.000
    caracteres. Cabe no turno: a leitura só começa com a prévia sobrando
    (≤ ~24 s dos 45 s), a pior dá ~134 s de rodada (< 4 min do recolhedor),
    e a que passa do prazo fica gravada e o turno reagenda.
- ⚠️ **No turno** (`prepararMidias`, depois do áudio): as mídias do CLIENTE
  entre as mensagens que vão ao modelo (as últimas N da conexão, não só a
  rajada), sem leitura, até 5 TENTATIVAS por rodada (o `sem_leitor` não
  conta), só enquanto sobra o prazo da prévia. A ORDEM: as da rajada da mais
  antiga para a mais nova (as fotos das páginas saem na ordem), depois as de
  antes, da mais nova para a mais antiga. Figurinha (`ehFigurinha`, a régua
  de `abreTurno`) e mídia da equipe ficam de fora. Transitório reagenda SÓ
  dentro de 2 min da própria mensagem; depois segue sem o texto (a falha que
  comeu o prazo reagenda). ⚠️⚠️ E nada passa de
  `TETO_DA_ESPERA_DAS_MIDIAS_MS` (3 min) contado do `gravada_em` do GATILHO:
  depois dele o turno não tenta ler mais nada e responde. É o teto dos
  reagendamentos — sem ele, a falha passageira (que não gasta tentativa) ou
  um banco lento laçavam o turno para sempre. Depois, uma retentativa por
  mensagem nova do cliente.
- ⚠️⚠️ **TRÊS estados no contexto, com instruções opostas no pedido**
  (`contexto.ts`, `pedido.ts`): lida = `(content: …)`; `— could not be
  read: <motivo>` = recusada gravada ou `sem_leitor` nesta rodada (com o
  motivo GENÉRICO `MOTIVO_SEM_LEITOR` — o da equipe manda às Integrações e
  não é assunto do cliente): o agente pede que o cliente descreva ou reenvie
  legível, e transfere só se for essencial (NÃO transfere sozinho — o áudio
  sim, lá a mensagem inteira é o áudio); `— not read yet` = todo o resto
  (nunca tentada, falha passageira, além das 5): o agente NÃO pede reenvio,
  pode dizer que ainda está vendo os arquivos. Sem essa separação, a quarta
  foto de uma rajada virava "mande de novo". A figurinha é `[sticker]` e o
  pedido manda nunca perguntar dela. A mídia da EQUIPE fica só com o rótulo.
- **No pedido**, a leitura entra com teto de 4.000 caracteres (a gravada vai
  a 12.000). O retrato do turno (`cb_ia_turnos.contexto`) NÃO guarda as
  mensagens: nada muda nele.
- **Playground**: continua só texto — não recebe arquivo.
- ⚠️ **Áudio pela OpenAI (a queda da transcrição, `transcrever.ts`)**: texto
  VAZIO é o áudio sem fala e vira `MARCA_INAUDIVEL` (`[inaudível]`), o mesmo
  desfecho do Gemini; só o campo AUSENTE é falha. Tratado como falha, o
  silêncio custava três chamadas pagas e uma transferência para gente.
- **Limites conhecidos** (revisão de 27/09): (1) o leitor é escolhido só pela
  CHAVE, não pelo formato — conta com Gemini e OpenAI e um GIF (o Gemini não
  lê GIF) vira `sem_leitor` em vez de ir à OpenAI; raro. (2) o cartão de
  Integrações não reflete a chave do Gemini que NÃO decifra: a leitura pula
  para o próximo provedor e o cartão ainda diz Gemini. (3) o modelo que
  responde com texto de recusa SEM o sinal de recusa (fim `STOP`) é gravado
  como leitura — não há como distinguir. (4) a falha passageira do ÁUDIO
  (`transcrever.ts`) ainda gasta tentativa: a regra nova é só da leitura.

