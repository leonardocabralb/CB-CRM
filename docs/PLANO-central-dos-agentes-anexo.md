# Anexo — Central dos agentes: o desenho verificado de cada frente

Detalhe de [`PLANO-central-dos-agentes.md`](PLANO-central-dos-agentes.md).
Cada frente (Painel, Auditoria e Sandbox) foi desenhada por um projetista e
conferida por um verificador adversarial contra o código e as regras, em
26/10/2026. As referências arquivo:linha são dessa data e envelhecem: confira
antes de usar. Onde este anexo diverge do roteiro do plano, **vale o plano**
(seção "Conflitos entre as frentes, já resolvidos"). As decisões aqui citadas
como "D…" da frente foram renumeradas no plano como DC1–DC25.

## Anexo — frente Painel (versão verificada)

Dar ao administrador uma visão de decisão sobre todos os agentes de IA juntos. Ela responde a seis perguntas: quem está ligado e onde atua; o que está acontecendo agora; como terminaram as vezes em que o agente foi chamado; por que ele passa conversas para a equipe; o que ele fez no CRM e o que aconteceu com os cards depois, sem fingir que ele foi a causa; quantas pessoas a retomada trouxe de volta e quanto isso custa em R$. Há recorte por agente, conexão, funil e setor.

A ordem mudou em relação ao projetista. Primeiro vem uma BASE DURÁVEL, gravada antes de o piloto ser ligado: o motivo da transferência numa coluna, um resumo sem texto de cada turno e a soma feita no banco. O motivo é que hoje cb_ia_turnos tem 0 linhas e nenhum gatilho (conferido em 26/10). Feito agora, não há passado para reconstruir a partir do texto do campo “erro”. Feito depois, cada conversa apagada durante o piloto levaria junto os turnos que mais importam para decidir. Em seguida vêm o painel, que lê essa base e o uso já somado (cb_ia_uso), o funil e a retomada, o ao vivo, a poda com prazo (LGPD), o setor e, se o operador quiser, a origem “ia” na trilha.

Contexto medido em 26/10/2026, só leitura, reconferido pelo verificador:
- 5 agentes vivos, 0 ligados e 0 etapas com agente;
- cb_ia_turnos com 0 linhas e sem gatilho;
- 3 abas de Automações;
- última migration aplicada: 1109;
- 37 chamadas de produção e 277 de teste em ai_usage_log;
- cb_ia_turnos, deals e cb_ia_agentes fora do realtime.

Até o piloto, o painel mostra quase só zeros. Isso tem de aparecer como zero real (“nenhum agente ligado”), nunca como “0%”.

### Métricas e capacidades

- **Agentes ligados e onde atuam** — Agente vivo = arquivado_em nulo. Ligado = ativo = true. Para cada um:
- as conexões (conexoes; vazio = NENHUMA);
- as etapas e os funis (cb_ia_agente_etapas → pipeline_stages → pipelines);
- retomada ligada (retomada->>'ativa' = 'true');
- o modelo;
- se está dentro do horário AGORA.
Estados de alerta: ligado sem etapa, ligado sem conexão.
  - Fonte: cb_ia_agentes via listarAgentesComEtapas (repo.ts:115); dentroDoHorario e proximaAbertura (horario.ts:44 e 70)
  - Obs.: Hoje: 5 vivos, 0 ligados, 0 etapas com agente.
- **Território (quem o agente pode atender)** — Cards abertos nas etapas do agente, separados em atendíveis pela D27 (etapa_desde >= greatest(cb_ia_agente_etapas.desde, ativado_em)) e antigos. Agente desligado: nenhum atendível, porque ligar recarimba ativado_em (1049:122-133).
  - Fonte: deals (status, stage_id, etapa_desde), contados com count exact + head; cb_ia_agente_etapas.desde; cb_ia_agentes.ativado_em
  - Obs.: Explica por que um agente ligado não responde: pode ser que só haja card antigo.
- **Atendendo agora** — Por agente:
- Respondendo = status 'rodando'.
- Nova tentativa = 'aguardando' com erro = ERRO_DA_REPETICAO.
- Esperando o horário = 'aguardando' com erro = ERRO_DA_ESPERA_DO_HORARIO.
- Retomadas agendadas = 'aguardando' com tipo 'retomada', e a próxima executar_apos.
- Na fila = o resto de 'aguardando' (rajada, áudio ou mídia, que o banco não distingue).
  - Fonte: cb_ia_turnos (status, tipo, erro, executar_apos, rodando_desde); turno.ts:979 e 2104-2118; horario.ts:42
  - Obs.: Lido pela rota a cada 20 s (PA3).
- **Conversas com o agente agora** — Abertas com ia_agente_id = X e ai_autoreply_disabled = false, separadas em “com mensagem nas últimas 24 h” (last_message_at) e paradas. Pausadas = o mesmo agente com ai_autoreply_disabled = true, por ia_pausada_por.
  - Fonte: conversations (status, ia_agente_id, ai_autoreply_disabled, ia_pausada_por, ia_pausada_em, last_message_at)
  - Obs.: ia_agente_id é o ÚLTIMO agente que respondeu, e só encerrar o zera: sem o recorte de 24 h, conversa dormente contaria como “em conversa”.
- **Transferidas esperando a equipe** — Conversas abertas com ia_pausada_por = 'transferencia' e sem mensagem de gente (régua da 972: sender_type 'agent' com sender_id ou from_device, sem ia_agente_id, NOT nao_saiu) gravada depois de ia_pausada_em, com a espera mais antiga.
  - Fonte: conversations (ia_pausada_por, ia_pausada_em, status); messages (sender_type, sender_id, from_device, ia_agente_id, nao_saiu, gravada_em), sem conteúdo
  - Obs.: Não usa aguardando_desde: a resposta do agente a limpa (1080:93-99), e o “responda e passe” e a reunião não marcada sumiriam da conta.
- **Desfechos por dia** — Contagem de turnos por dia no fuso do escritório (created_at), por status final: respondeu, passou, transferiu, sem_resposta, descartado, pausado_no_meio, falhou, incerto e fora_do_horario (a conexão oficial ainda o produz). Separados em resposta × retomada.
  - Fonte: cb_ia_turnos_resumo e a soma por dia (PA-F0)
  - Obs.: Soma no banco; o servidor não pagina linhas cruas (lição da 1095).
- **Conversas atendidas** — Conversas DISTINTAS, por agente ou da conta, com ao menos um turno tipo 'resposta' que terminou 'respondeu' no período.
  - Fonte: cb_ia_turnos_resumo, pela soma do período (PA-F0)
  - Obs.: Distinto não se soma dia a dia: vem calculado por período. É o denominador da taxa sem a equipe e do custo por conversa.
- **Atendidas sem a equipe (%)** — Conversas atendidas em que, depois da 1ª resposta do agente no período, não houve (i) transferência pelo agente (motivo gravado, incluindo responda e passe, sem_marcador e reunião não marcada) nem (ii) mensagem de gente na MESMA conexão até 72 h depois da última resposta do agente, dividido pelas conversas atendidas. Régua da PA6, opção recomendada.
  - Fonte: cb_ia_turnos_resumo (status, motivo, canal_id, enviando_desde); messages sem conteúdo; soma no banco (PA-F1b)
  - Obs.: Sem conversas atendidas = “—”, nunca 0%. Não é “resolvida”.
- **Transferências por motivo** — Contagem por motivo (sentinela, teto, audio, incerto, link_inventado, reuniao_nao_marcada, reuniao_prometida, agente_passou, pedido_vazado, acao_prometida). Ficam à parte “equipe prometida sem o marcador” (detalhe sem_marcador) e “já estava pausada” (pausado_no_meio, ou a linha transferir com ja_estava).
  - Fonte: cb_ia_turnos.motivo (PA-F0), copiado para o resumo; lista em MOTIVOS_DE_TRANSFERENCIA (textos-do-servidor.ts:32-43)
  - Obs.: Pela coluna, não pelo texto do “erro”: a reunião não marcada não deixa texto nem linha “transferir”.
- **Ações por tipo** — Por tipo (mover_etapa, etiquetar, tirar_etiqueta, preencher_campo, criar_tarefa, executar_automacao, marcar_reuniao, transferir):
- feitas = ok true sem detalhe 'ja_estava';
- já estavam = ok true com 'ja_estava';
- recusadas ou falhas = ok false, por código.
  - Fonte: cb_ia_turnos_resumo.acoes (RegistroDeAcao, acoes.ts:1350-1358; tipos em agente.ts:75-83)
  - Obs.: O valor gravado (campo, título da tarefa) não está no registro, de propósito.
- **Passagens e reuniões marcadas** — Passagens = turnos 'passou'. O destino é o turno seguinte da mesma conversa com veio_de_passagem = true (LEAD por conversa, no banco). Reuniões marcadas = ações marcar_reuniao com ok true.
  - Fonte: cb_ia_turnos_resumo (status, veio_de_passagem, conversation_id, created_at, ia_agente_id, acoes)
  - Obs.: O turno de origem não grava o destino (turno.ts:908, 927): a ligação é pela sequência.
- **Impacto no funil (o que aconteceu depois)** — Cards tocados = deal_id distintos de turnos que responderam, passaram ou transferiram no período. Toque = o 1º desses turnos. Depois do toque: avançou de degrau (alcance monotônico acima do degrau do toque), chegou a reunião, chegou a contrato (ehFechamento), ganhou, perdeu (perdidoDesde) ou ficou parado. Separado em “por ação do agente” (mover_etapa ok, passagem, ou a reunião marcada que a automação do Calendly moveu) e “depois, por outros”. Régua da PA5, opção recomendada.
  - Fonte: cb_ia_turnos_resumo (deal_id, stage_id, pipeline_id, created_at, acoes); trajetórias por carregarTrajetorias (carregar.ts:114, RPC 1078) e os fatos de src/lib/funil/
  - Obs.: Correlação, não causa. Transferido conta no funil de origem. 3 de 7 funis têm degrau; funil sem degrau mostra “configure”. O agente não marca ganho nem perda (D5).
- **Recuperados pela retomada** — Régua A (PA4): série de uma conversa em que uma retomada SAIU e o cliente escreveu na mesma conexão em até 72 h, antes de qualquer mensagem de gente. A resposta é atribuída à última retomada que saiu antes dela. Taxa = recuperados ÷ séries com ao menos uma retomada enviada. Complemento C: recuperados cujo card avançou de degrau ou teve reunião depois. Custo por recuperado = custo dos turnos de retomada (uso ligado por turno_id) ÷ recuperados.
  - Fonte: cb_ia_turnos_resumo (tipo, tentativa, status, terminado_em, canal_id, conversation_id); messages sem conteúdo; ai_usage_log.turno_id; soma no banco (PA-F1b)
  - Obs.: Hoje há 0 retomadas enviadas. O descarte com 'o cliente escreveu antes da retomada' também sai quando a triagem passa a conversa (1056:105): não serve como sinal.
- **Tempo da resposta** — Espera do cliente = enviando_desde − created_at do turno de resposta que respondeu (created_at é a 1ª mensagem da rajada, e o enfileiramento não o muda: 1050:41-50). Tempo da última rodada = enviando_desde − rodando_desde (leitura de mídia, geração e conferências). Mediana e p90 calculados no banco por período; faixas por dia.
  - Fonte: cb_ia_turnos_resumo (created_at, rodando_desde, enviando_desde, esperou_horario, veio_de_passagem)
  - Obs.: Turnos vindos de passagem ficam fora da espera (o created_at deles é o da passagem). “Esperou o horário” fica em faixa própria. Percentil não se soma por dia.
- **Custo em R$** — Por agente e por dia: a soma da cb_ia_uso (mode 'agente', com a faixa do pedido) pelo preço do dia (custoEmDolar) × a cotação de hoje (emReais). Custo por conversa atendida = custo do agente ÷ conversas atendidas dele.
  - Fonte: cb_ia_uso (1108; a leitura paginada da rota de Uso, route.ts:31-55); precos.ts:33, 122 e 140; ai_configs.cotacao_dolar
  - Obs.: Estimativa (D21). Transcrição e leitura de mídia são custo da conta (D15). Modelo sem preço = “sem preço”, nunca zero. Não se recorta por conexão nem por funil.
- **Saúde: falhas e envios incertos** — Turnos 'falhou' (configuração ou provedor: E8, não transferem) e 'incerto' (envio sem confirmação: transfere) no período e nas últimas 24 h, com link para a aba Turnos do agente.
  - Fonte: cb_ia_turnos_resumo (status, ia_agente_id)
  - Obs.: O texto do erro nunca sai da rota; a tela mostra o código traduzido.
- **Recorte por setor** — PA-F1a: por conexão (canal_id) e por funil (pipeline_id do resumo). PA-F4: por cb_ia_agentes.area_id (abas das Automações; nulo = Geral), o setor ATUAL do agente.
  - Fonte: cb_ia_turnos_resumo; cb_areas_de_automacao (1055); areaDoFunil (areas.ts:98) como sugestão
  - Obs.: Agente com etapas em dois funis aparece nos dois recortes de funil.

### Telas

- **Painel dos agentes** (/agents, aba “Painel” (primeira e padrão; ?vista=painel&agente=<id>, sob Suspense); Só administrador (D14, PA2), pelo RequireRole admin da página. O membro vê “só administradores”, nunca “nenhum agente”.)
  - Filtros: período (Hoje, 7, 30, 90 dias, no fuso do escritório), agente, conexão (some com menos de 2), funil e setor (PA-F4)
  - Faixa “Agora” (PA-F2): por agente ligado — Respondendo, Na fila, Nova tentativa, Esperando o horário (abre às…), Retomadas agendadas, Abertas com ele (ativas em 24 h × paradas) e Pausadas. Cartão “Transferidas esperando a equipe”. “Atualizado há N s”, “não atualizado desde…” na falha, e o botão Atualizar.
  - Agentes: cartões com estado (ligado, desligado, sem etapa, sem conexão, fora do horário), modelo, conexões, funis e etapas, retomada e território (atendíveis × antigos; desligado = nenhum até ligar). Links “Ver turnos” (abre na aba Turnos) e “Ver no painel”.
  - Cartões do período: conversas atendidas, respostas enviadas, atendidas sem a equipe (%), transferências, recuperados, falhas e incertos
  - Desfechos por dia: barras empilhadas (Tremor BarChart type="stacked"), chave Respostas | Retomadas
  - Por que transferiu: barras deitadas por motivo (layout="vertical"), com “equipe prometida sem o marcador” e “já estava pausada” à parte
  - O que o agente fez: barras deitadas empilhadas (feitas × já estavam × recusadas) por tipo; tabela das passagens origem → destino; reuniões marcadas
  - Funil depois do agente (PA-F1b): barras deitadas (tocados → avançaram de degrau → reunião → contrato; ganharam, perderam, parados), separadas em “por ação do agente” × “depois, por outros”; nota “não prova causa”; “configure os degraus” no funil sem degrau
  - Retomada (PA-F1b): recuperados, taxa, barras agrupadas por tentativa (enviadas × respostas atribuídas), “… e o card avançou”, custo das retomadas por recuperado (e a parte não atribuída)
  - Tempo da resposta: mediana e p90 (espera do cliente e última rodada) e barras por faixa, com “esperou o horário” à parte e turnos de passagem fora
  - Custo: R$ por dia e por agente (barras empilhadas), custo por conversa atendida; avisos de cotação, “sem preço” e “o custo é por agente” com filtro de conexão ou funil
  - Últimas vezes que os agentes foram chamados (PA-F2): 20 linhas de todos os agentes, com link para a conversa
- **Lista de agentes (ajuste)** (/agents, aba “Agentes”; Só administrador)
  - Link “Ver no painel” em cada cartão (abre o Painel filtrado pelo agente)
  - Chip de setor (PA-F4)
- **Detalhe do agente (ajuste)** (/agents/[id]; Só administrador)
  - Aba inicial por ?aba= (para “Ver turnos” cair direto em Turnos)
  - Seletor “Setor” na Configuração (PA-F4), com as abas das Automações; vazio = Geral; sugestão pelo nome do funil das etapas
  - Ajuda da aba Turnos com o prazo de 90 dias (PA-F3)

### Fases da frente

#### PA-F0 — Base durável: motivo gravado, resumo de cada turno e soma no banco (antes de ligar o piloto) (M (2–3 dias))

**Objetivo:** Gravar o que o painel vai contar antes do primeiro turno de produção. O lugar tem de sobreviver à conversa apagada, à Lixeira e à poda, e a soma tem de sair do banco. É o molde da cb_ia_uso (1108) e da 1095, que diz com todas as letras: “paginar não serve” para painel, porque 30 dias davam 26 páginas em fila.

**Entregas:**
- Coluna cb_ia_turnos.motivo, gravada pelo turno em todo caminho que transfere ou pede a equipe. (1) O “transferiu” (gravarNoTurno, turno.ts:2144-2156). (2) Os dois caminhos de “respondeu” que transferem depois: a reunião não marcada (turno.ts:1561-1571) e o “responda e passe”, inclusive a equipe prometida sem o marcador (turno.ts:1593-1611). (3) O pausado_no_meio (turno.ts:2183-2193), que guarda o motivo pedido. Atenção: a reunião não marcada não deixa linha “transferir” nas ações nem texto no “erro”. Se o motivo fosse lido do texto, como o projetista previa, ela sumiria do painel.
- Tabela cb_ia_turnos_resumo, uma linha por turno, sem texto, mantida por gatilho em cb_ia_turnos. Ela sobrevive à conversa apagada, à Lixeira e à poda.
- Somas feitas no banco, em funções que só o servidor chama. Por dia, no fuso do escritório: as contagens por agente, conexão, funil, tipo, status e motivo, e as faixas de tempo. Por período, o que não se soma dia a dia: conversas e cards distintos, mediana e p90 dos tempos (percentile_cont), pares de passagem origem → destino (LEAD por conversa) e ações por tipo, ok e código.
- Índice parcial em cb_ia_turnos (terminado_em), que a poda da PA-F3 vai usar.
- O gatilho novo declarado em cb_lixeira_tratamento(), na lista “livres”. cb_ia_turnos está entre as tabelas cujos gatilhos a restauração confere, por causa dos ponteiros “reaponta” de mensagem_inicial_id e mensagem_gatilho_id (1102). Gatilho não declarado faz TODA restauração da Lixeira falhar com lixeira_sem_tratamento:gatilho (1097:853-880, chamada em 1097:1168).

**Arquivos:**
- supabase/migrations/NNNN_cb_ia_resumo_dos_turnos.sql (número = maior do main + 1, conferido na hora com ls, list_migrations e as worktrees; hoje seria 1110)
- supabase/migrations/ia-resumo-dos-turnos-NNNN.test.ts (pino)
- supabase/migrations/anotacao-com-anexos-1102.test.ts e lixeira-1097.test.ts (atualizar se cobrarem a lista vigente de “livres”)
- src/lib/ia-agentes/turno.ts (grava o motivo nos cinco caminhos)
- src/lib/ia-agentes/textos-do-servidor.ts (MOTIVOS_DE_TRANSFERENCIA continua a fonte; o CHECK é cobrado contra ela)
- docs/MIGRATIONS-APLICADAS.md
- docs/PLANO-central-dos-agentes.md (plano vivo da frente, com Estado e diário)
- [NOVO] .claude/rules/ia-painel.md, com uma linha no índice da seção 13 do CLAUDE.md (hoje 37.088 de 40.960 bytes). ⚠️ .claude/rules/ia.md está com 25.591 de 25.600 bytes (instrucoes.test.ts): nada novo cabe lá.

**Migration:** ADITIVA. Aplicar ANTES do deploy (o app novo grava o motivo e lê o resumo e as somas) e ANTES de ligar o piloto.

(1) cb_ia_turnos.motivo, do tipo text, com CHECK nomeado: nulo ou um dos MOTIVOS_DE_TRANSFERENCIA (textos-do-servidor.ts:32-43). Com SET LOCAL lock_timeout.

(2) CREATE TABLE cb_ia_turnos_resumo.
- turno_id: uuid, chave primária, SEM FK.
- account_id: FK para accounts, ON DELETE CASCADE.
- ia_agente_id: FK composta para cb_ia_agentes(id, account_id), ON DELETE SET NULL (ia_agente_id), mais ia_agente_nome congelado.
- canal_id: FK composta para cb_channels(id, account_id), ON DELETE SET NULL (canal_id), mais canal_nome congelado.
- conversation_id, deal_id, stage_id e pipeline_id: SEM FK, de propósito (ver os riscos de LGPD e de união de fichas).
- tipo, tentativa, tentativas, status, motivo, veio_de_passagem e esperou_horario.
- acoes (jsonb) só com tipo, ok, erro (código de lista fechada), detalhe e alvo {id, nome}. Nunca o valor gravado.
- tokens_entrada, tokens_saida, tokens_total, created_at, rodando_desde, enviando_desde e terminado_em.
Índices: (account_id, created_at), (account_id, ia_agente_id, created_at DESC), (conversation_id) e (deal_id) parcial. RLS ligada e nenhuma policy. REVOKE ALL FROM PUBLIC, anon, authenticated e GRANT ALL ao service_role (PA2 (a)). Se a PA2 for (b), entra uma policy de SELECT só de admin, na forma da 1032.

(3) Função cb_ia_resumir_turno(), SECURITY DEFINER, com search_path fixo. Gatilho AFTER INSERT OR UPDATE OF status, erro, motivo, acoes, conversation_id, deal_id ON cb_ia_turnos, WHEN (status final OU erro = ERRO_DA_ESPERA_DO_HORARIO). Faz upsert por turno_id, acumula esperou_horario com OR e nunca copia erro nem contexto.
- São vários escritores: turno.ts, o recolhedor, cb_encerrar_limpa_ia, os descartes da 1056, apagar conexão e cb_unir_fichas. É a lição da 972: a regra mora no banco.
- O UPDATE OF de conversation_id e deal_id é o que leva ao resumo a união de fichas, que reaponta cb_ia_turnos por UPDATE, sem FK (1093:474 e 634).
- A lista de colunas deixa de fora mensagem_inicial_id e mensagem_gatilho_id, que a Lixeira escreve. Por isso o gatilho cabe em “livres”.
REVOKE EXECUTE FROM PUBLIC, anon, authenticated.

(4) CREATE OR REPLACE de cb_lixeira_tratamento() com o texto VIGENTE da 1102 inteiro, mais “cb_ia_turnos.<nome do gatilho>” em “livres”.

(5) Índice parcial cb_ia_turnos (terminado_em) WHERE terminado_em IS NOT NULL.

(6) Cópia dos turnos já terminados. Hoje são 0: RAISE NOTICE.

(7) Funções de soma SECURITY INVOKER STABLE: cb_ia_painel_por_dia(p_account_id, p_desde, p_fuso DEFAULT 'America/Sao_Paulo') e cb_ia_painel_do_periodo(…) (distintos, percentis, passagens, ações). A ordem é TOTAL pelas chaves do grupo (a lição da 1108). REVOKE de PUBLIC, anon e authenticated; GRANT EXECUTE e SELECT no resumo ao service_role.

(8) Conferência que roda em banco vazio:
- catálogo;
- privilégios: anon e authenticated sem nada, service_role com tudo;
- as funções CHAMADAS com uma conta zerada;
- PERFORM public.cb_lixeira_conferir_gatilhos() (molde da 1102:506);
- o gatilho provado num subbloco desfeito por SQLSTATE próprio quando houver conta e conversa (senão, NOTICE).
O resumo não tem FK para tabela do fecho da Lixeira, então fica fora do default-deny de cb_lixeira_tratamento() e de cb_unir_fichas. O pino reprova quem acrescentar uma FK assim sem tratar a Lixeira e a união no mesmo PR.

