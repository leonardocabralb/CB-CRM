# Plano — Histórico de situação e responsável da conversa (vivo e checável)

> **O que é este arquivo.** Guia retomável do registro de quem abriu,
> encerrou, deixou pendente ou trocou o responsável de uma conversa. Ele é
> editado a cada fase: ao iniciar uma fase, registra-se aqui que a anterior
> terminou (objetivo, arquivos, resultado medido).
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base nele, confirme
> contra o código e o banco; divergência se corrige no mesmo PR.

- **Criado:** 2026-10-13 · **Medido contra:** `main` @ `7af1e0bc`, produção
  `hxnhakmyxyhalbsktzwe` (maior migration aplicada: 1082).
- **Branch:** `feat/historico-da-conversa` · **Migration:** `1083_cb_historico_da_conversa.sql`.

## Estado

| Fase | Escopo | Estado |
| --- | --- | --- |
| **1** | Migration 1083 (tipos novos na trilha + gatilho por instrução) | ✅ feita — 15 cenários num Postgres 16 descartável, aplicada 3× (idempotente; a 3ª com dado: a conferência chama os gatilhos e desfaz sem rastro) |
| **2** | Quem/de onde nas escritas do servidor (`marcarOrigem`) + pino | ✅ feita — 14 escritores marcados; pino default-deny com teste de mutação |
| **3** | Linhas no fio e no Histórico da ficha (texto, ícone, dicionários) | ✅ feita |
| **4** | e2e no preview com a 1083 aplicada (precisa da autorização do operador) | a fazer |
| **5** | PR, revisão do Codex, merge com o operador | a fazer |

**Medido (13/10/2026, Postgres 16 local):** custo do gatilho de UPDATE no
caminho quente (prévia de mensagem, sem mudar situação) = ~5 µs por instrução
(5.000 UPDATEs: 0,194 s com o gatilho, 0,171 s sem), contra ~12 ms de cada
ida da VPS ao banco.

## O pedido (operador, 13/10/2026)

Caso que motivou: a conversa de um cliente apareceu encerrada e ninguém
sabia quem tinha encerrado. A resposta só saiu dos logs de acesso do
Supabase (poucos dias de retenção, sem dizer o que mudou). Pedido: "registrar
todas essas ações, aberturas, encerramentos, mudanças de status para
pendente… para a gente poder saber quem fechou, quem abriu. Se forem os
usuários, se for o sistema."

Decisões do operador:
- A linha aparece **dentro da conversa** (como "Avançou de … para …"), e por
  consequência na aba Histórico da ficha.
- **Troca de responsável** também é registrada.
- **Grupo fica de fora** (não tem ficha; a trilha é por contato).
- O passado não se reconstrói: vale do deploy em diante.

## Desenho

### Onde mora: a trilha do lead (912)

`cb_lead_events` já é a trilha append-only lida no fio (`intercalar`) e na
ficha (`ActivityHistory`), com realtime desde a 1059 e leitura pela policy da
1032. Dois tipos novos, com `deal_id` NULO (nenhum leitor de funil os conta —
conferido em 0975, 1065, 1078, `reunioes/carregar.ts`, agenda, situação do
cliente, `pipeline-settings.tsx`: todos filtram por tipo ou por `deal_id`):

- `conversation_status_changed` — `from_status` → `to_status`. Na criação,
  `from_status` NULO.
- `conversation_assigned` — só quando a situação NÃO mudou; responsável de
  antes e de depois em `details` (id + nome congelado).

Quando situação e responsável mudam juntos (encerrar solta o responsável;
reabrir enviando atribui a quem enviou; o robô deixa pendente com alguém), é
UMA linha de situação, com o responsável em `details`. Duas linhas para um
clique contariam dois fatos.

### Gatilho por INSTRUÇÃO, não por linha

O encerramento em lote (1018–1021) muda centenas de conversas numa instrução.
Um gatilho por linha com bloco `EXCEPTION` que grava abre uma subtransação
COM xid por linha: passa do cache de 64 subxids por volta da 32ª linha, e
daí toda leitura concorrente do banco paga SLRU até o commit — o defeito que
a 1014 mediu na carga da Kommo. Com `REFERENCING NEW TABLE`/`OLD TABLE` e
`FOR EACH STATEMENT`, cada instrução grava a trilha num `INSERT … SELECT`
só, dentro de UM bloco de exceção.

Custo: tabela de transição não aceita `UPDATE OF <colunas>`, então o gatilho
de UPDATE roda em TODA instrução sobre `conversations` (a prévia de cada
mensagem também). A primeira coisa que ele faz é um `EXISTS` sobre a tabela
de transição; sem mudança de situação/responsável, sai sem gravar nada.

