# Setup de produção — CB-CRM (Meta Cloud API + Hostinger)

> Estado atual (2026-07-22): Supabase **pronto e verificado** — projeto
> `CB CRM Whatsapp` (`hxnhakmyxyhalbsktzwe`, São Paulo) com as 36 migrations
> aplicadas, buckets e Realtime ativos. `.env.local` local criado e testado.
> Falta: credenciais da Meta e o deploy na Hostinger.

## Fase A — Meta for Developers (você faz, ~30–60 min)

1. **Criar o app**: <https://developers.facebook.com> → *My Apps* → *Create App*
   → tipo **Business**.
2. **Adicionar o produto WhatsApp** ao app (isso cria uma WABA de teste com
   número de teste — bom para validar antes do número real).
3. **App Settings → Basic**: copie o **App Secret** (vai em `META_APP_SECRET`)
   e o **App ID** (opcional, `META_APP_ID` — só necessário para templates com
   imagem no cabeçalho).
4. **Token permanente**: em <https://business.facebook.com> → *Business
   Settings* → *Users* → *System Users*:
   - Crie um system user (papel Admin);
   - *Add Assets* → vincule o app e a WABA;
   - *Generate New Token* com as permissões **`whatsapp_business_messaging`**
     e **`whatsapp_business_management`**, expiração *Never*;
   - Guarde o token — ele será colado na UI do CRM (Settings → WhatsApp),
     não em env var. ⚠️ Não use o token temporário de 24h do painel API Setup:
     funciona hoje e quebra silenciosamente amanhã.
5. **Anotar IDs**: *WhatsApp → API Setup* → **Phone Number ID** e **WABA ID**.
6. **Número real (produção)**: adicione e verifique o número na WABA e cadastre
   o **PIN de verificação em duas etapas** (*WhatsApp Accounts → Phone Numbers
   → Two-step verification*). O PIN será pedido na UI do CRM. Números de teste
   da Meta não têm PIN — deixe em branco.

## Fase B — Deploy na Hostinger Managed Node.js

1. hPanel → *Websites* → *Create* → **Node.js** → conecte este repositório
   (branch `main`).
2. **Env vars no hPanel** — copie os valores do seu `.env.local` local
   (rode `cat .env.local` na raiz do projeto):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ENCRYPTION_KEY` — ⚠️ **exatamente a mesma** do `.env.local`: local e
     produção compartilham o mesmo banco; chave diferente = tokens ilegíveis.
   - `META_APP_SECRET` — o App Secret da Fase A, passo 3.
   - `NEXT_PUBLIC_SITE_URL` — `https://<seu-dominio>` (sem barra no final).
   - `NEXT_PUBLIC_APP_LOCALE` — `en` (só existem `en`/`ko`; PT-BR exigiria
     criar `messages/pt-BR.json`).
   - `AUTOMATION_CRON_SECRET` — mesmo valor do `.env.local`.
3. Push em `main` → Hostinger builda e publica com HTTPS (Let's Encrypt).
4. **Supabase Auth para produção** (dashboard → Authentication → URL
   Configuration): trocar *Site URL* para `https://<seu-dominio>` e adicionar
   `https://<seu-dominio>/join/*` à allow-list de redirects. Configure também
   **SMTP próprio** (Auth → SMTP) — o mailer embutido do Supabase é limitado a
   testes.

## Fase C — Conectar o WhatsApp (no CRM em produção)

1. Logado no CRM → *Settings → WhatsApp*: preencha Phone Number ID, WABA ID,
   token permanente, invente um **Verify Token** (string aleatória qualquer) e
   o PIN 2FA (número real). Salvar — o app valida o token contra a Meta,
   registra o número e assina a WABA no app.
2. **Só depois de salvar**, registre o webhook na Meta: *App Dashboard →
   WhatsApp → Configuration → Webhooks*:
   - Callback URL: `https://<seu-dominio>/api/whatsapp/webhook`
   - Verify Token: o mesmo que você inventou no passo 1
   - Assine o campo **`messages`** (obrigatório) e, opcionalmente,
     `message_template_status_update` / `message_template_quality_update` /
     `message_template_components_update` (status de templates em tempo real).
3. Teste: envie uma mensagem de outro celular para o número → deve aparecer
   no Inbox em tempo real.

## Fase D — Cron das automações (hPanel)

Necessário para passos **Wait** de automações e timeout de flows. hPanel →
*Advanced → Cron Jobs*, a cada 5 minutos (substitua o secret pelo valor de
`AUTOMATION_CRON_SECRET`):

```
curl -s -H "x-cron-secret: SEU_SECRET" https://<seu-dominio>/api/automations/cron
curl -s -H "x-cron-secret: SEU_SECRET" https://<seu-dominio>/api/flows/cron
```

Smoke test: `503` = env var faltando · `401` = header errado · `200` = ok.

## Pendências conhecidas do código (herdadas do template)

- **Reset de senha incompleto**: a página *Forgot password* redireciona para
  `/auth/callback?next=/reset-password`, mas essas rotas **não existem** no
  código — precisa implementá-las para recuperação de senha funcionar.
- Broadcasts agendados (`scheduled_at`) e automações `time_based` existem na
  UI/schema mas **nenhum código server-side os executa**.
- Rate limit da API pública é em memória (ok para instância única).
- Buckets de Storage são públicos **de propósito** (a Meta precisa baixar as
  mídias) — não os torne privados.

## Diagnóstico rápido

| Sintoma | Causa provável |
|---|---|
| Envia mas não recebe | `META_APP_SECRET` errado/ausente (webhook rejeita com 401) ou número sem registro (PIN 2FA) |
| "Conectado" mas zero eventos | Falta `POST /register` (PIN) ou campo `messages` não assinado no webhook |
| `token_corrupted` na UI | `ENCRYPTION_KEY` diferente entre ambientes — Reset Configuration e salvar de novo |
| Webhook da Meta não verifica | Verify Token divergente, ou config salva na Meta **antes** de salvar no CRM |
