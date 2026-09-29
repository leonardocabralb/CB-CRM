# Plano — seletor de variáveis nas automações

Pedido do operador (29/09/2026): nos passos das automações, escolher os campos
(variáveis) numa lista com legenda, em vez de decorar códigos, e ver uma PRÉVIA
de como a mensagem sai para um cliente escolhido — no molde do seletor da Make.

## Estado

| Fase | O quê | Estado |
| ---- | ----- | ------ |
| F0 | Estudo e decisões | ✅ 29/09/2026 |
| F1 | Editor com etiquetas + botão "Inserir campo" + painel | ✅ 29/09/2026 |
| F2 | Prévia com um cliente + exemplos das variáveis do evento | ✅ 29/09/2026 |
| F3 | Revisão, teste no preview, PR | revisão ✅; PR a abrir |

### Medido no preview (29/09/2026, branch `feat/seletor-de-variaveis`)

Com a gravação em `/api/automations` BLOQUEADA na aba (nenhuma escrita):

- "Lembrete · vence hoje" (Asaas, desligada): as três `{{vars.*}}` viram
  etiquetas com nome; o painel lista a cobrança do Asaas (13), contato (6),
  os 5 blocos de campos da ficha, negócio, conversa e data; a prévia com o
  lead de teste diz "Olá, Leonardo!" (o exemplo usa o nome do cliente) e os
  valores reais dele aparecem no painel (empresa vazia em âmbar).
- Inserir pelo painel (sem ter clicado no texto) escreve no FIM; Cmd+Z
  desfaz; depois de inserir e desfazer, o texto do editor é IDÊNTICO ao do
  banco (195 caracteres, comparação exata).
- "Calendly → Reunião agendada" (ligada, só aberta): etiquetas do Calendly,
  do contato e de campo da ficha no "Avisar um número"; no "Atualizar
  campo", a prévia em modo cru; Enter não quebra o campo de uma linha.
- Impressão digital de `automation_steps` e `automations` (md5 de todos os
  passos e de `updated_at`/`is_active`) igual antes e depois do teste.
- Tema claro e escuro conferidos.

### Revisão independente (29/09/2026)

Nenhum P1 (as quatro garantias resistiram). Corrigido:

- P2: o nome no cartão fechado só nos passos que o motor interpola
  (mensagem e aviso) — o corpo dos botões e a URL do webhook saem crus; e
  código com alerta fica como está.
- P2: a prévia lê em modo ESTRITO (`carregarDadosDoContato`/`carregarNegocio`
  com `estrito`): leitura que falha é 500, nunca "vazio" sobre campo com
  valor. O envio segue como antes.
- P3: Shift+Enter sem o recuo de editor de código; `\r` preservado
  (`lineSeparator`); render atrasado reconhecido como eco
  (`decidirSincronia`); valor de fora entra por `setState` (zera o desfazer);
  `modo` separado de `previa` (o painel mostra o valor cru no corpo do
  webhook e no botão de URL); Enter no painel só com busca; frases da prévia
  em cada estado; "Atualizar campo" diz que valor vazio não altera a ficha.
- Ficou de fora: escolher o cliente de dentro do painel (a escolha fica na
  prévia de um texto de mensagem).

### Revisão final (29/09/2026, pedida pelo operador)

Dois revisores independentes — o código depois das correções e a
compatibilidade com a iMotion. Nenhum P1 nem P2. Confirmado com evidência:
nada em `/api/v1` nem nos webhooks de saída `deal.*` (o do Make, 71fa9f36)
mudou; o envio do motor é idêntico (os parâmetros novos têm padrão que
preserva o antigo, e nenhum chamador de envio os passa); todo código em uso
nas automações ligadas de funil (as que os movimentos de card da iMotion
disparam) é reconhecido como pelo motor, e as `field_key` existem; salvar sem
editar grava o `step_config` idêntico. Corrigidos os dois P3: escolher de novo
o mesmo cliente refaz a prévia que falhou (`tentativa`), e valor gravado que
não é texto não derruba o editor (`comoTexto`, só para exibir).

### Codex (PR #348)

- 1ª rodada, P2: nos gatilhos cujo EVENTO traz o card (`deal_stage_changed`,
  `deal_status_changed`, `zapsign_documento_assinado` — `gatilhoTrazCard`), o
  envio usa aquele card em `{{deal.*}}`, e a prévia usa o de `negocioAlvo`.
  Corrigido sem inventar card: a rota devolve quantos cards o cliente tem, e
  com MAIS DE UM a prévia marca `{{deal.*}}` como "card do evento?", dizendo
  que no disparo vale o card do evento. Com um card só, o valor é exato e sai
  sem marca. Conferido no preview (1 card real: sem marca; 2 simulados na
  aba: com marca).
- 2ª rodada, P2: falha ao ler o último acionamento do webhook fazia o grupo
  SUMIR (parecia "não há variáveis"), sem jeito de tentar de novo. Agora a
  nota diz "carregando", "não foi possível" (com "Tentar de novo", carimbo
  com a tentativa) ou "nunca acionado"; os campos da ficha que falham também
  ganharam "Tentar de novo". Conferido no preview com a falha simulada na
  aba.
- 3ª rodada (o pedido do commit `094276b` voltou com erro do próprio Codex,
  "git ref does not exist"; pedido de novo depois do merge do `main`), P2:
  "Novo contato criado" escondia `{{message.text}}` e marcava o uso como
  indisponível, mas só a ingestão de mensagem o despacha, com o texto no
  contexto (webhook da Meta e `inbound-store.ts`). Entrou em
  `gatilhoDeMensagem`, com teste.

## Decisões do operador (29/09/2026)

