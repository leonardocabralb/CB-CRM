# Acesso de leitura à VPS

Quatro comandos instalados na VPS para diagnosticar o CRM e a Evolution sem
dar acesso administrativo à máquina.

## Por que não é "acesso Docker somente leitura"

Porque isso **não existe**. Duas armadilhas que parecem soluções:

- **Colocar o usuário no grupo `docker` não restringe nada.** Quem está nesse
  grupo monta o disco do host num contêiner e vira root em um comando. É
  equivalente a root, com aparência de restrição.
- **Liberar os subcomandos "de leitura" do Docker também não.** O
  `docker service inspect` devolve TODAS as variáveis de ambiente — inclusive
  `AUTHENTICATION_API_KEY`, senha de banco e chaves de S3. E `docker exec` dá
  shell dentro do contêiner.

Por isso o acesso não é a um *comando genérico com filtro*, e sim a **quatro
programas de escopo fixo**, escritos aqui e revisáveis como qualquer código.
O `sudoers` libera exatamente esses quatro caminhos, sem curinga.

## O que cada um faz

| comando | para que serve |
| --- | --- |
| `cb-status` | lista stacks e serviços, com a imagem em execução |
| `cb-logs <serviço> [minutos] [padrão]` | log do CRM ou da Evolution |
| `cb-inspect <serviço>` | imagem, tarefas e **nomes** das variáveis |
| `cb-evo-baileys` | imagem em execução, versão da Evolution e da Baileys, e se o `prisma.config.ts` está na imagem (desde 09/09/2026; antes conferia o patch do `@lid` da 2.3.2) |

Duas restrições estão **dentro** dos scripts, não no `sudoers`:

- `cb-logs` e `cb-inspect` só aceitam `crm_crm` e `evolution_evolution`.
  Postgres, Traefik, n8n, typebot e os demais stacks da máquina ficam de fora.
- `cb-inspect` imprime só os **nomes** das variáveis. Os valores nunca são
  impressos — é o que separa "ver a configuração" de "ler os segredos".

`cb-evo-baileys` usa `docker exec`, mas com comando **fixo**: não recebe
argumento nenhum de quem chama. Exec genérico continua fora.

## Instalar

⚠️ **O terminal da VPS é um console serial (`ttyS0`) e embaralha colagem de
várias linhas.** A primeira tentativa gravou três dos quatro arquivos com 8
bytes — só o cabeçalho — e o erro passou despercebido até a conferência.

Por isso a instalação usa **uma linha por arquivo**, em base64, com checksum:
se um caractere se perder, o comando falha em vez de gravar lixo.

Gere as linhas a partir deste diretório e cole-as **uma de cada vez**:

```bash
for f in ops/vps/cb-status ops/vps/cb-logs ops/vps/cb-inspect ops/vps/cb-evo-baileys; do
  n=$(basename "$f")
  echo "# $n"
  echo "echo '$(base64 < "$f" | tr -d '\n')' | base64 -d > /usr/local/bin/$n && chown root:root /usr/local/bin/$n && chmod 755 /usr/local/bin/$n && sha256sum /usr/local/bin/$n | cut -c1-16"
  echo
done
```

⚠️ **`chown root:root` não é detalhe.** Se o usuário `claude` puder escrever
nos scripts, ele reescreve um deles e vira root — o que anula tudo.

Depois, o usuário e a liberação:

```bash
adduser --disabled-password --gecos "" claude
mkdir -p /home/claude/.ssh && chmod 700 /home/claude/.ssh
echo 'restrict,no-agent-forwarding,no-port-forwarding <CHAVE PÚBLICA>' >> /home/claude/.ssh/authorized_keys
chmod 600 /home/claude/.ssh/authorized_keys && chown -R claude:claude /home/claude/.ssh
```

⚠️ **Não** acrescente `claude` ao grupo `docker`.

