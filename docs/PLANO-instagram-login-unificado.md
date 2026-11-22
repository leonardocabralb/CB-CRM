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
| U2 | O CB vira cliente do app da Atlas (opção A) | **Pendente** (recomendada) |
| U4 | Medições antes do código | **Pendente** (recomendada); a M7 já foi medida |
| U6, U9–U14 | Fila da central, Human Agent, token colado, "traga o seu app", instalação própria, migração do CB, várias contas | **Pendentes** (estudo, §11) |
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
- [ ] **Falta, com o operador:** revisão, PR, aplicar a 1153 e mesclar. A
      primeira conexão real pelo unificado é o piloto (U-5) ou a medição com
      o receptor de teste.

### U-2 — A central no Atlas CRM (repositório `atlas-crm-dev`)
Ligada por variável de ambiente só no CRM de homologação (U5). Ela usa o
módulo do U-1, portado antes.
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
  - assinado com o destino e a hora;
  - o que falha vai para a fila;
  - a fila é tentada de novo pelo laço rápido do agendador (rota de cron
    nova entra no laço) e limpa ao entregar;
  - nenhuma transação aberta durante o HTTP.
- [ ] **Conta sem rota:** 200 com log. Nunca 4xx para a Meta.
- [ ] **A mesma conta em dois escritórios:** a central recusa.
- [ ] **Cadastro de instância:** no começo, um comando do operador. Depois,
      o Gestor e o provisionador avisam quando um escritório nasce ou muda
      de endereço.
- [ ] **No servidor:** o DNS do endereço próprio aponta para a homologação, e
      a variável e o segredo do app ficam no ambiente dela. O segredo quem
      cola é o operador.

### U-3 — Cliente da central (CB CRM, depois porte ao Atlas)
Branch `feat/instagram-unificado-central`.
- [ ] **Modo `central` da conexão:**
  - o botão leva à central;
  - a volta traz um tíquete, e o resgate, de servidor para servidor, traz o
    token e as contas;
  - a sessão de admin e o nonce do cookie valem como hoje.
- [ ] **Rota de entrega da central:** confere a assinatura da central, o
      destino e a hora, e segue pelo mesmo `persistir.ts`.
- [ ] **Variáveis de ambiente:** o endereço da central e a credencial da
      instância. Entram no `environment:` da stack e no
      `.env.local.example`; no Atlas, o provisionador as grava no
      `atlas.env`.

### U-4 — Painel da Meta (cada passo com o "pode")
- [ ] A URL de retorno da central na configuração do unificado, no lugar da
      do receptor de teste.
- [ ] O webhook do objeto Instagram apontando para a central, no lugar do
      receptor de teste (os campos de mensagem já estão assinados).
- [ ] As contas testadoras.
- [ ] Publicar o app (modo Ativo).

### U-5 — Piloto
- [ ] Um escritório de teste da Atlas, e o CB se a U2 for "sim", conectam
      pela central com acesso padrão.
- [ ] Medir: DM entra, resposta sai, desconectar e reconectar, a M3 no
      unificado.

### U-6 — Análise da Meta
Depende da verificação da empresa, que é do operador e pode correr desde já.
- [ ] Escritório de demonstração com conta de teste para o revisor.
- [ ] Vídeo da tela em inglês ou com legenda: login, portfólio, contas, DM
      chegando, resposta.
- [ ] Textos de cada permissão; "Human Agent" se a U9 disser sim.
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