**Riscos:**
- Mexe na lista da Lixeira, que é função crítica: o CREATE OR REPLACE leva o texto vigente inteiro, sem perder linha. A conferência e o pino da 1102 acusam divergência.
- LGPD: o resumo guarda conversation_id e deal_id. Depois do “Excluir agora” a conversa some, mas o card fica: deals.contact_id é ponteiro anulado, não apagado (1102), e o título do card é o nome da pessoa (decisão do operador). O resumo continua ligável a ela pelo card. O prazo e a opção de anular os ids na exclusão estão na PA8.
- União de fichas: um resumo cujo turno detalhado já foi podado (PA-F3) fica com o id da conversa que saiu. Contar conversas distintas num período longo pode contar duas vezes a pessoa unida. Limite escrito; só tratar na cb_unir_fichas se a medição mostrar que importa.
- Uma escrita a mais a cada mudança de status do turno (dezenas a centenas por dia).
- doc-acompanha: commit com 'Doc-inalterada: só grava o motivo e o resumo; o agente não muda de comportamento'.

**Testes:**
- Pino da migration:
  - o CHECK do motivo é igual à lista em TS;
  - o marcador no SQL é igual a ERRO_DA_ESPERA_DO_HORARIO (horario.ts:42);
  - o gatilho não menciona erro nem contexto;
  - nenhuma FK do resumo aponta para conversations, messages, contacts ou deals;
  - o gatilho está em “livres” da última cb_lixeira_tratamento();
  - REVOKE e GRANT nas duas metades.
- Unidade (turno): o motivo é gravado nos cinco caminhos. Na mesma resposta, reunião não marcada mais “responda e passe” fica com reuniao_nao_marcada, e a linha “transferir” sai com detalhe ja_estava.
- Postgres descartável COM dado e com as restrições reais:
  - transferiu → pausado_no_meio atualiza o resumo;
  - apagar a conversa mantém o resumo;
  - mover para a Lixeira E RESTAURAR um contato com turnos funciona, sem lixeira_sem_tratamento;
  - cb_unir_fichas leva o conversation_id e o deal_id novos ao resumo;
  - apagar a conexão anula canal_id e mantém canal_nome;
  - as funções de soma, chamadas pelo caminho do PostgREST (o tipo dos argumentos).
- Replay verde do CI no commit exato. Aplicar com autorização do operador. Depois, a entrada em docs/MIGRATIONS-APLICADAS.md.

#### PA-F1a — Painel: agentes, desfechos, transferências, ações, tempo e custo (lendo a base da PA-F0 e o cb_ia_uso) (M (2–3 dias))

**Objetivo:** Entregar a primeira visão consolidada de todos os agentes, com gráficos e filtros. Toda soma vem do banco: as funções da PA-F0 e a cb_ia_uso (1108), que já soma o uso por dia, agente, modelo e faixa. O servidor não pagina linhas cruas.

**Entregas:**
- Aba “Painel” em /agents, a primeira e a padrão, dentro do RequireRole admin que a página já tem. Ela herda protectedPaths (middleware.ts:80), pageTitles (header.tsx:61), o menu (sidebar.tsx:144) e o catálogo de perfis (catalogo.ts:30 e 90); poderes.ts:155 continua “admin”. O link direto ?vista=painel&agente=<id> exige useSearchParams sob Suspense, no molde de settings/page.tsx:34-45 e pipelines/page.tsx:102-110: hoje a vista é useState (agents/page.tsx:26).
- Filtros: período (Hoje, 7, 30 e 90 dias, contados no fuso do escritório no servidor, com diaNoFuso e paraInstante), agente, conexão (o seletor some com menos de 2; vazio = todas) e funil.
- Bloco “Agentes”: um cartão por agente vivo. Mostra:
  - o estado: Ligado, Desligado, Ligado sem etapa, Ligado sem conexão, ou “Ligado, fora do horário — abre às HH:MM” (dentroDoHorario e proximaAbertura, horario.ts:44 e 70);
  - modelo, conexões, funis e etapas;
  - se a retomada está ligada;
  - o território: cards abertos nas etapas, separados em atendíveis pela D27 e antigos. Agente DESLIGADO mostra “nenhum atendível até ligar”, porque ligar recarimba ativado_em (1049:122-133).
- Cartões do período: vezes chamado, respostas enviadas, conversas atendidas (distintas, vindas do banco), transferências, falhas e envios incertos (em vermelho, com link para Turnos). Bloco que não carregou diz “não foi possível carregar”, nunca zero. Taxa sem denominador aparece como “—”.
- Gráfico “Desfechos por dia”: barras empilhadas do BarChart do Tremor vendorizado (type="stacked", bar-chart.tsx:559), com a chave Respostas | Retomadas. O fora_do_horario aparece: a conexão oficial ainda o produz quando a janela da Meta fecha antes da abertura (ia-agentes-turno.md).
- Gráfico “Por que transferiu”: barras deitadas (layout="vertical"), uma por motivo, lido da coluna motivo. Ficam à parte “equipe prometida sem o marcador” (detalhe sem_marcador) e “já estava pausada” (pausado_no_meio, e a linha “transferir” com ja_estava).
- Gráfico “O que o agente fez”: por tipo de ação, barras deitadas empilhadas em feitas, já estavam e recusadas. Embaixo, a tabela das passagens origem → destino e o contador de reuniões marcadas.
- Bloco “Tempo da resposta”: mediana e p90, calculados no banco por período, da espera do cliente e do tempo da última rodada, com barras por faixa. Turnos que vieram de passagem ficam fora da espera (o created_at deles é o da passagem). “Esperou o horário” fica numa faixa própria (esperou_horario do resumo).
- Bloco “Custo”: R$ por dia e por agente, a partir de cb_ia_uso (mode “agente”), reusando a leitura paginada da rota de Uso e resumirUso/precos.ts; e o custo por conversa atendida. Com filtro de conexão ou de funil, o bloco avisa que o custo é por agente. “Sem preço” e “sem cotação” aparecem como texto, nunca como zero (D21: cotação de hoje).
- Recarga: trocar de filtro faz uma carga nova, e a resposta atrasada é descartada pela chave do pedido. Ao voltar para o app, os blocos do período PISCAM o carregando, porque afirmam números (molde do Desempenho e da Saúde, ao-voltar.md). A tela entra no pino ao-voltar.test.ts.
- “Ver no painel” em cada cartão da lista. “Ver turnos” abre o detalhe do agente já na aba Turnos (?aba=turnos); hoje essa aba também é useState (detalhe-do-agente.tsx:46).

**Arquivos:**
- src/lib/ia-agentes/painel.ts (novo, puro: estado do agente, faixas e montagem dos blocos a partir das linhas das somas; nulo = “—”)
- src/lib/ia-agentes/painel.test.ts (novo)
- src/lib/ia-agentes/painel-leitura.ts (novo, I/O): as somas da PA-F0, cb_ia_uso, onde atuam (listarAgentesComEtapas, repo.ts:115), contagem de cards com count exact + head. Consultas em série ou com paralelismo pequeno.
- Leitura do uso: lerUsoInteiro sai de src/app/api/cb/ia/uso/route.ts:31-55 para um módulo compartilhado (dois chamadores: a rota do Uso e a do Painel)
- src/app/api/cb/ia/painel/route.ts (novo): GET, requireRole('admin'), checkRateLimit (como a rota de Uso), supabaseAdmin, .eq('account_id', ctx.accountId) em toda consulta. Bloco que não deu para ler inteiro vale null.
- src/app/api/cb/ia/painel/route.test.ts (novo)
- src/components/agentes-de-ia/painel-dos-agentes.tsx, painel-graficos.tsx (Tremor; recharts direto só para linha ou área, molde de grafico-de-entradas.tsx) e painel-agentes.tsx (novos)
- src/app/(dashboard)/agents/page.tsx (aba nova e Suspense)
- src/app/(dashboard)/agents/[id]/page.tsx e src/components/agentes-de-ia/detalhe-do-agente.tsx (aba inicial por ?aba=)
- src/components/agentes-de-ia/lista-de-agentes.tsx
- src/components/agentes-de-ia/textos.ts (chaves montadas de motivo, faixa, estado e tipo de ação)
- messages/pt-BR.json e messages/en.json (IaAgentes.painel.*)
- src/lib/celular/ao-voltar.test.ts e [REGRA] .claude/rules/ao-voltar.md (paths)
- docs/MERGE-UPSTREAM.md: ATUALIZAR a linha 560, que já diz que agents/page.tsx é nossa inteira. Não acrescentar linha nova.
- [REGRA] .claude/rules/ia-painel.md e docs/PLANO-central-dos-agentes.md

**Depende de:** PA-F0

**Riscos:**
- Até o piloto quase tudo é zero: o valor aparece quando houver agente ligado (o piloto depende do corte da Kommo).
- O banco tem teto de 60 conexões (incidente de 13/10): as consultas vão em série ou com paralelismo pequeno, nunca dezenas de uma vez.
- React Compiler: nada de Date.now() no render. A cor de cada agente sai de uma lista de classes LITERAIS (chart-colors), por índice.
- O custo é por agente: com filtro de conexão ou de funil ele não se recorta, porque o uso não guarda funil e o vínculo uso → turno se perde quando o turno é apagado.
- “Ver turnos” leva às 50 últimas (TURNOS_NA_TELA): a falha pode não estar entre elas até a frente de auditoria trazer filtro.

**Testes:**
- Unidade:
  - zero itens dá null (“—”), nunca 0;
  - estado do agente: desligado, sem etapa, sem conexão, fora do horário com a próxima abertura;
  - território do desligado = nenhum atendível;
  - faixas de tempo;
  - ações: ja_estava não conta como feita, e tipo desconhecido não quebra (a lista é agente.ts:75-83 mais “transferir”).
- Rota:
  - não-admin recebe 403;
  - toda consulta tem account_id (dublê que registra os filtros);
  - páginas da soma juntadas sem repetir;
  - passou do teto de páginas = bloco null;
  - “erro” e “contexto” nunca saem;
  - teto por minuto.
- i18n: teste que lê os dois dicionários para cada chave montada nova.
- npm run typecheck, lint e test em Node 22, e npm run build (sem o erro de Suspense do useSearchParams).
- E2E no preview, a 1440×900 e a 375 px:
  - /agents abre no Painel;
  - com 0 ligados aparece “Nenhum agente ligado”, não 0%;
  - trocar filtro não pisca dado de outro filtro;
  - sem rolagem horizontal;
  - ?vista=painel&agente= e “Ver turnos” abrem no lugar certo.
  Totais conferidos contra SELECT direto pelo supabase-cb: count por status no resumo e soma da cb_ia_uso.

#### PA-F1b — Atendidas sem a equipe, recuperados pela retomada e impacto no funil (M (3 dias))

**Objetivo:** Responder às três perguntas de decisão do operador: quanto o agente resolve sem gente, quantas pessoas a retomada traz de volta e o que acontece com o card depois de o agente atuar. A atribuição é honesta: mostra o que aconteceu depois, nunca “causado por”. As duas réguas sobre mensagens são somadas no banco (molde da 1095), sem paginar messages no servidor. O funil reusa a carga de trajetórias que o Desempenho já usa.

**Entregas:**
- Cartão “Atendidas sem a equipe” (%), por agente, com a régua da PA6. O rótulo nunca diz “resolvidas”.
- Bloco “Retomada”: recuperados (régua da PA4); taxa sobre as séries que tiveram ao menos uma retomada enviada; barras agrupadas por tentativa (enviadas na k × respostas atribuídas à k). Ao lado, “… e o card avançou” e o custo das retomadas por recuperado. Esse custo é o uso ligado por turno_id aos turnos de retomada; a parte sem vínculo aparece como “não atribuída”.
- Bloco “Funil depois do agente” (régua da PA5): cards atendidos no período e, depois do primeiro toque, quantos avançaram de degrau, chegaram a reunião ou contrato, ganharam, perderam ou pararam. Barras deitadas, separadas em “por ação do agente” (mover etapa, passagem, ou a reunião que ele marcou e a automação do Calendly moveu) e “depois, por outros”. Funil sem degrau mostra “configure os degraus”, com link para Gerenciar funil. O cálculo usa carregarTrajetorias (src/lib/funil/carregar.ts:114, a RPC 1078) e os fatos do funil comercial: degrau monotônico, transferido conta no funil de origem, perda datada por perdidoDesde. Nada de leitor novo da trilha.
- Nota fixa: “o que aconteceu depois não prova que foi o agente”.

**Arquivos:**
- supabase/migrations/NNNN_cb_ia_painel_das_conversas.sql (número = maior do main + 1, na hora) e o pino dela
- src/lib/ia-agentes/painel-impacto.ts (novo, puro, sobre as trajetórias e as funções de src/lib/funil/: classificarEtapas, indiceDoDegrau, ehFechamento) e o teste
- src/lib/ia-agentes/painel-leitura.ts (a função nova; trajetórias só dos funis com card tocado, com o funil conferido na conta)
- src/app/api/cb/ia/painel/route.ts (blocos novos)
- src/components/agentes-de-ia/painel-funil.tsx e painel-retomada.tsx (novos)
- messages/pt-BR.json e messages/en.json
- docs/MIGRATIONS-APLICADAS.md

**Migration:** ADITIVA, aplicada antes do deploy. Função SECURITY INVOKER STABLE (molde da 1095) sobre cb_ia_turnos_resumo e messages, sem nunca ler content_text. Ela devolve, por agente:
- conversas atendidas e atendidas sem a equipe (PA6);
- séries com retomada enviada e recuperados por tentativa (PA4);
- a lista curta (deal_id, instante) dos recuperados, para o complemento C;
- o uso ligado por turno_id aos turnos de retomada (provedor, modelo, faixa, dia e tokens), para o custo das retomadas.
“Mensagem de gente” usa a régua da 972/1080:93-95: sender_type 'agent' com sender_id ou from_device, sem ia_agente_id, NOT nao_saiu. “Cliente” = sender_type 'customer', e a mensagem apagada conta. As duas comparações são na MESMA conexão do turno (channel_id = canal_id).
REVOKE e GRANT nas duas metades. A conferência CHAMA a função com uma conta zerada e prova os casos num subbloco desfeito por SQLSTATE próprio quando houver dado; senão, NOTICE. EXPLAIN no descartável com volume real.

**Depende de:** PA-F0, PA-F1a

**Riscos:**
- Correlação não é causa: o texto da tela tem de dizer isso. A PA5 decide se entra comparação.
- Só 3 de 7 funis têm degrau: o impacto fica parcial até o operador mapear.
- A carga das trajetórias por funil é a mesma do Desempenho (segundos por funil grande); só os funis com card tocado são lidos.
- Mudar a régua (PA4 ou PA6) exige migration nova: a régua mora no banco, com pino.
- Conversa excluída leva as mensagens: o resumo mantém o turno, mas “sem a equipe” e “recuperados” perdem o caso. “Respondeu” não distingue “não tenho interesse”, e é por isso que a régua C existe.

**Testes:**
- Recuperados:
  - a retomada 2/6 respondida em 3 h conta, atribuída à ÚLTIMA retomada que saiu antes da resposta;
  - não contam: quem respondeu à mensagem normal (a 1/n descartada com 'o cliente escreveu antes da retomada', 1056:106-108), a equipe que escreveu antes do cliente, a resposta depois de 72 h e a resposta por outra conexão;
  - a mensagem apagada do cliente conta.
- Sem a equipe:
  - contam como “precisou”: transferência pela trava, '[[TRANSFERIR]]' e reunião não marcada (pela coluna motivo); mensagem de gente na MESMA conexão (celular ou agendada) até 72 h depois da última resposta do agente;
  - não contam: mensagem de gente por outra conexão, a linha nao_saiu, a resposta do próprio agente (bot com ia_agente_id).
- Impacto:
  - triagem → especialista no mesmo degrau não é avanço;
  - ganho depois do toque é “ganhou depois” (o agente não marca ganho, D5);
  - card transferido de funil conta no de origem;
  - funil sem degrau aparece como “configure”, nunca como zero.
- Rota: account_id em toda consulta; o funil das trajetórias é conferido na conta.
- E2E no preview: blocos vazios com a frase certa. Conferência por SQL das retomadas enviadas e das mensagens de cliente depois delas.

#### PA-F2 — Ao vivo: o que os agentes estão fazendo agora (sem migration) (P (1 dia))

**Objetivo:** Mostrar o trabalho dos agentes em andamento, atualizado sozinho, sem abrir cb_ia_turnos ao navegador (D14). Os estados são classificados pelos marcadores que o banco grava, nunca por intervalos de tempo.

**Entregas:**
- Faixa “Agora” no topo do Painel, por agente ligado:
  - Respondendo: rodando, há N s.
  - Na fila: aguardando sem marca. É rajada, áudio ou mídia, e o banco não os distingue: o reagendamento limpa o erro e a posse (turno.ts:2104-2118).
  - Nova tentativa: erro = ERRO_DA_REPETICAO (turno.ts:979).
  - Esperando o horário: erro = ERRO_DA_ESPERA_DO_HORARIO; abre às…
  - Retomadas agendadas: tipo 'retomada', quantas e a próxima às…
  - Abertas em que ele foi o último a responder: separadas em “com mensagem nas últimas 24 h” (last_message_at) e paradas. Só encerrar zera ia_agente_id; sem esse recorte, conversa dormente contaria como “em conversa”.
  - Pausadas, por motivo.
- Cartão da conta “Transferidas esperando a equipe”: conversas abertas com ia_pausada_por = 'transferencia' e SEM mensagem de gente (régua da 972) gravada depois de ia_pausada_em, com a espera mais antiga. Não pode ser pela aguardando_desde: a resposta do agente a limpa (1080:93-99), e ficariam de fora o “responda e passe” e a reunião não marcada, justamente os casos em que o cliente leu “a equipe vai te retornar”.
- Lista das últimas 20 vezes que algum agente foi chamado: desfecho, agente, conexão, contato (nomeDoContato/identidadeDoContato; Contact.phone pode ser nulo) com link para a conversa, ações em ícones, há quanto tempo.
- Recarga a cada 20 s com a aba visível; pausa com a aba oculta. Ao voltar para o app, ESTA faixa recarrega em silêncio, com “Atualizado há N s” e o botão Atualizar. Recarga que falha mostra “não atualizado desde HH:MM”, nunca o estado velho como atual.

**Arquivos:**
- src/app/api/cb/ia/painel/ao-vivo/route.ts (novo; admin; só status aguardando ou rodando, os 20 últimos terminados e as conversas; sem erro nem contexto crus) e o teste
- src/lib/ia-agentes/painel-ao-vivo.ts (novo, puro: classificação pelos marcadores) e o teste
- src/hooks/use-painel-ao-vivo.ts (novo)
- src/components/agentes-de-ia/painel-ao-vivo.tsx (novo)
- src/lib/celular/ao-voltar.test.ts e [REGRA] .claude/rules/ao-voltar.md (paths)
- messages/pt-BR.json e messages/en.json

**Depende de:** PA-F1a

**Riscos:**
- Custo: 3 pedidos por minuto por aba de admin, cada um com ~5 consultas leves. Desprezível na escala da conta.
- Até 20 s de atraso. O cron roda a cada ~15 s: mais rápido não mostra nada novo.
- Achado para o operador, que esta frente não muda: depois de um “responda e passe”, a resposta do agente limpa a espera e a transferência não a reacende (E7). O cliente que leu “a equipe vai te retornar” fica fora do alerta de atraso. Levar como pergunta própria.
- O link da lista abre a conversa e zera as não lidas: no teste, só o lead autorizado.

**Testes:**
- Unidade: classificação (marca de repetição, de horário, retomada, sem marca); “há N s” pelo relógio do tique; transferida com “responda e passe” conta; mensagem de gente depois da pausa a tira; mensagem de gente por outra conexão também tira (a equipe pegou a pessoa).
- Rota: admin; account_id; nada de “erro” ou “contexto” na resposta.
- E2E no preview: com a aba oculta não sai pedido novo (conferir pela rede, porque no Browser pane oculto os timers ficam lentos). Volta depois de 30 s recarrega em silêncio. Com autorização do operador, um turno real no lead de teste autorizado (webhook local e vigia do cron, como em 25 e 26/10) aparece Respondendo e depois Respondeu em até 20 s. Isso grava em dado real, então limpa no fim.

#### PA-F3 — Poda com prazo (LGPD) (P (1 dia))

**Objetivo:** Dar prazo ao dado de cliente guardado nos turnos detalhados (o contexto, o “erro” com até 1.000 caracteres do texto retido, as ações) e ao resumo, sem perder a métrica, que já mora no resumo desde a PA-F0.

**Entregas:**
- Rota de poda: apaga em lotes os cb_ia_turnos terminados há mais de 90 dias (só status final; usa o índice de terminado_em da PA-F0) e o resumo além do prazo da PA8. Ao apagar o turno, ai_usage_log.turno_id vira nulo e o custo fica.
- A rota entra no laço LENTO do agendador (docker-stack.yml:157). Ela só vale depois do docker stack deploy manual, com as três linhas e lendo docs/INFRA-VPS.md inteiro antes. Conferir depois que a rota rodou.
- A ajuda da aba Turnos passa a dizer que os turnos detalhados ficam 90 dias.

**Arquivos:**
- src/app/api/cb/ia/poda/cron/route.ts (novo, com x-cron-secret) e o teste
- docker-stack.yml (laço lento)
- [REGRA] .claude/rules/ia-painel.md
- docs/PLANO-central-dos-agentes.md

**Depende de:** PA-F0

**Riscos:**
- Encurta a auditoria detalhada: combinar o prazo com a frente de auditoria antes (um prazo só).
- Sem o stack deploy nada poda e nada avisa.
- A poda apaga o que a aba Turnos mostra: o texto da tela tem de dizer o prazo.

**Testes:**
- Rota da poda: idempotente, em lotes, só terminados, por idade. Uma segunda execução não apaga nada novo. O resumo fica. ai_usage_log.turno_id vira nulo.
- E2E: os números do painel antes e depois da poda são iguais.

#### PA-F4 — Setor do agente (migration pequena) (P (1 dia))

**Objetivo:** Dar ao painel o recorte por setor pedido pelo operador (Bancário, Trabalhista, Previdenciário…), com o mesmo vocabulário das abas da tela de Automações e sem nome de setor no código (regra da venda).

**Entregas:**
- Campo “Setor” na Configuração do agente, com as abas de cb_areas_de_automacao (1055; hoje 3 na conta). Vazio = Geral.
- Sugestão inicial pelo nome do funil das etapas do agente (areaDoFunil, src/lib/automations/areas.ts:98), só como sugestão no seletor, sem backfill.
- Chip de setor no cartão do agente; filtro e agrupamento “Setor” no Painel.

**Arquivos:**
- supabase/migrations/NNNN_cb_ia_agente_setor.sql
- src/lib/ia-agentes/agente.ts e src/lib/ia-agentes/repo.ts (COLUNAS_DO_AGENTE com area_id; área de outra conta → 400 area_not_found, molde de ehAreaDeOutraConta, areas.ts:148)
- src/components/agentes-de-ia/configuracao-do-agente.tsx
- src/components/agentes-de-ia/lista-de-agentes.tsx
- src/components/agentes-de-ia/painel-dos-agentes.tsx
- messages/pt-BR.json e messages/en.json

