# Plano vivo — Central dos agentes de IA (painel, sandbox e auditoria)

Pedido do operador (26/10/2026), depois do PR #440:

1. Um **painel** para ver quais agentes estão ativos agora, quanto cada um
   impactou no funil e quantas pessoas a retomada está recuperando, com
   gráficos, ao vivo, por agente e por setor.
2. Um **sandbox** em que se teste tudo ao vivo, mudando o agente na hora e
   vendo o efeito, inclusive as ações e a execução.
3. Um **registro histórico** das decisões, marcações e ferramentas que os
   agentes usaram, para auditar depois.

Este arquivo é o roteiro, as decisões pendentes e o diário. O detalhe de cada
fase (arquivos, migration, testes e riscos, com arquivo:linha) está em
[`PLANO-central-dos-agentes-anexo.md`](PLANO-central-dos-agentes-anexo.md).
Onde o anexo diverge deste roteiro, **vale o roteiro** (os conflitos
resolvidos estão no fim deste arquivo). As decisões e o desenho dos agentes
continuam em [`PLANO-agentes-de-ia.md`](PLANO-agentes-de-ia.md) (D1–D28). As
decisões da central são **DC1–DC25**, para não colidir com elas.

Como o plano foi feito: um workflow com três projetistas (painel, sandbox e
auditoria), três verificadores adversariais que conferiram cada desenho
contra o código e as regras (81 correções) e um integrador que juntou tudo
num roteiro. Ponto de partida: o mapeamento do que existe, também de
26/10/2026.

## Estado

| Fase | Frente | O quê | Migration | Esforço | Depende de | Estado |
|---|---|---|---|---|---|---|
| — | — | Este plano e as decisões DC1–DC25 | — | — | — | escrito em 26/10/2026; **decisões pendentes** |
| C1 | Base comum | Turno durável: o registro sobrevive à conversa e à Lixeira; o texto do cliente tem prazo | sim | M (3–4 dias) | DC1–DC3 | não iniciada |
| C2 | Sandbox | Playground testa o RASCUNHO da tela e compara com o salvo; o teste não zera ao salvar; "ver o pedido enviado" | não | M (2–3 dias) | DC4 | não iniciada |
| C3 | Base comum | Registro completo do turno: motivo da transferência, erro como código, saída bruta, valor de cada ação, destino da passagem, a marca de que esperou o horário | não | M (2 dias) | C1, DC6 | não iniciada |
| C4 | Painel | Aba **Painel** em /agents: agentes e onde atuam, desfechos por dia, por que transferiu, o que o agente fez, tempo e custo | sim | M (2–3 dias) | C1, C3, DC5 | não iniciada |
| C5 | Base comum | Versões do agente (vN, quem e quando); o turno grava a versão usada | sim | M (2–3 dias) | C3, DC7 | não iniciada |
| C6 | Auditoria | Aba **Registro**: filtros, paginação, turno detalhado, CSV; a bolha "IA · nome" leva ao turno | não | M/G (4–5 dias) | C1, C3, C4, C5, DC5, DC8, DC9 | não iniciada |
| C7 | Base comum | Linha do tempo do lead diz "pelo agente de IA X"; webhooks `deal.*` não mudam | sim | M (2–3 dias) | DC10 | não iniciada |
| C8 | Sandbox | Conversa real do contato, diagnóstico "este agente atenderia agora?", calendário da retomada | não | M (3–4 dias) | C2 | não iniciada |
| C9 | Painel | Faixa **Agora**: respondendo, na fila, esperando o horário, retomadas agendadas, transferidas esperando a equipe | não | P (1 dia) | C4, DC12 | não iniciada |
| C10 | Painel | Atendidas sem a equipe, recuperados pela retomada (e custo por recuperado), funil depois do agente | sim | M (3 dias) | C3, C4, DC13–DC15 | não iniciada |
| C11 | Sandbox | Uma régua só depois da geração; ações separadas em conferir e efeito (refatoração SEM mudar comportamento) | não | M (2–3 dias) | C2 | não iniciada |
| C12 | Sandbox | Ensaio das ações no Playground e passagem encadeada com o destino respondendo | não | M (2–3 dias) | C8, C11, DC16 | não iniciada |
| C13 | Sandbox | Áudio, imagem e PDF no Playground, lidos pelo mesmo leitor da produção, sem gravar | não | M (2–3 dias) | C2, C8 | não iniciada |
| C14 | Sandbox | **Modo observação**: numa conversa real, o agente decide e registra sem enviar nem executar | sim | G (5–6 dias) | C1, C3, C4, C6, C11 (e C10, na ordem padrão), DC11, DC17–DC20 | não iniciada |
| C15 | Sandbox | Sub-aba Observação: o que a IA diria ao lado do que a equipe respondeu | sim | M (2–3 dias) | C4, C14 | não iniciada |
| C16 | Painel | Setor do agente pelas abas das Automações, com chip e filtro | sim | P (1 dia) | C4, DC21 | não iniciada |
| C17 | Auditoria | Motivo curto declarado pelo modelo quando a resposta age | não | P (1–2 dias + medição) | C3, C6, DC22 | não iniciada |
| C18 | Sandbox | (Opcional) Roteiros salvos e "rodar a bateria" com o salvo e o rascunho | sim | M (2–3 dias) | C2, DC23 | não iniciada |
| C19 | Auditoria | (Opcional) Pedido reconstruído e conferido no detalhe do Registro | não | P/M (2–3 dias) | C3, C5, C6 | não iniciada |

