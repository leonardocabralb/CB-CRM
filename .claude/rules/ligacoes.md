---
paths:
  - "src/lib/whatsapp/ligacoes/**"
  - "src/components/inbox/aviso-de-ligacao.tsx"
  - "supabase/migrations/*ligacoes*"
  - "docs/PLANO-ligacoes-do-whatsapp.md"
  - "docs/PLANO-ligar-pelo-crm.md"
  - "maquina-de-ligacoes/**"
  - "ops/vps/ligacoes/**"
  - "src/components/ligacoes/**"
  - "src/lib/ligacoes/**"
  - "src/hooks/use-computadores-de-ligacao*"
  - "src/hooks/use-nomes-da-ligacao*"
  - "src/app/api/cb/ligacoes/**"
---

# Ligações de WhatsApp — regras

Vale ao mexer na ligação que vira faixa no fio (1044): `src/lib/whatsapp/ligacoes/`
(`evento`, `desfecho`, `telefone`, `previa` puros e testados; `registrar` faz o
I/O), o ramo `call` da rota do webhook da Evolution, a faixa
`aviso-de-ligacao.tsx` e todo leitor de `messages.content_type`. Plano vivo,
medições e decisões do operador: `docs/PLANO-ligacoes-do-whatsapp.md`. As
obrigações gerais de caminho de entrada estão em `.claude/rules/ingestao.md`.

## Ligar pelo CRM (4a, 4b e 4c — a tela; a 4d transcreve)

O interruptor por conexão, o QR, o Reparear e os alarmes do computador (4e,
1137): `ligacoes-operacao.md`.

- ⚠️ **Solução NÃO oficial, por decisão do operador (10/11/2026):** nem a
  API de ligações da Meta nem a Wavoip. O caminho é uma máquina central com
  um Chrome (WhatsApp Web) por número, e o áudio do atendente pela aba do CRM.
  A extensão por atendente foi descartada: cada número aceita só 4 aparelhos
  conectados. Fases, medições e decisões: `docs/PLANO-ligar-pelo-crm.md`.
- A feita pelo CELULAR do escritório continua sem existir no CRM (não gera
  aviso); a feita PELO CRM existe (`cb_ligacoes` `crm:<uuid>`, 1134).

## O computador de ligações (`maquina-de-ligacoes/`, 4a)

Um contêiner por número na VPS: Xvfb, PulseAudio, o Chrome com o WhatsApp Web
e o orquestrador em Node. Operação: `docs/INFRA-VPS.md` §4; medições e
desenho: §8.12 e §8.13 do plano.

- ⚠️⚠️ **Contêiner AVULSO, nunca serviço do Swarm, e o Chrome COM a caixa de
  areia** (nada de `--no-sandbox`): ele abre o que qualquer pessoa manda ao
  número. A caixa de areia exige o perfil `seccomp/chrome.json`,
  `no-new-privileges` e só `SYS_CHROOT` (medido: o Swarm não aceita perfil
  seccomp). Rede `LigacoesNet`, nunca a `CBAdvNet`; nenhuma porta publicada.
  Tudo em `ops/vps/ligacoes/criar-maquina.sh`. A imagem é REMONTADA toda
  semana com o Chrome do dia (`atualizar-maquinas.sh`, cron de domingo): só
  com a linha livre, devolvendo o contêiner ao estado em que estava e
  voltando à imagem anterior se a nova não responder.
- ⚠️⚠️ **A gravação abre no COMEÇO do pedido** (ligar/atender, antes da
  ponte) e o que veio antes do atendimento sai num corte (`-ss`, cópia do
  fluxo) pelo carimbo `start:` que o ffmpeg imprime de cada entrada (relógio
  de parede: segundo do arquivo = relógio − start). Medido em 11/11/2026:
  aberto no "atendeu", o ffmpeg perdia o começo (segundos para subir), e o
  SIGINT perdia os ~2 s finais — por isso `parar` espera a CAUDA. Sondagem e
  fragmento do PulseAudio NÃO mudam nada. Sem atendimento, a pasta é
  apagada. O "encerrada" vai ao CRM antes de a gravação fechar; a linha fica
  ocupada até ela fechar (a cauda de uma não pode ter a voz da seguinte).
  Depois do corte, cada LADO ganha a etiqueta `CB_SOM` (onde há som, medido
  pelo `silencedetect`): é o que impede o Gemini de inventar fala no lado mudo
  (`ligacoes-transcricao.md`). Medir ou etiquetar que falha manda o arquivo
  sem etiqueta, nunca segura a gravação.
