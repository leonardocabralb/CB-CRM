---
paths:
  - "src/lib/automations/variaveis/**"
  - "src/components/automations/variaveis/**"
  - "src/app/api/automations/previa/**"
---

# Automações — seletor de variáveis e prévia

O botão "Inserir campo", o editor com etiquetas e a prévia com um cliente
escolhido (29/09/2026, `docs/PLANO-seletor-de-variaveis.md`). O motor e a
interpolação: `.claude/rules/automacoes.md`, seção "Variáveis".

- ⚠️⚠️ **O TEXTO GRAVADO NÃO MUDA.** O documento do CodeMirror É a string;
  a etiqueta é decoração `replace` + `atomicRanges`, nunca conversão ida e
  volta. Só `\n` separa linhas (`lineSeparator`): o padrão trocaria `\r\n`
  por `\n` na primeira tecla. Valor que muda por FORA entra por
  `view.setState` (fora dos ouvintes: não volta como `onChange`, e zera o
  desfazer); render ATRASADO de algo que o próprio editor emitiu é eco, nunca
  troca (`decidirSincronia` — input fora de evento discreto no celular).
  Decisão do operador (D3): não quebrar as automações ligadas, as nossas e as
  da iMotion. Pino nas peças puras (`editor-com-etiquetas.test.ts`); a
  montagem precisa de DOM e se confere no preview.
- ⚠️ **A etiqueta sai da régua do motor**: `FONTE_DO_CODIGO` é o
  `RE_VARIAVEL` do `engine.ts` (pino lendo o fonte) e `classificarCodigo`
  espelha `valorDaVariavel` (teste cruzado em `engine.test.ts`). Variável
  nova no motor entra em `VARIAVEIS_FIXAS` e nos dois dicionários
  (`Automations.variaveis.fixas.<chave>`); sem isso ela funciona mas não
  aparece no botão. Etiqueta ÂMBAR = o motor deixa em branco (ou variável de
  outro gatilho).
- ⚠️ **Exemplo de `{{vars.*}}` sai das funções REAIS** (`montarVariaveis`,
  `variaveisDoAgendamento`, `variaveisDoDocumento`) com entrada fictícia —
  condição do operador (D2): exemplo sem manutenção. Nunca texto pronto. Os
  nomes (`NOMES_DO_EVENTO`) também saem delas; `catalogo.test.ts` cobra nome
  e legenda nos dois dicionários e reprova entrada órfã. O webhook de entrada
  mostra o último acionamento REAL.
- ⚠️ **A prévia é de ADMIN e só LÊ** (`valoresParaPrevia`, service role,
  contato conferido pela conta antes): passaria por cima do escopo de
  conversas de um perfil. Lê em modo `estrito` — leitura que falha LANÇA e a
  rota dá 500, nunca "vazio" sobre campo com valor; o ENVIO segue tratando a
  falha como variável vazia. O valor nunca vai para log (um campo guarda a
  senha do gov.br).
- **`modo` é o do `interpolate` naquele campo** e vale para o painel e para a
  prévia: `cru` no valor do "Atualizar campo", no corpo do webhook e no final
  do botão de URL do modelo. **Prévia desligada onde mentiria**: corpo do
  webhook (o motor escapa para JSON) e botão de URL (o motor codifica).
- **O nome no cartão fechado só em `send_message`/`send_to_number`**: o corpo
  dos botões e a URL do webhook NÃO são interpolados, e o nome ali prometeria
  uma troca que não acontece.
- **`{{deal.*}}` nos gatilhos que trazem o card do EVENTO**
  (`gatilhoTrazCard`): o envio usa o card do evento; a prévia, sem evento,
  usa o de `negocioAlvo`. Com mais de um card no cliente, a prévia marca
  "card do evento?" (a rota devolve `negocios`) — nunca afirma o valor.
- Estados da prévia e do último acionamento são CARIMBADOS (`de`) e
  comparados com a entrada do render atual (efeito passivo, CLAUDE.md 8c).
- Monoespaçado por `FONTE_MONO` (a classe `font-mono` sai na Inter); cor em
  par claro/escuro com a primeira valendo nos dois (`dark:` inerte).
