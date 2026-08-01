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
| `cb-evo-baileys` | confere se o patch do `@lid` continua aplicado |

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
cb-evo-baileys  ed265ddd6314fb35
```

## Revogar

A qualquer momento, sem depender de ninguém:

```bash
userdel -r claude && rm -f /etc/sudoers.d/claude
```

Os scripts podem ficar — sem o usuário e sem a regra do `sudoers`, ninguém os
alcança.
