# Estudo — Instagram Direct pelo login unificado

> **Data:** 19/11/2026 · **Base:** `main` em `d61fe1ea` · **Pedido:** trocar a
> conexão do Instagram Direct da "Configuração da API com login do Instagram"
> para a "API setup with Unified login" (login unificado), e pensar no Atlas
> CRM vendido como SaaS.
>
> **Estado:** ESTUDO. Nada foi implementado e nada foi mexido no painel da
> Meta nem no banco. O plano vivo (`docs/PLANO-*.md`) e as fases só começam
> depois do "pode" do operador.
>
> **Rótulos de cada afirmação:**
> - **[DOC]**: documentação oficial da Meta, consultada em 19/11/2026 (links
>   no fim; as páginas não trazem data de atualização);
> - **[PAINEL]**: o que a sessão de origem viu no painel da Meta em 19/11;
> - **[MEDIDO]**: medido por nós (a Fase 0 de 09/09, no login do Instagram);
> - **[CÓDIGO]**: lido no código deste repositório;
> - **[PENDENTE]**: só um teste resolve;
> - **[ESTIMATIVA]**: conta minha, não medida.
>
> Repositório público: nenhum ID real de app, conta ou portfólio, nenhum nome
> de cliente. Endereços de exemplo são fictícios.

---

## Resumo para decidir

- **O login do Instagram que usamos hoje continua funcionando, sem data de
  fim** [DOC]. Mas a Meta o marcou como obsoleto [PAINEL], recursos novos só
  saem no unificado [DOC] e, pelo guia de migração, **um app criado hoje já
  não consegue montar o login do Instagram** [DOC, PENDENTE de teste]. Para o
  Atlas, que vai conectar escritórios novos, o unificado é o caminho que
  sobra.
- **O que muda no CB CRM é a conexão, não a caixa de entrada.**
  - Mudam o login, a troca do código, o tipo de token, o host da API, a
    assinatura da entrega e quem assina o webhook.
  - O formato da mensagem no webhook, o roteamento por `entry.id`, a mídia e a
    gravação ficam como estão [DOC, a medir com uma DM real].
  - A Fase 4 do plano (responder pela caixa) ainda não foi feita. Construí-la
    já sobre o unificado evita fazê-la duas vezes.
  - A Fase 6 (renovar o token) quase some: o token do unificado pode ser
    configurado para "nunca vencer".
- **Um app da Meta tem UM endereço de webhook** [DOC]. Para os hospedados do
  Atlas, cada um com servidor e endereço próprios, isso pede uma **central**:
  - a central recebe a volta do login e todos os webhooks do app único da
    Atlas e entrega cada conta à instância certa;
  - o segredo do app fica só nela;
  - cada instância guarda o token dos próprios clientes e responde direto à
    Meta.
- **Para o app único da Atlas servir outros escritórios**, a Meta exige:
  - a verificação da empresa;
  - o selo de Provedor de Tecnologia;
  - a análise do app (App Review) com acesso avançado [DOC].
  
  Isso revisa a **D3** ("Standard Access"), que é decisão do operador.
- **A minha recomendação é a opção A:** o CB vira o primeiro cliente do app
  da Atlas. O CB não deveria emprestar o próprio app ao Atlas (§6).
- **Antes de qualquer código: meio dia de medições num app descartável**
  (§7). A doc se contradiz em pontos que decidem o desenho, como no estudo de
  09/09.
- **Várias contas do Instagram por escritório: já funciona hoje e continua no
  unificado** (§4). O unificado até facilita: um login traz várias contas de
  uma vez. A diferença para o WhatsApp é que a mesma pessoa vira uma ficha por
  conta do Instagram do escritório.
- **Aviso ao manual em PDF que a outra sessão está fazendo:** os passos de
  "crie o seu app com o login do Instagram" talvez não valham para um app
  novo (§7.4).
- **As decisões estão no §11** (U1 a U14).

---

## 1. Os dois logins lado a lado

| | Login do Instagram (hoje) | Login unificado |
| --- | --- | --- |
| Quem entra | Conta do Instagram | Instagram **ou** Facebook [DOC] |
| O que o cliente escolhe | A conta que está logada (`force_reauth` pergunta qual) | Um **portfólio empresarial**, depois as contas do Instagram, e outros ativos se a configuração pedir [DOC] |
| Endereço do login | `www.instagram.com/oauth/authorize` com `scope` | `www.facebook.com/dialog/oauth` com `config_id` (o "ID da configuração", que não é segredo) [DOC] |
| Credencial do app | Instagram App ID + Instagram App Secret (aba do produto) | **App ID e App Secret principais** do app (Configurações → Básico) [DOC] |
| Troca do código | Duas: código → token curto (1 h) → token longo (60 dias) | Uma: `graph.facebook.com/…/oauth/access_token` → token do usuário do sistema [DOC] |
| Token | Do usuário do Instagram, 60 dias, renovável | "Token de acesso do usuário do sistema (SUAT)": é do **portfólio do cliente**, não de quem logou, e continua valendo se essa pessoa sair da empresa [DOC] |
| Validade | 60 dias, medida pelo `expires_in` [MEDIDO] | Escolhida na configuração; o padrão é **nunca vencer** [DOC]. Morre se o cliente tirar o app do portfólio ou mudar a conta de portfólio [DOC] |
| Um token cobre | Uma conta do Instagram | **Todas** as contas que o cliente compartilhou naquele portfólio [DOC] |
| Host da API | `graph.instagram.com` | `graph.facebook.com` [DOC] |
| `/me` devolve | A conta do Instagram | O **usuário do sistema**, não a conta; as contas saem de `/me/assigned_instagram_accounts` [DOC] |
| Permissões | `instagram_business_basic`, `instagram_business_manage_messages` | `instagram_basic`, `instagram_manage_messages` [DOC] |
| Assinar o webhook da conta | `POST graph.instagram.com/me/subscribed_apps` | `POST graph.facebook.com/{id-da-conta}/subscribed_apps`, conta por conta [DOC] |
| Onde fica o webhook no painel | Aba "Configuração da API com login do Instagram" | Produto Webhooks do app, objeto **Instagram** (o guia de migração), ou "Configure webhooks" na aba do unificado (a página de webhooks) [DOC, ver M1] |
| Quem assina a entrega | **Instagram App Secret** [MEDIDO em 09/09; a doc dizia outra coisa] | "O App Secret do seu app" [DOC, ver M2] |
| Página do Facebook | Não precisa | Não precisa [DOC] |
| Entrar pelo app do Instagram no celular | A doc não cita limite | **Não**: o login abre no navegador e pede a senha do Instagram [DOC] |

