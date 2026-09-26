---
paths:
  - "src/components/inbox/painel/painel-do-contato.tsx"
  - "src/components/contacts/contact-detail-view.tsx"
  - "src/components/contacts/contact-form.tsx"
  - "src/components/contacts/campo-com-salvamento.tsx"
  - "src/components/contacts/custom-fields-manager.tsx"
  - "src/components/settings/custom-fields-settings.tsx"
  - "src/components/settings/fields-and-tags-panel.tsx"
  - "src/lib/contacts/salvamento-de-campo*"
  - "src/lib/contacts/grupos-de-campos*"
  - "src/lib/contacts/nome-fixado*"
  - "src/lib/contacts/email-espelhado*"
---

# Campos e nome da ficha — regras

Vale nas DUAS telas da ficha — o painel da conversa (`painel-do-contato.tsx`) e
a ficha de /contatos (`contact-detail-view.tsx`) —, no formulário de contato, no
catálogo de campos (Configurações → Campos e etiquetas) e nos módulos
`salvamento-de-campo`, `grupos-de-campos`, `email-espelhado` e `nome-fixado`. O
resto de contatos (telefone, exclusão, importação) está em
`.claude/rules/contatos.md`; os gatilhos do e-mail espelhado e o
`redeem_invitation`, em `.claude/rules/supabase.md`. O texto antigo, com a
história, está em `git show f5879b3f:CLAUDE.md`.

### Campo personalizado SALVA SOZINHO — não existe mais "Salvar campos"

`salvamento-de-campo.ts` (puro, testado) e `campo-com-salvamento.tsx`, usado
nas duas telas. Pino: `salvamento-de-campo.test.ts`.

- ⚠️⚠️ **O campo só é MONTADO quando os valores já são do contato atual.** O
  rascunho nasce do `valorSalvo` da montagem e não persegue a prop; a limpeza
  da troca de contato roda num efeito, então existe um render com o contato
  NOVO e os valores do ANTERIOR — e o valor de A ficava permanente na ficha de
  B, pronto para ser gravado nela. Por isso `customValues` guarda o dono
  (`{ de, mapa }`) nas duas telas, comparado com a prop do render atual.
- ⚠️⚠️ **A `key` de quem monta o campo inclui o `contact.id`.** Sem ela o
  React reusa a instância, o rascunho de A sobrevive sob o cabeçalho de B e a
  descarga de desmonte grava no cliente errado.
- ⚠️⚠️ **UM campo por gravação, nunca o mapa inteiro.** `""` no upsert
  compartilhado é DELETE da linha: um campo ainda não carregado apagaria dado
  real no blur de outro. O gate de `dadosProntos` fica pelo mesmo motivo.
- ⚠️ **Desmontar não dispara `blur`**: há descarga na limpeza de desmonte
  (trocar de bloco, fechar o painel ou trocar de aba apagaria o texto). Ela
  não grava duas vezes porque a fila compara com `desejado` — a idempotência
  mora DENTRO de `criarFilaDeGravacao`, não em ref do componente.
- ⚠️⚠️ **Toda gravação passa pela FILA (`criarFilaDeGravacao`), nunca por
  `aoGravar` direto.** Requisições concorrentes na mesma linha chegam ao banco
  fora de ordem e a antiga apaga a nova, em silêncio. A fila serializa, guarda
  só o pendente mais novo e faz o último valor vencer. Dentro dela: "mudou?" é
  medido contra o que se QUER gravar (senão desfazer para o valor original
  durante o voo seria descartado e a tela discordaria do banco); na falha,
  `desejado` só volta para `salvo` quando não há pendente; e a REJEIÇÃO de
  `aoGravar` é falha comum (sem o catch, o laço morria com `rodando = true` e o
  campo parava de gravar para sempre, com o spinner aceso).
- ⚠️ **`select` grava na ESCOLHA, o resto no blur** (`gravaAoSair`). A DATA
  fica no blur apesar do `change`: ele dispara a cada pedaço digitado, com
  datas absurdas no meio, e o lembrete por data lê essa coluna.
- ⚠️ **"Mudou?" é comparado APARADO dos dois lados** (`valorMudou`): o helper
  grava `v.trim()`, e entrar e sair de um campo que a automação preencheu com
  `" 300 "` gravaria uma edição que ninguém fez.
- **Sucesso discreto (um "Salvo" que some em 2 s), erro ALTO**, nomeando o
  CAMPO e o CLIENTE: o operador já pode estar noutra conversa.