Ao iniciar uma fase: registrar a anterior como concluída aqui, com o objetivo,
os arquivos tocados e o resultado MEDIDO; cada fase termina com revisão e
teste no preview; antes da seguinte, revisar se o que está planejado ainda é
necessário.

## Ponto de partida (26/10/2026, medido)

- **Painel:** não existe. Em /agents (só administrador) há:
  - a lista de agentes, com o selo ligado/desligado;
  - a aba Uso, com o custo em R$ dos últimos 30 dias, sem gráfico;
  - em cada agente, a aba Turnos, com as 50 últimas vezes que ele foi chamado.

  Nenhuma tela se atualiza sozinha, a não ser a faixa da conversa. O funil não
  separa o agente: o card que ele move aparece como "automação", e a passagem
  como "sistema". Não existe a métrica de recuperados.
- **Sandbox (Playground):** testa o "cérebro" (mesmo pedido, modelo, regras,
  ficha, base, horários do Calendly, travas e retomada), mas:
  - só a configuração SALVA;
  - as ações são só simuladas;
  - a passagem para no "passaria para X" e lista só destinos ligados;
  - não simula horário, a D27, mídia nem a conversa real.
- **Registro:** cada chamada vira um turno (`cb_ia_turnos`), e a conversa
  mostra a bolha "IA · nome", as anotações "IA · agente …" e a faixa. Mas o
  turno é **apagado junto com a conversa** (FK CASCADE na 1049), e a Lixeira o
  leva sem volta. Não há o pedido completo nem versões das instruções.
- **Números:** 5 agentes vivos, 0 ligados, 0 etapas com agente e 0 turnos no
  banco. O custo de produção sobrou em `ai_usage_log`, sem vínculo com turno.
  Até o piloto, que espera o corte da Kommo, o painel mostra quase só zeros, e
  tem de dizer "nenhum agente ligado", nunca "0%".

## Desenho em uma página

- **Onde:** abas em /agents, só para administradores (D14 do plano dos agentes):
  **Painel** (a padrão), **Agentes**, **Registro** e **Uso**. Herda o que /agents
  já tem: protectedPaths, menu, títulos e catálogo de perfis.
- **Base comum (C1, C3, C5, C7):**
  - o turno passa a durar em duas camadas: o esqueleto sem texto fica, e o
    texto do cliente sai por prazo e na exclusão definitiva;
  - o turno grava o motivo, o valor de cada ação, o destino da passagem e a
    versão do agente;
  - a linha do tempo do lead diz "pelo agente de IA X".

  Serve ao painel, ao registro e à observação ao mesmo tempo.
- **Painel (C4, C9, C10, C16):**
  - filtros num lugar só: período, agente, conexão, funil e setor;
  - faixa "Agora", que se atualiza a cada 20 s;
  - os números do período;
  - desfechos por dia, por que transferiu e o que o agente fez;
  - o funil depois do agente, sem fingir causa;
  - a retomada (recuperados e custo por recuperado);
  - tempo da resposta e custo.

  Gráficos com o `BarChart` do Tremor que o app já usa (sobre Recharts).
  **Maquete com dados fictícios:** `~/Downloads/CB-CRM/central-dos-agentes/`
  (fora do repositório).

  Cores, medidas pelo validador de paleta (daltonismo, luminosidade e
  contraste):
  - a ordem do Tremor (azul, esmeralda, violeta, âmbar, ciano, nos tons
    `-500`) passa no tema claro;
  - no claro, esmeralda, âmbar e ciano ficam abaixo de 3:1 contra o fundo
    branco, e por isso todo gráfico tem a visão "Tabela" e legenda;
  - no escuro, esses três saem da faixa de luminosidade. A C4 usa os tons
    `-600` no tema escuro, por variável CSS, porque o `dark:` está inerte
    (CLAUDE.md 8c);
  - nenhum gráfico passa de 5 séries, e a cor segue a categoria, nunca a
    posição.
- **Registro (C6, C17, C19):**
  - a conta inteira, um agente ou uma conversa, com filtros, turno detalhado
    e exportação (só o esqueleto);
  - a bolha "IA · nome" leva ao turno.
- **Sandbox (C2, C8, C11–C15, C18):**
  - testar o rascunho e comparar com o salvo;
  - partir da conversa real (só nas conexões do agente);
  - diagnóstico "atenderia agora?";
  - ensaio das ações (o que a execução recusaria e o que dispararia);
  - passagem com o destino respondendo;
  - mídia.

  O passo maior é o **modo observação**: numa conversa real, o agente decide e
  registra sem enviar nem executar, e o administrador compara com o que a
  equipe respondeu. Executar ações de verdade num contato de teste fica **fora**
  (DC24): há 31 automações de entrada de etapa ligadas, e um esquecimento manda
  mensagem ou webhook de verdade.

## Decisões do operador (DC1–DC25)

Cada uma com as opções, a recomendação e o que ela bloqueia. As quatro do
primeiro grupo destravam o começo. As outras podem esperar a fase que
bloqueiam.

### Destravam o começo (antes da C1 e da C2)

**DC1 — Como o histórico do que os agentes fizeram deve sobreviver quando a conversa é apagada ou a ficha vai para a Lixeira?** · Estado: **pendente** · Quando: Já: antes da C1, que precisa estar no ar antes de ligar o piloto

