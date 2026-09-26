# Migrations aplicadas — o registro

Documento INTERNO: descreve o banco da NOSSA produção e não vai para quem
instala. Uma entrada por migration aplicada: número e nome, o que faz, quando
foi aplicada, a entrada no histórico do Supabase e como foi conferida.

> ⚠️ **Para saber se algo está aplicado, consulte o SCHEMA** (catálogo,
> colunas, funções), não esta lista nem só o histórico do Supabase. Esta
> lista envelhece a cada branch em paralelo, e o histórico também não é
> completo: a 037 e a 947 estão aplicadas SEM registro (notas no fim).

**Ao aplicar uma migration, acrescente a entrada aqui, no mesmo PR.** O
ponteiro está na raiz do `CLAUDE.md` (seção 0, item g, e seção 7). A forma de
sempre:

- **NNNN_cb_nome** — o que faz, em uma ou duas frases; se é aditiva (entra
  antes do deploy) ou restritiva (depois); aplicada em DD/MM/AAAA pela
  Management API (histórico `AAAAMMDDhhmmss`), antes ou depois do merge do
  PR #N, com autorização do operador; como foi conferida (catálogo, e2e,
  Postgres descartável).

⚠️ **Nunca deduza o próximo número desta lista.** Rode `ls supabase/migrations/`
**e** `list_migrations` imediatamente antes de criar o arquivo: o número novo
é o maior do `main` + 1. As regras de migration estão na raiz (seção 7) e em
`.claude/rules/supabase.md`.

Como ler:

