---
paths:
  - "src/lib/funil/**"
  - "src/components/funil/**"
  - "src/lib/meta-ads/**"
  - "src/app/api/cb/meta-ads/**"
  - "src/components/settings/meta-ads-card.tsx"
  - "src/hooks/use-trajetorias*"
  - "src/hooks/use-modo-de-contagem*"
  - "src/hooks/use-gastos-de-anuncios*"
  - "src/components/pipelines/pipeline-settings.tsx"
  - "src/components/pipelines/pipeline-analytics.tsx"
  - "src/lib/csv*"
  - "src/components/tremor/**"
---

# Funil comercial e métricas — regras

Vale ao mexer no funil de eficiência (degraus por etapa, trajetórias, as vistas
Lista, Desempenho e Saúde), no Meta Ads, nos gráficos (Tremor e recharts) e na
exportação CSV. O quadro Kanban, ganho/perdido e o negócio estão em
`.claude/rules/funil.md`; a recarga ao voltar para o app, em
`.claude/rules/ao-voltar.md`. Plano e história: `docs/PLANO-funil-comercial.md`;
o texto antigo está em `git show f5879b3f:CLAUDE.md`.

### Funil comercial (975): funil de eficiência FIXO, cada funil mapeia as etapas

`pipeline_stages.degrau` ∈ {lead, mql, reuniao, proposta, contrato, perda,
NULL}. `src/lib/funil/` é puro e testado; `carregar.ts` é o único com I/O (o
laço paginado da RPC `cb_funil_trajetorias`). O seletor por etapa mora em
`pipeline-settings.tsx`.

- ⚠️⚠️ **NEGÓCIO TRANSFERIDO PARA OUTRO FUNIL CONTINUA CONTANDO NO FUNIL DE
  ORIGEM, com a última etapa que teve lá** (decisão do operador, 03/09/2026: "fechou
  → transfere para o Jurídico → continua ganho"). A RPC devolve o negócio pelo
  evento com `to_pipeline_id` = o funil, e `fatosDoNegocio` resolve a etapa de
  lá (`noFunil = false`, `transferidoPara`). "Simplificar" para
  `deals.pipeline_id`/`stage_id` atuais apaga todo contrato transferido da
  estatística comercial, sem erro nenhum.
- ⚠️ **`degrau` é INDEPENDENTE de `resultado` (950).** `resultado` carimba o
  status do negócio; `degrau` diz o que a etapa significa no funil. A tela
  SUGERE (ganho → contrato, perdido → perda) só em etapa sem degrau; o cálculo
  nunca deriva um do outro ("No Show" pode ser perda sem ser perdido). SEM
  backfill: quem mapeia é o operador. Decisão dele: "Contato Avulso" e as
  etapas de entrada contam como `lead`.
- ⚠️ **A RPC é SUPERCONJUNTO** (criado OU com evento no intervalo): a coorte de
  verdade é `coorteDoPeriodo` (entrada = primeira etapa COM classe, perda
  inclusive). Somar linhas cruas conta negócio de janeiro movido em abril como
  coorte de abril.
- ⚠️ **Alcance é MONOTÔNICO** (`degrauMaximo`): pular de Lead para Proposta
  alcança MQL e Reunião. Perda não alcança nada; entrar direto em perda É
  entrada.
- ⚠️ **Paginar a RPC** (`order('deal_id')` + `range` + `count: 'exact'`);
  `null` = "não confie", nunca lista parcial. ⚠️ Mas o `created_at` da RPC é
  NULÁVEL (`deals.created_at` também é), e `lerLinha` aceita: exigi-lo fazia
  UMA linha derrubar a carga inteira, e as três vistas ficavam em "falhou"
  para sempre. "Não confie" vale para desvio de FORMA, não para timestamp
  opcional.
- **Período em fuso LOCAL, `[desde, ate)`; o anterior é a mesma duração
  imediatamente antes, deslocada por DIAS DE CALENDÁRIO**, nunca por
  milissegundos (num fuso com horário de verão a hora de fronteira some).
- ⚠️ **A situação PARTICIONA a coorte em CINCO baldes** — fechado, perdido,
  sem avanço, em andamento e fora do funil (entrou por etapa mapeada e hoje
  está em etapa SEM degrau). Sem o quinto os totais não fecham com as
  entradas. Soma-se por `situacao`, NUNCA por `resumo.fechados`, que conta
  duas vezes quem voltou para Proposta (`coorte.test.ts` recalcula a partir de
  `situacao`). O cartão "fora do funil" só aparece com alguém nele.
- ⚠️⚠️ **`resumo.fechados` NÃO é dinheiro.** `fechados` = "ALCANÇOU contrato"
  (monotônico; é o degrau do funil e as taxas); `fechadosAgora` =
  `situacao === 'fechado'` (valor fechado, ticket médio, CAC). Um distrato
  está nos primeiros e não nos segundos: contado como receita, aparecia como
  ganho E como perda e inflava o divisor do CAC.
- ⚠️ **Apagar etapa MAPEADA com histórico é barrado na tela de Funis.** O
  mapeamento é lido sobre a história inteira (remapear reescreve o passado, de
  propósito), e etapa apagada tira da coorte quem só passou por ela — "zero
  negócios na etapa" não protege. Saída: "Não conta", salvar, remover.
- Os rótulos dos degraus são chave MONTADA (`Pipelines.funil.degraus.<c>`);
  `degraus.test.ts` cobra os dois dicionários.
- Funis "TESTE" não são desta conta. Teste de tela com escrita: funil de teste
  criado na hora e apagado, ou mexer no real e REVERTER.

### Dois modos de contagem (por período é o padrão)

Decisão do operador (18/09/2026): "10 reuniões no mês passado e 5 contratos
este mês — este mês mostra os 5". `src/lib/funil/por-periodo.ts` (pinos em
`por-periodo.test.ts`), `use-modo-de-contagem.ts` (`localStorage`
`wacrm:pipelines:funil:modo`, parse por `lerModo`) e `seletor-de-modo.tsx`. A
coorte ("por mês de entrada") fica sob demanda.

