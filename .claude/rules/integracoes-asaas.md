---
paths:
  - "src/lib/asaas/**"
  - "src/app/api/cb/asaas/**"
  - "src/components/settings/asaas-*.tsx"
  - "src/components/automations/asaas-trigger-config.tsx"
  - "src/components/inbox/faixa-de-inadimplencia.tsx"
  - "src/components/inbox/painel/aba-cobrancas.tsx"
  - "src/hooks/use-inadimplencia*"
  - "src/hooks/use-cobrancas-do-contato*"
---

# Asaas — regras

Vale ao mexer na integração com o Asaas: o espelho de clientes e cobranças
(`src/lib/asaas/`), o vínculo com a ficha, o cartão em Integrações
(`asaas-card.tsx`, `asaas-listas.tsx`, `asaas-regua.tsx`), o aviso de
inadimplência na conversa, o webhook e a régua de cobrança. O Asaas é a fonte;
o CRM só lê. O lado do MOTOR da régua (gatilhos `asaas_*` que casam só pelo
`automation_id`, recusas do `validate.ts`, canal que falha fechado) está em
`.claude/rules/automacoes.md`. Decisões D1–D21 e os números da conta:
`docs/PLANO-integracao-asaas.md`. O texto antigo, com a história, está em
`git show f5879b3f:CLAUDE.md`.

### Espelho e vínculo (992/994)

- ⚠️⚠️ **TODAS as tabelas do Asaas são FECHADAS ao navegador** (RLS ligada,
  zero policy, REVOKE de `anon` e `authenticated`): moram lá a chave cifrada,
  o CPF/CNPJ (só sai MASCARADO, pela rota do admin) e a dívida de quem nem tem
  ficha. Toda tela lê por rota em service role, que diz também se está
  conectado e se a leitura é FRESCA (`leituraFresca`, duas voltas do laço
  lento) — sem isso "em dia" seria afirmação sobre dado parado.
- ⚠️⚠️ **`vista_vencida_em` NUNCA é reescrito enquanto a cobrança continua
  devida.** É a PRIMEIRA vez que o espelho a viu vencida, carimbada num UPDATE
  cercado por `IS NULL`, fora do upsert; é o dia-alvo da régua e o que torna a
  ativação não retroativa. "Está vencida" é o `status` do Asaas, nunca
  `vencimento < hoje` (o instante da virada não é documentado). Uma exceção: a
  cobrança que VOLTA a "a vencer" (renegociada) perde o carimbo, para a régua
  rearmar; a paga mantém (histórico).
- ⚠️ **Os upserts levam SÓ metadados** — nunca `contact_id`,
  `vinculo_origem`, `contatos_recusados` nem `candidatos`: o que já é conhecido
  mantém o que tem (o PostgREST só escreve as colunas presentes, e o dublê de
  teste imita isso).
- ⚠️ **A elegibilidade da regra automática é `contact_id IS NULL AND
  (vinculo_origem IS NULL OR IN ('telefone','cpf','email','criada'))`, nunca
  `<> 'desvinculado'`**: com a coluna nula (todo cliente novo) a comparação dá
  NULL e exclui o cliente sem erro. O UPDATE do vínculo é cercado pelas MESMAS
  condições — gente que ligou no meio do ciclo vence. `manual` e
  `desvinculado` são de gente: a regra não toca.
- ⚠️ **Só telefone (com a irmã do nono dígito), CPF já ligado e e-mail
  LIGAM.** Sufixo de 8 e nome aproximado só SUGEREM (`candidatos`): ligar
  errado mostra a dívida de um na conversa de outro. As cercas: contato já
  ligado a outro cliente de documento diferente, nome de gente sem token em
  comum (a esposa que paga a conta do marido), telefone igual ao de uma
  conexão da própria conta, e `contatos_recusados` — desligado por gente nunca
  volta, nem pela criação da ficha.