- **D1 — etiqueta com o nome (opção B da maquete).** O campo inserido aparece
  no texto como etiqueta com o NOME e o código juntos, como na Make. A opção A
  (código colorido, nome embaixo) foi descartada.
- **D2 — exemplo nas variáveis do evento, desde que não peça manutenção.**
  Cobrança do Asaas, agendamento do Calendly e assinatura do ZapSign só existem
  no instante do evento; a prévia mostra um EXEMPLO marcado. Condição do
  operador: o exemplo não pode depender de alguém atualizá-lo quando o código
  mudar. Por isso o exemplo é GERADO pelas mesmas funções que montam as
  variáveis reais (`montarVariaveis`, `variaveisDoAgendamento`,
  `variaveisDoDocumento`), alimentadas com dados fictícios fixos: mudou o
  formato no código, o exemplo muda junto; variável nova aparece sozinha, e um
  teste obriga nome e legenda nos dois dicionários. O webhook de entrada usa o
  dado REAL do último acionamento (a tela do gatilho já o busca).
- **D3 — não quebrar as automações ligadas hoje no CRM, as nossas e as criadas
  pela iMotion.**

## Desenho

- **O texto gravado não muda de formato.** Continua a string com `{{…}}` que o
  motor já lê; o editor só MOSTRA cada código como etiqueta. Medido em
  29/09/2026: 46 códigos diferentes em uso em produção, todos no formato
  padrão, nenhum `\r` e nenhum espaço dentro das chaves.
- **Editor: CodeMirror 6** (`@codemirror/state`, `@codemirror/view`,
  `@codemirror/commands`). O documento dele É o texto puro, sem conversão ida e
  volta; a etiqueta é uma decoração que SUBSTITUI o código na tela
  (`Decoration.replace` + `atomicRanges`). Copiar leva o código, desfazer é o
  do editor, e acentos por tecla morta (composição) são tratados por ele. Um
  editor próprio sobre `contenteditable` teria de reimplementar tudo isso, e é
  exatamente onde texto de mensagem se corrompe.
- **Etiqueta = o que o motor substitui.** A régua é a MESMA expressão do
  `RE_VARIAVEL` do `engine.ts` (pino lendo o fonte): o que não casa fica texto,
  como no envio. Código que o motor não reconhece (ex.: `{{1}}` numa
  mensagem, `vars.*` de outro gatilho, campo apagado) vira etiqueta ÂMBAR com o
  motivo: "sai em branco".
- **Nada muda sem o operador mexer:** abrir e salvar um passo sem tocar no campo
  mantém o texto idêntico. O valor que muda por fora entra por `setState`
  (fora dos ouvintes: não volta como `onChange`, e zera o desfazer), e o
  render atrasado de algo que o próprio editor emitiu é eco, nunca troca
  (`decidirSincronia`). `\r` preservado (`lineSeparator`). Pino nas peças
  puras (`editor-com-etiquetas.test.ts`); a montagem, que precisa de DOM, foi
  conferida no preview.
- **Painel "Inserir campo"**: busca + grupos recolhíveis (Contato, Campos da
  ficha por bloco, Negócio, Conversa, Data e hora, Mensagem recebida e o grupo
  do gatilho). Cada item: nome, legenda, código e o valor do cliente da prévia.
  Clicar insere no cursor.
- **Prévia (F2)**: um cliente escolhido UMA vez vale para a automação inteira
  (não é gravado). Os valores vêm de uma rota só de leitura que chama as MESMAS
  funções do envio (`carregarDadosDoContato`, `carregarNegocio`,
  `valorDaVariavel`): a prévia não tem cópia das regras, então não diverge do
  envio. Lê em modo ESTRITO (leitura que falha é 500, nunca "vazio"). Não
  grava, não envia, não registra valor em log.

- **Cartão fechado**: o resumo troca o código pelo nome ("Olá, [Primeiro
  nome do cliente]!"), como no editor.
- **Valores do "Enviar modelo" empilhados** (eram duas colunas): o editor com
  etiquetas e o botão não cabem em meia largura. A reserva continua texto.

## Onde entra

Todo campo que aceita variável: texto do "Enviar mensagem" e do "Avisar outro
número", legenda da mídia, título e descrição da tarefa, valores do "Enviar
modelo", título do "Criar negócio", valor do "Atualizar campo" e corpo do
"Enviar webhook". Os cartões dos gatilhos (Asaas, Calendly, ZapSign, webhook)
continuam com a lista deles.

## Limites conhecidos

- `vars.*` também chegam por encadeamento (etiqueta aplicada por uma automação
  do Calendly repassa as variáveis dela). O painel oferece só as do PRÓPRIO
  gatilho; digitar à mão continua valendo, e a etiqueta sai âmbar ("pode sair
  em branco").
- A prévia não inclui o "Assinar como" da conta.

## Arquivos

- `src/lib/automations/variaveis/` — `codigos.ts` (a régua do motor),
  `catalogo.ts` (o espelho de `valorDaVariavel`) e `exemplos.ts` (puros, com
  teste).
- `src/components/automations/variaveis/` — `editor-com-etiquetas.tsx` (o
  CodeMirror), `painel.tsx` (o "Inserir campo"), `contexto.tsx` (nomes,
  prévia, exemplos) e `campo-com-variaveis.tsx` (rótulo + botão + editor +
  prévia).
- `src/components/automations/automation-builder.tsx` — troca os campos
  (trecho nosso em arquivo do upstream: linha em `docs/MERGE-UPSTREAM.md`).
- `src/lib/automations/engine.ts` — `valoresParaPrevia` exportada, só leitura,
  e o modo `estrito` das duas leituras que ela usa (idem).
- `src/app/api/automations/previa/route.ts` — a rota da prévia.
- `messages/en.json` e `messages/pt-BR.json`.
