# Plano — desempenho da aba Funis e barra horizontal sempre à vista

Pedido do operador (03/10/2026): "toda vez que entro na aba de funis o
computador dá uma travada", a fluidez das movimentações cai, e a barra de
rolagem horizontal do quadro só aparece rolando a página até o fim — com
mouse, sem o gesto de lado do notebook, não dá para andar entre as colunas.
Decisões do operador: **opção A** (cada coluna rola sozinha, o quadro tem a
altura da tela) e **fases 1 e 2**. A fase 3 fica para depois de medir de novo.

## Estado

| Fase | O quê | Estado |
| ---- | ----- | ------ |
| 0 | Estudo e medição na produção | ✅ concluída (03/10) |
| 1 | Quadro: colunas com rolagem própria, barra fixa, lote de 20 com carga ao rolar | ✅ no `main` (#381, 03/10; Codex limpo) |
| 2 | Lista, Desempenho e Saúde: RPC das trajetórias paginada por chave | ✅ 1078 aplicada e medida na tela (03/10); #382 |
| 3 | (opcional) Não buscar o quadro fora da vista Quadro; lista enxuta numa viagem | ⏸ decidir depois da medição das fases 1–2 |

## Fase 0 — o que a medição mostrou (03/10/2026)

Medido na produção pelo navegador interno, só leitura, num Mac rápido (num
notebook comum, multiplicar). Funil Trabalhista - Comercial: 3.802 negócios,
13 colunas.

- **Quadro.** Os dados chegavam em ~1,2 s (4 páginas da lista enxuta em
  fila, ~155 ms cada, e 6 pedidos de conteúdo em paralelo, ~360 ms). O peso
  estava no DESENHO: 580 cards de uma vez (teto de 100 por coluna), página de
  20.500 px de altura e 13 mil elementos; montar prendia o navegador por
  0,3–0,5 s e o layout inicial custava ~210 ms. Bancário - Comercial: 493
  cards, 16.400 px.
- **Arrasto.** O React Compiler NÃO está ligado (só as regras dele no lint):
  colunas e invólucros de card redesenhavam inteiros a cada pegar/soltar, e
  cada mudança recalculava o layout da página gigante.
- **Barra horizontal.** Fica no pé do `.pipeline-scroll`, cuja altura era a
  da coluna mais comprida; a rolagem vertical era do `<main>`.
- **Lista, Desempenho, Saúde.** Não travam, esperam: a RPC
  `cb_funil_trajetorias` é paginada por OFFSET e CADA página recalcula o funil
  inteiro (~550 ms; a função SQL tem `SET search_path`, que impede o
  Postgres de embuti-la). Lista "este mês": 3 páginas, ~1,75 s. Desempenho:
  3, ~1,6 s. Saúde (12 meses): 4, ~2,35 s.
- `content-visibility: auto` injetado nos cards baixou a remontagem de ~470
  para ~290 ms — menos que desenhar menos cards; não entrou.

## Fase 1 — Quadro

**Objetivo:** de `lg` para cima, o quadro tem a altura da tela, cada coluna
rola sozinha (cabeçalho e "Adicionar negócio" parados) e a barra horizontal
fica no rodapé; cada coluna desenha 20 cards e pede o lote seguinte sozinha
ao rolar perto do fim. Abaixo de `lg` (celular, tablet em pé) o desenho não
muda — só o lote menor com carga ao rolar.

**Arquivos:** `src/components/pipelines/pipeline-board.tsx`,
`src/app/(dashboard)/pipelines/page.tsx`, `src/lib/pipelines/retorno.ts` (a
volta do inbox lembra a rolagem de cada coluna), testes ao lado.

**Pronto quando** (no preview, 1440×900, com o Trabalhista):
- a barra horizontal aparece sem rolar a página, e o cabeçalho das colunas
  fica parado ao rolar uma coluna;
- a coluna "Perdido" carrega mais cards sozinha ao rolar;
- abrir uma conversa pelo card do meio de uma coluna rolada e voltar cai na
  mesma coluna, na mesma altura;
- arrastar um card entre colunas continua funcionando (sem gravar: o
  arrasto se testa com o lead de teste ou desfazendo);
- medida: cards montados na abertura e tempo de montagem, contra os 580 /
  0,3–0,5 s da fase 0.

**Resultado (03/10/2026).**
- Dados reais (app local, mesmo banco): Trabalhista abre com 196 cards e
  ~5 mil elementos (eram 580 e 13 mil), e a página deixou de rolar; Bancário,
  156 cards (eram 493).
- Bancada (página temporária fora do commit: o quadro de `origin/main` e o
  novo lado a lado, 3.802 cards fictícios na distribuição do Trabalhista,
  build de produção, Chromium visível do Playwright, 3 rodadas):
  - abrir o quadro: tempo travado de 230–420 ms → 28–67 ms; maior quadro
    congelado de 270–460 ms → 78–118 ms;
  - arrastar entre colunas: o antigo tinha 1–2 quadros lentos por arrasto
    (57–83 ms); o novo, quase sempre nenhum.
- Provado no Chromium visível: a coluna de 2.135 cards cresce 20 por vez ao
  rolar e para; as outras não carregam sozinhas; card antigo solto numa
  coluna cheia aparece no topo e a contagem anda; a volta do inbox restaura
  a rolagem da coluna (1200 px) e a horizontal. Abaixo de `lg` (390 px) a
  página rola como antes e só a coluna na tela carrega mais.
- No navegador interno do app (aba oculta) o `IntersectionObserver` não
  dispara: lá o botão "Carregar mais" é a reserva.
- Limite: numa tela de notebook baixa (viewport de 768 px) a lista da coluna
  fica com ~290 px (uns dois cards). Se incomodar, compactar a faixa dos
  indicadores é a saída.

## Fase 2 — Lista, Desempenho e Saúde

**Objetivo:** cada página da RPC calcula só os seus negócios. Função NOVA
(migration aditiva) com o recorte por chave (`deal_id` maior que o último da
página anterior, `LIMIT` dentro da função); o laço de `carregar.ts` passa a
pedir por chave. A função antiga fica até nenhuma versão no ar a usar.

**Pronto quando:** as três vistas mostram os MESMOS números de antes (mesmo
funil, mesmo período) e o tempo de carga cai — estimativa: Saúde ~0,7 s,
Lista/Desempenho ~0,6 s.

**Como ficou (03/10/2026).** `cb_funil_trajetorias_por_chave` (1078): o
recorte de `deal_id` e o `LIMIT` entram ANTES das subconsultas caras, e a
coluna `restantes` (contada antes do `LIMIT`) fecha o laço sem `count`. O
`carregar.ts` divide o espaço de ids em quatro faixas disjuntas e as pede em
paralelo, cada uma paginada pela chave. A 975 fica no banco (serve a versão
no ar durante o deploy); o pino `trajetorias-por-chave-1078.test.ts` exige o
MESMO texto de recorte nas duas.

**Prova.**
- Postgres 16 descartável (esqueleto com os índices da produção, 6.000
  negócios aleatórios em 3 funis, transferências e eventos de tipo que não
  conta): a 1078 aplicada duas vezes, e em 45 casos (3 funis × 5 períodos ×
  páginas de 1000, 250 e 7) a união das faixas é IDÊNTICA à 975, coluna por
  coluna; `restantes` anda exatamente o tamanho de cada página; o papel
  `authenticated` executa.
- Produção, só leitura (corpo como consulta, sem RLS): uma faixa inteira do
  Trabalhista (895 negócios, 12 meses) custa 122 ms; o funil inteiro, que a
  975 recalculava a cada página, 347 ms.
- Na tela, depois de aplicar a 1078 (03/10/2026; Trabalhista, build de
  produção da branch × produção com o código antigo, no mesmo minuto): o
  texto das três vistas é IDÊNTICO (Desempenho e Saúde letra por letra;
  Lista "31 de 31"), e o tempo até a última página chegar caiu — Saúde 2,3 s
  → 0,7–0,9 s, Desempenho 1,7 s → 0,4–0,5 s, Lista 1,3 s → 0,5–0,6 s. Cada
  faixa veio numa página só (882–958 linhas). No `next dev` cada faixa sai
  duas vezes (o StrictMode monta o efeito duas vezes): medir no build.

## Fase 3 — opcional

- Não buscar os cards do quadro enquanto a vista aberta é Lista,
  Desempenho, Saúde ou Automações (hoje a troca de funil nessas vistas baixa
  o quadro inteiro junto com a RPC).
- Lista enxuta do quadro numa viagem só (4 → 1 no Trabalhista, −0,4 s).
