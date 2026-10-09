# Plano — Etapa "Reagendar" e a medida de comparecimento

Pedido do operador (09/10/2026). Hoje só existe a etapa **No Show**: ela marca
"não compareceu", encerra a conversa e é tratada como falta. Mas há clientes
que **avisam antes** que não vão comparecer e pedem para remarcar — diferentes
de quem some sem falar nada. O operador quer:

1. uma etapa própria no funil Bancário - Comercial para quem precisa remarcar
   ("funil de reagendamento" no vocabulário dele = uma COLUNA do funil, como a
   No Show);
2. na pauta de reuniões (`/reunioes`), ao lado de "Com proposta", "Sem
   proposta" e "No show", um botão **"Reagendar"** que leva o card para lá;
3. essa etapa aparecendo como **próxima etapa recomendada** no card;
4. entrar nela **não conta como no-show**: o lead segue contando como "com
   reunião" nas métricas de saúde do funil;
5. a conversa **não é encerrada**: fica aberta para a equipe remarcar.

E, nas decisões deste plano, pediu também uma **medida de comparecimento**
(realizadas × no-show × reagendadas) no Desempenho do funil, que hoje não
existe.

Plano da pauta (de onde isto parte): `docs/PLANO-pauta-de-reunioes.md`.
Regras da área: `.claude/rules/reunioes.md`, `.claude/rules/funil.md` e
`.claude/rules/funil-metricas.md`.

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 1 | Este plano: levantamento, desenho e as decisões do operador | Concluída (09/10/2026) |
| 2 | Reagendar no código: migration, pauta, Meu dia, Gerenciar funil, faixa de possível no-show | Implementada na branch `feat/reagendar-na-pauta`; falta teste no preview, revisão do Codex e merge |
| 3 | Configuração pelo operador: criar a etapa, marcar, ajustar o botão de avançar | Não começada — depois do deploy da Fase 2 |
| 4 | Medida de comparecimento no Desempenho | Não começada — PR próprio, depois da Fase 2 |

## Decisões do operador (09/10/2026)

| # | Pergunta | Resposta |
| --- | --- | --- |
| D1 | O botão "Reagendar" aparece também ANTES da reunião? | **Sim, antes e depois.** O cliente avisa antes, e o card tem de sair de Reunião Agendada na hora (os lembretes param) |
| D2 | A faixa de possível no-show, para quem reagendou e marcou de novo | **Não mostra nada**: a reunião que terminou em Reagendar conta como não acontecida |
| D3 | Algo automático com o card em Reagendar (mandar o link, prazo para virar No Show)? | **Nada por enquanto.** Se quiser depois, é automação da aba Automações do funil, sem código |
| D4 | Uma medida de comparecimento/no-show (não existe hoje) | **Incluir neste plano** (Fase 4) |
| D5 | Onde a medida aparece | **No Desempenho do funil** (admin, pelo período escolhido, comparando com o anterior) |

Decidido sem pergunta (pode ser revisto): a marca vale para todo funil, a
etapa nasce só no Comercial; o nome e a posição da etapa são do operador; a
taxa de comparecimento é compareceram ÷ (compareceram + no-show), com
reagendadas e sem resultado fora da conta e mostradas à parte.

## O que existe hoje (medido em 09/10/2026)

- **A No Show é uma MARCA, não um nome**: a etapa está marcada "Faltou" em
  Gerenciar funil (`pipeline_stages.desfecho_da_reuniao`, 1058). O botão "No
  show" da pauta leva o card para a primeira etapa com essa marca.