- **Etapa e valor do negócio já salvavam sozinhos** (`SeletorFunilEtapa` no
  clique, `ValorInput` no blur). "Consertá-los" é mexer no que funciona.

### Blocos de campos personalizados (966)

`cb_grupos_de_campos` (nome + posição), `custom_fields.grupo_id`/`posicao`,
`grupos-de-campos.ts` (puro, testado) e o catálogo com arrastar em
`custom-fields-manager.tsx`. O operador define a ordem, e ela vale para TODO
cliente.

- ⚠️⚠️ **Na ficha aparece UM bloco por vez**, num menu horizontal de pastilhas
  (decisão do operador). É o ponto da feature: empilhar os blocos organiza e
  não reduz nada. O menu SOME com menos de dois blocos; o bloco à vista é
  resolvido NO RENDER (`blocos.find(...) ?? blocos[0]`), nunca guardado por
  efeito — bloco apagado deixaria a seção em branco com uma pastilha acesa.
- ⚠️ **`grupo_id` NULO é o bloco "Geral", sempre primeiro.** Não tem linha no
  banco: não se renomeia nem se arrasta, e o rótulo sai do dicionário
  (`Contacts.customFields.groupGeneral`). ⚠️ Ele some quando vazio SÓ nas
  telas de LEITURA (`incluirVazios: false`). **No CATÁLOGO fica, mesmo
  vazio**: o seletor de bloco oferece "Geral" sempre, e sem o bloco na tela
  `moverCampo` devolve `null` e nada acontece, sem erro — o campo ficaria preso
  em grupo para sempre. Não "simplificar" para `if (geral.length > 0)`.
- ⚠️ **`categoria` (949) NÃO é o bloco, e não morreu**: é a marca "campo
  técnico" que o semeador escreve e que a API v1 expõe como `category` (o n8n
  lê). `grupo_id` é só ONDE o campo aparece; quem cria campo escolhe BLOCO.
- ⚠️⚠️ **`posicao` é posição DENTRO DO BLOCO, e só quem reagrupa ordena por
  ela.** Ordenar a conta inteira por `posicao` intercala os blocos, sem erro.
  Duas famílias de consulta:
  - **Reagrupam** (catálogo, painel da conversa, ficha):
    `.order('posicao', { nullsFirst: false }).order('field_name')`, e
    `ordenarCampos` é o espelho EXATO dessa cláusula — mudar um lado sem o
    outro faz o arrastar pousar num lugar e a recarga mostrar noutro.
  - **Listas PLANAS** (disparo, automação, API v1 — contrato com o
    integrador): só `.order('field_name')`.

  `posicao` nula cai no FIM de propósito (campo criado sem ela, como os dez do
  semeador, não embaralha a ordem montada).
- ⚠️ **Reordenar por RPC (`cb_ordenar_campos_personalizados`), nunca por
  `upsert`**: o upsert exige as colunas NOT NULL (conferidas antes do ramo do
  ON CONFLICT), e um arrastar reescreveria o NOME do campo com valor velho da
  tela. As RPCs são `SECURITY INVOKER`: quem decide é a policy de admin.
- ⚠️⚠️ **Arrastar NÃO é a única porta.** O formulário de bloco fica ACIMA da
  lista e cada linha tem um `<select>` de bloco ao lado da chave. Com só o
  arrastar e o "novo bloco" no rodapé, o operador não achou nenhuma das duas
  coisas. Vale para qualquer gesto novo nesta tela.
- ⚠️ **`handleDragEnd` normaliza qualquer id do bloco para o mesmo destino**
  (`blocoDoAlvo`): o bloco, a área de soltura e as linhas ocupam quase a mesma
  caixa, e o `closestCenter` desempata pela ordem de registro — o `over` chega
  como `bloco:<id>`, nunca `grupo:<id>`.
- ⚠️ **Alça de arrastar com área de toque de 24×24** (`size-4` + `p-1`): com
  14 px o ponteiro erra e nada acontece, sem pista nenhuma.
- ⚠️ **O arrastar manda o BLOCO INTEIRO (0..N-1)**: as posições do banco não
  são densas, e reordenar por diferença deixaria buraco.
- ⚠️ **`ON DELETE SET NULL (grupo_id)`, com a coluna NOMEADA**: `account_id`
  (NOT NULL) faz parte da FK composta, e sem a lista apagar um bloco
  estouraria em vez de devolver os campos ao Geral.
- **O semeador dos 10 campos padrão vive no CATÁLOGO** e cria no bloco
  selecionado no formulário de cima; o botão diz qual (dez campos no bloco
  errado dão trabalho para desfazer). A aba "Traqueamento" do painel não
  existe mais.