- ⚠️⚠️ **O CRM CRIA a ficha do cliente com telefone e sem contato** (D2,
  decisão do operador, 12/09/2026): só o contato, SEM conversa,
  `user_id = accounts.owner_user_id` (`criar-ficha.ts` está no manifesto de
  `dono-duravel.test.ts`), o nome do Asaas FIXADO, e a etiqueta `asaas` por
  INSERT DIRETO em `contact_tags` — nunca por `tag-events.ts`, que dispararia
  o gatilho `tag_added` das automações centenas de vezes de uma vez. A ficha
  criada entra em "todos os contatos" do disparo; a etiqueta é o que deixa
  excluí-la. `findExistingContact` é o PORTÃO anti-duplicata, não o vínculo:
  ficha que só bate pelo sufixo vai para "Para confirmar".
- ⚠️⚠️ **Ficha APAGADA pelo administrador não é recriada em origem
  NENHUMA**: `criar` só quando `vinculo_origem IS NULL`. A FK é `ON DELETE SET
  NULL (contact_id)` e a origem sobrevive; guardando só em `criada`, o cliente
  cujo contato foi apagado (inclusive por pedido de exclusão LGPD) ganhava
  ficha nova no ciclo seguinte, para sempre. A regra ainda RELIGA pelo
  telefone à ficha sobrevivente de uma fusão.
- ⚠️ **A etiqueta refeita é só a PENDENTE** (`etiqueta_pendente`, gravada
  quando o upsert de `contact_tags` devolveu `{ error }` — o Supabase não
  lança). Derivar "faltou etiquetar" da ausência devolvia, a cada ciclo, a
  etiqueta que uma pessoa tirou de propósito.
- ⚠️ **A ficha que perde a corrida para gente FICA** (um "Ligar"/"Ignorar"
  entre a reconferência e o vínculo): apagá-la levaria por CASCADE uma
  mensagem do cliente chegada na janela. Um contato a mais, nunca um a menos.
- Toda leitura do banco PAGINA. As listas do cartão são montadas em memória
  por `listas.ts` (puro) e paginadas na rota; a situação do cliente
  (`ligado`/`confirmar`/`sem_ficha`/`ignorado`) é DERIVADA da linha, nunca
  coluna própria.

### Ciclo de sincronização

- ⚠️ **O ciclo PROVA A IDENTIDADE da chave antes de gravar**: relê os três
  `cus_…` vistos mais RECENTEMENTE e, se todos derem 404, cruza uma página de
  `/customers` com o espelho; nada cruzando = `conta_trocada` (`conectarAsaas`
  idem). Sem isso a chave de outro CNPJ zeraria o aviso de todos; sondas FIXAS
  travariam se aqueles clientes fossem apagados. O 404 de UMA cobrança só vira
  `deleted` com o CLIENTE dela respondendo 200 — na reconciliação e na
  releitura da régua (`reconfirmar`). ⚠️ Lá, cobrança 404 com o cliente também
  404 PARA a varredura como `conta_trocada`, sem travar nada: os dois juntos
  são sinal de chave de outra conta, e travar ali gastaria o marco de todos.
- ⚠️⚠️ **O ciclo tem CADEADO (`cb_asaas_config.sincronizando_desde`, 995)**:
  cron, "Sincronizar" e a primeira sincronização podem correr juntos, com dois
  processos Node vivos no deploy. Reivindicar é `UPDATE … RETURNING` cercado
  (`filtroDoCadeadoLivre`); as escritas de fim levam a cerca de posse
  (`.eq('sincronizando_desde', vistoEm)`); `em_curso` não é erro.
  ⚠️ O recolhimento (10 min) olha o BATIMENTO (`last_sync_attempt_at`,
  avançado entre páginas pelo `aCadaPagina` e a cada 20 releituras ou
  fichas), nunca o começo do ciclo: conta grande passa de 10 min viva.
  ⚠️ **Batimento que não casa a linha ABORTA o ciclo** (`cadeado_perdido`):
  seguir gravaria no espelho de outro dono. O fechamento confere o ROWCOUNT
  (zero = `cadeado_perdido`, nunca `ok`). ⚠️ No SUCESSO o fechamento realinha
  `last_sync_attempt_at = vistoEm` (o início do ciclo): sem isso o cartão
  mostraria o último batimento como "última tentativa". ⚠️ **`desconectarAsaas` TOMA o
  cadeado antes de apagar** (409 `em_curso`): o ciclo em curso continuaria
  gravando no espelho apagado.