- **Por período conta a PRIMEIRA vez que o negócio alcançou o degrau**
  (`FatosDoNegocio.alcancouEm`); o degrau pulado ganha a data de quem o
  alcançou. Exige a trajetória INTEIRA (a RPC já a devolve): truncar ao período
  conta a reentrada de novo.
- ⚠️ **Perda é datada por `perdidoDesde`** (o começo da estadia atual em
  perda), NUNCA por `naEtapaDesde`, que é a última entrada na etapa e movia a
  perda de mês quando o escritório reclassificava No Show → Perdido. Quem
  voltou da perda não é perda em mês nenhum. Dinheiro = contrato alcançado no
  período que continua fechado. Sem avanço, em andamento e fora do funil são a
  foto dos que ENTRARAM no período — iguais nos dois modos.
- ⚠️⚠️ **A taxa por período é razão de FLUXO e PODE PASSAR DE 100%** (5
  contratos de reuniões de agosto ÷ 2 reuniões de setembro). Decisão do
  operador: mostrar como é, com a nota na tela — nunca `Math.min(1, …)`. Os
  gráficos de taxa usam `eixoDasTaxas` (teto redondo e marcas rotuladas; o
  recharts alarga o domínio sem marca, e o Tremor inventava as marcas).
- ⚠️⚠️ **"Custo dos perdidos" multiplica os ENTRANTES do período já perdidos
  (`perdidosDosEntrantes`), nunca `perdidos`**: por período `perdidos` é fluxo
  de qualquer mês e, vezes o custo por lead deste período, passava do próprio
  investimento. Na coorte os dois números coincidem.
- `funilDeContagens` e `emAbertoDe` (`coorte.ts`) são a montagem ÚNICA das
  taxas e dos baldes nos dois modos: uma cópia divergiria conforme o seletor.
  `coortesMensais` exige o `modo` (obrigatório de propósito); `emAberto` só
  existe na coorte.
- A origem do evento NÃO é filtrada: evento `retroativo` (a carga da Kommo)
  conta na data que carregar — é o contrato escrito no plano.

### As vistas: Lista, Desempenho e Saúde

- ⚠️ **São de admin** (`canViewReports`; a barra de abas some quando sobra uma)
  e a aba vigente é resolvida no RENDER (`vistaVigente`), porque a lente "Ver
  como" troca o papel com a tela montada. É recorte de TELA, não barreira
  (`deals` e `cb_lead_events` são legíveis por membro) — ver
  `.claude/rules/funil.md`.
- ⚠️⚠️ **`etapasCarregadas` é prop OBRIGATÓRIA das vistas.** Durante a carga
  `stages` é `[]` — o mesmo `[]` de um funil sem etapa, que renderizava ZEROS
  com cara de funil configurado —, e a página não limpa `stages` ao trocar de
  funil. Quem sabe de quem são as etapas é a página (`etapasDe`); a prop existe
  para o compilador cobrar de quem montar a vista em tela nova.
