# Deploy do CRM na VPS (Docker Swarm + Traefik)

O CRM roda como um serviço no Swarm que **já existe** na VPS, atrás do
Traefik (que já cuida do TLS). Arquivos: [`Dockerfile`](../Dockerfile),
[`docker-stack.yml`](../docker-stack.yml), CI em
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

**Estado hoje:** `crm.cbadvogados.com` ainda aponta para a hospedagem
compartilhada da Hostinger (`91.108.127.34`), **não** para a VPS
(`82.25.76.63`, = `vps.cbadvogados.com`). O passo 1 corrige isso.

---

## 1. DNS — apontar o subdomínio para a VPS  *(sua mão)*

No gerenciador de DNS de `cbadvogados.com` (hPanel → Domínios → DNS, ou
onde o domínio é gerido), no registro **`crm`**:

- Remova o apontamento atual (Hostinger compartilhada).
- Crie: `crm` → **A** → `82.25.76.63`  (ou **CNAME** → `vps.cbadvogados.com`).

Confirme (propaga em minutos):

```bash
dig +short crm.cbadvogados.com   # deve retornar 82.25.76.63
```

O Traefik emite o certificado Let's Encrypt sozinho assim que o DNS
apontar para a VPS e o serviço subir.

## 2. Confirmar os 3 valores do Traefik  *(na VPS)*

O [`docker-stack.yml`](../docker-stack.yml) assume `traefik-public` /
`websecure` / `letsencrypt`. Confira contra um serviço que já funciona:

```bash
docker service inspect evolution_evolution --format '{{ json .Spec.Labels }}' \
  | tr ',' '\n' | grep -i -E 'traefik.docker.network|entrypoints|certresolver'
docker network ls | grep -i traefik
```

Ajuste `NETWORK (1)`, `ENTRYPOINT (2)` e `CERTRESOLVER (3)` no
`docker-stack.yml` para bater com o que aparecer.

## 3. Segredos de runtime na VPS  *(sua mão)*

Crie `crm.env` na VPS (fora do git) com os valores do seu `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://hxnhakmyxyhalbsktzwe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service-role>
ENCRYPTION_KEY=<a mesma 64-hex do .env.local — NÃO gere outra>
AUTOMATION_CRON_SECRET=<cron secret>
# META_APP_SECRET=<vem na virada para a Meta>
# EVOLUTION_WEBHOOK_SECRET=<gerado quando o webhook Evolution entrar>
```

> ⚠️ `ENCRYPTION_KEY` **tem que ser idêntica** à do `.env.local` — o banco
> é o mesmo, e uma chave diferente torna ilegíveis os tokens já salvos.

## 4. Primeiro deploy  *(na VPS)*

```bash
docker login ghcr.io -u <seu-usuario-github>        # se a imagem for privada
set -a && source crm.env && set +a
export CRM_IMAGE=ghcr.io/<owner>/<repo>:latest       # ou deixe o default do stack
docker stack deploy -c docker-stack.yml crm
docker service logs -f crm_crm                       # acompanhar o boot
```

Verifique:

```bash
curl -I https://crm.cbadvogados.com/login            # 200 e cadeado válido
```

## 5. CI/CD (deploys seguintes automáticos)

No GitHub → Settings → Secrets and variables → Actions, adicione:

| Secret | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | mesma do `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | mesma do `.env.local` |
| `VPS_SSH_HOST` | `82.25.76.63` |
| `VPS_SSH_USER` | usuário SSH (ex. `root` ou um deploy user) |
| `VPS_SSH_KEY` | chave privada SSH autorizada na VPS |

A partir daí, todo push na `main` builda a imagem, publica no GHCR e faz
o **rolling update** do serviço (`start-first`, com rollback automático se
o container novo não ficar saudável).

## Notas

- O `HEALTHCHECK` do container bate em `/login`; o Swarm só troca o
  serviço quando o novo container responde.
- Os assets estáticos são servidos pelo próprio Next (standalone) —
  o Traefik faz só o TLS/proxy, não hospeda arquivos.
- Endurecimento futuro: mover `crm.env` para **Docker secrets** em vez de
  variáveis de ambiente.
