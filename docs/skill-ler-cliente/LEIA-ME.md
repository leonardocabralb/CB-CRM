# Skill "ler-cliente-do-crm": o Claude do funcionário lê o cliente

Com esta skill, quem atende pede ao Claude, no próprio computador, algo como
"monte a ficha da Maria da Silva". O Claude lê pela API a conversa do WhatsApp
dela (com a transcrição dos áudios), os arquivos, o funil, as etiquetas, os
campos, as anotações, as tarefas e as automações. Depois baixa e renomeia os
documentos na pasta da cliente, resume a conversa e preenche a ficha de
atendimento.

Ela usa a **chave do funcionário** (veja [`public-api.md`](../public-api.md)):
uma chave só de leitura, ligada a uma pessoa da equipe e recortada pelos funis
dela. A chave para sozinha na validade, ou na hora em que a pessoa é suspensa
ou sai da equipe.

O que vem nesta pasta:

| Arquivo | Para quê |
|---|---|
| `SKILL.md` | o passo a passo que o Claude segue |
| `exportar_cliente.py` | lê o cliente pela API e grava a pasta (Python 3.8+, sem instalar nada) |
| `config.json` | o endereço do CRM e a pasta dos clientes |
| `modelo-da-ficha.md` (opcional, do escritório) | a ficha que o Claude preenche |
| `tipos-de-documento.md` (opcional, do escritório) | os nomes de tipo usados ao renomear |

O modelo da ficha e os tipos de documento são do escritório, não do CRM. Sem
eles, o Claude usa uma ficha simples e tipos curtos.

## 1. O administrador cria a chave

Em **Configurações → API → Chaves → Nova chave de API**:

1. **Nome**: algo como "Claude — Maria (atendimento)".
2. **Funcionário**: a pessoa que vai usar.
3. **Funis**: os do setor dela. Ela só vê os clientes com card nesses funis.
4. **Validade**: 90 dias é a sugestão.
5. **Escopos**: clique em **Só leitura**. A skill usa `contacts:read`,
   `conversations:read`, `messages:read`, `deals:read`, `notes:read`,
   `tasks:read`, `custom_fields:read` e `automations:read`. Sem um dos quatro
   últimos, a exportação sai com um aviso e sem aquela parte.
6. Copie a chave (ela só aparece uma vez) e entregue à pessoa por um canal
   seguro. Por e-mail ou grupo de WhatsApp, não.

Para cortar o acesso: **Revogar**, ou suspender a pessoa na equipe.

## 2. A pessoa instala a skill (uma vez)

A skill roda no **Claude Code**: no aplicativo Claude para computador, aba
Code, ou no terminal. Nesta versão, o Cowork não foi testado.

**Copiar a pasta.** Copie esta pasta inteira, com o nome
`ler-cliente-do-crm`, para:

- Mac: `~/.claude/skills/ler-cliente-do-crm/`;
- Windows: `C:\Users\<você>\.claude\skills\ler-cliente-do-crm\`.

**Endereço do CRM.** Em `config.json`, ponha o endereço em `"url"`
(`https://crm.exemplo.com.br`). A `"pasta_dos_clientes"` pode ficar vazia: o
Claude pergunta na primeira vez.

**Guardar a chave.** Faça este passo fora do Claude, para a chave nunca passar
pela conversa. Copie a chave e, no Terminal (Mac), rode:

```bash
pbpaste > ~/.crm-api-key && chmod 600 ~/.crm-api-key
```

No Windows, no PowerShell:

```powershell
Get-Clipboard | Set-Content -NoNewline "$HOME\.crm-api-key"
```

Depois, copie qualquer outro texto para tirar a chave da área de
transferência. Quem preferir pode usar a variável de ambiente `CRM_API_KEY`
no lugar do arquivo.

**Python.** No Mac, rode `python3 --version` no Terminal. Se o Mac oferecer
instalar as ferramentas de desenvolvedor, aceite. No Windows, instale pelo
python.org e marque "Add python.exe to PATH".

## 3. Usar

No Claude Code, peça em português: "leia a conversa do cliente João Souza e
monte a ficha", "baixe e organize os documentos do (11) 98765-4321", "atualize
a ficha da Maria". Também dá para chamar `/ler-cliente-do-crm João Souza`.

A pasta de cada cliente fica assim:

```
<pasta dos clientes>/João Souza/
  ficha-de-atendimento.md   a ficha preenchida
  resumo-da-conversa.md     o resumo, com a linha do tempo
  documentos.md             o que é cada documento e de onde veio
  documentos/               os documentos com nome novo (cópias)
  originais/                os arquivos como vieram do WhatsApp
  conversa.md               a conversa inteira, em ordem
  resumo-do-crm.md          funil, etiquetas, campos, anotações, tarefas
  arquivos.json, cliente.json, .exportacao.json   dados de controle
```

Pedir de novo no mesmo cliente atualiza a conversa e baixa só os arquivos
novos. A ficha já escrita não é sobrescrita sem perguntar.

## O que a skill não faz

- **Não escreve no CRM.** A chave é só de leitura.
- **Não vê cliente sem card** nos funis da chave, nem conversa de grupo.
- **Não recupera arquivo que o CRM não tem.** Uma mídia que não chegou a ser
  guardada aparece como "indisponível", com a data, para ser pedida de novo.
- **Não lê campo de senha.** Campo cujo nome tem "senha" fica de fora da
  pasta.
- **Não faz conclusão jurídica** além do que o modelo da ficha pede. O resumo e
  a ficha trazem a fonte de cada fato, para quem atende conferir.

## Limite de chamadas

A chave aceita 120 chamadas por minuto, e o script fica abaixo disso. Uma
conversa longa (milhares de mensagens) leva alguns minutos. Baixar os
arquivos não conta no limite.