O ID da conta não muda [DOC]: o `id` que `/me/assigned_instagram_accounts`
devolve "é o mesmo valor do `user_id`" do `/me` do login do Instagram. Esse é
o valor que gravamos em `cb_channels.ig_user_id` [CÓDIGO: `graph.ts`,
`me?fields=user_id`]. Logo, a conexão de hoje e a nova apontam para a mesma
linha.

---

## 2. O que muda no código do CB CRM

Os arquivos de hoje estão em `src/lib/instagram/` e `src/app/api/cb/instagram/`,
mais as migrations 0989/0990 e o painel `cb-channels-panel.tsx`.

### 2.1 Login e troca

- **`oauth.ts`:**
  - o endereço passa a ser `www.facebook.com/dialog/oauth` com `client_id`
    (App ID principal), `config_id`, `redirect_uri`, `response_type=code`,
    `state` e `prompt=login`;
  - o `prompt=login` é o `force_reauth` de agora: sem ele, quem já está logado
    no Facebook segue como aquela conta [DOC];
  - sai o `scope`, porque a configuração diz as permissões [DOC].
- **O `state` assinado e o nonce no cookie ficam como estão.** O login manual
  do Facebook devolve o `state` intacto e recomenda usá-lo contra CSRF [DOC].
- **A troca é uma só:**
  - `GET graph.facebook.com/v27.0/oauth/access_token` com `client_id`,
    `client_secret` e `code`;
  - o guia do login manual diz que o `redirect_uri` é OBRIGATÓRIO na troca, e
    o guia do unificado o omite [DOC]. Mandá-lo não custa nada;
  - somem o `api.instagram.com` e o `ig_exchange_token`.
- **Permissão negada.** O Facebook Login for Business diz que, se a pessoa
  não conceder TODAS as permissões, o app não recebe nenhuma [DOC]. Então a
  checagem `permissoes.includes(...)` do callback perde o sentido. O que a
  resposta da troca traz (validade, permissões) é **[PENDENTE] (M8)**.
- **Depois da troca:**
  - `GET /me?fields=client_business_id` dá o portfólio do cliente, que se
    guarda com o token [DOC];
  - `GET /me/assigned_instagram_accounts?fields=id,username` dá as contas
    (pode vir mais de uma);
  - **cada conta vira uma conexão** (§4).
- **"Allow access to messages":**
  - quem entra pelo Instagram vê a pergunta no login;
  - quem entra pelo Facebook NÃO vê, e as chamadas de mensagem falham com
    `(#200)` até ligar no app do Instagram [DOC];
  - a tela do CRM precisa dizer isso, porque é o mesmo interruptor que o
    estudo de 09/09 já apontava.

### 2.2 Token

- **`ig_token_expires_at` fica nulo na configuração "nunca vence"**, e o aviso
  de vencimento da tela some nesse caso.
- **A Fase 6 do plano vira uma checagem de saúde.** Basta um
  `GET /{id-da-conta}?fields=username` por dia: erro de token (190) =
  `disconnected` com a frase "conecte de novo". O token morre quando o
  cliente tira o app do portfólio ou muda a conta de portfólio [DOC].
