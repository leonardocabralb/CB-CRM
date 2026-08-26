# O que chega com o merge do upstream — agosto/2026

Merge de `upstream/main` (`ArnasDon/wacrm`) em `main`. **40 PRs**, de 11/jul a
12/ago. Estávamos parados no upstream desde 21/jul.

Este documento separa duas coisas que costumam ser lidas como uma só:

- **Parte 1 — Novidades:** capacidades que o CB-CRM **não tinha**. Botão novo,
  tela nova, comportamento que antes simplesmente não existia.
- **Parte 2 — Melhorias:** coisas que já existiam e passaram a funcionar melhor,
  ou que estavam quebradas e foram consertadas.

No fim há duas seções curtas: o que foi **descartado** de propósito, e o que
**muda de operação** para quem usa o sistema.

> **Contexto que muda a leitura de tudo:** hoje o CB-CRM opera como inbox
> compartilhado sobre WhatsApp via **QR Code (Evolution)** — 2 canais, ambos
> Evolution, nenhum número na Meta Cloud API. No banco há **0 modelos, 0
> campanhas, 0 automações ativas e 0 flows**. Boa parte do que chega aqui é
> maquinário da **API oficial da Meta** e fica dormente até um número oficial
> ser conectado. Está marcado item a item.

---

# Parte 1 — Novidades: o que o CB-CRM não tinha

## 1.1 · Retomar uma campanha que parou no meio

**Ativo quando houver número Meta.**

Hoje a campanha roda **na aba do navegador** de quem clicou em enviar. Fechar a
aba abandona o disparo: os destinatários restantes ficam presos em `pending` e a
campanha fica em `sending` para sempre, sem nenhuma forma de terminar.

Passa a existir **retomada pelo servidor**, com três botões conforme o caso:
retomar os pendentes, tentar de novo só os que falharam, ou ambos.

Duas proteções que vieram junto e importam:

- **Trava de disparo** (`delivery_locked_at`). Retomar é um botão, e dois
  cliques mandariam mensagem duas vezes para a mesma pessoa. A trava é tomada
  com um `UPDATE` condicional — quem chegar depois simplesmente não pega. Uma
  trava com mais de 30 min é tratada como abandonada, para que um processo
  morto não congele a campanha até alguém mexer no banco.
- **Variáveis congeladas no planejamento** (`template_params`). Antes, os
  valores de `{{1}}`, `{{2}}` eram resolvidos no navegador na hora do envio e
  nunca gravados — uma retomada não teria como reconstruir o que cada pessoa
  deveria receber. Agora ficam gravados por destinatário, então retomar manda
  exatamente o que a passada original mandaria, não uma re-resolução contra
  dados que podem ter mudado.

Cada passada envia no máximo 1.000 destinatários; o que sobra continua
`pending` e a tela informa quantos faltam.

## 1.2 · Anexo recebido para de expirar

**Hoje sem efeito prático — ver nota.**

A Meta apaga a mídia recebida cerca de **30 dias** depois que ela chega. Até
aqui o CRM guardava só um ponteiro para a Meta, então toda foto, áudio e
documento recebido virava "indisponível" um mês depois, sem aviso e sem
recuperação.

Passa a existir um **espelho**: o anexo é copiado para o nosso bucket no momento
em que chega, e a conversa passa a apontar para a nossa cópia. Há um
interruptor por conta em *Configurações → WhatsApp* para desligar (quem
desligar aceita que os anexos voltem a expirar).

> **Nota:** isto vale para o canal **Meta**. Os nossos 497 anexos já estão no
> storage, porque o caminho da Evolution já baixava o arquivo. A novidade só
> passa a valer quando houver número oficial.

**O que muda hoje:** o bucket passou a aceitar 4 tipos de arquivo que antes
recusava — **GIF animado**, **vídeo QuickTime** (o formato que o iPhone às vezes
manda), a grafia `video/3gp` da Meta e **áudio Opus**. Isso vale para os dois
canais: antes, um cliente que mandasse um GIF tinha o anexo recusado no upload.

