---
paths:
  - "src/lib/automations/areas*"
  - "src/hooks/use-areas-de-automacao*"
  - "src/components/automations/abas-de-automacao*"
  - "src/app/(dashboard)/automations/page.tsx"
  - "supabase/migrations/1055_cb_areas_de_automacao*"
---

# Automações — as abas da tela (1055)

Pedido do operador (27/09/2026): separar a lista de automações por área, e
cada instalação cria as SUAS abas (o CRM vai ser vendido: um escritório tem
Bancário, outro quer Tributário). `cb_areas_de_automacao` (nome + posição, por
conta) e `automations.area_id`. O que morde código novo:

- ⚠️ **Nenhum nome de aba mora no código.** As abas desta instalação
  (Bancário, Trabalhista, Previdenciário) são DADO, criadas depois de aplicar a
  1055. Código que escreva uma delas quebra a regra da venda (`marca.ts`).
- ⚠️ **"Geral" NÃO tem linha**: é `area_id` NULO, fixa, com o rótulo do
  dicionário (o bloco "Geral" da 966). `lerNomeDaArea` recusa criar uma aba
  chamada "Geral".
- ⚠️ **Só organiza — o motor não lê `area_id`.** Aba não é escopo nem gatilho.
- ⚠️ **`ON DELETE SET NULL (area_id)` com a coluna NOMEADA**, sobre a FK
  COMPOSTA `(area_id, account_id)`: apagar a aba devolve as automações para
  "Geral" (a armadilha da 966). A FK é o que barra aba de outra conta na API
  (`ehAreaDeOutraConta` → 400 `area_not_found`).
- **As abas só entram com a lista delas LIDA** (`useAreasDeAutomacao`, `null` =
  não sei): com `[]` durante a carga, toda automação cairia em "Geral" por um
  instante. Leitura que falha deixa a lista sem abas, com o aviso.
- **Escrita direto sob RLS** (policy de admin), conferindo LINHAS: RLS que
  barra UPDATE/DELETE volta 0 linhas sem erro. Nome único por conta sem caixa
  (índice) e sem acento (a tela).
- **A automação criada pela aba Automações de um funil nasce na aba cujo nome
  o funil começa** (`areaDoFunil`: "Bancário - Comercial" → "Bancário"), só
  como sugestão no seletor do cabeçalho do construtor.
- **Duplicar copia `area_id`**; o PATCH trata `area_id` ausente como "não
  mexe" e `null` como "Geral".
