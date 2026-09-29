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
| 1 | Migration 1069 + pino | em curso |
| 2 | Hook + módulo puro + aba no painel da conversa | — |
| 3 | Faixa "Voltar para" na caixa de entrada | — |
| 4 | Aba na ficha de /contatos | — |
| 5 | Revisão, teste no preview, regras e PR | — |

## Deixado de fora

- Mostrar os relacionados no card do funil ou na lista de conversas.
- Pilha de "voltar" com vários níveis (D5 é um nível).
- API v1 para vínculos (nenhum integrador pediu).