- **Quem encerra a conversa é uma AUTOMAÇÃO da etapa** ("Bancário · No Show -
  encerrar conversa", gatilho de entrada na No Show). Uma etapa nova sem essa
  automação deixa a conversa aberta — não há código a escrever para isso.
- **Não existe métrica de no-show no CRM.** Desempenho e Saúde contam por
  DEGRAU, e a No Show está no degrau "Reunião", o mesmo da Reunião Agendada.
  O "faltou" só aparece em três lugares: o resultado da reunião (pauta e Meu
  dia), o selo "Já faltou" na pauta e a faixa de possível no-show na conversa
  (`aviso-de-no-show.ts`). Uma etapa nova no degrau "Reunião" conta igual à
  Reunião Agendada nas métricas de funil — que é o item 4 do pedido.
- **Lembretes de reunião** (24 h, 4 h, 1 h, 10 min) só saem com o card em
  Reunião Agendada ou MQL 2. Card em Reagendar não recebe lembrete — que é o
  certo para quem avisou que não vai.
- **A pauta só aceita resultado depois que a reunião COMEÇA**: o marco gravado
  antes do início é descartado, e a trilha só conta depois do início (a
  reunião pode mudar de horário, e o registro antigo resolveria o horário
  novo).
- **A rota da pauta** (`GET /api/cb/reunioes?de&ate`) já devolve o resultado
  de cada reunião, para janelas de até 120 dias, a qualquer membro.
- **Números (últimos 30 dias, Bancário - Comercial):** 38 entradas em No Show
  (35 cards, 37 por gente). 5 desses cards voltaram para Reunião Agendada ou
  MQL 2, todos à mão, de 5 minutos a um dia depois; nenhum agendou de novo
  pelo Calendly depois do No Show. A pauta registrou 16 "no show" e 1 "sem
  proposta" desde que existe. O link manual do Calendly ("Reunião com
  Advogado") teve 5 agendamentos desde 16/09 — é o caminho que a equipe usa
  para remarcar.
- **A agenda do CRM (`cb_meetings`) está vazia**: na prática toda reunião da
  pauta vem do Calendly, cujo registro começa em 08/09/2026.

## Fases 2 e 3 — o Reagendar

### 1. Uma marca nova: "Reagendar"

`pipeline_stages.desfecho_da_reuniao` ganha o valor `reagendar`, escolhido em
Gerenciar funil no mesmo seletor "Reunião" (Qualificada, Compareceu, Faltou,
**Reagendar**). Como as outras, nunca pelo nome da etapa. Da proposta em
diante o campo continua travado (`marcaDaReuniaoQueVale`).

### 2. A etapa (Fase 3, configuração)

Criada pelo operador em Gerenciar funil: nome sugerido **"Reagendar"**, ao lado
da No Show, degrau **"Reunião"** (conta como reunião no Desempenho e na Saúde,
como hoje a Reunião Agendada e a No Show), marca **"Reagendar"**, sem
resultado (não é ganho nem perdido).

### 3. O botão na pauta (D1)

- **Antes do início**: "Reunião qualificada" e **"Reagendar"**.
- **Depois do início**: "Com proposta", "Sem proposta", **"Reagendar"**, "No
  show".
- Mesmo "Desfazer" de 5 s, mesma cerca da etapa vista, mesmas regras de "só
  registra" (sem card, card fechado, reunião antiga de quem já tem outra,
  funil sem a etapa marcada — P9 da pauta).
- O resultado novo `reagendar` vai para `cb_reunioes_marcos` e aparece como
  "pediu para reagendar" na pauta e no Meu dia, em cor neutra (não é falta).
  A reunião sai da rede de segurança.

⚠️ **O Reagendar antes do início precisa saber de QUAL horário ele é.** A
remarcação pela ficha ("Data e Hora Reunião", decisão de 03/10) reaproveita a
MESMA reunião com um horário novo; sem cuidado, o Reagendar do horário antigo
resolveria o novo. Por isso o marco passa a gravar o início da reunião que a
tela via (`cb_reunioes_marcos.inicio`), e o Reagendar registrado antes do
início só vale enquanto o início da reunião for esse. A entrada do card na
etapa pelo quadro continua valendo só depois do início, como os outros
resultados: mover pelo quadro antes da hora não resolve a reunião, e a pauta
pede a confirmação na hora (um clique em "Reagendar"; o card já está lá).

### 4. Não é falta (D2)

- O selo "Já faltou" da pauta e o motivo `faltou` da faixa de possível no-show
  leem só a marca "Faltou": o Reagendar fica de fora sem mudança.