```bash
echo 'claude ALL=(root) NOPASSWD: /usr/local/bin/cb-status, /usr/local/bin/cb-logs, /usr/local/bin/cb-inspect, /usr/local/bin/cb-evo-baileys' > /tmp/claude.sudo \
  && visudo -c -f /tmp/claude.sudo \
  && install -o root -g root -m 440 /tmp/claude.sudo /etc/sudoers.d/claude \
  && rm /tmp/claude.sudo && echo "LIBERADO"
```

O `visudo -c` valida antes de instalar. Sem ele, um erro de digitação tranca o
`sudo` para todo mundo, inclusive para quem está corrigindo.

## Conferir que o limite existe

Instalar sem testar o limite é confiar na intenção. Os cinco abaixo **têm de
recusar** — resultado de 29/07/2026:

| tentativa | resultado esperado |
| --- | --- |
| `sudo -n docker ps` | `sudo: a password is required` |
| `sudo -n cat /root/crm.env` | `sudo: a password is required` |
| `sudo -n cb-logs postgres_postgres 5` | `servico nao permitido` |
| `sudo -n su -` | `sudo: a password is required` |
| `echo x >> /usr/local/bin/cb-status` | `Permission denied` |

O último é o que fecha o cerco: sem ele, os outros quatro não valem nada.

## Conferir que a VPS e o repositório não divergiram

Os scripts existem em dois lugares. Este comando compara:

```bash
for f in cb-status cb-logs cb-inspect cb-evo-baileys; do
  r=$(shasum -a 256 "ops/vps/$f" | cut -c1-16)
  v=$(ssh -i ~/.ssh/cb-crm-vps claude@82.25.76.63 "sha256sum /usr/local/bin/$f | cut -c1-16")
  [ "$r" = "$v" ] && echo "OK      $f" || echo "DIFERE  $f  repo=$r  vps=$v"
done
```

Confirmado idêntico em 29/07/2026:

```
cb-status       36815dc110aa7913
cb-logs         01b1a073358061cb
cb-inspect      0c32fc69031ab942
cb-evo-baileys  eb7662f48a2c92f9   (reinstalado em 09/09/2026, versão para a Evolution 2.4)
```

## Revogar

A qualquer momento, sem depender de ninguém:

```bash
userdel -r claude && rm -f /etc/sudoers.d/claude
```

Os scripts podem ficar — sem o usuário e sem a regra do `sudoers`, ninguém os
alcança.

## Stack da Evolution — para recriar o serviço do zero

Desde 09/09/2026 a definição do serviço `evolution_evolution` está versionada
aqui, gerada a partir da **especificação viva** do Swarm (`docker service
inspect`) e validada com `docker stack config` sem deploy:

| Arquivo | Onde vive | O que é |
| --- | --- | --- |
| `evolution-stack.yml` | aqui e em `/root/evolution-stack.yml` | a stack completa: imagem **por digest**, `env_file`, volume `evolution_instances` (externo), rede `CBAdvNet` (externa), `stop-first`, os 8 rótulos do Traefik |
| `evolution.env.example` | aqui | os **nomes** das 118 variáveis, com os segredos em `<preencher>` |
| `evolution.env` | **só** em `/root/evolution.env` (600), fora do git | os valores reais |

⚠️ **Este arquivo não se atualiza sozinho.** A troca de imagem do dia a dia é
`docker service update --image …@sha256:…` (o roteiro em
`docs/PLANO-baileys-7.md`, 6.2), e ela NÃO reescreve o `.yml`. Antes de
qualquer `docker stack deploy -c /root/evolution-stack.yml evolution`, conferir
a linha `image:` contra `docker service inspect evolution_evolution` — um
deploy com imagem velha faz downgrade silencioso. O `stack deploy` é para
**recriar** (VPS nova, serviço apagado), não para atualizar.

⚠️ O `/root/evolution.yaml` de 28/07/2026 está **obsoleto** (imagem 2.3.2, sem
as variáveis novas) e fica na VPS só como histórico.

Para regenerar os três arquivos a partir do que está rodando:
`/root/gerar-stack.py` (lê o `docker service inspect` mais recente gravado em
`/root/backups/evolution-service-spec-*.json`).