**Migration:** ADITIVA, antes do deploy (COLUNAS_DO_AGENTE passa a pedir a coluna). cb_ia_agentes.area_id uuid, com FK composta (area_id, account_id) → cb_areas_de_automacao(id, account_id) ON DELETE SET NULL (area_id), com a coluna nomeada (a armadilha da 966; molde da 1055:63-74), e índice parcial em area_id. Apagar a aba devolve o agente a Geral. Sem FK para conversa, mensagem ou contato, então fica fora da Lixeira. Conferência: catálogo e a FK existindo; no banco vazio não há dado a provar (NOTICE).

**Depende de:** PA-F1a

**Riscos:**
- O histórico usa o setor ATUAL do agente: mudar o setor reclassifica o passado. Congelar a área no resumo exige uma coluna nova lá e recriar o gatilho da PA-F0. Só se o operador pedir.
- As abas das Automações são organização, não escopo: aqui também só agrupam.

**Testes:**
- Pino da migration: FK composta com SET NULL (area_id).
- repo: recusa área de outra conta; nulo = Geral; salvar sem mexer na área não a apaga.
- Painel: agente sem setor aparece em Geral; o filtro por setor junta os agentes certos.
- E2E no preview: escolher o setor, ver o chip e o filtro, e reverter.

#### PA-F5 — Origem 'ia' na trilha do lead e nos webhooks deal.* (opcional) (G (1 semana ou mais))

**Objetivo:** Fazer a trilha e o Desempenho do funil saberem que foi o agente quem moveu o card ou mexeu na etiqueta. Hoje saem como 'automacao' ou 'sistema': o executar-acoes.ts:163-171 chama cb_atualizar_negocio com p_cadeia vazio, e o CHECK de origin da 0912:87-89 não tem 'ia'.

**Entregas:**
- Origem 'ia', com actor_label “IA · <agente>”, para mover etapa, passagem, etiquetar, tirar etiqueta e preencher campo.
- source 'ia' nos webhooks deal.*, com a documentação.
- O painel passa a ler “movido pelo agente” na trilha, que é durável, e não só nas ações do turno.

**Arquivos:**
- supabase/migrations/NNNN_cb_origem_ia_na_trilha.sql
- src/lib/ia-agentes/executar-acoes.ts e turno.ts (passagem)
- src/lib/lead-events/describe.ts
- docs/public-api.md, docs/webhooks.md e Configurações → API → Documentação (o contrato muda; o job documentacao cobra)
- supabase/migrations/origem-e-aviso-duravel-1040.test.ts (pino atualizado, com motivo)
- docs/MERGE-UPSTREAM.md (se tocar arquivo do upstream)

**Migration:** O desenho de docs/PLANO-agentes-de-ia.md 5.6:
- alargar o CHECK de origin ANTES de trocar as funções (a lição da 1040: o gatilho engole erro com WARNING);
- variável de sessão cb.ia_agente gravada por RPC: parâmetro novo em cb_atualizar_negocio (DROP + CREATE, com DEFAULT para o app antigo) e RPCs para etiqueta e campo;
- as três funções de gatilho (cb_enfileira_evento_de_funil, cb_log_deal_event, cb_log_contact_tag_event) testam o sinal antes da cadeia;
- REVOKE e GRANT nas duas metades, e conferência chamando as funções.

**Depende de:** PA-F1b

**Riscos:**
- Contrato publicado: integrações que leem source (o Make da iMotion, o n8n) podem tratar o valor novo como erro. Conferir com elas antes: erro da API desliga o cenário delas.
- Mexe em funções quentes de deals e contact_tags: replay e Postgres descartável são obrigatórios.

**Testes:**
- Pino da 1040 atualizado. Função chamada pelo caminho do PostgREST. O mover do agente vira linha 'ia' com o nome; o mover de gente continua 'usuario'.
- doc-acompanha verde, com a documentação no mesmo PR.
- E2E com autorização: um turno real move o card e a linha do tempo diz “IA · <agente>”.

### Fora do escopo da frente
- Sandbox (Playground com rascunho, cópia desligada, conversa real do contato, modo sombra, ações num contato de teste): frente própria da central.
- Auditoria (pedido completo enviado ao modelo, versões das instruções, histórico das pausas, filtros, busca e exportação da aba Turnos, turnos por conversa, valor gravado no registro da ação): frente própria. O prazo da poda (PA8) se combina com ela.
- Comparação causal ou teste A/B com grupo de controle. A visão “antes × depois de ligar” fica como opção posterior da PA5.
- Mudar o /dashboard (que conta resposta só com sender_type 'agent'), o Desempenho e a Saúde do funil para separar a IA: depende da PA-F5.
- Fazer a transferência “responda e passe” reacender o alerta de atraso: é um achado desta revisão, mas é comportamento do motor (E7). Vai ao operador como pergunta própria.
- Painel para quem não é administrador (salvo decisão contrária na PA2).
- Realtime em cb_ia_turnos (salvo decisão contrária na PA3).
- Alertas ativos (sino, notificação do navegador) quando um agente falha ou a fila de transferidas cresce.
- Teto de gasto que pausa o agente (adiado pela D21), metas e previsões.
- Custo por conexão e por funil: o uso não guarda funil, e o vínculo uso → turno se perde quando o turno é apagado. O painel mostra custo por agente.
- Atribuir ao agente o custo da transcrição e da leitura de mídia (custo da conta pela D15).
- Exportar o painel em CSV.
- Reapontar o resumo na cb_unir_fichas para turnos já podados (limite escrito na PA-F0; só se a medição mostrar que importa).
- Classificar com IA o teor da resposta do cliente (“não tenho interesse”) para refinar “recuperado”.

### Correções do verificador sobre o desenho inicial
- Nova PA-F0 antes do painel, e antes de ligar o piloto: o motivo numa coluna, o resumo e a soma no banco. Por quê: cb_ia_turnos tem 0 linhas (conferido em 26/10), então ler o motivo do texto do “erro” e fixar um pino nos prefixos de turno.ts era fallback para um passado que não existe. A F1a paginava linha a linha e a F3 reescrevia tudo. A 1095 já decidiu que “paginar não serve” para painel. Ficou como PA10, para o operador escolher.
- Motivo pela coluna, não pelo texto: a reunião não marcada transfere com o desfecho 'respondeu', sem linha 'transferir' nas ações e sem texto no 'erro' (turno.ts:1561-1571, 2144-2149). O leitor de texto do projetista a perderia.
- Lixeira: o gatilho novo em cb_ia_turnos tem de ser declarado em cb_lixeira_tratamento() ('livres') na mesma migration, e a conferência tem de chamar cb_lixeira_conferir_gatilhos(). Por quê: cb_ia_turnos entra na lista de tabelas conferidas pelos ponteiros 'reaponta' de mensagem_* (1102). Gatilho não declarado faz toda restauração falhar com lixeira_sem_tratamento:gatilho (1097:853-880 e 1168). Hoje cb_ia_turnos não tem gatilho nenhum (conferido no banco).
- Gatilho do resumo com UPDATE OF status, erro, motivo, acoes, conversation_id, deal_id. Por quê: cb_unir_fichas reaponta cb_ia_turnos por UPDATE, sem FK (1093:474 e 634), e o resumo sem FK ficaria com o id da ficha que saiu. A lista deixa de fora mensagem_*, que a Lixeira escreve, e por isso o gatilho cabe em 'livres'. Resumo de turno já podado fica como limite escrito.
- Risco de LGPD reescrito: dizer que os ids “não apontam para nada” depois do “Excluir agora” era falso. deals.contact_id é ponteiro anulado, não apagado (1102), e o título do card é o nome da pessoa (decisão do operador). O resumo continua ligável a ela pelo card. A PA8 (c) passa a ser a saída.
- Mediana, p90 e contagens distintas (conversas atendidas, cards tocados) não se somam por dia. A soma do banco devolve percentil e distintos por PERÍODO; os somatórios e as faixas, por dia.
- Custo: reusar a cb_ia_uso (1108), que já soma o uso por dia, agente, modelo e faixa, e a leitura paginada da rota de Uso (route.ts:31-55), em vez de paginar ai_usage_log linha a linha. Custo por conexão e por funil foi para fora do escopo, porque o dado não o sustenta.
- “Transferidas esperando a equipe” pela aguardando_desde perdia o “responda e passe” e a reunião não marcada: a resposta do agente limpa a espera (1080:93-99). A definição nova é: nenhuma mensagem de gente depois de ia_pausada_em. O achado de produto (o cliente fora do alerta de atraso) vai ao operador.
- “Em conversa” contava conversas dormentes: ia_agente_id é o último agente que respondeu, e só encerrar o zera. A métrica ganhou o recorte por last_message_at (24 h) e outro rótulo.
- Classificação da fila: executar_apos − created_at ≤ 5 min não separa rajada de mídia, porque o reagendamento limpa o erro e a posse (turno.ts:2104-2118). Agora usa os marcadores ERRO_DA_REPETICAO (turno.ts:979), ERRO_DA_ESPERA_DO_HORARIO e o tipo; rajada, áudio e mídia viram uma categoria só, “Na fila”.
- fora_do_horario não “sobra só nos antigos”: a conexão oficial ainda o produz quando a janela da Meta fecha antes da abertura (ia-agentes-turno.md).
- PA6: a mensagem de gente tem de ser da MESMA conexão (a conversa é uma por ficha, em todas as conexões) e dentro de um prazo (72 h depois da última resposta do agente), com NOT nao_saiu (régua da 972/1080). Sem isso, o atendimento de outro setor ou um assunto novo semanas depois apagariam o mérito do agente.
- PA4: a resposta é atribuída à ÚLTIMA retomada que saiu antes dela. O custo por recuperado passou a ser o custo das retomadas (uso ligado por turno_id) e não o custo total do agente, que misturava as respostas normais e inflava o número.
- Tempo de espera: o turno que veio de passagem tem o created_at da passagem, não o da mensagem do cliente. Saiu da mediana.
- Impacto no funil: reusar carregarTrajetorias (carregar.ts:114, RPC 1078) e os fatos do funil comercial, em vez de um leitor novo da trilha por .in(). A regra do transferido no funil de origem, o degrau monotônico e a perda por perdidoDesde já estão testados lá; uma cópia divergiria.
- Recuperados e “sem a equipe” agora somados no banco (função da PA-F1b, molde da 1095), sem paginar messages no servidor. Com o piloto, isso seriam dezenas de páginas em fila contra o teto de 60 conexões.
- ?vista=painel e “Ver turnos”: a página e o detalhe usam useState (agents/page.tsx:26, detalhe-do-agente.tsx:46), sem parâmetro. useSearchParams exige Suspense (molde de settings/page.tsx:34-45 e pipelines/page.tsx:102-110). Entraram agents/[id]/page.tsx e detalhe-do-agente.tsx nos arquivos.
- Território: ligar o agente recarimba ativado_em (1049:122-133). Para o agente desligado, “atendíveis” mostra nenhum até ligar.
- Ao voltar para o app: os blocos do período PISCAM o carregando, porque afirmam números (regra do Desempenho e da Saúde em ao-voltar.md). Só a faixa Agora recarrega em silêncio, e mostra “não atualizado desde…” quando falha.
- .claude/rules/ia.md está com 25.591 de 25.600 bytes (instrucoes.test.ts): a nota da poda e do resumo vai para a regra nova ia-painel.md, e não para ia.md como o projetista previa.
- MERGE-UPSTREAM: agents/page.tsx já tem linha (560) dizendo que a página é nossa inteira. Atualizar essa linha, não acrescentar outra.
- PA-F3 virou só a poda (P, sem migration: o índice de terminado_em foi para a PA-F0). Continua no laço lento, com o stack deploy explícito. Também é a fase que depende da PA8.
- PA-F5 dependia da PA-F3 sem motivo: a leitura da origem 'ia' na trilha independe do resumo. Agora depende da PA-F1b.
- A rota do painel ganhou checkRateLimit (como a de Uso) e consultas em série ou com paralelismo pequeno, por causa do teto de 60 conexões do banco (incidente de 13/10).
- A lista ao vivo usa nomeDoContato/identidadeDoContato: Contact.phone pode ser nulo e o IGSID nunca vai à tela (8d).
- A PA2 passa a bloquear também a PA-F0 (a policy do resumo depende dela), e a PA8 bloqueia a PA-F0 (com a opção (a), não há resumo).

## Anexo — frente Registro e auditoria (versão verificada)

Responder, com um rastro que dura, "o que o agente decidiu, marcou e executou, com qual configuração e por quê". A resposta vale por turno, por conversa, por agente e para a conta inteira, inclusive depois que a conversa ou a ficha saírem. Duas condições: não guardar dado de cliente além de um prazo e não mudar o contrato que a iMotion/Make ouve.

Ponto de partida (código de 26/10; banco conferido de novo em 26/10 pelo supabase-cb, só leitura):
- cb_ia_turnos tem 0 linhas. A FK `cb_ia_turnos_conversa_fkey` é ON DELETE CASCADE (`confdeltype = 'c'`, 1049:323-324). A tabela não tem nenhum gatilho. O Postgres é o 17.6, que aceita `SET NULL (coluna)`. A Lixeira leva o turno sem volta ('cb_ia_turnos' 'nao_volta', 1102:263). Os turnos dos e2e de 25 e 26/10 sumiram na limpeza dos testes, e o banco não diz por qual caminho.
- A aba Turnos mostra os 50 últimos turnos de UM agente (src/app/api/cb/ia/agentes/[id]/turnos/route.ts:16, 64-70).
- Não há versões das instruções: cb_ia_agentes guarda só a última edição (repo.ts:347-358).
- O registro da ação não guarda o valor escrito (acoes.ts:1350-1358). O valor existe em AcaoResolvida.valor (acoes.ts:463-475), mas não é gravado.
- A passagem termina 'passou' sem dizer para quem (turno.ts:908, 927).
- O `erro` do turno mistura código com texto livre. Quatro casos colam o texto: as travas (turno.ts:1355, 1362, 1376, 1395). Há outros três: a parada da retomada guarda o texto retido (turno.ts:1963-1964); o envio recusado ou incerto e o turno que quebrou guardam a mensagem crua do erro (turno.ts:1673-1676, 2241-2249); a ação que falha guarda o `err.message` em `detalhe` (executar-acoes.ts:371-373). Com isso não dá para filtrar por motivo, e dado de cliente pode morar nesses textos.
- Na trilha, o card movido e a etiqueta posta pelo agente aparecem "pelo sistema": sem auth.uid(), viram 'sistema' (0912:248-252 e 438). O aviso deal.* diz `automation`, pela cb.cadeia da 1040 (src/lib/webhooks/eventos-de-funil.ts:61-67).

Volume (leitura de 26/10):
- o banco tem 225 MB;
- 12.877 mensagens de cliente em 30 dias, em 1.265 conversas;
- cb_lead_events ocupa 18 MB e ai_usage_log, 1,7 MB.

### Métricas e capacidades

- **Rastro durável do turno** — O turno continua consultável depois que a conversa é excluída ou a ficha passa pela Lixeira. Restaurar religa o turno à conversa.
  - Fonte: cb_ia_turnos (conversation_id com SET NULL; ponteiro 'reaponta' em cb_lixeira_tratamento)
  - Obs.: Hoje 0 turnos em produção (conferido em 26/10). A FK é CASCADE (1049:323-324); os dos e2e sumiram na limpeza dos testes, e o banco não diz por qual caminho. Sem conversa, a tela diz 'apagada ou na Lixeira', nunca 'excluída'.
- **Conteúdo com prazo** — Retrato, saída do modelo, texto do desfecho (`erro_detalhe`), valores e detalhes crus das ações somem depois de N dias (R2) ou na exclusão definitiva (R3), e o turno diz quando e por quê.
  - Fonte: cb_ia_turnos.conteudo_removido_em / conteudo_removido_por; RPC cb_ia_podar_conteudo_dos_turnos na manutenção do ciclo
  - Obs.: O esqueleto fica, e é o que o painel soma.
- **Versão usada no turno** — Cada turno aponta a versão da configuração do agente que o gerou, com quem a salvou e quando, ou 'pelo sistema' quando um gatilho a mudou (conexão apagada, agente arquivado).
  - Fonte: cb_ia_turnos.ia_agente_versao → cb_ia_agente_versoes (criado_por, origem)
  - Obs.: Inclui ligar/desligar e arquivar (R5). A v1 dos agentes existentes é o estado do dia da migration, sem autor.
- **Entradas do pedido** — As opções numeradas (ações, horários, passagens), o 'agora', a agenda e os ids das mensagens que foram ao modelo naquele turno.
  - Fonte: cb_ia_turnos.contexto (A2)
  - Obs.: É o que dá sentido a '#3 recusada'. A reconstrução do pedido conferida por hash é a A7, opcional (R4).
- **Valor escrito pela ação** — O que o agente gravou ou tentou gravar: valor do campo, título da tarefa, nome do convidado, inclusive na falha `valor_invalido`.
  - Fonte: cb_ia_turnos.acoes[].valor
  - Obs.: Camada de conteúdo.
- **Destino da passagem** — Para qual agente a conversa foi passada, qual turno do destino nasceu dela, e se a automação da etapa falou no lugar dele.
  - Fonte: Linha `passar` em cb_ia_turnos.acoes (alvo = destino; turno = id do turno do destino; detalhe 'automacao_fala')
  - Obs.: Pelo id gravado, não pela mensagem_gatilho_id, que vira nula quando a conversa sai.
- **Retidas pelas travas, por motivo** — Quantos turnos foram retidos por pedido vazado, link inventado, reunião prometida ou ação prometida, por agente e período.
  - Fonte: cb_ia_turnos.erro (código, depois da A2) + status 'transferiu' (resposta) ou 'sem_resposta' (retomada)
  - Obs.: A soma é do painel, numa RPC no molde da cb_ia_uso. Aqui é o filtro.
- **Ações recusadas e falhas por código** — Ações pedidas que não executaram, com o código (fora da lista, valor inválido, card fechado…).
  - Fonte: cb_ia_turnos.acoes (ok=false, erro)
  - Obs.: Filtro 'ação recusada' no Registro. O detalhe cru é conteúdo e sai com a limpeza.
- **Motivo declarado** — Justificativa curta escrita pelo modelo quando age (R6).
  - Fonte: [[MOTIVO: …]] lido de cb_ia_turnos.saida_bruta
  - Obs.: Não é o raciocínio interno do modelo.
- **Trilha 'pelo agente de IA X'** — Card movido, etiqueta posta ou tirada e passagem aparecem na linha do tempo do lead com o nome do agente.
  - Fonte: cb_lead_events.details.via = 'agente' + ref_id + ref_nome (via de cb_quem_mexeu_na_conversa, 1083)
  - Obs.: `source` dos deal.* inalterado (R7): a 1040 só lê x-cb-origem e cb.cadeia.
- **Custo da geração por turno** — Custo estimado em R$ das chamadas de GERAÇÃO de cada turno.
  - Fonte: ai_usage_log.turno_id × precos.ts (com a faixa da 1108 por chamada) × ai_configs.cotacao_dolar
  - Obs.: Estimativa pela cotação de hoje, como a aba Uso (D21). Não inclui a transcrição de áudio nem a leitura de mídia do turno: elas não gravam turno_id (só turno.ts:1287 e 1951 o passam). Só no detalhe, nunca na lista nem no CSV. Modelo sem preço = 'sem preço', nunca zero.
- **Exportação para planilha** — CSV do Registro filtrado, até 5.000 linhas, com fórmulas neutralizadas, com o esqueleto, o contato e o link (R10).
  - Fonte: Rota /api/cb/ia/turnos + paraCsv (src/lib/csv.ts)
  - Obs.: Só admin. Na recomendação da R10, o conteúdo não vai.

### Telas

- **Registro (auditoria da conta)** (/agents, aba nova 'Registro' ao lado de 'Agentes' e 'Uso' (?aba=registro&turno=&conversa=, com Suspense na página); Só administrador (D14; R9). O fallback para os outros diz 'só administradores', nunca 'nenhum turno')
  - Filtros: período (padrão 7 dias), agente, conexão, desfecho, tipo (resposta/retomada), 'com ação', 'ação recusada', motivo da transferência, contato (seletor → a conversa da ficha)
  - Lista: data, agente vN, conexão, contato ou 'sem conversa (apagada ou na Lixeira)', desfecho, retomada k/n, ações ✓/✗ resumidas, tokens; 'Carregar mais' e 'Atualizar'
  - Turno aberto:
  - ações com valor e código;
  - 'passou para X' com link para o turno do destino;
  - motivo declarado;
  - texto retido ou saída;
  - o que o agente viu, com as opções numeradas;
  - mensagens que entraram (links);
  - versão (link);
  - custo estimado da geração
  - 'Exportar CSV' (até 5.000 linhas, com aviso de 'mais de 5.000'; conteúdo pela R10)
  - Estados: carregando ≠ vazio ≠ falhou (8c); 'conteúdo removido em <data> (prazo/exclusão)'; 'sem registro deste turno' para a bolha sem turno
- **Turnos do agente** (/agents/[id], sub-aba Turnos (hoje com os 50 últimos); Só administrador)
  - O mesmo componente do Registro, com o agente fixo e os mesmos filtros
  - Sem o teto de 50: cursor por chave
- **Versões do agente** (/agents/[id], sub-aba nova 'Versões'; Só administrador)
  - Lista: vN, data, quem salvou ou 'pelo sistema (conexão apagada ou agente arquivado)', campos que mudaram
  - Versão aberta: a configuração inteira daquele momento
  - 'Comparar com a anterior': instruções e regras lado a lado, os outros campos como antes → depois
- **Acesso a partir da conversa** (Caixa de entrada: o selo 'IA · nome' na bolha do agente (SeloDoAgenteDeIa, nosso) e a faixa da IA acima do fio; Administrador vê os links (papel efetivo; a lente 'Ver como' vale); os outros veem a bolha e a faixa como hoje)
  - Selo 'IA · nome' clicável → o turno que gerou aquela mensagem, no Registro, na mesma janela, voltando pelo histórico
  - Link 'Registro da IA nesta conversa' na faixa → o Registro filtrado pela conversa
- **Diálogo 'Excluir de vez' da Lixeira** (Contatos → Lixeira → Excluir de vez; Administrador (como hoje))
  - Frase nova: o registro da IA desta ficha fica, sem o conteúdo (R3)
  - 'Ficam no CRM' passa a citar o registro da IA (o esqueleto)

### Fases da frente

#### A1 — Retenção: o turno sobrevive à conversa, e o conteúdo tem prazo (M (3–4 dias, com o Postgres descartável))

**Objetivo:** Desacoplar o turno da conversa sem guardar dado de cliente para sempre. O turno passa a ter duas camadas:
- o ESQUELETO, sem texto de cliente: agente, conexão, card, etapa, desfecho, tipo, código do erro, ações sem valor e sem detalhe cru, tokens e ids. Fica.
- o CONTEÚDO, com texto de cliente: o retrato, a saída do modelo, o texto do desfecho (`erro_detalhe`), os valores e os detalhes crus das ações. Sai por prazo (R2) e na exclusão definitiva (R3).

Não há 'fotografia mínima' com nome ou telefone. Enquanto a ficha está na Lixeira, o vínculo turno → conversa vive nos ponteiros dela e volta ao restaurar. Depois da exclusão definitiva, o turno fica 'sem conversa'.

O `deal_id` do esqueleto continua levando ao card, cujo título é o nome da pessoa (decisão do operador). É o mesmo que a Lixeira já deixa ficar ('os negócios, com o título').

