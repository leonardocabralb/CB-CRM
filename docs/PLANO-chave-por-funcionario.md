# Plano — Chave de API por funcionário, só de leitura, recortada por funil

> **O que é este arquivo.** Guia retomável do piloto pedido pelo operador em
> 2026-11-04: cada funcionário do setor Trabalhista recebe a PRÓPRIA chave da
> API, coloca no Claude dele e pede, ao montar a ficha de atendimento de um
> cliente, que o Claude leia a conversa inteira, resuma, baixe os documentos,
> organize e renomeie a pasta do cliente e monte a ficha.
> **Ele é editado a cada fase**: ao INICIAR uma fase, registra-se aqui que a
> anterior foi concluída (objetivo, arquivos tocados, resultado medido).
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, consulta ao banco).

- **Criado:** 2026-11-04 · **Medido contra:** `origin/main` @ `2da1a9b0`
- **Fluxo por fase:** executar → `typecheck`/`lint`/`test`/`i18n-parity`/`i18n-chaves-usadas`
  → preview em 1440×900+ (Fase 1) → revisar 2× → PR → revisar ESTE plano antes da fase seguinte.
- **Regras a abrir pela Read antes de cada fase:** `.claude/rules/api-v1.md`,
  `.claude/rules/supabase.md` (Fase 1), `.claude/rules/perfis.md` (suspensão),
  `.claude/rules/automacoes-historico.md` (Fase 3), `.claude/rules/i18n.md`.

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | Chave: funcionário, funis, validade e "Só leitura" na tela; corte na suspensão; EDITAR a chave | ✅ pronto; 1121 aplicada; e2e OK no preview (04/11) | `1121` (aditiva) **APLICADA** 04/11 (`20261104223155`) | PR #459 |
| **2** | Recorte por funil nas rotas de leitura (chave recortada = default-deny) | ✅ pronto; `deals!inner` MEDIDO no PostgREST real (5.534 = SQL); e2e OK | não | idem |
| **3** | O que falta ler: nome do arquivo, transcrição do áudio, histórico de automações | ✅ pronto; e2e OK (arquivo baixado sem chave) | não | idem |
| **4** | Guia do Claude do funcionário (sem MCP) e o piloto com uma pessoa | 🟡 skill pronta (`docs/skill-ler-cliente/`), testada contra um servidor falso; falta o piloto com uma chave real | não | (a abrir) |

**Respostas do operador (04/11/2026):** D1 = 90 dias; D2 = aceita os dois
efeitos; D3 = recortada só leitura, e o ADMIN pode EDITAR a chave depois
(funis, validade, funcionário, permissões de leitura — não liberar escrita);
D4 = qualquer um dos dois (Claude Code ou Cowork). Pedido junto: "não mudar
as automações e APIs já existentes" — chave sem funcionário e sem funis segue
igual (nenhuma consulta a mais), e o contrato só GANHA campos.

