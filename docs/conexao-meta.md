# Conectar um número oficial (Meta Cloud API): quando a conexão falha

Um número oficial entra no CRM em **Configurações → Conexões → Adicionar
conexão → Meta**, com o Phone Number ID, o WABA ID, o token permanente, o
Verify Token e o PIN. Os passos de criar o app, o usuário do sistema e o
token estão no [`INSTALACAO.md`](./INSTALACAO.md) (seção 3.2); vários
números oficiais na mesma instalação, no [`multi-waba.md`](./multi-waba.md).

Este documento explica o **aviso vermelho** que o diálogo mostra quando a
Meta recusa a conexão: o que ele quer dizer e o que fazer.

## O que o CRM confere, e em que ordem

Ao salvar, o CRM fala com a Meta **antes** de gravar qualquer coisa:

1. **Os ids são só dígitos.** Phone Number ID e WABA ID são números de
   identificação, não o telefone. Colar `+55 51 99999-9999`, um nome ou uma
   URL é recusado aqui, sem chamar a Meta.
2. **Lê o número** (`GET /{phone-number-id}`) com o token. É aqui que token
   vencido, token sem permissão e Phone Number ID errado aparecem.
3. **Confere o par WABA/número.** Com o WABA ID preenchido, o número tem de
   estar entre os que a Meta lista sob aquela WABA. Uma WABA válida, mas de
   outro número, era aceita e assinada — e o webhook simplesmente nunca
   chegava, dias depois, sem erro nenhum na tela.
4. **Registra o número** (só com o PIN). Se o registro falhar, a conexão é
   salva assim mesmo, marcada como desconectada, com o motivo na linha
   "Último erro" do cartão: corrija o PIN e adicione a conexão de novo com os
   mesmos dados — o CRM reconhece o número e atualiza a conexão existente.
5. **Assina a WABA no app** (só com o WABA ID). Sem essa assinatura a Meta
   não entrega nenhuma mensagem; por isso, se ela falhar, **nada é gravado**
   e o diálogo diz por quê.

Embaixo do aviso vêm o **código** da Meta, o **trace id** e o detalhe que a
Meta mandou. São o que o suporte da Meta pede — dá para selecionar e copiar.

## Os avisos

### "O Phone Number ID (ou o WABA ID) deve ter só dígitos"

Você colou outra coisa no campo. Copie o id de *Meta → WhatsApp → API
Setup*. O Phone Number ID não é o número de telefone.

### "A Meta não encontra o Phone Number ID … (ou o WABA ID …)"

O id está errado, ou o token foi gerado num portfólio empresarial que não é
dono daquele número (ou daquela WABA). É a tradução do "(#100) Unsupported
get request" da Meta. Copie o id de novo e confira o portfólio do usuário do
sistema.

### "O Phone Number ID … não pertence à WABA …"

Os dois ids existem, mas não andam juntos. O aviso lista os números que a
Meta enxerga sob aquela WABA: se o seu não está ali, um dos dois foi colado
de outra conta. Confira os dois em *API Setup*.

### Token: "expirou", "foi invalidado" ou "a Meta recusou o token"

O token temporário da página *API Setup* dura 24 horas. Gere um token
**permanente** em *Business Settings → Users → System Users*, com as
permissões `whatsapp_business_management` e `whatsapp_business_messaging`,
expiração **Never**. Troca de senha ou sessão revogada também invalidam o
token.

### "O token de acesso não tem permissão…" / "A Meta negou o acesso…"

O usuário do sistema precisa das duas permissões acima **e** estar vinculado
à conta do WhatsApp (*System Users → Add assets → WhatsApp accounts*).
Depois de vincular, gere um token novo — o antigo não ganha a permissão.

### PIN: "recusou o PIN", "o PIN está errado", "bloqueou as tentativas"

O PIN é o da verificação em duas etapas, definido em *WhatsApp Manager →
Phone numbers → Two-step verification* (dá para redefini-lo lá). Depois de
muitos erros a Meta bloqueia novas tentativas por um tempo: espere antes de
tentar de novo. Número de **teste** da Meta não tem PIN — deixe o campo em
branco.

### "Este número ainda não está registrado na Cloud API"

Falta o registro: informe o PIN e salve de novo.

### "A Meta exige que este número seja verificado de novo" / "foi apagado há pouco"

As duas coisas se resolvem na Meta, não no CRM: conclua a verificação em
*WhatsApp Manager → Phone numbers*, ou espere o prazo que a Meta impõe
depois de um número ser apagado.

### "A Meta restringiu esta conta" / "bloqueou esta conta por violação de política"

A conta do WhatsApp Business está restrita. Veja o motivo em *Meta Business
Manager → Account quality* e recorra por lá. Nada no CRM contorna isso.

### "A Meta está limitando as chamadas…" / "erro temporário"

Espere alguns minutos e tente de novo. Se o erro temporário persistir,
confira [metastatus.com](https://metastatus.com) e informe o trace id ao
suporte da Meta.

### "Não foi possível falar com a Meta…"

O servidor do CRM não alcançou `graph.facebook.com` (rede, DNS, firewall).
O detalhe embaixo diz o que falhou.

### "A Meta devolveu um erro…"

Um código que o CRM não conhece. O código, o trace id e a mensagem da Meta
estão logo embaixo — é o que levar ao suporte da Meta.

## Conectou, mas nenhuma mensagem chega

A conexão salva só prova que a Meta aceitou as credenciais. Para receber,
falta o **webhook** no painel do app (*WhatsApp → Configuration → Webhooks*),
com a URL e o Verify Token que você informou, e o campo `messages` assinado —
o passo 7 do [`INSTALACAO.md`](./INSTALACAO.md). E o `META_APP_SECRET` do
servidor tem de ser o App Secret do app que entrega; com números em apps
diferentes, veja o [`multi-waba.md`](./multi-waba.md).
