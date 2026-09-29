# Plano — Pauta de reuniões (`/reunioes`)

Pedido do operador (28/09/2026): uma tela própria para chegar de manhã, ver as
reuniões do dia, decidir prioridades e resolver cada reunião. No lugar de
"confirmado", **ações que movem o card**:

- antes da reunião, **"Reunião qualificada"** leva o card para a MQL 2;
- depois que a reunião **começa**, o resultado: **com proposta** (pede o valor
  e leva para Proposta Realizada), **sem proposta** (Reunião Sem Proposta) ou
  **no show** (No Show).

A etapa funciona como **rede de segurança**: toda reunião que já começou tem
de terminar com resultado, e a tela mostra as que ficaram sem.

O estudo que levou a isto (números medidos em 28/09/2026 e as três visões
propostas) está na memória do projeto; a tela da semana em grade e o quadro
por situação ficaram para a Fase 3.

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 1 | Pauta do dia, botões "qualificada" e resultado, rede de segurança, volta da caixa de entrada | Em revisão (PR aberto em 29/09/2026) |
| 2 | Grau de qualificação (de-para das faixas de dívida e atraso), sinais de pré-qualificação e de automação/IA em andamento | Não começada — depende do critério do operador |
| 3 | IA lendo as respostas da pré-qualificação; visões de semana em grade e quadro por situação | Não começada — depende de aprovação |

## Fase 1 — o que foi feito

**Arquivos:**
- `supabase/migrations/1061_cb_pauta_de_reunioes.sql` — a marca `qualificada`
  em `pipeline_stages.desfecho_da_reuniao` e a tabela `cb_reunioes_marcos`
  (uma linha por reunião e por marco, com quem marcou carimbado pelo banco).
- `src/lib/reunioes/pauta.ts` (regras, puro), `montar.ts` (monta a pauta a
  partir das linhas cruas, puro), `executar.ts` (move o card e registra),
  `retorno.ts` (a volta da caixa de entrada), com testes.
- `src/app/api/cb/reunioes/route.ts` — lê Calendly (fechado ao navegador),
  agenda do CRM, contatos, conversas, cards, campos, trilha e marcos.
- `src/components/reunioes/*`, `src/app/(dashboard)/reunioes/page.tsx`,
  `src/hooks/use-pauta-de-reunioes.ts`.
- Encanação: item "Reuniões" no menu (depois de Agenda), título no cabeçalho,
  `/reunioes` protegida no middleware, `de=reunioes` na caixa de entrada com a
  faixa "Voltar às reuniões", a opção "Qualificada" no seletor "Reunião" de
  Gerenciar funil.

**Decisões tomadas na implementação** (o operador mandou implementar; cada uma
pode ser revista):

| # | Decisão | Por quê |
| --- | --- | --- |
| P1 | A tela fica FORA do catálogo de perfis (visível a todos, como o Meu dia) e recorta por FUNIL do perfil (`funilNoEscopo`) | Tela nova no catálogo nasce invisível para todo perfil já gravado. |
| P2 | Os botões aparecem para `agent` ou acima (`send-messages`); o observador só vê | É o piso de `deals_update`. |
| P3 | Sem botão "Desqualificar" | O pedido não o trouxe. |
| P4 | Quem compareceu sem ter sido marcado qualificado vai DIRETO para a etapa do resultado (não passa pela MQL 2) | Passar pela MQL 2 mandaria à TinTim dois avisos por um gesto. |
| P5 | A rede de segurança olha os últimos 30 dias | Cobre o log do Calendly inteiro (começa em 08/09) sem crescer para sempre. |
| P6 | O valor digitado vai para o valor do CARD, na mesma escrita que a etapa | O Make da iMotion manda à TinTim o valor do card no instante da entrada em Proposta Realizada. |
| P7 | A etapa de "reunião qualificada" é uma MARCA em Gerenciar funil (nunca o nome) | Renomear "MQL 2" desligaria o botão em silêncio. |
| P8 | "Desfazer" de 5 s antes de mover o card; sair da tela no meio GRAVA na hora | Mover dispara automações e o aviso à TinTim, sem volta. Quem clica e abre a conversa em seguida conta com o card movido. |
| P9 | Card GANHO não recebe botões; PERDIDO recebe (entrar em etapa neutra o reabre, 1031) | Ganho é cliente. |

**O que fica de fora, por escrito:**
- A reunião resolvida por outro caminho (quadro, lista, painel da conversa)
  conta pela TRILHA do card; o marco da tela serve para o caso em que o card
  já estava na etapa (mover para a mesma etapa não grava trilha).
- O advogado de cada reunião não é gravado (o webhook do Calendly não lê o
  anfitrião): não há filtro por advogado.
- "Confirmado" não existe; o pedido o trocou por "qualificada".

## Riscos e armadilhas (para quem mexer)

- ⚠️ A mudança de etapa vai do NAVEGADOR, sob RLS: é o que faz a trilha e os
  webhooks `deal.*` dizerem gente. Por rota de servidor sairia `system`.
- ⚠️ A escrita do card é cercada pela etapa que a tela viu: o Calendly move o
  card para "Reunião Agendada" a cada agendamento, e passar por cima o levaria
  para trás.
- ⚠️ A inferência de reagendamento (`montarReunioesExternas`) é POR CONTATO e
  precisa de TODOS os agendamentos do contato, não só os da janela.
- ⚠️ `cb_calendly_eventos` é fechada ao navegador: a leitura é por rota.

## Verificação

- Testes: `src/lib/reunioes/*.test.ts`, `supabase/migrations/pauta-de-reunioes-1061.test.ts`.
- A 1061 provada num Postgres 16 descartável antes de aplicar: aplicada duas
  vezes (idempotência), banco vazio, e 9 cenários (carimbo do banco, upsert,
  outra conta, observador, anon, forma). Achou um defeito real no CHECK de
  forma (`NULL IN (…)` passava), corrigido antes de aplicar.
