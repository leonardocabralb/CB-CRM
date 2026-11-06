---
paths:
  - "src/lib/contacts/cliente-ideal*"
  - "src/components/settings/cliente-ideal-settings.tsx"
  - "src/hooks/use-clientes-ideais*"
  - "src/components/contacts/selo-de-cliente-ideal.tsx"
  - "src/components/inbox/painel/bloco-do-cliente-ideal.tsx"
  - "src/components/pipelines/so-clientes-ideais.tsx"
  - "src/components/pipelines/pipeline-board.tsx"
  - "supabase/migrations/1124_cb_perfis_de_cliente_ideal.sql"
---

# Cliente ideal (ICP) — regras

Pedido do operador (05/11/2026): marcar o cliente ideal na conversa e no card.
Plano vivo: `docs/PLANO-cliente-ideal.md`; decisões em
`docs/DECISOES-DO-OPERADOR.md`. Campos personalizados em si →
`campos-e-nome.md`.

### A regra mora no BANCO (1124)

- ⚠️⚠️ **Quem decide é `cb_clientes_ideais(p_conta, p_contato)`**, sempre
  comparando respostas NORMALIZADAS (`cb_resposta_normalizada`: espaço
  repetido vira um, apara, minúsculas). Nada de regra em TS: o espelho
  `respostaNormalizada`/`criteriosValidos` (`src/lib/contacts/cliente-ideal.ts`)
  só serve à tela antes de gravar, com pino lendo a migration.
- **Perfis com nome por conta** (`cb_perfis_de_cliente_ideal`, D6): todos os
  critérios casam (E); dentro de cada um, basta uma resposta (OU). Contato que
  casa com dois perfis fica com o MELHOR nível e, no empate, o de menor
  `posicao`.
- **"ICP?" (`possivel`)**: o PRIMEIRO critério casa, os outros casam ou estão
  VAZIOS, e ao menos um vazio. Resposta preenchida que não casa tira de
  qualquer selo. A ordem dos critérios na tela é load-bearing.
- ⚠️ **Campo apagado invalida o perfil INTEIRO** (ninguém casa por ele):
  ignorar o critério marcaria gente demais. A tela avisa e recusa salvar.
- ⚠️ **"Respondeu" NÃO é critério** (D5, decisão do operador): vira o retrato
  de `cb_cliente_ideal_do_contato` (mensagens do cliente, nossas, as que não
  saíram). Com ele, o selo escondia justo quem a equipe deve LIGAR.

### Calculado na LEITURA, sem carimbo

- ⚠️⚠️ **Nenhum gatilho, nenhuma coluna em `contacts`**: por isso a Lixeira
  (1097), a união de fichas (1093) e a carga não mudam, e mudar a regra vale na
  hora. Quem criar o carimbo `ideal_desde` (Fase 4, aviso "virou ideal") cria
  gatilho em `contact_custom_values`: entra com o sinal `cb.lixeira` no
  `WHEN` e na receita da união (`supabase.md`).
- ⚠️ **Leitura do navegador PAGINADA** (`lerClientesIdeais`): o PostgREST
  corta em 1000. `null` = "não sei" (selo cala, contagem diz indisponível),
  nunca lista vazia.

### O selo (Fase 2): lista, card, cabeçalho e painel

- ⚠️ **UMA leitura por página** (`useClientesIdeais`): a caixa de entrada a
  passa à lista e ao fio; o quadro, aos cards. Ao card e à linha vai o NÍVEL
  (primitivo), nunca o mapa: o `memo` dos ~120 cards só segura com prop
  estável. O fio recebe o nível derivado NO RENDER pelo contato aberto (o
  mapa é da conta: a troca de conversa não mostra o selo do anterior).
- **Relê** no `resyncToken`, a cada 5 min com a aba visível (o Typebot grava
  pela API, sem evento na tela) e no `EVENTO_CLIENTE_IDEAL`, disparado pela
  fila do `CampoComSalvamento` quando a ficha grava um campo. Recarga que
  falha mantém a anterior.