- O outro motivo da faixa, `sem_avanco` ("teve reunião em DD/MM e não chegou à
  proposta"), passa a ignorar a reunião que terminou em Reagendar, pela MESMA
  régua da pauta (`resultadoDaReuniao`: o marco daquele horário, ou a entrada
  na etapa entre o início e a próxima reunião). A rota do aviso passa a ler os
  marcos do contato.

### 5. A conversa fica aberta

Nada a fazer: a etapa nova não tem a automação de encerrar. Se o card for de
No Show para Reagendar (um "Corrigir" na pauta), a conversa encerrada pela No
Show não reabre sozinha — reabre com a mensagem do cliente, como sempre.

### 6. Etapa recomendada (Fase 3, configuração)

Gerenciar funil → "Botão de avançar" (1065): em Reunião Agendada e MQL 2,
incluir Reagendar entre as próximas; em Reagendar, a próxima é Reunião
Agendada (voltar é sempre escolha à mão — o automático só sugere para a
frente). Sem código.

### 7. A volta: quando o cliente marca a nova data

- **Pelo link manual do Calendly**: com a mudança do Calendly proposta em
  09/10 (a automação "Calendly → Reunião agendada" passa a ouvir os dois
  links), o card sai sozinho de Reagendar para Reunião Agendada e os
  lembretes da nova data saem. ⚠️ Sem essa mudança gravada, o card fica em
  Reagendar e a equipe o move à mão.
- **Remarcada à mão** (Google Agenda + "Data e Hora Reunião"): a equipe move o
  card de volta pelo botão de avançar (item 6). A pauta mostra a reunião no
  horário novo, sem resultado.

### Fase 2 — o que muda no código

- **Migration `1081_cb_reagendar_na_pauta.sql`** (número conferido em
  09/10/2026 no `main`, nas worktrees, nos branches remotos e no histórico do
  banco; provada num Postgres 16 local, aplicada duas vezes): o CHECK de
  `pipeline_stages.desfecho_da_reuniao` aceita `reagendar` (sem tirar as três
  de hoje); o CHECK de forma `cb_reunioes_marcos_forma_ck` aceita o resultado
  `reagendar` (sem valor); a coluna `cb_reunioes_marcos.inicio timestamptz`,
  NULÁVEL. ADITIVA: aplicar ANTES do deploy. Conferência no modelo da
  1058/1063 (inserção que estoura e se desfaz por SQLSTATE próprio) e pino
  novo ao lado do da 1063 (que lê só o arquivo da 1063 e continua valendo).
- `src/types/index.ts` — o tipo de `desfecho_da_reuniao`.
- `src/lib/reunioes/pauta.ts` — `Resultado`/`RESULTADOS`, `MarcaDaEtapa`,
  `resultadoDaEtapa`, `alvosDoFunil`, `comoMarcar`, `resultadoDaReuniao` (o
  Reagendar antes do início, pelo `inicio` gravado); `faltouAntes` não muda.
  Testes.
- `src/lib/reunioes/executar.ts` — grava `inicio` no marco.
- `src/app/api/cb/reunioes/route.ts` — `marcaDaEtapa` aceita a marca; o marco
  vem com `inicio`.
- `src/components/reunioes/linha-da-reuniao.tsx` — o botão nas duas fases, o
  rótulo e o aviso de "só registra" com quatro botões.
- `src/components/meu-dia/bloco-da-agenda.tsx` — rótulo e cor do resultado.
- `src/components/pipelines/pipeline-settings.tsx` — a opção no seletor
  "Reunião" e a linha em "O que cada coluna quer dizer".
- `src/lib/agenda/aviso-de-no-show.ts` e
  `src/app/api/cb/agenda/contato/[contactId]/route.ts` — item 4.
- `messages/en.json` e `messages/pt-BR.json` — juntos.
- `.claude/rules/reunioes.md` (pauta e aviso), `docs/PLANO-pauta-de-reunioes.md`
  (link para cá) e, ao aplicar, `docs/MIGRATIONS-APLICADAS.md`.
- CLAUDE.md, seção 12: uma linha com D1–D2 (decisões que não se revertem sem
  perguntar).
- `docs/MERGE-UPSTREAM.md` e `.claude/rules/funil.md`: a linha dos trechos
  nossos no `PipelineSettings` (a marcação "Reunião") ganha o "Reagendar" —
  `pipeline-settings.tsx` veio do upstream.
- A API pública não muda: nem a marca da etapa nem o resultado da reunião são
  expostos (conferido em `src/app/api/v1`). Conferir o portão com
  `node scripts/doc-acompanha.mjs`; sem doc de integração a mudar, o commit
  leva `Doc-inalterada: <motivo>`.

**O que mudou em relação ao planejado** (na implementação, branch
`feat/reagendar-na-pauta`):

- **`marcoValeParaAReuniao`** (nova, exportada em `pauta.ts`): a regra "o marco
  vale para esta reunião?" saiu de dentro de `resultadoDaReuniao` para uma
  função, porque a rota do aviso de no-show confere o marco pela MESMA régua.
  Os resultados de sempre valem gravados depois do início; o `reagendar` com
  `inicio` vale se o `inicio` gravado é o MESMO INSTANTE do início da reunião
  (comparado por instante, não por texto: `Z`, `+00:00` e microssegundos);
  `reagendar` sem `inicio` cai na regra de sempre.
- **`comoMarcar` não mudou**: o destino sai da chave nova `reagendar` de
  `alvosDoFunil` (`AlvosDoFunil` é `Record<Acao, …>`).
- **"Corrigir" só depois do início** (`linha-da-reuniao.tsx`): antes dele o
  único resultado possível é o Reagendar, e corrigir abriria os botões de
  depois do início — o que se gravasse seria anterior ao início e não
  valeria, e o upsert do mesmo marco apagaria o Reagendar: a reunião voltaria
  a "sem resultado" com o card já movido.
- **O aviso de no-show** (`aviso-de-no-show.ts`, item 4): a rota
  (`/api/cb/agenda/contato/[contactId]`) lê os marcos `reagendar` do Calendly
  e da agenda do contato, confere cada um por `marcoValeParaAReuniao` e passa
  `reagendada` por reunião; a função tira de `sem_avanco` a reunião
  `reagendada` ou com entrada numa etapa marcada "Reagendar" na janela
  `[início, início da próxima reunião)`. A Kommo não tem marco.
- **Meu dia**: rótulo e cor do resultado por `switch` exaustivo — antes, o que
  não era proposta nem sem proposta caía em "no show".
- **Pino da migration**: `supabase/migrations/reagendar-na-pauta-1081.test.ts`,
  ao lado do da 1063.
- **O Reagendar antes do horário e as reuniões vizinhas** (acrescentado na
  integração e na revisão independente do PR #395, regras em
  `.claude/rules/reunioes.md`): (1) a reagendada não é "a próxima" de quem
  começa depois do Reagendar dela — a reunião que o cliente ANTECIPOU pelo
  link manual ficava só registrando —, e só enquanto o resultado final dela
  continua Reagendar (corrigida pelo quadro, volta a ser fronteira; Codex);
  (2) a entrada em "Reagendar" só vale
  para uma reunião até o agendamento da seguinte — senão o Reagendar da nova
  resolvia a anterior por cima do no show dela; (3) a reagendada fecha a
  trilha no agendamento da substituta — senão herdava o no show ou a proposta
  dela; (4) com reunião anterior que ainda não começou, o Reagendar só
  registra (`reuniao_anterior`) — senão calava os lembretes dela. A faixa de
  no-show segue as mesmas réguas (a rota passa `agendadaEm`).
- **Limite aceito**: "No show" → "Corrigir" → "Reagendar" deixa "Já faltou" e
  a faixa `faltou` acesos (a entrada em No Show fica na trilha).
- **Limite aceito**: o cliente que desiste de reagendar ANTES da hora segue
  "pediu para reagendar" até a reunião começar — mover o card de volta não
  apaga o marco; na hora, "Corrigir" troca o resultado.

## Fase 4 — a medida de comparecimento no Desempenho (D4, D5)

**O que aparece.** No Desempenho de cada funil, uma seção "Reuniões", pelo
período escolhido e comparada com o período anterior, como os outros cartões:

- **Compareceram** (com proposta + sem proposta), com quantas tiveram
  proposta;
- **No-show**;
- **Reagendaram** (avisaram e pediram nova data);
- **Comparecimento** = compareceram ÷ (compareceram + no-show), e a frase "N
  sem resultado" ao lado. Reagendadas e sem resultado ficam FORA da taxa.
  Taxa sem denominador é "—", nunca 0%.

**Quais reuniões.** As que COMEÇARAM no período e antes de agora, não
desmarcadas (cancelada ou substituída no Calendly fica de fora, como na
pauta), com o resultado pela MESMA régua da pauta (`resultadoDaReuniao`:
marco da tela ou entrada do card na etapa). Conta pela data da reunião nos
dois modos do Desempenho (por período e por mês de entrada): reunião é
evento, não coorte — a seção diz isso.

**De qual funil.** O funil em que o card da reunião estava NO DIA dela (pela
trilha), nunca o funil de hoje: quem fechou e foi transferido para o Jurídico
continua contando no Comercial — a mesma regra do funil comercial
("negócio transferido conta no funil de origem"). Reunião sem card fica fora
de todo funil (a seção diz quantas, se houver).

**Onde aparece.** Só no funil com alguma etapa marcada "Faltou", "Compareceu"
ou "Reagendar" (hoje, o Bancário - Comercial): nos outros, zeros teriam cara
de medida. Só admin, como o resto do Desempenho.

**Como lê.** A rota da pauta lê até 120 dias e o Desempenho vai até "Este ano"
e "Total". A carga da pauta (Calendly, agenda, contatos, cards, trilha,
marcos, ficha) sai da rota para `src/lib/reunioes/carregar.ts`, paginada, e
uma rota nova `GET /api/cb/reunioes/resumo?de&ate` a usa e devolve SÓ as
contagens por funil (nenhum dado de cliente). Mesma cerca de conta, de
acesso e de limite de pedidos da rota da pauta. A conta é pura e testada
(`src/lib/reunioes/resumo.ts`); a tela em `src/components/funil/desempenho.tsx`,
com as chaves nos dois dicionários.

**Limites conhecidos.**
- Antes de 28/09/2026 a equipe movia os cards na Kommo: as reuniões dali
  aparecem "sem resultado" (fora da taxa, mas no "N sem resultado"). Com
  "Total", a seção avisa que a medida começa a valer em 28/09.
- As reuniões históricas da Kommo (1036) não entram: não têm resultado.
- "Total" lê todas as reuniões desde 08/09/2026: medir o tempo de carga antes
  do merge (hoje ~140 agendamentos por mês).

## Ordem

1. Fase 2: branch a partir de `main`; migration + código + testes; replay
   verde no CI.
2. Aplicar a migration em produção (pedido explícito do operador, com o nome
   da migration) ANTES do merge.
3. Merge (= deploy) com o operador ciente.
4. Fase 3: o operador cria a etapa e marca (ou eu, com o "pode gravar"), e
   ajusta o botão de avançar.
5. Fase 4 em PR próprio, a partir do `main` com a Fase 2.
6. Teste ponta a ponta no preview só com o lead de teste autorizado e num
   funil de TESTE criado na hora (a TinTim ouve MQL 2/Proposta/Contrato do
   funil real; o lead de teste nunca vai para essas etapas).

## Riscos e armadilhas

- **Reagendar antes da hora × reunião que muda de horário**: coberto pelo
  `inicio` gravado no marco (item 3). O upsert do marco é um por reunião: o
  resultado do horário novo substitui o Reagendar do antigo (como já acontece
  com qualquer correção); a trilha guarda a passagem pela etapa.
- **Card movido pelo quadro para Reagendar antes da hora não resolve a
  reunião** (a trilha só vale depois do início): a pauta pede a confirmação
  na hora. É o lado seguro — a alternativa resolveria por engano a reunião
  remarcada pela ficha.
- **Funil sem a etapa marcada**: o botão só registra, com a explicação (como
  os outros).
- **TinTim e webhooks**: Reagendar não é MQL 2, Proposta nem Contrato, então o
  Make da iMotion não o repassa; os avisos `deal.*` ao n8n saem como em
  qualquer mudança de etapa.
- **Lembrete**: só para se o card sair de Reunião Agendada/MQL 2 — é o botão
  que o tira. Card que fica onde está continua recebendo lembrete.
- **Medida (Fase 4)**: a régua do resultado é a da pauta; mudar uma sem a
  outra faria a pauta e o Desempenho discordarem sobre a mesma reunião. A
  conta usa a função da pauta, nunca uma cópia.