## 1.3 · Conversa fechada reabre quando o cliente escreve

**Ativo agora, nos dois canais.**

O atendente encerra o atendimento. Três dias depois o cliente responde. Até
aqui a conversa **continuava fechada**: o contador de não lidas subia, mas ela
não voltava para o filtro "Abertas" — e quem trabalha por esse filtro, que é o
modo normal de trabalhar, nunca via.

Agora a conversa reabre sozinha na resposta do cliente. A reabertura é
condicionada ao estado atual da conversa no banco, então duas mensagens
chegando juntas não reabrem por cima de um atendente que acabou de fechar de
novo.

Hoje não há nenhuma conversa fechada com não lidas — é um buraco que ainda não
mordeu, mas morde assim que o inbox for usado com mais volume.

## 1.4 · Palavra-chave por palavra inteira

**Ativo agora.**

O gatilho de palavra-chave só tinha dois modos: *contém* e *exato*. Uma
palavra-chave curta em modo *contém* dispara em qualquer mensagem que a
contenha — `"k"` dispara em `"obrigado"`.

Chega um terceiro modo, **palavra inteira**, que casa a palavra-chave apenas
isolada. Funciona com acentuação e com pontuação na palavra-chave (`"oi!"`), e
o modo *contém* segue como padrão.

## 1.5 · Aviso quando a conta não resolve

**Ativo agora.**

Quando o perfil de um usuário não resolve para uma conta ou papel, **toda a
interface carrega normalmente e nada salva** — o banco recusa cada gravação. Do
ponto de vista de quem está na tela, o sistema parece simplesmente quebrado, e
a descoberta é um "salvar" falhado de cada vez.

Passa a existir um aviso explícito no topo do painel, distinguindo dois casos:
o usuário não está vinculado a nenhuma conta, ou a busca do papel falhou (com
botão de tentar de novo). A consulta do perfil também passou a ter uma segunda
tentativa automática antes de desistir.

## 1.6 · Toque em botão de modelo passa a ser entendido

**Ativo quando houver número Meta.**

Quando o cliente toca num botão de resposta rápida de um **modelo** (o caso
típico: uma campanha com "Sim, quero" / "Agora não"), a Meta entrega isso num
formato diferente do botão comum. O webhook não conhecia esse formato: a
resposta caía no inbox como **"[Unsupported message type: button]"** e nenhum
motor via o toque.

Agora o toque é registrado como resposta interativa, com o rótulo visível e o
identificador do botão, e — o que importa de verdade — **aciona automação e
flow**. Duas coisas passam a ser possíveis:

- O gatilho `interactive_reply` reage ao toque num botão de campanha.
- Um **flow por palavra-chave inicia a partir do toque**, não só de texto
  digitado. Antes, o cliente que tocasse no botão não iniciava nada; quem
  digitasse a mesma palavra, sim — o mesmo conteúdo, resultado diferente.

Um toque também pode ser a **primeira** mensagem de um contato, e o gatilho
"primeira mensagem recebida" passa a reconhecê-lo.

## 1.7 · Campanha grande para de se estrangular

**Ativo quando houver número Meta.**

O limitador de taxa contava uma campanha como **uma** chamada. Na prática, mil
destinatários são cerca de cem chamadas ao longo de vários minutos — e o
limitador barrava a própria campanha no meio.

Agora um bloqueio por excesso de requisições é **aguardado e repetido**, em vez
de a leva inteira ser marcada como falha. Só esse tipo de erro é repetido;
qualquer outro continua falhando na hora, para não mandar mensagem duplicada.

## 1.8 · CI que executa as migrations

**Ativo agora, no repositório.**

Passa a existir uma verificação automática que sobe um Postgres limpo e aplica
**todas** as migrations, em ordem, do zero, a cada alteração em `supabase/`.

