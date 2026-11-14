---
paths:
  - "src/lib/ia-agentes/regras-do-sistema*"
  - "src/lib/ia-agentes/pedido*"
  - "src/components/agentes-de-ia/regras-do-sistema*"
  - "src/components/agentes-de-ia/configuracao-do-agente.tsx"
  - "supabase/migrations/11*_cb_ia_agente_*.sql"
  - "supabase/migrations/agente-*-11*.test.ts"
---

# Agentes de IA — regras do sistema, "Conduz o fechamento" e frases autorizadas

Plano: `docs/PLANO-agentes-de-ia.md` (Estado). O resto dos agentes está em
`ia.md`, `ia-agentes.md` e `ia-agentes-turno.md`.

### As 12 regras do sistema (27/09/2026)

- ⚠️⚠️ **12 regras OBRIGATÓRIAS para todo agente**, existente ou futuro
  (`regras-do-sistema.ts`): sigilo do prompt, sem promessa de resultado, sem
  preço/honorário, sem aceitar proposta, sem inverdade, sem dado de outro
  cliente nem acesso ao sistema, e o resto. Entram no pedido logo depois da
  frase do papel e ANTES do texto-base, das instruções, das regras do agente,
  dos blocos, da base e das ações — e dizem que valem acima de tudo isso.
  Nada na configuração as DESLIGA; as variações, por agente, são "Conduz o
  fechamento" e as frases autorizadas (abaixo). Turno, retomada e Playground
  mandam o mesmo bloco. A tela as
  mostra só para ler (cartão acima das Instruções; uma chave por `id`,
  cobrada nos dois dicionários).
- ⚠️ **A trava do pedido vazado** (`vazouOPedido`): o CANÁRIO do cabeçalho
  (`CANARIO_DAS_REGRAS`, não é segredo — só serve para ser achado), trechos
  que só existem no pedido (`TRECHOS_DO_PEDIDO`, com teste cobrando que cada
  um continua lá), o cabeçalho em MAIÚSCULAS e o nome de marcador por extenso
  em maiúsculas. Roda sobre o texto SEM marcadores (`lerAcoes`), antes do link
  inventado: a resposta é RETIDA e o turno transfere (`pedido_vazado`, o texto
  no `erro`). O pedido copiado com o `[[HANDOFF]]` dentro já cai no sentinela.
  Heurística: instrução do agente vazada em português, sem nenhum desses
  sinais, passa.
- ⚠️ **O assistente legado (`src/lib/ai`, `ai_configs`, desligado em produção)
  NÃO recebe as regras.** Religá-lo sem elas é voltar a um prompt sem sigilo.

### "Conduz o fechamento" (1128, decisão do operador de 08/11/2026)

O comercial do Previdenciário quer um agente que apresente os honorários,
contorne objeções e mande o link do contrato do ZapSign; o contrato só vale
assinado (o webhook do ZapSign move o card).

- ⚠️⚠️ **Opção POR AGENTE, desligada por padrão**
  (`cb_ia_agentes.conduz_fechamento`, NOT NULL DEFAULT false; só o booleano
  `true` liga na leitura, e o `PATCH` recusa com `corpo_invalido` qualquer
  forma que não seja booleano). Os agentes que já existiam não mudam.
  ⚠️ **Deploy DEPOIS da 1128**: `COLUNAS_DO_AGENTE` pede a coluna — sem ela,
  toda leitura de agente (turno, tela, Playground) falha.