**Depois da revisão independente (04/11/2026), mais duas respostas:** a chave
de FUNCIONÁRIO também é só leitura, com ou sem funil (a escrita sairia
assinada como o dono); e os 90 dias são o padrão SÓ com funcionário — a
chave de integração sugere "sem validade". A revisão achou 8 defeitos (o pior:
"Nova chave" reabria com o segredo da anterior), todos corrigidos, e o número
virou **1121** (a 1119 e a 1120 são dos PRs #457 e #458).

**Medido no banco:** nenhum anexo com endereço de proxy (`/api/…`, que exige
login); 714 anexos sem arquivo na Trabalhista - Comercial e 2.659 na
Trabalhista e Previdenciário - Jurídico (`media_url` nulo — o Claude não os
baixa; a doc diz).

**Medido na execução:** replay completo local (243 migrations + verify-schema)
verde; cenários da 1121 (reaplicar, lista vazia recusada, login apagado leva
a chave) verdes; suíte inteira verde (12.887 testes, Node 22).

**E2E no preview contra a produção (04/11/2026, com o "pode testar").** O
"TESTE Funil Trabalhista" é de OUTRA conta do banco (a 67610825) e o servidor
o recusaria. Com o operador, o teste foi feito no **Bancário - Comercial**,
onde está o card do lead de teste. Foi uma chave de teste do operador, só
leitura, com o segredo só na memória da página e só códigos e contagens
voltando ao chat. Resultado:
- **Formulário:**
  - sem funcionário, sugere "Sem validade"; com funcionário, muda para 90
    dias e avisa que é só leitura;
  - mostra só os 5 funis da conta;
  - "Só leitura" marca as 11 permissões de leitura e trava a escrita.
- **Com o recorte:**
  - `/me` diz o funil e o funcionário;
  - o lead aparece por busca e por id (200);
  - o cliente de outro funil dá 404 na ficha, nos campos, na conversa, nas
    mensagens e nas automações, e lista vazia nas anotações, cartões e
    conversas;
  - as listas sem `contact_id` dão 400;
  - `/channels` e a escrita (`POST /notes`) dão 403 `restricted_key`;
  - os 100 cartões da página são do funil.
- **Leitura:**
  - 100 mensagens com os campos novos, 17 com arquivo e as 17 com nome, e 3
    transcrições;
  - 31 execuções de automação (29 concluídas, 2 barradas);
  - um documento baixado do `media_url` sem chave: 57 KB, com o tipo e a
    extensão certos.
- **Tela:**
  - a lista mostra "Funcionário: … · Funis: …" e a data de vencimento;
  - "Nova chave" logo depois de criar abre o formulário vazio, sem o segredo.
- **Edição:**
  - tirar o funil manteve a validade, e o mesmo segredo continuou valendo;
  - com isso, `/channels` e o cliente de fora passaram a 200, e a escrita
    continuou 403 `forbidden` (só leitura de funcionário).
- **Revogar:** a linha ficou com o selo e sem botões, e `/me` passou a 401.
- **Banco depois:** a chave de teste revogada, as outras 17 intactas e
  nenhuma anotação criada. O servidor não registrou nenhum erro.

As fases 1 e 2 podem ir no MESMO PR: a chave recortada (Fase 1) sem a Fase 2
seria uma chave que diz "só o Trabalhista" e lê a conta inteira. Se forem
separadas, a Fase 1 recusa criar chave com funis até a Fase 2 estar no ar.

---

## Decisões do operador (2026-11-04)

1. **Piloto pela chave, SEM MCP.** Instalar e compilar o `mcp-server/` em cada
   computador é fricção demais. O Claude do funcionário chama a API direto.
2. **Chave só de leitura**, com **prazo de validade**.
3. **A chave pertence a um funcionário:** suspender ou remover o funcionário
   corta a chave na hora.
4. **Recorte por FUNIL** (não por conexão).
5. **Sem registro das chamadas por enquanto** (só o "último uso" que já existe).

## Julgamentos deste plano (a confirmar na revisão do operador)

- **Chave recortada é obrigatoriamente só de leitura.** Escrever com recorte
  exigiria recortar cada escrita (criar contato fora do funil? mover o card
  para fora?). Formulário e servidor recusam escopo `:write`/`messages:send`
  quando há funis.
- **Fora do recorte = 404, nunca 403.** O 403 contaria que o cliente existe.
- **Chave sem funcionário e sem funis continua exatamente como hoje** (n8n,
  Make, iMotion). Nada muda para quem já integra.
- **Login apagado apaga a chave** (`ON DELETE CASCADE`): a chave é credencial
  da pessoa. Com `SET NULL`, ela viraria chave da conta inteira (falha ABERTA).

---

## Fase 1 — A chave

### Medido

- `api_keys.expires_at` já existe e é respeitado (`findActiveKeyByHash` trata
  vencida como inexistente → 401). `POST /api/account/api-keys` já aceita
  `expiresInDays` (teto 365), e a lista já mostra "expira em". **O formulário
  (`api-keys-settings.tsx`) não envia o campo**: toda chave nasce sem prazo.
- `last_used_at` é o único rastro de uso.
- Suspensão = `profiles.suspenso_em` (1067). ⚠️ O corte da 1067 mora em
  `is_account_member`, que a API NÃO usa (roda em service role): a chave só
  herda o corte se `requireApiKey` conferir o perfil por conta própria
  (`perfis.md`: "rota que descobrir o chamador por outro caminho NÃO herda").
- Remover da equipe (`remove_account_member`) MOVE o perfil para uma conta
  própria nova; o login continua existindo. A conferência pelo perfil NA
  conta da chave cobre a suspensão e a remoção.
- `verify-schema.sql` reprova CASCADE para `auth.users` fora da lista de
  "dado da pessoa" (1116): `api_keys` entra na lista, com o motivo.

### O que muda

- **Migration aditiva** `NNNN_cb_chave_por_funcionario.sql` (número = maior do
  `main` + 1 no dia; ficou 1121, porque a 1119 e a 1120 são dos PRs #457 e #458):
  - `api_keys.membro_user_id uuid NULL REFERENCES auth.users ON DELETE CASCADE`
    (nulo = chave da conta, como hoje);
  - `api_keys.funis uuid[] NULL` (nulo = todos), com CHECK de que não é lista
    VAZIA: aqui vazio não pode significar "todos" nem "nenhum" por acidente;
  - `supabase/ci/verify-schema.sql`: `api_keys` na lista do dado da pessoa.
  - Aplicar ANTES do deploy (aditiva).
- **`findActiveKeyByHash`** lê as duas colunas; **`requireApiKey`**, quando há
  `membro_user_id`, confere `profiles` (mesmo `user_id`, mesma `account_id`,
  `suspenso_em` nulo). Ausente ou suspenso → 401, igual a revogada. Leitura
  que falha → 500 (regra da v1). Só chave de funcionário paga essa consulta.
  `ApiKeyContext` ganha `membroUserId` e `funis`.
- **`POST /api/account/api-keys`** aceita `membroUserId` (membro da conta) e
  `funis` (funis da conta; id de outra conta = 400). Com funis, recusa escopo
  de escrita.
- **Tela (Configurações → API → Chaves):** no formulário, "Validade" (30, 90,
  180, 365 dias ou sem prazo), "Funcionário" (opcional), "Funis" (opcional,
  vários) e o botão "Só leitura" que marca os escopos `:read`. Na lista, o
  funcionário e os funis de cada chave. Chaves novas nos dois dicionários.
- **`GET /api/v1/me`** devolve o funcionário e os funis da chave: é como o
  Claude do funcionário sabe o que pode ver.

## Fase 2 — O recorte por funil

### Medido

- Um card por cliente (911), que transita entre funis: "o cliente está no
  funil" = `deals.pipeline_id` do card dele.
- Uma conversa por cliente (`idx_conversations_account_contact`): o recorte
  pelo cliente leva a conversa inteira. (Por conexão seria ambíguo: a mesma
  conversa mistura mensagens de números diferentes.)

### O que muda

- **Default-deny:** `requireApiKey(request, scope, { aceitaRecorte: true })`.
  Chave com funis em rota que não declara recusa com 403 `restricted_key`.
  Pino `*.chamadores.test.ts` listando as rotas que declaram, para rota nova
  ser decisão visível no diff.
- **Rotas que aceitam, e como recortam:**
  - `GET /contacts` (lista e busca): só quem tem card nos funis. Forma nova de
    consulta (`deals!inner` ou lista de ids paginada): **medir contra o
    PostgREST real** antes de escolher (CLAUDE.md, 8b).
  - `GET /contacts/{id}`, `GET /contacts/{id}/custom-fields`, `GET /notes`,
    `GET /tasks`, `GET /tasks/{id}`: o contato precisa estar no recorte. As
    listas (`/notes`, `/tasks`) EXIGEM `contact_id` da chave recortada (400
    sem ele): sem o filtro, listariam a conta inteira.
  - Id de ficha unida (1092) resolve para a ficha de hoje ANTES do recorte: o
    recorte vale para a ficha que ficou.
  - `GET /conversations`, `/conversations/{id}`, `/conversations/{id}/messages`:
    o contato da conversa precisa estar no recorte.
  - `GET /deals`, `GET /deals/{id}`, `GET /pipelines`: só os funis da chave.
  - `GET /me` e a rota nova da Fase 3.
  - Todo o resto (reuniões, agendadas, webhooks, disparos, canais, etiquetas
    do catálogo, escritas): recusa.
- **Efeitos a aceitar** (dizer na doc): cliente sem card não aparece; quando o
  card sai para um funil fora da lista, a chave perde o cliente na hora.

## Fase 3 — O que falta ler

- **Mensagem (`serializeMessage`):** `media_filename` (por `mediaFilename()`,
  que recupera o nome dos documentos antigos), `media_type` e `transcricao`
  (só `content_type === 'audio'` com a transcrição pronta). Campos NOVOS, sem
  tirar nenhum: compatível com quem já integra.
- **Histórico de automações do cliente:** rota nova (ex.:
  `GET /api/v1/contacts/{id}/automation-runs`) com escopo novo
  `automations:read`, em par (regra da v1). Fonte: `automation_logs` e o
  detalhe de `src/lib/execucoes/detalhe*`: qual automação, quando começou e
  terminou, o desfecho (inclusive interrompida) e os passos que rodaram. O
  `context` da fila nunca vai para a resposta (`automacoes-historico.md`).
- **Doc no mesmo PR:** `docs/public-api.md` e a aba Documentação.

## Fase 4 — O Claude do funcionário (sem MCP)

- **O Claude precisa rodar no computador** para baixar e renomear arquivos:
  - **Claude Code**: chama a API e grava arquivos. Funciona.
  - **Modo Cowork do app**: **medir** se o ambiente dele alcança
    `crm.cbadvogados.com` antes de escolher.
- **A chave fica no arquivo `~/.crm-api-key`** (ou em `CRM_API_KEY`), gravado
  pela pessoa fora do Claude e nunca colado na conversa: o que se cola fica no
  histórico do Claude.
- **Feito (04/11/2026):** a skill `ler-cliente-do-crm` em
  `docs/skill-ler-cliente/` (`SKILL.md`, `LEIA-ME.md`,
  `exportar_cliente.py`, `config.json`). O que ela faz:
  - **O script** (Python 3.8+, sem instalar nada) acha o cliente e grava a
    pasta dele: `conversa.md` em ordem, com a transcrição dos áudios;
    `resumo-do-crm.md`; `originais/`; e `arquivos.json`, com o `dia` já no
    horário de Brasília.
  - **Rodar de novo** baixa só o que é novo e acha a mesma pasta, mesmo
    renomeada. Campo com "senha" no nome fica de fora.
  - **O Claude** copia os documentos para `documentos/` com o nome
    `<Tipo>_<AAAA-MM-DD>[_<nome original>]`, que é o padrão do operador: a
    data é o dia em que o arquivo chegou, e o nome original só entra quando
    diz algo além do tipo. Depois ele resume a conversa e preenche a ficha.
  - **Testado contra um servidor falso** (dados fictícios): paginação, 429,
    fração de segundo de 1 a 6 dígitos, a mensagem das 22h50, a homônima,
    permissão faltando, a chave fora de todo arquivo e a mídia sem a chave.
- **Fora do repositório:** o pacote do escritório leva o mesmo conteúdo, o
  `config.json` com o endereço, o `modelo-da-ficha.md` do Trabalhista
  (proposta, a ajustar pelo operador) e o `tipos-de-documento.md`.
- **Piloto:** uma pessoa, uma chave com 30 dias, um cliente de teste; depois
  conferir a suspensão cortando a chave na hora. A pasta dos clientes no
  computador dela fica para o piloto: o Claude pergunta na primeira vez.

## Riscos

- ⚠️ **O que foi baixado fica no computador.** Suspender ou revogar a chave
  corta o acesso NOVO, não apaga as cópias. E os buckets de mídia são
  públicos: um link de arquivo que o funcionário já tem continua abrindo
  (`perfis.md`).
- **O conteúdo das conversas vai para o Claude** de cada funcionário.
  Decisão do escritório sobre sigilo e LGPD: conferir os termos do plano do
  Claude que cada funcionário usa (conta pessoal × plano da empresa).
- **Limite de 120 chamadas por minuto por chave** (`RATE_LIMITS.publicApi`).
  Uma conversa longa lida de 100 em 100 cabe, mas o guia não deve ler em laço
  sem pausa.
- **Banco perto do teto de conexões:** a conferência do funcionário é uma
  consulta a mais por chamada, só nas chaves de funcionário.

## Decisões em aberto

- **D1.** Validade padrão no formulário (sugestão: 90 dias).
- **D2.** Aceitar os dois efeitos do recorte: cliente sem card fica invisível,
  e o card que sai do funil some para a chave.
- **D3.** Chave recortada sempre só de leitura (julgamento acima).
- **D4.** Qual Claude: o operador respondeu "qualquer um dos dois". A skill
  nasce para o Claude Code. O Cowork não foi medido.
- **D5.** Onde mora o guia: RESPONDIDO. A parte genérica fica no repositório
  (`docs/skill-ler-cliente/`); o modelo da ficha do Trabalhista é do
  escritório e fica fora dele.