- Até 24/09/2026 esta lista vivia no `CLAUDE.md` (seção "Workflow de
  migrations") e foi movida sem reescrever. As referências a seções ("ver a
  seção X") são daquele arquivo: os títulos hoje moram em `.claude/rules/`
  (índice na raiz, seção 13), e o texto integral está em
  `git show f5879b3f:CLAUDE.md`.
- As entradas usam o número da época. Desde 14/09/2026 todo arquivo tem 4
  dígitos: "a 912" é o arquivo `0912_…`.
- O "(última conferência: 2026-08-28 …)" logo abaixo é da consolidação da
  lista naquela data. A última entrada é a 1041 (25/09/2026).

## Lista

⚠️ **Aplicadas até aqui** (última conferência: 2026-08-28, via Management
API). A lista é acumulada e foi consolidada nesta data — antes tinha camadas
repetidas com datas fora de ordem:

- **900–932** — as nossas até a agendada com mídia (`932`).
- **933–937** — gatilho e ações de funil, lembrete por data, orquestração,
  batimento das automações.
- **040/041/042** — as três do upstream renumeradas no merge de 2026-08-26.
- **940–943** — broadcast com canal, radar de atendimento, índices do radar,
  transcrição de áudio.
- **944_cb_tarefas** — painel de tarefas (PR #39).
- **945_cb_agenda_de_reunioes** — agenda, Fase 1 (PR #40). Aplicada em
  2026-08-28 e registrada no histórico como `20260828183655`.
- **946–947** — modelo do Radar e lembrete da reunião. ⚠️ A **947 está
  aplicada mas SEM registro no histórico** (função
  `cb_alvos_de_lembrete_reuniao` + índice conferidos no schema em
  2026-08-29) — é a segunda da lista da 037: o histórico não é fonte de
  verdade completa.
- **948–951** — plano do painel do contato (948 chave/tipos de campo, 949
  categoria de traqueamento, 950 etapa com resultado) e **951_cb_nota_fixada**
  (fixar anotação por cliente, 2026-08-29).
- **952_cb_lembrete_depois_de_realizada** — recria
  `cb_alvos_de_lembrete_reuniao` com `p_incluir_realizadas` (follow-up
  "depois" tem de aceitar reunião realizada) e alarga o índice parcial.
  Aplicada em 2026-08-30. ⚠️ DROP + CREATE, não REPLACE: parâmetro novo
  muda a assinatura e o REPLACE deixaria um overload ambíguo para o RPC.
- **953_cb_acervo_de_midias** — acervo de mídias da conta (`cb_media_library`),
  aplicada em 2026-08-30.
- **954_cb_acervo_so_admin_no_storage** — a guarda de papel do acervo também
  nas policies de Storage do `chat-media`. Aplicada em 2026-08-30.
- **955_cb_robo_parado_pela_equipe** — `stopped_by_agent` no CHECK de
  `flow_runs.status` (parada DECIDIDA por gente, via aba da conversa).
  Aplicada em 2026-08-30.
- **956_cb_perfis_de_acesso a 962_cb_papel_segue_o_perfil** — perfis de
  acesso, Fases 1–6 (PR #69). Aplicadas em 2026-08-30.
- **963_cb_conversa_aberta** — presença por conversa (tabela + RPC +
  realtime). Aplicada em 2026-08-30. ⚠️ NASCEU como `956` e COLIDIU com a
  `956_cb_perfis_de_acesso` (duas branches em paralelo); o replay do CI
  estoura com número duplicado, então o ARQUIVO foi renumerado no merge —
  o da presença, porque as 957–962 dependem da de perfis. O histórico do
  Supabase não muda (registra por timestamp), mesmo caso da 906.
- **964_cb_disparo_e_regras_so_admin** — as 12 policies de ESCRITA de
  `automations`, `automation_steps`, `flows`, `flow_nodes`, `broadcasts` e
  `broadcast_recipients` passam de `'agent'` para `'admin'`, alcançando a
  decisão que a Fase 2 dos perfis só tinha aplicado nas ROTAS. Aplicada em
  2026-08-31. SELECT continua aberto a qualquer membro da conta.
- **965_cb_transferencia_limpa_perfil** — `transfer_account_ownership`
  (018) passa a limpar `perfil_id` ao promover o novo dono: o caminho da
  transferência ficara fora da 962 e deixava a divergência papel×perfil
  presa num owner, irremovível pela UI. Aplicada em 2026-08-31.
- **966_cb_grupos_de_campos** — blocos de campos personalizados
  (`cb_grupos_de_campos` + `custom_fields.grupo_id`/`posicao` + as duas RPCs
  de ordenação). Aplicada em 2026-08-31. ⚠️ NASCEU como `965` e COLIDIU com
  a `965_cb_transferencia_limpa_perfil` — o TERCEIRO caso de duas branches
  em paralelo (depois da 906 e da 963), e o mais instrutivo: as duas foram
  APLICADAS no mesmo banco com 15 minutos de diferença, então o histórico do
  Supabase tem duas entradas `965` e nenhum comando reclamou. O `git merge`
  também passou limpo — são nomes de arquivo diferentes, então não há
  conflito para o Git relatar. Quem pega é o replay do CI, depois. O ARQUIVO
  foi renumerado (o desta, porque a outra já estava no `main`); o histórico
  não se mexe, como na 906 e na 963.
- **967_cb_filtros_salvos** — recorte nomeado da caixa de entrada
  (`cb_inbox_saved_filters`): DA CONTA, admin+ escreve e qualquer membro lê.
  Aplicada em 2026-08-31.
- **968_cb_filtro_padrao** — qual filtro salvo abre a caixa de entrada DE
  CADA MEMBRO (`cb_inbox_filtro_padrao`, uma linha por pessoa por conta) +
  o único `(id, account_id)` em `cb_inbox_saved_filters` que a FK composta
  exige. Aplicada em 2026-08-31.
- **969_cb_nome_do_anexo** — `messages.media_filename`: o nome do arquivo
  como o remetente o enviou. Aplicada em 2026-09-01. SEM backfill, de
  propósito (ver a seção "Nome do anexo").
- **970_cb_indice_da_agendada_por_mensagem** — índice PARCIAL em
  `cb_scheduled_messages(message_id) WHERE message_id IS NOT NULL`, para
  a pergunta "esta mensagem nasceu de agendada?" do Radar (worker e
  painel). Aplicada em 2026-09-01.
- **971_cb_transferencia_leva_o_acervo** — `transfer_account_ownership`
  reparenta `contacts`/`conversations`/`custom_fields` para o novo dono +
  backfill idempotente (medido: 0 linhas fora do dono em produção).
  Aplicada em 2026-09-01.
- **972_cb_aguardando_resposta** — `conversations.aguardando_desde` +
  três gatilhos (mensagem nova mexe no relógio; mensagem apagada
  recalcula; encerrar limpa) + acervo idempotente. Aplicada em 2026-09-02
  via conector, com autorização do operador, ANTES do merge do PR #106 —
  o app em produção só passa a ler a coluna quando o PR entrar. Medido na
  aplicação: 64 conversas esperando, 62 já além dos 10 min, 18 há mais de
  um dia. Sem a coluna o alerta simplesmente não aparece (vem `undefined`
  e a régua responde "ninguém esperando") — nada quebra.

- **973_cb_foto_do_contato** — `contacts.avatar_checked_at` (última
  conferência da foto de perfil na Evolution). Aplicada em 2026-09-03 via
  conector, ANTES do merge do PR #110 (o app grava a coluna) — conferida
  por leitura no PostgREST antes de mesclar.

- **974_cb_filtros_salvos_por_membro** — `cb_inbox_saved_filters.user_id`
  (dono; `DEFAULT auth.uid()` para a janela entre migration e deploy),
  policies "só as minhas", nome único por membro. Aplicada em 2026-09-03
  via conector, ANTES do merge; conferido: os 2 filtros ficaram com o
  criador.

- **975_cb_degrau_do_funil** — `pipeline_stages.degrau`, índice
  `cb_lead_events_funil_idx` e a RPC `cb_funil_trajetorias` (Fase 0 do
  funil comercial). Aplicada em 2026-09-04 via conector, ANTES do merge;
  conferido: 123 linhas no Bancário - Comercial, `anon` sem EXECUTE,
  `authenticated` com. Sem backfill de `degrau`, de propósito. ⚠️ O
  replay do CI reprovou a primeira versão: a conferência chama a RPC
  (SECURITY INVOKER) como `authenticated`, e em banco VAZIO ele não tinha
  SELECT em `contacts` — a migration passou a conceder SELECT nas seis
  tabelas que a função lê (no-op em produção). Função INVOKER conferida
  trocando de papel = GRANT nas tabelas que ela lê, sempre.

- **976_cb_meta_ads** — as três tabelas do Meta Ads
  (`cb_meta_ads_config` sem SELECT para `authenticated`, `..._campanhas`
  com a FK composta `(pipeline_id, account_id)` e `..._gastos` por dia).
  Aplicada em 2026-09-04 via conector, ANTES do merge; conferido por
  consulta: RLS ligada nas três, `anon` sem SELECT, `authenticated` sem
  escrita, `service_role` com INSERT.
- **977_cb_calendly** — `cb_calendly_config` (token e chave de assinatura
  cifrados, token de rota do webhook) e `cb_calendly_eventos` (cada
  agendamento recebido e o que aconteceu com ele; UNIQUE por invitee =
  idempotência). As duas FECHADAS para `authenticated` — a tela lê pela
  rota. Aplicada em 2026-09-07 via conector, ANTES do merge, com
  autorização do operador; conferido por consulta (RLS, grants, histórico).
  Plano em `docs/PLANO-integracao-calendly.md`.
- **978_cb_calendly_em_espera** — o CHECK de `cb_calendly_eventos.resultado`
  ganha `'em_espera'` (automação parada num "Aguardar"; Codex, 2ª rodada).
  Aplicada em 2026-09-07 via conector, ANTES do merge do PR #132;
  conferido no catálogo (o CHECK recriado com o mesmo nome que a 977 lhe
  deu, `cb_calendly_eventos_resultado_check`, e a entrada no histórico).
  Deploy antes dela não quebraria o app: `gravarResultado` falharia no
  CHECK só para automação parada em "Aguardar" (log de erro, a linha do
  evento ficaria `recebido`) — e a automação de produção não tem espera.
- **979–981** — variáveis do Calendly, o cadeado do Calendly e o
  endurecimento de apagar contato. (Aplicadas antes desta linha existir; a
  lista acima ficou parada na 978 por um tempo.)
- **982_cb_webhooks_de_entrada** — `cb_webhooks` (nome, token em claro,
  segredo cifrado, mapeamento de campos) e `cb_webhook_eventos` (o log, com
  o payload ACHATADO e o cadeado). As duas FECHADAS para `authenticated` —
  a tela lê pela rota. Aplicada em 2026-09-08 via conector, ANTES do merge,
  com autorização do operador; conferido por consulta (RLS ligada nas duas,
  `anon` e membro sem SELECT, `service_role` escrevendo, zero policies).

- **983_cb_etiqueta_sem_duplicata** — `tags.name_key` (coluna GERADA:
  aparada, sem acento, minúsculas) + índice único `(account_id, name_key)`,
  fechando a corrida que criava etiqueta duplicada. ⚠️ Duplicata que já
  existe é RENOMEADA com sufixo, NUNCA apagada: `tags.id` é referenciado
  por JSON que nenhuma FK protege — `automations.trigger_config.tag_id`,
  `automation_steps.step_config`, config de nó de fluxo e o recorte salvo
  da caixa de entrada (967) —, e apagar deixaria essas regras apontando
  para um id morto, parando de casar EM SILÊNCIO. Aplicada em 2026-09-09
  via conector, ANTES do merge; medido antes: zero duplicatas nesta
  instalação, então o desempate foi no-op aqui.
- **984_cb_chave_de_tag_normalizada** — recria `tags.name_key` com
  `normalize(..., NFD)` + apagar `[\u0300-\u036f]`, no lugar do
  `translate` de acentos precompostos da 983. Sem isso a forma DECOMPOSTA
  de um nome acentuado gerava outra chave e o índice único deixava a
  duplicata entrar. Aplicada em 2026-09-09 via conector, ANTES do merge;
  conferido: precomposta e decomposta geram a mesma chave, a 2ª inserção é
  barrada pelo índice, e zero colisões novas nesta instalação.

- **986_cb_anexo_grande** — `chat-media.file_size_limit` de 16 MiB para 50
  MiB, o teto que fazia o CRM descartar documento grande de cliente.
  Aplicada em 2026-09-09 via conector, ANTES do merge; conferido por
  consulta (52428800) e pela recuperação dos 6 anexos ainda vivos na
  Evolution.
- **987_cb_tldv** — `cb_tldv_config` (chave cifrada, FECHADA para o
  navegador) e `cb_reunioes_transcritas` (reunião + transcrição, do tl;dv
  ou colada à mão; SELECT por membro, escrita só pela rota). Aplicada em
  2026-09-09 via conector, ANTES do merge, com autorização do operador;
  conferido por consulta (as duas tabelas, `anon` sem nada,
  `authenticated` só com SELECT nas reuniões).
- **988_cb_rodizio_do_cron_do_meta_ads** — `cb_meta_ads_config.
  last_sync_attempt_at`, o carimbo de TENTATIVA por onde o cron ordena as
  contas (rodízio). Aplicada em 2026-09-09 via conector, ANTES do merge,
  com autorização do operador; conferido por consulta (a coluna existe e
  a tabela continua fechada para o navegador). ⚠️ Deploy ANTES dela
  quebraria o ciclo inteiro: o UPDATE do carimbo volta com `error` (o
  Supabase não lança) e a varredura segue, mas o `.order()` do cron
  reprova a consulta com "column does not exist" e a rota devolve 500 sem
  sincronizar conta nenhuma.
- **989_cb_instagram** — o terceiro transporte: `kind = 'instagram'` (o
  CHECK é recriado pela FORMA, não pelo nome), colunas `ig_*` em
  `cb_channels`, índice único GLOBAL por `ig_user_id`,
  `contacts.instagram_id`/`instagram_username` e **`contacts.phone`
  ANULÁVEL** com CHECK "telefone OU instagram". Aplicada em 2026-09-09 via conector, ANTES do merge do PR
  #167, com autorização do operador (o "faça o merge" veio depois de a
  dependência ser explicada, e o conector foi autorizado para isso);
  conferida por consulta: o CHECK renderizado como `kind = ANY
  (ARRAY[…])`, as 6 colunas, `phone` anulável, os 2 índices, histórico
  `20260909223424`. É **989**, não 987: a 987 (tl;dv) e a 988 (rodízio)
  nasceram em branches paralelas — quarto caso de colisão evitada.
- **990_cb_instagram_config** — o app da Meta por conta (Instagram App
  ID + Instagram App Secret CIFRADO), a credencial que o login do
  Instagram (OAuth) exige antes de existir canal. FECHADA para o navegador
  (a tela lê pela rota, que devolve só o App ID). Aplicada em 2026-09-09
  via conector (histórico `20260910003817`), ANTES do merge do PR #189 e
  DEPOIS de o replay do CI passar; aditiva — nada em produção a lê até o
  deploy. Conferida por consulta: RLS ligada, `anon` e `authenticated`
  sem SELECT, `service_role` com INSERT.

- **991_cb_janela_da_meta_na_conversa** — `conversations.janela_meta_desde`
  + `janela_meta_canal_id` (a última mensagem do CLIENTE pela API oficial,
  e por qual número), gatilho em `messages` e acervo — o fato que a
  ampulheta da lista lê. Aditiva: sem ela o app degrada (a ampulheta não
  aparece), nada quebra. Aplicada em 12/09/2026 ANTES do merge do PR #194,
  SEM o conector: pela Management API (`POST /v1/projects/<ref>/database/
  migrations`, o mesmo endpoint do `apply_migration` do conector, que
  registra no histórico), com o access token digitado pelo operador num
  `read` silencioso no terminal dele — a CLI 2.75 não tem comando de SQL e
  guarda o token codificado no Keychain. Conferida por consulta REST feita
  pelo navegador logado do preview (1 conversa carimbada; nenhuma dentro
  das 24h). ⚠️ SUBSTITUÍDA pela 993 no mesmo dia: as duas colunas foram
  REMOVIDAS. Não "corrigir" o app para lê-las de volta.
- **993_cb_janela_da_meta_por_numero** — `conversations.janela_meta jsonb`
  (mapa número → instante + `sem_carimbo`), a função do gatilho da 991
  reescrita para gravar na chave do número, o gatilho de dobra na exclusão
  de conexão oficial, acervo refeito de `messages` e a remoção das colunas
  da 991. Corrige a divergência lista×fio com dois números oficiais
  (revisão + Codex no PR #194). Aditiva para o app anterior (lê `select *`,
  degrada sem ampulheta) — aplicada ANTES do merge, como as outras. ⚠️
  NASCEU como `992` e COLIDIU com a `992_cb_asaas_config`, que OUTRA
  sessão aplicou em produção no mesmo dia (histórico `20260912144829`)
  antes de o arquivo dela chegar a qualquer branch remota — o QUINTO caso
  de duas branches em paralelo (906, 963, 966, 989). Pego pela conferência
  de deriva por consulta ao histórico, feita ANTES de aplicar; renumerado o
  arquivo que ainda não estava aplicado (este). `ls` sozinho não pegaria:
  a 992 do Asaas não existia em branch nenhuma — só no banco.

- **992_cb_asaas_config** — a CONEXÃO do Asaas: a chave da API cifrada,
  o nome dela e a validade opcional, FECHADA ao navegador. Aplicada em
  12/09/2026 pela Management API (histórico `20260912144829`), ANTES do
  merge. Nasceu 991 e colidiu com a `991_cb_janela_da_meta_na_conversa` —
  a quinta colisão de branches em paralelo.
- **994_cb_asaas_espelho** — `cb_asaas_clientes` (o vínculo com a ficha,
  `candidatos`, `contatos_recusados`, origem com o valor `criada` da D2)
  e `cb_asaas_cobrancas` (toda cobrança já vista vencida, mais a que vence
  hoje). As duas FECHADAS ao navegador (o CPF só sai mascarado, pela rota
  do administrador). Aplicada em 12/09/2026 à noite pela Management API
  (histórico `20260912225955`), ANTES do merge, dentro do "faça tudo" do
  operador; conferida por consulta (RLS, `anon`/`authenticated` sem SELECT,
  `service_role` com INSERT). Aditiva: nada em produção a lê até o deploy.
- **995_cb_asaas_ciclo_e_etiqueta** — `cb_asaas_config.sincronizando_desde`
  (o CADEADO do ciclo) e `cb_asaas_clientes.etiqueta_pendente` (a etiqueta
  `asaas` que não ficou gravada na criação), as duas pedidas pela revisão
  do PR #201. Aplicada em 12/09/2026 à noite pela Management API
  (histórico `20260912234246`), ANTES do merge; aditiva.
- **996_cb_asaas_vinculo_completo** — `cb_asaas_config.vinculo_completo_em`,
  o marcador de que o VÍNCULO da listagem vigente já rodou (5ª a 7ª
  rodadas do Codex no PR #203) — a tela precisa saber quando "ninguém
  deve" é resposta. Hoje coincide com `last_sync_at` (a versão que só
  carimbava sem ficha adiada foi revista pela revisão independente: cliente
  sem ficha não tem conversa a esconder). Aditiva, com acervo do
  `last_sync_at`. Aplicada em 13/09/2026 pela Management API (histórico
  `20260913122337`), ANTES do merge.

- **997_cb_asaas_webhook** — as colunas do webhook em `cb_asaas_config`
  (token da URL em claro com índice único parcial; token de autenticação
  CIFRADO; id no Asaas, e-mail, estado, erro, religado, conferido, último
  evento) e `cb_asaas_eventos` (FECHADA; UNIQUE por conta e id do evento;
  o `dateCreated` do evento CRU, em texto — a medição de C7). Aditiva:
  nada em produção a lê até o deploy. Aplicada em 13/09/2026 pela
  Management API, ANTES do merge.
- **998_cb_asaas_regua** — a régua de cobrança (Fase 3, PR #206):
  `cb_asaas_config.regua_ativa`/`regua_ativada_em`/`regua_intervalo_dias`,
  `cb_asaas_clientes.regua_desligada` (+ por quem/quando — a lista de
  exceção), `automations.assinatura_personalizada`, o índice único
  `cb_asaas_cobrancas (id, account_id)` que a FK composta exige, e
  `cb_asaas_regua_envios` (a trava E o histórico; FECHADA ao navegador;
  UNIQUE por marco; nove resultados, `na_fila` incluso; `automation_log_id`).
  Aditiva (colunas com default; a tabela nasce vazia). ⚠️ O deploy tem de
  vir DEPOIS dela: três rotas selecionam as colunas por nome (ver a seção
  da régua). Aplicada em 13/09/2026 pela Management API (histórico
  `20260913211455`), ANTES do merge; a lista de exceção do operador (38
  clientes do Asaas) marcada em seguida por script fora do repositório.
- **999_cb_nome_fixado** — `contacts.nome_fixado_em`, a marca que impede os
  caminhos automáticos de trocar o nome da ficha pelo do perfil do WhatsApp
  (o nome do agendamento do Calendly, e o nome escrito à mão). Aditiva.
  Aplicada em 14/09/2026 pela Management API (histórico `20260914140125`),
  ANTES do merge do PR #208 e DEPOIS de o replay do CI passar. ⚠️ O deploy
  tem de vir DEPOIS dela: sem a coluna, a guarda dos três caminhos faz o
  PostgREST recusar o UPDATE de nome (o nome para de acompanhar o WhatsApp,
  sem quebrar nada) e o Calendly não consegue fixar o nome (vira aviso no
  detalhe do evento).
- **1000_cb_campo_email_espelhado** — `custom_fields.espelho`, o campo
  "E-mail" semeado em cada conta, o acervo dos e-mails já gravados, os dois
  gatilhos de espelho, a proteção contra apagar e a semeadura de conta nova.
  ⚠️ Depende da renomeação para 4 dígitos (PR #209): com 3, `1000_`
  ordenaria antes das 900. ⚠️ Deploy DEPOIS dela: o catálogo lê `espelho`
  para trocar a lixeira pelo cadeado. Sem a coluna, a tela só não mostra o
  cadeado — nada quebra. Aplicada em 14/09/2026 pela Management API (histórico
  `20260914155014`), ANTES do merge, depois de a revisão adversarial achar
  e a própria migration corrigir a `redeem_invitation` (todo convite seria
  recusado).
- **1001_cb_email_espelhado_normalizado** — dois gatilhos BEFORE que aparam
  a LINHA DE ORIGEM (o e-mail da ficha e o valor do campo espelhado) antes do
  espelho, com `cb_email_normalizado` (`[[:space:]]` das pontas; vazio na
  ficha vira NULL). A 1000 aparava só o lado espelhado, e automação/API com
  espaço deixavam os dois lados com textos diferentes (Codex, PR #210).
  Migration nova porque a 1000 já estava aplicada.

⚠️⚠️ **A 999 foi o ÚLTIMO número de 3 dígitos.** O replay do CI aplica as
migrations em ordem de NOME (`fs.ReadDir`, lexicográfica), e `1000_`
ordenaria ENTRE a `042_` e a `900_`. Decisão do operador em 14/09/2026:
todos os arquivos passaram a ter 4 dígitos (PR #209) — a 999 nasceu
`999_` e virou `0999_` no merge. As entradas desta lista seguem com o
nome da época em que foram aplicadas.

- **1002_cb_atraso_de_entrega** — `cb_channels.entrega_carimbo_em` e
  `entrega_recebida_em`: a fronteira de entrega por conexão, que a sonda de
  saúde lê para o terceiro eixo (ver a seção própria). Aditiva — o app
  anterior não as lê e degrada sem alarme. Aplicada em 16/09/2026 pela
  Management API (histórico `20260916164400`), ANTES do merge do PR #220,
  com autorização do operador; conferida por consulta (as 2 colunas,
  `anon` sem SELECT) e testada antes num Postgres 16 limpo (banco vazio,
  idempotente, os 4 cenários da cerca do UPDATE).
- **1003_cb_gravada_em_na_mensagem** — `messages.gravada_em timestamptz`
  com `DEFAULT now()` (ADD sem default, SET DEFAULT depois: as linhas
  antigas ficam NULL, "não medido"). É o instante em que o CRM gravou a
  linha, que NÃO existia: `created_at` recebe o carimbo do WhatsApp na
  ingestão. Instrumento da verificação do atraso de entrega (PLANO-baileys-7,
  5.10): `gravada_em − created_at`, por mensagem, todas as conexões, com
  história — a 1002 guarda só a fronteira atual e o log da Evolution roda a
  30 MB. Nenhuma linha de código a escreve. Aditiva. Aplicada em
  17/09/2026 12:39:17 BRT pela Management API (histórico `20260917153917`),
  20 s ANTES do rollout da imagem `-foto` — o "antes" e o "depois" são
  medidos com o mesmo instrumento (a fronteira é `2026-09-17 15:39:37+00`).
- **1004_cb_indice_da_fila_por_execucao** — índice cheio em
  `automation_pending_executions (log_id)`: a guarda de `fecharLog` e as
  varreduras das irmãs (todo cancelamento) perguntam por execução, e a fila
  não é podada (`done`/`cancelled` ficam para sempre). ⚠️ O cabeçalho do
  SQL diz que `execucaoJaInterrompida` também lê a fila — era verdade no
  dia da aplicação; desde a 1005 ela lê `automation_logs.interrompida_em`
  por chave primária, e o SQL aplicado não foi reescrito (comentário).
  Aditiva: sem ela tudo responde certo, só devagar; pode entrar antes ou
  depois do deploy. Medido antes: a tabela estava VAZIA em produção (nenhuma
  automação ativa tinha "Aguardar"). Aplicada em 18/09/2026 pela Management
  API (histórico `20260918162117`), ANTES do merge do PR #223, com
  autorização do operador; conferida por consulta ao catálogo (o índice
  existe ao lado de `idx_automation_pending_due` e `_account`).
- **1005_cb_execucao_interrompida** — `automation_logs.interrompida_em` +
  `interrompida_por` (CHECK com os cinco motivos), o índice parcial das
  execuções vivas por contato, e a função `cb_estacionar_espera` — a
  ÚNICA porta da fila pelo motor (trava o registro, confere a marca,
  insere). ⚠️ Aplicar ANTES do deploy: sem a função todo "Aguardar" falha
  de forma visível ("function does not exist") — nada sai errado ao
  cliente, mas nenhuma sequência estaciona. `SECURITY INVOKER`, EXECUTE só
  do `service_role` (as duas metades do REVOKE, conferidas). Aplicada em
  19/09/2026 pela Management API (histórico `20260919185044`), ANTES do
  merge do PR #223, com autorização do operador e depois de o replay do CI
  passar; conferida por consulta ao catálogo (colunas, função, privilégios,
  índice, CHECK) e por e2e contra o banco real: a função estaciona a
  execução limpa, devolve `null` para a marcada, e o CHECK recusa motivo
  fora do vocabulário.
- **1006_cb_indices_da_estadia_e_da_resposta** — três índices para as duas
  consultas novas do PR #223: `messages (conversation_id, gravada_em desc)`
  PARCIAL em `sender_type = 'customer' and deleted_at is null` (a segunda
  linha de defesa — o predicado ESPELHA os filtros de `clienteRespondeuDesde`,
  senão o planejador ignora o índice; pino em `indices-1006.test.ts`) e
  `cb_automation_events (account_id, deal_id|contact_id, tipo, criado_em
  desc)` (a estadia, que roda antes de cada passo de toda automação presa).
  Aditiva, idempotente, pode entrar antes ou depois do deploy; o CREATE
  INDEX em `messages` segura as escritas por alguns segundos (Codex, 13ª
  rodada). Aplicada em 19/09/2026 pela Management API (histórico
  `20260919205923`), DEPOIS do replay verde do CI e com autorização do
  operador; conferida por consulta ao catálogo (os três índices, com o
  predicado parcial de `messages` renderizado como
  `sender_type = 'customer' AND deleted_at IS NULL`).

- **1007_cb_titulo_do_card_pelo_nome**, **1008_cb_titulo_de_reserva_nao_e_nome**
  e **1009_cb_tira_o_prefixo_que_sobrou** — o título do card (PRs #225 e
  #228, outra sessão). Aplicadas em 19/09/2026 (histórico `20260919222628`,
  `20260919224838` e `20260919232435`); o que fazem está na seção "O TÍTULO
  DO CARD é o NOME da pessoa".
- **1010_cb_mensagens_sem_telefone** — `cb_mensagens_sem_telefone` (a
  mensagem 1:1 que chegou em `@lid` sem telefone: retida, entregue ou
  duplicada; FECHADA ao navegador; payload só enquanto `retida`) e a função
  `cb_assentar_mensagem_historica` (desfaz o que o gatilho da 972 decidiu
  pela ordem de inserção depois de um insert com carimbo antigo; `SECURITY
  INVOKER`, EXECUTE só do `service_role`, com a conferência trocando de
  papel). Aditiva: nada em produção a lê até o deploy, e o app TOLERA a
  ausência dela (medido em 19/09 contra a produção, antes de aplicar) — mas
  a regra continua sendo aplicar ANTES do merge. ⚠️ NASCEU como `1007`,
  virou `1009` e só então `1010`: colidiu DUAS vezes no mesmo dia com as
  migrations do título do card (1007/1008 do PR #225 e 1009 do PR #228), que
  outra sessão foi mesclando e aplicando em produção enquanto este PR estava
  aberto — o SEXTO e o SÉTIMO casos de branches em paralelo (906, 963, 966,
  989, 992). A primeira foi pega pela revisão em duas lentes e pelo
  `list_migrations`; a segunda, pelo CI do PR (o replay estoura com
  `schema_migrations_pkey`, e `nomes-das-migrations.test.ts` reprova) — as
  duas ANTES de aplicar, e é para isso que a ordem "CI verde → aplicar"
  existe. Renumerado sempre o arquivo que ainda não estava aplicado (este).
  Aplicada em 19/09/2026 pela Management API (histórico `20260919234759`),
  ANTES do merge do PR #226, com autorização do operador e DEPOIS de o replay
  do CI passar; conferida por consulta ao catálogo (RLS ligada, zero policy,
  `anon`/`authenticated` sem nada, `service_role` com tudo, a função com os
  cinco parâmetros e EXECUTE só do `service_role`) e por e2e contra o banco
  real, no preview: tardia, nova, histórica, retida, Meu dia, religação e
  reentrega (plano, 6.3). Testada antes num Postgres 16 descartável — banco
  limpo só com as concessões dela, idempotente, 20 cenários com o gatilho
  real da 972.

- **1011_cb_historica_eco_e_resposta_concorrente** — só troca o CORPO de
  `cb_assentar_mensagem_historica` (mesma assinatura e privilégios): no ramo
  do eco posterior à espera, a fala de cliente que fica "esperando" tem de
  ser uma que ninguém respondeu depois (achado do Codex no PR #226).
  Migration nova porque a 1010 já estava aplicada. Confere que sobrou UMA
  função com esse nome e prova o EXECUTE trocando de papel. Aditiva — nada em
  produção chama a função até o deploy. Aplicada em 19/09/2026 pela
  Management API (histórico `20260920000843`), ANTES do merge do PR #226 e
  DEPOIS de o replay do CI passar; conferida no catálogo (UMA função, a mesma
  assinatura, o corpo com a guarda, `SECURITY INVOKER`, EXECUTE só do
  `service_role`) e por e2e no preview contra o banco real — o eco do
  escritório sem telefone (plano, 6.4). Testada antes num Postgres 16
  descartável: o defeito reproduz com a função da 1010 e some com a 1011,
  idempotente, os 20 cenários anteriores verdes.
- **1012_cb_kommo_lead_id** — `deals.kommo_lead_id bigint` com índice único
  PARCIAL `(account_id, kommo_lead_id) WHERE kommo_lead_id IS NOT NULL`: a
  chave que torna a carga da Kommo REEXECUTÁVEL. A decisão 16 do operador
  pôs o id do CONTATO num campo personalizado, e isso não alcança o NEGÓCIO
  (campo personalizado só existe em contato, e uma pessoa pode ter mais de um
  card). O plano mandava guardar o id do lead em
  `cb_lead_events.details->>'kommo_lead_id'`, e o teste de esforço mediu o
  preço: "já migrei este lead?" vira 12.389 varreduras completas sobre uma
  tabela que vai a ~62.000 linhas, e sem restrição única quem pular a
  pergunta duplica 28.316 eventos em silêncio. Único por CONTA (duas contas
  podem importar de Kommos diferentes) e PARCIAL (quase todo negócio nasce
  aqui com a coluna nula). Aditiva — nada em produção lê a coluna até a carga
  existir. Aplicada em 20/09/2026 pela Management API (histórico
  `20260921003408`), ANTES do merge do PR #232 e DEPOIS de o replay do CI
  passar; conferida no catálogo (tipo `bigint`, e o índice renderizado com
  UNIQUE, `account_id` e o WHERE — os três predicados que o bloco de
  conferência da própria migration cobra).

- **1014_cb_kommo_carga_em_lote** — a carga da Kommo: o schema
  `migracao_kommo` com o **livro-razão** e as funções
  `cb_kommo_carregar_lote` / `cb_kommo_desfazer`.
  ⚠️⚠️ **A função DESLIGA os gatilhos de `deals` e `contact_tags` DENTRO da
  transação do lote** — não repara a trilha depois. Duas medições
  escolheram: (1) `ALTER TABLE ... DISABLE TRIGGER` é **DDL transacional**,
  então o rollback religa sozinho e não existe "desligado e esquecido"; (2)
  é a ÚNICA forma de a carga gravar `updated_at` com a data da Kommo, porque
  `set_updated_at` é BEFORE UPDATE sem lista de colunas e sobrescreve com
  `now()` (medido: pedindo 2024-03-15 a coluna vira a data de hoje). A trava
  é `ShareRowExclusive`, não ACCESS EXCLUSIVE — leitor não espera. As FKs
  ficam de pé (são gatilhos internos), ao contrário de
  `session_replication_role = 'replica'`, que as derruba junto.
  ⚠️ Com os gatilhos calados a função DEVE escrever à mão o `status` (o que
  a 950 faz), o `updated_at` e a trilha retroativa.
  ⚠️ O livro-razão mora em `migracao_kommo`, **não em `public`**: lá herdaria
  a concessão padrão do Supabase e nasceria legível do navegador com id e
  nome de todo contato. Ele guarda `detalhe jsonb` para a chave que não cabe
  num uuid (`contact_tags` é (contato, etiqueta) — sem isso o desfazer
  tiraria as etiquetas que o escritório aplicou à mão).
  ⚠️ `cb_lead_events.deal_id` não tem FK, então o desfazer apaga a trilha
  EXPLICITAMENTE antes do card; no card movido, só o que a carga escreveu,
  recortado pela procedência em `details`.
  Aplicada em 21/09/2026 (histórico `20260921023141`), DEPOIS de o replay do
  CI passar no commit exato e de dois ensaios contra a produção em
  transação encerrada com ROLLBACK: carga + reexecução (idempotente) e
  carga + desfazer (o banco volta ao estado anterior, card movido inclusive).
- **1015–1023 — a carga da Kommo e o encerramento em lote**, todas aplicadas
  em 21/09/2026, cada uma DEPOIS de um ensaio contra a produção em
  transação encerrada por `raise exception` (histórico `20260921024652` em
  diante):
  · **1015** — os três achados do PRIMEIRO piloto: `deals.value` é NOT NULL
    (NULL explícito anula o default), `deals.currency` nasce `'USD'` numa
    base BRL, e o livro-razão não cobria `contacts`.
  · **1016** — `cb_kommo_carregar_pessoas` e `cb_kommo_carregar_conversas`,
    e o desfazer passou a cobrir o que as duas criam.
  · **1017** — o lote MOVE o card que já existe (honra `deal_id`, grava
    `created_at`/`title` da Kommo) e a trilha nasce com rótulo e posição; o
    passo de pessoas cala os gatilhos de `deals` e registra no livro o
    título que o gatilho da 1007 troca; a linha RETIDA fica no livro
    (`v_presas`), para o desfazer ser repetível.
  · **1018** — `cb_encerrar_conversas_abertas` e
    `cb_desfazer_encerramento_em_lote`, com a foto de antes em
    `migracao_kommo.conversas_antes_do_encerramento`. Grupos ficam de fora
    por padrão (ver a nota sobre `cb-groups/persist.ts`).
  · **1019** — `stage_changed` sem `to_pipeline_id` é recusado na entrada e
    na conferência de saída.
  · **1020** — três corridas (Codex, PR #232): o encerramento pula conversa
    com mensagem do cliente gravada nos últimos 2 min (`FOR UPDATE … SKIP
    LOCKED`), o desfazer do encerramento só devolve o que ninguém mexeu
    depois, e o passo de pessoas acha a ficha pelas DUAS grafias do nono
    dígito.
  · **1021** — a foto do encerramento é de CADA operação (`on conflict do
    update`), senão um segundo encerramento desfazia contra a foto velha.
  · **1022** — o desfazer da carga só devolve o que continua INTOCADO desde
    ela: card criado ou movido que alguém mexeu depois, ficha com nome ou
    e-mail trocado depois e valor de campo editado depois FICAM, retidos no
    livro e contados em `editadas_depois`. ⚠️ "Intocado" em `deals` e
    `contacts` é `updated_at <= criado_em` da linha do livro; em
    `contact_custom_values`, que não tem `updated_at`, é o VALOR — que o
    livro passou a guardar (`detalhe.valor`), preenchido nas linhas antigas
    com o valor do dia da migration. ⚠️ O desfazer cala SÓ o
    `set_updated_at` de `contacts` (nominal — o espelho de e-mail continua
    ligado) e devolve `updated_at` explicitamente: sem isso, devolver o
    e-mail empurrava `updated_at` para agora e a linha do nome da MESMA
    ficha era lida como "editada depois".
  · **1023** — as decisões da carga são tomadas SOB TRAVA (Codex, PR
    #232): nome e e-mail da ficha só são preenchidos com `FOR UPDATE` e a
    regra repetida no UPDATE (um escritor concorrente que preenchesse o
    e-mail era sobrescrito pelo da Kommo); o card movido é lido travado
    (a foto do livro é o que o UPDATE sobrescreve); `status_changed` sem
    funil é recusado na ENTRADA do lote; e a ficha CRIADA pela carga e
    editada depois fica retida no desfazer, travada antes da pergunta "tem
    conversa?" — sem a trava, a conversa sendo criada naquele instante era
    apagada em cascata com as mensagens.

- **1024_cb_telefone_canonico** — ⚠️ **aplicada DEPOIS do deploy**, a
  exceção da 981: ela RESTRINGE, e o app anterior (CSV do disparo casando
  por grafia) derrubaria a campanha no intervalo; o app novo não depende
  dela. Aplicada em 21/09/2026 (histórico `20260921152713`), com a VPS já
  rodando o merge do #240 (`9a22d6a`); conferido: coluna e índice no
  catálogo, 2.840 fichas com a chave ganhando o 9, zero pares, e a
  ingestão gravando segundos depois. `contacts.telefone_canonico` (coluna
  GERADA: só dígitos e, no celular brasileiro de 12 dígitos, com o nono
  dígito) + índice único parcial `(account_id, telefone_canonico)`: o mesmo
  celular nas duas grafias deixa de poder virar duas fichas. Redefine
  `cb_kommo_carregar_pessoas` (corpo da 1023) só para o `ON CONFLICT`
  perder o alvo — com alvo, o índice novo abortaria o lote na corrida.
  Pré-voo que PARA (em vez de fundir) se já houver par de irmãs; medido
  imediatamente antes: 5.106 fichas, zero pares, 2.839 ganham a chave com o
  9. Ver a seção "Chave única do telefone".

- **1030_cb_funcao_de_disparo_executavel** — `create_broadcast_with_recipients`
  passa a EXECUTAR (RETURNING qualificado, upstream #536) e a gravar os
  parâmetros por destinatário como lista (`p_template_params JSONB`, pareado
  por ordinalidade — achado nosso). Apaga as duas formas antigas (a de 8 e a
  de 9 com `JSONB[]`). Aplicada em 21/09/2026 pela Management API (histórico
  `20260921164342`), ANTES do merge do PR #242 e DEPOIS de o replay do CI
  passar no commit exato; conferida no catálogo (UMA função, a assinatura
  final, EXECUTE só do `service_role`) — a própria conferência CHAMOU a
  função no Postgres 17 da produção e se desfez — e por e2e no preview contra
  o banco real (plano do merge do upstream, Fase 2): o primeiro 202 da
  história de `POST /api/v1/broadcasts`.
  ⚠️ **O número pula para 1030 DE PROPÓSITO**: a faixa `1030+` é do
  `docs/PLANO-merge-upstream-2026-09.md` (a sessão da Kommo seguia criando
  números no mesmo dia — as aplicadas como 1025/1026 são dela). **Não
  existem arquivos 1025 a 1029** — não "preencher" a lacuna: a do histórico
  do WhatsApp foi APLICADA em produção como 1027 e o arquivo virou **1033**
  no merge, e as duas do acompanhamento da Kommo, aplicadas como 1025 e
  1026, viraram **1034** e **1035**, por esta mesma regra. ⚠️ E número NOVO vem SEMPRE depois do maior que já
  está no `main`: a instalação que atualiza por `supabase db push` RECUSA
  migration fora de ordem (sem `--include-all`), e o `docs/ATUALIZAR.md`
  manda o push simples. A do "perdido que volta" nasceu 1028 e virou 1031
  por isso (Codex, PR #245).

- **1031_cb_perdido_pode_voltar** — troca o CORPO de duas funções:
  `cb_deals_aplica_resultado` (o gatilho da 950: card PERDIDO que entra
  numa etapa neutra, sem troca de status no mesmo update e com a etapa
  achada, volta `open`; ganho continua ganho) e `cb_atualizar_negocio` (a
  RPC das automações da 934: mover para etapa neutra reabre o perdido na
  mesma escrita, inclusive para a etapa em que ele já está; só escreve se o
  card continua no status esperado; e devolve o status gravado). ⚠️ A RPC
  muda de ASSINATURA — ganha `p_status_esperado text DEFAULT NULL` e a
  coluna de saída `status_gravado` —, por isso DROP + CREATE; quem chama
  sem o argumento (o app anterior) cai no DEFAULT e ignora a coluna nova. A
  conferência CHAMA as duas funções com dado real, num subbloco desfeito por
  `P1031` (a guarda recusa, a RPC reabre, o gatilho reabre, o ganho fica).
  Ensaiada contra a produção numa transação desfeita antes de aplicar.
  Decisão do operador em 21/09/2026 (ver a seção "Etapa com RESULTADO").
  Aplicada ANTES do merge, depois do replay do CI.

- **1032_cb_rls_leitura_uma_vez_por_consulta** — a função
  `cb_contas_do_usuario(papel)` (SECURITY DEFINER, EXECUTE para anon,
  authenticated e service_role — as policies são `TO public`) e as 61
  policies de LEITURA (SELECT e FOR ALL, 52 tabelas) reescritas por `ALTER
  POLICY` para `account_id = ANY (ARRAY(SELECT …))` — ver "Policy de LEITURA
  pergunta a conta UMA vez por consulta". ⚠️ É **1032** porque a **1031** é a
  do perdido que volta (PR #245, que chegou ao `main` antes desta), e as
  aplicadas como 1025 e 1026 (hoje 1034 e 1035) e a do histórico do
  WhatsApp (aplicada como 1027, hoje 1033) foram aplicadas por outras
  frentes antes de chegar ao `main`.
  Ensaiada em produção numa transação desfeita (8 usuários × 52 tabelas: o
  resultado da RLS, o predicado antigo e o novo idênticos em todas). Aplicada em
  21/09/2026 pela Management API (histórico `20260921220626`), com
  autorização do operador e DEPOIS do replay do CI; conferida no catálogo
  (nenhuma policy de leitura por linha, 61 na forma nova, EXECUTE sem
  PUBLIC) e pela RLS de cada um dos 4 membros da conta (as mesmas contagens
  da verdade da conta em 15 tabelas; outra conta e `anon` não veem nada).
  ⚠️ A CONFERÊNCIA foi reescrita DEPOIS de aplicada (Codex, PR #246): a
  aplicada era quadrática e rodava com as travas presas; a do arquivo é
  linear, roda antes das ALTER, e passou contra a produção em 81 ms. O que
  a migration MUDA no banco é idêntico ao aplicado — só os blocos de
  verificação diferem do registrado no histórico.

- **1033_cb_historico_do_whatsapp** (aplicada como 1027) — o registro
  `migracao_kommo.historico_whatsapp` e as funções
  `cb_importar_historico_whatsapp` / `cb_desfazer_historico_whatsapp`: a
  porta de escrita, por lote, do histórico de 2026 do WhatsApp trazido da
  Evolution para as fichas com card (ver a seção "Histórico importado do
  WhatsApp"). ⚠️ Aplicada em produção como **1027** (a faixa 1020 era da
  sessão da Kommo); quando o arquivo chegou ao `main` já estavam lá a 1030, a
  1031 e a 1032, e ele virou **1033** — a instalação que atualiza por
  `supabase db push` recusa número menor que o maior já aplicado. Conferido
  que a ordem não muda o resultado: ela cria o registro em `migracao_kommo`,
  três funções e as concessões delas; nenhuma policy (a 1032 reescreve e
  confere só policies de leitura do `public`), e nada que a 1030 ou a 1031
  toquem. Em produção o histórico guarda o nome antigo, e nada reaplica.
  Aplicada em 21/09/2026 (histórico `20260921201327`), depois do replay do
  CI no commit das correções da revisão adversarial e de dois ensaios em
  transação desfeita. Ensaio REAL no mesmo dia (lote `ensaio-1`, 5 fichas,
  540 mensagens): nenhuma conversa existente mudou situação, não lidas,
  espera, responsável, `updated_at` nem canal; 0 notificação, 0 evento de
  automação, gatilhos religados; conferido no preview. **Carga completa em
  22/09/2026** (lote `carga-1`, sem as fichas do ensaio): 68.337 mensagens
  para 1.004 fichas, 391 conversas criadas (encerradas), 86 encerradas com
  prévia nova; nada disparado. Os dois lotes não se sobrepõem — é o que
  mantém certo o desfazer POR LOTE (a prévia de antes é registrada uma vez
  por conversa, no primeiro lote que a tocou); desfazer tudo não depende
  disso. ⚠️ Antes de desfazer, conferir `cb_scheduled_messages` pendentes
  com `reply_to_message_id` apontando para mensagem do registro: a retenção
  do desfazer olha só citação em `messages`, e a agendada perderia a
  citação (Codex, PR #243).

- **1034_cb_kommo_acompanhamento** (aplicada como 1025) — aplicada em
  21/09/2026 (histórico `20260921151613`), depois do replay do CI e de dois
  ensaios em transação desfeita. O acompanhamento do #232: a troca de
  funil da carga exige as duas etapas (sem a de destino,
  `cb_funil_trajetorias` a devolvia com `etapa = null` e ela sumia das
  métricas; sem a de origem, a ficha diria "Transferido de … (—)"), e o
  encerramento em lote confere a folga de 2 minutos DE NOVO no próprio
  UPDATE, que enxerga uma foto tirada depois das travas — a do SELECT não
  via a mensagem confirmada no meio do comando, e o lote a escondia. A foto
  do antes sai do MESMO comando (WITH … RETURNING), só de quem foi
  encerrado, e os contadores do retorno saem dela.
  ⚠️ **Limite conhecido, registrado e não corrigido:** os dois desfazeres
  leem "intocado" como `updated_at <= hora da operação`, e `updated_at` é
  o INÍCIO da transação de quem escreveu — um salvamento já em voo quando o
  lote começou passaria por intocado. Medido: nenhuma linha da carga tem
  essa assinatura. ⚠️ E o desfazer do encerramento é da CONTA INTEIRA:
  rodado depois de um encerramento novo, devolve também o que o de 21/09
  ainda guarda na foto (medido no ensaio: 899 linhas para 64 da operação).
- **1035_cb_kommo_entrada_sem_texto_vazio** (aplicada como 1026) —
  aplicada em 21/09/2026 (histórico `20260921152355`), depois do replay do
  CI. A entrada do lote trata "" como ausente em TODA guarda de evento
  (Codex, PR #241): a gravação faz `nullif(..., '')`, e um id em branco
  passava na entrada, o modo de conferência dizia "válido" e só a
  conferência de saída o recusava, depois de escrever e sem nomear o lead.
  Migration nova porque a 1034 (então 1025) já estava aplicada.
  ⚠️ **As duas viraram 1034/1035 no merge (22/09/2026)**, pela regra da
  1030: quando chegaram ao `main` já estavam lá a 1030–1033, e a instalação
  que atualiza por `supabase db push` recusa número menor que o maior já
  aplicado. A ordem não muda o resultado: as duas só recriam
  `cb_kommo_carregar_lote` e `cb_encerrar_conversas_abertas` (com as
  concessões DELAS), que nenhuma da 1030 à 1033 toca; nenhuma policy nem
  tabela. Em produção o histórico guarda os nomes antigos, e nada reaplica.

- **1036_cb_reunioes_da_kommo** — as reuniões históricas da Kommo, só como
  histórico (decisão 27 do plano da migração, opção b, 22/09/2026): a
  última data do campo de LEAD "Reunião Marcada" de cada lead, com o link,
  o "marcou onde", o funil e a etapa da Kommo. ⚠️ Tabela PRÓPRIA e FECHADA
  ao navegador (RLS sem policy, REVOKE das duas metades), sem gatilho: o
  campo "Data e Hora Reunião" é do Calendly e é o que os lembretes leem —
  gravar ali sobrescreveria agendamento real e dispararia lembrete sobre
  reunião passada. Nenhuma tela, automação ou lembrete lê a tabela; quem
  vai ler é o mapa de reuniões (Fase 8 do funil comercial), pelo servidor.
  `contact_id` é NULO para o lead perdido que ficou fora do recorte da
  carga (a data não se perde quando a Kommo sair do ar), com SET NULL ao
  apagar o contato. Chave `(account_id, kommo_lead_id)`: rodar de novo no
  dia do corte atualiza. Quem grava é um script fora do app (leitura em
  `scripts/kommo/reunioes.mjs`); desfazer é DELETE por `lote`. Aplicada
  em 22/09/2026 pela Management API (histórico `20260922185547`), depois do
  replay do CI e antes do merge; gravadas 1.196 linhas no lote `reunioes-1`
  (546 pelo card, 28 pelo telefone, 622 sem ficha), com notificações,
  eventos de automação e execuções iguais antes e depois.
- **1037_cb_falha_de_webhook_so_pelo_servidor** — fecha o EXECUTE de
  `record_webhook_failure` (028, SECURITY DEFINER) para PUBLIC, `anon` e
  `authenticated`, com o GRANT de volta ao `service_role`: com a chave
  anônima e o id de um endpoint (que viaja em `X-Wacrm-Webhook-Id` em toda
  entrega), quinze chamadas desligavam o webhook de saída. Não recria a
  função. Aplicada em 23/09/2026 pela Management API (histórico
  `20260923173150`), depois do replay do CI e antes do merge do PR #266;
  conferida no catálogo (`proacl` = `{postgres=X, service_role=X}`, `anon`
  e `authenticated` sem EXECUTE).
- **1038_cb_contato_bsuid** e **1039_cb_motivo_da_falha_da_mensagem** — as
  `040`/`042` do original (#519/#533 e #535), que o merge #259 trouxe como
  `0043`/`0045` sem aplicar em lugar nenhum; renumeradas pela regra do `db
  push` na correção do #259. Três colunas anuláveis em `contacts` (BSUID,
  BSUID do portfólio, nome de usuário) com um índice único PARCIAL, e três
  em `messages` (código, título e detalhe da falha da Meta). Aditivas, com
  `lock_timeout`. As da 1039 são gravadas pelo webhook da Meta desde a
  Fase 5 do plano do merge do upstream; as da 1038, ninguém grava até a
  Fase 11. Aplicadas em 23/09/2026 pela Management API (histórico
  `20260923202446` e `20260923202453`), depois do replay verde do CI e
  antes do merge do #270, com a conferência de antes (nenhuma 1038/1039
  ou 0043/0045 no histórico nem em branch remota, nenhuma das 6 colunas);
  conferidas no catálogo depois: as 6 colunas e o índice
  `(account_id, wa_user_id) WHERE (wa_user_id IS NOT NULL)`, UNIQUE.
- **1040_cb_origem_api_e_aviso_duravel_do_funil** — o CHECK de
  `cb_automation_events.origem` passa a aceitar `api` (trocado ANTES da
  função: o gatilho engole erro com WARNING), `cb_enfileira_evento_de_funil`
  decide a origem pela ordem usuário → cadeia → conexão → automação →
  cabeçalho `x-cb-origem: api` → sistema, e as colunas
  `webhooks_pendente_desde`/`webhooks_tentativas` + índice parcial da
  entrega durável dos `deal.*`, sem backfill. ⚠️ Foi para a produção ANTES
  do merge do PR #279: o dreno novo grava a coluna na reivindicação, e sem
  ela as automações de funil parariam. Aplicada em 23/09/2026 pela
  Management API (histórico `20260923232600`), depois do replay verde do
  CI; conferida no catálogo (CHECK com `api`, as duas colunas, o índice
  com o predicado, a função com o cabeçalho, `anon` sem EXECUTE, 0
  pendentes herdados) e medida contra o PostgREST real (ver a nota da
  origem `api`).
- **1041_cb_identidade_do_contato_com_bsuid** — o CHECK de identidade de
  `contacts` passa de "telefone OU instagram" para "telefone OU instagram OU
  BSUID" (`wa_user_id`): a ficha que a Meta manda só com o nome de usuário do
  WhatsApp, sem telefone (Fase 11 do plano do merge do upstream). ADITIVA —
  sem ela o INSERT dessa ficha leva 23514 e a mensagem se perde, porque a Meta
  já recebeu 200. A conferência chama o INSERT de duas fichas só-BSUID, do
  BSUID repetido (23505) e da ficha sem identidade (23514) num subbloco
  desfeito por `P1041`. Aplicada em 25/09/2026 pela Management API (histórico
  `20260925152808`), depois do replay verde do CI no commit exato e antes do
  merge do PR #291; conferida no catálogo (UM CHECK, as três pernas,
  validado), sem sobra da conferência e com 0 fichas sem telefone. Ensaiada
  antes contra a produção numa transação desfeita (1× e reaplicada).

## Notas do histórico

- ⚠️ **Não existe 938/939**, nem local nem no histórico — não "preencher" a
  lacuna: a numeração é cronológica, não densa.
- ⚠️ A `906` foi aplicada FORA DE ORDEM (antes da 907), e o histórico do
  Supabase a registra com o nome antigo `904_cb_grupos` — ela nasceu numerada
  como 904, colidiu com `904_cb_mensagem_do_aparelho` e o ARQUIVO foi
  renumerado para 906; a entrada no histórico não foi mexida de propósito, por
  ser metadado compartilhado com outra sessão ativa no mesmo banco.
- ⚠️ **Nunca deduzir o próximo número desta lista** — ela envelhece a cada
  branch em paralelo. Rodar `ls supabase/migrations/` **e** `list_migrations`
  imediatamente antes de criar o arquivo; os dois, porque já divergiram.
- ⚠️ A `037` é a **única** aplicada *sem* registro no histórico do Supabase: as
  colunas dela existem no banco (`whatsapp_config.provider`, `base_url`,
  `instance_name`, `api_key`, `instance_state`, …), mas `list_migrations` não a
  lista. Ou seja, **o histórico não é fonte de verdade completa** — para checar
  se algo foi aplicado, consultar o schema, não só o histórico. (A 947 também
  está aplicada sem registro — ver a entrada 946–947.)
