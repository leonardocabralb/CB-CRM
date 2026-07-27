# Rodar o CRM localmente com a Evolution API (dev isolado)

Guia para rodar o CRM na sua máquina (`npm run dev`) integrado a uma **Evolution
API local em Docker**, testando **enviar e receber** WhatsApp **sem tocar na
produção**.

## Por que assim

O CRM tem 2 sentidos de integração com a Evolution:

- **Enviar** (CRM → Evolution): o CRM chama a Evolution. Só precisa da env
  `EVOLUTION_BASE_URL` apontar pra ela.
- **Receber** (Evolution → CRM): a Evolution faz um `POST` no **webhook do CRM**.
  Para isso a Evolution precisa **alcançar** o CRM.

Como o CRM local roda em `localhost` (não é público), uma Evolution **remota**
não conseguiria entregar os webhooks sem um túnel. Rodando a **Evolution também
local (Docker)**, os dois se falam pela rede interna do Docker — **sem túnel** e
**100% isolado da produção**.

```
Sua máquina
┌────────────────────────────────────────────────┐
│  CRM (npm run dev) ── localhost:3000             │
│      │  ▲                                         │
│  (1) │  │ (2) webhook                             │
│      ▼  │                                         │
│  Docker: Evolution ── localhost:8088             │
│          + Postgres (banco da Evolution)         │
└────────────────────────────────────────────────┘
(1) CRM → Evolution:  http://localhost:8088             (direto)
(2) Evolution → CRM:  http://host.docker.internal:3000  (host, não localhost — ver Pegadinhas)

A Evolution fala DIRETO com os servidores do WhatsApp (via Baileys).
Nada passa pela produção.
```

> **Importante:** a Evolution tem o **Postgres dela** (sobe junto no Docker) para
> as sessões do WhatsApp. O **Supabase** é o banco do **CRM** (contatos,
> conversas, mensagens, config) — coisas diferentes. Ver "Supabase" abaixo.

---

## Pré-requisitos

- **Node.js ≥ 20** e `npm`
- **Docker Desktop** ligado
- Um **número de WhatsApp de teste** para parear (não use um número de produção)
- Credenciais de um **Supabase** (ver seção Supabase)

---

## Passo 1 — Subir a Evolution local (Docker)

O compose já está no repo em [`docker-compose.evolution.yml`](docker-compose.evolution.yml)
(Evolution v2 + Postgres, cache local, porta **8088**).

```bash
docker compose -f docker-compose.evolution.yml up -d
```

Verifique que subiu:

```bash
curl http://localhost:8088/
# -> {"status":200,"message":"Welcome to the Evolution API...","version":"2.3.x"}
```

- **Chave global** da Evolution local: `AUTHENTICATION_API_KEY` no compose
  (padrão `localdev-evolution-key-troque-me`). Pode trocar — só mantenha igual no
  `.env.local` (passo 2).
- **Manager** (opcional): `http://localhost:8088/manager` (login com a chave acima).
- Logs: `docker compose -f docker-compose.evolution.yml logs -f evolution`

> **Porta:** usamos **8088** (não a 8080 padrão) porque a 8080 costuma estar
> ocupada por outro container. Se a 8088 também estiver ocupada, troque
> `8088:8080` → `<porta-livre>:8080` no compose **e** o `SERVER_URL`, e ajuste o
> `EVOLUTION_BASE_URL` no `.env.local`.

---

## Passo 2 — Configurar o `.env.local`

Copie `.env.local.example` para `.env.local` (se ainda não tiver) e ajuste a
seção Evolution:

```bash
# ── Evolution API (dev local, Docker) ──
EVOLUTION_BASE_URL=http://localhost:8088
EVOLUTION_GLOBAL_API_KEY=localdev-evolution-key-troque-me   # = AUTHENTICATION_API_KEY do compose
EVOLUTION_WEBHOOK_SECRET=<qualquer string; ex.: openssl rand -hex 32>

# webhook: de dentro do container, "localhost" é o próprio container.
# host.docker.internal é como o container alcança o CRM no host (macOS/Windows).
NEXT_PUBLIC_SITE_URL=http://host.docker.internal:3000
```