- ⚠️⚠️ **A Lista leva `key={funil.id}` na página.** Sem ela o React reusa a
  instância, o filtro de etapa do funil anterior sobrevive e a tela diz "0 de
  37" sobre um funil cheio, com o seletor de etapa em branco.
- **Lista** (`lista-de-leads.tsx`, `src/lib/funil/lista.ts`): só quem está
  NESTE funil hoje, período pela CRIAÇÃO do negócio (o transferido é do
  painel). A etapa na linha escreve pelo padrão do quadro (`update` + rowcount
  + `statusAoEntrarNaEtapa` + `avisarDrenagemDeFunil`), otimista por
  `aplicarMudancaDeEtapa`; editar busca o negócio por id
  (`handleEditDealPorId`). Colunas por aparelho em `localStorage`
  (`wacrm:pipelines:lista:colunas`; `normalizarColunas` é a migração).
- `useTrajetorias`: `carregando` é DERIVADO da chave do pedido (nunca
  `setState` síncrono no efeito — o React Compiler recusa); resposta atrasada é
  descartada pela chave.
- ⚠️ **Exportar CSV espera os CATÁLOGOS** (canais e perfis chegam depois das
  trajetórias), senão Conexão e Responsável saem vazios na planilha. O botão
  fica desabilitado até os dois chegarem.
- **Desempenho**: carrega a RPC UMA vez para `[desde do período anterior,
  hoje)` e recorta os dois resumos no modo escolhido (`resumoNoModo` × 2 +
  `comparar`). Funil sem etapa em `lead` → estado "configure"; período sem
  coorte → zeros com a nota, NUNCA o "configure". ⚠️ **Taxa NULA nunca vira 0**
  (`grafico-de-taxas.tsx`): `?? 0` fazia o tooltip afirmar "0,0%", conversão
  medida que não houve; o nulo viaja como nulo e o formatador escreve "—". ⚠️
  O gráfico de entradas por dia soma o mesmo que o card "Leads" (os dias da
  coorte que a grade densa não cobre entram na lista).
- **Saúde** (`saude.tsx`, `mapa-de-calor.tsx`, `grafico-de-conversao.tsx`):
  doze meses numa carga — por período no padrão, coortes mensais no modo por
  entrada. A cor do mapa é RELATIVA À LINHA e a escala é calculada SEM as
  células pequenas (`< COORTE_PEQUENA`): 100% sobre um lead dominaria o ano.
  Célula pequena sai apagada com o motivo no `title`; mês sem dado é "—",
  nunca 0%. ⚠️ A régua da célula é por MODO (`linhasDoMapa(…, modo)`): na
  coorte, as entradas do mês; por período, o DENOMINADOR da taxa.
- ⚠️ **"Em andamento" no mapa é a coorte com lead SEM DESFECHO, não o mês
  corrente**: a marca é a contagem visível ("6 em aberto", de
  `CoorteMensal.emAberto`), só no modo por entrada — por período o mês passado
  é final.
- ⚠️⚠️ **As cores das linhas da Saúde são TRÊS classes literais por degrau**
  (`traco`/`ponto`/`bloco`), nunca uma derivada com
  `replace("stroke-", "fill-")`: classe montada não é gerada, e o ponto caía no
  preto padrão do SVG, sem erro.
- Gráficos: barras = Tremor vendorizado (`src/components/tremor/`); área =
  recharts DIRETO (`grafico-de-entradas.tsx`, cor por classe com
  `stroke=""`/`fill=""`, o truque do Tremor) — não vendorizar outro Tremor.
  Números em pt-BR fixo (`apresentacao.ts`), como `currency.ts`.
- A recarga ao voltar para o app (`useTrajetorias` que PISCA, gasto dos
  anúncios junto, catálogo da Lista em silêncio) está em
  `.claude/rules/ao-voltar.md`.

### CSV

- ⚠️ **Aspas NÃO protegem contra fórmula.** O Excel tira a citação e AVALIA o
  que começa com `=`, `+`, `-`, `@`, tabulação ou CR — e nome vem do push name
  do WhatsApp, campo do n8n (`=HYPERLINK(…&A1,…)` levaria a célula vizinha).
  `neutralizarFormula` (`src/lib/csv.ts`) põe apóstrofo na frente, menos em
  número. Todo exportador novo repete a passagem.