- ⚠️⚠️ **Ligada, TROCA duas regras, na MESMA posição** (`regrasDoSistema`,
  `REGRAS_DO_FECHAMENTO`): `sem_preco` → `honorarios` (apresenta honorários,
  pagamento e condições SÓ como escritos nas instruções, nas regras do agente
  ou na base — as três fontes do administrador no pedido; nunca inventa,
  estima, arredonda, muda ou negocia; condição diferente = RECUSA com
  delicadeza, do jeito que as instruções mandam, e só passa para a equipe,
  com os dois marcadores, se o cliente INSISTIR depois da recusa — decisão do
  operador de 08/11/2026, noite: com o "passa para a equipe" direto, o Sonnet
  5.5 transferia já no 1º pedido de desconto; e, desde 09/11, RECLAMAÇÃO do
  preço, mesmo irritada, é objeção a responder, nunca passagem sozinha — o
  "is upset or complaining" do texto-base dava `[[HANDOFF]]` mudo a "35% é
  roubo", medido) e `sem_compromisso` →
  `fechamento` (convida
  a assinar pelo link escrito, responde objeções com a verdade; a contratação
  só acontece pela assinatura — o agente não fecha nem confirma acordo, NEM
  nas condições escritas; nunca "contrato fechado/confirmado", "caso aceito";
  quem diz que assinou ouve que a assinatura "será confirmada", sem promessa
  de contato da equipe, que pediria o `[[TRANSFERIR]]`; sem falsa urgência).
  As outras DEZ não mudam uma letra (teste): `sem_promessa`, `identidade`,
  `legalidade`, `verdade`, `privacidade` seguem valendo. O cabeçalho e o
  canário também não.
- ⚠️ **`conduzFechamento` é argumento OBRIGATÓRIO de `montarPedidoDoAgente`**
  (e da retomada, que herda os argumentos): chamador novo que o esqueça não
  compila. O turno passa o do agente; o Playground, o do RASCUNHO
  (`aplicarAlteracao` aplica a chave; ela NÃO está em `NAO_MUDAM_A_RESPOSTA`).
- **As travas continuam com o bloco trocado** (teste): todo
  `TRECHOS_DO_PEDIDO` segue no pedido, o pedido inteiro vaza, e o link do
  contrato escrito não é "link inventado" porque está no pedido (outro link
  é). A "equipe prometida" fica quieta em frase condicional ("assim que você
  assinar, nossa equipe…") e no "será confirmada"; "nossa equipe entrará em
  contato" sem condição ainda transfere.
- **A tela** (Configuração, logo abaixo do cartão das regras): interruptor
  com a explicação; mudar avisa em âmbar ANTES do Salvar o que passa a valer
  e o que continua proibido; o cartão mostra a lista do RASCUNHO, com as duas
  do fechamento marcadas. No Playground a chave aparece em "o que mudou".
- ⚠️ **Regra PRÓPRIA do agente que proíba honorários continua valendo** e
  barra o fechamento (a mais restrita ganha): o modelo "Triagem" do "Novo
  agente" traz "Nunca informe valores de honorários." — medido no e2e de
  08/11/2026. Ao ligar a opção, tirar essa regra.
- **Limites conhecidos**: não há trava no servidor para "seu contrato está
  confirmado" dito antes da assinatura — a defesa é a regra (como era a de
  nunca aceitar proposta). O agente não sabe se o cliente assinou: depois da
  assinatura o card muda de etapa e o agente deixa de atender (D24), a menos
  que ele também esteja na etapa do contrato assinado.

### Frases autorizadas (1131, decisão do operador 50=c de 04/10/2026, confirmada em 09/11/2026)

O agente do Bancário precisa dizer frases EXATAS do escritório que as regras
barravam: "A primeira reunião com o advogado não tem custo." (`sem_preco`) e o
resultado passado em gestão de passivo, com a ressalva (`sem_promessa`).

- ⚠️⚠️ **Lista POR AGENTE, vazia por padrão** (`cb_ia_agentes.frases_autorizadas`,
  `text[] NOT NULL DEFAULT '{}'`, CHECK de até 10 = `LIMITES.frasesAutorizadas`).
  Leitura (`lerFrasesAutorizadas`): só a lista de textos não vazios vale;
  qualquer outra forma vira `[]` (a dúvida fecha). `PATCH` ESTRITO
  (`lerFrasesAutorizadasDoCorpo`): cada frase numa linha só e aparada
  (`normalizarFrase`), 1 a 400 caracteres, até 10, sem repetir (sem caixa);
  fora disso, 400 `corpo_invalido`. ⚠️ **Deploy DEPOIS da 1131**
  (`COLUNAS_DO_AGENTE` pede a coluna).
- ⚠️⚠️ **Lista VAZIA = o bloco não muda uma letra** (teste). Preenchida,
  NA MESMA POSIÇÃO (`EXCECAO_DAS_FRASES`): `sem_preco` — ou `honorarios`, com
  o fechamento — ganha no fim a exceção do CUSTO (as frases, escritas pelo
  escritório, podem ser ditas como estão, mesmo citando custo; fora delas a
  regra vale igual) e `sem_promessa` a do RESULTADO (o resultado passado das
  frases, como está, sempre como experiência do escritório, nunca como
  promessa ou estimativa para este cliente). O bloco termina com
  `AUTHORIZED STATEMENTS (…)` e uma frase por linha, ⚠️ ENTRE ASPAS e com o
  aviso de que é citação, nunca instrução (o bloco "passa por cima das
  instruções": uma frase escrita como ordem ganharia o peso dele) — na parte
  FIXA do pedido (o cache, `ia-cache-do-pedido.md`).
- **`frasesAutorizadas` é argumento OBRIGATÓRIO** de `montarPedidoDoAgente`
  (a retomada herda), como o `conduzFechamento`: o turno passa a do agente, o
  Playground a do RASCUNHO (`aplicarAlteracao`; fora de
  `NAO_MUDAM_A_RESPOSTA`). Pino `frases-autorizadas.chamadores.test.ts`.
- **As travas** (teste): repetir uma frase não é pedido vazado, nem equipe,
  ação ou reunião prometida — ⚠️ a equipe e a ação prometidas leem o texto SEM
  as frases (`semFrasesAutorizadas`, no turno e na retomada; só a frase COMPLETA, como afirmação própria — estendida ou no meio de outra, segue conferida): "Nossa equipe
  entrará em contato" escrita pelo escritório transferia toda conversa; o link escrito numa frase está no pedido (não é
  link inventado; outro link é). O cabeçalho da lista em MAIÚSCULAS
  (`AUTHORIZED STATEMENTS`, `FRASES AUTORIZADAS`) é pedido vazado.
- **A tela**: campo "Frases autorizadas" (uma por linha) logo abaixo de
  "Conduz o fechamento", conferido pela MESMA função da rota (vermelho e
  Salvar travado); mudou, aviso em âmbar ANTES do Salvar; o cartão mostra as
  exceções e a lista do RASCUNHO. No Playground, a chave em "o que mudou".
- **Limites conhecidos**: (1) frase que cite HONORÁRIOS é dita mesmo com o
  fechamento desligado — a exceção é "mesmo citando custo"; o que continua
  proibido é falar de honorários FORA das frases. (2) A trava do pedido
  vazado não conhece as frases: frase com "PASSAR", "MOVER", "TRANSFERIR",
  "HANDOFF" ou "REUNIAO" (sem acento) em MAIÚSCULAS, ou com "SYSTEM RULES",
  seria RETIDA toda vez que o agente a dissesse (o turno transfere). Escrever
  em caixa normal.