- (a) Como hoje: o registro some com a conversa, e a Lixeira o leva sem volta
- (b) Tabela de resumo separada, sem texto, mantida por gatilho, e os turnos detalhados apagados por prazo (proposta do painel)
- (c) O próprio registro sobrevive à conversa, em duas camadas: o esqueleto sem texto fica; o texto do cliente sai por prazo e na exclusão definitiva; restaurar da Lixeira religa (proposta da auditoria)
- (d) Os registros entram na fotografia da Lixeira e voltam ao restaurar, mas somem na exclusão definitiva

Recomendação: **(c).**

Por quê: Uma fonte só para o painel, o Registro e a observação:
- a auditoria do turno dura enquanto o esqueleto durar;
- o custo por turno (ai_usage_log.turno_id) deixa de se perder.
A (b) duplica o dado e mesmo assim perde o detalhe quando a conversa sai. Com a (d), o registro some do painel na exclusão definitiva. Hoje o banco tem 0 turnos (FK com CASCADE, 1049:323-324; Lixeira 'nao_volta', 1102:263): não há nada a converter.

Bloqueia: C1, C3, C4, C6, C10, C14

**DC2 — Por quanto tempo guardar o texto do cliente nos registros, o esqueleto sem texto e os registros do modo observação?** · Estado: **pendente** · Quando: Já: antes da C1

- Texto do cliente: 90 dias (o prazo que o plano aprovado em 25/09 já previa, igual ao da Lixeira)
- Texto do cliente: 180 dias (cobre reclamação tardia; ~0,15–0,55 GB no pior caso)
- Texto do cliente: 365 dias
- Esqueleto: sem prazo (como a trilha do lead) ou 24 meses
- Observação: 30 dias, ou o mesmo prazo da produção

Recomendação: **Três prazos, todos constantes no código e aplicados pela mesma rotina:
- texto do cliente: 90 dias;
- esqueleto: sem prazo, revisto se passar de ~100 MB;
- observação: 30 dias.
Antes, conferir a cota de disco do plano do Supabase (o banco tem 225 MB).**

Por quê: Separa a métrica, que não tem texto e pode ficar, da auditoria, que tem texto e precisa de prazo. Os 90 dias estão no plano aprovado (5.2) e nunca foram feitos; subir para 180 é trocar uma constante. A observação é uma avaliação temporária que manda conversa real ao provedor sem benefício ao cliente.

Bloqueia: C1, C14

**DC3 — O que a exclusão definitiva de uma ficha (pelo prazo da Lixeira ou pelo 'Excluir agora') faz com o registro dos agentes dela?** · Estado: **pendente** · Quando: Já: antes da C1

- (a) Só o 'Excluir agora' a pedido do titular limpa o texto; sem pedido, o texto fica até o prazo
- (b) Toda exclusão definitiva limpa o texto do cliente; o esqueleto fica
- (c) A (b) e, com pedido do titular, o esqueleto também perde o vínculo com o card

Recomendação: **(b). A (c) só se o jurídico do escritório pedir.**

Por quê: O texto do turno (ficha, cobranças, saída do modelo) é mais rico que o nome que a trilha guarda, e não serve para nada depois que a pessoa sai. O esqueleto não tem texto, mas aponta para o card, que sobrevive com o título igual ao nome da pessoa. A Lixeira já aceita isso hoje.

Bloqueia: C1

**DC4 — Como testar uma mudança no agente sem afetar a produção?** · Estado: **pendente** · Quando: Já: pode vir junto com DC1–DC3; a C2 corre em paralelo com a C1

- (A) O Playground recebe o rascunho que está na tela, validado como no salvar (C2)
- (B) Versão salva separada da publicada, com um botão 'Publicar' (sobre as versões da C5)
- (C) 'Duplicar agente' (uma cópia desligada)

Recomendação: **A agora. A B só depois do piloto, e só se salvar um agente ligado por engano virar problema: ela muda o fluxo de edição e é decisão própria.**

Por quê: Hoje, salvar um agente ligado muda a produção na resposta seguinte, e o Playground só testa o que já foi salvo. A opção A resolve isso sem migration.

Bloqueia: C2

### Antes do Painel e do Registro (C3–C6, C9)

**DC5 — Onde a central mora e quem a vê?** · Estado: **pendente** · Quando: Antes da C4

- (a) Abas em /agents — Painel (padrão), Agentes, Registro e Uso —, só para administradores (D14 do plano dos agentes)
- (b) Tela nova 'Central de IA' no menu, só para administradores
- (c) A (a) e, além disso, uma versão só com números para perfis escolhidos (gestores de setor)
- (d) A (a) e, além disso, a equipe vê na própria conversa as ações do turno (sem instruções nem saída)

Recomendação: **(a).**

Por quê: A (a) herda tudo o que já existe para /agents: protectedPaths, menu, pageTitles e catálogo de perfis. Uma tela nova nasce INVISÍVEL para todo perfil já gravado. A (c) e a (d) mexem na D14 do plano dos agentes: perfil só restringe o que se vê, e uma rota aberta ao papel 'agent' fica acessível a qualquer membro.

Bloqueia: C4, C6, C9

**DC6 — O que guardar do pedido que foi ao modelo em cada turno?** · Estado: **pendente** · Quando: Antes da C3

