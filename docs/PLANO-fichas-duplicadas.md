# Plano — Fichas duplicadas (detectar e avisar)

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

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 1 | Migration 1084 (RPC, tabela das decisões, índices) + pino + prova num Postgres descartável | [ ] |
| 2 | Módulo puro + hook + faixa na conversa | [ ] |
| 3 | Diálogo "Comparar" + decisões do admin | [ ] |
| 4 | Faixa no formulário do card | [ ] |
| 5 | Regras, revisão, preview, PR | [ ] |
| Fase 2 (futura) | Unir: operação única no servidor, só admin; telefone e e-mail secundários guardados e usados na busca; id antigo respondendo na API (o Make de quem integra desliga no 1º erro) | não começada |

## Limites conhecidos

- O quadro do funil não marca o card: o aviso aparece ao abrir (D3).
- Importação em lote não usa o sinal de horário (lote = mais de 10 fichas
  em ~2 min); e-mail e telefone continuam valendo.
- Duas grafias de nome sem a primeira palavra em comum (sobrenome trocado
  de lugar, apelido) só aparecem pelo e-mail.
