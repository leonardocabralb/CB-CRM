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
| 1 | Pauta do dia, botões "qualificada" e resultado, rede de segurança, volta da caixa de entrada | No ar (PR #339, 29/09/2026). MQL 2 marcada "Qualificada" pelo operador no mesmo dia |
| 2 | Grau de qualificação (de-para das faixas de dívida e atraso), sinais de pré-qualificação e de automação/IA em andamento | Não começada — depende do critério do operador |
| 3 | IA lendo as respostas da pré-qualificação; visões de semana em grade e quadro por situação | Não começada — depende de aprovação |

## Fase 1 — o que foi feito

**Arquivos:**
- `supabase/migrations/1063_cb_pauta_de_reunioes.sql` — a marca `qualificada`
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
| P8 | "Desfazer" de 5 s antes de gravar; sair da tela no meio GRAVA na hora; fechar a aba no meio pede confirmação ao navegador | Mover dispara automações e o aviso à TinTim, sem volta. Quem clica e abre a conversa em seguida conta com o card movido. |
| P9 | Só card ABERTO anda. Sem card, card ganho ou perdido, funil sem a etapa marcada, ou reunião ANTIGA de um contato que já tem reunião mais nova: o botão só REGISTRA o resultado (a tela diz por quê) | Ganho é cliente; o perdido entrando em etapa neutra seria reaberto pela 1031; o card de quem remarcou já é da reunião nova (e dos lembretes dela). Registrar sempre é o que deixa a rede de segurança apagar (revisão do PR #339). |
| P10 | Cada reunião só olha a trilha do SEU card e da sua janela: do início dela até o início da próxima reunião do mesmo contato | Sem o teto, o resultado da reunião B resolveria a A, anterior (revisão do PR #339). |
| P11 | "Corrigir" reabre os botões numa reunião já resolvida | Corrigir é marcar de novo: o upsert troca o registro do mesmo marco. |

**Lembretes e MQL 2** (P1 da revisão do PR #339): os quatro lembretes de
reunião (24 h, 4 h, 1 h, 10 min) tinham escopo só em "Reunião Agendada", e
levar o card para a MQL 2 os calaria. Decisão do operador (29/09/2026): a MQL
2 do Bancário - Comercial ENTROU no escopo dos quatro (gravado em produção no
mesmo dia; medido antes: nenhum card em MQL 2 tinha reunião futura, então
nada disparou atrasado). A 1063 não marca etapa nenhuma: o botão "Reunião
qualificada" só registra até a MQL 2 ser marcada "Qualificada" em Gerenciar
funil. ⚠️ Quem criar outro lembrete de reunião põe as duas etapas no escopo.

**Proposta só com valor** (pedido do operador, 29/09/2026): a entrada em
Proposta Realizada dispara o aviso à TinTim com o valor do card. O card só
anda depois que o valor é digitado e confirmado, na mesma escrita que a
etapa; o campo nasce VAZIO (nunca com o valor antigo do card — só com o da
própria proposta, ao corrigir); e `executarAcao` recusa "com proposta" sem
valor maior que zero, sem gravar nada.

**Da proposta em diante o degrau vence a marcação "Reunião"** (pedido do
operador, 29/09/2026): ele marcou "Proposta Realizada" como "Compareceu" — a
intuição natural —, e a tela passou a ler a entrada nela como "sem proposta",
porque "Compareceu" é a marca da "Reunião Sem Proposta". Agora a marcação de
etapa com degrau proposta, contrato ou pasta é ignorada por todo leitor
(`marcaDaReuniaoQueVale`), Gerenciar funil trava o campo nessas etapas e o
limpa ao salvar, e as três colunas de cada etapa ganharam título e o bloco "O
que cada coluna quer dizer".

**O que fica de fora, por escrito:**
- A reunião resolvida por outro caminho (quadro, lista, painel da conversa)
  conta pela TRILHA do card; o marco da tela serve para o caso em que o card
  já estava na etapa (mover para a mesma etapa não grava trilha) e para os
  casos em que o card não anda (P9).
- Duas leituras (a semana à vista e os 30 dias da rede), porque numa só a
  navegação para semanas distantes passava do teto de janela da rota. A tela
  se relê a cada 2 minutos com a aba à vista.
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

- Testes: `src/lib/reunioes/*.test.ts`, `supabase/migrations/pauta-de-reunioes-1063.test.ts`.
- A 1063 provada num Postgres 16 descartável antes de aplicar: aplicada duas
  vezes (idempotência), banco vazio, e 9 cenários (carimbo do banco, upsert,
  outra conta, observador, anon, forma). Achou um defeito real no CHECK de
  forma (`NULL IN (…)` passava), corrigido antes de aplicar.
