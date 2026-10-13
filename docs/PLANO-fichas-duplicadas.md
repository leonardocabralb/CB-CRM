# Plano — Fichas duplicadas (detectar, avisar e unir)

> Plano vivo. Marcar `[x]` conforme cada fase entra. Documento INTERNO
> (não vai para quem instala o sistema). Sem dado de cliente: o repositório
> é público — só contagens.

## Por que

A mesma pessoa vira DUAS fichas quando chega por dois caminhos com dados
diferentes: o formulário do anúncio com um telefone e o agendamento
(Calendly) com outro; ou o formulário com o número digitado errado e o
WhatsApp com o certo. A chave única do telefone (1024) não pega isso, porque
os números são diferentes.

O estrago: dois cards no funil; o rastreamento (campanha, UTM) e os dados do
formulário numa ficha, a conversa e o agendamento na outra. A métrica de
campanha perde justamente o lead que avançou.

Pedido do operador (13/10/2026): ao entrar num card, o sistema avisa
"possível duplicata"; a pessoa abre as duas fichas lado a lado, confere e
decide. Esta é a FASE 1: detectar e avisar. Unir é a fase 2.

## Decisões do operador (13/10/2026)

- **D1 — Quem.** Todos veem o aviso e podem comparar. Só ADMIN decide ("não
  é duplicata", "pessoas diferentes, mas ligadas"), como apagar contato.
  Unir (fase 2) também será só admin.
- **D2 — Só sinais FORTES** geram aviso.
- **D3 — Sem lista de pares.** O aviso aparece só no card e na conversa.
- **D4 — A base inteira entra.** Com o desenho "conferido na hora" (abaixo),
  toda ficha antiga é conferida quando for aberta: não há varredura para
  rodar nem lista para manter.
- **D5 — O botão "Unir" fica FORA da fase 1** (nem desabilitado).

### Fase 2 — Unir (decisões de 13/10/2026)

Pedido: "as duas devem prevalecer em cima daquela que o sistema acha que é a
mais correta e a mais atual. Dados não devem ser perdidos, eles devem ser
mesclados." Já decidido antes: só ADMIN une (D1), sem desfazer; a foto da
ficha que sai e os valores que não couberam ficam guardados.

- **D6 — Qual fica.** O sistema SUGERE (a ficha com a mensagem do cliente
  mais recente; sem mensagem, a mexida por último; por fim a mais nova) e o
  admin pode TROCAR.
- **D7 — Cards.** UM card por funil: nos funis em que as duas fichas têm card,
  fica o mais avançado (ganho > aberto > perdido; depois o degrau do funil de
  eficiência; depois a posição; empate: o da ficha que fica). O outro sai
  depois de passar a história (trilha, documentos do ZapSign), as notas, o
  valor, o responsável e o id da Kommo para o que fica. Card em funil que só
  uma tem passa inteiro.
- **D8 — Automações.** As em curso da ficha que SAI terminam (marca durável
  `fusao`, a mesma dos outros cancelamentos); o robô dela para; as da ficha
  que fica seguem.
- **D9 — Contatos antigos, só nos CADASTROS.** O telefone e o e-mail da ficha
  que sai ficam guardados na que fica e a encontram no formulário pela API, no
  Calendly, no webhook de entrada e na ficha criada pelo Asaas — com o MESMO
  primeiro nome (o número digitado errado pode ser de outra pessoa). A
  mensagem de WhatsApp do número antigo abre conversa própria; o aviso de
  possível duplicata ganha o sinal "contato de uma ficha unida".

## Medição (13/10/2026, somente leitura)

- Ficha com 2 cards abertos no mesmo funil: **1** caso na base. O problema
  real é a mesma pessoa em duas fichas, cada uma com o seu card.
- Nome repetido: **385** nomes, somando **1.159** fichas (de 5.779). Nome
  sozinho não é sinal.
- Mesmo e-mail em fichas diferentes: **3** grupos, todos com cara de mesma
  pessoa.
- Telefone a UM dígito de distância (troca, sobra ou falta): **6** pares na
  base inteira. Com o mesmo primeiro nome, **4**, todos com cara de mesma
  pessoa; os 2 sem o mesmo nome eram pessoas diferentes.
- Criadas com até **2 min** de diferença e o mesmo primeiro nome, fora de
  importação em lote: **4** pares, os 4 reais (formulário + Calendly;
  formulário + WhatsApp, inclusive um número com dois dígitos invertidos).
  Entre 2 e 10 min: 2 pares, os 2 de pessoas diferentes. DENTRO de
  importação em lote (mais de 10 fichas por minuto): **12,5 mil** "pares" —
  por isso o lote fica de fora do sinal de horário.
- **14** fichas em 60 dias tiveram a 1ª mensagem recusada por número sem
  WhatsApp; só 2 tinham ficha gêmea.

## Desenho

- **Conferido NA HORA, não guardado.** A RPC `cb_possiveis_duplicatas`
  (`SECURITY INVOKER`: a RLS de `contacts` vale) calcula os pares DAQUELA
  ficha quando a conversa ou o card abre. Sem gatilho no caminho de entrada
  (a ingestão não paga nada), sem varredura, sem lista para envelhecer; as
  fichas antigas entram sozinhas (D4). Custo: três buscas por índice ao
  abrir.
- **Sinais (D2):**
  1. **mesmo e-mail** (aparado, minúsculo), desde que o endereço não esteja
     em mais de 3 fichas — endereço de reserva digitado pela equipe não é
     sinal;
  2. **telefone a um dígito de distância** (troca, sobra, falta ou dois
     vizinhos invertidos) **E o mesmo primeiro nome**;
  3. **criadas com até 2 min de diferença E o mesmo primeiro nome**, fora de
     lote (no máximo 10 fichas criadas na conta entre 1 min antes da
     primeira e 1 min depois da segunda).

  "Primeiro nome" = a primeira palavra do nome, sem acento e em minúsculas,
  com 3 letras ou mais (`cb_primeiro_nome`). Emoji, número e nome vazio não
  contam: sem primeiro nome, só o e-mail vale.
- **Decisões guardadas:** `cb_duplicatas_descartadas` (par ordenado, quem e
  quando), escrita só por admin (RLS). "Pessoas diferentes, mas ligadas"
  grava o vínculo de Contatos relacionados (1069). Os dois tiram o par do
  aviso; desfazer o vínculo traz o aviso de volta.
- **Onde aparece:**
  - na faixa "Possível duplicata", no bloco de faixas acima do compositor
    da conversa (vale também para a conversa aberta na pauta de reuniões);
  - no formulário do card: o card sem conversa abre o formulário, e é
    exatamente o caso da ficha de formulário.

  O botão "Comparar" abre as duas fichas lado a lado: quando cada uma
  nasceu, dados, etiquetas, campos, cards e as últimas mensagens. Card de
  funil e conversa de conexão fora do perfil de quem vê não aparecem.
- **Fusão de fichas:** a tabela nova entra na receita de
  `.claude/rules/supabase.md`, pelas duas pontas.

### Desenho da fase 2 (1092)

- **Tudo no banco, numa transação**: `cb_unir_fichas(fica, sai)` (SECURITY
  DEFINER, admin sem suspensão). A tela pede antes `cb_previa_da_uniao` (o que
  fica, o que sai, o que passa, o que fica de fora, os bloqueios) e só mostra
  o botão com a prévia lida.
- **A receita de fusão mora na função** e não se esquece de tabela: no fim
  ela percorre pelo CATÁLOGO toda FK para `contacts` (e para a conversa que
  sai) e recusa a união (`uniao_sem_tratamento`) se sobrar linha numa tabela
  que ela não conhece.
- **A conversa é UMA por ficha**: com as duas, as mensagens (menos a cópia da
  mesma mensagem do WhatsApp), anotações, agendadas, reações, favoritos,
  turnos da IA, avisos e ligações passam para a da ficha que fica. A conversa
  reabre se a que saiu estava aberta (com o responsável dela), as não lidas
  somam, a prévia e o canal seguem a mais recente (salvo canal fixado), a
  janela da Meta fica com o maior carimbo de cada número e a espera é
  recalculada.
- **A ficha que fica completa o que falta**: nome (o escrito por gente vence o
  apelido do WhatsApp; nome que é número cede), empresa, foto, e-mail, campos
  vazios; valor diferente nas duas fica o da que fica e o outro vai para o
  livro e para o Histórico. Etiquetas, tarefas, lembretes, vínculos de
  Relacionados, "não é duplicata", Atlas, Asaas, Calendly, ZapSign, reuniões e
  a trilha inteira passam.
- **A ordem que as restrições reais impõem**: toda ficha precisa de telefone,
  Instagram ou BSUID, então o telefone da que sai só passa à que fica (quando
  ela não tem) DEPOIS de a outra ser apagada.
- **Registro**: o livro `cb_fichas_unidas` (a foto da que saiu, as
  divergências, o resumo) e, por gatilho, a linha "Ficha … unida a esta" no
  Histórico e no fio da que fica. Os contatos antigos moram em
  `cb_contatos_antigos`.
- **Id antigo na API v1**: `GET`/`PATCH /contacts/{id}`, etiquetas e campos
  respondem com a ficha que ficou (o Make de quem integra desliga no 1º erro).
- **Bloqueios**: ficha do Instagram (a conversa mista é a Fase 5 de
  `docs/PLANO-instagram-direct.md`) e dois BSUIDs diferentes.

## Estado

> ⚠️ As migrations foram APLICADAS como 1084, 1086 e 1087 e renumeradas para
> 1088, 1089 e 1090 antes do merge (OK do operador, 13/10/2026): com os números
> antigos ficavam abaixo da 1085, que entrou antes no `main`, e quem atualiza
> por `supabase db push` as teria recusadas (Codex no #403). Abaixo, os números
> novos; no histórico da produção ficam os antigos.

| Fase | O quê | Estado |
| --- | --- | --- |
| 1 | Migration 1088 (RPC, tabela das decisões, índice) + pino + prova num Postgres descartável | [x] Provada num Postgres 16 (esqueleto + 1069; aplicada duas vezes e com dados; ~20 cenários de sinal e de permissão). Aplicada em produção em 13/10/2026 (histórico `20261013163655`) depois do CI verde no `cee7af70`. A RPC acha em produção os pares medidos. ⚠️ Medida como `authenticated`: **289 ms** por chamada — o planejador calculava o primeiro nome da conta inteira. |
| 1b | Migration 1089: a mesma RPC sem varrer a conta | [x] Candidatas por índice atrás de CTE `MATERIALIZED`, vizinho do telefone por igualdade (`unnest`), janela calculada na ficha. Postgres 16 local com 6 mil fichas: 49 ms → **3,5 ms**, os cenários da 1088 passam. [x] CI verde (`01c6a5d7`) [x] aplicada em produção em 13/10/2026 (histórico `20261013172136`): nas 20 fichas com chance de par, as mesmas 20 linhas da 1088. Em produção, como `authenticated`: ficha comum **16 ms** (era 289); ficha de LOTE **177 ms** — 3.874 das 5.784 fichas nasceram numa importação de 3 min. |
| 1c | Migration 1090: a ficha de lote não busca par pelo horário | [x] A ficha conta as fichas em volta dela (±1 min, até 11); com mais de 10, nenhum par passaria. Postgres 16 local com um lote de 2 mil: 52 ms → **3,3 ms**, ficha comum igual, a base inteira com o mesmo resultado da 1089. [x] CI verde (`b2bad097`) [x] aplicada em produção em 13/10/2026 (histórico `20261013175900`) [x] a base inteira de produção (5.786 fichas) devolve as mesmas 20 linhas da foto de antes da 1089. Em produção, como `authenticated`: ficha de lote 177 → **9 ms**, ficha comum **8 ms**. |
| 2 | Módulo puro + hook + faixa na conversa | [x] código e testes; [x] preview (13/10, ficha gêmea FICTÍCIA do lead de teste, apagada no fim) |
| 3 | Diálogo "Comparar" + decisões do admin | [x] código; [x] preview: as duas colunas, "Não é duplicata" + "Desfazer" do aviso, "Pessoas diferentes, mas ligadas" (o vínculo aparece nos Contatos relacionados) |
| 4 | Faixa no formulário do card | [x] código; [x] preview (o "Comparar" abre por cima do formulário) |
| 5 | Regras, revisão, preview, PR | PR #403 (fora do rascunho em 13/10); regras de contatos e de fusão, CLAUDE.md (seção 12), MERGE-UPSTREAM. [x] preview (como admin; a visão de quem não é admin fica no teste da faixa) [x] revisão independente (13/10): nomes reais na conferência da 1088 trocados por fictícios; 1090; o "Comparar" que reabria sozinho (componente único que remonta por ficha); faixa e aba Relacionados sincronizadas; rótulos de falha, ligação e telefone; rodapé no celular. [x] preview das correções (13/10, ficha gêmea fictícia com telefone pontuado, apagada no fim): telefone sem "++", rodapé no celular na ordem certa, ligar pelo "Comparar" atualiza a aba Relacionados e desvincular na aba devolve a faixa, sem recarregar. Merge por SQUASH (decisão do operador, 13/10/2026): o histórico do PR tem o commit com os nomes reais, e o `main` recebe um commit único, limpo. |
| 6 | Fase 2 — migration 1092 (unir, prévia, livro, contatos antigos, sinal 4) | [x] Provada numa RÉPLICA do esquema de produção (catálogo copiado só de leitura, sem dado; Postgres 16 local) com dados fictícios: 51 conferências no cenário das duas fichas com conversa e cards nos mesmos funis; só a que sai com conversa; ficha só-BSUID; bloqueios (Instagram, BSUIDs, contas, mesma ficha); portas (atendente, admin suspenso, dono de outra conta, sem sessão, peças internas); a trava contra tabela nova esquecida; sinal 4 nos dois sentidos e sob RLS; a busca dos cadastros (nome igual, diferente, ausente, outra conta). Aplicada duas vezes; a conferência une um par fictício e desfaz. Com 200 mil mensagens: prévia 13 ms, união 49 ms. [ ] CI [ ] aplicada em produção |
| 7 | Fase 2 — tela e cadastros | [x] "Unir as fichas" no "Comparar" (revisão com sugestão e "Trocar", cards, o que passa, contatos antigos, o que fica de fora, automações interrompidas, bloqueios, aviso de que não se desfaz); recarrega na conversa que ficou. [x] A linha da união no fio e no Histórico (com o que ficou de fora). [x] Motivo `fusao` no "Já rodou". [x] Contatos antigos na API v1, Calendly, webhook de entrada e Asaas. [x] Id antigo na API v1. [ ] preview [ ] revisão independente [ ] PR |

## Limites conhecidos

- "Pessoas diferentes, mas ligadas" grava o vínculo de Relacionados, que é
  de `agent` (1069): o atendente que liga as fichas pela aba também tira o
  par do aviso. Só o botão do "Comparar" é de admin.
- `cb_primeiro_nome` aplica `lower()` antes de decompor: num banco com
  LC_CTYPE "C" puro, a letra maiúscula acentuada não desce, e a conferência
  da 1088 aborta. Produção e replay usam UTF-8 com ICU; mudar exige migration
  nova (a 1088 está aplicada).

- O quadro do funil não marca o card: o aviso aparece ao abrir (D3).
- Importação em lote não usa o sinal de horário (lote = mais de 10 fichas
  em ~2 min); e-mail e telefone continuam valendo.
- Duas grafias de nome sem a primeira palavra em comum (sobrenome trocado
  de lugar, apelido) só aparecem pelo e-mail.
- **Unir (fase 2):**
  - mensagem do cliente que chega pela conversa da ficha que SAI no instante
    da união (a transação dura uma fração de segundo) encontra a conversa
    apagada e se perde — o mesmo de apagar um contato;
  - Instagram não se une por aqui (bloqueio);
  - card de conexão da ficha que sai vira `manual` quando a que fica já tem
    um (o índice da 911 aceita um só por ficha);
  - com os dois cards carimbados pela Kommo, fica o id do card que fica (o
    outro está na foto do livro);
  - contato antigo não se apaga pela tela (só a próxima união mexe nele);
  - a análise do Radar da conversa que sai some quando a que fica tem a sua
    (a próxima análise refaz a janela).
