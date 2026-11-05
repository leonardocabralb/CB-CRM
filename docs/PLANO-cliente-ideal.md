# Plano — Cliente ideal (ICP) marcado na conversa e no card

Pedido do operador (05/11/2026): o cliente que gera mais honorários (o ICP)
precisa aparecer diferente no CRM, na conversa e no card do funil, ao lado
das marcas que já existem (automação agendada, atraso de resposta, robô).
O CRM marca sozinho quem cumpre a regra; ninguém marca à mão.

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 0 | Regra, mockup e decisões | 🟡 05/11: mockup mostrado; D1 decidida; D2–D5 pendentes |
| 1 | Regra no banco (tabela + RPC) e a tela para configurá-la | a fazer |
| 2 | Selo: lista de conversas, card do funil, cabeçalho e o porquê no painel | a fazer |
| 3 | Filtro "Só clientes ideais" na caixa de entrada | a fazer |
| 4 | Aviso ou gatilho de automação "virou cliente ideal" | só se pedido |

Cada fase termina com revisão, teste no preview (1440×900) e a linha desta
tabela com o resultado MEDIDO. Antes da fase seguinte, conferir se ela ainda
é necessária.

## A regra

Cliente ideal = os três juntos:

1. **Dívida acima de R$ 500 mil** — campo "Tamanho da Divida"
   (`tamanho_da_divida`, texto livre, gravado pelo Typebot via API e pela
   carga da Kommo).
2. **Situação dos pagamentos** — campo "Tempo de Atraso" (`tempo_de_atraso`,
   texto livre): em dia mas prestes a atrasar, ou atraso de até 6 meses.
   Ficam FORA "em dia e pretendo manter" (Desqualificado, decisão de
   03/11/2026) e "mais de 6 meses".
