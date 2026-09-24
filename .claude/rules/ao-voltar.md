---
paths:
  - "src/lib/celular/ao-voltar*"
  - "src/hooks/use-ao-voltar-para-o-app*"
  - "src/app/*/contacts/page.tsx"
  - "src/app/*/pipelines/**"
  - "src/app/*/tarefas/**"
  - "src/app/*/meu-dia/**"
  - "src/components/funil/desempenho.tsx"
  - "src/components/funil/saude.tsx"
  - "src/components/funil/lista-de-leads.tsx"
  - "src/hooks/use-tarefas*"
  - "src/hooks/use-channels*"
  - "src/hooks/use-gastos-de-anuncios*"
  - "src/hooks/use-trajetorias*"
---

# Voltar para o app — regras

Vale para `useAoVoltarParaOApp` (`src/hooks/use-ao-voltar-para-o-app.ts`, regra
pura em `src/lib/celular/ao-voltar.ts`) e para as telas que o chamam: Tarefas,
Meu dia, Funil (quadro, Lista, Desempenho, Saúde) e Contatos, mais os hooks que
elas recarregam. O resto do celular (teclado, histórico, app instalado) está em
`.claude/rules/celular.md`; a concorrência do quadro do funil (`refreshDeals`,
leituras e arrastos, `DealForm`, `PipelineSettings`), em
`.claude/rules/funil.md`. Pino: `src/lib/celular/ao-voltar.test.ts` — tela nova
com o hook entra nele. O texto antigo, com a história, está em
`git show f5879b3f:CLAUDE.md`.

### Telas que se atualizam ao VOLTAR para o app

O app instalado no celular não tem botão de recarregar nem "puxar para
atualizar": sem isto, quem voltava do WhatsApp uma hora depois via a lista de
uma hora atrás, sem aviso. A caixa de entrada tem o seu próprio mecanismo
(`visibilitychange` → `resyncToken`).

- ⚠️⚠️ **O recarregar passado ao hook é SILENCIOSO**, mantendo a tela até a
  resposta chegar. Tarefas: `recarregarEmSilencio` (mantém a lista e as
  páginas abertas; uma falha não troca a lista pelo aviso de erro). Contatos:
  `fetchContacts({ silencioso: true, preservarSelecao: true })`. Funil: uma
  recarga PRÓPRIA — ⚠️ NUNCA a carga inicial, que liga o `loading`, desmonta o
  quadro e perde a rolagem e o retorno do inbox.
- **Só recarrega depois de 30 s fora** (`AUSENCIA_QUE_RECARREGA_MS`): olhada
  rápida noutro app não queima consulta. Relógio andando para trás não
  recarrega.
- **A função mais recente é lida por REF**: passar uma arrow nova a cada
  render não re-assina o evento.
- **O Meu dia é a exceção deliberada**: chama o mesmo `atualizarTudo` do botão,
  e os blocos piscam "carregando". A tela AFIRMA ("tudo em ordem",
  "0 vencidas"), e afirmar sobre número velho é pior que piscar.

#### Contatos

- ⚠️⚠️ **A recarga PODA a seleção** às linhas que continuam na página
  (`podarSelecao`): a ação em massa age sobre `selected` inteiro, e um id que
  saiu da tela seguiria marcado — e seria apagado sem ninguém o ver marcado.
- ⚠️ **Recarrega também o catálogo de etiquetas** (`fetchTags`): senão a
  etiqueta nova some da linha, a renomeada fica com o nome velho e a apagada
  segue filtrando. ⚠️⚠️ E troca o mapa SÓ quando o conteúdo mudou
  (`igual ? prev : map`): `fetchContacts` depende de `tagsMap`, e um mapa novo
  com o mesmo conteúdo refaria a lista com spinner e seleção zerada a cada
  volta. ⚠️⚠️ Quando o catálogo MUDOU de fato, o efeito da lista percebe que
  só ele mudou (`chaveDaListaRef`: mesma página, busca e filtro) e refaz em
  silêncio, com a seleção.

#### Funil (quadro)

- ⚠️⚠️ **A volta recarrega o QUADRO, o CATÁLOGO DE FUNIS e as AUTOMAÇÕES, e
  só GRAVA com o mesmo funil aberto** (`funilAbertoRef`) **e sem mudança no
  meio do caminho** (`versaoDoQuadroRef`, que o arrasto — inclusive a gravação
  confirmada —, `refreshDeals`, `refreshStages`, `refreshPipelines`,
  `refreshAutomations` e a troca de funil avançam). Sem as duas cercas,
  trocar de funil com a recarga no ar deixava o quadro de B com os dados de A
  (A → B → A passava pela cerca do funil), e a recarga que saiu antes de um
  arrasto devolvia o card à etapa antiga. Quem criar outro caminho que mexa
  nesses estados avança a versão também.
- ⚠️ **Tudo o que a volta lê tem variante que devolve `null` na FALHA**
  (`buscarEtapas`, `buscarNegocios`, `buscarFunis`, `buscarAutomacoes` e o
  `falhou` de `loadPassosENomes`): voltar antes de a rede do celular voltar
  esvaziava o quadro, apagava a lista de funis e a seleção, ou trocava os
  nomes dos cartões por "(apagado)". Os `load*` continuam devolvendo vazio
  para quem já os chamava.
- **Funil apagado lá fora sai da seleção**, e a troca carrega o primeiro que
  sobrou.
- ⚠️ **As gravações acontecem JUNTAS, depois de UMA conferência**: gravando a
  troca de funil antes, ela mesma avançaria a versão e descartaria as
  automações.
- A recarga da volta NÃO passa pelo `refreshDeals` nem mantém arrasto no ar —
  é por isso que a gravação confirmada de um arrasto avança a versão.

#### Funil (Lista, Desempenho, Saúde)

- ⚠️ **As três visões têm dados PRÓPRIOS** (`useTrajetorias`), que a recarga
  do quadro não alcança. Cada uma passa ao hook o `recarregar` do
  `useTrajetorias`, que PISCA o carregando de propósito: Desempenho e Saúde
  afirmam números, e na Lista a tabela sem linhas durante a carga impede mudar
  a etapa de um negócio com a recarga no ar.
- ⚠️⚠️ **E o que não é trajetória vai JUNTO.** Desempenho: o gasto dos
  anúncios (`useGastosDeAnuncios.recarregar`, com a versão DENTRO da chave) —
  só as trajetórias misturava leads novos com gasto velho, e custo por lead e
  CAC saíam errados. Lista: o catálogo de campos, blocos e perfis
  (`versaoDoCatalogo`) e as conexões, EM SILÊNCIO, por serem rótulos — a
  recarga do catálogo que falha mantém o que está na tela (vazio tiraria as
  colunas de campo), e as conexões usam o `recarregarEmSilencio` do
  `useChannels`, que descarta a falha. O `recarregar` comum trocaria a lista
  boa pelo vazio e apagaria a coluna Conexão até a volta seguinte.
