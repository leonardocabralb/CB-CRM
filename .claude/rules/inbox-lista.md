---
paths:
  - "src/components/inbox/conversation-list.tsx"
  - "src/components/inbox/inbox-filters.tsx"
  - "src/components/inbox/visoes-salvas.tsx"
  - "src/components/inbox/filtros-salvos-dialogos.tsx"
  - "src/components/inbox/nova-conversa-dialog.tsx"
  - "src/components/inbox/voltar-ao-funil.tsx"
  - "src/components/inbox/espera-das-favoritas.test.ts"
  - "src/lib/inbox/filtros*"
  - "src/lib/inbox/visoes*"
  - "src/lib/inbox/atraso*"
  - "src/lib/inbox/ordem-da-lista*"
  - "src/lib/inbox/busca-em-mensagens*"
  - "src/lib/inbox/url*"
  - "src/lib/inbox/voltar-no-celular*"
  - "src/lib/inbox/conversations*"
  - "src/lib/conversations/situacao*"
  - "src/hooks/use-filtros-salvos*"
  - "src/hooks/use-favoritas*"
  - "src/hooks/use-busca-em-mensagens*"
  - "src/hooks/use-total-unread*"
  - "src/app/*/inbox/**"
  - "src/app/api/cb/conversas/**"
---

# Caixa de entrada: lista, filtros e busca — regras

Vale ao mexer na lista de conversas, nas abas, nos filtros (avulsos ou salvos), na busca, na ordem da lista e em "Nova conversa". Fio, compositor e painel: `.claude/rules/inbox-conversa.md`. Número da conversa, janela de 24h e ampulheta da linha: `.claude/rules/canal-na-conversa.md`. Quem reabre conversa: `.claude/rules/ingestao.md`. Voltar pelo histórico no celular: `.claude/rules/celular.md`.

### `conversation-list.tsx` é NOSSO, e a consulta é contrato

- ⚠️ **Praticamente reescrito (924): num merge do upstream, fica a NOSSA versão**, trazendo só o que for novo dele. O recorte mora em `src/lib/inbox/filtros.ts`, a barra é `<InboxFilters>`, e `onTermoDeBusca` espelha o termo assentado para a página, que o passa ao fio (são irmãos).
- ⚠️ **`CONVERSATION_SELECT` (`src/lib/inbox/conversations.ts`) é CONTRATO da API v1** — não alargá-lo para servir tela. O quadro do funil tem `DEAL_SELECT_DO_QUADRO` próprio.
- ⚠️ **A lista carrega TODAS as conversas, em páginas** (`buscarPaginado`): o PostgREST corta em 1000 sem avisar, e a busca que atravessa as abas deixaria de achar cliente que existe. O desempate por `id` é obrigatório: as conversas sem mensagem empatam em NULL, onde a página quebra.

### Ordem da lista

- ⚠️ **`nullsFirst: false` na ordenação é load-bearing:** grupo sincronizado sem mensagem tem `last_message_at` nulo, e em DESC o Postgres põe NULL primeiro — dezenas de grupos vazios empurrariam as conversas ativas para baixo. Não é só grupo: a conversa 1:1 aberta pelo "Nova conversa" também nasce com a coluna nula e fica no FIM até a primeira mensagem (abre selecionada; a busca a acha com "Nenhuma mensagem ainda"). Quem mexer na ordenação conta com as duas.
- ⚠️ **`ordenarComoOBanco(conversations)` num memo ANTES do recorte.** O upstream nunca reordena, e a conversa que recebia mensagem ficava abaixo da dobra até recarregar. Espelha os DOIS `.order` da consulta: mudou um, muda o outro. A lista se move sob o ponteiro, de propósito. Conversa nova fica no FIM até a primeira mensagem. Pino: `ordem-da-lista.test.ts`.
- ⚠️ **O INSERT de mensagem do tempo real passa por `comMensagemNova`:** hora e prévia só AVANÇAM (carimbo antigo — carga de histórico, mensagem recuperada — puxaria a linha para baixo) e aviso de SISTEMA do grupo não mexe na linha. O upstream grava `last_message_at: newMsg.created_at` cru. Pino: `ordem-da-lista.test.ts`.
- **O contador do menu (`useTotalUnread`) pagina por CHAVE e aplica por cima os eventos que chegam durante a carga** (`mapaDaCarga`): a conversa lida no meio da carga seguia contada. Pino: `use-total-unread.test.ts`.

### Caixa de entrada em DUAS ABAS

