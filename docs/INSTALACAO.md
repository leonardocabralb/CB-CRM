# Instalação do zero

Guia único, do nada até uma mensagem de WhatsApp entrando e saindo. Não
depende de nenhum outro documento.

Ele substitui o antigo `SETUP-PRODUCAO.md`, que descrevia uma hospedagem
que não é mais usada e afirmava coisas que deixaram de ser verdade.

**Tempo:** de duas a quatro horas na primeira vez, quase tudo esperando
DNS, certificado e aprovação da Meta (quando você escolhe a Meta).

---

## 0. O que você precisa antes de começar

| Item | Para quê | Custo |
|---|---|---|
| Conta no [Supabase](https://supabase.com) | Banco, autenticação, arquivos | Plano gratuito serve para começar |
| Um servidor com Docker | Rodar o CRM e o gateway de WhatsApp | Qualquer VPS de 2 vCPU / 4 GB dá conta |
| Um domínio, com DNS que você controla | Endereço do CRM e certificado | — |
| Conta no GitHub | Guardar a sua cópia e construir a imagem | Gratuito |
| Um número de WhatsApp | O número de atendimento | — |

Opcional: uma chave de OpenAI, Anthropic ou Google Gemini, se quiser o
assistente de IA, a transcrição de áudio e o Radar de atendimento.

### Decisão que vale a pena tomar agora: como conectar o WhatsApp

São dois caminhos, e cada conexão do CRM escolhe o seu. Dá para usar os
dois na mesma instalação.

**Meta Cloud API (oficial).** Você cria um app no Meta for Developers,
verifica o número numa conta comercial e envia modelos de mensagem para
aprovação. Em troca: suporte oficial, sem risco de bloqueio, e o número
some do celular (passa a viver na nuvem da Meta). Fora de uma janela de
24 horas desde a última mensagem do cliente, só é possível responder com
um modelo aprovado.

**Evolution API (não oficial).** Você hospeda um gateway de código aberto
e pareia por QR code, como o WhatsApp Web. Em troca: nada de aprovação,
nada de modelos, nada de janela de 24 horas, e o número continua no
celular. O custo é o risco: é um cliente não oficial, e o WhatsApp pode
bloquear o número.

Se você não tem certeza, comece pela Evolution: ela sobe em quinze
minutos e não depende de aprovação de ninguém. Trocar depois é
acrescentar uma conexão, não refazer a instalação.

---

## 1. Supabase

### 1.1 Criar o projeto

No painel do Supabase, **New project**. Escolha a região mais próxima dos
seus usuários e guarde a senha do banco. O projeto leva uns dois minutos
para subir.

### 1.2 Aplicar as migrations

Todo o esquema do banco vive em `supabase/migrations/`, e as migrations
reconstroem tudo do zero, em ordem. Isso é verificado a cada mudança
neste repositório: o CI sobe um Postgres vazio e reaplica todas elas
antes de deixar publicar.

Na sua máquina, com a [CLI do Supabase](https://supabase.com/docs/guides/local-development/cli/getting-started)
instalada:

```bash
git clone <a-sua-cópia-deste-repositório> crm
cd crm
supabase link --project-ref <o-ref-do-seu-projeto>
supabase db push
```

O `<ref>` está na URL do painel e em *Project Settings → General*.

> **Por que `db push` funciona para você e não para nós.** Num projeto
> **novo**, o histórico de migrations nasce vazio e alinhado com os
> arquivos, então o `push` aplica tudo em ordem e registra corretamente.
> Na instalação original deste código o histórico foi criado por outro
> caminho e ficou com identificadores que não correspondem aos nomes dos
> arquivos — por isso o `CLAUDE.md` proíbe `db push` lá. Não é o seu caso.

Confira em *Table Editor* que existem tabelas como `messages`,
`conversations`, `contacts` e `cb_channels`.

### 1.3 Ligar o Realtime

*Database → Replication*. As migrations já inscrevem as tabelas que
precisam, mas confirme que a publicação `supabase_realtime` está ativa.
Sem isso a caixa de entrada não atualiza sozinha.

### 1.4 Configurar a autenticação

*Authentication → URL Configuration*:

- **Site URL:** `https://crm.seudominio.com`
- **Redirect URLs**, acrescente as duas:
  - `https://crm.seudominio.com/auth/callback`
  - `https://crm.seudominio.com/join/*`

A primeira é a recuperação de senha; a segunda, os convites de equipe.
Sem elas o link do e-mail é recusado pelo Supabase.

*Authentication → Emails → SMTP Settings*: configure um SMTP próprio.
O remetente embutido do Supabase é limitado a testes e não entrega
volume — quem depende dele descobre no dia em que convida a equipe.

**Decida agora quem pode se cadastrar.** Em *Authentication → Sign In /
Providers → Email*, a opção que permite novos cadastros vem **ligada**.
Deixá-la ligada num CRM exposto na internet significa que qualquer pessoa
cria uma conta no seu servidor. Se a sua equipe é fechada, desligue e
convide as pessoas pelo painel (*Authentication → Users → Invite user*)
ou pelos convites do próprio CRM.

### 1.5 Copiar as três chaves

*Project Settings → API*:

| Onde no painel | Vai para |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

A chave `service_role` ignora todas as regras de acesso do banco. Ela só
pode existir no servidor. Nunca a coloque numa variável com prefixo
`NEXT_PUBLIC_`.

---

## 2. Gerar os segredos da instalação

Na sua máquina:

```bash
# Criptografa os tokens de WhatsApp e as chaves de IA gravados no banco.
openssl rand -hex 32

# Protege as rotas de tarefas agendadas.
openssl rand -hex 32

# Autentica o webhook da Evolution (pule se for só Meta).
openssl rand -hex 32
```

> ⚠️ **A primeira, `ENCRYPTION_KEY`, não pode ser trocada depois.** Todo
> token de WhatsApp e toda chave de IA são gravados no banco cifrados com
> ela. Trocá-la não dá erro: os valores simplesmente deixam de ser
> legíveis, e cada conexão precisa ser reconfigurada à mão. Guarde-a onde
> você guarda senha de verdade.

---

## 3. WhatsApp

Faça **um** dos dois caminhos. Você pode voltar e fazer o outro depois.

### 3.1 Caminho A — Evolution API

Suba o gateway no mesmo servidor onde o CRM vai rodar. O repositório traz
um `docker-compose.evolution.yml` pronto para desenvolvimento local; para
o servidor, o essencial é:

```yaml
services:
  evolution:
    image: evoapicloud/evolution-api:2.3.2
    restart: unless-stopped
    environment:
      SERVER_URL: http://127.0.0.1:8080
      AUTHENTICATION_API_KEY: <a-sua-chave-global>   # invente uma longa
      DATABASE_ENABLED: 'true'
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:<senha>@postgres:5432/evolution?schema=public
      DEL_INSTANCE: 'false'
    ports:
      - '127.0.0.1:8080:8080'
```

Repare no `127.0.0.1:` antes da porta: o gateway fica acessível só de
dentro do servidor. É de propósito. A chave global dele é a senha mestra
daquele servidor de WhatsApp, e não há motivo para expô-la à internet
quando o CRM roda ao lado.

**O conserto do eco do celular.** Quando alguém da equipe responde pelo
**celular pareado**, o WhatsApp entrega esse eco ao gateway endereçado por
um identificador interno (`@lid`) e sem o telefone da outra ponta. A
versão da biblioteca Baileys embarcada na Evolution 2.3.2 ignora o campo
que traz esse telefone, e o CRM não consegue saber de qual conversa é a
mensagem: ela é descartada. Na instalação onde isso foi medido, 119 de
143 ecos se perderam em cerca de 29 horas.

O repositório traz o conserto, de uma linha, como imagem derivada
(`docker/evolution-lid-fix/`) e um workflow que a constrói
(`.github/workflows/evolution-lid-fix.yml`). Rode o workflow informando a
imagem base que você está usando e a tag de saída, depois aponte o
serviço para a imagem resultante.

> Antes de fazer isso, vale medir: mande uma mensagem pelo celular
> pareado e veja se ela aparece na conversa certa no CRM. Se aparecer, a
> versão que você subiu já traz o campo e você não precisa da imagem
> derivada. O conserto foi aceito na Baileys em setembro de 2025 e pode
> já ter chegado à Evolution que você instalou.

### 3.2 Caminho B — Meta Cloud API

1. Em [developers.facebook.com](https://developers.facebook.com), crie um
   app do tipo **Business** e adicione o produto **WhatsApp**.
2. Em *App Settings → Basic*, copie o **App Secret**. Ele vai em
   `META_APP_SECRET`. Sem ele o CRM recusa todo webhook recebido, porque
   não consegue verificar a assinatura.
3. Em [business.facebook.com](https://business.facebook.com) →
   *Business Settings → Users → System Users*, crie um usuário de sistema
   com papel Admin, vincule o app e a conta de WhatsApp, e gere um token
   com as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management`, expiração **Never**.

   Não use o token temporário de 24 horas que aparece na tela de *API
   Setup*: ele funciona hoje e para de funcionar amanhã, sem aviso.
4. Anote o **Phone Number ID** e o **WABA ID** em *WhatsApp → API Setup*.
5. Para um número de produção, cadastre o **PIN de verificação em duas
   etapas** em *WhatsApp Accounts → Phone Numbers*. Números de teste da
   Meta não têm PIN.

O webhook da Meta é registrado depois, no passo 7 — depois que o CRM
estiver no ar.

---

## 4. Montar o arquivo de ambiente

Copie `.env.local.example` e preencha. Cada variável tem, ao lado, o que
ela é e o que quebra sem ela — leia o arquivo, ele é a referência.

No servidor, crie um `crm.env` fora do controle de versão:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<a chave anon>
SUPABASE_SERVICE_ROLE_KEY=<a chave service_role>
ENCRYPTION_KEY=<os 64 hex do passo 2>
AUTOMATION_CRON_SECRET=<o segundo segredo do passo 2>

# Só se usar a Evolution:
EVOLUTION_BASE_URL=http://127.0.0.1:8080
EVOLUTION_GLOBAL_API_KEY=<a chave global do gateway>
EVOLUTION_WEBHOOK_SECRET=<o terceiro segredo do passo 2>

# Só se usar a Meta:
META_APP_SECRET=<o App Secret>
```

```bash
chmod 600 crm.env
```

---

## 5. Construir e publicar

> **Cada instalação constrói a própria imagem.** A URL e a chave anônima
> do Supabase são lidas pelo navegador, e o Next.js as grava dentro do
> pacote JavaScript **no momento do build**. Não existe uma imagem única
> servindo instalações diferentes — a sua tem as suas credenciais dentro.
> Vale o mesmo para o idioma, o nome do produto e o logo.

### 5.1 Ajustar o que identifica a sua instalação

No `.github/workflows/pipeline.yml`, no passo *Build and push*:

```yaml
build-args: |
  NEXT_PUBLIC_SUPABASE_URL=${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
  NEXT_PUBLIC_SITE_URL=https://crm.seudominio.com
  NEXT_PUBLIC_APP_LOCALE=pt-BR
  NEXT_PUBLIC_APP_NAME=CRM do Seu Escritório
```

Idiomas prontos: `pt-BR` e `en`, os dois completos. Para um logo próprio,
ponha o arquivo em `public/marca/logo.svg` e acrescente
`NEXT_PUBLIC_APP_LOGO_URL=/marca/logo.svg`.

No mesmo arquivo, ajuste `IMAGE` para o seu usuário do GitHub, e no
`docker-stack.yml` ajuste o domínio, a rede e o resolvedor de certificado
para os do seu servidor.

### 5.2 Segredos do GitHub

*Settings → Secrets and variables → Actions*:

| Segredo | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | a URL do projeto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a chave anon |
| `VPS_SSH_HOST` | endereço do servidor |
| `VPS_SSH_USER` | usuário com acesso ao Docker |
| `VPS_SSH_KEY` | chave SSH privada desse usuário |

Os segredos de runtime (`service_role`, `ENCRYPTION_KEY`, credenciais da
Evolution) **não** passam por aqui. Eles vivem no `crm.env` do servidor.
O que o CI faz é trocar a imagem; o ambiente é do servidor.

### 5.3 O primeiro deploy é manual

Um push no `main` constrói a imagem e roda `docker service update`, que
só atualiza um serviço que já existe. Da primeira vez, no servidor:

```bash
docker login ghcr.io -u <seu-usuário>
set -a && . ./crm.env && set +a
docker stack deploy -c docker-stack.yml crm
docker service logs -f crm_crm
```

> ⚠️ **As duas primeiras linhas andam juntas, sempre.** O
> `docker-stack.yml` usa `${VARIAVEL}`, que o Docker substitui pelo
> ambiente do shell. Variável ausente vira **string vazia, sem erro e sem
> aviso** — e o resultado é o pior tipo de falha: o site responde
> normalmente (a tela de login já está dentro da imagem) enquanto o
> servidor inteiro está sem credencial nenhuma. Nada é gravado, nada é
> enviado, e as rotas de tarefas agendadas passam a responder 503.

Confira, de dentro do container:

```bash
cid=$(docker ps --filter name=crm_crm --format '{{.ID}}' | head -1)
docker exec $cid printenv SUPABASE_SERVICE_ROLE_KEY | wc -c   # 0 = quebrado
curl -s -o /dev/null -w '%{http_code}\n' https://crm.seudominio.com/api/cb/scheduled/cron
# 401 = segredo no lugar · 503 = ambiente vazio
```

### 5.4 O agendador não é opcional

O `docker-stack.yml` traz um serviço chamado `agendador`. Ele bate nas
rotas de tarefas do CRM em dois laços, um de 60 segundos e outro de 15
minutos.

**Sem ele, mensagem agendada não sai.** O Next.js não tem agendador
embutido, e nada no código chama essas rotas sozinho. Também dependem
dele: o passo "Aguardar" das automações, os lembretes por data, o Radar
de atendimento e a sincronização do Meta Ads. A linha fica gravada no
banco e nunca vira mensagem.

Se você não usa Docker Swarm, substitua por uma entrada de `cron`:

```
* * * * * curl -fsS -m 50 -H "x-cron-secret: SEGREDO" https://crm.seudominio.com/api/automations/cron
*/15 * * * * for r in cb/scheduled flows cb/radar cb/meta-ads; do curl -fsS -m 120 -H "x-cron-secret: SEGREDO" "https://crm.seudominio.com/api/$r/cron"; done
```

O laço de 15 minutos não pode encolher sem mexer também em
`CICLO_MINUTOS`, em `src/lib/scheduled/display.ts`: é esse número que a
tela usa para oferecer horários e prometer "sai em até 15 min".

---

## 6. Primeiro acesso

1. Abra `https://crm.seudominio.com/signup` e crie a sua conta. O primeiro
   cadastro vira dono da conta automaticamente — um gatilho no banco cria
   a conta e o perfil na mesma transação.
2. **Configurações → Perfis**: crie os perfis de acesso padrão pelo botão
   que os semeia (Administrador, Advogado, Visualizador).
3. **Funis**: crie o primeiro funil e as etapas. Se pretende usar os
   painéis de desempenho, marque em cada etapa o degrau correspondente
   (lead, reunião, proposta, contrato, perda).
4. **Configurações → Conexões**: crie a conexão do WhatsApp.
   - *Evolution*: escolha o transporte, dê um rótulo, salve e leia o QR
     code com o celular. O nome da instância é derivado do rótulo e
     fixado na criação; renomear a conexão depois não a renomeia.
   - *Meta*: cole o Phone Number ID, o WABA ID, o token permanente,
     invente um Verify Token e informe o PIN.

---

## 7. Registrar o webhook

**Evolution:** o CRM registra o webhook sozinho ao criar a conexão. Se
você mudar o domínio ou o `EVOLUTION_WEBHOOK_SECRET`, use
"Ressincronizar" na tela de conexões — instâncias já pareadas guardam o
valor antigo e passariam a ser recusadas.

**Meta:** só depois de salvar no CRM, vá ao painel do app →
*WhatsApp → Configuration → Webhooks*:

- Callback URL: `https://crm.seudominio.com/api/whatsapp/webhook`
- Verify Token: o mesmo que você inventou
- Assine o campo `messages` (obrigatório) e, se quiser status de modelos
  em tempo real, `message_template_status_update`.

A ordem importa: registrar na Meta antes de salvar no CRM faz a
verificação falhar, porque o CRM ainda não conhece o Verify Token.

---

## 8. Testar

Mande uma mensagem de outro celular para o número conectado. Ela deve
aparecer na caixa de entrada em segundos. Responda pelo CRM e confirme
que chega. Depois responda pelo **celular pareado** e confirme que esse
eco também aparece na conversa certa.

Agende uma mensagem para dali a poucos minutos e confirme que ela sai
sozinha: é o teste do agendador.

---

## 9. Quando algo não funciona

| Sintoma | Causa provável |
|---|---|
| Envia mas não recebe (Meta) | `META_APP_SECRET` errado ou ausente, ou campo `messages` não assinado |
| Envia mas não recebe (Evolution) | `EVOLUTION_WEBHOOK_SECRET` diferente do que está gravado na instância. Use "Ressincronizar" |
| "Conectado" mas nenhum evento chega | Falta o registro do número (PIN de duas etapas, na Meta) |
| `token_corrupted` na tela | `ENCRYPTION_KEY` diferente da que cifrou. Reconfigure a conexão |
| Site responde 200 mas nada é gravado | `crm.env` não foi carregado no deploy. Veja o passo 5.3 |
| Rotas de cron devolvem 503 | `AUTOMATION_CRON_SECRET` vazia no servidor |
| Rotas de cron devolvem 401 | O segredo do agendador não bate com o do CRM |
| Mensagem agendada nunca sai | O agendador não está rodando. Veja o passo 5.4 |
| Link do e-mail de senha dá erro | Falta `/auth/callback` na lista de redirects do Supabase (passo 1.4) |
| Convite devolve erro 500 citando `NEXT_PUBLIC_SITE_URL` | A instalação não sabe o próprio endereço. Defina a variável e reconstrua |
| Eco do celular pareado não aparece | O conserto do `@lid` na Evolution. Veja o passo 3.1 |
| Tela em inglês depois de mudar o idioma | Idioma é fixado no build. Reconstrua a imagem |

---

## O que fazer em seguida

- [`ATUALIZAR.md`](./ATUALIZAR.md) — como trazer uma versão nova sem
  perder o que você customizou.
- [`public-api.md`](./public-api.md) — a API REST e as chaves com escopo.
- [`mcp.md`](./mcp.md) — usar o CRM a partir de assistentes de IA.
