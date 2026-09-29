# Plano — Contatos relacionados

> Plano vivo. Marcar `[x]` conforme cada fase entra. Documento INTERNO
> (não vai para quem instala o sistema).

## Por que

No comercial e no jurídico, às vezes DUAS pessoas falam com o escritório
sobre o mesmo assunto (cônjuge, filho, procurador). Hoje nada liga uma
conversa à outra: quem atende precisa lembrar que a outra existe e caçá-la
na lista. Pedido do operador (29/09/2026): vincular o contato A ao contato B,
cada um aparecendo numa aba "Relacionados" do outro, com um clique para abrir
a conversa e voltar.

## Decisões do operador (29/09/2026)

- **D1 — Par a par.** O vínculo liga DOIS contatos e vale para os dois lados.
  Três pessoas no mesmo caso = três vínculos (A–B, A–C, B–C) para todas se
  verem. Sem "grupo de caso".
- **D2 — Descrição opcional**, texto livre curto ("esposa", "procurador"),
  editável depois. A mesma descrição aparece dos dois lados.
- **D3 — Onde:** aba no painel da conversa E na ficha de /contatos. Na ficha,
  clicar no nome leva à conversa na caixa de entrada.
- **D4 — Quem:** quem pode editar o contato (atendente e admin) vincula,
  edita e desvincula. Visualizador só vê.
- **D5 — Voltar:** além da aba (que já mostra A na conversa de B), uma faixa
  "← Voltar para <A>" no topo da caixa de entrada depois de pular de A para B
  pela aba. Um nível só: pular de B para C troca a faixa para "Voltar para B".

## Desenho

- **Banco (1069, número a reconferir ao aplicar):** `cb_contatos_relacionados`
  (`contact_a_id`, `contact_b_id`, `descricao`, `created_by`, `created_at`).
  Um vínculo é UMA linha; o índice único sobre `LEAST/GREATEST` recusa o par
  repetido nos dois sentidos, e o CHECK recusa o contato ligado a si mesmo.
  FKs COMPOSTAS `(contato, account_id)` → `contacts (id, account_id)` com
  `ON DELETE CASCADE`: apagar um dos contatos desfaz o vínculo. Leitura na
  forma da 1032; escrita `agent` (a mesma de `contacts_update`).
- **Contato → conversa é 1:1** (`idx_conversations_account_contact`, 036), e a
  lista do inbox carrega TODAS as conversas da conta: abrir a conversa do
  relacionado é selecionar uma linha que a página já tem.
- **Contato sem conversa** (ficha do Calendly, do Asaas): "Sem conversa"; no
  inbox, o botão "Conversar" abre a "Nova conversa" já preenchida (o mesmo
  evento do cartão de contato).
- **Fusão de fichas:** a receita de `.claude/rules/supabase.md` passa a
  reapontar os vínculos do perdedor.

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 1 | Migration 1069 + pino | [x] (a 1068 ficou com o PR #350). Provada num Postgres 16 descartável: banco vazio pula a prova; aplicada 2×; 6 cenários (par invertido, a si mesma, descrição, outra conta, visualizador lê e não grava, não membro não lê, CASCADE); sem o índice do par a própria migration reprova. Aplicada em produção em 29/09/2026 (histórico `20260929191304`), depois do replay verde do CI. |
| 2 | Hook + módulo puro + aba no painel da conversa | [x] |
| 3 | Faixa "Voltar para" na caixa de entrada | [x] |
| 4 | Aba na ficha de /contatos | [x] |
| 5 | Revisão, teste no preview, regras e PR | [x] PR #352. Codex: 2 P2 — a conversa criada pelo "Conversar" nascia atrás do painel do celular (consertado: `handleConversaAberta` fecha o painel) e a faixa não aparece depois do "Conversar" (limite conhecido, abaixo). E2E no preview (29/09), com duas fichas de TESTE de número fictício: vincular com descrição (aparada, autoria gravada), par repetido barrado na tela, "Conversar" abrindo a Nova conversa preenchida (cancelada), pulo para a conversa de A com a faixa "Voltar para", descrição editada por A e vista pelo lead, a faixa voltando e sumindo, a aba da ficha de /contatos com link para `/inbox?c=`, desvincular com confirmação; limpeza por CASCADE, tabela vazia no fim. |

## Limites conhecidos

- **A faixa "Voltar para" não aparece depois do "Conversar"** (relacionado
  SEM conversa → Nova conversa → a conversa criada). Codex, #352. O caminho é
  raro (os relacionados normalmente já conversam com o escritório) e tem saída
  segura: a aba Relacionados da conversa nova já mostra quem ficou para trás.
  Consertar exige carregar o destino pendente até a lista trazer a conversa
  criada (`handleConversationsLoaded`), o trecho mais sensível da página. Se o
  operador quiser, é uma fase própria.
- A volta tem um nível só (D5), e o celular só se confere no aparelho depois do
  deploy (`.claude/rules/celular.md`).

## Deixado de fora

- Mostrar os relacionados no card do funil ou na lista de conversas.
- Pilha de "voltar" com vários níveis (D5 é um nível).
- API v1 para vínculos (nenhum integrador pediu).
