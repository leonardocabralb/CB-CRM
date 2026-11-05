---
paths:
  - "src/lib/contacts/cliente-ideal*"
  - "src/components/settings/cliente-ideal-settings.tsx"
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
