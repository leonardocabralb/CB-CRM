# Plano — Instagram pelo login unificado e a central da Atlas

> **Nasce em:** 21/11/2026 · **Base:** `docs/ESTUDO-instagram-login-unificado.md`
> (o porquê de cada passo está lá; aqui fica o quê e em que ordem).
>
> **Objetivo do operador:** que os escritórios do SaaS conectem o Instagram
> Direct com um clique, pelo app único da Atlas, sem montar app na Meta.
>
> **Plano vivo.** Cada fase de código é uma branch a partir do `main` do
> repositório dela e um PR (seção 14 do `CLAUDE.md`). A caixa é marcada
> quando o PR entra. Nada muda no painel da Meta sem o "pode" do operador
> naquela conversa.
>
> **Repositório público:** nenhum ID real de app, conta, portfólio ou
> configuração neste arquivo.

## Decisões

| # | Decisão | Estado |
| --- | --- | --- |
| U3 | App único da Atlas: Provedor de Tecnologia, verificação da empresa e análise com acesso avançado (revê a D3 para o produto) | Decidida e feita no painel (21/11) |
| U5 | A central mora no CRM de homologação do Atlas, com endereço próprio (`central.<domínio da Atlas>`) | Decidida (21/11) |
| U7 | Token do usuário do sistema que nunca vence, com checagem diária de saúde | A configuração já nasceu assim (21/11) |
| U8 | Só as permissões de mensagens (`instagram_basic`, `instagram_manage_messages`) | Decidida e aplicada na configuração (21/11) |
| U2 | O CB vira cliente do app da Atlas (opção A): conecta pela central, como instância de fora do SaaS | Decidida (22/11): sim |
| U6 | A central guarda a entrega que falhou por até 7 dias e a apaga ao entregar | Decidida (22/11): sim |
| U9 | O Human Agent vai na mesma análise da Meta | Decidida (22/11): sim |
| U4 | Medições antes do código | **Pendente** (recomendada); a M7 já foi medida |
| U10–U14 | Token colado, "traga o seu app", instalação própria, migração do CB, várias contas | **Pendentes** (estudo, §11) |
| — | Social selling (automações no Instagram) | Ideia futura; revê a D1 (estudo, §14) |

## O que já existe (21/11/2026)

- **No painel da Meta:**
  - o portfólio "Atlas Tecnologia Jurídica" (não verificado);
  - o app "Atlas CRM", em desenvolvimento, como Provedor de Tecnologia;
  - as configurações básicas do app (privacidade, exclusão de dados, ícone,
    categoria);
  - a configuração do login unificado, só com mensagens.
  
  Detalhes no estudo, §13.
- **No site da Atlas:** a política de privacidade, com a seção de exclusão de
  dados, publicada.