### Quem e de onde

Ordem, decidida UMA vez por instrução (`cb_quem_mexeu_na_conversa`):

1. `auth.uid()` → `usuario`, com o nome congelado. A tela (encerrar,
   pendente, reabrir, atribuir) cai aqui sem mudar código.
2. Só com o papel `service_role` (o servidor do CRM), os cabeçalhos que o
   próprio código manda (`marcarOrigem`, `src/lib/conversations/origem-da-escrita.ts`):
   - `x-cb-via`: `cliente`, `celular`, `ligacao`, `envio`, `api`,
     `automacao`, `robo`, `agente`, `regua`, `agendamento`, `webhook`;
   - `x-cb-ator`: a PESSOA por trás da escrita do servidor (o envio pelo
     CRM reabre em nome de quem enviou) — aceita só se for membro da conta da
     conversa;
   - `x-cb-ref`: a automação, o robô ou o agente de IA (o nome é buscado e
     congelado na conta da conversa).
   - Sem `x-cb-via`, o `x-cb-origem: api` das rotas v1 (1040) vale como `api`.
3. Senão, `sistema` (SQL à mão, encerramento em lote, carga).

`origin` continua no vocabulário da 912 (`usuario`, `conexao`, `automacao`,
`sistema`): cliente/celular/ligação → `conexao`; automação/robô/agente/régua →
`automacao`; API, agendamento, webhook → `sistema`. O detalhe fino fica em
`details.via`, que é o que a tela lê.

Cabeçalho é RÓTULO, não credencial: o navegador também consegue mandar
cabeçalho, por isso ele só vale sem `auth.uid()` e com `service_role`.

### O que aparece no fio

Todas as linhas de situação e de responsável. A exceção é a CRIAÇÃO pelo
cliente (`via` cliente/celular/ligação): a primeira bolha já diz que ele
começou, e a linha "Conversa iniciada" cairia logo DEPOIS dela (o carimbo da
mensagem é o do aparelho). Ela fica no Histórico da ficha.

Criação com `created_at` mais de 10 minutos no passado é carga de histórico
(1033) e não vira linha: o passado não se reconstrói.

## Inventário de escritores (13/10/2026)

| Escritor | O que muda | Quem/de onde |
| --- | --- | --- |
| `message-thread.tsx` (`patchDeSituacao`) | situação (+ responsável) | `auth.uid()` |
| `painel/responsavel-menu.tsx` | responsável | `auth.uid()` |
| `api/whatsapp/send/route.ts` (cria) | criação | `auth.uid()` (cliente da sessão) |
| `conversations/reopen.ts` | reabre | `via` do chamador: Meta/Evolution/Instagram/tardia = `cliente`, celular pareado = `celular`, ligação = `ligacao`, núcleo = `envio` + ator (sem remetente = `api`) |
| `whatsapp/inbound-store.ts` `findOrCreateConversation` | criação | `cliente` / `celular` (Instagram usa a mesma) |
| `api/whatsapp/webhook/route.ts` (cria) | criação | `cliente` |
| `whatsapp/resolve-conversation.ts` (cria) | criação | `api` |
| `api/cb/conversas/abrir/route.ts` (cria, service role) | criação | `envio` + ator (quem abriu a Nova conversa) |
| `automations/destinatario.ts` (cria) | criação (às vezes encerrada) | do chamador: automação, webhook de entrada, agendamento, ligação |
| `automations/engine.ts` `close_conversation` e atribuir | situação/responsável | `automacao` + ref |
| `flows/engine.ts` (passagem para gente, 2 lugares) | pendente (+ responsável) | `robo` + ref |
| `ia-agentes/turno.ts` (transferir) | responsável | `agente` + ref |
| `asaas/varrer-regua.ts` (cria) | criação | `regua` |
| `cb-groups/persist.ts` | grupo | fora (o gatilho pula grupo) |
| Encerramento em lote (1018–1021), cargas (1016/1033/1034) | situação/criação | `sistema` |

Pino default-deny: `src/lib/conversations/origem-da-escrita.chamadores.test.ts`
— toda escrita nova em `conversations` que cria ou muda situação/responsável
declara a origem ou entra na lista com o motivo.

## Limites conhecidos

- O hook da trilha busca os 200 eventos mais recentes do contato
  (`use-lead-events.ts`). Conversa muito reaberta empurra os eventos de funil
  antigos para fora do fio (continuam no banco).
- A carga da Kommo que crie conversa DEPOIS da 1083 gera "Conversa criada já
  encerrada · pelo sistema"; o desfazer dela apaga a conversa mas não essa
  linha da trilha.
- Ação feita por SQL à mão sai "pelo sistema".