**Entregas:**
- Migration A, aditiva, aplicada ANTES do deploy:
  - `cb_ia_turnos.conversation_id` passa a aceitar nulo;
  - a FK `cb_ia_turnos_conversa_fkey` é recriada como `ON DELETE SET NULL (conversation_id)`, por coluna, no molde da FK do canal (1049:326-327);
  - `SET LOCAL lock_timeout`, com a FK nova criada `NOT VALID` e validada em seguida: o ADD da FK trava `conversations`, que é tabela quente.
- Gatilho `BEFORE UPDATE OF conversation_id` em cb_ia_turnos, o PRIMEIRO da tabela (hoje são 0). Age quando a conversa vira nula com o turno vivo:
  - `aguardando`, ou `rodando` sem `enviando_desde` → `descartado`;
  - `rodando` com `enviando_desde` → `incerto`, porque a resposta pode ter saído e `descartado` afirmaria que nada saiu;
  - `erro` = 'conversa apagada', no vocabulário que o banco já grava ('conexão apagada', 'conversa encerrada', 'fichas unidas');
  - `terminado_em = now()`, como o gatilho da conexão.
  
  Por quê: o índice do pendente é `NULLS NOT DISTINCT` (1049:331-333). Dois pendentes órfãos da mesma conexão colidiriam e ABORTARIAM o DELETE da conversa, pelo mesmo motivo do gatilho da conexão apagada (1049:383-410). Vale para o SET NULL da FK e para o `cb_lixeira_anular`, que anula os ponteiros ANTES do DELETE (1099).
- Colunas novas em cb_ia_turnos:
  - `saida_bruta text`, gravada na A2;
  - `erro_detalhe text`, gravada na A2: o texto livre do desfecho, isto é, o retido pelas travas, os links inventados, a parada da retomada e a mensagem crua do erro, passada por `semSegredo`;
  - `conteudo_removido_em timestamptz`;
  - `conteudo_removido_por text`, com CHECK nomeado `('prazo','exclusao')`.
- Função interna `cb_ia_turno_sem_conteudo(p_ids uuid[], p_por text)`, que limpa SÓ o conteúdo:
  - `contexto`, `saida_bruta` e `erro_detalhe` ficam nulos;
  - de cada item de `acoes` sai o `valor`, e sai o `detalhe` que não é código da lista fechada (`ja_estava`, `sem_marcador`, `nome_sem_origem`, `automacao_fala`);
  - carimba `conteudo_removido_*`.
  O `erro` fica (é código desde a A2). Nos turnos gravados entre a A1 e a A2, o erro antigo é cortado ao texto antes do primeiro ':'.
  Tem REVOKE de PUBLIC, anon e authenticated: só a chamam as funções definer da Lixeira (`cb_excluir_da_lixeira`, `cb_vencer_lixeira`) e a poda.
- RPC `cb_ia_podar_conteudo_dos_turnos(p_dias, p_limite)`: limpa, em lotes, o conteúdo dos turnos com `created_at` mais velho que p_dias, fora de `aguardando` e `rodando`. Execução revogada de PUBLIC, anon e authenticated, e concedida de volta ao service_role.
- Índices:
  - `(account_id, created_at DESC)`, para a visão da conta na A4;
  - parcial `(created_at) WHERE conteudo_removido_em IS NULL`, com o MESMO predicado e a mesma coluna que a poda filtra. Um pino compara os dois (supabase.md: índice parcial espelha a consulta).
- `cb_lixeira_tratamento()` refeita a partir do corpo VIGENTE da 1102 (1102:236-353):
  - sai `'cb_ia_turnos'` do fecho;
  - sai o ponteiro `'ai_usage_log.turno_id'`, que deixa de ser alcançado;
  - entra o ponteiro `'cb_ia_turnos.conversation_id' → 'reaponta'`: restaurar religa o turno. Os de mensagem (`mensagem_gatilho_id`, `mensagem_inicial_id`) já estão lá;
  - o gatilho novo entra em `livres`: a restauração só grava conversa NÃO nula, e `cb_lixeira_conferir_gatilhos` passa a enxergá-lo, porque cb_ia_turnos já está entre os ponteiros que reapontam.
- `cb_lixeira_purgar_um` refeita a partir do corpo vigente, que é o da 1097 (1097:1402-1483). A exclusão definitiva chama `cb_ia_turno_sem_conteudo` para os turnos anotados nos ponteiros (tabela cb_ia_turnos), com `por = 'exclusao'`. Na recomendação da R3, a chamada fica FORA do `IF p_pedido`: vale no prazo e no 'Excluir agora'.
- Passo novo 'conteúdo dos turnos da IA' em `rodarManutencaoDoCiclo` (src/lib/scheduled/manutencao-do-ciclo.ts:58-65), isolado e dentro do `PRAZO_DA_MANUTENCAO_MS`. Fica depois do vencimento da Lixeira.
  Não precisa de rota nova: a `/api/cb/scheduled/cron` (laço lento, 15 min) já carrega a manutenção (route.ts:24-36), então não há `docker stack deploy` manual. O prazo é a constante `PRAZO_DO_CONTEUDO_DO_TURNO_DIAS` (R2).
- Tela de Turnos de hoje:
  - `conversationId` anulável na rota (route.ts:24, 80, 101) e em tipos.ts;
  - sem conversa, a linha diz 'sem conversa (apagada ou na Lixeira)', nunca 'excluída': a ficha pode voltar da Lixeira;
  - 'conteúdo removido em <data> (prazo | exclusão)' em vez de um retrato vazio, que viraria afirmação (8c);
  - o Record de textos traduz também as constantes que o banco grava.
- Textos da Lixeira (messages/pt-BR.json:1555-1561 e en.json):
  - 'Excluir de vez': o registro da IA fica, sem o conteúdo;
  - 'ficamNoCrm' passa a citar o registro da IA (o esqueleto).
- Docs no mesmo PR:
  - .claude/rules/ia.md: a FK, a poda e as duas camadas;
  - .claude/rules/supabase.md, seção Lixeira: cb_ia_turnos sobrevive;
  - .claude/rules/contatos.md;
  - docs/MIGRATIONS-APLICADAS.md;
  - docs/DECISOES-DO-OPERADOR.md: uma linha para R1–R3;
  - docs/PLANO-agentes-de-ia.md: a 'poda de 90 dias' da 5.2 (PLANO:176), nunca feita, vira a R2.

**Arquivos:**
- supabase/migrations/NNNN_cb_ia_turnos_sobrevivem_a_conversa.sql (nasce)
- supabase/migrations/turnos-sobrevivem-NNNN.test.ts (nasce)
- supabase/migrations/lixeira-1097.test.ts (atualiza a expectativa do tratamento)
- supabase/migrations/agentes-quem-responde-1049.test.ts (a FK)
- src/lib/scheduled/manutencao-do-ciclo.ts e manutencao-do-ciclo.test.ts
- src/app/api/cb/ia/agentes/[id]/turnos/route.ts
- src/components/agentes-de-ia/turnos-do-agente.tsx, textos.ts, tipos.ts
- messages/pt-BR.json, messages/en.json
- docs/MIGRATIONS-APLICADAS.md, docs/DECISOES-DO-OPERADOR.md, docs/PLANO-agentes-de-ia.md
- docs/PLANO-central-dos-agentes.md (nasce; plano vivo da central)
- .claude/rules/ia.md, .claude/rules/supabase.md, .claude/rules/contatos.md

**Migration:** Migration A. Número a definir na hora: o maior do main + 1. Hoje o maior arquivo é 1109, e as outras frentes da central podem pegar os seguintes; rodar `ls supabase/migrations` E `list_migrations` antes. É ADITIVA: aplicar antes do deploy, depois do replay verde.

O que faz:
- DROP NOT NULL e a FK recriada com SET NULL (conversation_id), NOT VALID + VALIDATE, com lock_timeout;
- o gatilho de descarte, com `incerto` para quem já estava enviando;
- as quatro colunas e os dois índices;
- `cb_ia_turno_sem_conteudo` e `cb_ia_podar_conteudo_dos_turnos`: REVOKE de PUBLIC, anon e authenticated nas duas e GRANT ao service_role na poda;
- `cb_lixeira_tratamento()` e `cb_lixeira_purgar_um` refeitas a partir dos corpos vigentes (1102 e 1097).

Conferência:
- banco vazio = NOTICE;
- a FK com `confdeltype='n'` e `confdelsetcols` só na conversa;
- anon e authenticated sem SELECT em cb_ia_turnos e sem EXECUTE nas duas funções;
- `PERFORM cb_lixeira_conferir_gatilhos()`;
- a RPC de poda e a limpeza CHAMADAS num subbloco desfeito por SQLSTATE próprio (`P11xx`), nunca `WHEN OTHERS`.

**Riscos:**
- Os corpos de `cb_lixeira_tratamento` e `cb_lixeira_purgar_um` são refeitos inteiros. Outra branch da central que também os refaça perde entradas em silêncio. Refazer sempre a partir do vigente do main no dia, e o pino compara.
- A ação da FK disparar o gatilho BEFORE UPDATE da filha é premissa a PROVAR no descartável. Sem o gatilho, o DELETE de conversa com pendente órfão aborta.
- Criar a FK pede trava em `conversations`, tabela quente. Por isso NOT VALID + VALIDATE e lock_timeout curto, com nova tentativa se estourar.
- O `eco.ts` lê o turno por `mensagem_enviada_id`. Com a conversa apagada nos mesmos segundos, o eco não tem onde gravar: janela de segundos, aceita e escrita.
- O esqueleto mantém `deal_id` e ids de mensagens. O card sobrevive à ficha com o título (= nome da pessoa), como a Lixeira já faz. Confirmar com quem responde pela LGPD, como a B3 da Lixeira.
- Turno de conversa apagada FORA da Lixeira (DELETE à mão, desfazer de carga) não passa pela exclusão: o conteúdo dele só sai pelo prazo da R2.
- Volume: retrato de até 20.000 caracteres (acesso.ts:56). Por isso existe a R2.
- A frente do painel depende desta fase: sem ela, os números somem com a conversa. Ela tem de estar no ar ANTES de ligar o piloto.

**Testes:**
- Pino SQL (turnos-sobrevivem-NNNN.test.ts):
  - FK SET NULL por coluna e NOT NULL removido;
  - gatilho com o WHEN do turno vivo e o ramo `incerto`;
  - tratamento sem 'cb_ia_turnos' no fecho, sem 'ai_usage_log.turno_id', com o ponteiro 'reaponta' e o gatilho em 'livres';
  - purgar_um chamando a limpeza fora do `IF p_pedido`;
  - REVOKE/GRANT das duas funções;
  - o predicado da poda e o do índice parcial são o mesmo.
- Postgres descartável com o schema do replay e dado. Prova antes de aplicar a premissa de que a ação da FK dispara o gatilho BEFORE UPDATE da filha. Os cenários:
  - mover para a Lixeira uma ficha com turno terminado;
  - outra com turno 'aguardando' na mesma conexão de um órfão (prova o NULLS NOT DISTINCT);
  - um 'rodando' com `enviando_desde` vira `incerto`;
  - restaurar: conversa reapontada;
  - excluir de vez: esqueleto fica; contexto, saída e erro_detalhe nulos; detalhe cru das ações removido; `conteudo_removido_por = 'exclusao'`;
  - poda por prazo em lotes;
  - `cb_unir_fichas` continua passando: ela move os turnos antes de apagar a conversa (1093:634).
- Unidade: o passo novo da manutenção é isolado (a falha não para os outros); a rota com conversa nula; o Record traduz 'conversa apagada'.
- E2E no preview, só leitura da tela: a aba Turnos com 'sem conversa' e 'conteúdo removido'. O .env.local aponta para a PRODUÇÃO: a ficha fictícia criada e movida para a Lixeira só com o "pode gravar" do operador, apagada no fim.

#### A2 — O registro completo do turno (sem migration) (M (2 dias))

**Objetivo:** Gravar o que falta para explicar a decisão, sem guardar o texto inteiro do pedido (R4):
- a saída do modelo;
- o valor de cada ação;
- o destino da passagem e o turno dele;
- as ENTRADAS do pedido: as opções numeradas, sem as quais '#3 recusada' não quer dizer nada;
- os ids das mensagens que foram ao modelo;
- `erro` só com códigos, em TODO desfecho, para ser filtrável e não guardar texto de cliente no esqueleto.

**Entregas:**
- `erro` do turno vira CÓDIGO (ou a constante fixa que o banco já grava) em todo desfecho, com o texto livre em `erro_detalhe` (A1), passado por `semSegredo`:
  - as quatro travas (turno.ts:1355, 1362, 1376, 1395); os links inventados ficam em `erro_detalhe`, porque a tela não os recalcula sem o pedido;
  - a parada da retomada (turno.ts:1963-1964);
  - envio recusado e incerto (turno.ts:1673-1676);
  - turno que quebrou (turno.ts:2241-2249);
  - 'mover o card falhou' na passagem (turno.ts:889).
  As marcas que o motor relê (`ERRO_DA_ESPERA_DO_HORARIO`, `ERRO_DA_REPETICAO`) continuam como estão.
- `saida_bruta` = a saída do modelo, com os marcadores e com teto de 4.000 caracteres.
  - Sem o sentinela: `parseGeneration` já o tira (src/lib/ai/generate.ts:72-77, arquivo do upstream, que não muda); o desfecho `sentinela` o registra.
  - Gravada no encerramento junto com `acoes` (turno.ts:2153-2159), também na retomada.
- `RegistroDeAcao` ganha `valor?: string`: o valor pedido pelo modelo no campo, o título da tarefa ou o nome do convidado, aparado e com teto de 500.
  Gravado em `executarAcoes` (executar-acoes.ts:366-380), inclusive na falha `valor_invalido`, que é onde ele mais explica. Também nas recusas com valor, e lido por `lerRegistrosDasAcoes` (acoes.ts:1373-1393).
- Linha `passar` (constante `ACAO_PASSAR`, como `ACAO_TRANSFERIR` em acoes.ts:199):
  - `alvo` = o destino {id, nome congelado};
  - campo `turno` = o id do turno do destino (o `novo` de `enfileirarTurno`, turno.ts:910-922). Achar pela `mensagem_gatilho_id` não serve: ela vira nula quando a conversa sai (FK SET NULL para messages, 1049:298-299);
  - `detalhe: 'automacao_fala'` quando a etapa de destino tem automação (turno.ts:908);
  - a passagem que não serve (turno.ts:862-868, 890, 922) grava `ok:false` com o código.
  Substitui a coluna `ia_agente_passado_id` da 5.2 do plano, que nunca existiu.
- O retrato (`RetratoDoContexto`, acesso.ts:329-363) ganha as ENTRADAS do pedido:
  - o `agora` usado;
  - as opções numeradas: ações, horários e passagens com a descrição;
  - a agenda (lida, temEmail, reuniaoMarcada);
  - os ids das mensagens que foram ao modelo (contexto.ts passa a devolvê-los).
  Opções e ids têm teto PRÓPRIO, fora do corte dos blocos (o laço de acesso.ts:353-361 cortaria blocos para caber opções). O sha256 e a impressão do texto-base ficam para a A7.
- A aba Turnos de hoje mostra o valor, o destino com link para o turno dele e a saída. Os códigos novos entram no Record exaustivo de textos.ts e nos dois dicionários.

**Arquivos:**
- src/lib/ia-agentes/turno.ts e turno.test.ts
- src/lib/ia-agentes/acoes.ts e acoes.test.ts
- src/lib/ia-agentes/executar-acoes.ts e executar-acoes.test.ts
- src/lib/ia-agentes/acesso.ts e acesso.test.ts (retrato)
- src/lib/ia-agentes/contexto.ts (ids das mensagens)
- src/components/agentes-de-ia/turnos-do-agente.tsx, textos.ts, tipos.ts
- messages/pt-BR.json, messages/en.json
- .claude/rules/ia-agentes.md, .claude/rules/ia-agentes-turno.md, .claude/rules/ia-retomada.md

**Migration:** Nenhuma: usa `saida_bruta` e `erro_detalhe` da A1. `acoes` e `contexto` são jsonb.

**Depende de:** A1

**Riscos:**
- Quem lia o texto no `erro` (a aba Turnos) passa a ler `erro_detalhe` e a saída. Mudar no mesmo PR. Hoje há 0 turnos em produção, então nada antigo a converter.
- Um retrato maior conta no conteúdo da R2.
- Algum desfecho novo que volte a colar texto no `erro` fura a camada. Um teste lista os caminhos que gravam `erro` e cobra o código.

**Testes:**
- turno.test.ts:
  - as quatro travas, a parada da retomada, o envio recusado/incerto e o turno que quebrou gravam SÓ código no `erro` e o texto em `erro_detalhe`;
  - o texto passa por `semSegredo`;
  - a saída tem teto;
  - a passagem válida grava a linha `passar` com o destino e o id do turno dele;
  - a passagem inválida grava ok:false;
  - a retomada grava a saída;
  - o retrato traz as entradas e os ids.
- acoes.test.ts: `valor` lido e gravado; registro antigo sem `valor` continua legível.
- E2E: turno REAL, pelo procedimento de engenharia de 25 e 26/10 (servidor local, webhook local, vigia do cron), no lead de teste autorizado, com o "pode" do operador. Ver na aba Turnos o valor de um 'Preencher campo' inválido e o destino de uma passagem. O Playground não grava turno.

#### A3 — Versões do agente (M (2–3 dias))

**Objetivo:** Cada mudança na configuração do agente vira uma versão numerada, com quem e quando, e cada turno guarda a versão que usou. Assim dá para ligar 'o agente passou a errar' a 'alguém mudou a instrução no dia X', sem atribuir a uma pessoa o que o sistema fez.

**Entregas:**
- Migration B, aditiva, antes do deploy: `cb_ia_agentes.versao integer NOT NULL DEFAULT 1` e a tabela `cb_ia_agente_versoes`:
  - colunas: account_id, ia_agente_id, versao, configuracao jsonb, criado_por com SET NULL, origem ('tela' | 'automatica' | 'inicial'), created_at;
  - PK (ia_agente_id, versao);
  - FK (ia_agente_id, account_id) → cb_ia_agentes (id, account_id) com CASCADE (agente não se apaga, só se arquiva);
  - FECHADA ao navegador, como cb_ia_turnos: RLS sem policy, REVOKE de PUBLIC, anon e authenticated, ALL ao service_role. A tela lê por rota de admin (D14).
- Gatilhos em cb_ia_agentes, que acompanham qualquer escritor, inclusive SQL à mão:
  - BEFORE UPDATE soma 1 à `versao` quando muda algum campo de configuração (R5): nome, descrição, instruções, regras, provedor, modelo, ativo, conexões, horário, teto, pode_passar_para, transferir_para, acesso, ferramentas, retomada, arquivado_em;
  - AFTER INSERT/UPDATE grava o retrato da versão.
  
  Autoria: com `pg_trigger_depth() = 1`, `criado_por = NEW.atualizado_por` e origem 'tela'. Com profundidade maior, `criado_por` nulo e origem 'automatica'. É o caso de apagar uma conexão, que tira o id dela de `conexoes` (1048:117-121), e de arquivar outro agente, que o tira de `pode_passar_para` (1049:183-187): nenhum dos dois toca `atualizado_por`, e a versão seria atribuída a quem editou por último.
  
  Carga inicial: v1 dos 21 agentes existentes, origem 'inicial', datada do `updated_at` do agente, sem dizer que aquela pessoa escreveu aquele texto.
- `cb_ia_turnos.ia_agente_versao integer`:
  - FK (ia_agente_id, ia_agente_versao) → cb_ia_agente_versoes, com SET NULL por coluna;
  - índice PARCIAL (regra da FK anulável, ia.md:355).
- `COLUNAS_DO_AGENTE` (agente.ts:195-196) e `IaAgente` ganham `versao`. O turno grava a versão LIDA no começo, na escrita do retrato, com a cerca de posse (turno.ts:1203-1211; e na retomada, :1897).
- Rotas de admin:
  - `GET /api/cb/ia/agentes/[id]/versoes`: lista com n, quando, quem (ou 'pelo sistema') e os campos que mudaram, sem o texto;
  - `GET /api/cb/ia/agentes/[id]/versoes/[n]`: a configuração inteira.
- Sub-aba 'Versões' no detalhe do agente (detalhe-do-agente.tsx:36, 144, 207):
  - lista vN · data · pessoa ou 'pelo sistema (conexão apagada ou agente arquivado)' · campos mudados;
  - abrir uma versão;
  - 'comparar com a anterior': instruções e regras lado a lado, os outros campos como antes → depois.
  Função pura `camposQueMudaram(a, b)`. O turno mostra 'versão N' com link.

**Arquivos:**
- supabase/migrations/NNNN_cb_ia_agente_versoes.sql (nasce)
- supabase/migrations/agente-versoes-NNNN.test.ts (nasce)
- src/lib/ia-agentes/agente.ts, repo.ts (leitura), turno.ts
- src/lib/ia-agentes/versoes.ts e versoes.test.ts (nasce: camposQueMudaram e o parse)
- src/app/api/cb/ia/agentes/[id]/versoes/route.ts e [n]/route.ts (nascem)
- src/components/agentes-de-ia/versoes-do-agente.tsx (nasce), detalhe-do-agente.tsx
- messages/pt-BR.json, messages/en.json
- .claude/rules/ia.md, docs/MIGRATIONS-APLICADAS.md

**Migration:** Migration B (número na hora). Faz:
- a coluna `versao`;
- a tabela de versões, fechada ao navegador (RLS sem policy, REVOKE de PUBLIC, anon e authenticated; ALL ao service_role);
- os dois gatilhos (funções com REVOKE);
- a carga v1;
- `cb_ia_turnos.ia_agente_versao` com a FK e o índice parcial.

Conferência:
- banco vazio = NOTICE;
- com agente: num subbloco, um UPDATE das instruções, a leitura da versão nova (origem 'tela') numa INSTRUÇÃO seguinte, e um RAISE com SQLSTATE próprio para desfazer;
- um UPDATE sem mudança de configuração não cria versão;
- o UPDATE feito de dentro de outro gatilho grava origem 'automatica' sem pessoa.

Aplicar ANTES do deploy: `COLUNAS_DO_AGENTE` pede `versao`. Sem a coluna, TODA leitura de agente falha, como aconteceu com `retomada` na 1056 (ia-retomada.md:64).

**Riscos:**
- Coluna nova em cb_ia_agentes que alguém esqueça na lista do gatilho fica fora da versão. O pino cobra.
- Deploy antes da migration = toda leitura de agente em erro.
- SQL à mão na profundidade 1 herda o `atualizado_por` gravado. Limite escrito na regra.
- Etapas e documentos ficam fora (R5, opção V2). O turno guarda a etapa (stage_id) e o retrato guarda os documentos usados.
- A frente do sandbox (rascunho × publicada) pode reusar esta tabela: combinar o nome antes, para não nascerem duas.

**Testes:**
- Pino SQL:
  - a lista de colunas do gatilho é a mesma do retrato da versão;
  - coluna nova de cb_ia_agentes fora da lista reprova, com allowlist e motivo para colunas como updated_at, atualizado_por e ativado_em;
  - anon e authenticated sem SELECT;
  - o ramo de `pg_trigger_depth()`.
- Descartável:
  - salvar duas vezes gera v2; salvar igual não gera versão;
  - ligar, desligar e arquivar geram versão;
  - apagar uma conexão gera versão 'automatica' SEM pessoa nos agentes que a tinham;
  - o turno grava a versão lida.
- Unidade: `camposQueMudaram` (regras acrescentadas e retiradas, modelo trocado); a rota recusa membro não admin (D14).
- E2E no preview: editar as instruções de um agente DESLIGADO de rascunho e ver v2 e a comparação. Grava em produção: só com "pode gravar" e num agente de teste.

