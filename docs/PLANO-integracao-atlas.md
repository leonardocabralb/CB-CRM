# Plano — Integração nativa CRM ↔ Atlas Gestor

> Plano VIVO: cada fase registra o que foi feito, os arquivos e o resultado
> MEDIDO antes de a próxima começar. Documento interno (não viaja com o
> produto). Sem dado de cliente: exemplos fictícios.

## Objetivo

Hoje a única ligação é o contrato fechado do CRM chamando um webhook do n8n
do escritório, que cria o cliente no Atlas com uma chave guardada só no n8n.
O CRM é vendido a outros escritórios: a integração precisa funcionar para
qualquer um que também use o Atlas, **só pela API pública do Atlas**, com
**uma chave gerada pelo escritório no Atlas e colada no CRM**
(Configurações → Integrações). Nada de leitura do banco do Atlas.

## Decisões do operador (29/09/2026)

| # | Decisão |
|---|---|
| D1 | A chave é do ESCRITÓRIO (é como o Atlas já funciona): o admin gera no Atlas e cola uma vez no CRM. |
| D2 | **O Atlas manda no contrato.** A situação (ativo/rescindido/finalizado) vai do Atlas para o CRM, por consulta periódica. O CRM só escreve no Atlas ao fechar contrato (criar) e ao reativar. |
| D3 | Cliente que já existe no Atlas (rescindido/finalizado) e fecha contrato novo: **reativar o cadastro existente**, nunca criar outro. |
| D4 | Toda a equipe tem login no Atlas: o botão "Abrir no Atlas" leva à ficha. |
| D5 | O passo nativo "Criar cliente no Atlas" substitui só a parte do Atlas no n8n. **A planilha "Controle Clientes" continua no n8n**: o webhook fica só para ela, e o nó do Atlas sai do n8n no MESMO dia em que o passo nativo entrar (os dois ligados = cliente criado duas vezes). |
| D6 | Mudanças na API do Atlas são pedidas ao agente da sessão do Atlas por um prompt detalhado (entregue ao operador em 29/09, fora do repo). O agente devolve um "contrato" (ações, formatos, códigos de erro) para colar aqui. |
| D7 | A faixa na conversa só INFORMA; o operador decide seguir a conversa. |

## Estado