- **No CB CRM, por outras sessões:**
  - os textos da tela para o app antigo (PR #537);
  - a marca do Instagram na caixa (PR #538);
  - a resposta pela caixa e a renovação do token no login do Instagram (a
    Fase 4 e a Fase 6 do plano antigo), em andamento.

## Fases

### U-0 — Medições (sem código de produto)
No app da Atlas em desenvolvimento, com contas testadoras, e com o receptor
de teste (`feat/instagram-receptor-de-teste`) atrás de um túnel. Cada passo
no painel espera o "pode".
Em 22/11, o app da Atlas recebeu a URL de retorno e o webhook do receptor de
teste, provisórios (estudo, §13).

**Decisão do operador (22/11): o que pede a mão dele fica para o piloto
(U-5).** A Meta só mostra o App Secret depois de pedir de novo a senha do
Facebook, e a DM de teste tem de sair de outra conta do Instagram: as duas
coisas são do operador. O receptor e o túnel foram desligados. M2, M5, M6 (a
chamada), M8–M11 se medem na primeira conexão do piloto, com os mesmos
registros de forma.
- [x] M1: o webhook do objeto Instagram é a mesma configuração do webhook da
      aba antiga? **Não:** são separados (22/11).
- [ ] M2: que segredo assina a entrega do unificado. (Espera o operador.)
- [ ] M3: a DM de quem não tem papel no app chega com acesso padrão e o app
      publicado. (Espera a verificação: publicar está bloqueado.)
- [ ] M4: o token sai quando a conta está no mesmo portfólio do app. (Sem
      conta no portfólio da Atlas para medir.)
- [ ] M5: o IGSID é o mesmo nos dois logins. (Espera o operador.)
- [ ] M6: o `subscribed_apps` aceita `message_edit`. O campo está na lista do
      app (22/11); falta a chamada da conta.
- [ ] M8: o que a troca do código devolve.
- [ ] M9: a leitura do perfil funciona com o token novo.
- [ ] M10: o bloco `messaging` chega igual ao de hoje.
- [ ] M11: entrar de novo marcando outras contas.
- [ ] Resultado escrito no estudo, §7.2.

### U-1 — Modo direto do unificado no CB CRM
Branch `feat/instagram-unificado-direto` (22/11/2026). O código mora nos
módulos de hoje (`graph.ts`, `oauth.ts`, `app.ts`, `canal.ts`) e em um novo,
`conectar-unificado.ts`: a pasta `unificado/` do primeiro rascunho não fazia
falta. Nada muda na conexão do CB, que segue no login do Instagram.
- [x] **Migration aditiva 1153** (a 1152 é de outra branch, ainda não
      aplicada). Aplicar antes do deploy.
  - `cb_channels.ig_login` (`instagram` | `unificado` | `central`, padrão
    `instagram`) e `ig_client_business_id`;
  - `cb_instagram_config.login` e `config_id` (o CHECK exige o ID no
    unificado; o replay local pegou o `IS NOT NULL` que faltava);
  - **mudou do rascunho:** o CHECK da 0989 FICA. `ig_app_secret` passa a ser
    "o segredo que assina a entrega da conexão" (no unificado, o App Secret
    principal). Assim o webhook não muda, e a DM em dobro se barra sozinha (a
    conta tem uma linha só, e ela casa a assinatura de um app só). O verify
    token continua por conexão (o GET do webhook já varre todas);
  - `ig_login` entrou em `CB_CHANNEL_SAFE_COLUMNS` (a tela esconde o
    "Renovar token" do unificado).
- [x] **Cliente preso a `graph.facebook.com/v27.0`** (`pedirComToken`,
      `contaDaConexao`): o token vai só no `Bearer` e passa por `semSegredo`,
      e o `next` da paginação não é seguido.
- [x] **Login e troca:** a URL igual à que o painel gera (medida em 22/11), uma
      troca só, `client_business_id`, `/me/assigned_instagram_accounts` e uma
      conexão por conta (a falha de uma não derruba as outras).
- [x] **Webhook:** sem mudança na rota (o segredo já é o da conexão); o leitor
      aceita também a forma `changes[]` do evento de teste do painel.
- [x] **Envio:** `{ig-id}/messages` no unificado. O login do Instagram segue
      com `me/messages`, como o PR #539 deixou.
- [x] **Renovação e saúde:** a renovação pula o unificado. A saúde é a sonda
      de Conexões, que já existia, agora no host do login.
- [ ] **Rotas de desautorização e de exclusão de dados:** **movidas para a
      U-2.** Quem vai à análise é o app da Atlas, e as URLs dele apontam para
      a central. No modo direto, o app é do próprio escritório.
- [x] **Tela:** o tipo do app (novo × antigo), App ID, App Secret e ID da
      configuração, os textos de cada tipo, o botão "Conectar com Instagram
      ou Facebook" e os passos do webhook da aba certa. Chaves nos dois
      dicionários.
- [x] **Documentação:** `docs/INSTALACAO.md` e `.claude/rules/instagram.md`.
      Nenhuma variável de ambiente nova.
- [x] Typecheck e testes verdes, e replay das migrations num Postgres vazio
      (local). O login atual segue igual.
- [x] **Mesclada:** PR #541, merge `9b8b11ff` (22/11/2026), com a 1153
      aplicada antes. A primeira conexão real pelo unificado é o piloto
      (U-5) ou a medição com o receptor de teste.

### U-2 — A central no Atlas CRM (repositório `atlas-crm-dev`)
Ligada por variável de ambiente só no CRM de homologação (U5). Ela usa o
módulo do U-1, portado antes. Construída no PR #107 de lá (22/11); o que
mudou do desenho abaixo está marcado, e as caixas são do Atlas.

**O protocolo (desenho de 22/11):**
- **A instância fala com a Meta sozinha** para enviar, ler perfil e assinar
  ou tirar o webhook. O token do usuário do sistema não precisa do App
  Secret.
- **Pela central passam só a volta do login e as entregas do webhook.** A
  central não guarda token depois do resgate.
- **Cada instância tem um id e uma chave**, mostrada uma vez no cadastro. A
  central guarda só o hash da chave.
- **A volta do login, em três passos:**
  1. a instância manda o navegador à central com o `state` dela, que é opaco
     para a central;
  2. a central confere que o retorno é da `base_url` cadastrada e faz o
     login unificado com a URI dela;
  3. ela devolve um tíquete de uso único, válido por 5 min.
  
  O resgate do tíquete é de servidor para servidor, com a chave no `Bearer`.
- **A central assina o repasse com o segredo DERIVADO da chave da
  instância** (HKDF-SHA256, `info` `cb-ig-central-repasse`; ela guarda só o
  hash da chave e esse segredo cifrado), no mesmo formato
  `X-Hub-Signature-256`, e entrega na rota de webhook de hoje. A conexão do
  modo `central` guarda esse segredo em `ig_app_secret`, então a rota da
  instância não muda. (Mudou na construção, 22/11: com só o hash guardado, a
  central não assinaria com a chave crua.)
- **A fila do que falhou** é drenada na manutenção do ciclo que já existe
  (sem rota de cron nova), até 7 dias (U6).
- [ ] **Tabelas da central:**
  - instâncias, com a credencial guardada em hash;
  - rotas: conta do Instagram → instância, com índice único;
  - fila do que falhou;
  - tíquetes de uso único.
  
  Ficam fora da publicação realtime, sem nada para `anon`, e o service role
  recebe os privilégios por escrito.
- [ ] **Rotas da central:** entrar, retorno do login, resgate do tíquete,
      webhook da Meta, desconectar, desautorização e exclusão de dados (as
      duas últimas vieram da U-1: o `signed_request` é assinado pelo segredo
      do app da Atlas).
- [ ] **Repasse ao escritório na hora:**
  - assinado com o segredo do repasse (o carimbo de hora contra a repetição
    ficou fora da primeira versão, na construção);
  - o que falha vai para a fila;
  - a fila é drenada na manutenção do ciclo (sem rota de cron nova, na
    construção) e limpa ao entregar;
  - nenhuma transação aberta durante o HTTP.
- [ ] **Conta sem rota:** 200 com log. Nunca 4xx para a Meta.
- [ ] **A mesma conta em dois escritórios:** a central recusa.
- [ ] **Cadastro de instância:** no começo, um comando do operador. Depois,
      o Gestor e o provisionador avisam quando um escritório nasce ou muda
      de endereço.
- [ ] **No servidor:** o DNS do endereço próprio aponta para a homologação, e
      a variável e o segredo do app ficam no ambiente dela. O segredo quem
      cola é o operador.

### U-3 — Cliente da central (Atlas primeiro; o CB com a U2 = sim)
Os escritórios do SaaS são o primeiro cliente, então a U-3 nasceu no Atlas,
junto com a central (PRs #107, a central, e #108, o cliente, no
`atlas-crm-dev`). No CB, com a U2 = sim e a U-1 mesclada, é o porte do #108
na branch `feat/instagram-cliente-da-central` (22/11/2026). O CB é só
instância: nada da central (rotas, fila, cadastro, migration) vem.
- [x] **Modo `central` da conexão** (`src/lib/instagram/central/`):
  - com as três variáveis, o botão leva à central, sem ler o app da conta;
  - a volta traz um tíquete, e o resgate, de servidor para servidor, traz o
    token e as contas;
  - a sessão de admin e o nonce do cookie valem como hoje;
  - cada conta vira uma conexão `ig_login = 'central'`, com o segredo do
    repasse em `ig_app_secret`, sem assinar o webhook de novo; a que não
    virou conexão sai da central se não for conexão de ninguém no CRM;
  - apagar a conexão tira a assinatura da conta e avisa a central.
- [x] **Entrega da central:** sem rota nova. A central assina com o segredo
      do repasse, e a rota de webhook de hoje confere pela conexão
      (`quaisAssinam`) e segue pelo mesmo `persistir.ts`. O carimbo de hora
      contra a repetição ficou fora da primeira versão (o UNIQUE da mensagem
      descarta a repetida).
- [x] **Variáveis de ambiente:** `INSTAGRAM_CENTRAL_URL`,
      `INSTAGRAM_CENTRAL_INSTANCIA` e `INSTAGRAM_CENTRAL_CHAVE`, no
      `environment:` da stack, no `.env.local.example` e em
      `docs/INSTALACAO.md`. Nenhuma migration (a 1153 já aceita `central`).
- [ ] **Falta, com o operador:** revisão, PR e merge; o cadastro do CB na
      central (a origem do `NEXT_PUBLIC_SITE_URL` do CB); as três variáveis
      no `crm.env` e um `docker stack deploy` com ele carregado (o CI não
      relê o `environment:`); a primeira conexão é o piloto (U-5).

### U-4 — Painel da Meta (cada passo com o "pode")
- [ ] A URL de retorno da central na configuração do unificado, no lugar da
      do receptor de teste.
- [ ] O webhook do objeto Instagram apontando para a central, no lugar do
      receptor de teste (os campos de mensagem já estão assinados).
- [ ] As contas testadoras.
- [ ] Publicar o app (modo Ativo).

### U-5 — Piloto
- [ ] Um escritório de teste da Atlas e o CB (U2 = sim) conectam pela
      central com acesso padrão.
- [ ] Medir: DM entra, resposta sai, desconectar e reconectar, a M3 no
      unificado.

### U-6 — Análise da Meta
Depende da verificação da empresa, que é do operador e pode correr desde já.
- [ ] Escritório de demonstração com conta de teste para o revisor.
- [ ] Vídeo da tela em inglês ou com legenda: login, portfólio, contas, DM
      chegando, resposta.
- [ ] Textos de cada permissão e do "Human Agent" (U9 = sim, 22/11).
- [ ] Enviar e acompanhar.

### U-7 — Migração do CB e retirada do login antigo
- [ ] A conexão do CB passa para o modo `central` (ou `unificado`), pelo
      caminho do estudo, §9. A DM em dobro é barrada pelo U-1.
- [ ] Quando a última conexão migrar, sai o código do login do Instagram, e
      o app antigo do CB é aposentado (U13).

### U-8 — Porte ao Atlas
- [ ] U-3, a Fase 4 e a Fase 6 vão ao `atlas-crm-dev` (o U-1 já foi antes
      do U-2), registradas no registro de portes do Atlas. Lá a numeração das
      migrations é outra.

### U-9 — Fechamento
- [ ] `docs/DECISOES-DO-OPERADOR.md` e `.claude/rules/instagram.md` com o
      estado final.
- [ ] Estudo atualizado; documentação entregue.
- [ ] Worktrees desta frente apagadas, com o "pode" do operador.

### Futuro — Social selling (estudo, §14)
- [ ] Decisão do operador revendo a D1.
- [ ] Gatilhos e ações do Instagram no motor de automações.
- [ ] Segunda análise com `instagram_manage_comments`; depois, a permissão
      entra na configuração, e os escritórios reconectam uma vez.

## Riscos que o plano carrega

- **A central é um ponto só:** se ela cair, nenhuma DM entra (a Meta tenta
  de novo por 36 h e a fila segura). Riscos de homologação e de LGPD
  aceitos pelo operador (U5).
- **O unificado é novo na Meta,** e a doc se contradiz: o U-0 vem antes do
  código.
- **A verificação da empresa** pode levar semanas; a análise só sai depois
  dela.
