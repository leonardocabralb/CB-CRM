---
paths:
  - "src/hooks/use-mudanca-no-negocio*"
  - "src/lib/pipelines/regua-das-leituras*"
  - "src/lib/pipelines/etapas-padrao*"
  - "src/components/inbox/painel/painel-do-contato.tsx"
  - "src/app/*/pipelines/page.tsx"
---

# Painel da conversa × negócio mudado por fora; etapas do funil novo

A regra geral do funil está em `funil.md`. Validação de 25/10/2026.

### O painel acompanha o negócio mudado por OUTRO caminho

`useMudancaNoNegocio` + `criarReguaDasLeituras` + `recarregarNegocios`
(`painel-do-contato.tsx`). O agente de IA moveu o card com a conversa aberta
e o seletor de etapa ficou na antiga até recarregar (medido).

- ⚠️ **O aviso vem da TRILHA (`cb_lead_events`), nunca de `deals`**: `deals`
  não está na publicação realtime, e o gatilho da 912 escreve a trilha para
  TODO escritor (agente, automação, robô, v1, colega). Só INSERT, por
  `contact_id`, só os tipos de negócio (`TIPOS_QUE_MUDAM_O_NEGOCIO`). O evento
  só AVISA: o painel relê do banco.
- **Tópico por ASSINATURA** (`negocios:<contato>:<contador>`), como no
  `useLeadEvents`: fio, Histórico e painel assinam o mesmo contato juntos.
- ⚠️ **Relê SÓ os negócios**, em silêncio (nunca `fetchContactData`
  inteiro): reler campos trocaria por baixo o que o operador digita.
- ⚠️⚠️ **Nenhuma leitura grava por cima de outra pedida DEPOIS dela**: a
  régua é a última que GRAVOU. A ESCRITA do próprio painel (seletor,
  ganho/perdido, valor, data, "avançar") conta como a leitura mais nova —
  senão a releitura pedida antes desfazia o que acabou de ser salvo — e, se
  havia leitura no ar, relê de novo.
- ⚠️⚠️ **A escrita só avisa a régua se o negócio é do contato NA TELA**
  (`contactIdRef`): a resposta que volta depois da troca de conversa calaria
  a carga do contato novo ("sem negócios").
- O que o canal perdeu fora do ar volta pelo `resyncToken` (só quando MUDA).
- **Limites**: valor ou título mudados por fora não geram evento (aparecem na
  próxima releitura); etapa CRIADA depois de abrir a conversa mostra "—" até
  trocar de conversa; o quadro do funil segue sem realtime.

### Funil novo: etapas padrão no idioma

`src/lib/pipelines/etapas-padrao.ts` (pino `etapas-padrao.test.ts`).

- ⚠️ **Os nomes das etapas do funil novo e o do funil semeado na conta sem
  funis saem do dicionário** (`Pipelines.page.etapasPadrao.*`,
  `funilPadrao`): o nome é GRAVADO, e a instalação em português nascia com
  "New Lead → Won". O diálogo cita a primeira e a última da MESMA lista.
  Chaves literais. Num merge do upstream, a página volta com o inglês SEM
  conflito (`docs/MERGE-UPSTREAM.md`).
- **Nada lê etapa pelo NOME** (ganho/perdido, degrau e situação são MARCAS;
  v1, automações e robô apontam por id). Por isso "Ganho" nasce SEM
  `resultado`, como a "Won": marcá-la é decisão do operador.