- ⚠️ **`status` do filtro é `"ativas" | "closed"`, e `"ativas"` (aberta E pendente) é a AUSÊNCIA de filtro.** Não existe "todas as situações": encerrar é tirar da caixa.
- ⚠️ **A busca ATRAVESSA a aba padrão, e SÓ ela** (`casaComASituacao`): sem isso, buscar cliente com conversa encerrada dizia "nenhuma conversa", e o operador concluiria que ele não está no CRM. Em Encerradas a busca é E lógico, senão a aba mentiria.
- ⚠️ **A aba NÃO é filtro — nem do painel, nem da visão salva** (decisão do operador, 03/09/2026): a aba é ONDE o operador está. `contarFiltrosAtivos` não conta a situação, `lerFiltroSalvo` ignora o `status` gravado, `escreverFiltroSalvo` não o grava, `mesmoFiltro` não o compara e `aplicarVisao` mantém a aba. Com a aba na visão, aplicar um chip em Encerradas jogava para Abertas, e trocar de aba apagava o chip. "Visão só de encerradas" é outra feature.
- ⚠️ **Na linha, pastilha escrita SÓ para pendente e encerrada** (`STATUS_PILL`): "Aberta" em quase toda linha é o rótulo que o olho aprende a ignorar. O anel colorido no avatar foi retirado pelo operador — não voltar.
- ⚠️ **O alerta de atraso lê `conversations.aguardando_desde`, mantida por GATILHO (972), nunca calculada na tela.** Cliente preenche se vazia (a PRIMEIRA sem resposta); resposta de GENTE (`sender_id` OU `from_device`) limpa; encerrar limpa; grupo nunca. Broadcast e robô NÃO limpam: um disparo apagaria o alerta de todo cliente esquecido. Âmbar aos 10 min (`ATRASO_DE_RESPOSTA_MS`), vermelho aos 30 (`ATRASO_CRITICO_MS`) — decisão do operador. A linha não muda no banco quando o prazo vence: a lista re-renderiza por um tique de 1 min. A coluna é preenchida mesmo com a conversa encerrada: é a TELA que esconde o alerta das encerradas.
- **"Exibindo N de M" conta a ABA**, com o termo da busca no universo.

### Barra, fileira de visões e painel compacto

- ⚠️ **A barra é UMA linha sem `flex-wrap`:** abas à esquerda e chips quadrados só com ícone à direita, todos por `chipDaBarra()` de `inbox-filters.tsx` — gatilho com forma própria foi a queixa original. A coluna tem 320 px no `lg` e 360 px SÓ no `xl` (a 1024 px, menu e painel já deixam ~104 px ao fio). A barra ocupa ~290 dos 296 px úteis: chip novo não cabe; campo novo vai para o painel.
- **Abaixo, a FILEIRA DE VISÕES e o painel de ajustes, recolhido** (distintivo = recortes além da aba). Pastilhas soltas, "Limpar tudo" e a faixa "Filtro padrão: X" saíram a pedido do operador: repetiam o chip aceso. A fileira QUEBRA linha (rolagem cortava o chip sem sinal). Painel: FIXOS conexões, etiquetas e funil/etapa; "Mais filtros" (tipo, responsável, empresa) abre sozinho quando um deles recorta, senão esconderia de onde vem o recorte. "Limpar" limpa a busca também e mantém a aba.
- ⚠️ **A coluna da lista precisa de `min-w-0` no wrapper de `inbox/page.tsx`:** item de flex nasce com `min-width: auto`, a prévia `truncate` é `nowrap`, e no CELULAR a coluna saía com milhares de px, cortando busca, abas e visões. No desktop (`lg:w-80`) nada aparece.

### Filtros do inbox: o recorte é PURO e mora fora da tela (924)

`src/lib/inbox/filtros.ts`, `inbox-filters.tsx` e `src/hooks/use-favoritas.ts`. Mexer em filtro é mexer lá, não dentro da lista.