### Meta Ads (976): o CRM só LÊ, e o token é o único segredo

`src/lib/meta-ads/` (`janela-de-sync.ts`, `atribuicao.ts`, `cartao.ts` puros;
`cliente.ts` com I/O; `sincronizar.ts` no servidor), rotas em
`/api/cb/meta-ads/`, cartão em Configurações → Integrações, e os cards de
investimento/CAC no Desempenho.

- ⚠️⚠️ **`cb_meta_ads_config` NÃO tem SELECT para `authenticated`**: nem a
  linha nem o token cifrado passam pelo PostgREST. A tela lê pela rota
  `GET /api/cb/meta-ads` (admin, service role), e **o token não sai de rota
  nenhuma, nem mascarado**. Campanhas e gastos têm SELECT — é deles que o
  Desempenho monta o investimento sob RLS.
- ⚠️⚠️ **A mensagem da Meta ECOA O TOKEN, e ela vai para o LOG.** Devolver só o
  código ao navegador não basta. Código novo precisa das duas funções de
  `cliente.ts`: **`semSegredo(texto, token)`**, por onde passa TODO
  `MetaAdsError.message` (troca o token por `«token»` e limpa `access_token=`
  de URL; há teste com a frase real), e **`doGraph(url)`**, que recusa URL fora
  de `https://graph.facebook.com` — o token vai no cabeçalho e o `paging.next`
  vem da RESPOSTA. Para o navegador, seis códigos: `token_invalido`,
  `sem_permissao`, `conta_nao_encontrada`, `limite`, `rede`, `meta_error`.
- ⚠️ Token no cabeçalho `Authorization: Bearer`, nunca em `?access_token=`
  (vaza em log de proxy).
- ⚠️ **A janela de sincronização é de 3 DIAS** (a Meta reprocessa o gasto por
  até 48 h; primeira sincronização: 90 dias), com upsert por
  `(conta, campanha, dia)`. ⚠️⚠️ **E a janela é RECONCILIADA**: dia que zerou
  some da resposta em vez de vir 0, e o valor antigo ficaria gravado para
  sempre, inflando investimento, custo por lead e CAC. O que estava lá e não
  voltou é apagado, agrupado por dia. Há teste.
- ⚠️ **Bater no teto de páginas ESTOURA, nunca devolve meia lista**: gravaria
  `last_sync_at` sobre import incompleto, e os dias perdidos não voltariam. A
  conta fica em `status = 'erro'`.
- ⚠️⚠️ **Consulta de gasto que falhou ou não coube NÃO vira número**
  (`useGastosDeAnuncios` devolve `falhou`): a soma parcial faz custo por lead e
  CAC mentirem PARA BAIXO, e o corte cai justamente no gasto mais NOVO. As
  campanhas também paginam; campanha que não veio tem o gasto descartado por
  `gastoDoPeriodo`.
- ⚠️ **O chip do cartão diz "Conferindo…" enquanto não sabe**, e vermelho na
  falha: "Não conectada" sobre integração de pé faz o operador recadastrar
  conta e token para consertar o que não quebrou.
- ⚠️ **Campanha SEM funil vira aviso** com link para Integrações, nunca some
  do total: silenciada, o custo por lead sai menor do que é.
- ⚠️ **Rodízio do cron**: ordena as contas por `last_sync_attempt_at` (988,
  nunca tentada primeiro), e `sincronizarMetaAds` carimba a coluna ANTES de
  qualquer trabalho, dê certo ou errado. Por `account_id`, a mesma cauda
  ficava fora do orçamento em todo ciclo; carimbando só no sucesso, a conta
  que falha ficaria na frente para sempre.
- ⚠️ O cron está no laço LENTO do `docker-stack.yml`, e o CI não relê o
  `command` do agendador: só vale depois de `docker stack deploy` manual com o
  `crm.env` carregado (raiz, seção 10). Sem isso os cards seguem "conecte o
  Meta Ads", sem erro.
- ⚠️ **No Desempenho, "conectado" é DERIVADO de haver campanha**, porque o
  membro não enxerga a config: entre conectar e a primeira sincronização a
  linha ainda diz "conecte o Meta Ads". Fechar a fresta pede um sinal LIDO pelo
  membro, não um SELECT em `cb_meta_ads_config`.
- **Desconectar apaga só a config**: campanhas e gastos ficam, senão o
  histórico do Desempenho sumiria junto com o token.