- **O token é guardado cifrado, sem teto de tamanho** ("o tamanho muda com o
  tempo") [DOC]. O `text` cifrado de hoje serve.
- **`appsecret_proof`:** se o app ligar "Exigir App Secret" nas configurações
  avançadas, toda chamada precisa da prova feita com o segredo do app. Isso
  quebra o desenho da central (§3), em que a instância não tem o segredo.
  Deixar desligado. (Isto é da Graph API em geral, de memória; a doc lida
  hoje só cita a prova na API de gestão dos tokens.)

### 2.3 Host e cliente da API

- **`graph.ts` hoje é preso a `graph.instagram.com` (`doGraphDoInstagram`), na
  `v26.0`.** O unificado pede um cliente preso a `graph.facebook.com`, com a
  mesma disciplina:
  - token só no cabeçalho `Bearer`;
  - `semSegredo`;
  - nenhuma URL vinda da resposta é seguida para outro host.
- `me()` deixa de dizer qual é a conta (§1). `perfil(igsid)` continua igual,
  mudando só o host. Se essa leitura precisa do recurso "Business Asset User
  Profile Access" na análise é **[PENDENTE] (M9)**.
- `health.ts` (que chama `/me`), `perfil.ts` e a rota do token colado
  (`[id]/instagram`) seguem o cliente novo.
- **Responder** (a Fase 4, não feita): `POST graph.facebook.com/{id-da-conta}/messages`,
  com o mesmo corpo [DOC]. Construída já assim, não se refaz.

### 2.4 Webhook

- **Assinar a conta:**
  - `POST graph.facebook.com/v27.0/{id-da-conta}/subscribed_apps?subscribed_fields=…`,
    conta por conta e antes de gravar a conexão, como hoje;
  - as assinaturas do login do Instagram **não passam** para o unificado
    [DOC].
- **Campos:**
  - a tabela do unificado lista `messages`, `message_reactions`,
    `messaging_postbacks`, `messaging_referral` e `messaging_seen`, e **não
    lista `message_edit`** [DOC];
  - o changelog da Meta diz que `message_edit` vale "para o Business Login for
    Instagram e o Facebook Login for Business" [DOC];
  - se a assinatura recusar o campo, o `assinarWebhooks` de hoje derruba a
    conexão inteira. **[PENDENTE] (M6)**.
- **Quem assina:**
  - hoje é o Instagram App Secret de cada conexão (`cb_channels.ig_app_secret`)
    [MEDIDO];
  - no unificado, a doc diz "o App Secret do app" [DOC]. Em 09/09 a doc dizia
    isso também, e errou;
  - **[PENDENTE] (M2)**.
- **A rota:**
  - `quaisAssinam` (cada `entry` só entra se a sua conexão assina) continua
    certo; muda só de onde vem o segredo;
  - no modo direto, vem do app da conta (`cb_instagram_config`);
  - no modo central, vem da central (§3).
- **O formato da mensagem:**
  - o unificado recebe "objetos do Facebook Login for Business" [DOC];
  - nos exemplos da Meta, a diferença está em comentários e menções; o bloco
    `messaging` (o que lemos) aparece igual [DOC];
  - `interpretarWebhook` não deve mudar. **[PENDENTE] (M10)** com uma DM real.
- **O verify token:**
  - hoje é um por conexão, e o GET varre as conexões;
  - no unificado, o webhook é do APP, então basta um por app (por conta, no
    modo direto; um só, na central).

### 2.5 Dois detalhes que mordem

- ⚠️ **O ID da mensagem (`mid`) muda de formato** [DOC]: "não reaproveite IDs
  de mensagem gravados da integração do login do Instagram". Duas
  consequências:
  - a edição, a exclusão e a citação de uma mensagem recebida ANTES da
    migração não acham a linha (o `persistir.ts` procura pelo `mid` dentro da
    conversa). Perde-se a edição de mensagem antiga, e só;
  - ⚠️⚠️ **enquanto as duas conexões coexistem, a mesma DM chega duas vezes**
    [DOC], com `mid` diferente. O `UNIQUE (conversation_id, message_id)` não
    descarta a segunda: cada DM viraria duas linhas no fio. Proteção proposta:
    cada conexão guarda o seu modo (`ig_login`) e a rota só aceita a entrega
    assinada pelo segredo DESSE modo. Isso funciona se os dois modos assinarem
    com segredos diferentes (M2).
- **O ID do cliente (IGSID) não deve mudar.** A doc da plataforma de
  mensagens diz que ele é "único para aquela conta" do Instagram e serve para
  mapear a mesma pessoa "em vários apps de mensagem" [DOC]. Se for assim, as
  fichas de hoje continuam casando. **[PENDENTE] (M5)**: se a primeira DM
  depois da migração criar ficha nova para cliente antigo, parar.

### 2.6 Banco

Uma migration nova, ADITIVA (aplicar antes do deploy). O número é o maior do
`main` + 1 na hora; hoje seria 1152.

- **`cb_channels`:**
  - `ig_login` (`instagram` | `unificado` | `central`, padrão `instagram`);
  - `ig_client_business_id`.
- **O CHECK `cb_channels_required_by_kind` (0989)** hoje exige
  `ig_app_secret` em toda conexão do Instagram. No unificado não há segredo
  por conexão. Ele passa a exigir só no modo `instagram`.
- **`cb_instagram_config` (0990):**
  - hoje guarda o Instagram App ID e Secret;
  - no modo direto, guarda o App ID e o Secret PRINCIPAIS, o `config_id` e o
    verify token do app.
- **Várias contas no mesmo token:** a forma mais simples é o token
  REPETIDO em cada conexão do mesmo `ig_client_business_id`. Reconectar
  atualiza todas de uma vez. Uma tabela própria de autorizações fica para
  quando houver motivo.

### 2.7 Tela e rotas novas

- **Bloco "App da Meta":** pede App ID principal, App Secret principal e ID
  da configuração, e mostra a URL de retorno, a do webhook e o verify token.
- **Botão:** "Conectar com Instagram ou Facebook". O texto avisa do portfólio
  e do "Allow access to messages" (a Meta pede que o app explique as telas
  antes [DOC]).
- **Rotas que a análise exige:** a URL de **desautorização** e a de
  **exclusão de dados** [PAINEL]. O CRM não tem nenhuma das duas hoje
  [CÓDIGO]. A Meta as chama com um `signed_request` assinado pelo segredo do
  app.
- **O token colado** (alternativa da D3): no unificado, o "Gerar token" do
  painel só serve a testador [DOC]. Proponho tirar (U10).

---

## 3. A central (para o Atlas hospedado)

### 3.1 Por que precisa

- **Um app da Meta tem UM endereço de webhook** para o objeto Instagram
  [DOC].
  - Não achei, na doc do Instagram, um endereço por conta. No WhatsApp
    existe o `override_callback_uri` por WABA (de memória, não conferido
    hoje).
- **Cada hospedado tem endereço, servidor e banco próprios**
  (`<escritorio>.crm.<domínio>`). A configuração do unificado pede UMA URL de
  retorno [DOC], e não conferi se aceita curinga (o login do Facebook, de
  memória, não aceita).
- **Sem central, sobram duas saídas:**
  - um app por escritório: é o "traga o seu app", difícil para cliente leigo;
  - registrar cada escritório à mão no app da Atlas: isso não resolve o
    webhook, que continua um só.

### 3.2 O que ela faz

| Peça | Como |
| --- | --- |
| Volta do login | A instância manda o navegador à central com o próprio `state` assinado. A central embrulha num `state` dela (instância + estado da instância + validade), abre o login da Meta com a URL de retorno DELA, troca o código com o segredo do app, lê o portfólio e as contas, assina o webhook de cada conta e grava a rota (conta → instância). Por fim devolve o navegador à instância com um **tíquete de uso único** |
| Resgate | A instância, com a sessão do admin e o nonce do cookie (as defesas de hoje), troca o tíquete pelo token e pelas contas numa chamada de servidor para servidor. O token nunca passa pelo navegador |
| Webhook | Confere a assinatura da Meta com o segredo do app, separa as `entry` por conta, põe na fila e responde 200 na hora. Repassa cada uma à instância dona, assinada pela central |
| Instância fora do ar | A fila tenta de novo, com espera crescente. A Meta tenta por 36 h [DOC]; a central guarda por um prazo curto (proposta: 7 dias, apagando ao entregar) |
| Conta sem rota | 200 e log. Nunca 4xx (4xx repetido faz a Meta desligar a entrega do app INTEIRO, para todos os escritórios) |
| Desconectar | A instância tira a assinatura com o próprio token e avisa a central para apagar a rota |
| Desautorização / exclusão de dados | A Meta chama a central, que acha a instância pela rota e avisa |
| A mesma conta em dois escritórios | A central recusa ("já conectada em outro escritório"), como o `outra_conta` de hoje |

- **Responder não passa pela central.** A instância chama
  `graph.facebook.com` direto com o token do próprio cliente. O token é
  recortado pelo portfólio do cliente: vazado, expõe só aquele escritório
  [DOC].
- **Quem fala com a central:**
  - a instância → a central: com uma credencial da instância, gravada pelo
    provisionador no `atlas.env`, pela entrada padrão, como a licença;
  - a central → a instância: com uma assinatura que cobre o destino e a hora,
    para a entrega de um escritório não servir noutro.

### 3.3 Onde ela mora (U5)

| Opção | A favor | Contra |
| --- | --- | --- |
| **Função no Supabase do Atlas Gestor** (recomendada) | O Gestor já conhece cada hospedado e o endereço dele, e já fala com as instâncias (a licença). É gerenciada, com HTTPS pronto e sem VPS a mais | É outro repositório. A DM passa e espera na fila no banco do Gestor, o que pede cuidado de LGPD (retenção curta) |
| Serviço próprio numa VPS da Atlas | Controle total, sem os limites de uma função | Mais uma máquina para cuidar. A VPS de operação guarda credencial de infraestrutura e não deveria receber tráfego público |
| O próprio CRM em "modo central" | Reaproveita assinatura e OAuth | Mistura papéis no produto |

⚠️ **Concentração:** a central e o app único passam a ser um ponto só para o
Instagram de todos os escritórios.
- Central fora do ar = nenhuma DM entra (a Meta e a fila seguram).
- App suspenso ou análise reprovada = todos param.
- É o preço de o cliente não montar app nenhum. O "traga o seu app" (§5) fica
  como saída para quem precisar.

---

## 4. Várias contas do Instagram por escritório

**Pergunta do operador (19/11):** dá para conectar mais de um Instagram em
cada escritório, como temos vários números de WhatsApp?

**Resposta curta:** sim. Já funciona hoje e continua no unificado. Há uma
diferença de natureza em relação ao WhatsApp, na ficha do cliente.

### 4.1 Hoje (login do Instagram)

- Cada conta do Instagram é **uma conexão própria** em `cb_channels`
  [CÓDIGO]:
  - é roteada pelo `ig_user_id`;
  - tem índice único GLOBAL (a mesma conta não entra em duas contas do CRM);
  - a conta do CRM não tem teto de contas do Instagram.
- **Uma conta por login:** o `force_reauth` faz o Instagram perguntar qual. O
  escritório clica "Conectar com Instagram" uma vez por conta, e cada conta
  precisa estar adicionada ao app como testadora (Standard Access). Foi o
  pedido que revisou a D3 em 09/09 ("mais de uma conta, todas do meu
  escritório").
- **A rota do webhook** separa as `entry` por conta e confere o segredo de
  cada uma [CÓDIGO].

### 4.2 No unificado

- **Um login traz várias contas de uma vez:** o cliente marca as contas que
  quer compartilhar, e um token cobre todas [DOC]. O callback cria uma
  conexão para cada conta de `/me/assigned_instagram_accounts` e assina o
  webhook de cada uma.
- **Contas em portfólios diferentes** pedem um login por portfólio, com um
  token por portfólio [DOC].
- **Na central** é igual: uma rota por conta do Instagram, várias por
  instância, uma conta em uma instância só.
- **Limites da Meta:**
  - em Standard Access, o painel aceita até **50** testadores do Instagram
    [DOC];
  - com acesso avançado, não achei teto de contas por app na doc;
  - não conferi o teto de chamadas por conta.
- **[PENDENTE] (M11): o cliente que entra de novo e marca OUTRO conjunto de
  contas.** O token antigo continua cobrindo a conta desmarcada? O que
  `/me/assigned_instagram_accounts` devolve? Sem medir, a regra segura é:
  - a conta que sumiu da lista fica `disconnected`, com "conecte de novo";
  - ela nunca é apagada em silêncio.
- **No Atlas,** o teto do plano (1172, numa branch do Atlas) conta só as
  conexões de WhatsApp; o Instagram é um módulo liga/desliga, sem contagem.
  Se o Instagram deve ter teto por plano é decisão de produto (U14).

### 4.3 A diferença para o WhatsApp

- ⚠️ **O mesmo cliente vira uma FICHA POR CONTA do Instagram do escritório.**
  - No WhatsApp, o telefone é o mesmo para todos os números do escritório, e
    a ficha é uma só.
  - No Instagram, o ID do cliente (IGSID) é "único para aquela conta" [DOC].
    A pessoa que escreve para `@escritorio.previdencia` e para
    `@escritorio.trabalhista` chega com dois IGSIDs.
  - O CRM cria duas fichas (`contacts.instagram_id` é único por conta do
    CRM) e duas conversas. Nada se mistura, mas a equipe vê duas fichas.
- **O `@` da pessoa é o mesmo nas duas.** O aviso de possível duplicata hoje
  não usa o `@` [CÓDIGO: `duplicatas.ts`]. Usar seria um sinal forte novo
  (U14).
- **A unificação manual (Fase 5, não feita)** foi desenhada para UMA ficha do
  Instagram com UMA do WhatsApp: a ficha só tem uma coluna `instagram_id`.
  Juntar as duas fichas do Instagram da mesma pessoa pede guardar um IGSID
  POR CONTA do escritório (uma tabela ficha ↔ conta ↔ IGSID). Isso pesa no
  desenho da Fase 5.
- **Responder sempre pela conta que recebeu.** O IGSID só vale na conta dele:
  responder a uma DM da `@a` pela `@b` falha.
  - O fio já não oferece trocar de conexão em conversa do Instagram, e a
    "Nova conversa" não oferece o Instagram [CÓDIGO: `message-thread.tsx`,
    `conversation-list.tsx`].
  - A Fase 4 mantém isso: o envio usa a conexão da conversa, nunca o padrão.

---

## 5. Arquitetura por modo de instalação

| Modo | App da Meta | Login e webhook | Segredo do app | Token |
| --- | --- | --- | --- | --- |
| **CB CRM** (servidor próprio do CB) | Recomendado: o app da Atlas (opção A, §6), com o CB como cliente. Alternativa: o app do próprio CB no modo direto | Opção A: pela central, com o CB cadastrado como instância de fora. Direto: no próprio site do CB | Opção A: só na central. Direto: no CRM do CB | No CRM do CB |
| **Hospedado SaaS** | App da Atlas | Pela central | Só na central | Na instância do escritório |
| **Hospedado Personalizado** | App da Atlas (padrão). Ou "traga o seu app", modo direto, se o cliente quiser a marca dele na tela de consentimento | Central, ou direto no endereço do escritório | Central, ou o do app do cliente na instância | Na instância |
| **Instalação própria** (`atlas-crm-venda`) | "Traga o seu app", modo direto. A central como opção fica para depois (U12) | Direto, no domínio do cliente | No CRM do cliente | No CRM do cliente |

- **SaaS e Personalizado são iguais para a central:** uma instância
  cadastrada, com endereço e credencial. O Personalizado tem código próprio
  (uma cópia do canal SaaS mais a personalização), então o cliente da central
  precisa estar no produto-base. O contrato da central precisa ter VERSÃO,
  porque o Personalizado pode ficar uma versão atrás.
- **A instalação própria está em espera desde 16/11** (decisão do operador no
  plano do hospedado). Mesmo assim, o modo direto é o mesmo código que o
  Personalizado com o próprio app usaria. Sai junto, sem custo a mais.
- **O "traga o seu app" no unificado é mais difícil que hoje:**
  - o app do cliente precisa estar num portfólio, e o Facebook Login for
    Business diz que o portfólio do app "precisa ser separado" do portfólio
    do cliente [DOC];
  - se isso valer também para o escritório que conecta a PRÓPRIA conta no
    PRÓPRIO app (M4), o "traga o seu app" exige dois portfólios;
  - com cliente leigo, isso é mais um motivo para a central.
- **O código do CRM fica com três modos por conexão:**
  - `instagram`: o de hoje, que sai depois da migração;
  - `unificado`: o direto, com o próprio app;
  - `central`.
  
  O núcleo (webhook → persistir, perfil, mídia, envio) é o mesmo nos três.

---

## 6. Um app só para o CB e para o Atlas?

### Opção A: o app da Atlas, com o CB como cliente (recomendada)

- **Como fica:**
  - o app é do portfólio da Atlas, que faz a verificação da empresa, vira
    Provedor de Tecnologia e passa na análise;
  - as contas do Instagram do CB ficam no portfólio do CB, separado, como o
    Facebook Login for Business pede [DOC].
- **O CB conecta ANTES da análise:**
  - o acesso padrão (Standard) vale para quem tem papel no app ou num
    portfólio que reivindicou o app [DOC];
  - quem conecta é o operador, que tem papel no app da Atlas e controle total
    do portfólio do CB. É a condição que a doc dá para testar o token do
    usuário do sistema [DOC];
  - o CB vira o piloto real da central.
- **Clientes do Atlas antes da análise:** só se a pessoa do escritório
  ganhar papel no app (testador). Serve para piloto, não para venda.
- **A favor:**
  - uma análise só e uma verificação só;
  - a tela de consentimento mostra o nome do produto;
  - o CB prova o caminho antes dos clientes.
- **Contra:**
  - o Instagram do CB passa a depender da central e da análise da Atlas;
  - o CB CRM (fork próprio) precisa do cliente da central, que é código a
    portar dos dois lados (`interno/PORTAR-do-CB-CRM.md` no Atlas).

### Opção B: o app do CB atende os dois (não recomendo)

- **O portfólio do escritório de advocacia viraria o Provedor de
  Tecnologia,** com verificação e análise em nome do escritório.
- **A tela de consentimento** mostraria a outro escritório o app do CB pedindo
  as DMs dos clientes dele.
- **Mover o app para o portfólio da Atlas depois** pode tirar o selo: a doc
  da verificação de acesso (aposentada em 10/2026, mantida como referência)
  dizia que o status de Provedor se perde quando o app se desconecta do
  portfólio que o reivindicou [DOC].
- **O que não conferi:** se o app pode mudar de portfólio levando a análise
  aprovada.

### Opção C: dois apps, o do CB só para o CB e o da Atlas para os clientes

- **O app do CB segue com acesso padrão,** sem análise, se a medição M3 der
  certo.
- **A favor:** independência do CB.
- **Contra:**
  - dois apps e duas configurações para manter;
  - se o portfólio do app e o da conta precisarem ser diferentes (M4), o app
    do CB no unificado nem funciona sem um segundo portfólio.

### O que cada opção implica

| | A | B | C |
| --- | --- | --- | --- |
| Verificação da empresa | Atlas | CB | Atlas (e o CB, se M3 exigir análise) |
| Provedor de Tecnologia | App da Atlas | App do CB | App da Atlas |
| Análise (App Review) | Uma, da Atlas | Uma, do CB | Uma da Atlas (e talvez outra do CB) |
| Portfólio das contas do CB | O do CB, como cliente | O mesmo do app (M4) | O mesmo do app (M4) |

⚠️ **"Tornar-se Provedor de Tecnologia" é feito no app que vai servir os
clientes, nunca no app atual do CB.** O estudo de 09/09 registrou um relato
de que o passo é irreversível [TERCEIRO, fórum da Meta].

---

## 7. Contradições da doc e as medições

### 7.1 As contradições (registradas sem escolher lado)

| Tema | Um lado | O outro lado |
| --- | --- | --- |
| Análise para a conta PRÓPRIA | A página de App Review: "app só para uma empresa que eu possuo ou gerencio → Standard → **não exigida**". Ela não tem linha para o unificado [DOC]. A visão geral diz o mesmo [DOC] | O painel: "para que seu app acesse dados ao vivo, o Instagram exige que o processo de análise do app seja realizado" [PAINEL]. As páginas do unificado: Standard "basta para testar com pessoas que têm papel no app" [DOC] |
| Verificação da empresa | A página de verificação: quem só tem usuários com papel no app não precisa [DOC] | A página de webhooks: "exigida para acesso de produção", nos três logins [DOC]. Em 09/09, o app publicado SEM verificação recebeu DMs reais [MEDIDO] |
| Onde configurar o webhook | O guia de migração: produto Webhooks do app, objeto Instagram, "não a da aba do login do Instagram" [DOC] | A página de webhooks: "Configure webhooks" na aba do unificado [DOC]. Talvez seja a mesma configuração vista por dois caminhos (M1) |
| Quem assina a entrega | A doc: o App Secret do app [DOC] | Em 09/09, a doc dizia o mesmo e a medição mostrou o Instagram App Secret [MEDIDO] |
| `message_edit` | Fora da tabela de campos do unificado [DOC] | O changelog: vale para o Facebook Login for Business [DOC] |
| Um app com os dois logins | A página do caso de uso: "só uma configuração por app" [DOC] | O guia de migração: "use o app que você já tem" [DOC]. A sessão de origem viu as duas abas lado a lado [PAINEL] |
| App novo | O guia de migração: app novo não monta o login do Instagram [DOC] | O nosso manual em PDF ensina exatamente isso (§7.4) |

### 7.2 As medições (antes de qualquer código)

Num **app descartável**, nunca no app do CB. O estudo de 09/09 ensinou:
caso de uso e escolhas do painel podem não ter volta. Cada uma espera o
"pode" do operador.

| # | Pergunta | Como | Decide |
| --- | --- | --- | --- |
| M1 | O webhook do unificado é a mesma configuração do webhook da aba do login do Instagram? | Olhar as duas telas no app descartável (e, só olhando, no do CB) | Se trocar um derruba a conexão de teste de hoje |
| M2 | Que segredo assina a entrega do unificado? | Uma DM real, com o receptor de teste guardando o corpo cru e testando os dois segredos | A rota e a proteção contra a DM em dobro (§2.5) |
| M3 | Com o app publicado e acesso padrão, a DM de quem NÃO tem papel no app chega? | O mesmo teste de 09/09 (conta que não segue, sem papel) | Se o CB precisa de análise; o peso da opção C |
| M4 | O token do usuário do sistema sai quando a conta está no MESMO portfólio do app? | Conectar uma conta do mesmo portfólio pelo login do app descartável | O "traga o seu app"; as opções B e C |
| M5 | O IGSID do cliente é o mesmo nos dois logins? | A mesma pessoa escreve antes e depois de conectar pelo unificado | Se as fichas de hoje continuam casando |
| M6 | O `subscribed_apps` do unificado aceita `message_edit`? | A chamada, com e sem o campo | Se a edição de DM continua chegando |
| M7 | App criado hoje mostra a aba do login do Instagram? | Criar o app descartável (é o primeiro passo das outras) | O manual em PDF; o "traga o seu app" |
| M8 | O que a troca do código devolve (validade, permissões)? | Olhar a resposta, sem gravar o token em lugar nenhum | O callback |
| M9 | A leitura do perfil do cliente (nome, `@`, foto) funciona com o token novo e acesso padrão? | `GET /{igsid}?fields=name,username,profile_pic` | Se a análise precisa pedir o recurso de perfil |
| M10 | O bloco `messaging` chega igual ao de hoje? | Comparar o corpo cru com o de 09/09 | Se `interpretarWebhook` muda |
| M11 | Entrar de novo marcando outras contas: o que acontece com o token antigo e com a lista? | Duas contas de teste, dois logins | A regra de várias contas (§4.2) |

[ESTIMATIVA] Meio dia com o operador no painel, como a Fase 0 de 09/09. Cada
medição dá também os passos certos do manual.

### 7.3 O que fica para o primeiro uso real

- **A DM em dobro durante a migração** (§2.5): se a proteção pelo segredo
  segura.
- **A tela de consentimento em português:** o que aparece para o cliente
  leigo, para escrever a ajuda da tela.

### 7.4 Aviso ao manual em PDF

O manual da outra sessão ensina o cliente a criar o próprio app com o login
do Instagram.

- **Se a M7 confirmar a doc,** um escritório que criar o app hoje não vê essa
  aba, e o manual não vale para ele.
- **O app do CB mostra as duas abas** porque foi criado em 09/09.
- **O manual do login unificado** só faz sentido depois que o CRM aceitar o
  unificado. E, com a central, o cliente do hospedado nem cria app.

---

## 8. Passos do operador no painel da Meta

Nenhum agora: todos esperam o "pode" e as decisões.

### 8.1 Medições (app descartável, §7.2)

1. Criar um app de tipo Negócios no portfólio do escritório, com o caso de
   uso "Gerenciar mensagens e conteúdo no Instagram".
2. Anotar se aparece só a aba do unificado (M7).
3. Na aba do unificado: "Configure your app" → "Create new configuration".
   - Em "Edit permissions", deixar só `instagram_basic` e
     `instagram_manage_messages`, e tirar comentários, publicação e anúncios.
   - Conferir na prévia o tipo de token (SUAT) e a validade.
   - "Use this configuration" → URL de retorno do receptor de teste → "Save".
4. Webhook do objeto Instagram com o receptor de teste. Assinar os campos de
   mensagem.
5. Adicionar a conta de teste como testadora e aceitar o convite no
   Instagram na web.
6. Publicar o app (pede a URL de privacidade, como em 09/09).

### 8.2 CB, na opção A

1. No app da Atlas, depois da central pronta, conectar as contas do CB pelo
   botão novo do CRM.
2. Conferir uma DM e uma resposta.
3. No app atual do CB, tirar o webhook do login do Instagram e desligar a
   conexão antiga (§9).

### 8.3 App da Atlas (para vender)

1. App de tipo Negócios no portfólio da Atlas.
2. A configuração do §8.1, com a URL de retorno da central.
3. O webhook do objeto Instagram com o endereço da central e o verify token
   dela.
4. As URLs de desautorização e de exclusão de dados (da central), ícone,
   categoria, e-mail da empresa e política de privacidade da Atlas.
5. Verificação da empresa da Atlas, no Gerenciador de Negócios. Pode começar
   já, porque é a fila mais longa (§10).
6. "Tornar-se Provedor de Tecnologia" neste app.
7. A análise:
   - acesso avançado a `instagram_basic` e `instagram_manage_messages` (e
     `public_profile`, que o Facebook Login for Business pede antes de ir ao
     ar [DOC]);
   - "Human Agent" se U9 disser sim;
   - vídeo da tela em inglês ou com legenda [DOC], mostrando o login, a
     escolha do portfólio e das contas, a DM chegando e a resposta;
   - um escritório de demonstração com conta de teste para o revisor.

---

## 9. Migração das conexões que já existem

- **Hoje,** no CB, há no máximo a conexão de teste do operador (Fase 3 ainda
  esperando a primeira DM real). Não consultei o banco: o pedido foi não
  tocar em `cb_channels`. No Atlas, o Instagram ainda não tem cliente real (a
  conferir antes de migrar).
- **O caminho de cada conexão** segue a doc [DOC] e as nossas regras:
  1. manter a conexão e a assinatura antigas;
  2. conectar pelo login novo;
  3. o mesmo `ig_user_id` cai na MESMA linha de `cb_channels` (§1), e o
     recadastro já sobrescreve a credencial e preserva rótulo e Human Agent
     [CÓDIGO: `canal.ts`];
  4. a linha passa a `ig_login = 'unificado'` ou `'central'`;
  5. assinar o webhook pelo `graph.facebook.com`;
  6. conferir UMA chamada à API e UMA DM;
  7. só então tirar a assinatura antiga (`DELETE` no `subscribed_apps` do
     `graph.instagram.com`, com o token antigo) e o webhook da aba do login do
     Instagram.
- **Se algo falhar,** a conexão volta ao modo `instagram`: os tokens velhos
  continuam válidos até vencer [DOC: o login do Instagram segue funcionando].
- **As conversas, as fichas e o histórico não mudam:** a linha da conexão é a
  mesma e o IGSID não muda (a confirmar, M5).
- **O que se perde:** editar, apagar ou citar mensagem recebida antes da
  troca (o `mid` muda; §2.5).
- **O código do login do Instagram** sai num PR depois que a última conexão
  migrar [DOC: "depois que todo cliente reconectar, remova o código do login
  do Instagram"].

---

## 10. Riscos, custos e prazos

### 10.1 Riscos

| # | Risco | O que segura |
| --- | --- | --- |
| R1 | O unificado é NOVO: nem aparece no changelog da Meta, e a doc lista o que ainda não suporta (entrar pelo app do Instagram, passar a conta pessoal para profissional no login, o "API integration helper") [DOC] | As medições; manter o login do Instagram no ar até a migração provar |
| R2 | A análise vale também para a conta própria (a contradição do §7.1) | A M3 decide; se valer, a opção A faz uma análise só |
| R3 | Central fora do ar = Instagram de todos os escritórios parado | Fila durável; a Meta retenta por 36 h [DOC]; 200 sempre, nunca 4xx |
| R4 | O app único suspenso, ou reprovado na revisão contínua ("Ongoing Review") ou nas checagens de uso e proteção de dados [DOC] = todos param | Um responsável pelas revisões e pelos avisos da Meta; o "traga o seu app" como saída de emergência para quem precisar |
| R5 | DM em dobro durante a migração (`mid` novo) | A rota aceita só o segredo do modo da conexão (M2) |
| R6 | O token "nunca vence" é credencial de alto valor | Cifrado como hoje; recortado por portfólio [DOC]; o cliente revoga tirando o app do portfólio [DOC] |
| R7 | A verificação da empresa demora | Começar já, em paralelo com o código |
| R8 | LGPD: a DM passa pela central e espera na fila | Retenção curta, apagar ao entregar, nada de log com conteúdo; contrato de operadora de dados (já previsto no plano do hospedado) |
| R9 | Rotacionar a `ENCRYPTION_KEY` invalida os tokens (como hoje) | A regra da casa: nunca sem avisar |
| R10 | A mesma pessoa em duas contas do escritório vira duas fichas (§4.3) | Aviso de possível duplicata pelo `@` (U14); a Fase 5 desenhada para várias contas |

### 10.2 Custos da Meta

Não achei preço na doc lida, nem para a análise, nem para a verificação da
empresa, nem por mensagem do Direct.
- Diferente do WhatsApp, a doc de mensagens do Instagram não fala em
  cobrança. A conferir antes de vender.
- A "verificação de acesso" do Provedor de Tecnologia foi aposentada em
  09/10/2026. Continuam a verificação da empresa, a análise para permissões
  avançadas e as obrigações de dados (termos, "Data Use Checkup",
  questionário de tratamento de dados, avaliação de proteção de dados) [DOC,
  blog da Meta].

### 10.3 Prazos da Meta

- **Análise:** a única faixa oficial que achei é a da doc de jogos, de 1 a 5
  dias úteis, e mais na alta demanda [DOC, outra área]. Relatos no fórum da
  Meta falam em 10 a 13 dias ou mais [TERCEIRO].
- **Verificação da empresa:** não achei prazo oficial. Relatos de 2 semanas
  a 60 dias "em análise" [TERCEIRO].

### 10.4 O nosso esforço [ESTIMATIVA]

| Peça | Dias |
| --- | --- |
| Medições M1–M11 com o operador | 0,5–1 |
| Modo direto do unificado no CB CRM (login, troca, contas, assinatura, webhook pelo segredo do app, migration, tela, desautorização e exclusão) | 4–6 |
| Central (rotas, fila, cadastro de instância, entrega assinada, testes) | 6–10 |
| Cliente da central no CRM e a credencial pelo provisionador | 3–5 |
| Preparar a análise (vídeo, escritório de demonstração, textos) | 2–3, mais a espera da Meta |
| Responder pela caixa (a Fase 4 antiga), já sobre o unificado | a estimativa da Fase 4, sem refazer |

---

## 11. Decisões do operador

| # | Pergunta | Minha recomendação |
| --- | --- | --- |
| U1 | Trocar para o unificado e construir a Fase 4 (responder) já sobre ele? | Sim. As Fases 4 e 6 do plano antigo param até lá (a 6 vira checagem de saúde) |
| U2 | Que app atende o CB: A (cliente do app da Atlas), B (o app do CB atende os dois) ou C (dois apps)? | A |
| U3 | Revisar a **D3**: no app da Atlas, acesso avançado, Provedor de Tecnologia e verificação da empresa da Atlas? | Sim, e começar a verificação já |
| U4 | Fazer as medições do §7.2 num app descartável antes do código? | Sim |
| U5 | Onde mora a central? | Função no Supabase do Gestor |
| U6 | A central guarda a DM numa fila até entregar? Por quanto tempo? | Sim, até 7 dias, apagando ao entregar |
| U7 | Validade do token: "nunca vence" ou 60 dias? | Nunca vence, com checagem diária de saúde |
| U8 | Permissões: só mensagens, ou já comentários e publicação? | Só mensagens (permissão a mais é análise a mais) |
| U9 | Pedir o "Human Agent" (7 dias) na mesma análise? A D2 o deixava para depois | Pedir junto se o escritório responde depois de 24 h; senão, depois |
| U10 | O token colado (alternativa da D3) sai no unificado? | Sai |
| U11 | "Traga o seu app" (modo direto): oferecer no Personalizado e na instalação própria, como caminho avançado, e o manual em PDF passa a ser deste caminho? | Sim, depois da central e das medições |
| U12 | A instalação própria pode usar a central da Atlas (pela licença)? | Não por agora (modalidade em espera desde 16/11) |
| U13 | Quando migrar a conexão de teste do CB, e o que fazer com o app atual do CB? | Depois de a conexão nova provar uma DM e uma resposta; então tirar o webhook antigo e aposentar o app |
| U14 | Várias contas do Instagram: (a) o aviso de possível duplicata passa a usar o `@` do Instagram? (b) a Fase 5 (unificar fichas) é desenhada para várias contas do escritório? (c) no Atlas, o Instagram conta no teto de conexões do plano? | (a) sim; (b) sim; (c) produto decide; hoje não conta |

---

## 12. Fases propostas (viram o `docs/PLANO-*.md` depois do "pode")

Uma branch e um PR por fase, a partir do `main` (seção 14 do `CLAUDE.md`).

1. **U-0, medições** (sem código): M1–M11 num app descartável, com o
   resultado escrito neste estudo.
2. **U-1, modo direto no CB CRM:**
   - a migration aditiva;
   - o cliente do `graph.facebook.com`;
   - o login e a troca;
   - várias contas por login;
   - a assinatura por conta;
   - o webhook pelo segredo do app, com a proteção contra a DM em dobro;
   - a desautorização e a exclusão de dados;
   - a tela;
   - a doc entregue (`docs/INSTALACAO.md`).
3. **U-2, responder pela caixa:** a Fase 4 antiga, já no unificado.
4. **U-3, a central** (Atlas, fora deste repositório): rotas, fila, cadastro
   de instância e credencial pelo provisionador.
5. **U-4, cliente da central no CRM:** o modo `central`, a volta com
   tíquete e a entrega assinada.
6. **U-5, análise da Meta:** o app da Atlas, o vídeo e o escritório de
   demonstração.
7. **U-6, migrar o CB:** a conexão de teste, a retirada do webhook antigo e
   do código do login do Instagram.
8. **Porte ao Atlas** de U-1, U-2 e U-4, registrado em
   `interno/PORTAR-do-CB-CRM.md` (a numeração das migrations lá é outra).

---

## Fontes (Meta, consultadas em 19/11/2026)

- Instagram API with Unified Login:
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
- Get started (Unified Login):
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
- Authentication and access tokens (Unified Login):
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication
- Business onboarding (Unified Login):
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/business-onboarding
- Permissions (Unified Login):
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions
- Eligibility and troubleshooting (Unified Login):
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting
- Migration (Unified Login):
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/migration
- Migration guide for Instagram Login apps:
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide
- Set up Webhooks:
  https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
- Webhook fields:
  https://developers.facebook.com/documentation/instagram-platform/webhooks/fields
- Webhook examples:
  https://developers.facebook.com/documentation/instagram-platform/webhooks/examples
- Instagram Platform overview:
  https://developers.facebook.com/documentation/instagram-platform/overview
- App Review for Instagram API:
  https://developers.facebook.com/documentation/instagram-platform/app-review
- Changelog (o `message_edit` para o Facebook Login for Business):
  https://developers.facebook.com/documentation/instagram-platform/changelog
- Customize the Instagram use case (Become a Tech Provider):
  https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case
- Facebook Login for Business:
  https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
- Manually build a login flow (`state`, `redirect_uri` na troca):
  https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow
- App modes:
  https://developers.facebook.com/documentation/development/build-and-test/app-modes
- Business Verification:
  https://developers.facebook.com/documentation/development/release/business-verification
- Access Verification (aposentada):
  https://developers.facebook.com/documentation/development/release/access-verification
- Retiring Access Verification for Tech Provider Apps (blog, 09/10/2026):
  https://developers.facebook.com/blog/post/2026/10/09/retiring-access-verification-for-tech-provider-apps
- Messenger Platform overview (IDs escopados por conta):
  https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview
- Instagram Messaging, apps for your own business:
  https://developers.facebook.com/documentation/business-messaging/instagram-messaging/app-review/apps-for-your-own-business
- App Review (jogos), a faixa de 1 a 5 dias úteis:
  https://developers.facebook.com/documentation/games/launch/reviews/app-review
