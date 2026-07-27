# Rodar o CRM na sua máquina

Como trabalhar no CB CRM localmente (`npm run dev`) integrado ao WhatsApp.

Há **dois modos**, e o primeiro cobre quase tudo. Comece por ele.

| | Modo padrão | Modo isolado |
| --- | --- | --- |
| Instala Docker? | **não** | sim |
| Usa o número real do escritório | **sim** | não (chip de teste) |
| Vê as conversas reais | **sim** | sim (mesmo banco) |
| Roda o código do webhook de ENTRADA | não | **sim** |
| Tempo para começar | minutos | ~1h + chip |

---

## Decisão de arquitetura (leia antes)

O ambiente local usa **o mesmo Supabase e a mesma instância da Evolution que a
produção**. Isso é deliberado: o objetivo é desenvolver contra o número real, as
conversas reais e os fluxos reais, e só depois mandar para produção.

A contrapartida é assumida e conhecida: **o que você faz local acontece de
verdade**. Mensagem enviada em teste chega no cliente; contato criado aparece
para o escritório inteiro. Não existe rede de proteção — o cuidado é humano.

---

# Modo padrão — sem Docker

## Por que funciona sem instalar nada

O CRM conversa com a Evolution nos dois sentidos, e eles são independentes:

**Enviar (CRM → Evolution).** O endereço da Evolution vem do **banco**, não de
variável de ambiente: `cb_channels.server_url`, lido em
[`resolve.ts`](src/lib/cb-channels/resolve.ts) e usado em
[`engine-send.ts`](src/lib/cb-channels/engine-send.ts). Como o banco é o mesmo
da produção, o CRM local já aponta para `https://api.cbadvogados.com` sozinho.

**Receber (Evolution → CRM).** O webhook continua entregando **na VPS**, que
grava no mesmo Supabase. O seu inbox local está inscrito no realtime das mesmas
tabelas, então a mensagem do cliente **aparece na sua tela ao vivo**, igual à
produção. Você não precisa que a Evolution alcance a sua máquina.

```
        ┌─────────────────────────┐
        │  Evolution (VPS)        │
        │  api.cbadvogados.com    │
        └──────┬───────────▲──────┘
       webhook │           │ enviar
               ▼           │
        ┌──────────────┐   │   ┌──────────────────┐
        │ CRM produção │   └───┤ CRM local :3000  │
        └──────┬───────┘       └────────┬─────────┘
               │   Supabase (o mesmo)   │
               └───────────┬────────────┘
                           ▼
                   grava ─── realtime ──▶ sua tela
```

## O que NÃO roda na sua máquina

O código do webhook de entrada executa na VPS, não aqui. Então **não** são
exercitados localmente:

- `src/app/api/whatsapp/evolution/webhook/route.ts` e o parsing de entrada
- download de mídia recebida, reações, confirmação de exclusão/edição
- automações, fluxos e IA **disparados por mensagem recebida**

Para mexer nesses, veja o **modo isolado**.

Tudo o mais — telas, inbox, envio, formatação, contatos, funis, dashboards,
filtros, disparos — roda local normalmente.

## Configuração

Copie `.env.local.example` para `.env.local` e preencha:

```bash
# Supabase — o MESMO projeto da produção
NEXT_PUBLIC_SUPABASE_URL=https://<projeto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service role>

# ⚠️ TEM de ser a MESMA de produção — ver a nota abaixo
ENCRYPTION_KEY=<64 hex>

# ⚠️ URL PÚBLICA do CRM, não localhost — ver a nota abaixo
NEXT_PUBLIC_SITE_URL=https://crm.cbadvogados.com

NEXT_PUBLIC_APP_LOCALE=pt-BR

# Evolution de produção (usadas só para provisionar/ressincronizar canal)
EVOLUTION_BASE_URL=https://api.cbadvogados.com
EVOLUTION_GLOBAL_API_KEY=<chave global>
EVOLUTION_WEBHOOK_SECRET=<mesmo segredo do crm.env da VPS>

META_APP_SECRET=<app secret>
AUTOMATION_CRON_SECRET=<64 hex>
```

```bash
npm install
npm run dev     # http://localhost:3000
```

### ⚠️ `ENCRYPTION_KEY` tem de ser a de produção

As credenciais da Evolution ficam **cifradas** em `cb_channels.api_key`
(AES-256-GCM). Com uma chave diferente, o CRM local não consegue decifrá-las e
**o envio falha**, sem que nada na tela explique o motivo.

Esse foi o real bloqueio do ambiente local por semanas — não a falta de Docker.

### ⚠️ `NEXT_PUBLIC_SITE_URL` aponta para a URL pública, sempre

Essa env define a URL de webhook que o CRM registra na Evolution, e ela é
**global**, enquanto o webhook é **por instância**. Se apontar para
`localhost`, um clique em **Ressincronizar** no canal de produção redireciona o
webhook do número do escritório para a sua máquina — e o número para de receber
mensagem, em silêncio.

Existe uma guarda em código que barra exatamente isso
([`webhook-url.ts`](src/lib/cb-channels/webhook-url.ts)): trocar um endereço
público por um local é recusado, com a explicação na tela. Mas a guarda é a
segunda linha de defesa; a primeira é essa variável estar certa.

## Verificação rápida

```bash
curl -I http://localhost:3000/login
```

