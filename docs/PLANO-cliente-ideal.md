# Plano — Cliente ideal (ICP) marcado na conversa e no card

Pedido do operador (05/11/2026): o cliente que gera mais honorários (o ICP)
precisa aparecer diferente no CRM, na conversa e no card do funil, ao lado
das marcas que já existem (automação agendada, atraso de resposta, robô).
O CRM marca sozinho quem cumpre a regra; ninguém marca à mão.

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 0 | Regra, mockup e decisões | ✅ 05/11: mockups mostrados (canvas "Selo de cliente ideal"); D1–D6 decididas |
| 1 | Regra no banco (tabela + RPC) e a tela para configurá-la | 🟡 05/11: código na branch `feat/cliente-ideal` (sem push). Migration 1124 provada no replay LOCAL completo (248 migrations + `verify-schema.sql`), duas vezes e em 8 cenários fictícios (`~/Downloads/CB-CRM/ferramentas/pg-replay/cenarios-1124/`); **APLICADA em produção** (`20261105230924`, autorizada). Medida com a RLS de usuário logado: o perfil do Bancário (escrito à mão, sem gravar) devolve 289 contatos (68 ICP + 221 ICP?) em 31 ms. Tela conferida no preview contra a produção, sem gravar: estado vazio, as respostas gravadas com a contagem, campo usado some do outro critério, Cancelar não grava (0 perfis no banco), console limpo. Achado do preview corrigido: a lista oferece só PADRÕES (resposta em 2+ fichas) — o campo "Senha gov.br" listaria as senhas. typecheck, lint (0 erros) e suíte verdes. FALTA: o perfil do Bancário gravado (pelo operador ou com "pode gravar") |
| 2 | Selo: lista de conversas, card do funil, cabeçalho e o porquê no painel | a fazer |
| 3 | Filtro "Só clientes ideais" na caixa de entrada e no quadro do funil | a fazer |
| 4 | Aviso ou gatilho de automação "virou cliente ideal" | só se pedido |

Cada fase termina com revisão, teste no preview (1440×900) e a linha desta
tabela com o resultado MEDIDO. Antes da fase seguinte, conferir se ela ainda
é necessária.

## A regra

Cliente ideal = os dois juntos:

1. **Dívida acima de R$ 500 mil** — campo "Tamanho da Divida"
   (`tamanho_da_divida`, texto livre, gravado pelo Typebot via API e pela
   carga da Kommo).
2. **Situação dos pagamentos** — campo "Tempo de Atraso" (`tempo_de_atraso`,
   texto livre): em dia mas prestes a atrasar, ou atraso de até 6 meses.
   Ficam FORA "em dia e pretendo manter" (Desqualificado, decisão de
   03/11/2026) e "mais de 6 meses".

O pedido original tinha um terceiro critério, "respondeu pelo menos uma das
nossas mensagens"; ele SAIU da regra (D5) e virou informação no painel.

As respostas existem em várias grafias (as do Typebot e as da Kommo, uma com
espaço duplo), por isso a regra guarda as RESPOSTAS ACEITAS, não um número.
Grafias que contam hoje:

- Dívida: "Maior que 500 mil reais", "Acima de 500 Mil", "Entre 500k a 1M",
  "Maior que 1M". ("Entre 100 mil a 500 mil reais" e "De 100 a 500 Mil" não
  contam: a faixa inclui menos de 500 mil.)
- Situação: "Estou em dia mas não conseguirei pagar em breve", "Em dia, mas
  vai atrasar", "Estou com atraso de até 3 meses", "Atraso de 3 meses",
  "Estou com atraso de 3 meses a 6 meses", "Atraso de 3  à 6 meses".

As contagens (quantos clientes cumprem cada parte) ficam FORA do
repositório: `~/Downloads/CB-CRM/cliente-ideal-2026-11-05/contagem.md`.

## Decisões

- ✅ **D1 — "Atraso de até 3 meses" entra** (operador, 05/11/2026). Junto
  com as duas grafias dele.