- ⚠️ **`vencidas_listadas_em` só é carimbado quando TODA cobrança listada pôde
  ser guardada**: cliente novo que o PRAZO não deixou ler (`adiados`) segura o
  carimbo, senão `leituraFresca` afirmaria "em dia" sobre vencida que nem
  entrou. Cliente que o Asaas não devolve (404, `semLinha`) não segura.
- ⚠️⚠️ **A varredura de "cliente que sumiu da listagem" tem PISO**
  (`listagemSuspeita`): vazia com espelho vivo é SEMPRE suspeita; parcial é
  suspeita quando somem mais de 20% das vivas E mais de 5 (o absoluto protege
  conta pequena; a fração, conta grande). Suspeita = nada vira `deleted` e
  `last_full_sync_at` não é carimbado. Sem o piso, um soluço do Asaas marcava
  todos como apagados e desarmava a prova de identidade seguinte.
- ⚠️ **Sandbox NUNCA neste banco**: o `.env.local` aponta para o MESMO projeto
  Supabase da produção, e a config é uma linha por conta — conectar o sandbox
  no preview trocaria a conexão da produção. `ehChaveDeSandbox` recusa
  `$aact_hmlg_`; o sandbox só se testa com `fetchFn` falso.
- ⚠️ O cron (`cb/asaas`) está no laço LENTO do `docker-stack.yml`, e o CI não
  relê o `command` do agendador: vale só depois de `docker stack deploy`
  manual com o `crm.env` (raiz, seção 10). O rodízio é por
  `last_sync_attempt_at`, carimbado ANTES de qualquer trabalho.

### Cliente HTTP (`cliente.ts`)

- ⚠️ A chave vai no cabeçalho `access_token` (não é Bearer), nunca na URL;
  `User-Agent` é obrigatório, por `agente()` (ASCII); GET com corpo é 403; 404
  também quer dizer "id de outra conta". A cota é da CONTA do Asaas, dividida
  com outro sistema do escritório, sem `RateLimit-*`: o 429 encerra o ciclo
  sem retentar. Toda mensagem passa por `semSegredo()`.
- ⚠️⚠️ **O bloqueio por cota também chega como 403**, o status da falta de
  permissão: `codigoDoErro` lê a DESCRIÇÃO e trata o 403 de bloqueio como
  `limite`. Lido como permissão, o cartão mandava mexer na chave e o webhook
  ia a estado terminal.
- ⚠️ Toda mensagem de `AsaasError` começa pelo PEDIDO (`GET /payments → 403:
  …`, em `pedir()`), SEM a query — filtro de busca pode levar dado do
  cliente.
- `obter()` devolve `null` SÓ no 404; 2xx sem corpo LANÇA.

### Aviso de inadimplência na conversa

- ⚠️⚠️ **Duas rotas para qualquer membro** — `GET /api/cb/asaas/resumo` (a
  caixa inteira: contato → parcelas devidas) e
  `GET /api/cb/asaas/contato/[contactId]` (a aba) —, sem CPF, e erro é 500,
  NUNCA `{}` ("ninguém deve"). No navegador **`null` é "não sei", nunca "em
  dia"**: o ícone e a faixa calam e o filtro "Inadimplentes" é NEUTRALIZADO
  (`ContextoDosFiltros.inadimplentes: Set<string> | null`, campo OBRIGATÓRIO).
  Conectado SEM ciclo inteiro também é `null` (`cicloCompleto`:
  `vinculo_completo_em >= vencidas_listadas_em`, 996): entre a listagem e o
  vínculo o mapa é PARCIAL, e um conjunto vazio faria uma visão salva esconder
  a caixa inteira. ⚠️ Ele não espera a criação de ficha adiada (cliente sem
  ficha não tem conversa a esconder). A régua da neutralização é UMA
  (`motivoDaNeutralizacao`), para o recorte e para a dica do painel.
- ⚠️ **Leitura ANTIGA não neutraliza**: a tela diz "dados do Asaas de …"
  (faixa, aba e painel de filtros) — neutralizar deixava ícones na lista e um
  interruptor que "não fazia nada". A frescura é derivada no navegador pelo
  relógio (`leituraAindaFresca`), nunca só pelo booleano da resposta, que
  envelhece na tela. A aba só diz "nenhuma parcela vencida" com leitura fresca
  E sem parcela em conferência. `null` ≠ `false`: "Asaas desconectado" só com
  `false`.
