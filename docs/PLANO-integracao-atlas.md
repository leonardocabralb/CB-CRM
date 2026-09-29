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
| 1 | Faixa "Cliente rescindido / finalizado" pela MARCA da etapa (sem Atlas) | nada | **Em curso** — código na branch `feat/faixa-situacao-do-cliente`; falta aplicar a 1070, marcar as etapas e testar no preview |
| 0 | Conectar pela chave + passo "Criar cliente no Atlas" (reativa quem já existe) no lugar da perna do Atlas no n8n | Prioridade 1 da API do Atlas (testar a chave, buscar cliente, códigos de erro) em staging | Aguardando o Atlas |
| 2 | Vínculo contato ↔ cliente do Atlas + botão "Abrir no Atlas" + faixa também pela situação do Atlas | Fase 0; Prioridade 2 do Atlas (link direto abre a ficha) | Planejada |
| 3 | Aba "Atlas" com o histórico de negociação | Prioridade 3 do Atlas (leitura de negociação com permissão própria) | Planejada |
| 4 | Mover o card por automação quando a situação muda no Atlas | Fase 2 | Planejada |

A ordem 1 → 0 é de propósito: a Fase 0 depende da API nova do Atlas, e a
Fase 1 não depende de nada (decisão do operador, 29/09/2026).

## Fase 1 — faixa pela etapa

**O que o operador vê.** Na conversa de um cliente cujo card está numa etapa
marcada, a PRIMEIRA faixa acima do compositor diz "Cliente RESCINDIDO"
(vermelha) ou "Cliente FINALIZADO" (azul), com o funil e a etapa, e a dica
"Confira o histórico antes de seguir o atendimento ou oferecer um novo
serviço". Sem botão, sem bloquear nada.

**Regra** (`src/lib/pipelines/situacao-do-cliente.ts`, pinos ao lado):

- A etapa diz a situação pela MARCA `pipeline_stages.situacao_do_cliente`
  ('rescindido' | 'finalizado' | nula), escolhida em Gerenciar funil (4º
  seletor, "Situação do cliente"). Nunca pelo nome.
- Por FUNIL, vale o card MAIS RECENTE do contato (qualquer status). O
  ex-cliente que voltou por um card novo do Comercial acende a faixa pelo card
  antigo do Jurídico; depois do contrato novo, o card transferido é o mais
  recente do Jurídico e a faixa apaga.
- Recorte pelo perfil de quem vê, como o painel (cada equipe vê o seu).
- Cala com "não sei" (leitura falhou) e fora do contato atual (carimbo
  `{ de }`). Relê a cada evento novo da trilha do lead (mover card com a
  conversa aberta).

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

**Medido até aqui:** suíte inteira verde em Node 22 (626 arquivos, 9.580
testes), typecheck e lint limpos. Falta o teste no preview.

## Fase 0 — "Criar cliente no Atlas" (quando a Prioridade 1 do Atlas chegar)

- Cartão "Atlas" em Integrações (admin): colar a chave, testar sem gravar
  nada, guardar cifrada (`ENCRYPTION_KEY`); endereço da API por configuração
  (staging para teste, produção no ar).
- Passo novo de automação, o ÚLTIMO da automação de contrato fechado:
  1. procura o cliente no Atlas (link da conversa do CRM, telefone, e-mail);
  2. não achou → cria, com os mesmos campos e regras que o n8n usa hoje
     (telefone com o 9, UF pela sigla do DDD — tabela nova no CRM —, datas
     `aaaa-mm-dd` no fuso do escritório, contrato "fixo", valor do card, link
     da conversa, nota "Enviado pelo CRM em …");
  3. achou rescindido/finalizado → reativa (D3); achou ativo → só vincula;
     achou mais de um → para e mostra;
  4. guarda o id do Atlas no CRM; falha fica visível na execução.
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
