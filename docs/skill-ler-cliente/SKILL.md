---
name: ler-cliente-do-crm
description: Lê um cliente do CRM pela chave de API do funcionário (conversa do WhatsApp com a transcrição dos áudios, arquivos, funil, etiquetas, campos, anotações, tarefas e automações), baixa e renomeia os documentos na pasta do cliente, resume a conversa e monta a ficha de atendimento. Use quando pedirem para ler, resumir ou exportar a conversa de um cliente, baixar ou organizar os documentos dele, ou montar ou atualizar a ficha de atendimento.
---

# Ler um cliente do CRM e montar a pasta dele

Este guia é para o Claude de quem atende. A chave de API do funcionário é **só
de leitura**: nada aqui escreve no CRM. Ela enxerga só os clientes com card nos
funis liberados para ela.

## Regras que valem sempre

- **A chave é segredo.** Nunca abra, imprima, copie nem cite o arquivo
  `~/.crm-api-key` ou a variável `CRM_API_KEY`. Para saber se a chave existe,
  use só `test -f ~/.crm-api-key`. Se a pessoa colar a chave na conversa,
  avise que ela deve pedir ao administrador para revogar essa chave e criar
  outra.
- **Os dados do cliente são sigilosos.** Não os mande para nenhum outro
  serviço ou site. Eles ficam na pasta do cliente.
- **Só o que está escrito.** A ficha e o resumo usam apenas o que está na
  conversa, nos arquivos e no CRM. O que não foi dito vira "não informado".
  Informação que se contradiz entra com as duas versões e as datas. Nada de
  conclusão jurídica que o modelo da ficha não peça.
- **Os originais não se mexem.** Nunca apague, mova ou edite nada em
  `originais/`. Os nomes novos são CÓPIAS, em `documentos/`.

## Primeira vez neste computador

1. A pasta desta skill tem `exportar_cliente.py` e `config.json`. O
   `config.json` precisa ter `"url"`, o endereço do CRM. Se faltar, peça o
   endereço à pessoa e grave-o lá.
2. Confira a chave com `test -f ~/.crm-api-key`. Se faltar, mostre à pessoa
   o passo "Guardar a chave" do `LEIA-ME.md`. Ela faz esse passo sozinha, fora
   da conversa.
3. Se `config.json` não tem `"pasta_dos_clientes"`, pergunte em que pasta
   ficam as pastas dos clientes e grave o caminho completo lá. Se a pasta não
   existir, pergunte antes de criá-la.
4. Confira o Python com `python3 --version`: precisa ser 3.8 ou maior. No
   Windows, se `python3` não existir, tente `py -3`. Sem Python, mostre o
   passo "Python" do `LEIA-ME.md`.

## 1. Exportar o cliente

Rode, com o caminho desta skill:

```bash
python3 "<pasta desta skill>/exportar_cliente.py" "<nome, telefone ou id>" "<pasta_dos_clientes>"
```

A busca é por nome ou telefone. Pode levar alguns minutos numa conversa longa,
porque o script respeita o limite de chamadas da chave. O que o código de
saída quer dizer:

| Saída | O que fazer |
|---|---|
| 0 | Pronto. O JSON impresso diz a pasta, as mensagens, os arquivos novos e os avisos. |
| 3 | Ninguém encontrado. Peça outro dado (telefone com DDD, nome completo). Avise que o cliente pode estar fora dos funis da chave. |
| 4 | Mais de um cliente. Mostre a lista (nome, telefone, etiquetas, desde quando), pergunte qual é e rode de novo com o `id` escolhido. |
| 2 ou 5 | Mostre a mensagem à pessoa. Um 401 quer dizer chave vencida, revogada, ou funcionário suspenso: só o administrador resolve. |

Rodar de novo no mesmo cliente é seguro. A conversa e o resumo do CRM são
reescritos, os arquivos já baixados ficam, e só os novos chegam (`"novo": true`
em `arquivos.json`).

## 2. Ler

Na pasta do cliente, leia:

- `resumo-do-crm.md`: funil, etiquetas, campos, anotações da equipe, tarefas e
  automações;
