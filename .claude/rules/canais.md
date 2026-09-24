---
paths:
  - "src/lib/cb-channels/**"
  - "src/components/channels/**"
  - "src/hooks/use-channels*"
  - "src/hooks/use-channel-health*"
  - "src/components/settings/cb-channels-panel.tsx"
  - "src/app/api/cb/channels/**"
---

# Conexões (canais): UI e saúde — regras

Vale ao mexer em `src/lib/cb-channels/`, nos componentes e hooks de canal, no painel de Conexões e nas rotas `/api/cb/channels`. Qual número nesta conversa, cor do canal, janela de 24h e ampulheta da lista: `.claude/rules/canal-na-conversa.md`. Predicados de transporte: `.claude/rules/instagram.md`. Carimbo de canal e roteamento para o funil na entrada: `.claude/rules/ingestao.md`. Nome da instância Evolution: `.claude/rules/whatsapp-evolution.md`. Canal da Meta no envio: `.claude/rules/whatsapp-envio.md`.

### UI de canal: peças próprias, prefira reusá-las

`src/hooks/use-channels.ts`, `src/lib/cb-channels/display.ts` (puro) e `src/components/channels/` (`ChannelBadge`, `ChannelCell`, `ChannelScopeBadge`, `ChannelSelect`, `ChannelMultiSelect`, `ChannelFilter`).

- **Escopo vazio = TODOS os canais, nunca "nenhum"** — igual ao motor (`channelInScope`, `findEntryFlow`). Tela que diz "nenhum" onde o motor lê "todos" faz o operador desativar a regra errada.
- **Seletor some com menos de 2 canais:** numa conta de um número ele não decide nada.
- **Registro sem `channel_id` mostra travessão, nunca o canal padrão:** registro anterior à 903 pode ter vindo de outro número.
- **Filtro não esconde o irrestrito:** automação sem escopo dispara em todos os números e continua visível sob qualquer filtro.
- ⚠️ **`useChannels` tem DUAS metades no erro:** `channels: []`, cosmético para quem usa a lista como rótulo ou filtro; e `loading`/`falhou`, para quem converte a lista numa AFIRMAÇÃO (janela de 24h, "sem conexão" da nova conversa, recorte do Radar) — ali "não consegui perguntar" e "a conta não tem canal" são respostas opostas. O 200 com `{ channels: [], unavailable: true }` é FALHA.
- ⚠️ **Coluna nova de configuração entra em `CB_CHANNEL_SAFE_COLUMNS` (`repo.ts`) e na allowlist do PATCH**, senão salva e some no reload.
- ⚠️ **`radar_enabled` nasce FALSE e é `=== true` no PATCH** — a exceção DELIBERADA a "vazio = todos": o Radar manda conversa de cliente a um provedor de IA externo, e há canal de uso PESSOAL na conta. Não "corrigir" para a convenção.
- ⚠️ **O canal padrão recusa conexão do Instagram** (`set-default.ts`): o padrão responde conversa sem canal e alimenta o espelho `whatsapp_config`.
- **`channelsUsingPipeline`/`channelsUsingStage` (`display.ts`) dizem que conexão depende de qual funil ou etapa.** Apagar funil ou etapa zera `default_pipeline_id`/`default_stage_id` por SET NULL e o roteamento para em silêncio: caminho novo de exclusão avisa.
- ⚠️ **O DELETE de conexão (`/api/cb/channels/[id]`) barra ANTES de qualquer passo destrutivo quando há agendada na FILA** (`pending`/`sending`, 409 `scheduled_pending`): a FK da 925 é RESTRICT, e estourando no fim a instância da Evolution já teria sido destruída e o padrão promovido. O acervo (`sent`/`failed`) é apagado SÓ com o filtro de status — a agendada criada no meio estoura a RESTRICT em vez de sumir. Apagar a conexão PADRÃO exige sucessor NOMEADO no corpo (`promote_to`, escolhido na tela, e de WhatsApp): promover em silêncio faria o escritório disparar por outro número sem pedir. Sem outro WhatsApp, 409 `last_channel` (quem clica está tentando consertar — "Reparear").
- **`cb_channels` está na publicação realtime com LISTA FIXA de colunas** (909): coluna nova não viaja no payload. `use-channel-health` assina e só refaz a sonda; quem precisar LER coluna nova do payload reescreve a entrada na publicação.

### Saúde das conexões: TRÊS eixos, e o terceiro é "está entregando EM DIA?" (1002)

`src/lib/cb-channels/atraso-de-entrega.ts` (puro + `registrarEntrega`), as colunas `entrega_carimbo_em`/`entrega_recebida_em`, o ramo `lagging` de `toneFor` e a linha âmbar no popover do cabeçalho. Os dois eixos antigos (o estado do provedor × o frescor dessa informação) respondem "está DE PÉ?"; uma conexão `open` e fresca pode entregar com meia hora de atraso.