#### A4 — A tela de auditoria: conta, agente, conversa, CSV e o link da bolha (M/G (4–5 dias))

**Objetivo:** Achar e ler qualquer turno:
- da conta inteira, com filtros e período;
- de um agente (a sub-aba Turnos deixa de parar em 50);
- de uma conversa, a partir da bolha 'IA · nome' ou da faixa.
E exportar para planilha (R10).

**Entregas:**
- Rotas de admin:
  - `GET /api/cb/ia/turnos`: filtros por agente, conexão, desfecho (lista), tipo resposta/retomada, de/até (instante com offset), conversa, 'com ação' / 'ação recusada' (jsonb `contains` em `acoes`) e motivo da transferência (`erro` = código, pela A2). Cursor por CHAVE (created_at, id) desc, teto de 100 por página e `account_id` em toda consulta. Seleciona SÓ o esqueleto: nunca `contexto` nem `saida_bruta` (até ~24 KB por linha).
  - `GET /api/cb/ia/turnos/[id]`: o turno inteiro, com a versão, o turno do destino da passagem (pelo id gravado na A2), as mensagens que entraram (link) e o custo da GERAÇÃO por `ai_usage_log.turno_id` (precos.ts com a faixa da 1108 por chamada × cotação de hoje, dito como estimativa).
  - `GET /api/cb/ia/turnos/da-mensagem/[messageId]`: `messages.message_id` = `mensagem_enviada_id` (índice parcial existente, 1049:349-351). Sem turno, responde 404 `sem_registro`; leitura que falha responde 500.
- A rota antiga `/api/cb/ia/agentes/[id]/turnos` sai. `TurnosDoAgente` passa a usar o componente novo com o agente fixo.
- Aba 'Registro' em /agents. Hoje a página só tem 'agentes' e 'uso' (agents/page.tsx:13, 51-54), em `useState`.
  - A aba e os filtros vão para a URL (`?aba=registro&turno=&conversa=`), para os links da caixa de entrada. Com `useSearchParams`, a página precisa de `<Suspense>`, no molde de inbox/page.tsx:59-66 e pipelines/page.tsx:101-108 (Next 16, AGENTS.md).
  - Fica DENTRO de /agents: não é tela nova. Já está em protectedPaths, menu, pageTitles e catálogo (`agents`, admin em ESCRITA_DA_TELA).
  - Se a central virar rota própria (decisão da frente do painel), a tela nova segue a 8c: protectedPaths, menu, pageTitles nos dois dicionários e catálogo, onde nasce invisível.
- Componente `registro-de-turnos.tsx`:
  - filtros, com período padrão de 7 dias;
  - lista: data, agente vN, conexão, contato ou 'sem conversa (apagada ou na Lixeira)', desfecho traduzido, retomada k/n, resumo ✓/✗ das ações e tokens;
  - 'Carregar mais' e 'Atualizar';
  - vazio durante a carga ou falha nunca vira 'nenhum turno' (8c).
  O detalhe sai de turnos-do-agente.tsx:184-336 para `turno-detalhado.tsx`. Ele mostra:
  - ações com valor;
  - 'passou para X' com link para o turno do destino;
  - motivo declarado (A5);
  - texto retido ou saída;
  - o que o agente viu;
  - mensagens;
  - versão;
  - custo da geração.
  Filtro por contato: o seletor de contato que o Playground já usa → a conversa da ficha. Sem busca de texto livre.
- 'Exportar CSV' no navegador:
  - percorre as páginas da rota até 5.000 linhas; acima disso, 'mais de 5.000: estreite o período', nunca número exato;
  - monta com `paraCsv`, que passa todo campo por `neutralizarFormula` (src/lib/csv.ts:27-36); nome por `nomeDeArquivoSeguro`; datas no fuso do escritório;
  - colunas na recomendação da R10: data, agente, versão, conexão, contato, link da conversa, tipo, tentativa, desfecho, motivo (código traduzido), ações (tipo: alvo ✓/✗ código), passou para, tokens.
  Sem conteúdo nem custo: o custo exigiria ler `ai_usage_log` página a página.
- O selo 'IA · nome' (`SeloDoAgenteDeIa`, message-bubble.tsx:821-833) já é NOSSO, num arquivo que fica nosso inteiro num merge (MERGE-UPSTREAM.md:228, 446). Ele muda no lugar, sem componente novo:
  - para admin (papel EFETIVO do useAuth, a lente 'Ver como' vale), vira link para o turno no Registro (R8);
  - para os outros, continua como está (R9).
  A faixa (ai-thread-banner.tsx, upstream) ganha 'Registro da IA nesta conversa' (admin).
  O link abre na MESMA janela, voltando pelo histórico: no app instalado, uma aba nova sai do app.
  Bolha sem turno (as 6 respostas de 27/09, ou turno apagado antes da A1): o Registro diz 'sem registro deste turno', nunca uma página vazia nem 'nenhum turno'.
- Sem gráfico nesta aba: contagens e gráficos são do painel, com a biblioteca que o app já usa (recharts ^3.10.1, package.json:63, e o BarChart do Tremor vendorizado em src/components/tremor/bar-chart.tsx, como em src/components/funil/grafico-de-taxas.tsx:3). Se o operador quiser um resumo no topo, é esse BarChart.
- Docs:
  - docs/MERGE-UPSTREAM.md: atualizar as linhas que JÁ existem, do selo (:571), da faixa (:569) e de agents/page.tsx (:560, página nossa inteira);
  - .claude/rules/ia.md: a rota nova e o fim da antiga;
  - chaves nos dois dicionários.

**Arquivos:**
- src/app/api/cb/ia/turnos/route.ts (nasce)
- src/app/api/cb/ia/turnos/[id]/route.ts (nasce)
- src/app/api/cb/ia/turnos/da-mensagem/[messageId]/route.ts (nasce)
- src/app/api/cb/ia/agentes/[id]/turnos/route.ts (sai)
- src/lib/ia-agentes/registro.ts e registro.test.ts (nasce: filtros → consulta, cursor, leitura da linha)
- src/lib/ia-agentes/exportar-turnos.ts e exportar-turnos.test.ts (nasce: as linhas do CSV)
- src/components/agentes-de-ia/registro-de-turnos.tsx (nasce)
- src/components/agentes-de-ia/turno-detalhado.tsx (nasce, sai de turnos-do-agente.tsx)
- src/components/agentes-de-ia/turnos-do-agente.tsx
- src/app/(dashboard)/agents/page.tsx (nossa inteira)
- src/components/inbox/message-bubble.tsx (nossa inteira: o SeloDoAgenteDeIa)
- src/components/inbox/ai-thread-banner.tsx (upstream, com linha na tabela)
- messages/pt-BR.json, messages/en.json
- docs/MERGE-UPSTREAM.md, .claude/rules/ia.md

**Migration:** Nenhuma. O índice (account_id, created_at DESC) vem na A1.

**Depende de:** A1, A2, A3

**Riscos:**
- O PostgREST corta em 1000 linhas: cursor por chave, nunca offset, e contagem só como 'mais de N'.
- O filtro em jsonb não tem índice. A tabela é pequena hoje; GIN só se medir lento.
- A bolha está numa lista quente: o gate de admin vem do contexto de auth, sem consulta por bolha.
- ai-thread-banner.tsx veio do upstream: o próximo merge pode apagar o link se a linha da tabela não for atualizada.
- O CSV leva dado de cliente para fora do CRM (o diálogo de exclusão já avisa que planilhas ficam fora do alcance, pt-BR.json:1560). Por isso a R10 limita o que vai.

**Testes:**
- Unidade:
  - `registro.ts`: cada filtro vira a cláusula certa; o cursor não pula nem repete com escrita concorrente; `account_id` sempre presente; a lista não pede `contexto` nem `saida_bruta`;
  - `exportar-turnos.ts`: motivo '=HYPERLINK(…)' neutralizado; teto e 'mais de 5.000'.
- Rotas: só admin; turno de outra conta = 404; leitura que falha = 500, nunca lista vazia (8b); mensagem sem turno = `sem_registro`.
- A página de pé com `<Suspense>`: `npm run build` sem o erro de `useSearchParams`.
- Medir no PostgREST real a página de 100 com o `.in('id', …)` dos contatos: forma nova de consulta (8b).
- Portões de i18n (paridade e chaves usadas); chaves montadas novas (motivos, códigos) cobradas nos dois dicionários.
- E2E no preview, 1440×900:
  - filtros, 'Carregar mais' e 'Exportar CSV' abrindo no Excel com acento e separador;
  - o link da bolha como admin e a ausência dele pela lente 'Ver como' de um perfil agent;
  - o link da faixa;
  - a volta pelo histórico.
  Com o lead de teste autorizado, sem abrir outra conversa (abrir zera as não lidas). Conferir o link no iPhone (app instalado).

#### A5 — Motivo curto declarado pelo modelo (P (1–2 dias + a medição))

**Objetivo:** Responder 'por que moveu o card / transferiu / passou' sem adivinhar, com uma justificativa curta que o modelo escreve junto com as ações e que nunca chega ao cliente.

**Entregas:**
- O pedido (pedido.ts) pede `[[MOTIVO: …]]` quando a resposta usa algum marcador de ação, passagem ou transferência (R6): até 200 caracteres, sem dado pessoal do cliente. O trecho entra em `TRECHOS_DO_PEDIDO` (regras-do-sistema.ts:136), para a trava do pedido vazado reconhecê-lo.
- `lerAcoes` (acoes.ts:363-460) conhece MOTIVO ANTES do parse genérico de ação, para ele não virar ação recusada:
  - tira o marcador do texto ao cliente em toda forma (caixa, acento, colchete simples, sem fechar, entre crases);
  - devolve `motivo`.
  `lerRespostaDaRetomada` também o tira: a retomada não o pede, mas o modelo pode mandar.
- Sem coluna: a tela lê o motivo da `saida_bruta` (A2), que tem o mesmo prazo e a mesma limpeza.
- O Playground mostra 'Motivo declarado' debaixo das ações simuladas (combinar com a frente do sandbox).
- A tela chama de 'justificativa declarada pelo modelo', nunca 'raciocínio': é texto gerado junto com a resposta, não o processo interno.

**Arquivos:**
- src/lib/ia-agentes/pedido.ts e pedido.test.ts
- src/lib/ia-agentes/acoes.ts e acoes.test.ts
- src/lib/ia-agentes/retomada-resposta.ts e o teste
- src/lib/ia-agentes/regras-do-sistema.ts e regras-do-sistema.test.ts
- src/app/api/cb/ia/agentes/[id]/playground/route.ts, src/components/agentes-de-ia/playground-do-agente.tsx
- src/components/agentes-de-ia/turno-detalhado.tsx
- messages/pt-BR.json, messages/en.json
- .claude/rules/ia-agentes.md

**Migration:** Nenhuma.

**Depende de:** A2

**Riscos:**
- O modelo explicar ao CLIENTE ('Motivo: …' sem colchetes). Se a medição achar algum caso, entra uma trava no molde do pedido vazado (retém e transfere), decidida com o número medido.
- Pedir o motivo mudar as ações escolhidas: a medição compara; se mudar, não liga.
- O motivo pode trazer dado do cliente: fica na camada de conteúdo e sai com a limpeza.
- Custo desprezível: ~30–60 tokens de saída por turno com ação. Pelo preço do Haiku 5.5 (US$ 0,50 por milhão na saída, ia-tela-do-agente.md:104-106), centavos por mês no piloto.

**Testes:**
- lerAcoes:
  - o MOTIVO em todas as formas some do texto e não vira ação recusada;
  - o motivo junto do `[[HANDOFF]]` continua transferência (o sentinela sai de qualquer ponto, generate.ts:72-77);
  - o motivo não dispara `equipePrometida` nem `acaoPrometida`, que rodam sobre o texto sem marcadores.
- lerRespostaDaRetomada: o MOTIVO não chega ao cliente.
- pedido.test: o trecho está no pedido e em `TRECHOS_DO_PEDIDO`.
- Medição ANTES de ligar, no Playground: 50 gerações por modelo em uso (Gemini Flash e Haiku 5.5), em cenários com ação, passagem e transferência. Os critérios:
  - zero motivo no texto ao cliente;
  - a aderência (quantas trazem o marcador);
  - as MESMAS ações com e sem o pedido do motivo: pedir justificativa pode mudar a decisão.
  Custo: ~300 gerações ≈ 1 milhão de tokens de teste, no ritmo medido de ~3,1 mil por mensagem.

#### A6 — Trilha 'pelo agente de IA X' (o deal.* fica como está) (M (2–3 dias))

**Objetivo:** Na linha do tempo do lead, o card movido, a etiqueta posta ou tirada e a passagem dizem 'pelo agente de IA <nome>' em vez de 'pelo sistema', sem CHECK novo e sem mudar o `source` que a iMotion/Make filtra (R7).

**Entregas:**
- Migration C: `cb_log_deal_event()` e `cb_log_contact_tag_event()` refeitas a partir dos corpos vigentes (0912 + o REVOKE da 0913), com um ramo novo:
  - sem `auth.uid()`, leem `cb_quem_mexeu_na_conversa()` (1083:159-228), que só confia no service role;
  - com via 'agente' e `ref` de um agente da conta, gravam `origin = 'automacao'` (a régua da 1083:279-280) e, como a 1083 grava, `details.via = 'agente'`, `details.ref_id` e `details.ref_nome` (nome por junção com cb_ia_agentes pela conta, como 1083:324);
  - o CHECK de origem não muda;
  - a falha assimétrica da 912 continua: com auth.uid() estoura, sem ele vira WARNING.
  Só as FUNÇÕES mudam: os gatilhos ficam, inclusive o de `contact_tags` com o WHEN do sinal da Lixeira (1097:396).
- A tela já sabe dizer: `chaveDoAutor` trata a via 'agente' como `actorAgentNamed` (src/lib/lead-events/describe.ts:281-282), e lead-event-text.ts:148 a usa para todo evento.
- Cliente do agente: `src/lib/ia-agentes/cliente-do-agente.ts`, no molde do `clienteDaApi` da v1 (src/lib/api/v1/cliente-da-api.ts:41), com service role e cabeçalhos GLOBAIS `x-cb-via: agente` e `x-cb-ref: <id>` (constantes de origem-da-escrita.ts:48-50). Usado SÓ em:
  - mover (a RPC `cb_atualizar_negocio`, executar-acoes.ts:164-172);
  - etiquetar e tirar: `addContactTagAndDispatch` e `removeContactTag` já recebem `db`, então tag-write.ts (upstream) e tag-events.ts não mudam;
  - o UPDATE da passagem (turno.ts:881-888).
- Pino default-deny: escrita do agente em `deals` e `contact_tags` passa pelo cliente do agente.
- Webhooks deal.*: inalterados. A 1040 só lê `x-cb-origem` e `cb.cadeia` (1040:189-202), nunca `x-cb-via`: o `source` segue `automation` no mover e `system` na passagem (eventos-de-funil.ts:61-67; docs/webhooks.md:229-241). Rodar `node scripts/doc-acompanha.mjs`; se cobrar, commit com `Doc-inalterada: o source dos deal.* não muda`.
- Reescrever o limite 'a trilha diz automation/sistema' em .claude/rules/ia-agentes.md:125-128 e o da F4 do plano (PLANO:394).

**Arquivos:**
- supabase/migrations/NNNN_cb_trilha_pelo_agente_de_ia.sql (nasce)
- supabase/migrations/trilha-pelo-agente-NNNN.test.ts (nasce)
- src/lib/ia-agentes/cliente-do-agente.ts (nasce)
- src/lib/ia-agentes/escrita-do-agente.chamadores.test.ts (nasce)
- src/lib/ia-agentes/executar-acoes.ts, turno.ts
- src/lib/lead-events/describe.test.ts (o caso do card e da etiqueta pela via)
- .claude/rules/ia-agentes.md, docs/PLANO-agentes-de-ia.md, docs/MIGRATIONS-APLICADAS.md

**Migration:** Migration C (número na hora): CREATE OR REPLACE das duas funções de gatilho da trilha, mesma assinatura, com o REVOKE repetido.

Conferência:
- num subbloco, `set_config('request.headers', '{"x-cb-via":"agente","x-cb-ref":…}')` e as claims de service role;
- um UPDATE de etapa e um INSERT de etiqueta;
- leitura da linha da trilha numa instrução seguinte;
- desfeito por SQLSTATE próprio;
- banco vazio = NOTICE.

Aplicar antes do deploy: o app antigo não manda o cabeçalho, e nada muda.

**Riscos:**
- O cabeçalho pode não chegar ao banco pelo `.rpc()`. O `marcarOrigem` é no-op silencioso sem `setHeader` (origem-da-escrita.ts:62-69). Por isso o cliente usa cabeçalho GLOBAL, e há a medição em produção.
- A automação de `tag_added` disparada pela etiqueta roda com o cliente do motor (`runAutomationsForTrigger` não recebe `db`, tag-events.ts:79-130) e não herda a via. É o certo, mas o teste o fixa.
- A origem do card movido pela IA muda de 'sistema' para 'automacao'. Nenhuma métrica do funil filtra por origem além de 'retroativo' (src/lib/funil/trajetoria.ts:389; 0975 e 1078 só a copiam).

**Testes:**
- Pino SQL: o ramo da via vem DEPOIS de auth.uid(); sem via = como antes; o CHECK não muda; só 'agente' ganha ramo (as outras vias continuam como hoje).
- O pino `membro-suspenso-1067.test.ts` passa sobre a definição nova das duas funções (SECURITY DEFINER).
- Descartável:
  - o card movido com o cabeçalho grava `details.via`, `ref_id` e `ref_nome`;
  - sem cabeçalho grava 'sistema' como hoje;
  - a carga calada (DISABLE TRIGGER) continua sem linha.
- Pino default-deny do cliente do agente; describe.test com o evento de etapa e de etiqueta pela via 'agente'.
- Medição em produção ENTRE aplicar e mesclar, como a 1040, com "pode gravar":
  - mover o card do lead de teste autorizado, pelo cliente do agente, entre duas etapas SEM automação;
  - conferir `details.via = 'agente'` na trilha e `source` automation no aviso;
  - devolver a etapa.

#### A7 — Pedido reconstruído e conferido (opcional, depois do piloto) (P/M (2–3 dias))

**Objetivo:** Mostrar o pedido exato de um turno sem guardar o texto dele, só se o piloto mostrar que retrato, saída, motivo e as mensagens ligadas não bastam para explicar a decisão (R4).

**Entregas:**
- O retrato passa a guardar:
  - o sha256 do pedido + conversa como foram ao provedor;
  - a impressão do texto-base (sha das regras do sistema e do texto fixo).
  Os turnos anteriores à A7 ficam sem a conferência.
- 'Ver o pedido montado' no detalhe do Registro (`GET /api/cb/ia/turnos/[id]?pedido=1`): `montarPedidoDoAgente` com a versão (A3), as entradas (A2) e as mensagens pelos ids, conferido pelo hash.
- Quando o hash não bate, a tela diz a causa que dá para saber:
  - texto-base mudou num deploy;
  - mensagem apagada ou editada;
  - transcrição ou leitura de mídia gravada depois do turno, que muda o texto da mensagem sem edição.
  Nunca afirma uma causa que não mediu.

**Arquivos:**
- src/lib/ia-agentes/turno.ts, acesso.ts (o hash e a impressão)
- src/lib/ia-agentes/pedido-do-turno.ts e o teste (nasce: a reconstrução)
- src/app/api/cb/ia/turnos/[id]/route.ts
- src/components/agentes-de-ia/turno-detalhado.tsx
- messages/pt-BR.json, messages/en.json

**Migration:** Nenhuma.

**Depende de:** A2, A3, A4

**Riscos:**
- A reconstrução depende do código de `montarPedidoDoAgente` do dia: qualquer mudança nele vira 'texto-base mudou' para o histórico inteiro.
- Turno de mídia diverge com frequência: a leitura entra no texto da mensagem depois.

**Testes:**
- Pura: o sha256 do pedido montado de novo com as entradas gravadas bate com o do turno.
- Cada causa de divergência tem um caso: o texto-base trocado, a mensagem editada e a transcrição gravada depois.

### Fora do escopo da frente
- Painel com gráficos, contagens por desfecho e 'recuperados' pela retomada: é a frente do painel. Esta frente entrega a base durável (A1) e os códigos filtráveis (A2).
- Sandbox e histórico dos testes do Playground: é a frente do sandbox. A tabela de versões (A3) pode servir à 'versão publicada × rascunho' dela, combinando o nome antes.
- O raciocínio interno do provedor (thinking): não sai de forma uniforme nos três provedores, e os adaptadores descartam o que não é texto. O 'motivo declarado' (A5) é o substituto honesto.
- Linha do tempo do caminho de cada turno (aguardando → rodando → reagendado → …) numa tabela de eventos: a linha do turno continua sendo regravada a cada passo.
- Pausa e 'Retomar IA' como linhas do Histórico da conversa (1083): exige event_type novo na trilha. Proposta para depois; hoje a faixa mostra só o estado atual.
- Anotação na conversa para a ação que FALHOU: seria ruído para a equipe; o link da bolha leva ao registro.
- Ligar a anotação 'IA · agente' (cb_conversation_notes) ao turno por id: o link da bolha cobre a primeira versão.
- Mudar o `source` dos deal.* ou acrescentar o campo `ai_agent` (opções c/d da R7).
- 'Restaurar esta versão' na sub-aba Versões: a restauração passaria pelas validações do salvar; fica para depois de o histórico existir.
- Abrir o registro para quem não é administrador (opção b da R9).
- Busca de texto livre no conteúdo dos turnos: na primeira versão os filtros são estruturados, e o contato vem pelo seletor.
- Imutabilidade criptográfica do registro (encadeamento de hashes, WORM): o sha256 da A7, se feita, confere o pedido, não protege a tabela de quem tem a service role.
- Custo histórico em R$ pela cotação da data: usa a cotação de hoje, como a aba Uso (D21). O custo da transcrição e da leitura de mídia por turno também fica fora (não gravam turno_id).
- Turnos do assistente legado (src/lib/ai, desligado em produção).