E as credenciais do Supabase (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — ver seção abaixo.
As demais (`ENCRYPTION_KEY`, etc.) seguem o `.env.local.example`.

> **Linux:** `host.docker.internal` não existe por padrão. Rode a Evolution com
> `--add-host=host.docker.internal:host-gateway` (ou adicione
> `extra_hosts: ["host.docker.internal:host-gateway"]` no serviço do compose).

---

## Passo 3 — Rodar o CRM

```bash
npm install        # primeira vez
npm run dev        # sobe em http://localhost:3000
```

Abra **http://localhost:3000**.

---

## Passo 4 — Conectar o WhatsApp

1. **Crie uma conta / faça login** no CRM local.
2. Vá em **Settings → WhatsApp**.
   - A tela chama a rota de connect, que **cria uma instância na Evolution
     local**, registra o webhook (`host.docker.internal:3000`) e grava
     `whatsapp_config.base_url = http://localhost:8088` no banco.
   - Aparece um **QR code**.
3. **Escaneie o QR** com o número de teste (WhatsApp → Aparelhos conectados).
4. Quando o estado virar **conectado**, está pronto.

---

## Passo 5 — Testar

- **Receber:** de um **2º celular**, mande uma mensagem para o número pareado →
  deve aparecer no **Inbox** do CRM local.
- **Enviar:** responda pelo Inbox → deve **chegar no 2º celular**.

Acompanhe os logs enquanto testa:

```bash
docker compose -f docker-compose.evolution.yml logs -f evolution   # gateway
# e o terminal do `npm run dev` mostra o webhook chegando + a persistência
```

---

## Supabase (o banco do CRM)

O CRM precisa de um Supabase (é onde ele guarda contatos/mensagens/config). A
Evolution **não** usa o Supabase. Opções:

- **Supabase de dev separado (isolamento total, recomendado):** crie um projeto
  Supabase próprio para dev e aplique as migrations de `supabase/migrations/`
  (001…) na ordem. Assim os dados de teste não misturam com produção.
- **Reusar um Supabase compartilhado:** funciona, mas os dados de teste caem na
  mesma base. Se dev e produção usarem a **mesma conta**, a config do WhatsApp é
  compartilhada (`whatsapp_config` é por conta) — conectar local reescreve o
  `base_url` da conta. Prefira uma **conta de dev separada** nesse caso.

> Detalhe técnico: o **envio** lê `whatsapp_config.base_url` do banco (não a env).
> Então, ao conectar local, o `base_url` da conta passa a `http://localhost:8088`.
> Para voltar à produção, reconecte com a env de prod (ou use contas/projetos
> separados).

---

## Pegadinhas

| Sintoma | Causa / solução |
|---|---|
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | Porta ocupada. Troque para 8088 (ou outra livre) no compose + `.env.local`. |
| Envia mas **não recebe** no inbox | `NEXT_PUBLIC_SITE_URL` não está como `http://host.docker.internal:3000`, ou o webhook aponta pra `localhost` (que, de dentro do container, é o próprio container). Reconecte após ajustar. |
| Connect dá `EVOLUTION_... não configurado` | Faltou alguma das 3 envs (`EVOLUTION_BASE_URL`, `EVOLUTION_GLOBAL_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`). Reinicie o `npm run dev` após editar o `.env.local`. |
| `401` no webhook | `EVOLUTION_WEBHOOK_SECRET` do CRM diferente do header registrado na instância. Reconecte (o connect re-registra com o secret atual). |
| Chave global rejeitada (401) na Evolution local | `EVOLUTION_GLOBAL_API_KEY` (.env.local) ≠ `AUTHENTICATION_API_KEY` (compose). |

---

## Parar / voltar para produção

```bash
# derrubar a Evolution local
docker compose -f docker-compose.evolution.yml down          # mantém o volume do Postgres
docker compose -f docker-compose.evolution.yml down -v       # apaga tudo (sessões incluídas)
```

Para o CRM voltar a apontar para a Evolution de produção, troque no `.env.local`:

```bash
EVOLUTION_BASE_URL=https://api.cbadvogados.com
EVOLUTION_GLOBAL_API_KEY=<chave global de produção>
# remova ou ajuste o NEXT_PUBLIC_SITE_URL
```

...e **reconecte** em Settings → WhatsApp (para reescrever o `base_url` no banco).

---

## Verificação rápida (checklist)

```bash
# 1) Evolution local no ar
curl http://localhost:8088/                       # versão 2.3.x

# 2) chave global bate
curl -H "apikey: localdev-evolution-key-troque-me" http://localhost:8088/instance/fetchInstances

# 3) CRM no ar
curl -I http://localhost:3000/login               # HTTP 200

# 4) Evolution alcança o CRM (webhook) — de dentro do container
docker exec cb-crm-evolution-1 node -e "fetch('http://host.docker.internal:3000/api/whatsapp/evolution/webhook',{method:'POST'}).then(r=>console.log(r.status)).catch(e=>console.log('ERR',e.message))"
# -> 401  (alcançou o CRM e rejeitou sem secret = OK)
```

## Arquivos relevantes

- [`docker-compose.evolution.yml`](docker-compose.evolution.yml) — Evolution local + Postgres
- `src/app/api/whatsapp/evolution/connect/route.ts` — cria/adota a instância + registra o webhook
- `src/app/api/whatsapp/evolution/webhook/route.ts` — recebe os eventos da Evolution
- `src/lib/whatsapp/transport/` — cliente/transporte Evolution
- `src/components/settings/evolution-connect.tsx` — a tela de QR