- (P1) Só o retrato de hoje e a versão
- (P2a) Também as opções numeradas, o 'agora', a agenda e os ids das mensagens que foram ao modelo (~1–2 KB)
- (P2b) A P2a e, além disso, o pedido reconstruído na tela e conferido por hash (C19)
- (P3) O texto inteiro do pedido, com prazo (~12 KB por turno; duplica a conversa)

Recomendação: **P2a, na C3. A P2b só se o piloto mostrar que falta informação.**

Por quê: A P2a dá sentido a recusas como '#3 recusada' e liga o turno às mensagens, sem guardar uma segunda cópia da conversa do cliente.

Bloqueia: C3, C19

**DC7 — O que conta como uma nova versão do agente?** · Estado: **pendente** · Quando: Antes da C5

- (V1) Só instruções e regras
- (V2) Toda a configuração do agente (modelo, ligado, conexões, horário, ferramentas, acesso, retomada…), sem etapas e documentos
- (V3) Tudo, inclusive etapas e documentos

Recomendação: **V2.**

Por quê: Cobre o que explica uma mudança de comportamento, com um gatilho só, que vale também para SQL escrito à mão. O que o sistema muda sozinho, como apagar uma conexão, fica marcado 'pelo sistema', sem atribuir a ninguém.

Bloqueia: C5

**DC8 — Na conversa, como se chega ao registro de um turno?** · Estado: **pendente** · Quando: Antes da C6