- ⚠️⚠️ **A fronteira SÓ AVANÇA:** conexão represada drena o backlog FORA DE ORDEM; guardando "a última que chegou", a mensagem antiga apagaria o alarme que a nova acendeu e a tela piscaria. A cerca é do BANCO (`entrega_carimbo_em.lt.<novo>` no UPDATE), nunca ler-então-escrever: o webhook trabalha em `after()`, e duas mensagens do mesmo canal correm em paralelo.
- ⚠️⚠️ **TODA condição de gravação vive no WHERE, e não pode depender do VALOR LIDO.** O espaçamento é predicado SQL; a transição que APAGA o alarme dispensa o espaçamento com `entrega_carimbo_em < corteDoAlarme(agora)` — coluna contra CONSTANTE. Sem cerca, concorrentes escrevem todos; compare-and-swap do valor lido PERDE a amostra saudável que corre com uma atrasada, e o alarme fica aceso até expirar. "recebida − carimbo > limiar" seria comparação entre duas colunas, que o filtro do PostgREST não faz; como alarme aceso exige medição fresca, `agora − carimbo` diz o mesmo. O SELECT anterior só decide se vale tentar; quem serializa é o banco.
- ⚠️ **`atrasoSeg` NULO é "não sei", nunca zero.** Nada é retroativo: `messages.created_at` guarda o carimbo do WhatsApp, e o instante da gravação não existia no acervo.
- ⚠️⚠️ **A medição TEM VALIDADE (1 h, `VALIDADE_DA_MEDICAO_MS`)**, senão uma amostra atrasada seguida de silêncio manteria `lagging` para sempre. `alarmeDeAtraso` (atraso E frescor) é o que a tela e o `toneFor` usam; `entregaAtrasada` fala da AMOSTRA, não do presente — confundir as duas é o defeito. Este eixo NÃO detecta a conexão que para de receber de vez (a medição envelhece e o alarme apaga): "não chega mensagem há tempo demais" é outro alarme.
- ⚠️⚠️ **A TELA lê `detail === 'lagging'`, nunca reavalia a régua:** recalcular no render precisa de `Date.now()` (o React Compiler reprova), e uma segunda cópia discordaria do glifo ao lado.
- ⚠️⚠️ **`lagging` NÃO impede ENVIAR:** `vivaParaEnviar` (régua do Asaas) aceita `ok` e `ENVIA_MESMO_EM_AMARELO` = {`webhook`, `lagging`} — os dois descrevem a ENTRADA; sem isso, um atraso de entrega adiava em silêncio as cobranças do dia. `pairing`/`stale`/`lastError` ficam fora. Amarelo novo: decidir por escrito de que lado fica.
- ⚠️ **O espaçamento de 1 min entre gravações é pelo REALTIME:** todo UPDATE em `cb_channels` faz `use-channel-health` refazer a sonda, e um backlog drenando sondaria dezenas de vezes por minuto.
- ⚠️ **Carimbo no FUTURO além de 2 min é recusado** (`TOLERANCIA_DE_RELOGIO_SEG`): o relógio do aparelho torto travaria a fronteira à frente e mascararia atraso real.
- ⚠️⚠️ **GRUPO fica de fora:** em grupo o `channel_id` gravado é o do webhook que CHEGOU PRIMEIRO; creditar por ali daria sempre ao número mais rápido a medição e deixaria de medir o lento.
- ⚠️ **São QUATRO call sites de `registrarEntrega`**, um por caminho de ingestão (`persistInboundMessage`, `persistDeviceMessage`, webhook da Meta, `instagram/persistir.ts`); o celular pareado conta. Quinto caminho de ingestão repete a chamada, senão a conexão deixa de ser medida sem erro nenhum.
- ⚠️ **`registrarEntrega` NUNCA lança** (`catch` para o que o supabase-js lança, leitura do `error` para o que ele devolve): é o que torna seguro o `await` na ingestão.
- **O limiar é 5 min, folgado de propósito:** o atraso normal é de segundos e os episódios, de dezenas de minutos — o limiar só precisa não dar falso positivo.
- ⚠️ **`useChannelHealth` expõe `falhou`:** o zero de uma sonda que não respondeu não autoriza afirmar "tudo em ordem"; o `unavailable: true` entra em `falhou`.
- ⚠️ **No Meu dia, atraso é fonte SEPARADA de "fora do ar"** (`conexoesAtrasadas`): o conserto é outro, e "N conexões fora do ar" seria falso sobre conexão de pé. O teste lá é `detail === 'lagging'`, não `tone === 'warn'` (`warn` inclui estados transitórios).
- ⚠️ **`tone_*` e `detail_*` são chaves MONTADAS** e escapam do portão de i18n. Pino: `src/components/channels/rotulo-da-saude.test.ts`, que COLHE os motivos do próprio `toneFor` em vez de digitá-los.