- ⚠️ **UMA régua para ícone, faixa e filtro** (`dividasPorContato`/
  `dividaDoContato`, `aviso-na-conversa.ts`, pura e testada; a aba reparte por
  `separarParcelas`). Uma cópia divergiria e o operador leria "o ícone sumiu".
  O parse das rotas é campo a campo, nunca `as`.
- ⚠️ **`useInadimplencia` é montado UMA vez na página do inbox** e repassado
  por prop à lista e ao fio (irmãos); recarrega no `resyncToken`, no evento
  `cb:asaas-mudou` e a cada 5 min com a aba visível. **`useCobrancasDoContato`
  carimba o dono da resposta (`{ de }`) e DERIVA `carregando`** (efeito
  passivo); `AbaCobrancas` exige `carregando`/`falhou`. A aba Cobranças some
  SÓ com `conectado === false` — com `null` afirmaria "não há Asaas", e no
  carregando piscaria a cada cliente.
- ⚠️ O interruptor "Inadimplentes" mora no PAINEL de ajustes, não na barra
  (não cabe); só é oferecido com o Asaas conectado (ou já ligado por visão
  salva, para dar como desligar); fica FORA de `limparOrfaos`; é campo de
  `FiltrosDoInbox` (`AMOSTRAS` cobra). Grupo nunca casa.

### Webhook (997): o aviso na hora

- ⚠️⚠️ **Autenticado pelo CABEÇALHO, nunca pela URL.** O token da URL
  (`/api/cb/asaas/webhook/[token]`) só diz de QUAL conta é a entrega; a
  credencial é `asaas-access-token`, gerada pelo CRM, guardada CIFRADA
  (`webhook_auth_token`) e comparada em tempo constante (`tokenConfere`) — o
  Asaas não assina. 404 e 401 são as únicas RECUSAS; com URL e token certos, só
  os três 500 (config, token ilegível, INSERT do evento): o Asaas retenta, e um
  soluço do banco não pode perder o evento.
- ⚠️ **Limite do balde (POR CONTA, contado depois do cabeçalho) responde 200
  `adiado`**: um 429 contaria como falha, e 15 falhas seguidas interrompem a
  fila. Reentrega = 200 `duplicado` pelo UNIQUE `(conta, id do evento)` de
  `cb_asaas_eventos`.
- ⚠️ **O corpo é AVISO**: só `payment.id` ou `accessToken.name` são lidos, e a
  cobrança é RELIDA na API em `after()` (`processarEvento`, semáforo de 4).
  Cobrança paga que o espelho NÃO conhece é `ignorada` (`deveEntrarNoEspelho`):
  o espelho não é cópia do Asaas.
- ⚠️⚠️ **Criação sem gesto de gente só no cron (`cuidarDoWebhook`)**; conectar
  e o botão também criam, e Ativar/Religar/Desativar só valem a partir do
  PRÓPRIO host público (`podeCriarDaqui`): o `.env.local` do preview carrega a
  URL da produção, e criar dali registraria no Asaas um endereço que só atende
  depois do deploy. ⚠️ O host sai de `x-forwarded-host`/`host`
  (`hostDoPedido`), nunca de `request.url` — o standalone sobe com
  `HOSTNAME=0.0.0.0` e o botão nasceria travado em produção.
- Estado NULO = nunca tentado (o cron cria); `desligado`/`ausente`/
  `sem_permissao`/`erro` esperam gente (`erro` é retentado uma vez por dia,
  `RETENTAR_ERRO_MS`). ⚠️⚠️ **Rede e `limite` NUNCA viram estado que espera
  gente**, nem na criação nem no religar (`conferirWebhook`): grava a falha
  com o estado ANTERIOR e não carimba `webhook_religado_em` — senão um soluço
  de cota travava o aviso na hora e o cartão mentia "o CRM já religou".
- O token da URL é gravado ANTES do POST, cercado por `IS NULL` (URL
  determinística). Reaproveita antes de criar (id nosso → PUT; mesma URL → PUT;
  só então POST): trocar a chave não pode dobrar as entregas. Fila
  interrompida é religada UMA vez pelo cron; a segunda vira `interrompido`, e
  só gesto de gente zera.