### Correções do verificador sobre o desenho inicial
- A1/A2: o plano só tirava do `erro` o texto das 4 travas. Ficavam de fora a parada da retomada (turno.ts:1963-1964), o envio recusado/incerto (1673-1676), o turno que quebrou (2241-2249) e o `err.message` cru em `acoes[].detalhe` (executar-acoes.ts:371-373). Cortar 'antes do primeiro :' deixa inteira a mensagem que não tem dois-pontos. Agora `erro` é sempre código, o texto livre vai para a coluna nova `erro_detalhe` (conteúdo, por semSegredo) e a limpeza tira também o `detalhe` cru das ações. Sem isso, 'nenhum dado de cliente no esqueleto' era falso.
- A2: a tela não consegue recalcular os 'links inventados' só a partir da saida_bruta, porque precisa do pedido. A lista dos links vai para `erro_detalhe`.
- A1: o gatilho marcava `descartado` também o `rodando` com `enviando_desde`, que pode ter enviado. Isso afirmava que nada saiu. Agora esse caso vira `incerto`; o gatilho também grava `terminado_em` e usa 'conversa apagada', no vocabulário que o banco já grava ('conexão apagada', 'conversa encerrada', 'fichas unidas').
- A1: o índice parcial era em `created_at`, mas a poda filtrava 'terminados há mais de N dias'. Predicado e índice divergiam, o que supabase.md proíbe. Agora a poda e o índice usam `created_at`, fora dos vivos, com pino comparando os dois.
- A1: `cb_ia_turno_sem_conteudo` não tinha REVOKE escrito. Ganhou REVOKE de PUBLIC, anon e authenticated. Quem a chama são as definer da Lixeira (cb_excluir_da_lixeira, cb_vencer_lixeira, 1097:1526-1529) e a poda.
- A1: o ADD da FK trava `conversations`, tabela quente. Entrou como NOT VALID + VALIDATE com lock_timeout curto, e isso foi para os riscos.
- A1/telas: entre o mover para a Lixeira e a exclusão, o turno fica sem conversa, mas a ficha pode voltar. 'Conversa excluída' afirmava algo falso; agora a tela diz 'sem conversa (apagada ou na Lixeira)'.
- Objetivo/R1: 'nenhum nome sobra' não vale por inteiro. O `deal_id` do esqueleto leva ao card, cujo título é o nome da pessoa (decisão do operador), como a Lixeira já aceita ('ficamNoCrm'). O texto foi ajustado, e a chave 'ficamNoCrm' passa a citar o registro da IA.
- Ponto de partida: '0 turnos pelo CASCADE' era inferência, porque o mapeamento diz que o banco não revela o caminho. O texto mudou para o que foi conferido em 26/10 (0 linhas, confdeltype 'c', nenhum gatilho em cb_ia_turnos, Postgres 17.6).
- A2: o link 'passou para X → turno do destino' dependia da `mensagem_gatilho_id`, que é FK SET NULL para messages (1049:298-299) e se perde quando a conversa sai. Agora a linha `passar` grava o id do turno do destino (o `novo` de enfileirarTurno, turno.ts:910-922).
- A2/A4/R4: a reconstrução conferida por hash saiu para a A7, opcional. Ela é abstração para um uso ainda não provado, inflava a A4 para G e diagnosticaria errado a divergência quando a transcrição ou a leitura de mídia é gravada depois do turno. A A2 fica com as entradas e os ids, que são baratos e dão sentido ao '#3 recusada'.
- A3: `criado_por = atualizado_por` atribuía a pessoa errada. Dois gatilhos mudam cb_ia_agentes sem tocar `atualizado_por`: apagar conexão (1048:117-121) e arquivar outro agente (1049:183-187). Com `pg_trigger_depth() > 1`, a versão fica sem pessoa, com origem 'automatica'. A v1 é 'inicial', sem autor.
- A3: a tabela de versões passou a ser fechada ao navegador (RLS sem policy, REVOKE de authenticated). Toda leitura é por rota de admin; policy + GRANT era superfície sem leitor.
- A4: message-bubble.tsx e agents/page.tsx são NOSSOS inteiros num merge (MERGE-UPSTREAM.md:228, 446, 560), e o selo já é nosso (linha 571). Não é preciso extrair componente; basta atualizar as linhas 560, 569 e 571 da tabela.
- A4: agents/page.tsx guarda a aba em useState (page.tsx:26). Pôr a aba na URL com useSearchParams exige <Suspense> no Next 16 (molde inbox/page.tsx:59-66), senão o build quebra. Entrou como entrega e teste.
- A4: a lista não pode pedir `contexto` nem `saida_bruta` (até ~24 KB por linha). A página caiu de 200 para 100 linhas, porque o `.in('id', …)` de 200 uuids passa de 7 KB na URL; é forma a medir no PostgREST real. O custo ficou só no detalhe, sem leitura de ai_usage_log por página.
- Métrica de custo: o custo do turno cobre só a GERAÇÃO, porque transcrição e leitura de mídia não gravam turno_id (só turno.ts:1287 e 1951 o passam). A métrica passou a se chamar assim e aplica a faixa da 1108 por chamada.
- A4: depende também da A3, porque mostra 'vN'. Bolha sem turno (as 6 respostas de 27/09) diz 'sem registro deste turno', nunca uma página vazia.
- R8: a aba nova do navegador sai do app instalado no iPhone. A recomendação passou para a mesma janela, voltando pelo histórico, com conferência no aparelho.
- R10 (nova): o que vai no CSV. Recomendação: só o esqueleto + contato e link. O CSV é a única porta pela qual o conteúdo sairia do alcance do prazo (R2) e da exclusão (R3).
- R2: faltava perguntar se o esqueleto fica sem prazo e conferir a cota de disco do plano do Supabase antes de fixar 180 dias (o banco já tem 225 MB).
- A5: a medição passou a comparar também se as AÇÕES mudam com o pedido do motivo, porque pedir justificativa pode mudar a decisão. `lerAcoes` reconhece o MOTIVO antes do parse genérico, e `lerRespostaDaRetomada` também o tira. Com o dobro de gerações, o custo da medição foi refeito.
- A6: grava também `details.ref_id`, como a 1083. O pino membro-suspenso-1067 passa sobre as definições novas (SECURITY DEFINER). Ficou escrito que só as funções mudam: o gatilho de contact_tags com o WHEN da Lixeira (1097:396) fica.
- A6 conferida, sem mudança de rumo: a 1040 só lê `x-cb-origem` e `cb.cadeia` (1040:189-202), então o `x-cb-via` do cliente do agente não altera o `source` dos deal.* que a iMotion ouve. `addContactTagAndDispatch` e `removeContactTag` já recebem `db`, e os arquivos do upstream não mudam.
- Citações: o índice do eco está em 1049:349-351 (não 346-349); `parseGeneration` está em generate.ts:72-77; eventos-de-funil.ts está em src/lib/webhooks/; recharts está como ^3.10.1.

## Anexo — frente Sandbox (versão verificada)

Responder ao operador: hoje não dá para testar tudo no sandbox. O Playground testa só o agente SALVO (route.ts:109; o corpo aceita só messages/contactId/retomada/tentativa, route.ts:114-119). As ações são só simuladas. A passagem para no "passaria para X" e só lista destinos LIGADOS (route.ts:265). Também não simula horário, D27, mídia nem a conversa real.

O objetivo é um sandbox em fases, da mais barata à maior:
- testar o RASCUNHO sem salvar;
- comparar antes e depois na mesma conversa;
- partir da conversa real do contato (só nas conexões do agente);
- diagnosticar "este agente atenderia este contato agora?";
- mostrar as conferências da execução sem executar, inclusive as automações que cada ação dispararia;
- encadear a passagem com o destino respondendo;
- ler mídia sem gravar;
- ver o calendário da retomada;
- por fim, o MODO SOMBRA: numa conversa real, o agente decide e registra sem enviar nem executar.

A execução real num contato de teste fica como opção, e não é recomendada agora.

GARANTIA no Playground (S1 a S4):
- nada chega ao cliente;
- nada muda dado real;
- a única escrita é a linha de custo em ai_usage_log (modo agente_teste, D13).
A S6 grava também o ROTEIRO digitado em cb_ia_roteiros, sem dado importado do cliente.

Na sombra (S5a), as únicas escritas são:
- a linha do turno em cb_ia_turnos (modo 'sombra', status final 'observado' com o desfecho previsto);
- o custo em ai_usage_log (modo novo agente_sombra);
- se o operador escolher (SB4-A), o cache de leitura da mídia em messages.transcricao*, a mesma escrita idempotente do botão da bolha e do Radar (o custo dela vai como 'transcricao').

Há também um efeito que JÁ existe e nasce de MARCAR a etapa no agente, ligado ou não: a resposta da equipe pausa a conversa por 'gente'. O gatilho confere só se a etapa tem agente, não se ele está ligado (1049:616-669, :640-647).

COMO SE PROVA:
1. Pino estrutural default-deny: os módulos do sandbox não importam engineSendText, executarAcoes, marcarNoCalendly, runAutomationById, addContactTagAndDispatch, removeContactTag, criarTarefaComAviso, transferirParaGente, anotarNaConversa, mostrarDigitando, drenarEventosDeFunil, armarRetomada, lerMidia nem transcreverAudio, nem as RPCs cb_ia_reservar_envio e cb_atualizar_negocio.
2. Teste com um dublê do Supabase que ANOTA toda escrita: cada modo do Playground escreve só em ai_usage_log.
3. Na sombra, o turno nunca chama envio, "digitando", reserva nem ações. O banco é a segunda trava, por DUAS vias:
- a reserva passa a recusar todo turno com modo diferente de 'producao', qualquer que seja o estado do agente;
- agente em sombra tem ativo = false, e a reserva recusa com agente_desligado.
A conferência da migration chama a reserva e prova as duas.
4. E2E no preview só com o lead de teste autorizado, num funil de TESTE, comparando por SELECT antes e depois: mensagens bot, anotações "IA ·", etiquetas, etapa do card e conversations.ia_agente_id.

### Métricas e capacidades

- **Teste do rascunho** — A resposta, as ações e as travas geradas pela configuração que está na tela, sem salvar. O rascunho é validado como no salvar. A Base usa os documentos salvos.
  - Fonte: POST /api/cb/ia/agentes/[id]/playground com `rascunho`; aplicarAlteracao (agente.ts); conferirRascunho (repo.ts:147-221 exportada)
- **Antes × depois** — A mesma mensagem, ou o roteiro inteiro, gerada pela versão salva e pelo rascunho, lado a lado.
  - Fonte: Duas chamadas à mesma rota; custo em ai_usage_log modo agente_teste
  - Obs.: Com as versões da frente de auditoria (SB1-B), vira publicada × rascunho por versaoId.
- **Conversa real no teste** — As últimas mensagens da conversa do contato numa conexão DO AGENTE, lidas pelo servidor a cada chamada e montadas como no turno. Mídia lida entra lida, não lida entra como 'not read yet'. Nada é lido pelo provedor de leitura nem gravado.
  - Fonte: lerConversaDaConexao (contexto.ts:139-157) com aiContextMessageLimit() (padrão 20, defaults.ts:136)
- **Diagnóstico de atendimento** — Para um contato, uma conexão e um relógio com offset: se o agente atenderia, e o 1º motivo que impede, na ordem do motor.
  - Fonte: lerQuemAtende + quemResponde (quem-responde.ts:182-352); dentroDoHorario e proximaAbertura (horario.ts:44,70); lerFimDaJanelaMeta (retomada-fatos.ts:125); etapaTemQuemFale (engine.ts:4011)
- **Calendário da retomada** — Quando cada tentativa k/n sairia e por que a série pararia (reunião a 90 min, lembrete, janela do dia, 24 h, cadência).
  - Fonte: proximaRetomada (retomada.ts:227-272) + lerBloqueiosDaRetomada (retomada-fatos.ts:44) + lerFimDaJanelaMeta
- **Ensaio das ações** — Por ação aceita:
- o que a execução recusaria (valor_invalido, campo_vigiado, etapa_de_resultado, card_fechado, automação fora da D5 ou desligada);
- o que seria no-op (ja_estava, na etiqueta por leitura de contact_tags);
- as automações que PODEM disparar.
  - Fonte: conferir<Acao> extraídos de executar-acoes.ts (hoje :129-321); triggerMatches (engine.ts:3573); descreverPasso (descrever-passo.ts:74)
- **Passagem encadeada** — Para quem passaria, para qual etapa, se uma automação falaria antes, e a resposta do destino na mesma mensagem.
  - Fonte: decidirResposta (decisao.ts novo); etapaDoAgente (turno.ts:801-836 exportada); etapaTemQuemFale
- **Sombra: turnos por desfecho previsto e por dia** — Contagem de turnos de observação por agente, dia e desfecho previsto (responderia, transferiria, passaria, retida). À parte: descartado, pausado no meio, falhou e sem resposta (inclusive pelo teto diário).
  - Fonte: cb_ia_turnos WHERE modo = 'sombra' (status 'observado' + desfecho_previsto), agregado no banco pela RPC da S5b (ou a RPC do painel com `modo`)
- **Sombra: espera até a 1ª resposta da equipe** — Nos turnos de observação com desfecho 'responderia': o tempo entre a gravação da mensagem INICIAL da rajada e a 1ª resposta de gente depois dela, na conversa. Resposta de gente = sender_id OU from_device, sem ia_agente_id, excluindo a agendada. Mediana por agente e período.
  - Fonte: cb_ia_turnos.mensagem_inicial_id → messages.gravada_em; messages da conversa (sender_type, sender_id, from_device, ia_agente_id, gravada_em); cb_scheduled_messages.message_id; mediana na RPC da S5b
  - Obs.: Correlação, não "tempo poupado". A IA responderia na hora, mas pode responder pior. O turno fora do horário só roda na abertura, e com SB3-A a amostra é quase só a 1ª resposta de cada card novo.
- **Sombra: travas e ações que falhariam** — Quantos turnos seriam retidos (pedido vazado, link inventado, reunião ou ação prometida), quantos transfeririam e quantas ações falhariam no ensaio, por código.
  - Fonte: cb_ia_turnos.erro, desfecho_previsto e acoes (modo 'sombra'), agregados no banco pela RPC da S5b — nunca somados na lista paginada
- **Custo do teste e da observação** — Tokens e R$ estimado do Playground (agente_teste) e da sombra (agente_sombra), por agente, separados da produção.
  - Fonte: ai_usage_log via cb_ia_uso (1108); uso-de-ia.tsx
  - Obs.: A leitura de mídia da sombra (SB4-A) cai em 'transcricao', sem agente (ler-midia.ts:388). Ela fica no custo da conta, não no da observação.
- **Garantia de não-efeito** — Prova automatizada de que o sandbox não envia nem muda dado real, e de que a sombra só escreve o próprio turno, o custo e, com SB4-A, o cache de leitura.
  - Fonte: Pino sandbox-sem-efeito.test.ts (default-deny sobre os imports); dublê que anota escrita nas rotas; turno.test.ts (modo sombra); reserva que recusa modo ≠ 'producao' e CHECK de coerência status × modo (conferência da migration)

### Telas

- **Playground ampliado** (/agents/[id] → sub-aba Playground (tela existente, já em protectedPaths e no catálogo de perfis; nenhuma tela nova); Administrador (D14))
  - Seletor "Testar: salvo | rascunho", com a lista do que mudou e o aviso só para a Base (S1).
  - Cliente do teste + conexão (só as do agente) + "Carregar a conversa real" (S2).
  - Compositor com "como cliente | como equipe", "adicionar sem responder" (rajada) e "Anexar" para áudio, imagem e PDF até 9 MB (S2, S4).
  - Bolhas com selo da versão. "Comparar com o salvo" em duas colunas. "Rodar o roteiro de novo" com a contagem de chamadas (S1).
  - Debaixo de cada resposta:
  - as travas;
  - as ações ENSAIADAS ✓/✗ com o motivo e o "pode disparar: <automação> — manda mensagem";
  - os horários oferecidos (S3b).
  - Bolha encadeada "IA · <destino>" da passagem, ou o aviso "uma automação escuta a etapa de destino" (S3b).
  - "Ver o pedido enviado" (S1).
  - "Simular retomada" com a linha do tempo k/n: quando sairia e onde a série para (S2).
  - Roteiros salvos e "Rodar a bateria" (S6, opcional).
- **Diagnóstico "atenderia agora?"** (Cartão dentro do Playground, quando há cliente escolhido (rota POST …/diagnostico); Administrador)
  - Relógio escolhido (agora ou outra data e hora, no fuso do escritório) e chave "com o rascunho".
  - Lista na ordem de quemResponde: alcance, encerrada, pausada (e por quê), card aberto, etapa e o agente dela, ligado, conexão, D27 com as duas datas.
  - Horário com a próxima abertura, janela de 24 h da Meta, teto usado.
  - Automação que escuta a etapa e automações de nova mensagem e palavra-chave no escopo da conexão ("depende da mensagem").
  - Leitura que falha aparece como "não se sabe", nunca ✓ ou ✗.
- **Turnos com filtro Produção | Observação** (/agents/[id] → sub-aba Turnos (existente; S5a); Administrador)
  - Filtro Produção | Observação, com Produção como padrão.
  - Linha de sombra: "Observado · <desfecho previsto>", com a resposta gerada e as ações ensaiadas expansíveis.
- **Observação (modo sombra)** (/agents/[id] → sub-aba nova "Observação" (S5b); Administrador)
  - Estado do agente, turnos de hoje contra o teto diário, custo da observação (agente_sombra), com a ressalva de que a leitura de mídia vai como 'transcricao'.
  - Gráfico de barras por dia, empilhado por desfecho previsto (responderia, transferiria, passaria, retida), com o BarChart do Tremor sobre recharts e os dias de carga da Kommo marcados (SB11).
  - Lista paginada:
  - a mensagem do cliente;
  - o que a IA responderia;
  - as ações ensaiadas e as travas;
  - a 1ª resposta da equipe e quanto tempo depois.
  - Filtro por desfecho previsto.
  - Botão "Ligar o agente" com o aviso da D27 (SB5).
- **Estado do agente** (/agents/[id] → Configuração, e /agents (lista); Administrador)
  - Seletor Desligado | Em observação | Ligado, com o aviso de custo, da régua e de que a conversa real vai ao provedor.
  - Selo "Em observação" no cartão da lista.
- **Faixa da conversa** (Caixa de entrada → conversa (ai-thread-banner); Todos os membros (sem mudança visível por causa da sombra, SB6-A))
  - Agente em sombra tratado como "sem agente" para todos: nem a linha "não atende" nem "Retomar IA" por causa dele.

### Fases da frente

#### S1 — Testar o rascunho e comparar antes × depois (M (2–3 dias))

**Objetivo:** Testar no Playground o que está na tela, sem salvar, e comparar com a versão salva na mesma conversa. Não precisa de migration.

**Entregas:**
- A rota do Playground aceita `rascunho`: o corpo PARCIAL do PATCH, isto é, as `alteracoes` que cada aba já calcula (configuracao-do-agente.tsx:120-138).
  - O rascunho é lido por `lerAlteracao` (agente.ts:356).
  - Ele é conferido como no salvar, por `conferirRascunho`: a `conferirReferencias` de repo.ts:147-221 exportada. Conferido: só lê (ids da conta, chave do provedor, D5, Instagram e o tipo de evento do Calendly quando muda, este lido na API do Calendly).
  - O rascunho é aplicado sobre o agente salvo por uma função pura, `aplicarAlteracao(agente, alteracao)`.
  - Rascunho inválido devolve 400 com o MESMO código do salvar.
- O detalhe do agente junta o rascunho das abas Configuração, Acesso, Ferramentas e Retomada.
  - Cada aba ganha `aoMudarRascunho`, ao lado do `aoMudarNaoSalvo`.
  - As abas são montadas só quando visitadas (detalhe-do-agente.tsx:47, :185-205): aba não visitada não tem rascunho.
  - O Playground mostra o seletor "Testar: salvo | rascunho", com a lista do que mudou.
  - A Base continua a SALVA: a busca é pelo id do agente (conhecimento.ts:121,140). O aviso âmbar fica só para ela.
- A conversa NÃO zera mais ao salvar: a `key` deixa de levar `salvamentos` (detalhe-do-agente.tsx:198). Cada resposta leva o selo da versão que a gerou ("salvo às 14:32" ou "rascunho"), com a hora em `toLocaleTimeString(undefined, …)`.
- "Comparar com o salvo": a última mensagem do cliente gerada pelas duas versões, lado a lado (2 chamadas).
- "Rodar o roteiro de novo" refaz todas as respostas com a versão escolhida.
  - Usa só as mensagens digitadas como cliente e, como contexto, as respostas novas.
  - Mostra quantas chamadas fará antes de rodar.
  - Anda no ritmo do teto de 20/min por pessoa e 60/min por conta da rota (route.ts:100-105). O 429 pausa e retoma; ele não é erro.
- "Ver o pedido enviado" (só admin, D14): o texto montado por `montarPedidoDoAgente` naquela resposta, pedido sob demanda (`verPedido: true`).
- "Simular retomada" usa a retomada do rascunho e diz quando a retomada está DESLIGADA no agente (hoje a rota simula assim mesmo, route.ts:188-192).
- Corrige o texto da passagem "que responderia esta mesma mensagem" nos dois dicionários. Com automação escutando a etapa de destino, o destino só responde à próxima mensagem (turno.ts, passagem).

**Arquivos:**
- src/app/api/cb/ia/agentes/[id]/playground/route.ts
- src/lib/ia-agentes/agente.ts (aplicarAlteracao, pura)
- src/lib/ia-agentes/repo.ts (exporta conferirRascunho, sem gravar)
- src/components/agentes-de-ia/detalhe-do-agente.tsx
- src/components/agentes-de-ia/configuracao-do-agente.tsx
- src/components/agentes-de-ia/acesso-do-agente.tsx
- src/components/agentes-de-ia/ferramentas-do-agente.tsx
- src/components/agentes-de-ia/retomada-do-agente.tsx
- src/components/agentes-de-ia/playground-do-agente.tsx
- src/components/agentes-de-ia/textos.ts
- messages/en.json e messages/pt-BR.json
- novo: src/lib/ia-agentes/sandbox-sem-efeito.test.ts (pino)
- .claude/rules/ia-agentes.md (o Playground testa o rascunho)
- docs/PLANO-agentes-de-ia.md (Estado)

**Migration:** Nenhuma.