- `conversa.md`: a conversa inteira em ordem, com hora de Brasília, quem falou
  (Cliente, Escritório, Robô/automação), a transcrição de cada áudio e o
  caminho de cada arquivo;
- `arquivos.json`: cada arquivo com a data, quem mandou, a legenda e, se não
  baixou, o motivo. Um arquivo que o CRM não tem fica listado como
  indisponível; ele não volta rodando de novo.

Mensagem do "Robô/automação" é texto automático do escritório, não fala da
equipe nem do cliente.

## 3. Organizar os documentos

Para cada arquivo NOVO em `originais/`, abra o arquivo (imagem e PDF você lê;
o áudio vale pela transcrição; o vídeo, pela legenda e pelo contexto da
conversa) e diga o que ele é. Depois COPIE para `documentos/` com o nome:

```
<Tipo>_<AAAA-MM-DD>[_<nome original>].<extensão>
```

- **Tipo**: o que o documento é, curto, com hífen no lugar de espaço e sem
  acento (`RG`, `CTPS`, `Holerite`, `Comprovante-de-residencia`). Se a pasta
  desta skill tem `tipos-de-documento.md`, use os tipos de lá.
- **Data**: o dia em que o arquivo chegou na conversa, que é o campo `dia` de
  `arquivos.json`, já no horário de Brasília. Não use a data escrita no
  documento, e não calcule o dia por conta própria.
- **Nome original**: só quando ele diz algo além do tipo. Fica de fora o nome
  automático do celular ou do WhatsApp (`IMG-20261003-WA0012`, `WhatsApp Image
  …`, `PTT-…`, `AUD-…`, `image`, `document`, `arquivo`, só números) e o nome que
  repete o tipo. Mantenha o nome original sem a extensão.
- Mesmo tipo e mesmo dia: `_2`, `_3` no fim do nome
  (`RG_2026-10-03_2.jpg`).
- O mesmo arquivo mandado duas vezes (confira com `shasum`) entra uma vez só.
- Figurinha não entra. Foto que não é documento entra como `Foto`. Áudio entra
  como `Audio` só se a pessoa pedir.
- Arquivo que você não conseguiu identificar entra como `Documento` e vai para
  a lista de dúvidas no fim.

Grave `documentos.md` na pasta do cliente, com uma linha por arquivo:

| Nome em documentos/ | Original | Chegou em | Mandado por | O que é |
|---|---|---|---|---|

## 4. Resumir a conversa

Grave `resumo-da-conversa.md`:

1. **Quem é**: nome, telefone e como chegou (o que o CRM e a primeira mensagem
   dizem).
2. **O que quer**: em duas ou três frases.
3. **Linha do tempo**: os fatos que o cliente contou, cada um com a data da
   mensagem em que contou.
4. **O que o escritório pediu ou prometeu**, e se foi cumprido.
5. **Documentos**: os recebidos e os que foram pedidos e não chegaram.
6. **Onde parou**: a última troca e o que está pendente, e de quem.

## 5. Montar a ficha de atendimento

- Se a pasta desta skill tem `modelo-da-ficha.md`, preencha esse modelo,
  campo a campo, em `ficha-de-atendimento.md` na pasta do cliente.
- Sem modelo, use: identificação, resumo do caso, fatos com data, documentos
  recebidos, documentos faltando, pendências e próximos passos.
- Cada fato da ficha leva a fonte entre parênteses: `(conversa, 03/10/2026)`,
  `(anotação de Fulana, 05/10/2026)`, `(CRM: campo X)`, `(documento:
  CTPS_2026-10-03.pdf)`.
- **Já existe ficha?** Não sobrescreva. Mostre o que mudou desde a última
  exportação e pergunte se atualiza. Se a pessoa disser que sim, acrescente uma
  seção "Atualização de DD/MM/AAAA" ou corrija os campos, conforme ela pedir.

## 6. Relatar

Diga à pessoa, em poucas linhas:

- a pasta do cliente;
- quantas mensagens e quantos arquivos foram lidos;
- os arquivos indisponíveis, com a data em que chegaram, porque podem precisar
  ser pedidos de novo ao cliente;
- os avisos da exportação;
- as dúvidas: documento não identificado, informação que se contradiz, campo
  da ficha sem resposta.