- ⚠️ **Filtrar por campo do contato NA CONSULTA dá resultado errado sem erro:** o embed LEFT devolve quem não casa com `contact: null`; `contacts!inner` some com toda conversa de grupo. Filtre em JS.
- ⚠️ **Conversa de grupo tem `conversations.channel_id` NULO:** recorte ou contagem por canal usa `canalDaConversa()`.
- ⚠️⚠️ **O `ContextoDosFiltros` tem campos OBRIGATÓRIOS; esquecê-los não dá erro, dá "nenhuma conversa" com cara de certo.** O compilador os cobra: `achadasNoTexto`; `funilPorEtapa`; `recorteDeEtapaConfiavel` (mapa contato → etapa vazio reprovaria tudo e o `?etapa=` abriria vazio; o recorte é neutralizado DENTRO de `aplicarFiltros`, pino `filtros.test.ts`); `agoraMs` (o prazo vence sem a linha mudar — tela nova precisa de tique de 1 min); `inadimplentes` (`Set | null`, `null` = "não sei" e neutraliza; régua em `.claude/rules/integracoes-asaas.md`).
- ⚠️ **Funil/etapa tem DOIS níveis, e `funilId` é escrito SÓ pelo seletor de funil.** Carimbado pela etapa, numa conta de um funil "Qualquer etapa" viraria "quem tem negócio neste funil" e sumiria com quem não virou negócio. A etapa VENCE o funil em `casaComAEtapa`. Dois níveis só com 2+ funis NOMEADOS. Uma pastilha POR NÍVEL (a única cortava a etapa).
- ⚠️ **A lista pagina a consulta de `deals`** (o teto de 1000 derrubava o filtro de etapa). O painel recebe `etapas` SEMPRE (dão nome à pastilha — nunca "Qualquer etapa" sobre filtro ativo); `etapasConfiaveis` gateia só OFERECER o campo.
- ⚠️ **O chip "Em atraso" reusa `atrasoDeResposta`**, a MESMA régua do selo da linha (cópia acenderia o chip sobre linha sem selo). Não depende de "Não lidas" (abrir zera `unread_count` sem responder). Fica FORA de `limparOrfaos`. Rótulo inglês "Overdue", não "Awaiting reply".
- **Escopo vazio = TUDO:** `FILTROS_VAZIOS` não recorta; "sem responsável" e "sem negócio" são opções explícitas.
- **Filtro cujo dado não carregou SOME da tela:** seletor sem dado responde errado com cara de certo. Cada busca do painel tem sinalizador próprio.
- ⚠️ **A lista segura o spinner até as favoritas voltarem** (`aguardandoFavoritas`): o recorte sobre o conjunto vazio da montagem dizia "nenhuma conversa". "Carregadas" é carimbado com o DONO e vale para leitura que falhou (senão o spinner fica para sempre). Pino: `espera-das-favoritas.test.ts`.

### `?etapa=` e `?de=funil` (a jornada do funil)

- **`?etapa=` semeia o filtro de etapa UMA vez; `?de=funil` mostra "Voltar ao funil".** Os `replace` usam `urlDoInbox`, que preserva `de` e derruba `etapa` DE PROPÓSITO: preservá-la faria o filtro limpo voltar no reload.
- ⚠️ **O filtro semeado morre com a jornada:** a página não remonta quando só a query muda, e sem o efeito de ciclo de vida o recorte ficava aplicado sem explicação. Etapa semeada que não existe mais é descartada; etapa escolhida à mão não é tocada.
- ⚠️ **`?etapa=` VENCE o filtro padrão**, senão a faixa "Voltar ao funil" mentiria sobre a tela.

### Filtros SALVOS do inbox (967/968/974): de CADA MEMBRO

`src/lib/inbox/filtros-salvos.ts` e `visoes.ts` (puros), `use-filtros-salvos.ts`, `visoes-salvas.tsx`, `filtros-salvos-dialogos.tsx` e a semente em `conversation-list.tsx`. Aplicar é `setFiltros(...)`.

- **Posse (974):** `user_id NOT NULL DEFAULT auth.uid()`, policies "só as minhas", nome único por (conta, membro), `ON DELETE CASCADE` de propósito (preferência pessoal). Decisão do operador: não são distribuíveis. O padrão também é de cada um.
- ⚠️ **A fileira tem uma BASE (`visaoBaseId`):** o chip clicado por último ou o padrão semeado — é o que permite "Salvar alterações em X". "Todas" e "Limpar" a zeram; mexer não. O chip ACESO é IGUALDADE com o recorte atual depois de `limparOrfaos`, nunca a base.
- ⚠️ **Conexões são VÁRIAS (`canalIds`, vazio = todas):** `lerFiltroSalvo` lê o JSON antigo (`canalId: "x"` → `["x"]`), `limparOrfaos` tira só os ids mortos, `mesmoFiltro` compara conjunto. Filtro com todas as conexões fora do escopo do perfil SOME (aplicado viraria "todas"); o "aplicado" é procurado só entre os visíveis que ainda recortam.
- ⚠️⚠️ **Filtro salvo com id APAGADO devolve ZERO conversas sem erro:** aplicar passa SEMPRE por `limparOrfaos`. **Catálogo VAZIO não limpa nada** ("não carregou" jogaria fora um recorte bom). `empresa` fica fora (é texto, não id).
- ⚠️ **`lerFiltroSalvo` é PARSE, nunca `as FiltrosDoInbox`:** parte de `FILTROS_VAZIOS`, aceita só chave conhecida com o tipo certo, booleano só com `true`.
- ⚠️ **Campo novo em `FiltrosDoInbox` = mexer nas pastilhas de `inbox-filters.tsx` E em `descreverFiltro`.** `AMOSTRAS` é `Record<keyof FiltrosDoInbox, …>`: o compilador cobra a entrada e o teste cobra que o campo apareça, se desfaça e sobreviva ao banco.
- ⚠️⚠️ **A semente do padrão roda UMA vez (`semeouPadraoRef`), só sobre recorte INTACTO**, e lê o recorte pela REF (`setState` dentro de updater é efeito colateral). Espera os CATÁLOGOS (etiquetas, perfis, etapas, funis) E as CONEXÕES (outra rota, às vezes depois) — NÃO os negócios, que seguravam a caixa até a última página. Semeado antes das conexões, padrão com conexão apagada ficava com id morto e a caixa vazia, sem conserto. Catálogo novo em `limparOrfaos` = espera nova aqui e em `esperandoPadrao`.
- ⚠️ **A lista segura o spinner enquanto o padrão pode entrar (`esperandoPadrao`)**, senão pinta tudo e pula para o recorte um segundo depois.
- ⚠️ **Toda escrita confere ROWCOUNT** (RLS que barra volta 0 linhas com `error: null`; INSERT barrado volta sem linha). Nome único por membro, aparado e em minúsculas; o `23505` vira PERGUNTA ("já existe 'SDR' — substituir?").