**Riscos:**
- O rascunho com provedor sem chave, ou com item de outra conta, devolve o mesmo erro do salvar. Sem isso, a tela testaria algo que não se salva.
- O "Comparar" custa 2 chamadas e o "Rodar o roteiro" custa N, até 20, o teto pessoal de um minuto inteiro. A contagem aparece antes e conta como agente_teste. O teto da rota é por PROCESSO (dois no deploy).
- Manter a conversa entre versões pode enganar: as respostas antigas foram geradas pela versão anterior (o motivo do reset, Codex #295). O selo da versão em cada bolha e o "Rodar o roteiro de novo" respondem a isso.
- Num agente LIGADO, salvar continua valendo na resposta seguinte. S1 permite PROVAR antes de salvar, mas não impede o salvar (ver SB1).
- Mudar as etapas, as conexões ou o 'ligado' no rascunho não muda a geração. Isso vale só para o diagnóstico (S2). Mudar o tipo de evento do Calendly no rascunho faz cada chamada ler a API do Calendly.

**Testes:**
- agente.test.ts, aplicarAlteracao: campo ausente fica como está salvo; etapas, ativo e conexões não entram na geração.
- Route test com provedor falso:
  - a instrução do rascunho chega ao systemPrompt;
  - rascunho com item de outra conta, campo vigiado ou automação fora da D5 devolve 400 com o código do salvar.
- Dublê que anota escrita: em todo modo, a única escrita é o insert em ai_usage_log (agente_teste).
- Pino sandbox-sem-efeito (default-deny lendo o fonte da rota): nenhum import de envio, ações, reserva, Calendly, anotação ou digitando.
- detalhe-do-agente: salvar não zera a conversa (teste de componente).
- E2E no preview, com agente desligado e o lead de teste autorizado:
  - mudar a instrução sem salvar, testar e comparar;
  - salvar e ver a conversa preservada;
  - conferir por SELECT que nada mudou em messages, cb_conversation_notes, contact_tags e deals do lead.

#### S2 — Conversa real, diagnóstico "atenderia agora?" e calendário da retomada (M (3–4 dias))

**Objetivo:** Partir do histórico real do contato, só nas conexões do agente, e dizer, regra por regra, se o agente atenderia aquele contato agora ou num horário escolhido, e quando cada retomada sairia. Não precisa de migration.

**Entregas:**
- "Carregar a conversa real": o corpo do Playground ganha `conversaReal: { canalId }`. O SERVIDOR lê a cada chamada, por `lerConversaDaConexao` (contexto.ts:139-157), as últimas mensagens da conversa do contato escolhido NESSA conexão, e as digitadas entram depois.
  - O texto real não faz a volta pelo navegador. Hoje a rota corta `messages` em 20 e aceita só role e content (route.ts:33, :121-132).
  - O limite é `aiContextMessageLimit()`, o da produção: padrão 20, defaults.ts:136, configurável pela env.
  - Só conexões que estão nas `conexoes` do agente, salvo ou rascunho visível na tela. Conexão fora delas não aparece no seletor, e a rota recusa com 400 `fora_da_conexao`. Conexões vazias = NENHUMA: é dado de cliente indo a provedor externo, e há números de uso pessoal.
  - A mídia já lida entra lida; a não lida entra como "not read yet". Nenhuma mídia é lida nem gravada.
  - Se a última mensagem real não é do cliente, a tela pede uma mensagem digitada como cliente. É a regra da rota (route.ts:135-139).
- O compositor do Playground ganha:
  - escrever "como equipe": entra como assistant, como a produção faz com equipe, robô e outro agente (contexto.ts:126-133);
  - "adicionar sem responder", para montar uma rajada.
- Rota nova POST /api/cb/ia/agentes/[id]/diagnostico, só admin, só leitura. É POST porque carrega o rascunho. Corpo: `{ contactId, canalId, quando?, rascunho? }`. `quando` é um instante com offset escrito; o horário é calculado em FUSO_DO_ESCRITORIO, porque o servidor roda em UTC.
  Usa:
  - `lerQuemAtende` e `quemResponde` (quem-responde.ts:182-202, 269-352);
  - o motivo da pausa (`ia_pausada_por`), lido à parte;
  - horário no relógio escolhido, por `dentroDoHorario` e `proximaAbertura` (horario.ts:44,70);
  - janela de 24 h da Meta, por `lerFimDaJanelaMeta` (retomada-fatos.ts:125);
  - teto: mensagens do agente desde greatest(etapa_desde, ia_retomada_em);
  - `etapaTemQuemFale` (engine.ts:4011);
  - as automações ligadas de nova mensagem e palavra-chave no escopo da conexão, sinalizadas como "depende da mensagem". Na CONTA, hoje, são 5 e 1 (consulta de 26/10).
- O diagnóstico aceita o rascunho de ligado, conexões, etapas e horário. Mostra, por exemplo, que marcar a etapa AGORA deixa o card atual como 'card antigo' (D27), com as duas datas.
- O cartão Diagnóstico aparece no Playground: lista ✓/✗ na ORDEM de quemResponde, com o motivo traduzido (chave montada, cobrada nos dois dicionários).
- Calendário da retomada: função pura `calendarioDaRetomada` sobre `proximaRetomada` (retomada.ts:227-272).
  - Usa `lerBloqueiosDaRetomada` do contato (lembretes e reunião, retomada-fatos.ts:44) e a janela da Meta da conexão.
  - Mostra quando cada tentativa k/n sairia, a partir de agora ou do relógio escolhido, e onde a série para (reunião próxima, cadência no fim, sem janela, 24 h).

**Arquivos:**
- src/app/api/cb/ia/agentes/[id]/playground/route.ts (conversaReal)
- novo: src/app/api/cb/ia/agentes/[id]/diagnostico/route.ts
- novo: src/lib/ia-agentes/diagnostico.ts (puro)
- src/lib/ia-agentes/retomada.ts (calendarioDaRetomada, puro)
- novo: src/components/agentes-de-ia/diagnostico-do-agente.tsx
- src/components/agentes-de-ia/playground-do-agente.tsx
- messages/en.json e messages/pt-BR.json (chaves montadas dos itens do diagnóstico)

**Migration:** Nenhuma.

**Depende de:** S1

**Riscos:**
- A conversa real é dado de cliente na tela do admin e vai ao provedor do agente, como na produção. Isso vale só para as conexões do agente (as `conexoes` vazias são NENHUMA). Nada fica guardado.
- O diagnóstico não sabe se uma automação de nova mensagem FALARIA para um texto específico (E4). Diz "depende" e lista quais existem. Nunca afirma ✓.
- O teto replica em TS a contagem da reserva (SQL). Ele é informativo; a última palavra continua com a reserva.
- Na escolha da conexão, vale a régua do canal pela conversa (`canalDaIaNaConversa`, quem-responde.ts:231), nunca pela conta.
- Leitura que falha aparece como "não se sabe", nunca como ✓ ou ✗ (lista vazia não vira afirmação).
- Relógio sem offset seria lido em UTC e erraria das 21h à meia-noite: a rota recusa.

**Testes:**
- diagnostico.test.ts:
  - um caso por motivo de quemResponde;
  - D27 nas duas datas;
  - horário com relógio fora e dentro, e próxima abertura;
  - janela da Meta fechada antes da abertura;
  - `quando` sem offset recusado.
- retomada.test.ts, calendarioDaRetomada: noite fora da janela empurrando as seguintes, lembrete a menos de 30 min e reunião a 90 min.
- Route test:
  - contato de outra conta dá 404;
  - conexão que não é da conversa dá 400;
  - conexão fora das `conexoes` do agente dá 400;
  - dublê sem escrita (só ai_usage_log quando gera).
- Teste que lê os dois dicionários para as chaves montadas do diagnóstico.
- E2E no preview com o lead de teste:
  - carregar a conversa real;
  - com o agente desligado, o diagnóstico diz 'desligado';
  - com o rascunho 'ligado + etapa', diz 'card antigo' com as datas;
  - o relógio de domingo às 23h mostra a próxima abertura;
  - nada muda (SELECT antes e depois).

#### S3a — Uma régua só, sem mudar comportamento (refatoração do turno e das ações) (M (2–3 dias))

**Objetivo:** Tirar do turno e da rota do Playground a régua que vem DEPOIS da geração, para ela servir ao Playground e à sombra sem cópia. Separar, em executar-acoes.ts, o que confere do que escreve. Num PR próprio, sem mudança de comportamento: mexe no caminho de PRODUÇÃO.

**Entregas:**
- Módulo puro novo `decisao.ts` com `decidirResposta`: a régua que vem DEPOIS da geração.
  - A ordem: sentinela, passagem, só marcadores, pedido vazado, link inventado, reunião prometida, ação prometida e, por fim, [[TRANSFERIR]] ou equipe prometida.
  - Diz o que executaria e o que ficaria de fora.
  - Hoje essa régua está duplicada INLINE no turno (turno.ts:1294-1398) e na rota do Playground (route.ts:325-413), e as duas já divergem em detalhe: o turno usa `linksInventados`, o Playground `linkInventado`. Passa a ser UMA.
- executar-acoes.ts é separado em `conferir<Acao>` (só leitura) e efeito.
  - O conferir cobre etapa de resultado, card fechado, já estava, campo vigiado, valor_invalido, automação fora da D5, desligada, fora da conexão ou da etapa.
  - `executarAcoes` = conferir + efeito, com comportamento idêntico ao de hoje.
  - `ensaiarAcoes` roda só o conferir.
  - ⚠️ Etiquetar e tirar etiqueta descobrem o "já estava" pela própria ESCRITA: o UNIQUE recusa o INSERT, e o DELETE volta com zero linhas (executar-acoes.ts:179-200). O conferir delas ganha uma LEITURA de contact_tags, e o efeito mantém a detecção pela escrita (a corrida continua do lado certo).
- `etapaDoAgente` exportado de turno.ts:801-836, sem mudança.

**Arquivos:**
- novo: src/lib/ia-agentes/decisao.ts (+ decisao.test.ts)
- src/lib/ia-agentes/turno.ts (troca o trecho inline por decidirResposta; exporta etapaDoAgente)
- src/app/api/cb/ia/agentes/[id]/playground/route.ts (usa decidirResposta)
- src/lib/ia-agentes/executar-acoes.ts (conferir × efeito; ensaiarAcoes)
- novo: src/lib/ia-agentes/decisao.chamadores.test.ts (pino)
- .claude/rules/ia-agentes.md e ia-agentes-turno.md

**Migration:** Nenhuma.

**Depende de:** S1

**Riscos:**
- Refatorar o turno mexe no caminho de PRODUÇÃO (turno.ts, 2.288 linhas). Mitigação:
  - um PR sem mudança de comportamento;
  - turno.test.ts (3.859 linhas) e executar-acoes.test.ts (610) verdes SEM mudar expectativa;
  - e2e de um turno real no lead de teste antes do merge.
- Unificar a régua expõe a divergência de hoje entre turno e Playground. A régua do TURNO vence; o Playground passa a mostrar o que a produção faria.

**Testes:**
- decisao.test.ts: todos os ramos, portados dos casos de turno.test.ts. turno.test.ts continua verde sem alteração de expectativa.
- Pino decisao.chamadores.test.ts: turno e Playground importam decidirResposta; a rota não chama mais linkInventado, acaoPrometida e reuniaoPrometida diretamente.
- executar-acoes.test.ts:
  - para cada ação, o código do ensaio é igual ao da execução;
  - dublê: ensaiarAcoes não escreve nada;
  - etiqueta que já estava: ensaio 'ja_estava' pela leitura, execução 'ja_estava' pela escrita.
- E2E no preview: um turno real no lead de teste, com agente ligado num funil de teste, igual ao de antes da refatoração (com o 'pode gravar' do operador).

#### S3b — Ensaio das ações e passagem encadeada no Playground (M (2–3 dias))

**Objetivo:** Mostrar o que a execução recusaria, ou faria sem mudar nada, e o que cada ação dispararia, sem executar. E levar a passagem até o destino responder.

**Entregas:**
- `ensaio.ts`: o que cada ação aceita DISPARARIA.
  - Automações ligadas de `deal_stage_changed` da etapa e de `tag_added` da etiqueta, pela régua do motor: `triggerMatches`, já exportado (engine.ts:3573). Não se mexe no arquivo do upstream.
  - Os passos delas resumidos por `descreverPasso` (src/lib/automations/descrever-passo.ts:74): "manda mensagem ao cliente", "webhook"…
  - Para "executar automação", os passos dela.
  - Para a reunião, o e-mail que iria e a pergunta obrigatória sem resposta.
- Sem contato escolhido, o ensaio diz "conferências da ficha precisam de um cliente". Nunca ✓.
- Passagem encadeada:
  - os destinos de "pode passar para" DESLIGADOS entram com aviso, e uma chave "só os ligados, como na produção hoje" os tira (ver SB2);
  - com conexão escolhida (S2), vale o mesmo recorte da produção: destino sem a conexão fica de fora (turno.ts:793);
  - a etapa do destino sai de `etapaDoAgente` (S3a);
  - se uma automação escuta essa etapa, a tela diz "ela falaria; o destino responde a próxima mensagem";
  - senão, uma 2ª geração com o pedido do DESTINO (sem passagens, como `veio_de_passagem`), com o provedor, o modelo e a chave DELE, aparece como bolha "IA · destino", com as ações dele ensaiadas;
  - passagem de passagem aparece como 'transferiria'.
- No Playground, cada ação ganha uma linha ✓/✗: "falharia: valor inválido para data", "já estava", "pode disparar: <automação> — manda mensagem ao cliente".

**Arquivos:**
- novo: src/lib/ia-agentes/ensaio.ts (+ ensaio.test.ts)
- src/app/api/cb/ia/agentes/[id]/playground/route.ts
- src/components/agentes-de-ia/playground-do-agente.tsx
- src/components/agentes-de-ia/textos.ts
- messages/en.json e messages/pt-BR.json
- .claude/rules/ia-agentes.md

**Migration:** Nenhuma.

**Depende de:** S3a

**Riscos:**
- O ensaio lê o estado de AGORA. A execução real acontece depois do envio, e o card ou a ficha podem mudar no meio. A tela diz "no momento do teste".
- "Dispararia" não avalia filtros internos da automação (canal, escopo) nem se ela rodaria de fato. Por isso o texto é "pode disparar". Hoje há 31 automações de entrada de etapa ligadas, de 33 (conferido em 26/10): 15 mandam mensagem, 6 mandam modelo e 1 manda webhook.
- Oferecer destinos desligados muda o pedido em relação à produção de hoje. Por isso a chave e o aviso.
- A 2ª geração da passagem custa uma chamada a mais (agente_teste, no id do destino).

**Testes:**
- ensaio.test.ts: triggerMatches com etapa listada, lista vazia (= qualquer etapa) e etiqueta.
- Route test: passagem para destino desligado com e sem a chave; destino sem a conexão escolhida fica de fora; a 2ª geração usa a chave do provedor do destino.
- E2E no preview: triagem desligada passando para um destino desligado com o lead de teste. Aparecem:
  - as duas respostas;
  - o "pode disparar";
  - o "valor inválido" de um campo de data.
  Nada muda (SELECT antes e depois).

#### S4 — Mídia no teste: áudio, imagem e PDF lidos sem gravar (M (2–3 dias))

**Objetivo:** Testar o caso central do Bancário (extrato, print, áudio) com o MESMO leitor da produção, sem gravar nada na mensagem.

**Entregas:**
- Módulo novo `ler-sem-gravar.ts`: bytes viram texto.
  - Reusa `escolherLeitor` (escolher-leitor.ts:26), `pedidoDeLeitura`, `lerRespostaDeLeitura` e `falhaPassageira` (leitores.ts).
  - Reusa a chamada de transcrição de `transcrever.ts`, extraída numa função exportada sem mudar o comportamento.
  - Mesmos tetos por provedor (`LIMITE_DE_BYTES`, `TEMPO_DA_LEITURA_MS`), e o bloqueio vira falha.
  - SEM cadeado e SEM gravar: `lerMidia` grava (ler-midia.ts:165-240).
- Rota POST /api/cb/ia/agentes/[id]/playground/midia (multipart, admin, com rate limit).
  - Teto do arquivo: 9 MB. O middleware casa /api (src/middleware.ts:99-101), e o proxy do Next 16 guarda só 10 MB do corpo (`proxyClientMaxBodySize`). Acima disso, o arquivo chega CORTADO.
  - A tela diz que a produção lê até 20 MB (TETO_PROPRIO_BYTES).
  - Devolve o texto no MESMO formato do contexto: `montarConversa` (já exportado, contexto.ts:126) com uma linha fingida.
  - O custo vai como agente_teste, com o provedor e o modelo de leitura.
- No Playground, "Anexar" (áudio, imagem, PDF) entra como mensagem do cliente com a leitura.
- Na conversa real (S2), "ler agora sem gravar" para mídias não lidas, só da conexão do agente.
  - O arquivo é baixado pela URL derivada do caminho (`getPublicUrl`), com `lerComTeto`.
  - O resultado vive só no navegador.
  - A tela avisa que essa leitura é paga e que a produção pagará de novo quando ler.

**Arquivos:**
- novo: src/lib/transcricao/ler-sem-gravar.ts (+ teste)
- src/lib/transcricao/transcrever.ts (extração da chamada, sem mudar o comportamento)
- novo: src/app/api/cb/ia/agentes/[id]/playground/midia/route.ts
- src/components/agentes-de-ia/playground-do-agente.tsx
- messages/en.json e messages/pt-BR.json
- .claude/rules/ia-agentes.md (o Playground deixa de ser só texto) e ia-tela-do-agente.md (texto IaAgentes.midia.*, se mudar)

**Migration:** Nenhuma.

**Depende de:** S1

**Riscos:**
- O admin envia documento de cliente ao provedor, o mesmo que a produção faz. Nada é guardado no Storage nem na mensagem.
- Arquivo entre 9 e 20 MB não se testa no Playground. Subir o `proxyClientMaxBodySize` é global: aumentaria a memória de toda rota. Fica de fora.
- Divergência entre ler-sem-gravar e ler-midia: as duas usam as MESMAS funções puras de leitores.ts e escolher-leitor.ts. Mudou a ordem dos leitores, os dois mudam juntos.
- Quem lê é a chave da conta, não o modelo do agente. O quadro QuemLeAMidia continua valendo.

**Testes:**
- ler-sem-gravar.test.ts com provedor falso:
  - imagem, PDF e áudio;
  - grande demais é recusado;
  - bloqueio é falha;
  - dublê sem nenhuma escrita.
- Route test: arquivo acima de 9 MB recusado com código próprio, antes de ler.
- Pino sandbox-sem-efeito: a rota de mídia não importa lerMidia nem transcreverAudio, os que gravam.
- E2E no preview com um PDF e um áudio FICTÍCIOS: o agente responde a partir da leitura, e messages do lead de teste fica sem transcricao nova.

#### S5a — Modo sombra (observação): motor, registro e poda (G (5–6 dias))

**Objetivo:** Ver o agente diante do tráfego real antes de ligá-lo. Na etapa dele, ele gera, confere e registra o que faria, sem enviar, sem executar, sem transferir, sem passar e sem armar retomada. A revisão mínima fica na aba Turnos.

**Entregas:**
- Estado do agente com três posições: Desligado | Em observação | Ligado, na Configuração e com selo na lista.
  - Ao entrar em observação, aparece um aviso de custo, da régua (SB3) e de que a conversa real vai ao provedor.
  - "Ligar" sai da observação NA MESMA escrita: o repo grava `sombra = false` sempre que grava `ativo = true`. A tela manda só `{ ativo: true }` (repo.ts:325-327), e sem isso o CHECK daria 23514.
  - Arquivar também zera `sombra`.
- Entrada: `QuemResponde` ganha a variante `{ quem: 'sombra', agenteId, dealId, stageId }`, avaliada no lugar de 'desligado' quando o agente não está ligado e está em sombra.
  - Depois dela continuam a conexão e a D27, esta contada de `greatest(desde, sombra_desde)`.
  - `lerQuemAtende` lê as colunas novas.
  - Todo `switch` sobre QuemResponde trata a variante: entrada, turno, faixa e diagnóstico.
- Fila: a entrada enfileira com `p_modo = 'sombra'`, com a mesma rajada de 8 s.
- Turno: o ramo da sombra é decidido pelo `modo` da LINHA, nunca pelo estado atual do agente. Ele:
  - confere como hoje;
  - usa o limitador próprio em vez do `aiAutoReplyAccount`;
  - lê a mídia conforme SB4;
  - gera;
  - aplica `decidirResposta` (S3a);
  - termina ANTES da reserva com status 'observado', gravando `desfecho_previsto` (responderia | transferiria | passaria | retida), `resposta_gerada` e as ações ENSAIADAS (`ensaiarAcoes`).
  Os desfechos que não afirmam envio (descartado, pausado_no_meio, falhou, sem_resposta) ficam como hoje.
  Nunca chama `mostrarDigitando` (a Meta marcaria a mensagem como lida), a reserva, `engineSendText`, `executarAcoes`, `transferirParaGente`, a passagem, `anotarNaConversa` nem `armarRetomada`.
- Teto próprio da sombra (SB10):
  - um limitador em memória, `ai-sombra:<conta>`, separado do `aiAutoReplyAccount` (turno.ts:1160): a sombra nunca come a vaga dos ligados. Ele vale POR PROCESSO (dois no deploy);
  - a guarda real é um teto diário por agente, contado no BANCO pelo índice parcial. Passou dele, o turno fica 'sem_resposta' com o motivo.
- Rede (rede.ts): os pendentes vencidos rodam com a PRODUÇÃO primeiro. A sombra usa só a sobra dos 10 por tique (TURNOS_POR_TIQUE, fila.ts:30). O recolhedor nunca transfere turno de sombra: sem `enviando_desde`, ele vira 'falhou'.
- Aba Turnos: filtro "Produção | Observação", com Produção como padrão. A rota de turnos filtra por `modo`. A linha de sombra mostra "Observado · <desfecho previsto>", com a resposta gerada e as ações ensaiadas expansíveis.
- A faixa da conversa trata o agente em sombra como "sem agente" para todos (SB6-A). Nem a linha "não atende" nem o "Retomar IA" aparecem por causa da sombra.
- Custo separado: modo `agente_sombra` em ai_usage_log, na aba Uso (MODOS de uso-de-ia.tsx:47; `porAgente` de uso.ts:114 ganha a coluna sombra).
- Poda dos turnos de sombra TERMINADOS, conforme SB7, dentro de `rede.ts` (topo de /api/automations/cron):
  - com intervalo mínimo entre podas;
  - DELETE em lotes limitados, que cabem no `-m` 50 s do laço rápido;
  - nenhuma rota nova no agendador, logo nenhum `docker stack deploy`;
  - ai_usage_log.turno_id vira nulo (SET NULL) e o custo fica.

**Arquivos:**
- supabase/migrations/<maior do main + 1>_cb_ia_modo_sombra.sql
- src/lib/ia-agentes/agente.ts (COLUNAS_DO_AGENTE, colunasDaAlteracao)
- src/lib/ia-agentes/repo.ts (ligar e arquivar zeram sombra)
- src/lib/ia-agentes/quem-responde.ts
- src/lib/ia-agentes/entrada.ts e src/lib/ia-agentes/fila.ts
- src/lib/ia-agentes/turno.ts
- src/lib/ia-agentes/rede.ts
- src/lib/ai/usage.ts, src/lib/ia-agentes/uso.ts, src/components/agentes-de-ia/uso-de-ia.tsx
- src/app/api/cb/ia/agentes/[id]/turnos/route.ts e src/components/agentes-de-ia/turnos-do-agente.tsx
- src/components/agentes-de-ia/configuracao-do-agente.tsx, lista-de-agentes.tsx, textos.ts
- src/app/api/cb/ia/conversa/[id]/route.ts e src/components/inbox/ai-thread-banner.tsx
- messages/en.json e messages/pt-BR.json
- novo: supabase/migrations/ia-modo-sombra-<num>.test.ts (pino lendo o SQL)
- .claude/rules/ia.md, ia-agentes-turno.md, ia-tela-do-agente.md; docs/PLANO-agentes-de-ia.md; docs/DECISOES-DO-OPERADOR.md (SB3, SB5, SB6, SB11); docs/MIGRATIONS-APLICADAS.md

**Migration:** ADITIVA, aplicada ANTES do deploy.

O número é o maior do main + 1, escolhido na hora com `ls supabase/migrations` e `list_migrations`. Hoje o maior aplicado é 1109, e as outras frentes da central também numeram. Os ALTER levam `SET LOCAL lock_timeout`.

1) cb_ia_agentes ganha `sombra boolean NOT NULL DEFAULT false` e `sombra_desde timestamptz`.
- `sombra_desde` é carimbada pelo BANCO num gatilho BEFORE INSERT/UPDATE: de false para true vira now(); de volta, null. É o molde de `cb_ia_carimba_ativado_em` (1049:122-133).
- A função do gatilho leva REVOKE de PUBLIC, anon e authenticated.
- CHECK nomeado: NOT (ativo AND sombra).

2) cb_ia_turnos ganha:
- `modo text NOT NULL DEFAULT 'producao'`, com CHECK nomeado (producao, sombra);
- `desfecho_previsto text`, com CHECK nomeado (responderia, transferiria, passaria, retida);
- `resposta_gerada text`: o texto sem marcadores que iria ao cliente. Coordenar com a coluna de "saída bruta" da frente de auditoria: uma só;
- o CHECK de `status` ganha 'observado' (o antigo cai pela FORMA e o novo entra com nome);
- CHECK nomeado de coerência: status = 'observado' só com modo = 'sombra' e `desfecho_previsto` preenchido, e `desfecho_previsto` só com 'observado';
- índices parciais (account_id, ia_agente_id, created_at DESC) WHERE modo = 'sombra' e (created_at) WHERE modo = 'sombra', para a revisão, o teto diário e a poda.

3) ai_usage_log: o CHECK de `mode` ganha 'agente_sombra'. O antigo cai pela FORMA e o novo é adicionado com nome, ANTES do código; senão `logAiUsage` engole o erro.