- Desconectar APAGA o webhook no Asaas antes da config (`webhookNaoApagado`
  manda apagar no painel). Evento de chave só conta quando `accessToken.name`
  é o `chave_nome` da config → `status='erro'` com `chave_desabilitada`/
  `chave_expirada`/`chave_apagada`.

### Régua de cobrança (998)

- ⚠️⚠️ **SÓ DISPARA PELA VARREDURA** (`regua.ts` puro; `varrer-regua.ts` no
  cron, depois do sync e do webhook). A varredura reconfirma cada parcela no
  Asaas ANTES da trava, cria a conversa da ficha que não tem (dono durável,
  canal do passo, sem pino), passa `{ automation_id, conversation_id,
  channel_id, vars }` e mede o desfecho no `automation_logs` DEPOIS — por isso
  grupos do mesmo contato saem em SEQUÊNCIA, e o log de um disparo nunca
  responde por outra trava (`logsConsumidos`).
- ⚠️ **A releitura é de TUDO que vai para a mensagem** (as parcelas que cruzam
  o marco, as demais devidas e a que vence hoje), senão a paga no meio sai
  como "em aberto"; e a linha FRESCA passa de novo pelas cercas da seleção. A
  janela (até 18:00) é reconferida com o relógio VIVO antes de cada trava
  (`janelaFechou`).
- ⚠️⚠️ **A automação que MANDA é escolhida de novo DEPOIS da releitura**, pelo
  mesmo comparador da seleção (`porMaiorMarco`, uma cópia só) e com a conexão
  conferida de novo; daí em diante travas, janela, canal, contexto e medição
  usam essa, nunca `grupo.automacao`. Com a do espelho, a parcela do maior
  marco paga no meio deixava tudo `absorvida`, nada saía e a trava do marco
  menor ficava gasta. Escolhida com a conexão caída é pulada SEM travar —
  nunca cai para uma automação menor, que mandaria o texto errado.
  `dias_de_atraso` sai das parcelas da que manda, a mais antiga à frente.
- ⚠️ **O lembrete relido passa pela MESMA cerca da seleção** (`cabeNoLembrete`:
  o vencimento, não só o status — a cobrança prorrogada mandava "vence hoje"
  com data futura). O "vence hoje" da cobrança é `venceNoDia` (hoje OU os dias
  que o lembrete cobre hoje), com os dias do `somente_dias_uteis` DA AUTOMAÇÃO
  do lembrete, nunca `true` fixo. ⚠️⚠️ **Quem responde "esse lembrete já
  saiu?" é a TRAVA** (`semLembreteTravado`), nunca a configuração de hoje:
  trocar dias corridos por úteis punha a parcela de novo no INSERT, e o 23505
  bloqueava o grupo o dia inteiro. No lembrete, essa conferência vem ANTES da
  releitura.
- A mensagem sai pelo caminho do ROBÔ: não reabre encerrada, não zera
  `aguardando_desde`, não mexe em não lidas (D16). Pino default-deny
  `regua.chamadores.test.ts`.
- ⚠️⚠️ **A trava é do MARCO, e é UM INSERT com várias linhas**
  (`cb_asaas_regua_envios`, UNIQUE `(cobranca_id, tipo, marco, vencimento)`):
  23505 em qualquer parcela recusa o GRUPO. Por isso `agruparPorCliente` põe
  cada parcela UMA vez (pelo maior marco que cruzou hoje) — a mesma chave duas
  vezes no INSERT era lida como "outro processo pegou" e ninguém enviava.
  Grupo sem `reservado` não dispara; a trava vale para a que enviou e para a
  `absorvida`; o lembrete é `tipo='vence_hoje'`/`marco=0`.
- ⚠️ `reservado` há mais de 10 min é órfã: sem log → apagada JUNTO com as
  `absorvida` do mesmo INSERT (mesmo `criado_em`), e só DEPOIS de a própria
  órfã sair, pela cerca `resultado='reservado'` (sozinhas, davam 23505 ao
  ciclo seguinte); com log → `incerto`, nunca reenviada.