- ⚠️⚠️ **Um perfil por contêiner, nunca dois no mesmo `/perfil`**: a trava do
  Chrome é apagada no `iniciar.sh`, e dois Chromes na mesma sessão a
  corrompem.
- ⚠️ **O `iniciar.sh` limpa o que o `docker stop` deixa na camada do
  contêiner:** as travas da tela e a pasta do PulseAudio
  (`$XDG_RUNTIME_DIR/pulse`, com o `pid` e o soquete). Sem isso, o `start`
  seguinte (ou um reinício da VPS) entrava em laço de reinício ("Daemon
  startup failed", medido em 11/11/2026). Arquivo novo que sobreviva ao stop
  e trave a subida entra na mesma limpeza.
- ⚠️⚠️ **Discar só pelo DISCADOR** (aba Ligações → "Ligar para um telefone"):
  abrir a conversa manda ao cliente a confirmação de leitura. O número entra
  INTEIRO de uma vez (`insertText`), depois de o resultado anterior sumir:
  digitado tecla a tecla, um prefixo dele pode ser o número de outra pessoa,
  e ligar para a pessoa errada é o pior caso.
- ⚠️⚠️ **A máquina nunca toca em "Recusar" nem em "Ignorar"**: recusar num
  aparelho derruba a chamada em todos (os celulares do escritório também).
- **Todo seletor mora em `SELETORES` (`whatsapp.ts`)**, e a decisão do que a
  tela mostra é a função pura `decidir`, testada com retratos fictícios
  (nunca a tela real copiada: ela tem nomes e mensagens de clientes). Os
  `aria-label` estão em português (`--lang=pt-BR`): trocar o idioma nas
  configurações do WhatsApp quebra a máquina.
- A máquina de estados (`ligacao.ts`): uma ligação por vez, e a linha só
  fica livre DEPOIS de fechar a gravação e a ponte da anterior (`encerrando`)
  e de o pedido dela (ligar, atender) parar de mexer na tela e na ponte
  (`pedidoEmCurso`: desligar no meio não para o Playwright); nunca disca nem
  atende antes de
  a ponte do atendente ligar; desliga aos 30 min do atendimento (D13), com um
  teto também desde o pedido, e com a ponte caída por 15 s. Fechar a aba no
  meio deixa a linha ocupada por ~18 s. A aba que não responde por 60 s de
  RELÓGIO (nunca contar leituras: cada uma leva o prazo de 5 s) faz o
  processo sair.
- ⚠️⚠️ **Chamada nenhuma fica na tela sem dono:** chamada FEITA ou EM CURSO na
  tela sem ligação em curso aqui (o clique de desligar que não pegou, o fim
  forçado, o passo que falhou depois do clique) é desligada de novo a cada
  leitura da tela. Só a máquina põe chamada nesses dois estados; a recebida
  TOCANDO nunca é tocada. O "Atender" relê a tela logo antes do clique e só
  aceita o mesmo `quem` da conferência (o cliente pode ter desistido e outra
  pessoa estar tocando).
- ⚠️ **O segredo não entra no ambiente do Chrome** (`env -u` no
  `iniciar.sh`): ele abre o que qualquer pessoa manda ao número.
- **O contrato com o CRM (a 4b implementa exatamente isto):** a máquina
  responde `GET /estado`, `GET /qr`, `POST /ligar`, `/atender`, `/desligar` e
  (4e) `/desconectar` na 8080, com `Authorization: Bearer <LIGACOES_SEGREDO>` — o segredo DELA,
  derivado do do CRM (ver "O CRM, dono da ligação"); o id da ligação é
  o `cb_ligacoes.id` (só `[A-Za-z0-9-]`: nunca o `call_id` `crm:…`), e o
  número é o do JID da conversa, NUNCA um LID (a máquina não os distingue).
  Ela manda ao CRM `POST <url>/api/cb/ligacoes/eventos` (`sinal`,
  `chamando`, `atendida`, `encerrada` com o motivo) e `PUT
  <url>/api/cb/ligacoes/gravacao/<ligação>/{estereo,cliente,atendente}.ogg`,
  apagando a cópia só depois do 2xx. O aviso é repetido com espera crescente
  por até 30 min, SÓ na memória (parar o contêiner com o CRM fora perde o que
  estava na fila): o CRM grava cada informação uma vez só e confere pelo
  `/estado`.
- O `playwright-core`, o `typescript` e o `@types/node` estão no
  `package.json` do subprojeto E nas dependências de desenvolvimento da raiz
  (o `typecheck` da raiz confere o subprojeto, a imagem compila com o dele):
  mesma versão nos dois, com pino (`versoes.test.ts`).

## O CRM, dono da ligação (4b, 1134: `pelo-crm.ts`, `computador.ts`)

- ⚠️⚠️ **A faixa da ligação pelo CRM é só REGISTRO** (D6/D6b): `agent` SEM
  `sender_id` e com `from_device` falso — a 972 e a pausa da IA (1118) não a
  contam como gente, e a retomada (`cb_ia_reservar_envio`, 1134) a exclui.
  Não reabre, não sobe a conversa, não mexe nas não lidas; só
  `preencherCanalDaConversa` (a recebida de número novo). Dar autor ou
  `from_device` a ela apaga o "em atraso" e pausa a IA, sem erro nenhum. A
  recebida passa por `resolverDestinatario` e `routeContactToPipeline`, como
  toda ligação.
- ⚠️⚠️ **A marca do atendimento pelo CRM** (`atendimento_pelo_crm_desde`,
  gravada no "Atender"; `atendida_pelo_crm_em`, na confirmação da máquina):
  com ela, `desfechoDaLigacao` NÃO decide — o próprio atendimento faz a
  Evolution mandar `terminate` sem `accept`, e a régua de hoje daria
  "perdida" (o teste D da 4a). O teto da marca é 60 s. Falhou o atendimento:
  a marca sai e `decidirLigacao` roda DEPOIS da folga, no `after()` — a
  decisão que a marca segurou não volta sozinha.
- A linha ao vivo (`cb_ligacoes_ao_vivo`): o `offer` abre "tocando" só com o
  computador PRONTO (sinal de menos de 3 min e WhatsApp conectado), fora
  vídeo e número do escritório; todo fim ou `accept` apaga a que ainda TOCA;
  o "Atender" a reivindica (`estado = 'tocando' AND atendente_id IS NULL`).
  Uma por número além das que tocam (índice único): é a trava do ligar e do
  atender. A ligação ao vivo NÃO tem FK (passageira; a Lixeira recusaria).
- ⚠️ **O segredo é POR computador**: HMAC-SHA256 do `LIGACOES_SEGREDO` do
  CRM com o nome, em hex (`segredoDoComputador`; a VPS repete com `openssl
  dgst -hmac` em `criar-maquina.sh`). Quem fala com o CRM é o computador cujo
  segredo vem no cabeçalho. As rotas da máquina (`eventos`, `gravacao/…`)
  recusam o pedido pelo domínio público (o `host` do `NEXT_PUBLIC_SITE_URL`);
  ⚠️ nunca por `x-forwarded-for`: o próprio Next o preenche em todo pedido.
- Os avisos da máquina são uma fila (FIFO) que repete 5xx/408/429 e LARGA
  outro 4xx: falha de banco é 500, aviso malformado ou de ligação
  desconhecida é 4xx. O sinal fecha como `sumiu` a ligação que a máquina não
  tem mais (60 s de margem desde o pedido; datas comparadas como NÚMERO — o
  PostgREST devolve `+00:00`, o JS `Z`).
- A gravação: bucket PRIVADO `ligacoes`, `account-<conta>/ligacoes/<id>/…`;
  ouvir só por URL assinada curta, pela rota que confere a conversa (RLS).
  ⚠️ O Next guarda só 10 MB do corpo com o middleware e corta o resto SEM
  erro: a rota confere o tamanho lido contra o declarado. A faixa e o
  estéreo se cruzam (pedidos separados): escrever-e-reler dos dois lados.
  ⚠️ Só ligação ATENDIDA (`atendida_pelo_crm_em`) guarda: o contêiner que cai
  no toque reenvia, ao subir, o toque e o microfone do atendente. Com
  desfecho e sem atendimento, 2xx sem guardar (a máquina apaga a cópia); sem
  desfecho ainda, 409 (ela manda de novo em 5 min, e o sinal fecha a `sumiu`).
- O número à máquina: o do JID de telefone da conversa (nunca um LID); na
  recebida, o resolvido no `offer` (`cb_ligacoes_ao_vivo.telefone`). O
  recorte de conexões do perfil NÃO é conferido nas rotas, como em todo o
  projeto (`cb/conversas/abrir`): a tela da 4c mostra o botão só onde pode.
- A faixa leva `ligacao.ligacao_id` (4c): é por ele que o ▶ ouve. As faixas da
  4b não o têm (e as gravações delas foram apagadas).

## A tela (4c: `src/components/ligacoes/`, `src/lib/ligacoes/`)

- **O provedor mora na CASCA** (`dashboard-shell.tsx`, dentro da porta de
  entrada, `ativo` só depois do "Continuar"): trocar de tela não derruba a
  ligação. O painel, o cartão que toca e o `<audio>` da voz do cliente saem
  dele; o "Ligar" do fio o chama pelo contexto (fora dele, o botão some).
- ⚠️ **A oferta WebRTC se monta NO CLIQUE** (`audio-da-ligacao.ts`), com os
  candidatos dentro dela: a de 13 min falhou na 4b (o endereço público do
  NAT expira). A rota leva ~5 s (a ponte da máquina): o painel diz
  "Conectando o áudio…".
- ⚠️ **A linha ao vivo pelo tempo real, com releitura**: ao assinar, a cada
  reconexão e a cada 20 s com ligação na tela. O DELETE traz só a chave (RLS):
  o id apagado não volta numa releitura atrasada, e a linha que o tempo real
  trouxe DEPOIS de a releitura sair vale mais que ela (`releituraAoVivo`) —
  senão o toque que acabou de chegar sumia da tela. A releitura só conclui
  "a minha acabou" se saiu depois de o id da ligação ser conhecido.
- **Uma ligação por aba, sob trinco de POSSE** (`posseRef`): todo `await` de
  ligar/atender confere se a ligação ainda é a mesma. Desligar antes de a rota
  responder fica pendente e é feito quando ela responde (na recebida, antes
  disso daria `ainda_tocando`). A fase só ANDA (`faseSeguinte`), e a linha que
  OUTRA pessoa reivindicou não move o meu painel. ⚠️ O provedor DESMONTA
  quando a casca mostra o spinner (login, "Ver como" começando): a posse cai,
  o pedido pendente solta o microfone e a ligação que já existe é desligada
  (Codex, #500) — nunca uma ligação sem tela.
- **O botão** (`decidirBotaoLigar`) aparece só onde o `channel_id` CRU da
  conversa tem computador (o mesmo número que a rota usa) e fica desligado
  com o porquê (grupo, sem telefone, papel, computador fora ou sem WhatsApp,
  já em ligação, linha ocupada "com Ana", tocando agora). ⚠️ A lista de
  computadores (`/api/cb/ligacoes/computadores`, uma por aba, por minuto)
  carregando ou que FALHOU = sem botão, nunca desligado afirmando "fora do
  ar". Desligado por `aria-disabled`, para a dica do `title` aparecer.
- **O cartão que toca**: recebida `tocando` nas conexões do perfil REAL (como
  o aviso do navegador: o "Ver como" não cala uma ligação de verdade), papel
  de atendente. Atender e Silenciar, NUNCA Recusar (D12). O toque é um laço
  do Web Audio que só UMA aba toca (`navigator.locks`; a aba sem clique nem
  entra na fila, senão seguraria a vez muda). Silenciar vale para as minhas
  abas (localStorage). Com a aba escondida, o aviso do sistema para quem ligou
  o aviso do navegador. Toque de mais de 3 min não toca.
- **O poder é `make-calls`** (`canMakeCalls`, agent+, no editor de perfis);
  o perfil não tem seção própria (decisão à parte, §8.1 do plano).
- A faixa abre o player do fio (▶ Ouvir) pela ROTA estável
  (`/api/cb/ligacoes/<id>/gravacao`), nunca pela URL assinada.

## O aviso CALL

- ⚠️⚠️ **A Evolution só manda o aviso quando `CALL` está na lista de eventos
  da instância**, e a lista é gravada na criação. Conexão já existente só passa
  a receber depois de **"Ressincronizar"** (`WEBHOOK_EVENTS` em
  `evolution-provision.ts`). O sintoma da falta é ausência, não erro.
- ⚠️⚠️ **"Rejeitar ligação" e "mensagem ao ligar" da Evolution ficam
  DESLIGADOS** (`rejectCall`/`msgCall`): o primeiro recusa a chamada também nos
  celulares do escritório; o segundo sai em TODA ligação e volta pelo webhook
  como mensagem do aparelho — o CRM a leria como resposta de gente e apagaria o
  "em atraso".
- Uma ligação gera vários avisos com o mesmo `id`, em POSTs separados e sem
  ordem garantida: `offer` → sinalização → `terminate`/`timeout`/`reject`, e
  `accept` (vindo do PRÓPRIO aparelho do escritório) quando alguém atende no
  celular, no mesmo segundo do fim. `lerEventoDeLigacao` descarta o que não é
  uma dessas cinco situações.
- Só o `offer` diz quem ligou: no `accept` o `from`/`chatId` é o aparelho do
  escritório.
- Chamada de GRUPO é ignorada. Número de Meta Cloud API não tem este aviso.
- ⚠️⚠️ **A ligação FEITA pelo celular do escritório não gera aviso nenhum**
  (medido ao vivo em 26/09/2026): o WhatsApp só avisa os aparelhos conectados
  da chamada RECEBIDA. Não há como marcar a feita a partir do `CALL`.

## O desfecho

- Cada aviso grava SÓ as suas colunas em `cb_ligacoes`, e só se estiverem
  vazias (`.is(coluna, null)`): reentrega e ordem trocada não se atropelam.
- `accept` → **atendida**. Fim sem `accept` → **perdida**, mas só depois da
  FOLGA (`FOLGA_DO_DESFECHO_MS`, 10 s) contada do relógio do CRM
  (`encerramento_gravado_em`), nunca do `date` do WhatsApp: o `accept` do mesmo
  segundo pode estar noutro POST. `accept` atrasado mais que a folga sai como
  perdida (limite aceito).
- ⚠️ **Um UPDATE condicional (`desfecho IS NULL` + `select`) reivindica a
  linha**: só quem ganha grava a bolha. Ler-então-escrever gravaria duas.
- Sem `offer` gravado não se decide: a espera do `offer` decide quando ele
  chegar.

## Quem ligou

- Ordem: JID de telefone → acervo (`consultarTelefoneDoLid`, 1010) →
  `callerPn` conferido (`telefoneDoCallerPn`). ⚠️ **O LID jamais vira
  telefone** (a armadilha dos 8 últimos dígitos, `whatsapp-evolution.md`).
- ⚠️⚠️ O `callerPn` com o defeito do zero a mais (issue #2154 da Baileys:
  número de 12 dígitos + 0) é RECUSADO, nunca "consertado". Duas formas: 13
  dígitos sem o 9 na 5ª posição (fixo) e, com DDD 31 em diante (onde o
  WhatsApp registra o celular com 12), 13 dígitos terminados em 0 — o celular
  antigo começando em 9 + 0 é o número válido de OUTRA pessoa.
- O LID é comparado SEM o `:aparelho` (`lidSemAparelho`), no acervo e contra
  o `own_lid`.
- O acervo que NÃO RESPONDE (`consultarTelefoneDoLid` → `'falhou'`) vira
  `falhou`, nunca `sem_telefone`: seria afirmar que o CRM não conhece um
  cliente que ele conhece.
- Sem telefone resolvível → `sem_telefone`, sem bolha (a pessoa não aparece na
  tela: limite da v1). O próprio aparelho (`own_lid`) ou número de uma conexão
  da conta → `do_escritorio`.

## A bolha

- `content_type = 'call'`, `content_text` NULO, `message_id = 'call:<id>'`
  (o `UNIQUE (conversation_id, message_id)` descarta a segunda; 23505 é
  ignorado), detalhes em `messages.ligacao`.
- **Perdida** = `sender_type 'customer'`: não lida pela RPC atômica
  `bump_conversation_on_inbound` e o gatilho da 972 acende "em atraso".
  **Atendida** = `'agent'` + `from_device`: sem não lida, e a 972 apaga o "em
  atraso" (é resposta de gente).
- ⚠️⚠️ **`created_at` é a hora REAL: o fim (perdida) ou o `accept`
  (atendida), pelo relógio do WhatsApp — nunca a hora da decisão.** A perdida
  é decidida só depois da folga (~11 s) e a atendida em ~2 s: com a hora da
  decisão, no teste real de 26/09/2026 a recusada foi gravada DEPOIS da
  atendida que veio em seguida — fio na ordem trocada e "em atraso" aceso
  sobre cliente atendido. Se já há mensagem depois da ligação, a bolha é
  HISTÓRIA: não reabre, não sobe a conversa, não segue o canal, e chama
  `cb_assentar_mensagem_historica` (vigente: 1080), que acerta a espera e a não lida
  pela hora real — o gatilho da 972 decide pela ORDEM DE INSERÇÃO. A espera de
  antes e o "há mensagem depois?" são lidos ANTES do insert, e a pergunta se
  REPETE logo depois da reabertura (colada no insert): uma resposta gravada no
  meio faria a bolha subir a conversa sobre cliente atendido (Codex, PR #304).
  Não é atômico: sobra a janela entre a 2ª pergunta e a escrita na conversa
  (limite aceito, no plano). A faixa escreve `ligacao.inicio`.
- Com a conversa aberta, a bolha "no passado" é acrescentada no FIM da lista
  em memória (o tempo real não reordena, de propósito): quem pergunta por
  ORDEM (`aberturasDeCanal`, `ultimoCanalDoCliente`, o contador "N mensagens
  não lidas" e a âncora dele) passa por `naOrdemDoFio` (`ordem-do-fio.ts`).
- A ficha e a conversa nascem por `resolverDestinatario` (dono durável) quando
  o número nunca escreveu (decisão do operador), com o telefone no lugar do
  nome — o aviso não traz o perfil.
- Depois de gravar, na ordem: reabrir LOGO DEPOIS do insert (`reopen.ts`) →
  subir a conversa → seguir o canal (os três só quando a ligação é a última;
  a histórica assenta) → abrir o card no funil → ligar a bolha à linha.
- ⚠️ "Depois" inclui o MESMO segundo (`gte`, a própria bolha excluída na 2ª
  conferência): as mensagens da Evolution têm carimbo em segundos.

## O que NÃO roda — e há pino (`ligacoes.chamadores.test.ts`)

- ⚠️⚠️ Robô, automações, IA, `persistInboundMessage`/`persistDeviceMessage`,
  o núcleo de envio e `registrarEntrega` ficam FORA: a ligação não tem texto a
  responder, e um robô respondendo "não entendi" a uma chamada é o pior caso.
- ⚠️⚠️ **A ligação NÃO para as sequências "parar se o cliente responder"**
  (decisão do operador, 26/09/2026: só mensagem escrita é resposta). São DUAS
  pontas: `cancelarEsperasPorResposta` não é chamada aqui (pino), e
  `clienteRespondeuDesde` — a segunda linha de defesa, na retomada — filtra
  `content_type <> 'call'`, senão a perdida (linha do cliente) pararia a
  sequência quando a espera acordasse.
- ⚠️ O webhook de saída NÃO emite nada: nem `message.received`, nem
  `conversation.created` (ele quer dizer só "o cliente abriu a conversa
  ESCREVENDO" — contrato publicado).
- ⚠️ O CARD que a ligação abre segue o caminho de todo card novo: as
  automações da etapa de entrada e o `deal.created` rodam (D5 do plano).
- Ligação que cria a ficha não dispara "Novo contato criado", e a perdida
  antes da 1ª mensagem faz "Primeira mensagem" não disparar para aquela
  conversa (a contagem é por linha do cliente). Limite escrito no plano.

## Quem lê `content_type` (conferir a cada tipo novo)

- `aviso-de-ligacao.tsx`: a ligação pelo CRM (`ligacao.pelo_crm`) tem texto
  próprio, neutro (nunca vermelha), com quem ligou ou atendeu e a duração.
- `message-bubble.tsx` (retorno cedo para `<AvisoDeLigacao>`) e
  `message-thread.tsx` (a ligação sai do `MessageActions`, como o aviso de
  grupo — senão haveria "apagar para todos" numa ligação — e desenha o
  `SeparadorDeCanal` quando ABRE um trecho de outro número).
- Núcleo de envio: citar uma ligação é 400 (o `call:<id>` não existe no
  WhatsApp). Aviso do navegador: a perdida tem rótulo próprio (`labels.call`).
- A prévia no banco é o marcador `[call]` (`PREVIA_DA_LIGACAO`), o formato de
  todo tipo sem texto; a lista, o card do funil e o tempo real
  (`comMensagemNova`) o trocam por "📞 Ligação" (`ehPreviaDeLigacao`).
- Radar (`textoDe` do worker): a ligação é linha do transcrito (a pelo CRM com
  rótulo e resumo próprios, 4d).
- "Comparar" da possível duplicata (`comparar-fichas-dialog.tsx`, 1088): a
  ligação sai como "📞 Ligação" (`Inbox.ligacao.previa`), nunca "Anexo".
- Agente de IA (1049): a ligação não abre turno (`abreTurno` só aceita
  `TIPOS_QUE_ABREM_TURNO`) e, sem texto, fica fora do contexto que ele lê
  (`ia-agentes/contexto.ts`) — menos a pelo CRM TRANSCRITA, que entra como
  nota (`ligacoes-transcricao.md`). A ATENDIDA pausa o agente da conversa
  (`cb_pausar_ia_por_gente`): é resposta de gente.
- Painel: `.neq('content_type', 'call')` nas contagens de mensagem — a
  atendida é `agent`, e contaria como mensagem enviada. A série "Conversas ao
  longo do tempo" soma no banco (1095) e filtra lá; o tempo de resposta conta
  a ligação, como sempre contou. O Meu dia deixou de
  contar mensagens na v2 (29/09/2026); quem voltar a contar repete o filtro.
- ⚠️ `messages_content_type_check` é do upstream: um merge que o recrie tira
  o `'call'`, e a ligação passa a ser recusada com 23514, sem aviso na tela.

## A tabela

- `cb_ligacoes` é FECHADA ao navegador (RLS sem policy, REVOKE das duas
  metades): a tela lê a mensagem, nunca a tabela. Chave `(account_id,
  call_id)` TOTAL — alvo do `ON CONFLICT` do upsert.