- **Save em LOTE, se voltar, resolve antes o valor escondido**: o digitado num
  bloco fora de vista continua em `customValues` e sobrevive à troca de
  pastilha — perder digitação é pior que gravá-la.
- **Sem `capitalize` nos rótulos** (nas duas fichas): deformava o nome
  cadastrado e os campos técnicos (`utm_source`).
- **A altura da lista do catálogo é PROP** (`alturaDaLista`): o `DialogContent`
  do projeto não tem teto de altura, e lista alta no diálogo de Contatos sairia
  da viewport sem barra.

### O campo "E-mail" espelha `contacts.email` (1000/1001) — o lado da tela

O espelho mora no BANCO (`custom_fields.espelho` e dois gatilhos) — nunca
espelhar em código: `contacts.email` e o valor do campo têm escritores demais.
`email-espelhado.ts` é o módulo puro.

- ⚠️ **O campo espelhado não se apaga nem troca de tipo, chave ou espelho**
  (gatilho no banco, não só policy). Renomear e mover de bloco continuam
  livres. No catálogo, a lixeira vira cadeado.
- ⚠️⚠️ **São DOIS escritores com foto velha, e os dois só mandam o e-mail se
  ele MUDOU** (`emailMudou`): a ficha de /contatos — que mostra o e-mail duas
  vezes, na aba de dados (com "Salvar") e no campo que salva sozinho — e o
  formulário "Editar", preenchido pela linha da lista. Regravar o valor velho
  levaria o velho de volta ao campo pelo gatilho, em silêncio. Pino:
  `email-espelhado.chamadores.test.ts`.
- **Gravar o campo espelhado atualiza o e-mail na mesma tela**: no painel,
  `onContactUpdated({ id, email })`; na ficha, com cerca do contato à vista
  (`contatoAbertoRef`) — a descarga de desmonte grava A depois de a ficha já
  ter aberto B.
- **No painel da conversa o e-mail aparece SÓ no campo espelhado** (26/09/2026,
  pedido do operador): a linha com o envelope, abaixo dos negócios, repetia o
  mesmo valor e saiu. Não voltar com ela.
- **Os dois lados guardam o MESMO texto** (o banco apara a linha de origem);
  campo COMUM não é aparado.

### Nome escrito por GENTE: `nome_fixado_em` (999)

A marca impede os caminhos AUTOMÁTICOS (o nome do perfil do WhatsApp) de
trocar o nome da ficha. A guarda nesses caminhos está em
`.claude/rules/ingestao.md`; o passo `update_contact_field`, em
`.claude/rules/automacoes.md`; o nome do agendamento, em
`.claude/rules/integracoes-calendly.md`.

- ⚠️ **Protege contra o automático, não contra gente — e gente também FIXA**
  (decisão do operador, 14/09/2026): painel, ficha e formulário gravam a marca
  junto com o nome por `marcaDoNomeManual`.
- ⚠️⚠️ **A marca só muda quando o NOME mudou**: ficha e formulário regravam o
  nome em todo salvamento, e corrigir só o e-mail fixaria de tabela o nome que
  veio do WhatsApp. Nome APAGADO solta a marca (a próxima mensagem volta a
  preencher).
- ⚠️⚠️ **Nome igual ao carregado NÃO é regravado** (`escritaDoNomeManual`): a
  tela abre sobre uma FOTO da ficha, e se o agendamento trocou o nome no meio,
  salvar só a empresa devolveria o nome antigo — já fixado.
- **O formulário e o "Nova conversa" (`/api/cb/conversas/abrir`) fixam na
  CRIAÇÃO.**
- **Número não é nome** (`nomeParaFixar`): fixar "5583…" tiraria da ficha o
  nome de verdade para sempre.
- ⚠️ **`nome-fixado.chamadores.test.ts` conhece TODO escritor de
  `contacts.name`** — chave literal, computada, espalhamento ou objeto
  montado —, cada um declarado `respeita`/`grava`/`sem-marca`, com o motivo.
  Escritor novo reprova até se declarar. Ficam `sem-marca` por escrito, sem
  decisão do operador: PATCH e criação da API v1, importação de CSV (tela e
  disparo) e a ficha de `destinatario.ts` (`send_to_number` e webhook de
  entrada). A ficha criada pelo Asaas GRAVA a marca (nome do contrato,
  decisão do operador, 19/09/2026); o perfil do Instagram só preenche ficha
  sem nome nenhum.