- (a) O selo 'IA · nome' e a faixa viram link para o turno no Registro, na mesma janela
- (a') O mesmo link, mas abrindo outra aba
- (b) Um painel lateral na conversa

Recomendação: **(a).**

Por quê: No app instalado no iPhone, uma aba nova sai do app. O painel lateral criaria um segundo lugar que desenha o turno.

Bloqueia: C6

**DC9 — O que vai no CSV exportado do Registro?** · Estado: **pendente** · Quando: Antes da C6

- (a) Só o esqueleto, mais o contato e o link (sem o texto do cliente)
- (b) Tudo, inclusive o texto retido, os valores e a saída do modelo

Recomendação: **(a).**

Por quê: A planilha fica fora do alcance do prazo (DC2) e da exclusão (DC3). O 'porquê' de cada turno se lê no Registro.

Bloqueia: C6

**DC12 — Como a faixa 'Agora' do Painel se atualiza?** · Estado: **pendente** · Quando: Antes da C9

- (a) Atualiza a cada 20 s com a aba visível, mais o botão Atualizar
- (b) Tempo real direto na tabela dos turnos
- (c) Usa o tempo real das conversas como aviso para atualizar
- (d) Só ao abrir

Recomendação: **(a).**

Por quê: Entrega o 'ao vivo' sem abrir dado de cliente ao navegador (D14 do plano dos agentes) e sem migration. Atualizar mais rápido que o cron (~15 s) não mostra nada novo.

Bloqueia: C9

### Antes das métricas de conversa (C10)

**DC13 — Quando uma pessoa conta como 'recuperada pela retomada'?** · Estado: **pendente** · Quando: Antes da C10

- (A) Uma retomada saiu e o cliente escreveu na MESMA conexão em até 72 h, antes da equipe; o crédito vai para a última retomada que saiu
- (B) Escreveu a qualquer momento depois de uma retomada
- (C) A (A) e, além disso, o card avançou ou a reunião foi marcada

Recomendação: **A como número principal, com a C ao lado. O custo por recuperado conta só o custo das retomadas, nunca o custo total do agente.**

Por quê: A A mede o efeito do follow-up com os dados que já existem, sem dar à retomada o crédito por respostas de dias depois.

Bloqueia: C10

**DC14 — O que conta como 'precisou da equipe' na taxa de atendidas sem a equipe?** · Estado: **pendente** · Quando: Antes da C10

- (a) Só a transferência feita pelo agente
- (b) A transferência OU uma mensagem de gente na mesma conexão em até 72 h depois da última resposta do agente
- (c) A (b) e, além disso, exigir avanço do card ou conversa encerrada

Recomendação: **(b), com o nome 'atendidas sem a equipe' (nunca 'resolvidas').**

Por quê: Só a (b) não conta como mérito da IA o que o advogado respondeu pelo celular, que é por onde a maior parte da equipe responde.

Bloqueia: C10

**DC15 — Como mostrar o impacto do agente no funil?** · Estado: **pendente** · Quando: Antes da C10

- (a) O que aconteceu depois do primeiro toque, contado pelo DEGRAU do funil, sem comparação
- (b) A (a) com comparação contra os cards que o agente não atendeu
- (c) A (a) com comparação entre antes e depois de ligar o agente

Recomendação: **(a) agora. A (c) depois, como opcional e com aviso.**

Por quê: É uma atribuição honesta e reusa as regras do Desempenho. Os grupos da (b) não são comparáveis.

Bloqueia: C10

### Antes da trilha "pelo agente de IA" (C7)

**DC10 — Como a ação do agente aparece na linha do tempo do lead e nos webhooks deal.*?** · Estado: **pendente** · Quando: Antes da C7

- (a) Nada muda: a anotação 'IA · agente' na conversa basta
- (b) A linha do tempo diz 'pelo agente de IA X' (details.via, como na 1083), sem origem nova; os webhooks deal.* não mudam
- (c) A (b) e, além disso, um campo novo ai_agent nos deal.*
- (d) Origem nova 'ia' e source 'ai' nos deal.* (PA-F5)

Recomendação: **(b).**

Por quê: Responde 'quem foi' sem mexer no contrato que o Make da iMotion ouve: um erro na API desliga o cenário deles. A tela já sabe exibir esse caso (describe.ts:281-282).

Bloqueia: C7

### Ordem e réguas do modo observação (C11, C14)

**DC11 — A observação (o agente decide sem enviar) pode começar na Bancário - Comercial antes do corte da Kommo?** · Estado: **pendente** · Quando: Antes da C7, porque decide a ordem da segunda metade do roteiro

- (A) Sim, com os dias de carga da Kommo marcados no gráfico
- (B) Só depois do corte, como o piloto

Recomendação: **A, se o operador aceitar mandar conversas reais ao provedor antes de haver plano de ligar. Nesse caso, a C11 e a C14 sobem para logo depois da C6.**

Por quê: Chegar ao corte com semanas de evidência sobre o agente reduz o risco do piloto. O custo: os cards criados pela carga contam como novos (D27 do plano dos agentes) e distorcem a amostra.

Bloqueia: ordem da C11 e da C14, ligar a observação

**DC17 — No modo observação, que régua o agente segue?** · Estado: **pendente** · Quando: Antes da C14

- (A) A mesma do agente ligado: D27 do plano dos agentes contada do início da observação, e a pausa quando alguém da equipe responde vale
- (B) Ignora a pausa da equipe e gera a cada mensagem do cliente
- (C) Ignora também a D27 do plano dos agentes

Recomendação: **A.**

Por quê: Prevê exatamente o que vai acontecer ao ligar, com o menor custo e o menor volume de conversa enviada ao provedor.

Bloqueia: C14

**DC18 — No modo observação, o agente lê a mídia do cliente e grava a leitura (como o botão da bolha faz)?** · Estado: **pendente** · Quando: Antes da C14

- (A) Lê e grava a leitura, como o agente ligado
- (B) Usa só o que já foi lido
- (C) Lê sem gravar (e paga de novo depois)

Recomendação: **A, dito com todas as letras na tela.**

Por quê: Sem ler a mídia, a previsão erra justamente no Bancário (extrato, print, áudio).

Bloqueia: C14

**DC19 — Ao passar de 'Em observação' para 'Ligado', o agente atende os cards que entraram durante a observação?** · Estado: **pendente** · Quando: Antes da C14

- (A) Não: só os cards que entrarem depois de LIGADO (a D27 do plano dos agentes como está)
- (B) Sim: conta desde o início da observação (muda a D27 do plano dos agentes)

Recomendação: **A.**

Por quê: Não mexe numa decisão do operador e é o comportamento natural do gatilho de ativado_em (1049:122-133).

Bloqueia: C14

**DC20 — Quem vê que um agente está observando uma conversa, e qual é o teto da observação?** · Estado: **pendente** · Quando: Antes da C14

- (A) Só o administrador, na aba do agente; na conversa, a faixa trata o agente como 'sem agente'. Teto fixo no código, por conta e por dia
- (B) Uma linha discreta na conversa para todos
- (C) A (A) e, além disso, 'o que a IA teria respondido' na faixa, só para admin
- Teto configurável por agente

Recomendação: **A (só o admin vê, teto fixo no código).**

Por quê: A equipe trabalha como sempre e a comparação fica limpa. O teto existe para segurança, e o custo estimado é de centavos por dia.

Bloqueia: C14

### Sandbox (C12, C18, fora do roteiro)

**DC16 — No teste da passagem, oferecer ao modelo também os agentes de destino que estão DESLIGADOS?** · Estado: **pendente** · Quando: Antes da C12

- (A) Sim, todos de 'pode passar para', com aviso nos desligados e uma chave 'só os ligados'
- (B) Só os ligados, fiel à produção

Recomendação: **A.**

Por quê: Com 0 agentes ligados hoje, nenhuma triagem vê o bloco de passagem no teste (route.ts:265).

Bloqueia: C12

**DC23 — Salvar roteiros de teste por agente (bateria de regressão)?** · Estado: **pendente** · Quando: Sem pressa

- (A) Sim, só o texto digitado, numa tabela fechada
- (B) Sim, permitindo importar a conversa real
- (C) Não agora

Recomendação: **A, depois da C2, C8, C11 e C12.**

Por quê: Mostra o efeito de uma edição em vários casos de uma vez, sem guardar dado de cliente.

Bloqueia: C18

**DC24 — Executar as ações de verdade num contato e card de TESTE?** · Estado: **pendente** · Quando: Sem pressa

- (A) Não: o ensaio, a observação e o e2e de engenharia bastam
- (B) Contato de teste com uma guarda geral de saída
- (C) Só as ações diretas, sem as cascatas

Recomendação: **A. Reavaliar depois do piloto.**

Por quê: Há 31 automações de entrada de etapa ligadas (15 mandam mensagem) e um webhook de saída ativo em deal.*. Um esquecimento manda mensagem ou webhook de verdade.

Bloqueia: S7 (fora do roteiro)

### Setor (C16)

**DC21 — De onde vem o 'setor' de um agente?** · Estado: **pendente** · Quando: Antes da C16

- (a) Só da conexão e do funil, sem campo novo
- (b) Um campo ligado às abas das Automações (vazio = Geral)
- (c) Texto livre

Recomendação: **(b).**

Por quê: Usa a lista que o escritório já mantém nas Automações, sem nome de setor no código.

Bloqueia: C16

### Depois do piloto (C17)

**DC22 — Pedir ao modelo um motivo curto quando ele age?** · Estado: **pendente** · Quando: Depois do piloto

- (M1) Não pedir
- (M2) Pedir só quando a resposta move, etiqueta, passa ou transfere, depois de medir
- (M3) Pedir sempre

Recomendação: **M2, ligado só depois de 50 gerações por modelo sem nenhum vazamento ao cliente e com as mesmas ações com e sem o pedido.**

Por quê: Responde 'por que transferiu' sem adivinhar, no único formato que funciona nos três provedores.

Bloqueia: C17

### Fora da central, antes de ligar o piloto

**DC25 — Depois de um 'responda e passe' (ou de uma reunião não marcada), a conversa deve voltar ao alerta de atraso da equipe?** · Estado: **pendente** · Quando: Antes de ligar o piloto

- (a) Como hoje: a resposta do agente limpa a espera e a transferência não a reacende, então o cliente que leu 'a equipe vai te retornar' fica fora do alerta
- (b) A transferência reacende a espera, com a conversa travada e só se ninguém da equipe tiver respondido depois (o desenho previsto no plano, 5.4/E7)

Recomendação: **(b), decidido antes de ligar o piloto. Até lá, o cartão 'Transferidas esperando a equipe' (C9) mostra esses casos.**

Por quê: A resposta do agente limpa aguardando_desde (1080:93-99). É um achado da frente do painel, e quem o resolve é o motor, não a central.

Bloqueia: ligar o piloto (fora das fases da central)

## Roteiro: por que cada fase vem onde vem

Detalhe no anexo: C1 = A1 (+ o motivo e a poda do PA-F0) · C2 = S1 · C3 =
A2 (+ a gravação do motivo e de `esperou_horario` do PA-F0) · C4 = PA-F1a
(+ as somas da PA-F0) · C5 = A3 · C6 = A4 · C7 =
A6 · C8 = S2 · C9 = PA-F2 · C10 = PA-F1b · C11 = S3a · C12 = S3b · C13 = S4 ·
C14 = S5a · C15 = S5b · C16 = PA-F4 · C17 = A5 · C18 = S6 · C19 = A7. Saíram
do roteiro: PA-F3 (a poda vai para a C1, numa rotina só), PA-F5 (a origem
nova "ia" na trilha muda o contrato que a iMotion ouve; a C7 resolve sem isso)
e S7 (execução real num contato de teste, DC24).

- **C1 primeiro**, e no ar antes de ligar o piloto:
  - o banco tem 0 turnos, então não há passado para converter;
  - feito depois, cada conversa apagada no piloto levaria os turnos que mais
    importam;
  - é a única fase que refaz a Lixeira (`cb_lixeira_tratamento()` e
    `cb_lixeira_purgar_um`), a partir do corpo vigente no dia.

  Antes de aplicar, provar num Postgres descartável que o SET NULL da FK
  dispara o gatilho de descarte, e que mover para a Lixeira, restaurar e
  excluir de vez continuam funcionando.
- **C2 em paralelo com a C1:** dá valor na hora, sem migration, e o operador
  está ajustando instruções agora. Só divide com a C1 os dicionários e o
  `textos.ts` dos agentes.
- **C3 logo depois da C1**, para o piloto nascer com o registro completo. A
  reunião não marcada transfere com desfecho "respondeu", sem linha
  "transferir" e sem texto no erro: o motivo tem de vir de COLUNA, senão some
  do painel. Grava também `esperou_horario = true` em `turno.ts`, no ponto
  que hoje grava a marca da espera: a marca é sobrescrita quando o turno roda,
  e o resumo da PA-F0, que a acumulava, não nasce.
- **C4** é o pedido visível e só precisa da base. Introduz o `?aba=` em
  /agents, que o Registro reaproveita. Atualiza a linha 560 do
  `docs/MERGE-UPSTREAM.md`.
- **C5 depois da C3**, porque as duas mexem em `turno.ts`. Responde a "o
  agente passou a errar desde que alguém mudou a instrução".
- **C6** precisa do turno durável, dos códigos, da versão e do `?aba=` da C4.
  Substitui os "50 últimos" e vem antes da observação, que acrescenta o
  filtro de modo nele. O filtro "motivo da transferência" e a coluna do CSV
  leem a coluna `motivo`, não o `erro` (senão a reunião não marcada some).
  Atualiza as linhas 560, 569 e 571 do `MERGE-UPSTREAM.md` (Riscos gerais).
- **C7** não depende de nenhuma fase. Fica aqui pela ordem de valor e para
  não disputar `turno.ts` e `executar-acoes.ts` com a C3 e a C5. Medir na
  produção entre aplicar e mesclar.
- **C8:** as funções puras já existem e têm teste. Explicam antes do piloto
  por que um agente ligado não responde (D27 do plano dos agentes, horário ou
  conexão).
- **C9:** pequena e visível, só com o Painel no ar. O cartão "Transferidas
  esperando a equipe" mostra o caso da DC25.
- **C10:** responde às três perguntas de decisão (quanto resolve sem gente,
  quantos a retomada recupera, o que acontece com o card), mas depende das
  réguas DC13–DC15 e só tem número com o piloto rodando.
- **C11** é refatoração no caminho de PRODUÇÃO: PR próprio, `turno.test.ts`
  verde sem mudar nenhuma expectativa e e2e real antes do merge. É
  pré-requisito do ensaio (C12) e da observação (C14).
- **C12:** mostra o valor inválido e as cascatas de automação antes de ligar,
  e prova triagem → especialista mesmo com 0 agentes ligados (DC16). O recorte
  pela conexão escolhida vem da C8.
- **C13:** cobre o caso central do Bancário (extrato, print, áudio). O teto do
  arquivo é 9 MB, pelo limite do proxy do Next 16. O "ler agora sem gravar"
  da conversa real usa a C8.
- **C14:** o único jeito de ver o agente no tráfego real antes de ligá-lo. É
  G, mexe na fila e na reserva e depende de DC17–DC20. Parte da Lixeira da C1
  e do Registro da C6: o anexo da S5a ainda descreve o estado de antes. Se a
  DC11 for "observar antes do corte da Kommo", a C11 e a C14 sobem para logo
  depois da C6, e a C9 e a C10 já nascem filtrando `modo`.
- **C15:** revisão confortável da observação. Reusa o gráfico do Painel, mas
  a soma da observação é RPC própria (migration 7): as somas do Painel contam
  só `modo = 'producao'`.
- **C16:** pequena. O Painel já recorta por conexão e funil desde a C4; o setor
  só faz diferença com vários agentes ligados.
- **C17:** depois de o piloto ter volume. Mexe em `acoes.ts`, em `pedido.ts` e
  no turno detalhado da C6. Muda o protocolo do pedido e exige
  medir: zero vazamento ao cliente e as mesmas ações com e sem o pedido do
  motivo.
- **C18 e C19:** opcionais. Valem a pena com vários agentes em ajuste, ou se
  o registro da C3 não bastar para explicar as decisões.

## Migrations, em ordem

O número é o maior do `main` + 1, escolhido NA HORA:
- `ls supabase/migrations`, `list_migrations` e as worktrees das outras
  sessões;
- replay verde do CI no commit exato;
- aplicar só com a autorização do operador;
- registrar em `docs/MIGRATIONS-APLICADAS.md`.

Todas são ADITIVAS e entram antes do deploy.

1. **C1 · turnos duráveis** (hoje seria 1110). Toda a migration da A1, mais
   `motivo` e `esperou_horario`:
   - `conversation_id` perde o NOT NULL, e a FK vira SET NULL (NOT VALID +
     VALIDATE, `lock_timeout` curto);
   - gatilho de descarte do turno vivo: o que já enviava vira `incerto`;
   - colunas `conteudo_removido_em`, `conteudo_removido_por`, `saida_bruta`,
     `erro_detalhe`, `motivo` (CHECK igual a `MOTIVOS_DE_TRANSFERENCIA`) e
     `esperou_horario`;
   - `cb_ia_turno_sem_conteudo` e `cb_ia_podar_conteudo_dos_turnos`, com
     REVOKE de PUBLIC, anon e authenticated e GRANT ao service_role na poda;
   - índices `(account_id, created_at DESC)`, que o Registro usa, e o
     parcial `(created_at) WHERE conteudo_removido_em IS NULL`, com o mesmo
     predicado da poda (um pino compara);
   - a Lixeira refeita a partir do corpo vigente, com
     `cb_lixeira_conferir_gatilhos()`.
2. **C4 · somas do painel:** `cb_ia_painel_por_dia` e
   `cb_ia_painel_do_periodo`, SECURITY INVOKER STABLE, ordem total, REVOKE/GRANT.
3. **C5 · versões do agente:** a coluna `versao` (OBRIGATÓRIA antes do
   deploy: a leitura do agente passa a pedi-la), a tabela fechada
   `cb_ia_agente_versoes`, gatilhos com `pg_trigger_depth()`, a carga v1 e
   `cb_ia_turnos.ia_agente_versao`. A função de versão tem uma lista fechada
   de colunas, e um pino reprova coluna nova de `cb_ia_agentes` fora dela.
4. **C7 · trilha "pelo agente de IA":** `cb_log_deal_event` e
   `cb_log_contact_tag_event` com o ramo da via `agente`. O CHECK de origem não
   muda.
5. **C10 · somas das conversas:** "sem a equipe" e "recuperados", sem ler
   `content_text`.
6. **C14 · modo observação:**
   - `sombra` e `sombra_desde` no agente;
   - `modo`, `desfecho_previsto` e o status `observado` no turno;
   - o mode `agente_sombra` no `ai_usage_log`, ANTES do código;
   - a fila e a reserva recriadas;
   - as somas da C4 e da C10 recriadas com `modo = 'producao'`;
   - a poda ganha o ramo da observação na mesma rotina: APAGA o turno de
     observação terminado depois de 30 dias (DC2), em lotes, com o índice
     parcial `(created_at) WHERE modo = 'sombra'`;
   - a função de versão da C5 recriada com `sombra`, que gera versão (DC7
     V2). `sombra_desde` fica fora da lista, com o motivo escrito no pino.
7. **C15 · resumo da observação.**
8. **C16 · setor do agente** (`area_id`, FK composta para as abas das
   Automações). Recria a função de versão da C5 com `area_id`, que gera
   versão.
9. (Opcional) **C18 · roteiros salvos.**

## Conflitos entre as frentes, já resolvidos

- **Durabilidade:** três desenhos viraram um, o da auditoria (C1). O painel
  soma direto em `cb_ia_turnos`, e a tabela de resumo não nasce.
- **Lixeira:** só a C1 a refaz. Outra branch que a refaça em paralelo apaga
  entradas sem aviso.
- **Poda:** uma rotina só, dentro de `rodarManutencaoDoCiclo` (laço lento que
  já existe), com prazo por modo (DC2). Sem rota nova nem `docker stack
  deploy`.
  - Índice e predicado: os da A1 (`created_at`, `conteudo_removido_em IS
    NULL`). Na produção, a poda só LIMPA o conteúdo.
  - O ramo da observação (C14) APAGA o turno, com índice próprio.
  - Não valem: a poda por `terminado_em` da PA-F0/PA-F3 e a poda em
    `rede.ts` da S5a.
- **Origem IA na trilha:** a C7 (`details.via = 'agente'`) no lugar da origem
  nova "ia", que mudaria o contrato dos `deal.*`.
- **Saída do modelo:** uma coluna só (`saida_bruta`). A observação deriva o
  texto ao cliente na hora de ler.
- **Motivo × erro:** as duas colunas. `motivo` cobre os "respondeu" que
  transferem; `erro` vira código, com o texto livre em `erro_detalhe`. O
  Registro (C6) filtra e exporta por `motivo`, não pelo `erro` como diz o
  anexo da A4.
- **Navegação:** um parâmetro só, `?aba=`, nos dois níveis de /agents.
- **Somas × observação:** a migration da C14 recria as somas da C4 e da C10
  com `modo = 'producao'`, e um pino cobra o filtro de modo. Com DC11 = A
  (observar antes), a C9 e a C10 já nascem filtrando `modo`.
- **Versões × colunas novas do agente:** a C14 (`sombra`) e a C16
  (`area_id`) recriam a função de versão da C5. Coluna fora da lista reprova
  o pino.
- **A observação parte do estado novo:** a C14 parte da Lixeira da C1, em que
  o turno já não é "nao_volta", e do Registro da C6, em que a rota antiga dos
  turnos já não existe. O anexo da S5a descreve o estado de antes.
- **Regras cheias:** `ia.md` está a 9 bytes do teto. Duas regras novas,
  `.claude/rules/ia-central.md` (retenção, Registro, Painel, versões, trilha)
  e `.claude/rules/ia-sandbox.md` (Playground ampliado, diagnóstico,
  observação), com uma linha cada no índice do CLAUDE.md.
- **`turno.ts` e `executar-acoes.ts`:** tocados por C3, C5, C7, C11, C14 e C19
  em PRs **em série**, nunca em paralelo. `acoes.ts` é tocado por C3 e C17,
  também em série.
- **Limite aceito:** ninguém guarda o RESULTADO de um teste do Playground. Os
  roteiros (C18) guardam só a entrada.

## Riscos gerais

- **A Lixeira é crítica:**
  - provar a premissa da C1 no Postgres descartável antes de aplicar;
  - recriar a FK trava `conversations`, que é tabela quente.
- **Sem sandbox de banco:** o `.env.local` aponta para a produção.
  - Todo e2e grava dado real: só com o lead de teste e o "pode gravar".
  - Card de teste dispara `deal.*` para o webhook que a iMotion ouve.
  - O agendador da produção rouba turno vencido do preview: usar o vigia
    local.
- **Zeros antes do piloto:** todo bloco distingue carregando, falhou e zero de
  verdade; taxa sem denominador aparece como "—".
- **Teto de 60 conexões do banco:**
  - somas feitas no banco;
  - consultas do painel em série;
  - "Agora" a cada 20 s, só com a aba visível.
- **LGPD, a confirmar com quem responde por ela no escritório:**
  - o esqueleto mantém o vínculo com o card, cujo título é o nome da pessoa;
  - o CSV leva só o esqueleto;
  - a observação manda conversas reais ao provedor.
- **Volume:**
  - o texto guardado pode chegar a ~1–3 MB/dia se a IA atender tudo;
  - conferir a cota de disco do Supabase antes de fixar o prazo (o banco tem
    225 MB);
  - observação, comparação e bateria são chamadas pagas, contadas à parte.
- **Correlação não é causa:** "o que aconteceu depois do agente" nunca vira
  "convertido pelo agente" nem "tempo poupado" na tela.
- **Arquivos do upstream que já são nossos inteiros num merge:** atualizar,
  no mesmo PR, as linhas que JÁ existem no `MERGE-UPSTREAM.md`, sem linha
  nova:
  - 560 (`agents/page.tsx`): C4 e C6;
  - 569 (`ai-thread-banner.tsx`): C6 e C14;
  - 571 (o selo em `message-bubble.tsx`): C6.

## Diário

- **26/10/2026:**
  - Plano escrito por workflow: o mapeamento, depois 3 projetistas, depois 3
    verificadores adversariais (81 correções) e por fim 1 integrador.
  - Revisão independente da coerência interna: 14 correções no texto
    (dependências da tabela, a migration da C1 completa, poda, versões ×
    colunas novas, filtro de motivo e linhas do `MERGE-UPSTREAM.md`).
  - Maquete do Painel com dados fictícios para a decisão visual.
  - Branch `docs/plano-central-dos-agentes`, sem PR.
  - Próximo passo: o operador responde DC1–DC4. Com as respostas, a C1 e a C2
    começam em paralelo, a partir do `main`.
