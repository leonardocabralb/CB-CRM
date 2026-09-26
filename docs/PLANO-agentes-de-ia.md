# PLANO — Agentes de IA: vários agentes, cada um com personalidade, modelo, acesso e ferramentas próprios

> **Status: aprovado pelo operador em 25/09/2026, com as perguntas P1–P7 respondidas (D16–D23).** Em execução pela F0.
>
> **O que é este arquivo.** Um plano vivo e checável, no molde de `docs/PLANO-meu-dia.md` e `docs/PLANO-funil-comercial.md`. Ao concluir cada fase, registrar a data, os arquivos tocados e o resultado MEDIDO na seção 9 (diário), e revisar se a fase seguinte ainda é necessária.
>
> **Este documento envelhece.** As linhas citadas foram conferidas contra o `main` de 24/09/2026 (`7a082fdb`, merge do PR #288) e reconferidas em 25/09/2026 contra `2f969c65`: nenhum dos 17 commits do meio toca a IA. Antes de agir numa linha citada, confira de novo.
>
> - **Criado:** 24/09/2026. **Revisado (v2):** 24/09/2026, depois de duas revisões independentes (fatos contra o código; coerência com as decisões e as regras). 28 achados (6 graves, 15 médios, 7 menores), todos incorporados: o que mudou está na seção 10. **v3:** 25/09/2026, com as respostas do operador (seção 2, D16–D23) e a revisão final.
> - **Medido contra:** o código do `main` (7 leitores independentes, em somente leitura, e um verificador que abriu os arquivos para tentar refutar as 14 afirmações que sustentam o desenho: 10 confirmadas, 3 corrigidas em parte, 1 refutada) e a produção (consultas somente leitura pelo `supabase-cb`, 24/09/2026).
> - **Fluxo por fase:** branch a partir de `main` → PR para o CB-CRM → revisão em duas lentes → merge. Um PR por fase. Migration aplicada ANTES do merge, depois do replay verde do CI, com número acima do maior no `main` (hoje 1041; a F1a usa a 1042).

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| F0 | Medições baratas (links do Asaas, testes que fixam a semântica de hoje) | links medidos (seção 9); testes na F1a | — | — |
| F1a | Chaves por provedor: Radar, transcrição, embeddings e Integrações leem a chave nova. Conferido em produção | a fazer | sim | — |
| F1b | Agentes (lista e detalhe), Playground e Uso por agente. **Nenhum agente responde ainda** | a fazer | sim | — |
| F2a | O MOTOR de quem responde: agente de entrada, agente ativo, passo "Atribuir agente" (servidor), pausa por gente, fila de turnos, resposta em texto, fim do auto-reply legado. **Inerte ao entrar**: nada liga um agente até a F2b | em execução (decisões E1–E14 abaixo; a P8 segue a recomendação) | 1044 | — |
| F2b | As TELAS: agente de entrada no diálogo da conexão, faixa e bolha do inbox, o passo no construtor, a sub-aba Turnos, textos | a fazer | — | — |
| Piloto | **Bancário - Comercial** (D22), com dois agentes. ⚠️ Só depois do corte da Kommo (medição de 25/09, seção 9) | aguardando o corte | — | — |
| F3 | O que cada agente vê (ficha, campos, negócio, cobranças, transcrições) + base de conhecimento por agente (D20) | a fazer | sim | — |
| F4a | Medição das ferramentas no Gemini + o laço de ferramentas + as de leitura, transferir e passar para outro agente | a fazer | talvez | — |
| F4b | Ferramentas de escrita (mover etapa, etiquetas, campo, tarefa, executar automação) com origem `ia` na trilha | a fazer | sim | — |
| F5 | Medição do Calendly + reagendamento pela IA (horários livres e agendamento) | a fazer | talvez | — |

**Ordem:** F0 → F1a → F1b → F2 → piloto numa conexão, com dois agentes → F3 → F4a → F4b → F5. Cada fase entrega algo que funciona sozinho: a F1a não muda nada que o operador veja, além de Integrações; a F1b já dá personalidades separadas no Playground; a F2 as põe para conversar; a F3 e a F4 lhes dão dados e mãos.

---

## 1. O que entendi do pedido

1. Hoje existe **um** agente de IA para a plataforma. O pedido é uma aba onde se **criam e mantêm vários agentes**, cada um com:
   - **personalidade e instruções** próprias (o prompt) e **regras** próprias (D23);
   - **modelo** próprio (escolhido por agente);
   - um **limite do que ele pode ver** (dados do cliente, cobranças, agenda…);
   - um conjunto de **ferramentas** (ações que ele pode executar);
   - **configuração de uso** individual (liga/desliga, conexões, horário, teto);
   - **métrica de tokens** individual;
   - **Playground** individual.
2. Exemplos: um agente de **triagem inicial**; um de **cobrança e reagendamento de no-show**; um de **cobrança e tratativas do financeiro**. E agentes separados **por conexão** (Trabalhista, Bancário).
3. Ferramentas citadas: o agente do financeiro "atualiza uma fatura" — que, pela decisão D6, é **mandar a 2ª via ou o link que já existe**, nunca mexer na cobrança; o de triagem **move o lead entre etapas**.

---

## 2. Decisões do operador (24/09/2026)

As respostas às 15 perguntas da análise.

| # | Pergunta | Decisão |
| --- | --- | --- |
| D1 | Chave | **Uma chave por provedor na conta** (em Integrações); cada agente escolhe o provedor e o modelo entre os que têm chave. Mantém a metade "chave" da decisão de 28/08 ("nunca chave por conexão") e revê a metade "modelo" para o agente de conversa: o modelo passa a ser de cada agente (Radar e transcrição seguem com o modelo do módulo). Na F1b, atualizar a linha "IA: modelo e chave por MÓDULO" da seção 12 do `CLAUDE.md` e `.claude/rules/ia.md`. |
| D2 | Quem atende | **A conexão é a base**, com **passagem** entre agentes feita pelo próprio agente (ferramenta "passar para") e por automação, **registrada na conversa**. |
| D3 | Conexão sem agente | Cada conexão escolhe: **sem IA**, ou um **agente de entrada** — em geral o de **triagem**, que decide para qual agente direcionar. |
| D4 | Contato em duas conexões | Cada agente **lê só o que veio pela conexão dele**. A transferência para humano **cala os dois**. |
| D5 | Autonomia | **Sozinhas:** as ações internas e reversíveis (etiquetar, mover dentro do escopo, tarefa, transferir). **Fora da primeira versão:** as que saem do CRM ou não voltam atrás (ganho/perdido, mensagem para outro número, qualquer escrita no Asaas). |
| D6 | "Atualizar fatura" | **Mandar a 2ª via ou o link que já existe.** Jamais mudar vencimento, valor ou dar baixa. (A D9 do Asaas continua valendo.) |
| D7 | Reagendar | **Mandar o link de remarcar** do Calendly. Se não reagendar em **5 dias**, a IA **consulta a agenda e marca** o horário. |
| D8 | Liberdade | **As duas coisas**: ações soltas com parâmetros travados **e** disparar automações de uma lista aprovada. |
| D9 | Iniciativa | O agente é acionado pela **resposta do cliente a uma primeira mensagem enviada por automação**. O agente não inicia conversa. |
| D10 | Humano respondeu | **A IA para** naquela conversa. |
| D11 | "Respondido" | **Sim**: a resposta da IA apaga o alerta de atraso e a pendência do Radar. |
| D12 | Horário | **Sim**: horário de funcionamento por agente. |
| D13 | Uso | O gasto do Playground fica **separado, como teste**. |
| D14 | Quem mexe | **Só administrador** cria, edita e usa o Playground; o prompt fica **oculto** para quem não é administrador. |
| D15 | Radar e transcrição | Continuam como **custo da conta**, fora dos agentes. |

**Respostas às perguntas da v2 (25/09/2026):**

| # | Pergunta | Decisão |
| --- | --- | --- |
| D16 (P1) | A quem o agente de ENTRADA atende | Só a conversa que **nunca recebeu resposta de gente** — mensagem com `sender_id` ou `from_device`, em qualquer conexão da conversa, apagada inclusive. O cliente antigo só recebe agente quando uma automação o atribui. |
| D17 (P2) | "Atribuir agente" numa conversa pausada por gente | **Retoma**, exceto se alguém da equipe respondeu nas últimas 24 h: aí o agente fica atribuído, mas pausado, e a faixa do fio mostra isso. O responsável humano nunca é tocado. |
| D18 (P6) | Envio pela API v1 (n8n, Make) pausa a IA? | **Não** — é máquina, como automação e disparo. |
| D19 (P7) | A régua do Asaas pode atribuir o agente financeiro? | **Sim**, com a regra da D17. |
| D20 (P3) | Base de conhecimento | **Configurável por agente**: cada documento é marcado para os agentes que podem usá-lo (um documento pode servir a vários). |
| D21 (P4) | Custo | Em **R$**: a tabela de preço por modelo fica no código em US$ (com a fonte e a data), e o administrador informa a **cotação do dólar** (R$ por US$, já com o IOF do cartão). Sem cotação ou sem preço do modelo, a tela mostra tokens e diz o que falta. O teto de gasto que pausa o agente fica para depois. |
| D22 (P5) | Piloto | Conexão **Bancário - Comercial** (Evolution). Os dois agentes do piloto são definidos na F2. |
| D23 | Regras | **Instruções (o prompt) e regras são configuráveis por agente**, em campos separados: as instruções dizem quem o agente é e o que faz; as regras são uma lista do que ele nunca faz ou sempre faz, e entram no pedido como regras numeradas, depois das instruções. |

---

## 3. O que existe hoje (medido)

### 3.1 Na produção (24/09/2026, somente leitura)

- **`ai_configs` tem UMA linha no banco inteiro**: a padrão (`channel_id` nulo) da conta do escritório, `provider = gemini`, `model = gemini-3.7-flash`, `is_active = false`, `system_prompt` vazio, sem destino de transferência. `embeddings_api_key` nula.
- **`ai_usage_log`: 1.685 linhas, só dos modos `radar` (1.452) e `transcricao` (233)** (1.881 em 25/09). O assistente de conversa **nunca respondeu ninguém**, e o rascunho e o Playground nunca registraram uso.
- **Base de conhecimento vazia** (`ai_knowledge_documents` e `ai_knowledge_chunks`: 0; conferido de novo em 25/09).
- **`cb_channels.ai_autoreply_enabled = true` nas 7 conexões** (6 Evolution + 1 Meta; é o padrão da coluna, e nenhuma tela o mostra). `default_agent_id` nulo em todas.
- Nenhuma automação `new_message_received`/`keyword_match`/`first_inbound_message` e nenhum robô (flow) na conta do escritório. Das 239 conversas 1:1 abertas, **10 têm responsável** humano (cerca de 4%) e **nenhuma** está com a IA pausada. Nenhum dos 4.618 negócios abertos tem `assigned_to`.

**Consequência:** não há comportamento de agente em produção a preservar. O que PRECISA ser preservado é o Radar e a transcrição, que dependem da chave guardada na linha do "agente".

### 3.2 No código

- **A unidade "agente" é uma linha de `ai_configs`**, que mistura a **credencial** (provedor + chave) com o **comportamento** (prompt, modelo, interruptores, teto, transferência). A 903 trocou o `UNIQUE(account_id)` por dois índices parciais: no máximo **1 padrão + 1 por conexão** (`supabase/migrations/0903_cb_multicanal.sql:157-164`). Só existe escritor para o padrão (`src/app/api/ai/config/route.ts:40,148,316,361`).
- **Radar e transcrição leem a MESMA linha**, resolvendo pelo canal com `requireActive: false` (`src/lib/cb-radar/worker.ts:666-669,689`; `src/lib/transcricao/transcrever.ts:196-205`). A transcrição recusa provedor que não seja Gemini. A chave de embeddings é a coluna própria `embeddings_api_key` (`src/lib/ai/config.ts:140-166`).
- **Quando a IA responde:** por último na ingestão, depois do robô, das automações e do roteador de funil (`src/app/api/whatsapp/webhook/route.ts:1232-1242`; `src/lib/whatsapp/inbound-store.ts:571-579`), só com texto (áudio sozinho nunca aciona). Cala com: `ai_autoreply_enabled === false`, agente desligado, **existência** de automação ativa de "nova mensagem"/"palavra-chave" no canal (sem conferir se ela casou), conversa com responsável, IA pausada, teto de respostas (`src/lib/ai/auto-reply.ts:62-126`). Instagram e grupos nunca (garantia estrutural).
- **Não existe portão "humano respondeu"**: só a ATRIBUIÇÃO cala a IA, e o celular pareado não atribui ninguém (`auto-reply.ts:122`; `inbound-store.ts:312`).
- **O que o modelo vê:** as últimas 20 mensagens com `content_type = 'text'` da conversa **inteira** (todas as conexões, apagadas inclusive), um prompt fixo em inglês, o `system_prompt` e até 5 trechos da base (`src/lib/ai/context.ts:25-31`; `src/lib/ai/defaults.ts:83-125`). **Não vê** ficha, campos, negócio, data e hora, nem as transcrições de áudio já pagas.
- **Não há ferramentas.** Os provedores são chamados por `fetch` cru, uma chamada só, e os três leitores de resposta **descartam o que não é texto** (`src/lib/ai/providers/openai.ts:57-62`, `anthropic.ts:71-80`, `gemini.ts:53-61`). Só ligar ferramentas no pedido faria a chamada de ferramenta **sumir em silêncio**: quando ela vem junto com texto, o texto sai para o cliente e a ação se perde. A única "ação" hoje é o sentinela `[[HANDOFF]]` (`src/lib/ai/generate.ts:65-72`).
- **Envio:** a resposta sai por `engineSendText`, o remetente do robô (`src/lib/flows/meta-send.ts:90-106,198-229`): `sender_type = 'bot'`, sem `sender_id`, com `ai_generated = true`, e o canal gravado num UPDATE posterior, de melhor esforço. Não reabre conversa, não roteia para o funil e **não limpa `aguardando_desde`**: a 972 só limpa com `sender_type = 'agent'` (`supabase/migrations/0972_cb_aguardando_resposta.sql:68-69`).
- **Transferência:** grava `ai_autoreply_disabled = true` e um resumo fixo em inglês na coluna `conversations.ai_handoff_summary` (mostrada só na faixa da IA, não é anotação interna), e atribui a `handoff_agent_id` (um **membro humano**) se houver (`auto-reply.ts:195-217`; `src/lib/ai/handoff.ts:35-40`). A pausa é por **conversa** e vitalícia: só "Retomar IA" e o passo `set_ai` a desfazem — e **os dois também apagam o responsável humano** (`src/lib/automations/engine.ts:2009-2017`; `src/app/api/ai/autoreply/[conversationId]/route.ts:80-87`), porque hoje o portão é a atribuição.
- **"Digitando…"** (Fase 9 do merge): só em conexão Meta e com id `wamid.`; marca a mensagem como lida ANTES da geração; a Meta não oferece como cancelar — some em 25 s ou quando sai uma mensagem (`src/lib/ai/digitando.ts:43-51`; `src/lib/whatsapp/meta-api.ts:879-881`).
- **Uso:** `ai_usage_log` tem conta, conversa, canal, modo, provedor, modelo e tokens, **sem agente**; o `CHECK` de `mode` aceita só `auto_reply/draft/radar/transcricao`, e `logAiUsage` engole o erro do insert (`src/lib/ai/usage.ts:36-54`) — modo novo sem migration some calado. O Playground não registra nada; a transcrição grava sem `channel_id`. A tela soma só por modo e modelo, sem custo; ela pede 10.001 linhas, mas o PostgREST corta em 1.000 sem avisar, então **os totais de 30 dias já podem estar incompletos hoje** e o aviso `truncated` nunca acende (`src/app/api/ai/usage/route.ts:10,62,72-74`).
- **Tela:** `/agents` tem 3 abas (Playground, Configuração, Uso) sobre a linha padrão (`src/app/(dashboard)/agents/page.tsx`). A Configuração é `ai-config.tsx`, usado só ali; Integrações tem formulário próprio (`FormularioDaChave`, `src/components/settings/integracoes-panel.tsx:515,605`), que grava a mesma linha pela mesma rota e ecoa os campos que não edita. Qualquer membro lê o prompt pela API do banco (a RLS de `ai_configs` dá SELECT a todo membro).
- **Upstream:** o original não mexe na IA desde 13/09 (#527) e não tem nada de vários agentes nem ferramentas. Risco de conflito: só com a nossa Fase 11 do plano do merge (BSUID em `flows/meta-send.ts`); a Fase 10 (i18n) já entrou no `main` sem tocar os arquivos da IA.
- **O laço rápido do agendador bate SÓ em `/api/automations/cron`** (`docker-stack.yml`, a cada 15 s); o lento, a cada 15 min, nas outras rotas. Rota nova num dos laços só vale depois de um `docker stack deploy` manual na VPS.

### 3.3 O que as integrações já oferecem às ferramentas

- **Asaas:** o espelho guarda `link_fatura` e `link_boleto` por cobrança (`supabase/migrations/0994_cb_asaas_espelho.sql:155-156`; `src/lib/asaas/leitura.ts:132-133`), e a leitura por contato já existe (`src/lib/asaas/espelho.ts`). Medido na F0 (25/09): das 432 parcelas devidas no espelho (não apagadas), **todas têm link de fatura**; as 20 sem link de boleto são as 20 de cartão de crédito. A 2ª via é **leitura**, sem escrever nada no Asaas. ⚠️ O espelho pode estar velho: a régua **relê cada parcela no Asaas** antes de cobrar, justamente para não cobrar quem pagou (`.claude/rules/integracoes-asaas.md`).
- **Calendly:** as variáveis de cada agendamento guardam o link de **remarcar** e o de **cancelar** (`src/lib/calendly/variaveis.ts:36-37`). A API do Calendly também **lista horários livres** (`GET /event_type_available_times`, janela de até 7 dias por pedido) e **marca horário** (`POST /invitees`, a "Scheduling API"): exige plano pago — o nosso é, porque os webhooks funcionam — e aceita o token pessoal do dono ou do administrador da conta. **Não está documentado** se o agendamento feito pela API dispara o nosso webhook `invitee.created` (fontes: [Schedule events with AI agents](https://developer.calendly.com/docs/api-guides/schedule-events-with-ai-agents), [View availability data](https://developer.calendly.com/docs/api-guides/view-event-type-and-user-calendar-availability-data)). Medição da F5.
- **Automações:** mover etapa, etiquetar, preencher campo, criar tarefa, transferir e "executar automação" já existem no motor, mas presos ao `runStep` privado (`src/lib/automations/engine.ts:1375`). `runAutomationById` é exportado (`engine.ts:694`) e é o que o botão "Executar automação" usa, com as guardas de canal e etapa na rota (`src/app/api/cb/execucoes/executar/route.ts:83-132`).

---

## 4. Por que não dá para esticar o que existe

1. **Criar um agente por conexão em `ai_configs` troca em silêncio a chave e o modelo do Radar e da transcrição naquela conexão** (os dois resolvem pelo canal). Com provedor diferente do Gemini, a transcrição passa a ser recusada.
2. **O índice "um por conexão" impede triagem e cobrança no mesmo número**, que é o caso do escritório.
3. **Apagar uma conexão que tem agente próprio estoura `23505`** (o `channel_id` vira nulo e colide com o índice do padrão) ou promove o agente dela a padrão da conta (`0903:130-133,160-161`).

Por isso o desenho **separa a credencial do agente** e cria uma tabela de agentes nova. A linha padrão de `ai_configs` passa a ser só a configuração dos **módulos** (Radar).

**Três armadilhas que existem HOJE, independentes deste projeto** (resolvidas na F1a/F2):
- Ligar o agente atual faria ele responder nas 7 conexões do escritório, inclusive as de uso pessoal.
- "Remover" na aba Configuração apaga, sem confirmação, a chave que o Radar e a transcrição usam; e mudar o modelo ali muda o do Radar (`radar_model` é nulo na produção, então o Radar herda o `model`).
- Qualquer membro lê o prompt.

---

## 5. O desenho

### 5.1 Os conceitos

| Conceito | O que é | Onde mora |
| --- | --- | --- |
| **Chave do provedor** | Uma chave por provedor (OpenAI, Anthropic, Gemini) para a conta inteira (D1). A da OpenAI serve também aos embeddings | tabela nova, fechada ao navegador |
| **Configuração dos módulos** | Provedor e modelo do Radar, e a cotação do dólar que converte o custo em R$ (D21) | a linha padrão de `ai_configs`, que perde o papel de "agente" |
| **Agente** | Nome, descrição, instruções, regras (D23), provedor + modelo, conexões, horário, teto, acesso a dados, base de conhecimento (D20), ferramentas, para quem pode passar | tabela nova |
| **Agente de entrada da conexão** | Quem atende uma conversa que ainda não tem agente, naquela conexão (em geral a triagem), ou "sem IA" (D3). Atende só a conversa que nunca recebeu resposta de gente (D16) | coluna nova em `cb_channels` |
| **Agente ativo da conversa** | Quem está atendendo agora; muda por passagem (ferramenta ou automação) (D2) | coluna nova em `conversations` |
| **Pausa** | A IA calada naquela conversa, com o motivo (gente respondeu, transferência, botão, automação) (D10) | as colunas que já existem, mais o motivo |
| **Turno** | Uma resposta do agente: a mensagem que o acionou, o que ele viu, as ferramentas que chamou, o que respondeu, os tokens e o desfecho. É também a FILA e a TRAVA | tabela nova |

⚠️ **Nomes:** "agent" já significa **pessoa** no código (`assigned_agent_id`, `handoff_agent_id`, `default_agent_id`, o papel `agent`, e até `SetAiStepConfig.agent_id`, reservado num tipo). Tudo que é agente de IA leva `ia_agente` no nome (tabelas `cb_ia_*`, colunas `ia_agente_id`), nunca `agent_id`.

### 5.2 Modelo de dados (proposta; o SQL nasce em cada fase)

Regras que valem para toda tabela nova: `REVOKE ALL … FROM anon`, as duas metades de todo `REVOKE` de função com o `GRANT` de volta ao `service_role`, policy de leitura na forma da 1032 (`account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario(…)))`), conferência que roda em banco vazio, e FKs de autoria (`criado_por`, "quem mudou") com `ON DELETE SET NULL` — apagar o login de um administrador não pode levar junto a chave do Radar.

- **`cb_ia_chaves`** (F1a): `account_id`, `provedor` (CHECK nos três), `api_key` cifrada com `ENCRYPTION_KEY`, quem e quando. `UNIQUE (account_id, provedor)`. **Fechada ao navegador** (RLS sem policy); a tela lê o estado por rota de admin, e a chave **nunca sai de rota nenhuma**, nem mascarada. A migration **copia** a chave da linha padrão de `ai_configs` para o provedor dela (na produção: a do Gemini) e `embeddings_api_key` para o slot da OpenAI quando ele estiver vazio. Se houver duas chaves OpenAI diferentes (chat e embeddings), fica a do chat, com aviso na migration: qualquer chave válida da OpenAI chama embeddings; muda só o projeto da OpenAI que paga.
- **Cotação do dólar** (F1b, D21): `ai_configs.cotacao_dolar numeric` na linha padrão, gravada por rota PRÓPRIA que só mexe nessa coluna (o `POST /api/ai/config` reescreve a linha inteira). Nula = custo não calculado. A linha padrão existe desde a primeira chave (a F1a a cria), e o `DELETE /api/ai/config`, que a apagava, sai na F1a. ⚠️ O R$ usa a cotação ATUAL para todo o histórico: a tela diz isso ("em R$ pela cotação de hoje"); a vigência protege só o preço em US$.
- **`cb_ia_agentes`** (F1b): `account_id`, `nome` (único por conta, sem distinguir maiúsculas), `descricao` (é o que a triagem lê para decidir a passagem), `instrucoes` (quem o agente é e o que faz), `regras` (`text[]`, D23: cada item uma regra; vazio = nenhuma), `provedor`, `modelo`, `ativo`, **`conexoes` (uuid[]; vazio = NENHUMA, como o `radar_enabled`, porque é dado de cliente indo a provedor externo e há números de uso pessoal)**, `horario` (jsonb; nulo = sempre), `teto_respostas`, `acesso` (jsonb, F3), `ferramentas` (jsonb, F4), `pode_passar_para` (uuid[]), `transferencia` (membro ou fila), `arquivado_em` (apagar é arquivar, para o uso antigo manter o nome), autoria e datas, e **`UNIQUE (id, account_id)`** — o alvo das FKs COMPOSTAS das fases seguintes (conexão, conversa, turno, documentos); o Postgres exige o par único e TOTAL no destino (Codex, #292). **SELECT só para admin** (D14). Nome e id para os não-admins (bolha, faixa do inbox, e o resumo do passo "Atribuir agente" em `descreverPasso` — na grade do funil e na linha do tempo da aba Automações, que sem isso imprimiriam "(apagado)") saem por rota, nunca pela tabela. Apagar uma conexão tira o id dela de `conexoes` de todo agente (gatilho no DELETE de `cb_channels`, no molde do `cb_drop_channel_from_automations`).
- **`cb_channels.ia_agente_entrada_id` + `ia_agente_entrada_desde`** (F2): o corte da P8/E3 é carimbado PELO BANCO (gatilho BEFORE: a coluna sai de nula para um agente → `now()`; volta a nula → zera; trocar de agente não recarimba). FK composta `(ia_agente_entrada_id, account_id)` → `cb_ia_agentes (id, account_id)`, com `ON DELETE SET NULL (ia_agente_entrada_id)` por coluna (Codex, #292: `(id, account_id)` amarraria o id da PRÓPRIA conexão a um agente). Nulo = **sem IA** nesta conexão. Como agente é arquivado e não apagado, o que zera esta coluna é arquivar o agente (a tela avisa quais conexões ele atende, como já faz com funil padrão). Substitui `ai_autoreply_enabled` como portão (a coluna fica sem leitor e sai numa limpeza posterior). Entra no `CB_CHANNEL_SAFE_COLUMNS` e no PATCH da conexão, senão salva e some no reload.
- **`conversations.ia_agente_id`** + `ia_agente_desde` (F2): o agente ativo, com **FK composta `(ia_agente_id, account_id)`** — ele é escrito em service role a partir do `step_config` do passo "Atribuir agente" (JSON que veio da tela ou da API), e FK simples só garantiria "existe um agente com esse id". `conexoes` e `pode_passar_para` são arrays sem FK: validados ao salvar (todo id é da conta) e relidos com `.eq('account_id')` no turno. `ADD COLUMN` em `conversations` e `messages` leva `SET LOCAL lock_timeout` (tabelas quentes). **`ia_pausada_por`** (`'gente' | 'transferencia' | 'botao' | 'automacao'`) + `ia_pausada_em`, ao lado de `ai_autoreply_disabled`, que continua sendo o interruptor lido pelo inbox. **Encerrar a conversa zera `ia_agente_id`** por gatilho (os três caminhos que encerram: o fio, o passo `close_conversation` e o lote da 1018): o cliente cobrado em março que volta em agosto com assunto novo não cai no agente de cobrança. É o mesmo motivo pelo qual encerrar já solta o responsável.
- **`messages.ia_agente_id`** (F2): quem escreveu, gravado SÓ pelo envio do agente, **no próprio INSERT**, junto com o `channel_id` (hoje o canal vai num UPDATE posterior, e o gatilho AFTER INSERT da 972 e o filtro "desta conexão" do contexto dependem dos dois). É o que a bolha mostra ("IA · Triagem"). Não usar `ai_generated`, que é um booleano do upstream sem dono.
- **`cb_ia_turnos`** (F2): `conversation_id`, `mensagem_gatilho_id`, `canal_id`, `agentes` (a lista dos que agiram — a passagem fica DENTRO do mesmo turno), `modo` (`producao`/`teste`), `status` (`aguardando`, `rodando`, `respondeu`, `transferiu`, `sem_resposta`, `fora_do_horario`, `pausado_no_meio`, `descartado` (E10), `falhou`, `incerto`), `mensagem_enviada_id` (o id do provedor da resposta, gravado antes do INSERT — é o que a ingestão do eco consulta), `executar_apos`, `rodando_desde` (a posse), `iteracoes`, `acoes` (jsonb: ferramenta, argumentos, resultado resumido, ok/erro), tokens, `erro`. **Dois índices únicos parciais**: `(conversation_id, canal_id) WHERE status = 'aguardando'` (a rajada: um turno esperando POR CONEXÃO, com `NULLS NOT DISTINCT`; é o alvo do `ON CONFLICT` da RPC) e `(conversation_id) WHERE status = 'rodando'` (um executando por conversa). Fechada ao navegador; a tela lê por rota de admin.
- **`cb_ia_agente_documentos`** (F3, D20): `(account_id, ia_agente_id, documento_id)`, FKs compostas pela conta (⚠️ `ai_knowledge_documents` precisa ganhar `UNIQUE (id, account_id)` na mesma migration: sem o par único no destino a FK composta não é criada — Codex, #292), CASCADE dos dois lados (apagar o documento tira o vínculo; arquivar o agente não apaga nada, e o vínculo fica para quando ele voltar). Um documento pode servir a vários agentes. A busca na base (`match_ai_knowledge_semantic`/`_fts`) ganha o recorte pelo agente: só os trechos dos documentos marcados para ele. **Nada marcado = nenhuma base** (o mesmo "fechado por padrão" do acesso). ⚠️ O padrão das duas funções (0903) é "parâmetro nulo = sem recorte"; um `p_ia_agente_id` com essa semântica diria o contrário da D20. O recorte por agente vai em funções NOVAS (ou em DROP + CREATE com o parâmetro obrigatório), com o GRANT de volta e a conferência chamando as duas; o rascunho e o Playground sem agente continuam nas de hoje. O `p_channel_id` das de hoje não tem escritor (nenhuma tela grava `channel_id` nos trechos) e fica como está.
- **`ai_usage_log`** (F1b): `ia_agente_id` (SET NULL) + `ia_agente_nome` (congelado, a regra dos rótulos da 912); o `CHECK` de `mode` ganha `agente` e `agente_teste`. O `turno_id` entra na F2, junto com `cb_ia_turnos` (antes disso a FK não teria para onde apontar). **Migration antes do código**, senão o insert falha e `logAiUsage` engole.
- **Origem `ia` na trilha** (F4b): ver 5.6.

### 5.3 Quem responde (a regra, numa função pura `quemResponde`)

Toda mensagem do cliente numa conversa 1:1 de WhatsApp — texto, áudio, imagem ou documento; grupo e Instagram continuam de fora — passa pela regra no fim da ingestão, depois do robô e das automações:

1. O robô consumiu a mensagem → **ninguém**.
2. **Alguma automação de "nova mensagem", "palavra-chave", "primeira mensagem", "contato novo" ou "resposta de botão" FALOU COM O CONTATO por causa desta mensagem** (todos os gatilhos que a ingestão dispara para ela, somados — E4) → **ninguém**, para o cliente não receber duas respostas. Hoje o portão é a mera EXISTÊNCIA dessa automação no canal, mesmo sem ela casar, o que calaria o agente para sempre numa conexão com qualquer palavra-chave. As duas ingestões trocam `runAutomationsForTrigger` (que é `void`) por `dispararAutomacoes`, e o critério é "um passo que fala com o contato rodou" (`PASSOS_QUE_FALAM_COM_O_CONTATO`, `src/lib/asaas/regua.ts`), não "alguma executou": uma automação que só etiqueta voltaria a calar o agente para sempre.
3. A conversa está pausada, ou ENCERRADA depois das automações (um passo `close_conversation` desta mensagem a fecha de novo sem "falar") → **ninguém** (Codex, #292).
4. Há **agente ativo** na conversa, ligado e **não arquivado** (arquivar já zera `conversations.ia_agente_id` — gatilho da 1044 —, e a regra confere de novo; Codex, #292), e a conexão da mensagem está nas `conexoes` dele → **ele**. O responsável humano NÃO cala o agente ativo (a atribuição deixa de ser portão; ver a P2).
5. Senão, **a conversa NÃO tem agente ativo** (com agente ativo que não pode responder aqui — desligado, ou a mensagem veio por outra conexão — ninguém responde: a entrada não o substitui, senão desligar o especialista não funcionaria como freio e o cliente que escreve para outro número trocaria o agente da conversa inteira sem ninguém decidir; Codex, #292), a conexão tem **agente de entrada**, **ligado e não arquivado** (desligar não zera `ia_agente_entrada_id` — só arquivar zera —, então a regra confere; Codex, #292), com a conexão nas `conexoes` dele, e a conversa **nunca recebeu resposta de gente** (D16: nenhuma mensagem com `sender_id` ou `from_device`, em qualquer conexão da conversa, apagada inclusive — a agendada conta, porque alguém a escreveu; a da API v1, o robô e o disparo não) e **o contato foi criado DEPOIS de a entrada ser ligada na conexão** (`contacts.created_at >= cb_channels.ia_agente_entrada_desde`, P8/E3 — sem uma das duas datas, não atende) → **ele**, e ele vira o agente ativo. ⚠️ **A D16 sozinha NÃO bastava para quem veio da Kommo** (é por isso que a data do contato entra) (medido em 25/09 pela revisão final): 3.473 contatos com telefone não têm conversa nenhuma (3.425 com card da Kommo, 348 com negócio ganho, 80 clientes do Asaas), e 181 conversas 1:1 nunca tiveram mensagem de gente (175 da Kommo, 32 com ganho; 132 sem mensagem nenhuma, criadas encerradas pela carga). Na Bancário - Comercial são 44 de 694. Quando um deles escrever, a triagem o trataria como lead novo, inclusive cliente com contrato. Resolvido pela **P8** (E3): a data do contato, acima.
6. Senão → **sem IA**.

A regra decide QUEM; quem executa é o turno (5.7). Depois: fora do horário do agente → não responde (turno `fora_do_horario`; o alerta de atraso segue valendo para a equipe). Teto de respostas atingido → **transfere para gente**.

**Passagem entre agentes (D2, D3):** a ferramenta `passar_para_agente` (F4a) aceita só os agentes de `pode_passar_para` que têm a conexão da conversa E estão **ligados e não arquivados** — relidos no turno, na hora da passagem: arquivar já os tira de `pode_passar_para` (gatilho da 1043), mas desligar não (Codex, #292) —, lista a descrição de cada um para o modelo escolher, troca o agente ativo **e zera o contador de respostas no mesmo UPDATE** (o teto é de cada agente: sem zerar, o agente novo herdaria as respostas gastas pelo anterior e transferiria para gente sem responder nada; Codex, #292), e **roda o agente novo no mesmo turno**, com teto de 1 passagem por turno (sem pingue-pongue). A passagem aparece no fio como uma linha de sistema ("IA · Triagem passou para IA · Cobrança"), para cumprir o "registrada na conversa" da D2, e não só na tabela fechada dos turnos. Até a F4a existir, a passagem é só por automação.

**Automação aciona o agente (D9):** um passo NOVO, **"Atribuir agente de IA: X"** — não a mudança do `set_ai` de hoje, que ao ligar apaga o responsável humano. O passo **relê o agente na execução** e recusa o desligado, o arquivado ou o que NÃO atende a conexão do disparo (`p_canal_id`: a conexão da mensagem ou do envio da régua, senão a da conversa) depois de a automação ser salva (`agente_indisponivel`, nada gravado; Codex, #292), grava o agente ativo e zera o teto, **não toca `assigned_agent_id`**, e trata a pausa pela D17: retoma a pausa **por gente** (e a de outra automação, `'automacao'`), salvo resposta de gente nas últimas 24 h — aí o agente fica atribuído e pausado. As 24 h contam pelo `created_at` da última mensagem de gente (`sender_type = 'agent'` com `sender_id` ou `from_device`), apagada inclusive — `gravada_em` é nulo na carga da 1033 e "agora" na mensagem recuperada. ⚠️ **Automação NUNCA retoma as pausas `'botao'` e `'transferencia'`**: foram decisões de gente sobre aquela conversa, e com a régua do Asaas atribuindo a cada marco (D19) o cliente transferido, ainda esperando um advogado, voltaria a falar com a IA. Só o "Retomar IA" desfaz essas duas. O `set_ai` legado continua como está (ligar/desligar), e o "Retomar IA" do cabeçalho deixa de soltar a atribuição, porque ela deixou de ser portão. **A régua do Asaas pode usar o passo (D19)**: o `validate.ts` da régua é uma lista de PROIBIÇÕES, e o passo novo não entra nela; fica FORA de `PASSOS_QUE_FALAM_COM_O_CONTATO` (atribuir não é cobrar: a trava do marco continua medindo pela mensagem). ⚠️ A validação recusa "Atribuir agente" cujo agente não tenha, em `conexoes`, a conexão do `send_message` da régua: sem isso a resposta do devedor cai no passo 5 (o agente não cobre a conexão) e, pela D16, na triagem. Fora da régua, a validação avisa quando o escopo de canal da automação não cabe nas conexões do agente. ⚠️ A régua roda a cada marco, então o teto de respostas do agente zera a cada cobrança — aceito.

### 5.4 Quando o agente para, e como volta (D10, D11)

- **Gente respondeu → pausa** (`'gente'`), por **gatilho AFTER INSERT em `messages`**, com o predicado da 972: mensagem com `sender_id` **ou** `from_device`, sem `ia_agente_id`, fora de grupo, **com `created_at` posterior à atribuição do agente** (`ia_agente_desde`: a fala antiga recuperada pela 1010, gravada agora com o carimbo de horas atrás, não pausa o agente atribuído depois dela; Codex, #292) — e **só em conversa com agente ativo e ainda não pausada** (`ia_agente_id IS NOT NULL AND NOT ai_autoreply_disabled` no UPDATE). Sem essa condição, toda resposta humana em toda conversa gravaria uma pausa (uma escrita a mais em `conversations` por mensagem, com realtime para todas as abas) e a faixa diria "IA pausada" onde nunca houve IA; a D16 e a D17 perguntam às mensagens, não à pausa. No banco, e não em código, pela lição da 972: são vários escritores (núcleo de envio, celular pareado, mensagem histórica recuperada). A carga de histórico da 1033 grava `gravada_em` nulo e fica de fora do gatilho por isso. ⚠️ **O eco do próprio envio do agente** sai no `jaGravada` da ingestão — que espera só 2 s. Se o INSERT do envio atrasar ou falhar depois de o WhatsApp aceitar, o eco seria gravado como `from_device`: o agente se pausaria e a conversa passaria a "ter resposta de gente" para sempre (D16). Por isso o turno grava o id do provedor da resposta assim que o envio volta, ANTES do INSERT, e a ingestão do eco (`persistDeviceMessage`) consulta esse id antes de gravar; e o INSERT do envio do agente passa por `gravarComCanal` (conexão apagada no meio). A agendada sai com o `sender_id` de quem a criou: conta como gente. **O envio pela API v1 sai sem `sender_id`, de propósito** (`src/app/api/v1/messages/route.ts:188-193`), então **não pausa** (D18).
- **Transferência para gente → pausa** (`'transferencia'`), atribui o destino e grava uma **anotação interna de verdade** (aparece no fio e na aba Notas) com o resumo em português; hoje o resumo é uma coluna fixa em inglês que só a faixa da IA mostra. A anotação precisa aceitar autor sem usuário ("IA · Cobrança"): conferir o schema da 918 na F2.
- **"Pausar/Retomar IA"** no cabeçalho do fio (`'botao'`), para qualquer membro que opere a conversa. O `set_ai` de desligar grava `'automacao'`.
- **Volta** por "Retomar IA" ou pelo passo "Atribuir agente" (pela régua da P2).
- **A resposta do agente conta como "respondido" (D11).** A resposta sai com `sender_type = 'bot'`, que as réguas de hoje ignoram, então entra um RAMO PRÓPRIO — `sender_type = 'bot' AND ia_agente_id IS NOT NULL` — nos TRÊS lugares do banco que decidem "respondido": o gatilho de INSERT da 972, a função que recalcula a espera quando uma mensagem é apagada (972) e `cb_assentar_mensagem_historica` (vigente na 1011); e nos dois do Radar (a conferência ao vivo em `src/hooks/use-radar.ts:155-156` e o `porGente` do worker). Pino lendo o SQL. Robô, automação e disparo continuam de fora. ⚠️ No Radar, "fecha a pendência" e "tempo de resposta da equipe" passam a ser coisas separadas: a resposta da IA fecha a pendência, mas não entra na mediana de resposta da equipe; e `houveHumanoNaJanela` não muda.
- ⚠️⚠️ **A transferência REACENDE a espera:** a última mensagem da conversa é do agente ("vou chamar um advogado"), que acabou de limpar o alerta. Sem reacender, o cliente transferido some da fila de atraso justamente quando passa a depender de gente. Uma função SQL (`cb_reacender_espera`) grava em `aguardando_desde` o `created_at` da mensagem do cliente que abriu o turno da transferência, e é chamada depois do envio da despedida. ⚠️ **Condicional, com a conversa travada** (Codex, #292): o advogado pode responder entre a despedida e a função, e o gatilho da mensagem dele limpa a espera; reacender sem olhar gravaria de novo o carimbo antigo sobre cliente já atendido, e a caixa o pintaria de "crítico". A função trava a linha da conversa (`FOR UPDATE`) e só grava quando não há mensagem de GENTE (`sender_id` ou `from_device`) com `created_at` posterior à despedida. ⚠️ NÃO reusa a fórmula do recálculo da 972: ela ignora que encerrar limpou a espera (o defeito conhecido em `.claude/rules/supabase.md`) e pegaria a primeira fala depois da última resposta HUMANA — o começo de todo o atendimento da IA, que viraria "crítico" na hora, ou uma fala de meses antes de um encerramento. Com isso ele volta ao "sem responsável" do Meu dia.

### 5.5 O que o agente vê (F3, D4)

Cada agente marca o que entra no contexto; **nada marcado = só a conversa** (fechado por padrão, como o `radar_enabled`, porque é dado de cliente indo a provedor externo):

| Bloco | Conteúdo | De onde |
| --- | --- | --- |
| Conversa (sempre) | As últimas N mensagens **desta conexão** (D4), sem as apagadas, com data e hora; os **áudios pela transcrição**; imagem e documento como descrição (`[documento: extrato.pdf]`), com a legenda | `messages` + `transcricao_*` + `media_filename` |
| Ficha | Nome, telefone, e-mail, empresa | `contacts` |
| Campos | Os campos personalizados **escolhidos um a um** | `contact_custom_values` |
| Negócio | Funil, etapa, valor, há quanto tempo na etapa | `deals` (o `negocioAlvo`) |
| Etiquetas | As do contato | `contact_tags` |
| Cobranças | Parcelas devidas, vencimento, valor e se a leitura está fresca — **só leitura** | espelho do Asaas |
| Reunião | A próxima reunião e o link de remarcar | `cb_calendly_eventos` |
| Base de conhecimento | Os documentos marcados para este agente (D20) | `ai_knowledge_*` + `cb_ia_agente_documentos` |

⚠️ Mensagem sem carimbo de conexão (histórico anterior ao multi-canal) **não entra** — atribuí-la a uma conexão seria inventar, a regra de `canais-do-fio.ts`.

### 5.6 Ferramentas (F4a, F4b, F5; D5–D8)

Regras que valem para todas:
- **Ids vêm do servidor, nunca do modelo.** Conta, contato, conversa, negócio e cobrança saem do contexto do turno; o modelo escolhe só entre opções que o servidor ofereceu (etapas permitidas, etiquetas permitidas…). É a defesa contra o cliente que escreve "marque minha fatura como paga".
- **Cada ferramenta é ligada por agente, com parâmetros travados** (quais funis/etapas, quais etiquetas, quais campos, quais automações, para quem transferir).
- **Link que não veio do servidor não sai.** Toda URL na resposta tem de ter aparecido num resultado de ferramenta ou no acesso do agente naquele turno; senão a resposta é retida e o turno falha visível. Modelo inventa link de boleto.
- **Toda ação vai para o turno e para a trilha, com origem `ia` e o nome do agente.** Hoje nenhum gatilho saberia disso: `cb_atualizar_negocio` sempre grava `cb.cadeia`, que a 1040 classifica como `automacao` antes de olhar qualquer outra coisa, e a trilha da 912 grava `sistema` para a escrita pela service role. O sinal (F4b): uma variável de sessão `cb.ia_agente` gravada por RPC — parâmetro novo no `cb_atualizar_negocio` (DROP + CREATE) e RPCs para etiqueta e campo, porque o supabase-js não define variável de sessão na mesma transação de um INSERT —, testada ANTES da cadeia nas três funções de gatilho (`cb_enfileira_evento_de_funil`, `cb_log_deal_event`, `cb_log_contact_tag_event`), com o nome do agente no `actor_label`. O `CHECK` de origem é alargado ANTES da função (a lição da 1040), o pino da 1040 é atualizado, e a escrita da IA leva `cadeia` com uma `chaveDeAgente` (a trava contra laço). ⚠️ O `source` dos webhooks `deal.*` é contrato publicado: `ia` entra em `docs/public-api.md` e `docs/webhooks.md` no mesmo PR.

| Ferramenta | Efeito | Fase | Reusa |
| --- | --- | --- | --- |
| `consultar_cobrancas` | Parcelas devidas com os links de fatura e boleto, **relidas no Asaas antes de entregar** (leitura), como a régua | F4a | espelho + releitura do Asaas |
| `link_de_remarcar` | O link de remarcar da última reunião | F4a | `cb_calendly_eventos.variaveis` |
| `transferir_para_gente` | Pausa, atribui, anota o resumo, reacende a espera (5.4) | F4a | o bloco de transferência de `auto-reply.ts:195-217` |
| `passar_para_agente` | Troca o agente ativo e roda o novo no mesmo turno (5.3) | F4a | novo |
| `mover_etapa` | Move o card para uma etapa da lista permitida; **nunca** etapa de ganho/perdido (D5) | F4b | RPC `cb_atualizar_negocio` + `negocioAlvo`, extraídos do motor |
| `etiquetar` / `tirar_etiqueta` | Só as etiquetas da lista | F4b | RPC nova (o sinal `ia`) |
| `preencher_campo` | Só os campos da lista (ex.: "Tamanho da dívida" na triagem); valor vazio não apaga | F4b | a regra do `update_contact_field` |
| `criar_tarefa` | Tarefa para um membro da lista, ligada ao contato | F4b | extrair do `create_task` do motor |
| `executar_automacao` | Só as automações da lista, com as guardas da rota manual. **Ao salvar a lista, recusa automação com passo fora da D5** (status ganho/perdido, etapa de resultado, `send_to_number`, `send_webhook`), **e confere DE NOVO na hora de executar** (Codex, #292): a automação aprovada pode ser editada depois, e `runAutomationById` roda a definição de agora. A conferência percorre também as automações que ela aciona (`run_automation`); passo proibido encontrado = a ferramenta recusa e o turno registra por quê. ⚠️ **E na RETOMADA de um "Aguardar"** (Codex, #292): `resumePendingExecution` relê a automação e segue da posição guardada, então um passo proibido acrescentado DEPOIS do disparo escaparia. A execução que a IA iniciou leva a origem no contexto (`origem_ia`), e a retomada confere a D5 de novo antes de cada passo | F4b | `runAutomationById`, `rotuloDoDisparo = 'ia:<agente>'` |
| `horarios_livres` | Horários do tipo de evento configurado, próximos 7 dias | F5 | Calendly `event_type_available_times` |
| `marcar_reuniao` | Marca no horário escolhido pelo cliente, com o nome e o e-mail da ficha | F5 | Calendly `POST /invitees` |

**Fora da primeira versão (D5, D6):** ganho/perdido, mensagem para outro número, webhook de saída, cancelar reunião, e **qualquer escrita no Asaas — nunca** (vencimento, valor, baixa).

**O fluxo do no-show (D7), em configuração e sem código próprio.** A receita, porque o "Aguardar" das automações convive mal com um agente atribuído:
1. **Dia 0** (entrada em "No Show"): a automação manda o link de remarcar e **atribui o agente de reagendamento** logo ali, antes de qualquer "Aguardar". Se o cliente responder em qualquer dia ("vou ver", "não consegui entrar"), é o agente quem atende, com o link e, na F5, com horários.
2. **Todo "Aguardar" depois da atribuição leva "parar se o cliente responder"**, senão as mensagens seguintes da sequência saem por cima da conversa do agente. A F2 avalia um aviso no `validate.ts` para "Atribuir agente" seguido de "Aguardar" sem a caixa.
3. **Dia 5**, se ainda em "No Show": a automação manda a mensagem oferecendo encontrar um horário. Em conexão oficial (Meta), 5 dias sem fala do cliente fecham a janela de 24h: essa mensagem precisa ser **modelo aprovado**.
4. Com a F5, o agente usa `horarios_livres` e `marcar_reuniao`. Se o Calendly disparar o webhook do agendamento feito pela API (medição da F5), o resto — card para "Reunião Agendada", lembretes, aviso ao advogado — acontece pela automação do Calendly que já existe. ⚠️ O Calendly exige e-mail do convidado: quem já agendou tem o e-mail do agendamento anterior; sem e-mail, o agente pede.

### 5.7 O turno

- **Fila, não o `after()`.** Hoje a IA é aguardada dentro do `after()`, em série, ANTES do webhook de saída `message.received` (contrato público) e dos itens seguintes do lote da Evolution. Um turno com espera de rajada e ferramentas passaria de 50 s e atrasaria tudo isso. Por isso a mensagem do cliente só **grava ou atualiza o turno pendente** da conversa (`status = 'aguardando'`, `executar_apos = agora + espera de rajada`) e segue. Quem executa: um disparo no próprio processo depois da espera (o padrão do aviso imediato da drenagem do funil, sem `await` no caminho da ingestão) e, como rede, o **laço rápido do agendador**: o próprio `/api/automations/cron`, a única rota do laço rápido. ⚠️ A reivindicação entra no TOPO da rota, antes de qualquer `return` (a rota sai cedo quando não há espera vencida, que é o caso normal; o precedente é o batimento dela), com teto de turnos por tique, e os turnos rodam em `after()`, sem segurar a resposta ao `curl` (teto de 50 s). A rede é o que roda o turno que o disparo imediato não conseguiu reivindicar (outro turno da mesma conversa estava `rodando`). Rota NOVA no laço exigiria `docker stack deploy` manual na VPS; a rota que já está lá não exige. Nada segura mais a ingestão.
- **A escrita da fila é por RPC**, não pelo PostgREST: "grava ou atualiza o turno pendente" sobre índice único PARCIAL não é alvo de upsert (8b do `CLAUDE.md`), e "não há outro `rodando` nesta conversa" não cabe num filtro. A RPC faz `INSERT … ON CONFLICT (conversation_id, canal_id) WHERE status = 'aguardando'`, e um segundo índice único parcial (`status = 'rodando'`, só por conversa) garante um só rodando por conversa. ⚠️ O pendente é POR CONEXÃO (Codex, #292): há uma conversa por contato em todas as conexões, e o contexto do agente é só da conexão (D4); chaveado só pela conversa, o cliente que escreve para dois números na mesma rajada teria a mensagem do primeiro trocada pela do segundo, e o turno do primeiro não aconteceria.
- **Espera de rajada:** o cliente manda três mensagens seguidas. Cada mensagem nova só empurra o `executar_apos` e troca a mensagem-gatilho; o turno roda uma vez, sobre a última. Proposta: 8 s.
- **Trava:** os dois índices únicos parciais e a reivindicação por `UPDATE … RETURNING`, com cerca de posse (`rodando_desde`) em toda escrita. ⚠️⚠️ **O recolhedor NÃO re-executa** (diferente do Radar e do Calendly, que retomam o que recolhem): um turno `rodando` órfão — processo morto no deploy, ou erro depois do envio — pode já ter mandado a resposta, e re-executar a mandaria duas vezes ao cliente (regra 8e). `rodando` além do teto de recolhimento (bem acima dos 45 s de prazo) vira `incerto`, sem reenvio, e a conversa é transferida para gente. Erro DEPOIS do envio grava o turno como `respondeu` com o erro de registro, nunca como falha que se repete.
- **Idempotência:** o turno nasce do INSERT da mensagem, que já é único; a reentrega do provedor não cria turno.
- **Prazo:** teto de iterações (proposta: 4 idas ao modelo) e de tempo total (proposta: 45 s), com o tempo de cada chamada limitado ao que sobra. Esgotou → transfere para gente. Hoje não existe prazo total (`src/lib/ai/defaults.ts:60-67`).
- **Antes de gerar e antes de enviar, confere de novo:** a pausa (o advogado pode ter respondido pelo celular), se o agente continua ativo, se chegou mensagem mais nova do cliente e **se chegou resposta de GENTE gravada depois da mensagem do cliente** — pela ordem de GRAVAÇÃO (`gravada_em`), com pausa `'gente'` se o gatilho não a gravou. É o que fecha a corrida da ENTRADA: a resposta do advogado que chega entre a leitura da D16 e a atribuição é gravada sem agente ativo (o gatilho não tem o que pausar), e a mensagem do celular traz o relógio do aparelho, que pode ser anterior ao `ia_agente_desde` (Codex, #292). A resposta de gente sempre vence (D10). Pausou → descarta (`pausado_no_meio`). Mensagem nova → descarta; o turno dela já está aguardando. ⚠️ **Com ferramentas (F4), a mesma conferência roda antes de CADA ferramenta com efeito** (Codex, #292): descartar o texto no fim não desfaz uma etapa movida, uma tarefa criada ou uma automação executada. Mudou algo → o laço para ali, sem executar a ferramenta.
- **Áudio:** abre turno. A transcrição roda na hora, pela função idempotente da 943 (o "(futuro) auto-reply" já previsto em `.claude/rules/ia.md`), com a chave do Gemini da conta. ⚠️ Na Evolution o arquivo é baixado DEPOIS de todos os itens do lote, e a transcrição devolve `falhou` "ainda está sendo baixado" durante 2 min (`JANELA_DOWNLOAD_MS`): dentro dessa janela o turno é REAGENDADO; transfere para gente só com `recusada` (ou esgotada a janela).
- **"Digitando…"** (só conexão Meta): chamado depois da espera de rajada, quando o turno vai gerar — não mais antes. Não há como cancelá-lo: numa transferência sem mensagem ele some sozinho em até 25 s. ⚠️ O piloto (D22) é Evolution, onde o recurso não está ligado: o cliente não vê "digitando" no piloto. A Evolution tem `chat/sendPresence` (`composing`); ligá-lo é melhoria à parte, fora deste plano.
- **O pedido ao modelo**, nesta ordem: o texto-base (no dicionário, no idioma da instalação — hoje o prompt fixo é em inglês, `src/lib/ai/defaults.ts:83-125`: canal WhatsApp, respostas curtas, nunca inventar link, valor ou prazo, responder no idioma do cliente, pedir transferência quando não souber), a data e a hora no fuso do escritório, as **instruções** do agente, as **regras** numeradas (D23, "regras que você nunca quebra"), os blocos de acesso (F3), os trechos da base (F3) e a conversa. A mesma montagem serve ao turno, ao Playground e ao rascunho (uma função pura, com teste), para o Playground testar o que a produção vai mandar.
- **Envio:** continua pelo remetente do robô (`engineSendText`), que já confere conta e contato, assina com o nome do escritório e recusa Instagram, e ganha `ia_agente_id` e `channel_id` no INSERT.
- **Laço de ferramentas (F4a):** módulo NOVO, ao lado de `generate.ts`, no molde de `structured.ts` ("separado de propósito" — o rascunho e o teste de chave continuam em `generateReply`, intocados). Tipos neutros de turno (texto, chamadas, resultados) e um adaptador por provedor com duas funções puras: montar o pedido e ler a resposta. ⚠️ O Gemini 3.x exige devolver a assinatura de raciocínio (`thoughtSignature`) junto com a chamada de ferramenta: o turno do modelo volta ao histórico CRU. Medição da F4a.

### 5.8 Uso e custo

- Uma linha de `ai_usage_log` por chamada ao provedor, com o agente e o turno. O Playground grava `agente_teste` (D13), fora do total de produção e dentro do "teste" do agente.
- Radar e transcrição continuam sem agente, como custo da conta (D15). A transcrição passa a gravar o `channel_id`, que hoje falta.
- Por agente, na aba Uso: tokens por dia (produção e teste), turnos por desfecho (respondeu, transferiu, passou, falhou), iterações médias e as ações executadas.
- **Custo em R$ (D21):** `(tokens de entrada ÷ 1.000.000 × preço de entrada + tokens de saída ÷ 1.000.000 × preço de saída) × cotação do dólar`, com o preço em US$ por MILHÃO de tokens (tabela no código, com a fonte e a data de cada linha; Codex, #292). O preço separa entrada e saída; modelo fora da tabela vira "sem preço" (nunca zero); sem cotação, a tela mostra tokens e um aviso que leva à cotação. A tabela é SUGESTÃO de custo, não fatura: a tela diz que o valor é estimado. O preço vem do provedor na data da F1b (o preço de lista muda: o Gemini Flash dobra em 01/01/2027) e cada linha carrega a vigência, para a mudança entrar como linha nova e o histórico não ser recalculado com o preço novo.
- ⚠️ O Gemini com raciocínio conta os "pensamentos" no total mas não na saída (`gemini.ts:63-69`): gravar `total − entrada` como saída, senão o custo sai menor.
- A agregação vai para o banco (RPC). A rota de hoje já perde linhas acima de 1.000 (3.2); a nova tem de somar no banco.

### 5.9 A tela

- **`/agents` vira a LISTA**: um cartão por agente com nome, descrição, modelo, conexões, se é agente de entrada de alguma, ligado/desligado e o uso de 7 dias. "Novo agente" em branco ou a partir de três modelos de partida (Triagem, Cobrança, Financeiro), com instruções e regras iniciais no dicionário, sem o nome do escritório (o `produto-gate`). Ao lado da lista, a visão **Uso** da conta: todos os agentes, com o custo em R$ e o campo da cotação.
- **`/agents/[id]` é o detalhe**, com as sub-abas de `src/components/settings/sub-abas.tsx`: **Configuração** (nome, descrição, instruções, regras — uma por linha, com adicionar e remover —, provedor e modelo — só provedores com chave —, conexões, horário, teto, transferência, para quem pode passar), **Acesso** e **Base de conhecimento** (F3), **Ferramentas** (F4), **Playground**, **Uso** e **Turnos** (o registro de cada resposta, com as ferramentas chamadas — é o que responde "por que a IA fez isso?").
- **Playground por agente:** roda o turno de verdade, com ferramentas de escrita **simuladas** (mostram o que fariam) e as de leitura sobre um contato escolhido, e mostra o rastro das chamadas.
- **Conexões:** no diálogo de cada conexão, "Agente de IA de entrada: nenhum / X".
- **Integrações:** as chaves por provedor e, em cada uma, os agentes e os módulos que a usam. A **cotação do dólar** (D21) mora na aba Uso da lista de agentes, onde o custo aparece. O `FormularioDaChave` é reescrito na F1a: o eco dos campos do agente perde o sentido quando a chave sai de `ai_configs`.
- **Inbox:** a bolha diz qual agente escreveu; a faixa do fio mostra o agente ativo ou a pausa (com o motivo), com Pausar/Retomar; a passagem aparece como linha de sistema. Hoje a faixa lê o agente padrão com cache por conta e mentiria (`src/components/inbox/ai-thread-banner.tsx:26-43`).
- **Construtor de automações:** o passo "Atribuir agente de IA", com a variante do resumo em `descrever-passo.ts`.
- **Permissão (D14):** tudo de agentes é admin. A tela `agents` segue no catálogo de perfis, e `ESCRITA_DA_TELA.agents` continua `admin` (`src/lib/perfis/poderes.ts:150`); o Playground, que hoje aceita `agent`, passa a exigir admin. Membro sem perfil enxerga `/agents` pelo fail-open de `podeVerTela`: a tela diz "só administradores", nunca "nenhum agente".
- **i18n:** chave montada nova (desfecho do turno, motivo da pausa, modos `agente`/`agente_teste`, o passo novo, os modelos de partida) nasce com teste que lê os dois dicionários.

### 5.10 Radar, transcrição, rascunho e Integrações

- **Radar** lê a chave de `cb_ia_chaves` pelo provedor da configuração dos módulos, e deixa de resolver "pelo canal" (não existe mais agente por canal em `ai_configs`). `radar_model` e `radar_enabled` não mudam.
- **Transcrição** lê direto a chave do Gemini da conta, sem depender do provedor do Radar (é só Gemini e o modelo é fixo).
- **Embeddings (RAG)** usam a chave da OpenAI de `cb_ia_chaves`.
- **Rascunho (✨ no compositor)** usa o agente que responderia aquela conversa (ativo, senão o de entrada) e some quando não há nenhum. Hoje ele usa o padrão e exige o assistente ligado, então está sem uso em produção.
- As rotas que passam a ler tabela fechada (rascunho, Playground) usam `supabaseAdmin()` com a conta conferida: com SELECT só para admin, o cliente com a sessão do usuário veria zero linhas.

---

## 6. Fases

Em toda fase: os arquivos do upstream tocados ganham linha em `docs/MERGE-UPSTREAM.md` no mesmo PR (o desenho toca, além de `src/lib/ai/*`, `automations/engine.ts`, `validate.ts`, `flows/meta-send.ts`, `whatsapp/send-message.ts`, o webhook da Meta, as rotas `api/ai/*`, `ai-thread-banner.tsx`, `message-bubble.tsx`, `automation-builder.tsx` e `types/index.ts`), e todo pino que precisar mudar muda com o motivo escrito na allowlist — nunca afrouxado. O código novo vai para módulos novos (`src/lib/ia-agentes/`, `src/components/agentes-de-ia/`).

### F0 — Medições baratas

1. **Asaas:** quantas parcelas devidas têm `link_fatura`/`link_boleto` preenchidos (consulta somente leitura).
2. **Testes que fixam a semântica atual** e terão de mudar: `src/lib/ai/channel-scope.test.ts:67-102`, `config.test.ts:33-47`, `auto-reply.test.ts`, `digitando.chamadores.test.ts`, `src/lib/transcricao/transcrever.test.ts`; e os pinos que a F2 e a F4 vão tocar: `nome-fixado.chamadores`, `email-espelhado.chamadores`, `so-na-etapa.chamadores`, `parar-se-responder.chamadores`, `conversation-scope.chamadores`, `origem-e-aviso-duravel-1040`, `pipeline-routing.chamadores`, `reopen.chamadores`, `dono-duravel`.

As duas medições caras (ferramentas no Gemini, agendamento no Calendly) foram para o começo da F4a e da F5, que são as fases que dependem delas.

### F1a — Chaves por provedor

**Objetivo:** tirar a credencial de dentro do "agente" sem mudar nada que o operador use, além de Integrações. É a única fase que mexe no que roda hoje em produção (Radar e transcrição), por isso vai sozinha.

- **Migration (1042):** `cb_ia_chaves` com a cópia das chaves (5.2) e `ai_configs.api_key` sem NOT NULL (a linha padrão passa a existir sem chave). A coluna antiga FICA com o valor de hoje: se o deploy voltar atrás, o app anterior acha a chave onde sempre achou.
- **Todo leitor e escritor da chave antiga troca de fonte**, não só o Radar e a transcrição: `loadAiConfig` (assistente, rascunho, Playground, resposta automática), `loadEmbeddingsKey` (base de conhecimento), `GET`/`POST /api/ai/config` (o POST ignora `api_key` no corpo e recusa com `sem_chave`), `/api/ai/test`, a rota de status de Integrações e a tela de Agentes, que perde os campos de chave e o "Remover". O `DELETE /api/ai/config` sai (apagava sem aviso a chave do Radar e da transcrição). O Radar deixa de resolver pelo canal; a transcrição lê a chave do Gemini direto.
- **Integrações:** uma chave por provedor (`/api/cb/ia/chaves`: gravar valida no provedor; apagar pede confirmação e diz o que para), e o modelo do Radar por rota PRÓPRIA (`PATCH /api/cb/ia/radar`, só a coluna — nada de ecoar a linha do assistente). Salvar a primeira chave cria a linha padrão (assistente desligado), senão o Radar ficaria em `sem_ia` com a chave cadastrada.
- **A janela entre aplicar e publicar:** a migration copia um RETRATO. Nesse intervalo o app antigo continua gravando em `ai_configs.api_key`: não trocar chave nem usar o "Remover" até o deploy. Depois do deploy, conferir (só leitura) que o `updated_at` da linha padrão é anterior à aplicação; se não for, repetir a cópia, com autorização.
- **Testes:** pino de que só o repositório toca `cb_ia_chaves`, de que o Radar carrega a configuração sem canal, de que `loadAiConfig` não lê mais `api_key` e de que a transcrição lê a chave do Gemini; pinos da migration; `montarCartoes` com a chave por provedor.
- **Docs no MESMO PR:** `.claude/rules/ia.md` (a chave "pelo canal" deixa de valer), a linha da seção 12 do `CLAUDE.md` e a linha dos arquivos do upstream em `docs/MERGE-UPSTREAM.md`.
- **Pronto quando:** depois do deploy, uma análise do Radar e uma transcrição reais saem, e Integrações mostra as chaves por provedor. O `ai_usage_log` não guarda qual chave foi usada: quem prova a fonte é o pino (o caminho antigo não existe mais).

### F1b — Agentes, sem responder ninguém

**Objetivo:** criar, editar, testar no Playground e medir agentes. Nenhum agente responde cliente nesta fase.

- **Migration:** `cb_ia_agentes` (com instruções e regras, e o gatilho de limpeza das conexões), colunas de agente em `ai_usage_log`, o `CHECK` de `mode` e `ai_configs.cotacao_dolar`. Na produção o `radar_model` é nulo e o Radar herda o `model` da linha padrão: materializar `radar_model = model` onde ele é nulo, para o modelo do Radar deixar de depender de um campo que sai da tela de Agentes.
- **Servidor:** módulo `src/lib/ia-agentes/` (repositório, validação, a montagem do pedido com instruções e regras, a tabela de preço e o cálculo em R$); rotas `/api/cb/ia/agentes*` (admin); Playground por agente registrando `agente_teste`; uso agregado no banco; rota da cotação.
- **Tela:** lista e detalhe (Configuração com as regras, Playground, Uso com o custo em R$).
- **Pronto quando:** na preview, criar os três agentes de exemplo, conversar com cada um no Playground com modelos diferentes e ver uma regra sendo obedecida, ver o uso de teste separado por agente e em R$, e os totais da aba Uso baterem com um `count`/`sum` direto no banco.

### F2 — Quem responde, e a resposta em texto

**Porta de entrada:** as perguntas P1, P2, P6 e P7 — respondidas em 25/09 (D16–D19).

**Objetivo:** os agentes atendem de verdade, só com texto.

- **Migration:** `cb_channels.ia_agente_entrada_id` e `ia_agente_entrada_desde` (com o carimbo do banco), `conversations.ia_agente_id`/`ia_pausada_por` (com o gatilho do encerramento), `messages.ia_agente_id`, `cb_ia_turnos`, o gatilho da pausa por gente, o ramo do agente nas três funções de "respondido", e `cb_reacender_espera`.
- **Servidor:** `quemResponde` (puro, com teste, incluindo a D16); a fila de turnos (rajada, trava, prazo, conferências antes de gerar e de enviar, disparo imediato + a drenagem dentro de `/api/automations/cron`); o portão de automação por "rodou"; o passo "Atribuir agente de IA" (com a D17, e aceito na régua do Asaas pela D19); o "Retomar IA" sem soltar a atribuição; a transferência com anotação e reacendendo a espera; a régua do Radar separando pendência de tempo de resposta; contexto só da conexão, com áudio transcrito e mídia descrita; `ia_agente_id` e `channel_id` no INSERT do `engineSendText`.
- **Tela:** o agente de entrada no diálogo da conexão; a faixa, a bolha e a linha de passagem no inbox; o passo no construtor; a sub-aba Turnos.
- **Antes do piloto, medir** (só leitura): quantas mensagens `from_device` saem pela Bancário - Comercial vindas de outro sistema (a Kommo e o Make mandavam WhatsApp pelo celular pareado — `docs/PLANO-integracao-calendly.md`). Elas contam como gente: pausam o agente e fazem a D16 dizer "já teve gente". Se ainda houver, pilotar depois do corte da Kommo.
- **Piloto:** a conexão **Bancário - Comercial** (D22), com **dois** agentes (a triagem como entrada e mais um, atribuído por automação), por alguns dias, olhando os turnos. Os dois agentes, as instruções e as regras são combinados com o operador antes de ligar.
- **Pronto quando:** no piloto, uma conversa nova recebe a triagem; a resposta de um advogado pelo celular pausa a IA; uma automação atribui o segundo agente e ele responde; o alerta de atraso some com a resposta da IA e volta com a transferência; e o `message.received` não atrasa.

#### F2 — decisões da execução (25/09/2026)

Um mapa do código em sete frentes (ingestão, envio, banco, fila, telas, automações e uma medição na produção) respondeu o que o desenho deixava em aberto. As escolhas abaixo são as mais conservadoras; as marcadas com ⚑ pedem a confirmação do operador antes do piloto.

- **E1. A F2 vira dois PRs.** A **F2a** (motor) entra INERTE: sem a tela da conexão nem o passo no construtor, nenhum agente é ligado. A **F2b** traz as telas. Revisar e publicar o motor sozinho reduz o risco no caminho quente (as duas ingestões).
- **E2. ⚑ O auto-reply legado sai** (`dispatchInboundToAiReply`). Com os dois vivos, a mesma mensagem teria duas respostas, e o legado não conhece a D16 nem as conexões do agente. Na produção ele está desligado (`is_active = false`, zero uso de `auto_reply`). O ✨ do rascunho segue com o assistente anterior (5.10).
- **E3. ⚑ A P8 segue a recomendação:** a entrada atende só contato criado DEPOIS de a entrada ser ligada na conexão (`cb_channels.ia_agente_entrada_desde`, carimbado pelo banco quando a coluna sai de nula) E que nunca recebeu resposta de gente. É o lado que atende MENOS gente; alargar depois é uma linha.
- **E4. Portão das automações:** o motor devolve `falou` no `ResultadoDoDisparo`, marcado no MOMENTO do passo: envio que deu certo, envio reenfileirado pela retentativa, e — por conservadorismo — `run_flow`, `run_automation` e "Aguardar" (vão ou podem falar depois). Contam todos os gatilhos da mensagem: nova mensagem, palavra-chave, primeira mensagem, contato novo e resposta de botão. O `tag_added` disparado por "Adicionar etiqueta" fica de fora (limite aceito: raro, e contá-lo calaria o agente em toda automação que só etiqueta).
- **E5. O eco do envio do agente** é reconhecido no `jaGravada` da rota da Evolution (o ponto comum aos três caminhos, inclusive o `@lid` sem telefone), por `cb_ia_turnos.mensagem_enviada_id`; e o gatilho de pausa ignora a mensagem cujo id é o de um turno (defesa dobrada). ⚠️ Reconhecer NÃO é descartar (Codex, #292): se a linha do envio não existe depois da espera do `jaGravada` — o processo morreu entre gravar o id e o INSERT —, a ingestão grava o eco COMO a resposta do agente (`sender_type = 'bot'`, `ia_agente_id` do turno, nunca `from_device`). Descartá-lo perderia a bolha para sempre e deixaria o alerta de atraso aceso sobre cliente respondido. Se o INSERT do turno chegar depois, o `UNIQUE (conversation_id, message_id)` o recusa, e o turno lê o 23505 como "já gravada pelo eco", não como falha.
- **E6. Envio:** `engineSendText` ganha `iaAgenteId`, o canal EXIGIDO (falha fechada, nunca a queda silenciosa para o padrão) e um aviso do id do provedor ANTES do INSERT; o INSERT leva `channel_id` e `ia_agente_id` (por `gravarComCanal`). Só o turno passa `iaAgenteId` (pino default-deny: o ramo "respondido" do banco confia nele).
- **E7. Sem despedida na transferência (F2).** O texto-base manda o modelo responder SÓ o sentinela; nada é enviado ao cliente e a espera acesa pela mensagem dele continua valendo — `cb_reacender_espera` não é necessária na F2 (volta, condicional, se uma despedida entrar).
- **E8. Falha de configuração não transfere:** sem chave, chave ilegível, modelo recusado ou provedor fora do ar → o turno termina `falhou`, com o motivo, e NÃO pausa (a pausa `'transferencia'` seria permanente por um problema passageiro). A espera do cliente segue acesa, e o alerta de atraso chama a equipe. Transferem: o sentinela, a resposta vazia e o teto de respostas.
- **E9. Áudio:** o turno só chama a transcrição com o arquivo já baixado; sem ele, reagenda por até 2 min contados de `gravada_em` (o relógio do banco), e depois transfere. `transcrevendo` reagenda. Imagem, documento e vídeo entram como descrição (`[documento: extrato.pdf]`); figurinha, localização e toque em botão não abrem turno.
- **E10. Mensagem mais nova do cliente NA MESMA CONEXÃO** (por `gravada_em`) descarta o turno em curso (`descartado`, status novo): o turno dela já está na fila.
- **E11. Encerrar a conversa limpa tudo da IA:** agente ativo, pausa (qualquer motivo) e o contador de respostas. O cliente que volta meses depois com assunto novo não herda nem o agente nem a pausa de uma transferência antiga.
- **E12. "Atribuir agente" decide a D17 no BANCO** (`cb_atribuir_agente_de_ia`, com a conversa travada): ler "houve resposta de gente em 24 h?" em JS e depois gravar deixaria uma resposta do advogado no meio sem pausar. Pausa sem motivo (anterior à 1044) conta como `'botao'` (não retoma). Reatribuir o MESMO agente mantém o `ia_agente_desde`.
- **E13. O `set_ai` legado segue a mesma régua:** desligar grava `'automacao'`; ligar retoma só `'gente'` e `'automacao'` e deixa de soltar o responsável humano (a atribuição deixou de ser portão).
- **E14. `claim_ai_reply_slot` fecha:** hoje `anon` e `authenticated` a executam (conferido na produção em 25/09) — qualquer um com o id de uma conversa somaria no contador; com a F2, isso forçaria a transferência. As duas metades do REVOKE e o GRANT ao `service_role`.

### F3 — O que cada agente vê

**Objetivo:** o agente responde com os dados que lhe foram liberados (5.5), e cada um tem a sua base de conhecimento.

- **Migration:** `cb_ia_agente_documentos` e o recorte por agente nas duas funções de busca da base (D20).
- **Servidor:** montagem do contexto por blocos, com teto de tamanho por bloco e o bloco de cobranças dizendo quando a leitura está velha (a régua `leituraFresca` do Asaas).
- **Tela:** sub-aba Acesso; a base de conhecimento dentro do agente.
- **Pronto quando:** no Playground, o agente de cobrança vê as parcelas do contato escolhido e o de triagem não; e um documento marcado só para a triagem aparece na resposta dela e não na do agente de cobrança.

### F4a — O laço de ferramentas, leitura e passagem

- **Medição primeiro (com autorização do operador, porque o script decifra a chave da produção):** um turno com duas ferramentas no Gemini 3.7 Flash, fora do app — a exigência da `thoughtSignature`, os tokens de raciocínio, a latência e o custo por turno. OpenAI e Anthropic quando houver chave delas; até lá, ferramentas só em agentes Gemini, e a tela diz isso.
- **Servidor:** o laço (módulo novo); o registro de ferramentas com os parâmetros travados; a trava de link inventado; `consultar_cobrancas`, `link_de_remarcar`, `transferir_para_gente`, `passar_para_agente`.
- **Tela:** sub-aba Ferramentas; o rastro no Playground e nos Turnos.
- **Testes:** default-deny — ferramenta só executa pelo registro; instrução injetada na mensagem do cliente não alcança id de outro contato; cada adaptador com a forma MEDIDA (a lição do `storage.exists()`: dublê que imita a forma suposta passa verde sobre o defeito).
- **Pronto quando:** no piloto, a triagem passa para o agente de cobrança, que manda a 2ª via com o link verdadeiro e relido.

### F4b — Ferramentas de escrita

- **Migration:** a origem `ia` (o `CHECK` antes das funções) e o sinal `cb.ia_agente` nas três funções de gatilho; a RPC `cb_atualizar_negocio` com o parâmetro do agente; as RPCs de etiqueta e campo.
- **Servidor:** os executores extraídos do motor para funções exportadas, com as mesmas cercas; `mover_etapa`, `etiquetar`/`tirar_etiqueta`, `preencher_campo`, `criar_tarefa`, `executar_automacao` (com a recusa dos passos fora da D5 ao salvar a lista).
- ⚠️⚠️ **Automação iniciada pela IA NÃO pode ter `run_flow`** (recusado ao salvar a lista do `executar_automacao` e na hora de executar, como os outros passos fora da D5): o `run_flow` não carrega contexto nem origem, e o `set_tag` do fluxo dispara `tag_added` a partir de `run.vars` — a origem `ia` se perderia ali, e a cascata sairia da D5 (Codex, #292).
- ⚠️⚠️ **A CASCATA também respeita a D5** (Codex, #292): etiquetar dispara as automações de `tag_added` na hora (`engine.ts`, o passo `add_tag`), e mover o card enfileira as de etapa — e elas podem ter `send_webhook`, `send_to_number` ou ganho/perdido. Validar só o `executar_automacao` deixaria a IA sair da D5 por tabela. A escrita da IA leva a origem (`origem_ia`) para o contexto das automações de EVENTO que ela dispara (o `cb.ia_agente` já vai para a fila do funil), e o motor recusa ali os passos fora da D5 — o mesmo validador do `executar_automacao`, antes de cada passo e na retomada. Passo recusado = a execução registra por quê; o resto da automação segue as regras de sempre.
- **Docs:** `source = ia` em `docs/public-api.md` e `docs/webhooks.md`.
- **Pronto quando:** no piloto, a triagem move o card e etiqueta, e o histórico do lead e o webhook `deal.stage_changed` dizem "IA · Triagem".

### F5 — Reagendamento pela IA

- **Medição primeiro:** `GET /event_type_available_times` do tipo de evento da automação (leitura); `POST /invitees` num tipo de evento **de teste**, conferindo se o nosso webhook recebe o `invitee.created` e se a automação do Calendly roda. Cria uma reunião de verdade — **só com autorização do operador**, cancelada em seguida.
- **Servidor:** `horarios_livres` e `marcar_reuniao` no cliente do Calendly; o tipo de evento como parâmetro travado da ferramenta.
- **Configuração:** a receita do no-show (5.6).
- **Pronto quando:** um no-show de teste recebe horários, escolhe um, a reunião nasce no Calendly e o card vai para "Reunião Agendada" pela automação que já existe.

---

## 7. Riscos e armadilhas

- **Radar e transcrição dependem da chave de hoje.** A F1a muda de onde ela é lida; um erro ali para a análise de todas as conversas e todo áudio. Por isso a F1a vai sozinha e é conferida em produção.
- **`logAiUsage` engole erro:** modo novo sem a migration aplicada some do uso sem aviso.
- **Injeção de instrução pelo cliente:** a defesa é estrutural (ids do servidor, parâmetros travados, link só do servidor), não uma frase no prompt.
- **Uma conversa por contato, várias conexões (D4):** a pausa é da conversa; o agente ativo só atende nas conexões dele (5.3, passo 4).
- **Celular pareado:** 948 das mensagens da equipe saem por ele contra 8 pelo CRM (medido em 30/08). A pausa por gente mora no gatilho do banco justamente para enxergar o `from_device`.
- **A transição (sem pausas herdadas):** nenhuma das 239 conversas está pausada, porque a pausa por gente só nasce depois da F2. A triagem ligada numa conexão falaria no meio de atendimentos que o advogado conduz pelo celular — é o que a D16 impede (a entrada só atende quem nunca recebeu resposta de gente).
- **O "Aguardar" das automações** e o agente atribuído: a receita da 5.6.
- **Custo:** um turno com ferramentas custa de 2 a 4 chamadas. O teto de iterações e o de respostas limitam isso por conversa; o limite de taxa hoje é por conta e conta mensagens recebidas, não chamadas (`src/lib/rate-limit.ts:184`).
- **Apagar agente é arquivar.** Apagar de verdade levaria junto a atribuição do uso e dos turnos.
- **Apagar conexão:** o gatilho tira a conexão das `conexoes` de todo agente; a do agente de entrada some com a linha da conexão.

---

## 8. Perguntas

**As sete perguntas da v2 foram respondidas em 25/09/2026** e viraram as decisões D16–D23 (seção 2). O texto das perguntas, com as recomendações, está no histórico do arquivo (`git show fef4c43a:docs/PLANO-agentes-de-ia.md`).

**Uma pergunta nova, da revisão final (porta da F2):**

- **P8. A quem a entrada atende, dado o histórico da Kommo?** A D16 ("nunca recebeu resposta de gente") não vê o cliente que veio da Kommo sem conversa: 3.473 contatos com telefone não têm conversa nenhuma (3.425 com card da Kommo, 348 com negócio ganho) e 181 conversas nunca tiveram mensagem de gente; na Bancário - Comercial, 44 de 694. *Recomendo: a entrada atende só contato NOVO — criado depois de a entrada ser ligada naquela conexão (`ia_agente_entrada_desde`) — e que nunca recebeu resposta de gente. Todo contato anterior (Kommo, Asaas, CSV) fica fora, sem precisar de uma lista de exceções; o cliente antigo recebe agente só por automação.*

Ficam para a hora de cada fase, sem bloquear as anteriores:

- **F2:** os dois agentes do piloto, com instruções e regras, combinados com o operador antes de ligar a Bancário - Comercial.
- **F3:** a conta não tem chave da OpenAI. Sem ela, a base de conhecimento funciona só pela busca por palavras (o caminho que já existe em `retrieveKnowledge`); a busca por sentido exige a chave. Cadastrar ou não é decisão do operador.
- **F5:** qual tipo de evento do Calendly o agente de reagendamento oferece, e a autorização para a medição que cria uma reunião de teste.

---

## 9. Diário

Registrar cada fase ao concluir: data, PR, arquivos, resultado medido.

- **25/09/2026 — F2, medição do piloto** (somente leitura, 14 dias, Bancário - Comercial, que é a conexão PADRÃO da conta): 1.649 mensagens `from_device` contra 184 digitadas no CRM; cerca de 1/3 das `from_device` é MÁQUINA (a Kommo e o Make pelo celular pareado: saudação `*CB Advogados:*`, follow-up do formulário "Opa! Você acabou de acessar…", lembretes), a qualquer hora e no fim de semana. A saudação responde todo lead que escreve primeiro em ~7 s pelo relógio do banco — DENTRO da espera de rajada de 8 s. Das 86 conversas novas, a entrada atenderia ~7 (58 recebem mensagem de sistema antes do cliente). **Conclusão: o piloto nesta conexão só depois do corte da Kommo e do Make** (com eles, a triagem seria pausada ou responderia em dobro). Volume esperado depois do corte: ~5 conversas novas elegíveis por dia; ~2.064 mensagens de cliente em 14 dias; custo teto estimado (tudo atendido, Gemini 3.7 Flash) ~US$ 16/mês. Nenhuma automação de nova mensagem, palavra-chave ou primeira mensagem existe na conta (nem inativa).
- **25/09/2026 — F0, medição do Asaas** (somente leitura, pelo `supabase-cb`): 432 parcelas devidas (`OVERDUE`/`PENDING`, não apagadas) no espelho — 406 por boleto, 20 por cartão de crédito, 6 com a forma indefinida; **todas com `link_fatura`**; sem `link_boleto` ficam exatamente as 20 de cartão. A 2ª via da D6 tem link em toda parcela devida. A ferramenta `consultar_cobrancas` oferece a fatura sempre e o boleto quando houver. Na mesma consulta: `ai_configs` com 1 linha, `ai_usage_log` com 1.881, base de conhecimento vazia, e a Bancário - Comercial é `f2f9820b-3cbe-4581-870b-92415fd547aa` (Evolution).

---

## 10. O que mudou da v1 para a v2 (revisão de 24/09/2026)

Duas revisões independentes — uma conferindo cada citação contra o código, outra conferindo o desenho contra as decisões D1–D15 e as regras do projeto. O que mudou:

- **O passo que atribui agente é NOVO**, e não o `set_ai`: o de hoje apaga o responsável humano ao ligar a IA, e o "Retomar IA" também. Os dois achados eram graves.
- **"Respondido" (D11):** a resposta da IA é `sender_type = 'bot'`, que as réguas de hoje ignoram — ramo próprio nas três funções do banco e nos dois lugares do Radar, não "uma condição a mais" no gatilho.
- **A pausa por gente foi para o banco** (gatilho), e a API v1 não grava `sender_id` (virou a pergunta P6).
- **O turno virou fila** (`cb_ia_turnos` com `aguardando`/`rodando`): no `after()` ele atrasaria o webhook público `message.received` e o lote da Evolution. A passagem entre agentes fica dentro do mesmo turno (a chave única da v1 impedia gravá-la).
- **O agente ganhou `conexoes`** (vazio = nenhuma), com limpeza ao apagar conexão; a v1 dependia delas sem tê-las.
- **O sinal da origem `ia` foi desenhado:** sem ele, a trilha e o webhook diriam `automacao`/`sistema`.
- **Portão das automações:** de "existe" para "rodou para esta mensagem".
- **Áudio e mídia abrem turno**; na v1, o áudio depois de um texto deixava o cliente sem resposta.
- **Encerrar a conversa zera o agente ativo.**
- **A chave de embeddings** tem destino único (o slot da OpenAI), e a transcrição lê direto a chave do Gemini.
- **`consultar_cobrancas` relê a parcela no Asaas**; `executar_automacao` recusa automação com passo fora da D5; a passagem aparece no fio.
- **A receita do no-show** foi escrita (atribuir no dia 0, "parar se responder" nas esperas seguintes, modelo aprovado na Meta).
- **O "digitando" não pode ser cancelado** na Meta: passou a ser chamado depois da rajada.
- **As fases foram partidas:** F1a (chaves, conferida em produção) separada da F1b; as medições caras foram para a F4a e a F5; a F4 virou leitura/passagem (F4a) e escrita (F4b); o piloto da F2 tem dois agentes.
- **Fatos corrigidos:** 7 conexões (não 6); `ai-config.tsx` só em `/agents`; a aba Uso já perde linhas acima de 1.000; o resumo da transferência é uma coluna, não anotação; a justificativa da P1 usava "quase todo cliente tem responsável", e o medido é 4%; a tabela de arquivos do upstream mora em `docs/MERGE-UPSTREAM.md`.

---

## 11. O que mudou da v2 para a v3 (25/09/2026)

- **As perguntas viraram decisões** (D16–D23): a entrada só atende quem nunca recebeu resposta de gente; "Atribuir agente" retoma salvo resposta de gente em 24 h; a API v1 não pausa; a régua do Asaas pode atribuir; base de conhecimento por agente; custo em R$; piloto na Bancário - Comercial; instruções e regras por agente.
- **Regras por agente** (D23): coluna própria (`regras text[]`), separada das instruções, e o pedido ao modelo ganhou ordem escrita (5.7), com uma montagem só para turno, Playground e rascunho.
- **Custo em R$** (D21): tabela de preço em US$ com vigência por linha, e a cotação informada pelo administrador (`ai_configs.cotacao_dolar`, rota própria).
- **Base por agente** (D20): `cb_ia_agente_documentos`, com "nada marcado = nenhuma base"; sem chave da OpenAI a busca é só por palavras.
- **A rede da fila de turnos** mora no `/api/automations/cron`, a única rota do laço rápido: uma rota nova exigiria `docker stack deploy` manual na VPS.
- **O piloto é Evolution:** sem "digitando" (recurso só da Meta hoje).
- **Revisão final (25/09, 21 achados: 3 graves, 11 médios, 7 menores), incorporada:** a rede da fila entra no TOPO do cron; o recolhedor NÃO re-executa turno (`incerto`, transfere); a F1a lista todo leitor e escritor da chave antiga, cria a linha padrão na primeira chave, remove o `DELETE /api/ai/config` e escreve a janela entre aplicar e publicar; automação não retoma pausa de `'botao'` nem de `'transferencia'`; o agente atribuído pela régua precisa cobrir a conexão dela; `cb_reacender_espera` usa a mensagem que abriu o turno, não a fórmula da 972; a pausa por gente só grava em conversa com agente ativo; o eco do agente é reconhecido pelo id do provedor gravado antes do INSERT; o portão das automações mede "falou com o contato" e inclui a primeira mensagem; áudio dentro da janela de download reagenda; FK composta no agente ativo; a fila por RPC; a base por agente em funções novas; cotação com o aviso de "cotação de hoje"; o carimbo das 24 h da D17; `turno_id` na F2; nome do agente para o `descreverPasso`; medir as mensagens de outro sistema antes do piloto. E uma pergunta nova, a **P8** (a D16 não vê o cliente da Kommo sem conversa).
- **F0 medida:** toda parcela devida tem link de fatura; as 20 sem boleto são de cartão.
- **Codex (25/09, depois de 5 falhas do serviço), três ajustes:** `cb_reacender_espera` condicional e com a conversa travada (não sobrescreve a resposta de um advogado que chegou depois da despedida); `executar_automacao` confere a D5 também na hora de executar, inclusive nas automações acionadas; a conferência de pausa/agente/mensagem nova roda antes de CADA ferramenta com efeito. Nos PRs da F1a e da F1b, dois sobre a chave da OpenAI nos embeddings (a recusada não é usada; a dedicada não se perde na 1042).