- ⚠️ **Na LINHA da lista o selo é COMPACTO (só o diamante)**: com "ICP"
  escrito, a linha com raio e atraso espremia o NOME até sumir (medido no
  preview, 05/11/2026). No card e no cabeçalho, com o texto. No cabeçalho
  ele mora DENTRO do nome: com o painel aberto em tela de ~1440 px o nome já
  some (a barra de ícones toma a linha) e o selo some junto — o bloco do
  painel cobre. Tirá-lo do nome o faria vazar por cima dos ícones.
- **Borda dourada só no ICP, por `ring`** (o `hover:border-border` venceria um
  `border-*`); o "ICP?" é só contorno, sem borda no card. Grupo nunca tem selo.
- **O porquê no painel** (`BlocoDoClienteIdeal`, abaixo do responsável, em
  qualquer aba) lê `cb_cliente_ideal_do_contato` por contato, carimbado com o
  dono (efeito passivo); carregando ou com falha, não desenha nada.

### O filtro (Fase 3): caixa de entrada e quadro

- **Só o nível `ideal`** nos dois: o "ICP?" fica de fora (se pedido, uma
  segunda opção). A régua é o MESMO mapa do selo, nunca uma cópia.
- **Caixa de entrada:** interruptor no painel de filtros, o molde de
  "Inadimplentes" (`clientesIdeais` em `FiltrosDoInbox`, no contexto e nos
  filtros salvos). Mapa `null` NEUTRALIZA (a dica diz "conferindo"); mapa sem
  ninguém ideal recorta tudo, e é verdade. Só é oferecido com alguém ideal.
- ⚠️⚠️ **Quadro: a lista enxuta NÃO traz `contact_id`, e não deve ganhar.**
  Com ela, todo funil pagaria ~20% a mais por card em toda carga. O
  interruptor pergunta à parte, SÓ ligado e no Quadro, os negócios dos
  contatos ideais (`lerNegociosDosContatos`: lotes de 100 ids na URL, cada um
  paginado; de todos os funis) e o quadro recorta a lista INTEIRA antes do
  teto por coluna (`visiveis`): contador e soma da coluna passam a ser dos
  mostrados; os números do topo seguem sendo do funil. `negociosIdeais` nulo
  (carregando ou falhou) = não recorta; o botão mostra o giro ou o aviso.
- **O interruptor volta no ponto de retorno** (`soClientesIdeais`, as duas
  saídas para o inbox): a rolagem e os tetos foram medidos no quadro
  filtrado. A releitura dos negócios segue o mapa e as RELEITURAS da lista
  inteira (`leiturasDosNegocios`: carga, salvamento, volta ao app) — nunca o
  tamanho dela, que não muda quando se troca o contato de um card.
- O mapa do quadro é lido pela PÁGINA (o cabeçalho também o usa) e desce ao
  quadro por prop: UMA leitura por página continua valendo.

### A tela (Configurações → Campos e etiquetas)

- Só para quem edita configurações; escrita é admin pelas policies da 1124 (o
  mesmo piso de `ESCRITA_DA_SECAO.fields`). Toda escrita confere o retorno
  (`.select('id')`): RLS que barra devolve 0 linhas sem erro.
- **As respostas oferecidas são as GRAVADAS** (`cb_respostas_do_campo`,
  agrupadas no banco, teto de 200), mais as opções do campo Lista e as já
  marcadas que sumiram das fichas. Resposta nova do formulário aparece
  desmarcada: é ali que se confere quando a agência muda o texto.
- ⚠️⚠️ **Só PADRÕES (resposta em 2+ fichas, `somentePadroes`)**: a tela
  oferece QUALQUER campo, e no preview de 05/11/2026 o campo "Senha gov.br"
  estava na lista — sem o filtro, escolhê-lo listaria as senhas de todos os
  clientes numa tela só. A de uma ficha só é dado da pessoa e nunca é o padrão
  de um formulário; a tela diz quantas ficaram de fora. Não tirar.
- O erro do banco vira frase por chave LITERAL (`mensagemDoErro`): chave
  montada escapa dos portões de i18n.