Vale registrar por quê: a checagem anterior nunca funcionou de fato — ou seja,
**todo arquivo `.sql` deste repositório foi para produção sem nunca ter sido
executado por CI**, incluindo os nossos 40 e poucos.

---

# Parte 2 — Melhorias no que já existia

## 2.1 · Mensagem recebida não duplica mais

**Ativo agora, nos dois canais.** — *a correção de maior impacto do merge*

Quando a entrega de uma mensagem é reenviada (um reconhecimento lento, uma
falha momentânea), o CRM gravava a mensagem **de novo**. Não é hipótese: em
26/jul a mesma mensagem de cliente foi gravada duas vezes, com 13 minutos de
diferença.

O problema não é só a bolha repetida. Cada duplicata **refazia tudo que vem
depois**: reexecutava flow, redisparava automação, chamava a IA outra vez e
reenviava webhook. Com resposta automática ligada, uma duplicata significa **o
cliente recebendo a mesma resposta duas vezes** — e mensagem de WhatsApp não se
recolhe.

A garantia passou a ser do banco: um índice único sobre (conversa, id da
mensagem). Uma reentrega vira conflito e é descartada **antes** de qualquer
efeito colateral. A proteção que existia no código era uma consulta seguida de
uma gravação — entre uma coisa e outra cabia a segunda entrega, e foi
exatamente ali que a duplicata de julho passou.

> Aplicado em produção em 26/08: a duplicata existente foi removida (2.504 →
> 2.503 mensagens) e não há mais nenhuma.

## 2.2 · O contador de não lidas para de perder mensagem

**Ativo agora, nos dois canais.**

O contador era lido, somado em memória e gravado de volta. Duas mensagens
chegando ao mesmo tempo liam ambas o valor `3` e gravavam ambas `4` — perdendo
uma. O inbox mostrava "2 não lidas" onde havia 3, e a terceira, a mais recente,
não puxava a atenção de ninguém.

A soma passou a acontecer dentro do próprio comando de atualização no banco,
onde não há como duas entregas se perderem.

## 2.3 · Bolha de modelo deixa de nascer vazia

**Ativo quando houver número Meta.**

Envio de modelo pela API pública ou por automação gravava o texto como **nulo** —
a bolha aparecia em branco no inbox, mesmo tendo saído corretamente para o
cliente. Só o compositor da tela gravava o texto, porque montava a mensagem no
navegador.

Agora o corpo **já substituído** (com `{{1}}`, `{{2}}` trocados pelos valores)
é gravado em todos os caminhos de envio. Uma variável sem valor aparece como
`{{2}}` visível, em vez de a frase sair truncada em silêncio.

No CB-CRM isso foi combinado com a nossa **assinatura**: o que fica gravado é o
texto **assinado** — o mesmo que o cliente recebeu.

## 2.4 · Modelo em idioma `en` deixa de sumir

**Ativo quando houver número Meta.**

A busca do modelo exigia o idioma exato. Modelos sincronizados da Meta
costumam vir como `en`, e quem não informasse idioma caía no padrão `en_US` — não
encontrava nada, e o envio ia sem cabeçalho e sem botões. Agora a busca cai de
exato → mesmo idioma base → um padrão sensato.

## 2.5 · Campanha órfã deixa de existir

**Ativo quando houver número Meta.**

A campanha era gravada antes dos destinatários. Se a segunda gravação falhasse,
sobrava uma campanha em `sending` sem nenhum destinatário — parecendo que estava
enviando, sem ter o que enviar. As duas passaram a acontecer na mesma transação.

## 2.6 · Segurança

**Ativo agora.**

- **12 vulnerabilidades fechadas, 9 delas de severidade alta**, em dependências
  de produção. `next` foi de 16.2.6 para 16.2.12 (8 alertas), mais correções em
  processamento de imagem (`sharp`/libvips, 4 CVEs), verificação de endereço
  (`ip-address`, que permitia furar proteção contra requisição interna) e
  isolamento entre requisições (`hono`).
