---
paths:
  - "src/lib/pipelines/motivo-da-etapa*"
  - "src/components/pipelines/motivo-da-etapa-config*"
  - "supabase/migrations/1112_cb_campo_do_motivo_da_etapa.sql"
  - "supabase/migrations/campo-do-motivo-1112.test.ts"
---

# Motivos de desqualificação e de perda — regras

Plano vivo: `docs/PLANO-motivos-de-perda.md` (fases, medições, listas). O
resto do Gerenciar funil e do quadro está em `.claude/rules/funil.md`; o
campo que salva sozinho na ficha, em `.claude/rules/campos-e-nome.md`.

### Decisões do operador (26/10/2026)

- **Dois campos Lista por área** (motivo da DESQUALIFICAÇÃO e motivo da
  PERDA), no bloco de cada área, com a área no nome ("Motivo da perda
  (Bancário)"): o passo "Atualizar campo" e o catálogo do agente de IA
  listam os campos sem o bloco. Regra entre as etapas: Desqualificado = fora
  do perfil; Perdido = tinha caso (ou sem saber) e não avançou.
- **3 ou 4 motivos + "Outro"**, que abre texto livre gravado no PRÓPRIO
  campo (a ficha mostra valor fora da lista; o relatório agrupa como
  "Outro").
- **Obrigatório para PESSOAS** que levam o card à etapa (Fase 2); automação,
  robô, IA e API nunca abrem janela — a automação grava o motivo no próprio
  passo "Mover card de etapa" (Fase 3). O botão "Perdido" passa a escolher
  etapa + motivo e mover (Fase 2).

### Qual campo a etapa pergunta (1112)

`pipeline_stages.campo_do_motivo_id` (FK `ON DELETE SET NULL`),
`motivo-da-etapa.ts` (puro) e a seção `MotivoDaEtapaConfig` do Gerenciar
funil.

- ⚠️ **Quem decide é a CONFIGURAÇÃO da etapa, não o `resultado`**: o
  operador pode ligar o motivo numa etapa neutra ("Não Respondeu" do
  Trabalhista é degrau perda e etapa neutra).
- ⚠️⚠️ **O gatilho confere só a CONTA, nunca o tipo.** O upsert do Gerenciar
  funil regrava TODAS as etapas a cada "Salvar", e o BEFORE INSERT do upsert
  roda até para a linha que vira UPDATE: conferir o tipo travaria qualquer
  salvamento do funil depois de o tipo do campo mudar. O tipo é conferido
  por quem LÊ (`motivoDaEtapa`/`campoDoMotivo`): Lista com ao menos uma
  opção. Pino `campo-do-motivo-1112.test.ts`.
- ⚠️ **Campo que não serve nunca vira "Não pergunta" na tela**:
  `motivoDaEtapa` separa `nao_serve` (deixou de ser Lista ou ficou sem
  opção) e `sumiu` (fora do catálogo) de `nenhum`; o seletor mostra o valor
  com aviso e trava enquanto o catálogo carrega ou falhou. O "Salvar"
  regrava o valor lido do banco.
- **O catálogo do seletor é da conta DO FUNIL** (`account_id` lido com o
  nome do funil), nunca só pela RLS da 1032, que devolve os campos de toda
  conta da pessoa — o gatilho recusaria no "Salvar".
- **Seção própria, não quinta caixa na linha da etapa**: a linha já tem
  quatro seletores de largura fixa e só deixa de quebrar em `lg`.
- **ADITIVA**: o app novo manda a coluna no upsert; sem a 1112 aplicada o
  PostgREST recusa o "Salvar" do Gerenciar funil inteiro. Aplicar ANTES do
  deploy.

### O Previdenciário ainda tem UM campo só

- ⚠️ `aa_motivo_desqualificacao` mistura desqualificação e perda, e as 6
  automações de lembrete GRAVAM nele (`update_contact_field`: "Não
  respondeu", "Não reengajou", "Outro") e uma desligada DECIDE por ele
  (condição `equals "Não respondeu"`). Dividir o campo exige repontar as 7
  automações junto, e espera a decisão da etapa "Perdido" do Previdenciário
  (plano, "Em aberto").
