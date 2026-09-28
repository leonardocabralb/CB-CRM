# Plano — histórico de reuniões e aviso de possível no-show

Pedido do operador (27/09/2026): a aba Reuniões mostrava só as reuniões
marcadas na agenda interna do CRM, e nenhuma do Calendly. Ele quer:

1. **O registro**, para ver depois e quantificar quantas reuniões um contrato
   precisa.
2. **Um aviso de possível no-show:** quando um lead marca reunião nova e já
   tinha marcado antes sem avançar no funil (sem valor de proposta, sem passar
   por proposta), ou já passou pela etapa No Show, um aviso pequeno na tela.

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 1 | Histórico: Calendly e Kommo na aba Reuniões | Mesclada (#331, 27/09/2026) |
| 2 | Aviso de possível no-show na conversa | PR #332; 1058 aplicada e etapas marcadas (27/09/2026); testado no preview; falta a revisão e o merge |

## Decisões do operador (27/09/2026)

- **D1 — onde avisa:** só a faixa pequena na conversa, acima da caixa de
  mensagem (a opção B do esboço). Nada no card do funil, na lista de conversas
  nem na aba Reuniões.
- **D2 — o que é "avançou":** passou por uma etapa de proposta ou contrato
  (Proposta Realizada, Contrato Fechado), tem valor no card, ou foi para
  "Reunião Sem Proposta" (compareceu, só não teve proposta). MQL 2 NÃO conta.
- **D3 — Kommo no histórico:** sim. A Kommo guardou só a data da ÚLTIMA
  reunião de cada lead, e ela também conta para o aviso.

## Medições (27/09/2026, só leitura)

- **Calendly:** 92 agendamentos desde 08/09, de 81 clientes; 8 cancelamentos.
  8 reagendamentos, 5 deles de antes de o cancelamento chegar ao CRM (1013).
- **Kommo (1036):** 1.196 reuniões, 574 ligadas a fichas; 49 das 56 desde
  08/09 são a mesma reunião do Calendly.
- **Agenda interna (`cb_meetings`):** 0 reuniões.
- **No Show na trilha:** 123 clientes já passaram pela etapa desde jun/2025;
  97 cards estão nela hoje.
- **MQL 2 - Reunião Qualificada acontece ANTES da reunião:** 28 das 30
  entradas (mediana de 5 h antes do horário). Proposta Realizada: 16 de 16
  depois (mediana de 30 min). É por isso que MQL 2 não prova comparecimento.
- **O funil do CRM não registra o desfecho das reuniões recentes:** a equipe
  ainda move os cards na Kommo, e a carga parou em 19/09. Desde 20/09, no
  Bancário - Comercial, só 1 card foi para No Show e 1 para Proposta; dos 75
  agendamentos do Calendly que já passaram, 39 continuam em "Reunião
  Agendada".
- **Se o aviso existisse desde 08/09:** teria aparecido em 10 dos 92
  agendamentos (3 por No Show anterior, o resto por reunião anterior sem
  avanço). Pelo item acima, ainda não dá para medir se ele acerta.
- **Reuniões por contrato (pela trilha):** dos 208 contratos fechados desde
  jun/2025, 106 tiveram 1 reunião marcada, 14 tiveram 2 e 88 não têm reunião
  na trilha (a carga da Kommo reconstruiu só parte).

## Fase 1 — histórico (sem migration)

**Objetivo:** a aba Reuniões (ficha de Contatos e painel da conversa) mostra
também os agendamentos do Calendly e a última reunião da Kommo, só leitura.

**Arquivos:** `src/lib/agenda/reunioes-externas.ts` (puro) e o teste; rota
`src/app/api/cb/agenda/contato/[contactId]/route.ts`; hook
`useReunioesExternasDoContato` em `src/hooks/use-reunioes.ts`;
`src/components/agenda/reunioes-do-contato.tsx`; balde `reunioesDoContato`
em `src/lib/rate-limit.ts`; `SITUACAO_REAGENDAMENTO` em
`src/lib/calendly/variaveis.ts`; chaves `Agenda.*` nos dois dicionários.

**Como funciona:**
- A rota lê as duas tabelas fechadas e devolve só data, evento, link e
  situação (sem telefone, e-mail ou respostas do formulário).
- Cancelamento casado pelo convite. O convite que um reagendamento substituiu
  vira "Reagendada" por inferência: entre os que chegaram antes, do mesmo tipo
  de evento e cuja reunião ainda não tinha acontecido, só quando a resposta é
  única (um candidato, ou o único que o Calendly avisou como cancelado).
  Conferida contra os 8 reagendamentos (todos com candidato único) e os 2
  casos que têm o cancelamento gravado.
- A reunião da Kommo some quando o Calendly tem uma no mesmo instante.
- Depois que a reunião termina (pelo fim, não pelo início), ela fica sem
  situação (o Calendly não diz se o cliente compareceu); durante a reunião o
  link continua na tela.

**Resultado medido (preview, contra o banco, só leitura):** cliente com três
agendamentos e dois reagendamentos anteriores à 1013 mostra os dois antigos
riscados como "Reagendada", o que aconteceu (com transcrição do tl;dv no mesmo
dia) e a reunião da Kommo; a rota responde só as chaves previstas, 404 para id
inválido e lista vazia para cliente de outra conta.

## Fase 2 — aviso de possível no-show

**Objetivo:** quando o lead tem reunião marcada e já faltou (ou marcou antes e
não avançou), uma faixa pequena na conversa, acima da caixa de mensagem.

**Arquivos:** migration `1058_cb_desfecho_da_reuniao_na_etapa.sql`
(`pipeline_stages.desfecho_da_reuniao`); `src/lib/agenda/aviso-de-no-show.ts`
(puro) e o teste; a rota da Fase 1 devolve também `aviso`; o hook
`useReunioesExternasDoContato` o repassa (com o `resyncToken` do fio);
`src/components/inbox/faixa-de-no-show.tsx` montada em `message-thread.tsx`;
o seletor "Reunião" por etapa em `pipeline-settings.tsx` (diálogo agora
`sm:max-w-2xl`); o tipo em `src/types/index.ts`; chaves
`Pipelines.settings.reuniao*`/`stageReuniao*` e `Inbox.noShow.*`.

**Como funciona:**
- Em Gerenciar funil, cada etapa ganha "Reunião: — / Compareceu / Faltou". O
  operador marca No Show = Faltou e Reunião Sem Proposta = Compareceu. Nada é
  deduzido pelo nome da etapa, e proposta/contrato já contam pelo degrau.
- O aviso aparece quando o cliente tem reunião FUTURA (Calendly, Kommo ou
  agenda, não desmarcada) e: (1) já entrou numa etapa "Faltou", a qualquer
  tempo, ou a agenda registrou a falta; ou (2) já teve reunião que terminou,
  não desmarcada, e NUNCA avançou (degrau proposta/contrato/pasta, etapa
  "Compareceu", agenda "Realizada" ou card com valor).
- Texto factual: "Possível no-show — este cliente foi para No Show em 12/08.
  Nova reunião em 30/09 às 15:00." ou "… teve reunião em 15/09 e não avançou
  no funil. …". Some quando a nova reunião termina.

**Feito em 27/09/2026 (com autorização do operador):** a 1058 aplicada depois
do replay verde no commit `8f1cd354` (histórico `20260927220948`); marcadas
No Show = Faltou e Reunião Sem Proposta = Compareceu no Bancário - Comercial
(o UPDATE não aciona gatilho; o app antigo não apaga a marcação ao salvar
Gerenciar funil, porque o upsert dele não leva a coluna).

**Resultado medido (preview, contra o banco):**
- A rota respondeu 200 para os 9 clientes com reunião marcada; 1 ganhou o
  aviso — "teve reunião em 06/08 e não avançou", com agendamento novo para
  29/09 —, e a trilha dele confere (Reunião Agendada em 05/08, reunião da
  Kommo em 06/08, nenhum movimento nem valor depois).
- A faixa, com a resposta da rota simulada no navegador para o lead de teste
  (sem gravar reunião de teste): "Possível no-show — este cliente foi para No
  Show em 09/09. Nova reunião em 30/09 às 15:00."; a variante "não avançou"
  com o texto certo; sem faixa depois que a reunião termina e sem aviso.
- Gerenciar funil lê do banco "Faltou" no No Show e "Compareceu" na Reunião
  Sem Proposta; o diálogo abre com 672 px e o nome da etapa com 201 px.

**Limites que o operador precisa saber:**
- Até o corte da Kommo (ou a atualização final dos dados de lá), o aviso não
  vê faltas recentes e pode acusar quem compareceu (ver Medições).
- Gerenciar funil no celular já não cabia com dois seletores por etapa; com
  três continua sem caber (tela de administrador, usada no computador).
- O aviso é calculado quando a conversa abre (e ao voltar à aba ou apertar
  "Atualizar"). Com DUAS reuniões futuras e a conversa aberta durante o fim da
  primeira, a faixa só se ajusta ao reabrir (Codex, PR #332). Caso raro, e o
  lado é seguro: o aviso atrasa, não afirma nada falso. O conserto, se o
  operador quiser, é a rota devolver o fim da próxima reunião e o hook se
  reler nessa hora.

## Fora do escopo (para depois, se o operador quiser)

- Métrica "reuniões por contrato" no Desempenho do funil.
- Linha de alerta no aviso de WhatsApp que o advogado recebe a cada
  agendamento.
- Marcar "Faltou/Compareceu" em cada reunião do histórico a partir da trilha.