- **Proteção contra requisição forjada** no envio de modelo com imagem de
  cabeçalho: a URL informada por quem cria o modelo era baixada pelo servidor
  sem nenhuma verificação. Agora endereços internos são recusados, redirecionamento
  não é seguido (uma URL pública podia saltar para um endereço interno) e há
  limite de tempo.
- **Guarda de papel** nas rotas de WhatsApp. Nós já tínhamos corrigido isso por
  conta própria em julho; o upstream corrigiu de outra forma, e o merge ficou
  com a forma deles nas rotas que ambos cobriam — com os mesmos níveis de
  exigência — e com a nossa nas duas rotas que só nós protegíamos.

## 2.7 · Interface

**Ativo agora.**

- **Construtor de botões/lista** deixa de transbordar quando usado dentro de um
  passo de automação. A divisão entre editor e prévia passou a considerar o
  espaço que o componente recebeu, não a largura da tela — antes, um monitor
  grande forçava uma prévia de 280px dentro de um card de ~190px.
- **Botão "Excluir funil"** volta a ter texto legível.
- **Campo "Nome" do contato** ganha rótulo próprio (mostrava o rótulo errado).
- **Textos com sintaxe de variável** (`{{1}}`) deixam de gerar ruído no console.

## 2.8 · Confiabilidade das automações

**Ativo agora.**

O upstream corrigiu dois problemas de execução de automação: o disparo não
aguardado (o registro era gravado e os passos não rodavam) e o log que nascia
marcado como "sucesso" antes de executar qualquer coisa.

**Nós já tínhamos corrigido os dois**, e de forma mais cuidadosa — o nosso
disparo é aguardado por causa de uma corrida com o roteador de funil, que o
upstream não conhece. Fica registrado porque a correção deles existe no
histórico e pode confundir quem for ler.

---

# O que foi descartado de propósito

Nem tudo que veio do upstream foi adotado.

| O que | Por quê |
| --- | --- |
| **Visualizador de mídia** do upstream | Já temos o nosso, com **giro e zoom** que o deles não tem — e giro é o que serve para ler foto de documento tirada deitada. O deles tem navegação entre anexos da conversa; se quisermos isso um dia, é uma adição, não uma troca. |
| **Reescrita do construtor de automações** | Corrige um problema de edição de passos aninhados que **nós não temos** — o nosso endereçamento já funciona. Adotar seria reescrever 317 linhas para substituir código que funciona. |
| **Código de afiliado no README** | O upstream adicionou o código de indicação dele em 5 links de hospedagem. Não hospedamos propaganda com afiliado de terceiro no nosso repositório. |

---

# O que muda para quem usa

Resumo do que dá para perceber na tela, hoje, sem número da Meta:

1. **Mensagem repetida não acontece mais.** Se você já viu uma mensagem de
   cliente duplicada na conversa, era isso.
2. **O contador de não lidas passa a estar certo** quando chegam várias
   mensagens juntas.
3. **Conversa fechada reabre sozinha** quando o cliente responde — ela volta
   para "Abertas" em vez de acumular não lidas onde ninguém olha.
4. **GIF, vídeo de iPhone e áudio Opus** deixam de ser recusados no recebimento.
5. **Aviso claro** quando a conta de um usuário não resolve, em vez de a tela
   funcionar e nada salvar.
6. **Palavra inteira** como novo modo de gatilho por palavra-chave.
7. **Construtor de botões/lista** não transborda mais dentro do card de
   automação.

E o que fica **guardado para quando um número da Meta for conectado**: retomada
de campanha, espelho de anexos, toque em botão de modelo acionando flows, corpo
de modelo na bolha, campanha que não se estrangula.

---

*Levantado em 26/08/2026 · base `main e045e12` × `upstream/main 6ed9191` ·
merge-base `3180f06` (21/jul)*