4) cb_ia_enfileirar_turno: DROP + CREATE com `p_modo text DEFAULT 'producao'`.
- A assinatura muda; o DEFAULT mantém o app velho funcionando.
- O corpo é o da 1056.
- O ON CONFLICT da rajada grava `modo` com o MESMO CASE que já decide agente, card e etapa (1056:125-160). Sem isso, um pendente de sombra trocaria de agente e rodaria como sombra um turno de produção, ou o contrário.
- REVOKE de PUBLIC, anon e authenticated, e GRANT de volta ao service_role.

5) cb_ia_reservar_envio: CREATE OR REPLACE com a MESMA assinatura e o corpo da 1080, mais uma linha logo depois da conferência da posse: turno com modo diferente de 'producao' devolve 'sombra'.
- É a trava do banco que não depende do estado do agente.
- O turno trata 'sombra' como descarte (Record exaustivo).
- REVOKE e GRANT como na 1080.

6) Conferência no banco VAZIO:
- CHECKs e colunas presentes;
- `cb_ia_enfileirar_turno` e `cb_ia_reservar_envio` CHAMADAS num subbloco desfeito por SQLSTATE próprio;
- prova de que a reserva devolve 'sombra' para turno de sombra e 'agente_desligado' para agente em sombra (sem dado, pula com RAISE NOTICE);
- `has_function_privilege('anon', …)` falso nas duas, e verdadeiro para service_role.

7) Lixeira e união: NENHUMA FK nova. cb_ia_turnos já está em cb_lixeira_tratamento ('nao_volta', 1102:263), e ai_usage_log já é tratado (1102:288, :312). A conferência afirma que `cb_lixeira_tratamento()` e `cb_unir_fichas` não acusam tabela sem tratamento.

**Depende de:** S3a

**Riscos:**
- Defesa em profundidade: o código VELHO com a migration aplicada (a janela até o deploy, ou o cron da produção durante o e2e no preview) vê o agente em sombra como 'agente_desligado'. Ele não enfileira, e um turno de sombra já na fila é DESCARTADO em `conferir` e na reserva, nunca enviado. No e2e, isso faz perder o turno: usar a vigia local do procedimento de 25 e 26/10.
- Leitor de cb_ia_turnos que esquecer `modo` não conta resposta que não saiu: o status 'observado' não casa com 'respondeu', 'transferiu' nem 'passou'. A aba Turnos, o painel da central e a futura auditoria filtram por `modo` mesmo assim. STATUS_DO_TURNO e as traduções passam a ler o CHECK novo.
- Sombra e ligado nunca coexistem numa conversa: o agente é o da etapa do card aberto mais recente (uma etapa, um agente). A rajada pode trocar o agente do pendente; o `modo` acompanha (migration, item 4).
- O agente em sombra SEGURA a etapa: nenhum outro pode ser ligado nela enquanto ele observa.
- MARCAR a etapa no agente já liga a pausa por gente, ligado, desligado ou em sombra (1049:640-647). Durante a observação, a equipe que responde pausa a conversa por 'gente'. Ao ligar, essas conversas continuam pausadas, como manda a D26. A faixa esconde isso da equipe durante a sombra (SB6).
- Custo: os 37 turnos de produção dos últimos 30 dias tiveram média de 2,7 mil tokens e máximo de 4,6 mil (consulta de 26/10). A conversa real mais longa, os blocos e a base aumentam isso.
  - O Bancário - Comercial teve 706 mensagens de cliente em 7 dias, em 133 conversas (consulta de 26/10).
  - Com a régua de SB3-A, é cerca de 1 a 2 turnos por card novo na etapa.
  - Estimativa grosseira: centavos de dólar por dia no Haiku 5.5.
  - Por fora do agente_sombra ficam: a leitura de mídia (SB4-A), que cai em 'transcricao' sem agente (ler-midia.ts:388); o embedding da pergunta, quando há base; e, com "Marcar reunião" ligado, a leitura dos horários na API do Calendly a cada turno.
- LGPD: a sombra manda a conversa real ao provedor sem benefício ao cliente, e com SB4-A também os documentos. `resposta_gerada` e o retrato são texto sobre cliente. Retenção conforme SB7.
- Gemini ou OpenAI fora do ar: a falha da sombra é só registro, nunca transfere (E8).
- E2E: marcar uma etapa REAL faria a sombra observar clientes reais e pausaria as conversas em que a equipe responder. O e2e usa um funil de TESTE, criado e apagado. Mesmo assim, criar ou mover o card do lead de teste dispara deal.created e deal.stage_changed ao único webhook de saída ativo (conferido em 26/10; a iMotion ouve deal.*): combinar com o operador antes.

**Testes:**
- quem-responde.test.ts: sombra no lugar de desligado; D27 contada por sombra_desde; ligado vence sombra; sem conexão dá 'fora_da_conexao'.
- turno.test.ts, modo sombra:
  - engineSendText, mostrarDigitando, cb_ia_reservar_envio, executarAcoes, transferirParaGente, anotarNaConversa e armarRetomada NUNCA são chamados;
  - as únicas escritas são cb_ia_turnos (retrato, status 'observado', desfecho_previsto, resposta_gerada, ações ensaiadas) e ai_usage_log 'agente_sombra'.
- turno.test.ts: o agente passa de sombra a ligado no meio, e o turno de sombra continua sem enviar; passa de ligado a sombra, e o turno de produção é descartado.
- repo test: PATCH `{ ativo: true }` com sombra ligada grava `ativo = true` e `sombra = false` numa escrita; arquivar zera sombra.
- rede test: turno de sombra órfão vira 'falhou' e nunca transfere; com 10 pendentes de produção, nenhum de sombra roda no tique.
- Pino lendo o SQL:
  - CHECK NOT (ativo AND sombra);
  - CHECK de coerência status × modo × desfecho;
  - p_modo DEFAULT e `modo` no ON CONFLICT;
  - a reserva recusa modo ≠ 'producao';
  - REVOKE e GRANT;
  - CHECK de mode com agente_sombra.
- Postgres descartável com dado e as restrições REAIS:
  - a reserva recusa turno de sombra ('sombra') e turno de agente em sombra ('agente_desligado');
  - a rajada que troca de agente leva o `modo` junto.
- envio.chamadores.test.ts continua: só o turno de produção passa iaAgenteId.
- E2E no preview, com o 'pode gravar' do operador, num funil de TESTE (uma etapa, sem automação):
  - agente em observação na etapa, com o lead de teste e mensagem simulada pelo webhook local;
  - conferir o turno modo 'sombra', status 'observado', com resposta e ações ensaiadas;
  - conferir que NÃO há mensagem bot nem anotação 'IA ·', que etiquetas e etapa do card não mudam e que conversations.ia_agente_id fica nulo;
  - a aba Turnos mostra a linha em "Observação";
  - limpeza ao final.

#### S5b — Sub-aba Observação: comparação com a equipe e gráfico (M (2–3 dias))

**Objetivo:** Revisar a observação com folga: o que a IA diria lado a lado com o que a equipe respondeu, e os números por dia e desfecho previsto, agregados no banco.

**Entregas:**
- Sub-aba "Observação" no detalhe do agente, pela rota admin GET …/sombra, paginada por CHAVE. Cada linha mostra:
  - a mensagem do cliente;
  - o que a IA responderia;
  - as ações ensaiadas, com a trava que reteria;
  - a 1ª resposta de GENTE depois da mensagem inicial da rajada, com a espera.
  Resposta de gente é `sender_id` OU `from_device`, sem `ia_agente_id`, e exclui a agendada (por `cb_scheduled_messages.message_id`).
- RPC de resumo, agregada no BANCO (o PostgREST corta em 1000). Ela agrupa:
  - por dia e desfecho previsto;
  - os códigos de trava e de ação que falharia;
  - a mediana da espera até a 1ª resposta da equipe nos turnos 'responderia'.
  É fechada: EXECUTE só para service_role. Reusar a RPC de agregação da frente do painel se ela já aceitar `modo`.
- Gráfico de barras por dia, empilhado por desfecho previsto, com o BarChart vendorizado do Tremor (src/components/tremor/bar-chart.tsx, recharts 3.10.1). É o mesmo de grafico-de-taxas.tsx e response-time-chart.tsx.
- Filtro por desfecho previsto e o botão "Ligar o agente", com o aviso da D27 (SB5).

**Arquivos:**
- supabase/migrations/<número na hora>_cb_ia_resumo_da_sombra.sql (ou a RPC do painel com `modo`)
- novo: src/app/api/cb/ia/agentes/[id]/sombra/route.ts
- novo: src/components/agentes-de-ia/sombra-do-agente.tsx
- src/components/agentes-de-ia/detalhe-do-agente.tsx (a aba nova)
- messages/en.json e messages/pt-BR.json (chaves montadas do desfecho previsto)
- .claude/rules/ia-tela-do-agente.md

**Migration:** Uma RPC de resumo, SECURITY INVOKER chamada pela rota em service role, com REVOKE de PUBLIC, anon e authenticated e GRANT ao service_role.

A conferência roda em banco vazio: CHAMA a função num subbloco desfeito por SQLSTATE próprio, e `has_function_privilege('anon', …)` dá falso.

Sem tabela e sem FK nova.

**Depende de:** S5a

**Riscos:**
- A espera da equipe é correlação, não economia. A IA teria respondido na hora, mas a resposta pode ser pior, e o turno que espera o horário só roda na abertura. A tela não fala em "tempo poupado".
- Com SB3-A, a amostra é quase só a 1ª resposta de cada card novo na etapa: a tela diz isso junto do gráfico.

**Testes:**
- Pino lendo o SQL da RPC: fechada, agrega no banco, filtra modo = 'sombra'.
- Rota: só admin; agente de outra conta dá 404; paginação por chave.
- Teste que lê os dois dicionários para as chaves do desfecho previsto.
- E2E no preview: a linha e o gráfico do turno observado no funil de teste da S5a.

#### S6 — Roteiros salvos: a bateria de regressão do agente (opcional) (M (2–3 dias))

**Objetivo:** Guardar roteiros de teste por agente e rodá-los todos contra o rascunho e o salvo a cada mudança, para ver o impacto de uma edição em vários casos de uma vez.

**Entregas:**
- Tabela de roteiros por agente.
  - Guarda nome e mensagens digitadas: papel cliente ou equipe, e texto.
  - Não guarda contato, conversa real nem resultado.
- "Salvar como roteiro" no Playground: só a parte digitada. A conversa real importada (S2) não é salva (SB9).
- "Rodar a bateria": cada roteiro roda com o salvo e com o rascunho, lado a lado.
  - Destaca onde mudou a ação, a passagem ou a trava.
  - Mostra a contagem de chamadas antes e anda no ritmo do teto de 20/min.

**Arquivos:**
- supabase/migrations/<número na hora>_cb_ia_roteiros.sql
- novo: src/lib/ia-agentes/roteiros.ts
- novo: src/app/api/cb/ia/agentes/[id]/roteiros/route.ts e [roteiroId]/route.ts
- novo: src/components/agentes-de-ia/roteiros-do-agente.tsx
- messages/en.json e messages/pt-BR.json

**Migration:** Uma tabela cb_ia_roteiros, com:
- id, account_id e ia_agente_id, com FK COMPOSTA (ia_agente_id, account_id) para cb_ia_agentes (id, account_id), ON DELETE CASCADE;
- nome, mensagens jsonb, criado_por com ON DELETE SET NULL, datas e UNIQUE (ia_agente_id, nome).

É FECHADA ao navegador, como cb_ia_turnos (D14; a variante "tabela fechada" de .claude/rules/supabase.md): RLS ligada sem policy, REVOKE ALL de anon e authenticated, GRANT ao service_role. A tela lê por rota de admin.

Não tem FK para contato, conversa, mensagem nem outra tabela do fecho da Lixeira. Fica FORA de cb_lixeira_tratamento e de cb_unir_fichas, e a conferência afirma isso.

Conferência em banco vazio com NOTICE.

**Depende de:** S1

**Riscos:**
- Roteiro com dado de cliente colado à mão. Aviso na tela; nada é importado da conversa real.
- Custo da bateria: N roteiros × M mensagens × 2 versões. Confirmação com a contagem.
- Sobrepõe-se ao "histórico dos testes" da frente de auditoria. Combinar: esta guarda ROTEIROS (entrada), a auditoria guardaria RESULTADOS.

**Testes:**
- Pino lendo o SQL: tabela fechada, sem FK de cliente, FK composta.
- Rota: só admin; o roteiro de outro agente ou de outra conta dá 404.
- E2E no preview: salvar 2 roteiros, mudar a instrução no rascunho, rodar a bateria e ver a diferença lado a lado.

#### S7 — Execução real num contato de teste (NÃO recomendada agora) (G+ (2 semanas ou mais))

**Objetivo:** Só se o operador escolher SB8-B: executar de verdade as ações num contato e card marcados como TESTE, sem que nada saia do CRM.

**Entregas:**
- Marca de teste numa tabela própria com FK para contacts. Ela entra em cb_lixeira_tratamento e em cb_unir_fichas no MESMO PR.
- Guarda GLOBAL de saída para contato de teste:
  - núcleo de envio (engineSendText e meta-send.ts, do upstream);
  - passos send_to_number e send_webhook;
  - webhooks deal.*;
  - Calendly (POST /invitees), Atlas e ZapSign.
- A fila do funil calada para card de teste: a migration em `cb_enfileira_evento_de_funil`.
- "Executar de verdade no contato de teste" no Playground, com limpeza ao final.

**Arquivos:**
- src/lib/flows/meta-send.ts e src/lib/automations/engine.ts (do upstream: uma linha na tabela de docs/MERGE-UPSTREAM.md)
- src/lib/webhooks/**, src/lib/ia-agentes/agenda.ts, integrações Atlas e ZapSign
- supabase/migrations/<número na hora>_cb_contatos_de_teste.sql

**Migration:** Tabela de contatos de teste (FK, Lixeira e união no mesmo PR) e a função de gatilho da fila do funil recriada para pular card de teste.

**Depende de:** S3b

**Riscos:**
- São 31 automações de entrada de etapa ligadas: 15 mandam mensagem, 6 mandam modelo e 1 manda webhook. Um esquecimento na guarda manda mensagem ou webhook de verdade.
- Há 1 webhook de saída ativo assinando deal.created e deal.stage_changed (consulta de 26/10): um card de teste que escape da guarda chega ao integrador (o erro da API desliga o cenário da iMotion).
- A guarda espalha regra por arquivos do upstream e por todo caminho de saída futuro.
- O valor marginal sobre o ensaio (S3b) e a sombra (S5a) é pequeno. O procedimento de engenharia continua cobrindo o ponta a ponta.

**Testes:**
- Só se aprovada: pino default-deny sobre todo caminho de saída com a guarda; e2e com número fictício.

### Fora do escopo da frente
- Execução real das ações e envio real em teste (S7/SB8). O ponta a ponta com WhatsApp continua sendo o procedimento de engenharia (servidor local, webhook local, vigia do cron), com limpeza à mão.
- O painel consolidado e as métricas de produção dos agentes (frente do painel). O sandbox só fornece o modo 'sombra', o status 'observado' e as linhas que o painel deve filtrar.
- Versões, "Publicar", retenção geral dos turnos, pedido completo guardado e origem 'ia' na trilha: frente de auditoria. O sandbox só consome versaoId quando existir (SB1-B).
- Base de conhecimento em rascunho (marcar documento sem salvar): a busca é pelo id do agente (cb_ia_buscar_conhecimento_*). O teste usa os documentos salvos.
- Subir o proxyClientMaxBodySize global para aceitar arquivo de 20 MB no Playground: o teto do teste fica em 9 MB.
- Simular no Playground o que só existe no transporte: a espera real da rajada de 8 s, o "digitando…", o eco e o recibo, a janela da Meta recusando de fato, a falha passageira com repetição e o cron.
- Retomadas na sombra: sem resposta enviada não há âncora. A sombra não arma retomada; o calendário do S2 cobre a previsão.
- A/B na produção: sombra de uma versão nova de um agente já LIGADO na mesma etapa. Uma etapa tem um agente só.
- Juiz automático por IA da qualidade das respostas da sombra. A comparação com a equipe fica lado a lado, para gente julgar.
- Instagram e grupos: fora do alcance dos agentes (D1 do Instagram; grupo não dispara IA).

### Correções do verificador sobre o desenho inicial
- S2: a conversa real só pode vir de conexão marcada no agente (salvo ou rascunho), senão 400. `conexoes` vazio = NENHUMA porque é dado de cliente indo a provedor externo e há números pessoais (.claude/rules/ia.md:231-232). O plano deixava escolher qualquer conexão da conversa.
- S2: a conversa real passa a ser lida pelo servidor a cada chamada (`conversaReal: { canalId }`) e não faz a volta pelo navegador. A rota corta `messages` em 20 e só aceita role e content (route.ts:33, :121-132). E `aiContextMessageLimit()` também é 20 por padrão (defaults.ts:136): o "não os 20 do Playground" não era a diferença.
- S2: o diagnóstico vira POST, porque carrega o rascunho. `quando` exige offset escrito e é calculado em FUSO_DO_ESCRITORIO: o servidor roda em UTC (CLAUDE.md 8f).
- S2: "hoje 5 e 1" são automações da CONTA, não da conexão. Conferido em 26/10: 5 new_message_received e 1 keyword_match ligadas.
- Fases: a S3 foi dividida em S3a (refatoração sem mudança de comportamento: decisao.ts e conferir × efeito) e S3b (ensaio e passagem no Playground). A refatoração mexe no caminho de PRODUÇÃO (turno.ts, 2.288 linhas), merece PR e e2e próprios, e a S5a depende só dela.
- S3a: etiquetar e tirar etiqueta descobrem o "já estava" pela própria ESCRITA: o UNIQUE recusa o INSERT, e o DELETE volta com zero linhas (executar-acoes.ts:179-200). O ensaio precisa de uma LEITURA nova de contact_tags, e o efeito mantém a detecção pela escrita. "conferir + efeito idêntico" não era automático.
- S3a: registrado que a régua de hoje já diverge entre o turno (`linksInventados`) e o Playground (`linkInventado`). Na unificação vence a do turno.
- S3b: com conexão escolhida (S2), a passagem aplica o mesmo recorte de conexão da produção (turno.ts:793), e a 2ª geração usa provedor, modelo e chave do DESTINO.
- S4: o teto de upload do Playground cai para 9 MB. O middleware casa /api (src/middleware.ts:99-101), e o proxy do Next 16 guarda só 10 MB do corpo (proxyClientMaxBodySize, doc em node_modules/next/dist/docs). Acima disso o arquivo chega cortado, e subir o limite é global.
- S4: `montarConversa` já é exportado (contexto.ts:126), então contexto.ts não muda. `escolherLeitor` mora em escolher-leitor.ts:26, não em leitores.ts.
- S4: "ler agora sem gravar" da conversa real só vale para as conexões do agente. E avisa que é pago e que a produção pagará de novo ao ler.
- S5: o turno de sombra termina com status próprio 'observado', mais a coluna desfecho_previsto, com CHECK de coerência status × modo. Reusar respondeu, transferiu e passou para uma resposta que nunca saiu faria qualquer leitor que esqueça `modo` (aba Turnos, painel, auditoria) contar envio que não houve: métrica que mente.
- S5: a reserva passa a recusar todo turno com modo ≠ 'producao'. O "ativo = false" só protege enquanto o agente está em sombra, porque a reserva olha o agente e não a linha (1080:265-272). Ligá-lo no meio de um turno de sombra tiraria a "segunda trava" que o plano prometia.
- S5: o ON CONFLICT de cb_ia_enfileirar_turno troca agente, card e etapa na rajada (1056:125-160). `modo` tem de entrar no mesmo CASE, senão um turno de produção rodaria como sombra, ou o contrário.
- S5: a rede roda até 10 pendentes por tique (fila.ts:30). A produção vai primeiro, e a sombra fica com a sobra. O recolhedor nunca transfere turno de sombra (pino).
- S5: o limitador `ai-sombra:<conta>` é em memória e vale por PROCESSO (dois no deploy). A guarda real é o teto diário contado no banco. SB10 foi ajustada.
- S5: ligar com a sombra ativa grava `sombra = false` na mesma escrita, porque a tela manda só `{ ativo: true }` (repo.ts:325-327). Sem isso, o CHECK NOT (ativo AND sombra) daria 23514. Arquivar também zera.
- Fases: a S5 foi dividida em S5a (motor, migration, poda, Uso, aba Turnos com filtro) e S5b (sub-aba Observação, gráfico e RPC de resumo). A fase de 1 a 1,5 semana misturava motor de produção e tela; a S5a já entrega revisão mínima pela aba Turnos.
- S5: o custo passa a ser estimado pelos 37 turnos reais de produção (média 2,7 mil tokens, máximo 4,6 mil; consulta de 26/10), não pela média do Playground. Ficam fora do agente_sombra: a leitura de mídia (vai em 'transcricao' sem agente, ler-midia.ts:388), o embedding da base e a leitura dos horários do Calendly a cada turno.
- S5, e2e: roda num funil de TESTE, nunca numa etapa real. Marcar a etapa já pausa as conversas reais em que a equipe responder (1049:616-669), e a sombra mandaria conversas de clientes ao provedor. Criar ou mover o card do lead de teste dispara deal.created e deal.stage_changed ao único webhook de saída ativo (conferido em 26/10; a iMotion ouve deal.*): combinar com o operador.
- Objetivo e S5: o efeito da pausa por gente nasce de MARCAR a etapa no agente, ligado ou não. O gatilho só confere se a etapa tem agente (1049:640-647); o plano o atribuía a "agente dono de etapa" sem dizer que vale para o desligado e o em sombra.
- Métrica "tempo que a IA teria poupado": renomeada para "espera até a 1ª resposta da equipe" e restrita aos turnos 'responderia'. Conta da mensagem INICIAL da rajada (mensagem_inicial_id), não do gatilho. Exclui a agendada por cb_scheduled_messages.message_id (CLAUDE.md 8d). A mediana é agregada no banco: lista paginada com corte de 1000 não sustenta mediana.
- Métrica "travas e ações que falhariam": a agregação vai para a RPC da S5b, não para a soma da lista paginada (corte de 1000 do PostgREST).
- GARANTIA: a S6 grava cb_ia_roteiros, o roteiro digitado. O plano dizia que de S1 a S4 e na S6 a única escrita era ai_usage_log.
- SB3: acrescentado o contra de LGPD. Em qualquer régua, a sombra manda a conversa real ao provedor sem benefício ao cliente, e com SB4-A também os documentos.
- SB4: acrescentada a opção C (ler sem gravar, da S4). Ficou dito que a leitura de imagem e PDF não aparece na bolha (o leitor filtra áudio) e que o custo da leitura vai como 'transcricao'.
- SB5: registrado que A é o comportamento natural do gatilho de ativado_em, que carimba ao passar de desligado a ligado (1049:122-133), sem código novo. B exige mudar a D27 e o código.
- SB11 nova: a observação pode começar antes do corte da Kommo? O plano põe o piloto só depois do corte. A sombra não envia, mas o card criado pela carga da Kommo conta como novo para a D27 (.claude/rules/ia.md:262-264).
- S1: o "Rodar o roteiro" com até 20 mensagens gasta o teto pessoal inteiro de um minuto (route.ts:100-105). A tela anda no ritmo do teto, e o 429 pausa e retoma em vez de virar erro.
- S7: registrado que há 1 webhook de saída ativo assinando deal.created e deal.stage_changed (consulta de 26/10), o que agrava o risco de um card de teste escapar da guarda.
