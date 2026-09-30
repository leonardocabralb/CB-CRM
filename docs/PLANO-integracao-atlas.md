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
| 0 | Conectar pela chave + passo "Criar cliente no Atlas" (reativa quem já existe) no lugar da perna do Atlas no n8n | Prioridade 1 da API do Atlas em staging: `whoami` e códigos de erro JÁ estão (29/09); falta `find_clients` e `app_url` | **Em curso** (branch `feat/atlas-fase-0`, migration 1071) |
| 2 | Vínculo contato ↔ cliente do Atlas + botão "Abrir no Atlas" + faixa também pela situação do Atlas | Fase 0; Prioridade 2 do Atlas (link direto abre a ficha) | Planejada |
| 3 | Aba "Atlas" com o histórico de negociação | Prioridade 3 do Atlas (leitura de negociação com permissão própria) | Planejada |
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
  clientes; recusa chave de OUTRO escritório com vínculos gravados),
  `formatar.ts` (o formato do n8n), `decisao.ts` (criar / reativar /
  vincular / ambíguo), `criar-cliente.ts` (o passo, testável fora do motor).
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
do Atlas já ligado a OUTRA ficha não é roubado; sem conexão, o passo FALHA
com motivo (não há aviso ao ligar a automação).

**Pergunta ao operador (D3 × a etiqueta):** na "Contrato fechado" tudo mora
no ramo "NÃO tem a etiqueta Cliente Fechado"; o ramo SIM está vazio e 1.082
fichas já têm a etiqueta. O ex-cliente que fecha contrato novo cai no ramo
vazio: nem o Atlas, nem as boas-vindas, nem a ida ao Jurídico rodam. Sugestão:
pôr o passo do Atlas também no ramo SIM (ele REATIVA), e decidir o que mais
deve rodar para quem volta.

- Corte no CB no mesmo dia: o passo entra, o nó do Atlas sai do n8n, o
  webhook fica só para a planilha (D5).

**Achados na automação "Contrato fechado" (29/09/2026), para resolver com o
operador:** a mensagem de boas-vindas ainda tem o texto literal
"[LINK GOOGLE]" (uma mensagem já saiu assim); o passo "Fixar no número do
Jurídico" ficou DEPOIS do webhook (se o webhook falhar, não fixa). O passo
nativo entra por último.

## Fases 2 a 4 — resumo do desenho

- **Vínculo** 1:1 (um cliente do Atlas por ficha): liga sozinho só com sinal
  forte (o link do próprio CRM gravado no Atlas; telefone igual e único dos
  dois lados); o resto, colando o link da ficha do Atlas no painel.
- **Situação do Atlas** lida no laço lento do agendador (~15 min), pelas
  listas "rescindidos" e "finalizados"; a faixa passa a dizer a fonte ("no
  Atlas" ou "no funil") e mostra o último valor com a data se o Atlas cair.
- **Mover o card** (Fase 4): o gatilho novo passa o card certo à automação
  (o "Mover card" sozinho pega o card aberto mais recente de QUALQUER funil e
  arrastaria o card novo do Comercial de um ex-cliente que voltou). Nunca
  dispara na primeira vez que o CRM vê o cliente.
- **Aba de negociação** (Fase 3): só leitura na hora, sem guardar valores no
  CRM; sem texto livre.