- ✅ **D2 — Selo mais fraco, "ICP?"** (operador, 05/11/2026), para a ficha
  com dívida acima de 500 mil e "Tempo de Atraso" VAZIO: contorno dourado,
  sem fundo, sem borda no card; o painel diz "Falta: situação dos pagamentos".
  Medido: hoje são TODAS fichas trazidas da Kommo (o funil antigo não
  perguntava a situação; o Typebot sempre pergunta), nenhuma nova em 30 dias —
  na prática, uma lista de propostas antigas com dívida grande para revisitar.
  Situação preenchida com outra resposta ("mais de 6 meses", "pretendo
  manter") não ganha selo nenhum.
- ✅ **D3 — Os selos ficam em qualquer card** (operador, 05/11/2026),
  inclusive Perdido, Desqualificado e cliente ativo no Jurídico: o selo diz
  quem o cliente é, não em que pé está o negócio.
- ✅ **D4 — Borda dourada no card do ICP** (operador, 05/11/2026), além da
  pastilha. O "ICP?" não ganha borda.
- ✅ **D5 — O "respondeu" SAI da regra** (operador, 05/11/2026, depois da
  análise que ele pediu): a ideia é achar quem cumpre o perfil para LIGAR e
  provocar o contato. Medido na produção (contagens fora do repositório):
  entre os que têm dívida e situação de ICP, os que nunca responderam estão
  quase todos
  parados em "Lead - Type e Forms" e "MQL 1", com conversa ENCERRADA (fora da
  aba padrão da caixa de entrada), receberam só mensagens de automação (média
  de 3; poucos falaram com alguém da equipe) e alguns tiveram envio falho
  (número provavelmente sem WhatsApp); outros agendaram pelo Calendly SEM
  escrever no WhatsApp. Os que responderam já estão sendo trabalhados (a
  maioria chegou a reunião). **Por que sai:** responder não é perfil
  do cliente, é estado do atendimento; com o critério, o selo esconde
  justamente quem a equipe deveria ligar, só acende depois que o cliente
  escreve (perde o melhor momento, logo depois do formulário) e não vê quem
  interagiu por outro canal. O "respondeu" vira INFORMAÇÃO no painel
  ("Nunca respondeu pelo WhatsApp · N mensagens nossas · M não entregues"),
  e a lista de ligação passa a ser o filtro no QUADRO (Fase 3).
- ✅ **D6 — VÁRIOS perfis com nome por conta** (operador, 05/11/2026, ao
  pedir a regra configurável): cada perfil (ex.: Bancário, Trabalhista) tem
  seus campos e respostas; quem casa com qualquer perfil ganha o selo, e o
  painel diz qual perfil.

Escolhas de desenho (mudar qualquer uma é pergunta ao operador):

- **Configurável na tela, nunca fixa no código.** O CRM é vendido (marca é
  dado, `produto-gate`), e as grafias mudam quando a agência reescreve o
  formulário: regra fixa pararia de marcar em silêncio.
- **Calculada na leitura, sem carimbo no banco** (abaixo). O preço é não
  saber DESDE QUANDO alguém é ICP; a Fase 4 precisaria disso.

## Como funciona

### Fase 1 — A regra no banco e a tela

**Tabela `cb_perfis_de_cliente_ideal`** (migration 1124; vários por conta, D6):

- `id`, `account_id` (FK `accounts` ON DELETE CASCADE), `nome` (até 40,
  único por conta sem caixa), `ativo`, `posicao` (desempate entre perfis),
  `criterios jsonb` — lista de
  `{ "campo": <uuid de custom_fields>, "respostas": [texto…] }`, de 1 a 10
  critérios, 1 a 200 respostas cada, campo sem repetir; o CHECK é a função
  `cb_criterios_de_cliente_ideal_validos`. E entre os critérios, OU dentro de
  cada um. Sem coluna de autoria (ninguém pediu; nada de FK para
  `auth.users`).
- RLS: leitura na forma da 1032 (`= ANY (ARRAY(SELECT
  cb_contas_do_usuario()))`); escrita só de admin. `REVOKE ALL … FROM anon`.
- A comparação é NORMALIZADA dos dois lados (`cb_resposta_normalizada`:
  espaço repetido vira um, apara, minúsculas).
- Critério com campo APAGADO invalida o perfil inteiro: ninguém casa por ele
  e a tela avisa. Ignorar o critério marcaria gente demais.

**RPC `cb_clientes_ideais(p_conta, p_contato DEFAULT NULL)`** →
`(contact_id, nivel, perfil_id)`, uma linha por contato, com `nivel` =
`'ideal'` (todos os critérios casam) ou `'possivel'` (o PRIMEIRO critério
casa, os outros casam ou estão vazios, e ao menos um vazio — a D2; a ordem dos
critérios na tela diz qual é o principal). Dois perfis: vence o melhor nível,
e no empate a menor `posicao`. E **`cb_cliente_ideal_do_contato(p_contato)`**
→ `jsonb` com o nível, o perfil, cada critério (campo, valor gravado, casa) e
o retrato do contato (mensagens do cliente, nossas, não entregues): é o porquê
do painel e o "Falta:" da D2.

- O retrato do painel (D5) conta, nas conversas do contato, as mensagens do
  cliente (`sender_type = 'customer'`), as nossas que saíram e as que não
  saíram (`nao_saiu`). Grupo não tem contato e fica de fora sozinho.
- **RPC `cb_respostas_do_campo(p_campo uuid)`** → cada resposta gravada e
  quantas fichas, agrupada NO BANCO: ler `contact_custom_values` do navegador
  esbarra no corte de 1000 linhas do PostgREST (o campo da dívida já tem 833).
- SECURITY INVOKER, se a medição como `authenticated` ficar barata (a regra
  lê só `contact_custom_values` e `custom_fields`; o retrato lê `messages` de
  UM contato); se a RLS encarecer, SECURITY DEFINER com a conta do chamador
  conferida E a suspensão (1067, `membro-suspenso-1067.test.ts`). EXECUTE
  fechado para `anon` e concedido de volta a quem usa (banco vazio,
  `supabase.md`).
- Conferência da migration CHAMA as três funções num subbloco desfeito por
  SQLSTATE próprio (corpo plpgsql só é analisado quando roda).

Por que sem gatilho nem coluna em `contacts`: nada entra na Lixeira (1097,
default-deny para gatilho em tabela que a restauração escreve), na união de
fichas (1093) nem na carga; mudou a regra, vale na hora, sem preenchimento
retroativo; e nenhum gatilho novo no INSERT de `messages`, o caminho mais
quente do banco.

**Tela:** cartão "Cliente ideal (ICP)" em Configurações → Campos e etiquetas,
depois do de campos (`cliente-ideal-settings.tsx`; a seção já empilha
cartões, sem sub-abas — o canvas mostrava sub-abas). Só para quem edita
configurações; a guarda de escrita é a das policies da 1124, o mesmo piso de
`ESCRITA_DA_SECAO.fields` (`poderes.ts` não muda). Lista de perfis com
liga/desliga, os campos e quantos o perfil marca hoje ("Hoje: N ICP · M
ICP?", pela leitura paginada `lerClientesIdeais`); o editor tem nome, ligado
e os critérios (campo, subir/descer, remover) com as respostas oferecidas:
as gravadas naquele campo que se REPETEM (2+ fichas; `somentePadroes` — a
de uma ficha só é dado da pessoa, como a senha do gov.br, e a tela diz
quantas ficaram de fora), com a contagem (`cb_respostas_do_campo`), mais as
opções do campo Lista e as já marcadas que sumiram. Resposta nova do
formulário aparece desmarcada a partir da segunda ficha. Toda escrita confere o retorno (RLS que barra
devolve 0 linhas sem erro).

### Fase 2 — O selo

Mockups mostrados ao operador em 05/11/2026 (o selo, o "ICP?", a borda e o
retrato no painel): pastilha dourada SÓLIDA com diamante e o texto "ICP".

- **Um hook de página**, `useClientesIdeais(resyncToken)` → `Map<string,
  'ideal' | 'possivel'> | null`, no contrato de `useSinalDeExecucoes`: `null` = não sei, o selo cala
  e o filtro neutraliza. Uma consulta por carga da tela, nunca por linha. Lê
  de novo no resync da lista e quando a ficha salva um campo (evento global,
  como `EVENTO_EXECUCOES`): sem isso, preencher "Tempo de Atraso" não acende o
  selo até voltar à aba.
- **Lista de conversas** (`conversation-list.tsx`): a pastilha vai JUNTO DO
  NOME, depois dele (`shrink-0`; o nome trunca). A direita da linha é dos
  estados com hora (janela de 24h, dívida no Asaas, automação, atraso); ICP
  diz quem o cliente é. Grupo nunca.
- **Card do funil** (`deal-card.tsx`): prop PRIMITIVA `clienteIdeal?:
  'ideal' | 'possivel'` (o `memo` do card só segura com prop estável);
  pastilha na linha do título, antes de Ganho/Perdido. Borda dourada (D4) só
  no `'ideal'`, por `ring`, não `border-*`: o `hover:border-border` do card
  venceria a cor no hover. O quadro (`pipeline-board.tsx`) chama o hook uma
  vez e passa o valor, como `esperasDeAutomacao`.
- **"ICP?" (D2):** a mesma pastilha só com CONTORNO dourado, sem fundo e com
  o texto "ICP?"; `title` "Possível cliente ideal: falta a situação dos
  pagamentos". Conferir o contraste nos dois temas antes do PR.
- **Cabeçalho do fio** (`message-thread.tsx`): a pastilha ao lado do nome.
- **Painel do cliente**: bloco "Cliente ideal (ICP)" com os dois critérios
  (✓ e o valor gravado) e o retrato da D5 ("Nunca respondeu pelo WhatsApp · 3
  mensagens nossas · 1 não entregue"); no "ICP?", "Possível cliente ideal" com
  "Falta: situação dos pagamentos" (D2). Componente novo em `src/components/inbox/painel/`,
  para tocar o mínimo no `contact-sidebar.tsx`. A leitura por contato
  carimba o dono (`{ de, … }`) e deriva `carregando` (efeito passivo, seção
  8c): na troca de conversa o bloco mostraria o cliente anterior, e leitura
  que falhou nunca vira "não é cliente ideal".
- **Cor:** classes LITERAIS `bg-yellow-400 text-yellow-950` (sólida porque
  `dark:` está inerte; amarelo não está na paleta das conexões —
  `cb-channels/cores.ts`: âmbar, fúcsia, laranja, céu, verde-azulado,
  violeta — nem nas marcas da linha, que são claras: violeta, âmbar, vermelho).
  Ícone `Gem` do lucide (a estrela já é "favorita"). Sem anel no avatar e sem
  faixa na borda esquerda (decisões do operador; a borda é da seleção).
- Fica de fora: Meu dia, lista de Contatos, Agendadas, API v1 (o
  `CONVERSATION_SELECT` é contrato e não se alarga para servir tela).

### Fase 3 — O filtro

"Só clientes ideais" no painel de filtros da caixa de entrada, ao lado de
"Inadimplentes" (a barra não tem espaço para chip novo). Segue o molde do
`inadimplentes`: `ContextoDosFiltros.clientesIdeais` OBRIGATÓRIO (`Set |
null`, `null` neutraliza), campo em `FiltrosDoInbox` com `descreverFiltro`,
`AMOSTRAS`, `lerFiltroSalvo` e `mesmoFiltro`; vale para a favorita, como
"Inadimplentes" (fora de `casaComORecorteDoPainel`). Regras em
`.claude/rules/inbox-lista.md`.

**No quadro do funil, um interruptor "Só clientes ideais"** (D5): quem cumpre o perfil e nunca respondeu tem a conversa ENCERRADA (nasce
assim pelo webhook do formulário) e fica fora da aba padrão da caixa de
entrada, mas tem card aberto no Bancário — a lista de ligação mora no quadro.
As colunas "Lead - Type e Forms" e "MQL 1" têm mais de cem cards e desenham 20
por vez: só a borda não basta. O recorte se aplica à lista ENXUTA (todos os
cards, `cartao.ts`), antes do corte por coluna; o Kanban não tem barra de
filtros hoje, então é peça nova no cabeçalho do quadro. O "ICP?" fica fora
dos dois filtros (se pedido, uma segunda opção).

### Fase 4 — Só se pedido

Aviso no sino ou gatilho de automação "cliente virou ideal" exigem um carimbo
`contacts.ideal_desde`, mantido por gatilho em `contact_custom_values` (sem
o "respondeu", `messages` fica de fora) — com o sinal `cb.lixeira` no `WHEN`
e a entrada na receita da união (`supabase.md`). Por isso fica fora até ser
pedido.

## Arquivos

- `supabase/migrations/1124_cb_perfis_de_cliente_ideal.sql` — número
  conferido em 05/11 (repositório, worktrees, branches e histórico do banco);
  conferir de novo logo antes de aplicar; `docs/MIGRATIONS-APLICADAS.md` ao
  aplicar. ADITIVA: aplicar antes do deploy.
- `src/lib/contacts/cliente-ideal.ts` (tipos e leitura), `src/hooks/use-clientes-ideais.ts`,
  a aba da tela de Campos e etiquetas, o bloco do painel.
- `conversation-list.tsx`, `deal-card.tsx`, `pipeline-board.tsx`,
  `message-thread.tsx`, `contact-sidebar.tsx` (só para montar o bloco),
  `src/lib/inbox/filtros.ts`, `inbox-filters.tsx`.
- `messages/en.json` e `messages/pt-BR.json` na mesma passada.
- Trecho NOSSO em arquivo do upstream (`message-thread.tsx`,
  `contact-sidebar.tsx`, `pipeline-board.tsx`, `fields-and-tags-panel.tsx`) →
  linha na tabela de `docs/MERGE-UPSTREAM.md` no mesmo PR.
- Regra da área: `.claude/rules/cliente-ideal.md` (o `contatos.md` está no
  teto de 25 KB), com entrada no índice da seção 13 do `CLAUDE.md`; D1–D6
  numa linha de `docs/DECISOES-DO-OPERADOR.md`. Feito na Fase 1.
- Doc de integração: nada muda (API, webhooks e MCP não veem o selo).

## Medições técnicas (05/11/2026, produção, só leitura)

- A consulta da regra, com as grafias da D1 e AINDA com o "respondeu", rodou
  em **~17 ms** (`EXPLAIN ANALYZE` como `postgres`, sem o custo de cronometrar
  cada nó; com ele, 773 ms — a CPU compartilhada do Micro). Usa
  `contact_custom_values_custom_field_id_idx` e a chave
  `(contact_id, custom_field_id)`; nada de disco. Sem o "respondeu" (D5) ela
  deixa de ler `messages` e fica mais barata — remedir.
- FALTA medir como `authenticated` (pela RLS) antes do PR.
- A lista recarrega ~1.500 vezes por dia (`banco-no-teto` de 02/11): uma
  consulta a mais por carga, nunca por linha.

## Riscos e limites conhecidos

- **Resposta nova do formulário** não entra sozinha: aparece desmarcada na
  tela da regra. Se a agência mudar o texto, alguém marca lá.
- **Campo gravado por fora (Typebot pela API, automação) não acende ao
  vivo**: só na próxima carga da lista ou do quadro (volta à aba, atualizar).
  A ficha que salva um campo acende na hora (o evento do hook).
- **Teste com dado real**: o preview grava na produção. Ver o selo no lead de
  teste autorizado exige gravar os dois campos nele — pedir o "pode gravar" e
  desfazer depois; nunca abrir conversa de cliente (zera as não lidas).

## Teste por fase

- Fase 1: replay no Postgres local (banco vazio: a conferência pula com
  NOTICE) e cenários num descartável com dado FICTÍCIO (grafias com espaço
  duplo e maiúsculas, campo apagado, situação vazia × outra resposta, contato
  sem mensagem, contato só em grupo, outra conta); medir como `authenticated`.
- Fases 2 e 3: preview em 1440×900, lista a 320 px (o nome trunca, a pastilha
  fica), quadro com o card ICP e sem, painel com e sem "Falta:".
- Sempre: `npm run typecheck`, `npm run lint`, `npm run test`.