3. **Respondeu** — o cliente mandou pelo menos uma mensagem no WhatsApp.

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
- **D2 — Ficha com dívida acima de 500 mil e "Tempo de Atraso" vazio.**
  Recomendado: fica FORA do selo, e o painel diz o que falta ("Falta: situação
  dos pagamentos"), para quem atende perguntar e preencher. Alternativa: um
  segundo selo, mais fraco ("ICP?"). É a maioria das fichas com dívida grande.
- **D3 — Selo em card Perdido ou Desqualificado.** Recomendado: mantém. O
  selo diz quem o cliente é, não em que pé está o negócio; um ICP perdido é
  justamente quem vale retomar.
- **D4 — Borda dourada no card**, além da pastilha. Recomendado: ligada (o
  ICP salta numa coluna de 20 cards). O mockup mostrou as duas formas.
- **D5 — O que conta como "respondeu".** Recomendado: qualquer mensagem do
  cliente, inclusive a primeira que ele mesmo mandou (anúncio de clique para o
  WhatsApp) e a que ele apagou depois. Alternativa: só mensagem do cliente
  DEPOIS de uma nossa.

Escolhas de desenho (mudar qualquer uma é pergunta ao operador):

- **Uma regra por conta**, não por funil: os campos já são do Bancário. Se o
  Trabalhista ganhar ICP, a regra vira lista.
- **Configurável na tela, nunca fixa no código.** O CRM é vendido (marca é
  dado, `produto-gate`), e as grafias mudam quando a agência reescreve o
  formulário: regra fixa pararia de marcar em silêncio.
- **Calculada na leitura, sem carimbo no banco** (abaixo). O preço é não
  saber DESDE QUANDO alguém é ICP; a Fase 4 precisaria disso.

## Como funciona

### Fase 1 — A regra no banco e a tela

**Tabela `cb_cliente_ideal`** (uma linha por conta):

- `account_id` (PK, FK `accounts` ON DELETE CASCADE), `ativo boolean`,
  `criterios jsonb` — lista de
  `{ "campo": <uuid de custom_fields>, "respostas": [texto…] }`: E entre os
  critérios, OU dentro de cada um. `atualizado_em`, `atualizado_por`
  (autoria: FK para `auth.users` com `ON DELETE SET NULL`, nunca CASCADE —
  1116 e o `verify-schema.sql`).
- RLS: leitura na forma da 1032 (`= ANY (ARRAY(SELECT
  cb_contas_do_usuario()))`); escrita só de admin. `REVOKE ALL … FROM anon`.
- A comparação é NORMALIZADA dos dois lados (aparar, espaços repetidos viram
  um, minúsculas), numa função só, usada pela RPC e pela tela.
- Critério com campo APAGADO invalida a regra inteira: ninguém é ICP e a tela
  avisa. Ignorar o critério marcaria gente demais.

**RPC `cb_clientes_ideais()`** → `SETOF uuid` (os contatos da conta que
cumprem a regra), e **`cb_cliente_ideal_do_contato(p_contato uuid)`** →
`jsonb` com cada critério (valor gravado, casou ou não) e se respondeu: é o
porquê do painel e o "Falta:" da D2.

- "Respondeu" = existe `messages.sender_type = 'customer'` numa conversa do
  contato (grupo não tem contato e fica de fora sozinho). Faz parte de toda
  regra, sem chave para desligar (ninguém pediu ICP sem resposta).
- **RPC `cb_respostas_do_campo(p_campo uuid)`** → cada resposta gravada e
  quantas fichas, agrupada NO BANCO: ler `contact_custom_values` do navegador
  esbarra no corte de 1000 linhas do PostgREST (o campo da dívida já tem 833).
- SECURITY INVOKER, se a medição como `authenticated` ficar barata; se a RLS
  de `messages` encarecer, SECURITY DEFINER com a conta do chamador conferida
  E a suspensão (1067, `membro-suspenso-1067.test.ts`). EXECUTE fechado para
  `anon` e concedido de volta a quem usa (banco vazio, `supabase.md`).
- Conferência da migration CHAMA as duas funções num subbloco desfeito por
  SQLSTATE próprio (corpo plpgsql só é analisado quando roda).

Por que sem gatilho nem coluna em `contacts`: nada entra na Lixeira (1097,
default-deny para gatilho em tabela que a restauração escreve), na união de
fichas (1093) nem na carga; mudou a regra, vale na hora, sem preenchimento
retroativo; e nenhum gatilho novo no INSERT de `messages`, o caminho mais
quente do banco.

**Tela:** aba "Cliente ideal" em Configurações → Campos e etiquetas (seção
`fields`, já `admin` em `ESCRITA_DA_SECAO`: conferir que a guarda da tabela
nova é a mesma e que `poderes.ts` não muda). Liga/desliga e, por critério, o
campo e as respostas aceitas, escolhidas numa lista de TODAS as respostas já
gravadas naquele campo, com a contagem (`cb_respostas_do_campo`, mais as
opções do campo se ele for Lista). Resposta nova do formulário aparece ali
desmarcada. Toda escrita confere o retorno (RLS que barra devolve 0 linhas
sem erro).

### Fase 2 — O selo

Mockup mostrado ao operador em 05/11/2026 (ele seguiu para o plano; a borda
do card é a D4): pastilha dourada SÓLIDA com diamante e o texto "ICP".

- **Um hook de página**, `useClientesIdeais(resyncToken)` → `Set<string> |
  null`, no contrato de `useSinalDeExecucoes`: `null` = não sei, o selo cala
  e o filtro neutraliza. Uma consulta por carga da tela, nunca por linha. Lê
  de novo no resync da lista e quando a ficha salva um campo (evento global,
  como `EVENTO_EXECUCOES`): sem isso, preencher "Tempo de Atraso" não acende o
  selo até voltar à aba.
- **Lista de conversas** (`conversation-list.tsx`): a pastilha vai JUNTO DO
  NOME, depois dele (`shrink-0`; o nome trunca). A direita da linha é dos
  estados com hora (janela de 24h, dívida no Asaas, automação, atraso); ICP
  diz quem o cliente é. Grupo nunca.
- **Card do funil** (`deal-card.tsx`): prop PRIMITIVA `clienteIdeal?:
  boolean` (o `memo` do card só segura com prop estável); pastilha na linha
  do título, antes de Ganho/Perdido. Borda (D4) por `ring`, não `border-*`: o
  `hover:border-border` do card venceria a cor no hover. O quadro
  (`pipeline-board.tsx`) chama o hook uma vez e passa o booleano, como
  `esperasDeAutomacao`.
- **Cabeçalho do fio** (`message-thread.tsx`): a pastilha ao lado do nome.
- **Painel do cliente**: bloco "Cliente ideal (ICP)" com os três critérios
  (✓ e o valor gravado); com a D2 recomendada, "Falta: …" quando a dívida
  casa e o resto não. Componente novo em `src/components/inbox/painel/`,
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

O Kanban não tem barra de filtros hoje: o selo e a borda já separam na
coluna. Filtro no funil só se pedido.

### Fase 4 — Só se pedido

Aviso no sino ou gatilho de automação "cliente virou ideal" exigem um carimbo
`contacts.ideal_desde`, mantido por gatilho em `contact_custom_values` e
`messages` — com o sinal `cb.lixeira` no `WHEN` e a entrada na receita da
união (`supabase.md`). Por isso fica fora até ser pedido.

## Arquivos

- `supabase/migrations/NNNN_cb_cliente_ideal.sql` — número escolhido NA HORA
  (maior do `main` + 1, conferindo `list_migrations` e as worktrees das outras
  sessões); `docs/MIGRATIONS-APLICADAS.md` ao aplicar. ADITIVA: aplicar antes
  do deploy.
- `src/lib/contacts/cliente-ideal.ts` (tipos e leitura), `src/hooks/use-clientes-ideais.ts`,
  a aba da tela de Campos e etiquetas, o bloco do painel.
- `conversation-list.tsx`, `deal-card.tsx`, `pipeline-board.tsx`,
  `message-thread.tsx`, `contact-sidebar.tsx` (só para montar o bloco),
  `src/lib/inbox/filtros.ts`, `inbox-filters.tsx`.
- `messages/en.json` e `messages/pt-BR.json` na mesma passada.
- Trecho NOSSO em arquivo do upstream (`message-thread.tsx`,
  `contact-sidebar.tsx`, `pipeline-board.tsx`, `fields-and-tags-panel.tsx`) →
  linha na tabela de `docs/MERGE-UPSTREAM.md` no mesmo PR.
- Regra da área: seção nova em `.claude/rules/contatos.md` (ou regra própria
  com `paths:` e entrada no índice da seção 13 do `CLAUDE.md`); D1–D5 numa
  linha de `docs/DECISOES-DO-OPERADOR.md`.
- Doc de integração: nada muda (API, webhooks e MCP não veem o selo).

## Medições técnicas (05/11/2026, produção, só leitura)

- A consulta da regra, com as grafias da D1, devolve os contatos certos em
  **~17 ms** de execução (`EXPLAIN ANALYZE` como `postgres`, sem o custo de
  cronometrar cada nó; com ele, 773 ms — a CPU compartilhada do Micro). Usa
  `contact_custom_values_custom_field_id_idx`, a chave
  `(contact_id, custom_field_id)` e `idx_messages_conversation`; nada de disco.
- FALTA medir como `authenticated` (pela RLS de `messages`) antes do PR.
- A lista recarrega ~1.500 vezes por dia (`banco-no-teto` de 02/11): uma
  consulta a mais por carga, nunca por linha.

## Riscos e limites conhecidos

- **Resposta nova do formulário** não entra sozinha: aparece desmarcada na
  tela da regra. Se a agência mudar o texto, alguém marca lá.
- **O selo não acende ao vivo na primeira resposta do cliente**: só na
  próxima carga da lista (volta à aba, atualizar). A ficha que salva um campo
  acende na hora (o evento do hook).
- **Teste com dado real**: o preview grava na produção. Ver o selo no lead de
  teste autorizado exige gravar os dois campos nele — pedir o "pode gravar" e
  desfazer depois; nunca abrir conversa de cliente (zera as não lidas).

## Teste por fase

- Fase 1: replay no Postgres local (banco vazio: a conferência pula com
  NOTICE) e cenários num descartável com dado FICTÍCIO (grafias com espaço
  duplo e maiúsculas, campo apagado, sem resposta, contato só com grupo,
  outra conta); medir como `authenticated`.
- Fases 2 e 3: preview em 1440×900, lista a 320 px (o nome trunca, a pastilha
  fica), quadro com o card ICP e sem, painel com e sem "Falta:".
- Sempre: `npm run typecheck`, `npm run lint`, `npm run test`.