- ⚠️ **`enviado` é QUALQUER passo que entrega ao contato**
  (`PASSOS_QUE_FALAM_COM_O_CONTATO`: mensagem, mídia, botões, lista, modelo),
  em `resultadoDoLog` e na reconciliação — um ramo pode rodar só a mídia.
  `send_to_number` e `send_webhook` ficam fora, e por isso não é o
  `PASSOS_DE_ENVIO` da retentativa.
- ⚠️ **`na_fila` existe por causa da retentativa do motor**: envio recusado
  (4xx) roda de novo FORA da varredura, então a trava guarda
  `automation_log_id` e a varredura seguinte reconcilia pelo log
  (`enviado`/`falhou`/`barrada`; 1 h sem desfecho → `incerto`). `enviado`,
  `na_fila` e `incerto` CONTAM como cobrado para o intervalo mínimo
  (`regua_intervalo_dias`) e o "uma por cliente por dia" — mandar de menos é
  o lado seguro. Os nove valores do CHECK são `RESULTADOS_DA_TRAVA`, rotulados
  por chave montada (cobrada nos dois dicionários).
- ⚠️ **Ligar a régua NÃO é retroativo** (D13, decisão do operador): só entra
  parcela vista vencida DEPOIS de `regua_ativada_em` (`entrouNaRegua`). O
  dia-alvo é `vencimento + marco` ou o dia em que o espelho a viu vencida, com
  até 3 dias de tolerância; fim de semana e feriado nacional fixo empurram para
  o dia útil; a janela vai de `hora_envio` às 18:00. Lembrete e marco no mesmo
  dia = UMA mensagem (`{{vars.vence_hoje_detalhe}}`; o lembrete é travado como
  absorvido). A negativada entra.
- ⚠️ O interruptor é `PUT /api/cb/asaas/regua/interruptor`, NÃO o PUT da
  config: confere ROWCOUNT, e SÓ a transição desligado → ligado carimba
  `regua_ativada_em` (UPDATE cercado em `regua_ativa = false`) — um PUT
  repetido empurraria a fronteira da D13 para a frente.
- ⚠️ **A conexão falha FECHADA** (D19): a varredura confere a do primeiro envio
  (`primeiroEnvio`, que entra nos ramos) e pula SEM travar a automação cuja
  conexão não resolve e a candidata desconectada (a sonda que falha conta igual
  — `sondaFalhou`). "Viva" é `vivaParaEnviar`: `ok`, ou os amarelos de ENTRADA
  (`ENVIA_MESMO_EM_AMARELO` = `webhook`, `lagging` — atraso de entrega não
  impede enviar, senão a régua não cobrava ninguém por aquela conexão);
  `pairing`/`stale`/`lastError` não provam envio. Amarelo novo decide por
  escrito de que lado fica. A cerca é de conexão por QR Code
  (`kind='evolution'`, `connected`).
- ⚠️ Ficha SEM telefone é pulada sem travar (`semTelefone`). **"Tem telefone"
  é o predicado do REMETENTE do robô** —
  `isValidE164(sanitizePhoneForMeta(telefone))`, o de `engineSendText` —,
  nunca régua própria: "8 dígitos ou mais" deixava passar JID de grupo, que o
  envio recusava, e a trava fechava `falhou` sem nova chance. Pino estrutural
  em `regua.chamadores.test.ts`.
- ⚠️ Automação da régua gravada antes das recusas do `validate.ts` não é
  pulada pela varredura: conferir antes de ligar a régua.
- "Assinar como" (`automations.assinatura_personalizada`, D18) é prefixo de
  todo `send_message` da automação, por `nomePersonalizadoParaAssinar`, sob o
  interruptor `assinatura_ativa` da conta.
- ⚠️ **A lista de exceção é por CLIENTE DO ASAAS, não por contato**
  (`cb_asaas_clientes.regua_desligada`, com quem e quando): a régua agrupa por
  cliente, e o mesmo contato pode ter a pessoa e a empresa. O sino está na aba
  Cobranças e nas listas do cartão.
- ⚠️ As rotas do cartão, `resumo` e `contato/[contactId]` selecionam
  `regua_*`/`regua_desligada` por NOME: sem a coluna, o `resumo` responde 500
  e o ícone, a faixa e o filtro apagam para a conta INTEIRA. Coluna nova lida
  por nome = migration aplicada ANTES do deploy.