| Fase | O quê | Depende de | Estado |
|---|---|---|---|
| 1 | Faixa "Cliente rescindido / finalizado" pela MARCA da etapa (sem Atlas) | nada | **No ar** (PR #355, 29/09/2026): 1070 aplicada, etapas do CB marcadas, e2e no preview feito |
| 0 | Conectar pela chave + passo "Criar cliente no Atlas" (reativa quem já existe) no lugar da perna do Atlas no n8n | Prioridade 1 da API do Atlas em staging | **No `main`** (PR #356, 30/09/2026; 1071) |
| 2 | Vínculo contato ↔ cliente do Atlas + botão "Abrir no Atlas" + faixa também pela situação do Atlas | Fase 0; a API nova do Atlas em produção (promoção pelo Dev) | **Em curso**: PR A (servidor, 1072) no `main` (#357); PR B (tela, sem migration, branch `feat/atlas-fase-2-tela`) em revisão |
| 3 | Aba "Atlas" com o histórico de negociação | Prioridade 3 do Atlas (leitura de negociação com permissão própria); a aba do PR B | **Em curso**: PR C (branch `feat/atlas-fase-3-negociacao`, sem migration, depois do B) — rota, allowlist e a seção `negociacoes-do-atlas.tsx`, montada na aba Atlas |
| 4 | Mover o card por automação quando a situação muda no Atlas | Fase 2 | Planejada |

A ordem 1 → 0 é de propósito: a Fase 0 depende da API nova do Atlas, e a
Fase 1 não depende de nada (decisão do operador, 29/09/2026).

## Fase 1 — faixa pela etapa

**O que o operador vê.** Na conversa de um cliente rescindido ou finalizado,
a PRIMEIRA faixa acima do compositor diz "Cliente [RESCINDIDO]" (borda e
pastilha vermelhas) ou "Cliente [FINALIZADO]" (azuis), com o funil e a etapa,
e a dica "Confira o histórico antes de seguir o atendimento ou oferecer um
novo serviço". Sem botão, sem bloquear nada. O texto é `text-foreground` e a
cor fica na borda, no ícone e na pastilha opaca: com o `dark:` inerte, nenhum
tom único de vermelho ou azul é legível como texto nos dois modos.

**Regra** (`src/lib/pipelines/situacao-do-cliente.ts`, pinos ao lado):

- A etapa diz a situação pela MARCA `pipeline_stages.situacao_do_cliente`
  ('rescindido' | 'finalizado' | nula), escolhida em Gerenciar funil (4º
  seletor, "Situação do cliente"). Nunca pelo nome.
- ⚠️ **Um card por contato, e ele viaja entre funis.** O ex-cliente que volta
  (agenda pelo Calendly, ou alguém move o card para o Comercial) leva o ÚNICO
  card para fora do Jurídico. Por isso, por funil: com card lá, vale a etapa
  ATUAL; sem card, vale a etapa de onde ele SAIU na última saída da trilha
  (`pipeline_changed` para outro funil ou `deal_deleted`, com
  `from_stage_id`). A faixa apaga quando o card volta ao funil numa etapa sem
  marca (o contrato novo o leva a "Cliente Ativo").
- ⚠️ Nunca "o último evento por data" para a etapa atual: a trilha retroativa
  da Kommo tem data histórica, e em ~260 cards o `deal_created` da conexão é
  mais novo que os eventos que os puseram onde estão (medido em 29/09/2026).
- Card apagado numa etapa marcada mantém a faixa (a pessoa continua tendo
  sido rescindida). Limite conhecido.
- Etapa marcada COM histórico não se apaga em Gerenciar funil (como a etapa
  com degrau): apagá-la tiraria a faixa de todo ex-cliente que saiu dela.
  Tirar a marca antes é a saída explícita. Apagar o FUNIL inteiro leva os
  cards e as etapas juntos (confirmação própria) e apaga essas faixas — limite
  conhecido, como no Desempenho.
- Leitura que falha CALA a faixa, mesmo numa recarga: a releitura foi pedida
  por um evento da trilha, e o que estava na tela pode ter ficado errado.
- Recorte pelo perfil de quem vê, como o painel (cada equipe vê o seu),
  DERIVADO no render (a lente "Ver como" não mostra o perfil anterior).
- Cala com "não sei" (leitura falhou) e fora do contato atual (carimbo
  `{ de }`). Relê a cada evento novo da trilha do lead (mover card com a
  conversa aberta).
- Gerenciar funil: com o 4º seletor a linha da etapa tem ~818 px de mínimo;
  ela só deixa de quebrar a partir de `lg` (no iPad em retrato o diálogo
  rolava de lado).

**Arquivos:** `supabase/migrations/1070_cb_situacao_do_cliente_na_etapa.sql`,
`src/lib/pipelines/situacao-do-cliente.ts` (+ teste, com o pino do CHECK),
`src/hooks/use-situacao-do-cliente.ts`,
`src/components/inbox/faixa-de-situacao-do-cliente.tsx` (+ teste),
`message-thread.tsx`, `pipeline-settings.tsx`, `src/types/index.ts`, os dois
dicionários, `.claude/rules/funil.md`, `.claude/rules/inbox-conversa.md`,
`docs/MERGE-UPSTREAM.md`.

**Para ligar no CB (depois do merge):**

1. Aplicar a 1070 ANTES do deploy (aditiva) — com o "pode gravar".
2. Em Gerenciar funil do Bancário - Jurídico: "Cliente Rescindido" →
   Rescindido; "Cliente Finalizado" → Finalizado.

**Medido até aqui:** suíte inteira verde em Node 22, typecheck e lint limpos.
Revisão independente (três óticas) no PR #355: a primeira versão decidia pelo
card mais recente e apagava a faixa quando o único card saía do Jurídico —
corrigido pela saída da trilha; também corrigidos o contraste no tema escuro,
a linha do Gerenciar funil no iPad, o recorte de perfil velho na lente "Ver
como" e um comentário que mentia sobre a largura do diálogo. A consulta e a
migration contra o banco real: nada encontrado. O Codex apontou dois P2
(releitura que falha mantinha valor velho; apagar etapa marcada tirava a
faixa de quem saiu dela), os dois corrigidos.

**Aplicado e testado (29/09/2026):** 1070 em produção (histórico
`20260929230658`); "Cliente Rescindido" e "Cliente Finalizado" marcados pela
tela. E2E no preview só com o lead de teste: faixa vermelha em Rescindido,
azul em Finalizado (atualiza sozinha com a conversa aberta), CONTINUA acesa
com o card de volta ao Comercial, apaga quando ele volta ao Jurídico em
"Cliente Ativo" (onde o botão "avançar" não aparece mais); celular (375 px,
sem rolagem lateral) e tema claro legíveis; a trava de apagar etapa marcada
com histórico recusou numa etapa TEMPORÁRIA, que depois foi desmarcada e
apagada; Gerenciar funil a 820 px sem rolagem lateral. Limpeza conferida no
banco: o card voltou a MQL 1 com o mesmo valor, 7 eventos na trilha, fila
processada sem erro, nenhuma automação nem mensagem.

## Fase 0 — "Criar cliente no Atlas"

**Medido no staging do Atlas (29/09/2026, chave de teste do operador):**
`whoami` responde (escritório, plano, permissões, `appBaseUrl`); os erros
trazem `code` (`unknown_action`, `validation_error` com `fields`,
`not_found`); id malformado dá 400. AINDA NÃO: `find_clients`, `app_url` nas
respostas, `status_changed_at`, filtro por lista de status e a leitura de
negociação. ⚠️ O staging tem o MESMO id de escritório do CB em produção
(cópia dos dados reais): teste olha forma e contagem, nunca dado de cliente.

**Desenho (branch `feat/atlas-fase-0`):**

- **1071**: `cb_atlas_config` (uma linha por conta, chave CIFRADA, FECHADA ao
  navegador, com o escritório e o `atlas_tenant_id` do `whoami`) e
  `cb_atlas_clientes` (o vínculo 1:1 ficha ↔ cliente do Atlas, sem dado
  pessoal, LIDO por membro na forma da 1032 — a Fase 2 lê daqui —, escrito
  só pelo servidor, `contact_id` SET NULL, na receita de fusão).
- **`src/lib/atlas/`**: `cliente.ts` (a API, erro vira código),
  `enderecos.ts` (constante do produto + `ATLAS_API_URL` para o staging),
  `conexao.ts` (conectar pelo `whoami`, exigindo Consultar/Criar/Atualizar
  clientes; recusa chave de OUTRO escritório com vínculos gravados; guarda o
  AMBIENTE — o preview contra o staging não troca, apaga nem usa a conexão
  de verdade), `formatar.ts` (o formato do n8n), `decisao.ts` (criar /
  reativar / vincular / parar), `criar-cliente.ts` (o passo, testável fora do
  motor).
- **Cartão "Atlas"** em Integrações (`/api/cb/atlas`, admin): cola a chave,
  mostra o escritório; nenhuma chave volta.
- **Passo `atlas_criar_cliente`** (último da automação de contrato
  fechado): config com o tipo de contrato (fixo/mensal) e os três campos de
  data ESCOLHIDOS pelo operador (o CRM é vendido: as chaves dos campos do CB
  não são cravadas no código). Fora de `PASSOS_DE_ENVIO`; fora do que o agente
  de IA executa (manda dado para fora, como o webhook).

**Decisões tomadas por mim (defaults, para o operador conferir):**
estado pelo DDD só de número brasileiro (o n8n dava "SP" a número dos EUA);
a reativação não mexe em nome, telefone, e-mail nem nota do Atlas; o cliente
do Atlas já ligado a OUTRA ficha não é roubado (em curso: nada muda;
encerrado: o passo PARA antes de reativar — provável ficha duplicada); sem
conexão, o passo FALHA com motivo (não há aviso ao ligar a automação).
Depois da revisão do PR #356:

- **Inativo é reativado; suspenso PARA** (decisão do operador, 30/09/2026):
  inativo é cliente parado, e o contrato novo o traz de volta como
  rescindido e finalizado (D3); suspenso é decisão da equipe no Atlas, e o
  passo para e pede que ela reative lá (D2).
- **Casamento fraco para**: um cadastro que casa SÓ pelo e-mail ou pelos 8
  últimos dígitos (telefone guardado no Atlas sem DDD) não é reativado nem
  vinculado; o motivo manda conferir e acertar o telefone lá. É o "liga
  sozinho só com sinal forte" das Fases 2–4, aplicado já aqui.

**Pendências conhecidas da Fase 0:** ~~trocar o Atlas de ESCRITÓRIO exige
apagar os vínculos à mão~~ — resolvido no PR A da Fase 2 (o cartão oferece
apagar os vínculos do escritório anterior, com confirmação); duas execuções simultâneas do mesmo contato podem criar dois
cadastros (a segunda falha no vínculo, com o motivo), como o `create_deal`;
trocar de escritório NO MEIO de uma execução (o admin conecta outra chave
enquanto o passo roda) pode deixar um cliente órfão no escritório antigo —
corrida rara sobre uma troca que já é excepcional, sem trava (achado do
Codex, 30/09).

**D3 × a etiqueta — DECIDIDO (operador, 30/09/2026):** na "Contrato fechado"
tudo mora no ramo "NÃO tem a etiqueta Cliente Fechado"; o ramo SIM está vazio
e 1.082 fichas já têm a etiqueta. **O ramo SIM fica vazio**: a contratação de
um serviço novo por quem já é cliente é feita direto pelo Jurídico, e a
automação só roda na primeira contratação. O passo "Criar cliente no Atlas"
entra só como ÚLTIMO passo do ramo NÃO. Consequências: o CRM não reativa no
Atlas quem volta (a equipe reativa lá, D2); a leitura da Fase 2 vê o
`ativo` em até ~20 min e a linha do Atlas na faixa apaga; na Fase 4, uma
automação "Situação mudou no Atlas → ativo" marcando os DOIS funis
(Bancário - Jurídico e Comercial — o único card de quem volta está no
Comercial) devolve o card ao Jurídico. Pendente: a planilha "Controle
Clientes" deve receber quem volta? Hoje não recebe.

- Corte no CB no mesmo dia: o passo entra, o nó do Atlas sai do n8n, o
  webhook fica só para a planilha (D5).

**Achados na automação "Contrato fechado" (29/09/2026), para resolver com o
operador:** a mensagem de boas-vindas ainda tem o texto literal
"[LINK GOOGLE]" (uma mensagem já saiu assim); o passo "Fixar no número do
Jurídico" ficou DEPOIS do webhook (se o webhook falhar, não fixa). O passo
nativo entra por último.

## Fase 2 — leitura das situações e vínculo (em curso)

**Decisões do operador (30/09/2026):**

1. **Vínculo automático pelo TELEFONE: sim**, só com o telefone completo e
   ÚNICO dos dois lados (régua do telefone digitado, grafia canônica, 12
   dígitos ou mais; os números das conexões pela mesma régua — sem eles, o
   vínculo pelo telefone não roda no ciclo), marcado `casou_por = telefone`.
2. **Vínculo manual: só administradores** (PR B).
3. **Faixa: suspenso (âmbar) e inativo (cinza) também acendem** (PR B;
   `SITUACOES_NA_FAIXA` já nasce no PR A).
4. **Fase 4: só a trava "card fora do funil"** — sem a de "ficha velha" e sem
   a de 48 h. `crm_escreveu_em` é gravado, sem trava.
5. **`importado → ativo`** é o cadastro inicial (grava, nunca é evento);
   **`em_negociacao`** compara como `ativo` (gravado como veio).
6. **A leitura roda num `after()` da rota `cb/asaas/cron`** (laço lento),
   sem mudar o `docker-stack.yml` e sem `stack deploy`.
7. **A linha do Atlas na faixa aparece a todos** que veem a conversa, sem
   recorte de perfil (PR B).
8. **O Atlas "ativo" NÃO apaga a linha do funil**: as duas fontes aparecem,
   cada uma com a sua (PR B) — ao contrário da sugestão do mapa, de o Atlas
   vencer enquanto a leitura estivesse fresca.

**PR A (servidor, 1072):** o AMBIENTE em toda linha de vínculo e de recusa
(`noAmbiente`, pino `ambiente.chamadores.test.ts`; chaves 1:1 por ambiente,
NULLS NOT DISTINCT); a leitura (`situacoes.ts` + `leitura.ts`: cadeado com
cerca de posse, passo das mudanças e listagem completa com cursores
próprios, `decidirMudanca`, vínculo automático pelo link e pelo telefone,
recusas, lixeira marcada e nunca apagada, erros por código em `sync_erro`);
o passo "Criar cliente" com ambiente, recusa, `crm_escreveu_em` e a lixeira
que PARA; reconectar zera a leitura e oferece apagar os vínculos do
escritório anterior; o cartão com "Leitura das situações", "Ler situações
agora", as fichas vinculadas por origem e o selo "Ambiente de teste".

**PR B (tela, sem migration):** `GET /api/cb/atlas/contato/[contactId]`
(qualquer membro, só banco, `velha` calculada no servidor, balde próprio de
120/min — o fio e o painel leem juntos a cada troca de conversa) e
`useAtlasDoContato` no fio, no painel e na ficha de /contatos; o círculo
"Abrir no Atlas" no cabeçalho do painel e o botão na ficha e na aba; a faixa
junta funil e Atlas com a FONTE em cada linha (`juntarSituacoes`; suspenso
âmbar, inativo cinza; sem botão); a aba Atlas (depois de Relacionados) com a
situação, o "desde", a origem e — só admin — vincular colando o link da
ficha ou desvincular gravando a recusa (`PUT …/vinculo`, `vinculo.ts`).
Decisão de tela: no painel de 360 px a aba some para quem não vincula
quando a ficha não tem vínculo — decidida pela última leitura (sem piscar
na troca) e mantida na falha. Medido no e2e (30/09): 10 gatilhos de ~30 px
cabem sem número, mas cada número aceso soma ~28 px e, com dois, a fileira
passava dos 360 px e cortava o Histórico (já acontecia no `main` com 9
abas); a fileira do painel passou a quebrar linha (`flex-wrap`). Na lixeira, o admin tem "Conferir no
Atlas" (restaurar lá não muda a data, e só a listagem completa tiraria a
marca).

**Para ligar:** aplicar a 1072 ANTES do deploy (aditiva) — com o "pode
gravar". Na produção nada lê até a API do Atlas ser promovida: com a API
antiga, o cartão mostra `api_antiga` e nada é gravado.

**Medir contra o PostgREST real (antes do merge):** o `.or()` com `lt` sobre
timestamptz (cadeado e cerca de recência), a chave `NULLS NOT DISTINCT` pelo
INSERT (23505 de verdade com `api_url` nulo), o índice parcial da ficha, o
`count: 'exact', head: true` com `.not('contact_id','is',null)`, e `.in()`
com 100 ids.

**Limites conhecidos:** o vínculo pelo telefone só roda quando a listagem
completa começa e termina no mesmo ciclo — na prática a diária, que divide
as 10 páginas com as mudanças (escritório com mais de ~900 clientes fica só
com o link); fora dessa listagem, o vínculo pelo link só liga depois de o
`find_clients` confirmar que só UM cadastro aponta para a ficha (até 5 por
ciclo; ficha com mais de 9 conversas espera a listagem inteira); a lixeira
confere 5 vínculos por ciclo. A janela entre `provarPosse` e a escrita do
vínculo automático (milissegundos) segue aberta a uma reconexão com outro
escritório: o vínculo gravado ali seria do escritório antigo.

## Fases 2 a 4 — resumo do desenho

- **Vínculo** 1:1 (um cliente do Atlas por ficha): liga sozinho só com sinal
  forte (o link do próprio CRM gravado no Atlas; telefone igual e único dos
  dois lados); o resto, colando o link da ficha do Atlas no painel.
- **Situação do Atlas** lida no laço lento do agendador (~15 min), pelas
  MUDANÇAS desde a última leitura (`statusChangedSince`) e por uma listagem
  completa diária; a faixa passa a dizer a fonte ("no Atlas" ou "no funil")
  e mostra o último valor com a data se o Atlas cair.
- **Mover o card** (Fase 4): o gatilho novo passa o card certo à automação
  (o "Mover card" sozinho pega o card aberto mais recente de QUALQUER funil e
  arrastaria o card novo do Comercial de um ex-cliente que voltou). Nunca
  dispara na primeira vez que o CRM vê o cliente.
- **Aba de negociação** (Fase 3): só leitura na hora, sem guardar valores no
  CRM; sem texto livre. Visível a qualquer membro que vê a conversa, como as
  Cobranças (decisão do operador, 30/09/2026). `read_negotiations` é opcional
  e não marca a conexão; baldes de 20/min por usuário e por conta. Regras:
  `.claude/rules/integracoes-atlas.md`, "Aba de negociação".
  Montada na aba Atlas (no vínculo fora da lixeira), com o PR C empilhado
  sobre o B. Antes da promoção da API do Atlas a produção nem conectava (sem
  `whoami`): não há estado de "ação não suportada".