Abra o inbox e mande uma mensagem para o número do escritório de outro celular:
ela deve aparecer na sua tela em segundos, via realtime. Responda pelo inbox
local — deve chegar no outro celular.

---

# Modo isolado — com Docker

Use quando for **desenvolver ou depurar a entrada**: o handler do webhook,
mídia recebida, reações, exclusão e edição vindas do contato, ou automações e
fluxos disparados por mensagem recebida.

A ideia: subir uma **segunda** Evolution na sua máquina e criar um **segundo
canal** no CRM apontando para ela. Graças ao multi-canal (migration 903), esse
canal convive com o real na mesma conta — cada instância tem a sua própria URL
de webhook, e a de produção **não é tocada**.

## Pré-requisitos

- Docker Desktop ligado
- Um **chip de WhatsApp de teste** (não use o número do escritório)

## Passos

```bash
docker compose -f docker-compose.evolution.yml up -d
```

```bash
curl http://localhost:8088/
```

No `.env.local`, troque as três da Evolution e a URL do site:

```bash
EVOLUTION_BASE_URL=http://localhost:8088
EVOLUTION_GLOBAL_API_KEY=<AUTHENTICATION_API_KEY do compose>
EVOLUTION_WEBHOOK_SECRET=<qualquer string; openssl rand -hex 32>

# de dentro do container, "localhost" é o próprio container
NEXT_PUBLIC_SITE_URL=http://host.docker.internal:3000
```

> **Linux:** `host.docker.internal` não existe por padrão. Adicione
> `extra_hosts: ["host.docker.internal:host-gateway"]` ao serviço no compose.

Reinicie o `npm run dev` — env só é lida na subida —, e então:

1. **Configurações → Conexões**
2. **Novo canal → Evolution**, rótulo `Dev local`
3. Leia o QR com o **chip de teste**
4. Mande uma mensagem de um terceiro celular para o chip: deve cair no inbox
   local, com o código do webhook rodando na sua máquina

```bash
docker compose -f docker-compose.evolution.yml logs -f evolution
```

## ⚠️ Enquanto estiver neste modo

`NEXT_PUBLIC_SITE_URL` está apontando para a sua máquina. **Não clique em
Ressincronizar no canal de produção.** A guarda de
[`webhook-url.ts`](src/lib/cb-channels/webhook-url.ts) recusa a troca e mostra o
motivo — mas o hábito certo é não mexer no canal real com o ambiente local
configurado assim.

## Voltar ao modo padrão

```bash
docker compose -f docker-compose.evolution.yml down
```

`down -v` apaga também o volume do Postgres, e com ele a sessão pareada.

No `.env.local`, devolva `EVOLUTION_BASE_URL`, `EVOLUTION_GLOBAL_API_KEY`,
`EVOLUTION_WEBHOOK_SECRET` e `NEXT_PUBLIC_SITE_URL` aos valores do modo padrão.
O canal `Dev local` pode ficar no CRM — ele só não vai mais responder — ou ser
removido em Configurações → Conexões.

---

## Pegadinhas

| Sintoma | Causa / solução |
| --- | --- |
| Envio falha sem mensagem clara | `ENCRYPTION_KEY` diferente da de produção — o CRM não decifra a credencial do canal. |
| Produção parou de receber depois que rodei local | `NEXT_PUBLIC_SITE_URL` estava como `localhost`/`host.docker.internal` e alguém clicou em **Ressincronizar** no canal de produção. Corrija a env e clique de novo. |
| Ressincronizar recusa com aviso de URL local | É a guarda funcionando. Ajuste `NEXT_PUBLIC_SITE_URL` para a URL pública. |
| App em inglês | `NEXT_PUBLIC_APP_LOCALE` — produção builda com `pt-BR`. |
| `Bind for 0.0.0.0:8080 failed` | Porta ocupada. Troque `8088:8080` no compose e ajuste `EVOLUTION_BASE_URL`. |
| Modo isolado envia mas não recebe | `NEXT_PUBLIC_SITE_URL` não está como `host.docker.internal:3000`. Ajuste e recrie o canal `Dev local`. |
| `401` no webhook do canal **local** | `EVOLUTION_WEBHOOK_SECRET` diferente do registrado na instância. Ressincronize — a guarda não barra, porque a URL registrada é local. |
| `401` no webhook de **produção** | Só acontece se o segredo do `crm.env` da VPS divergir do registrado. O conserto é ressincronizar **a partir de `crm.cbadvogados.com`**, nunca do local: a guarda só libera a troca de segredo para o próprio host que recebe os eventos. |

---

## Arquivos relevantes

- [`docker-compose.evolution.yml`](docker-compose.evolution.yml) — Evolution local + Postgres
- `src/app/api/cb/channels/route.ts` — cria o canal e registra o webhook
- `src/app/api/cb/channels/[id]/connect/route.ts` — QR e **reaplicação** do webhook
- `src/components/settings/cb-channels-panel.tsx` — a tela de Conexões
- `src/lib/cb-channels/evolution-admin.ts` — provisionamento e `reaplicarWebhook`
- `src/lib/cb-channels/webhook-url.ts` — a guarda de URL não-pública
- `src/app/api/whatsapp/evolution/webhook/route.ts` — recebe os eventos
- `src/lib/whatsapp/transport/` — cliente e transporte da Evolution