### A busca do inbox tem DUAS metades, somadas com um OU (929/930)

Nome, telefone, grupo e última mensagem em JS (`casaComABusca`); o corpo do histórico pelo banco (`cb_buscar_conversas_por_texto`, via `use-busca-em-mensagens.ts`).

- ⚠️ **O OU vale só entre as duas metades, dentro do `.filter()`**, senão a busca atropelaria o painel (com "Favoritas", traria não favorita).
- ⚠️ **A RPC devolve o conjunto COMPLETO, colapsado por `DISTINCT ON`:** consulta direta a `messages` estoura as 1000 linhas e a busca fica incompleta com cara de completa.
- **Uma função para as duas pontas (`cb_texto_para_busca`)**, senão o índice desliga em silêncio. `%` e `_` escapados. Piso de 3 caracteres no BANCO — a tela diz que o corpo ficou de fora. Só o texto vigente (`deleted_at IS NULL`, sem `text_before_edit`). A RPC devolve o trecho que casou, exibido no lugar da prévia (que mentiria).
- ⚠️⚠️ **A busca no CORPO é DESLIGADA por padrão** (interruptor `buscarNasMensagens`; 2º parâmetro `ativa` de `useBuscaEmMensagens`) — decisão do operador: ligada, buscar um NOME enterrava a conversa procurada entre as que o citam. Desligada, a RPC não roda e `termoAplicado` é `""`. As dicas ("3 letras", "buscando", "falhou") ficam atrás do interruptor; o placeholder diz o que a caixa olha. Estado de sessão, sem persistência.
- ⚠️ **Só o lado do CONTATO ganha a variante do nono dígito (`variantesDoNonoDigito`), nunca o termo** — alterá-lo inventaria uma busca. Só celular com DDI 55. Vale em `casaComABusca` e `casaComContato`.
- Busca DENTRO do fio e o salto: `.claude/rules/inbox-conversa.md`.

### Iniciar conversa pelo CRM (`POST /api/cb/conversas/abrir`)

- **ABRE, não envia:** cria ou reencontra contato e conversa, FIXA o canal escolhido (`pinConversationChannel`, não `follow` — quem clicou escolheu) e navega por `?c=`.
- **Abrir NÃO cria negócio** (decisão do operador): o card nasce no primeiro ENVIO — número errado viraria card para caçar e apagar.
- ⚠️ **Contato e conversa gravam o DONO da conta, nunca quem clicou** (DONO DURÁVEL, na raiz; pino `src/lib/contacts/dono-duravel.test.ts`).
- ⚠️ **Selecionar a recém-aberta NÃO pode depender do `?c=`:** refetch (`resyncToken`) e `router.replace` saem juntos; se a consulta volta antes da navegação, `deepLinkConvId` é o antigo e o centro fica VAZIO para sempre. Por isso `conversaRecemAbertaRef`, consumida antes do deep link.
- ⚠️ **A recusa do telefone é load-bearing:** `findExistingContact` casa pelos 8 últimos dígitos, e um JID de grupo colado fundiria com o celular de um cliente. `telefoneDigitado` barra nos DOIS lados (tela e rota): letra e mais de 15 dígitos recusados; sem DDI ganha o 55.
- **Reusa `findExistingContact`**: busca própria criaria segunda ficha para o número com/sem nono dígito.
- **A rota confere POSSE do canal, não escopo de perfil** (nenhuma rota valida `canalNoEscopo` hoje).
