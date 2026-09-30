import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    // Os campos do contato entram aqui porque a interpolação de
    // `{{contact.*}}` lê a MESMA tabela pela qual o motor confere posse.
    owned: null as {
      id: string;
      name?: string;
      phone?: string | null;
      email?: string;
      company?: string;
      /** O BSUID de quem a Meta identifica só pelo nome de usuário (Fase 11.3). */
      wa_user_id?: string | null;
    } | null,
    ownedCustomField: null as { id: string; field_type?: string } | null,
    pipeline: null as { id: string } | null,
    stage: null as { id?: string; resultado?: string | null } | null,
    dealExistente: null as { id: string; stage_id?: string } | null,
    /**
     * Preenchido, a leitura de `deals` responde PELO STATUS pedido (`.eq('status', …)`)
     * — é como se encena "sem card aberto, com um perdido" (1031).
     */
    dealPorStatus: null as Record<string, { id: string; stage_id?: string } | null> | null,
    /** As chamadas a `cb_atualizar_negocio` (mover card / marcar status). */
    rpcMover: [] as Record<string, unknown>[],
    /** Roda depois de cada `cb_atualizar_negocio` — encena o card mudando de status no meio da execução. */
    depoisDeMover: null as null | (() => void),
    /** Preenchido, `cb_atualizar_negocio` RECUSA com este motivo (a guarda do status esperado, 1031). */
    rpcMoverRecusa: null as string | null,
    /** O status que `cb_atualizar_negocio` devolve como gravado (o motor o fixa no contexto, 1031). */
    rpcStatusGravado: 'open' as string,
    /** Campos a mais da conversa lida por id (a pausa da IA que o `set_ai` lê). */
    conversaLida: {} as Record<string, unknown>,
    /** A conexão que "Fixar a conversa no número" acha em `cb_channels` (só pela conta `acct-1`). */
    canalDaConta: null as { id: string; label: string; kind: string } | null,
    /** Preenchido, a LEITURA de `deals` devolve este erro (18/09). */
    erroNoNegocio: null as string | null,
    /**
     * Movimentos do card POSTERIORES ao evento da execução (a fila
     * `cb_automation_events`): não vazio = a estadia na etapa acabou.
     */
    movimentosDepois: [] as Record<string, unknown>[],
    /** Uma resposta POR CHAMADA à fila de eventos (`'erro'` = a leitura falha); esgotada, vale `movimentosDepois`. */
    movimentosPorChamada: null as (Record<string, unknown>[] | 'erro')[] | null,
    /** Preenchido, TODA leitura da fila de eventos devolve este erro. */
    erroNosMovimentos: null as string | null,
    /** O último movimento conhecido do contato — a âncora da estadia manual (consulta SEM `gt`). */
    ultimoMovimento: null as { criado_em: string } | null,
    /** As conversas do contato (a segunda linha de defesa do "parar se responder" lê por aqui). Vazio = `null`, como antes. */
    conversasDoContato: [] as { id: string }[],
    /**
     * De QUAL conta é cada conversa, para a conferência de posse por id
     * (upstream #589). Ausente = da conta dos testes (`acct-1`).
     */
    contaDaConversa: {} as Record<string, string>,
    /** De QUAL contato é cada conversa (Codex, 3ª rodada do #261). Ausente = de qualquer um. */
    contatoDaConversa: {} as Record<string, string>,
    /**
     * `conversations.assigned_agent_id` (id de LOGIN) — o "responsável pela
     * conversa" do `create_task` (Fase 2.4). `undefined` = o contato não tem
     * conversa (a leitura volta sem linha).
     */
    responsavelDaConversa: undefined as string | null | undefined,
    /**
     * A condição por campo personalizado (Fase 2.10): o valor que o contato
     * tem no campo (`undefined` = sem linha em `contact_custom_values`), um
     * erro nas leituras, e os filtros com que o campo foi lido.
     */
    valorDoCampo: undefined as string | null | undefined,
    erroNaCondicaoDoCampo: null as string | null,
    leiturasDoCampo: [] as [string, string, unknown][][],
    /** A linha que a condição da janela de 24h lê (Fase 2.8). `null` = sem linha. */
    conversaDaJanela: null as { group_id: string | null; janela_meta: Record<string, string> | null } | null,
    /** Mensagens do CLIENTE gravadas depois de a espera ser estacionada. */
    respostasDesde: [] as { id: string }[],
    erroNasRespostas: null as string | null,
    /** Status gravados na fila (`markPending`), na ordem. */
    statusDaFila: [] as unknown[],
    /**
     * A MARCA durável da execução (`automation_logs.interrompida_em`, 1005) —
     * o que a retomada e o estacionamento (`cb_estacionar_espera`) consultam.
     */
    interrompida: false,
    /** Registros marcados DURANTE o teste (pelos filtros do UPDATE) — o mock responde a marca por REGISTRO. */
    logMarcados: new Set<string>(),
    dealSelects: [] as [string, string, unknown][][],
    dealInserts: [] as Record<string, unknown>[],
    automations: [] as Record<string, unknown>[],
    /**
     * Preenchido, a consulta de automações responde PELO GATILHO pedido
     * (`.eq('trigger_type', …)`) — é como se encena um disparo ANINHADO
     * (o `tag_added` do passo "Adicionar etiqueta") com outra automação.
     */
    automacoesPorGatilho: null as Record<string, Record<string, unknown>[]> | null,
    /** Preenchido, a consulta de automações DESTE gatilho devolve o erro. */
    erroPorGatilho: {} as Record<string, string>,
    steps: [] as Record<string, unknown>[],
    /**
     * Os passos que a GRAVAÇÃO do construtor apagou (`replaceSteps`), com a
     * CASCADE dos ramos — é por eles que o teste encena a FK `ON DELETE SET
     * NULL` de `automation_pending_executions.parent_step_id`.
     */
    passosApagados: new Set<string>(),
    /** Liga o recorte dos passos por `automation_id` (duas automações no mesmo teste). */
    passosPorAutomacao: false,
    /** A etiqueta que a conferência de posse de `addContactTagIfAbsent` acha em `tags`. */
    tagDaConta: null as { id: string } | null,
    fromCalls: [] as string[],
    updateCalls: [] as {
      table: string;
      filters: [string, string, unknown][];
      payload?: unknown;
    }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    logInserts: [] as Record<string, unknown>[],
    logUpdates: [] as Record<string, unknown>[],
    /** Filtros de cada update em `automation_logs` — a cerca de não-regressão. */
    updateFiltros: [] as [string, string, unknown][][],
    historicoDoLog: [] as Array<Record<string, unknown>>,
    taskInserts: [] as Record<string, unknown>[],
    /** O que o motor mandou para a fila — o "Aguardar" e a retentativa. */
    esperasEnfileiradas: [] as Record<string, unknown>[],
    /** Preenchido, a fila RECUSA o insert com esta mensagem (18/09). */
    erroNaFila: null as string | null,
    notifInserts: [] as Record<string, unknown>[],
    // Valores de campo personalizado do contato, como o PostgREST os entrega
    // (com a definição embutida) — é por eles que a interpolação de
    // `{{contact.campo.*}}` passa.
    customValues: [] as Record<string, unknown>[],
    /** O catálogo de campos da conta que o passo do Atlas confere (`field_key, field_type`). */
    catalogoDeCampos: [] as { field_key: string; field_type: string }[],
    erroNoCatalogoDeCampos: null as string | null,
    /** Preenchido, a leitura dos valores do contato (`contact_custom_values`, lista) devolve este erro. */
    erroNosValoresDoContato: null as string | null,
    // A guarda de `fecharLog` (985) pergunta se sobrou espera VIVA deste log.
    // Vazio = nenhuma, que é o caso da maioria dos testes.
    esperasVivas: [] as Record<string, unknown>[],
    membros: [
      {
        user_id: 'agente-fallback',
        full_name: 'Agente Um',
        email: 'um@cb.test',
      },
    ] as Record<string, unknown>[],
  },
}));

vi.mock('./admin-client', () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
    recorte?: [string, string, unknown][];
    limite?: number;
    colunas: string;
    /** `.single()`/`.maybeSingle()` — UMA linha, como o PostgREST. */
    unico?: boolean;
  }) {
    const { table, type } = ops;
    if (table === 'contacts') {
      if (type === 'update') {
        state.updateCalls.push({ table, filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === 'conversations') {
      // O passo assign_conversation escreve aqui, e QUAIS filtros ele usa é
      // justamente o que se quer observar (a conversa do disparo vs. todas as
      // do contato).
      if (type === 'update') {
        state.updateCalls.push({ table, filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      // As duas leituras da Fase 2 do previdenciário, pelo que PEDEM: o
      // responsável da conversa (`create_task`) e a janela da Meta (condição).
      if (/\bassigned_agent_id\b/.test(ops.colunas)) {
        return {
          data:
            state.responsavelDaConversa === undefined
              ? null
              : { assigned_agent_id: state.responsavelDaConversa },
          error: null,
        };
      }
      if (/\bjanela_meta\b/.test(ops.colunas)) {
        return { data: state.conversaDaJanela, error: null };
      }
      // Leitura POR ID = a conferência de posse (upstream #589): a linha só
      // vem quando o filtro de conta casa com a dona — a leitura que esquecer
      // o `account_id` enxerga a conversa alheia, e o teste vê isso.
      const porId = ops.filters.find(([op, k]) => op === 'eq' && k === 'id');
      if (porId) {
        const dona = state.contaDaConversa[String(porId[2])] ?? 'acct-1';
        const conta = ops.filters.find(([op, k]) => op === 'eq' && k === 'account_id');
        const donoContato = state.contatoDaConversa[String(porId[2])];
        const contato = ops.filters.find(([op, k]) => op === 'eq' && k === 'contact_id');
        const casaConta = !conta || conta[2] === dona;
        const casaContato = !contato || donoContato === undefined || contato[2] === donoContato;
        return { data: casaConta && casaContato ? { id: porId[2], ...state.conversaLida } : null, error: null };
      }
      // Leitura de UMA linha pelo contato (`resolveConversationId` sem
      // conversa no contexto): a primeira da lista, como o `maybeSingle`.
      if (ops.unico) return { data: state.conversasDoContato[0] ?? null, error: null };
      return { data: state.conversasDoContato.length > 0 ? state.conversasDoContato : null, error: null };
    }
    if (table === 'messages') {
      if (state.erroNasRespostas) return { data: null, error: { message: state.erroNasRespostas } };
      return { data: state.respostasDesde, error: null };
    }
    if (table === 'profiles') {
      // round_robin resolve um membro da conta por aqui; `create_task` usa a
      // MESMA consulta para provar que o responsável é membro e para carimbar
      // o nome dele na tarefa.
      // Leitura de UM perfil (o atendente fixo do assign_conversation, 1067):
      // o membro pelo `user_id` do filtro, ou nada.
      if (ops.unico) {
        const alvo = ops.filters.find(([op, k]) => op === 'eq' && k === 'user_id')?.[2];
        return { data: state.membros.find((m) => m.user_id === alvo) ?? null, error: null };
      }
      return { data: state.membros, error: null };
    }
    if (table === 'custom_fields') {
      // O passo do Atlas confere os campos de data escolhidos no CATÁLOGO da
      // conta (lista por `field_key`), com a conta no filtro.
      if (ops.colunas === 'field_key, field_type') {
        if (state.erroNoCatalogoDeCampos) return { data: null, error: { message: state.erroNoCatalogoDeCampos } };
        const pediuConta = ops.filters.some(([op, k, v]) => op === 'eq' && k === 'account_id' && v === ACCOUNT);
        const chaves = (ops.filters.find(([op, k]) => op === 'in' && k === 'field_key')?.[2] ?? []) as string[];
        return { data: pediuConta ? state.catalogoDeCampos.filter((c) => chaves.includes(c.field_key)) : [], error: null };
      }
      // A condição por campo (2.10) lê SÓ o tipo — e a conta tem de estar no
      // filtro: sem ela, o campo de outra conta viraria oráculo.
      if (ops.colunas === 'field_type') {
        state.leiturasDoCampo.push(ops.filters);
        if (state.erroNaCondicaoDoCampo) return { data: null, error: { message: state.erroNaCondicaoDoCampo } };
        const f = state.ownedCustomField;
        const pediuConta = ops.filters.some(([op, k, v]) => op === 'eq' && k === 'account_id' && v === 'acct-1');
        return { data: f && pediuConta ? { field_type: f.field_type ?? 'text' } : null, error: null };
      }
      // account-scoped ownership lookup for a custom field definition
      // `field_type` só volta quando a consulta o PEDE, como no PostgREST:
      // tirá-lo do select desliga a forma canônica da data sem erro nenhum.
      const f = state.ownedCustomField;
      if (!f) return { data: null, error: null };
      const pediuTipo = /\bfield_type\b/.test(ops.colunas);
      return {
        data: { id: f.id, ...(pediuTipo ? { field_type: f.field_type } : {}) },
        error: null,
      };
    }
    if (table === 'contact_custom_values') {
      if (type === 'select' && ops.colunas === 'value') {
        if (state.erroNaCondicaoDoCampo) return { data: null, error: { message: state.erroNaCondicaoDoCampo } };
        return { data: state.valorDoCampo === undefined ? null : { value: state.valorDoCampo }, error: null };
      }
      if (type === 'upsert') {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      if (state.erroNosValoresDoContato) {
        return { data: null, error: { message: state.erroNosValoresDoContato } };
      }
      return { data: state.customValues, error: null };
    }
    if (table === 'cb_automation_events') {
      if (state.erroNosMovimentos) return { data: null, error: { message: state.erroNosMovimentos } };
      if (!ops.filters.some(([op]) => op === 'gt')) {
        return { data: state.ultimoMovimento ? [state.ultimoMovimento] : [], error: null };
      }
      const proximo = state.movimentosPorChamada?.shift();
      if (proximo === 'erro') return { data: null, error: { message: 'fila de eventos fora do ar' } };
      return { data: proximo ?? state.movimentosDepois, error: null };
    }
    if (table === 'cb_channels') {
      // A conexão só volta quando o filtro de CONTA casa: a leitura que o
      // esquecer enxergaria a conexão de outra conta, e o teste vê isso.
      const conta = ops.filters.find(([op, k]) => op === 'eq' && k === 'account_id')?.[2];
      const id = ops.filters.find(([op, k]) => op === 'eq' && k === 'id')?.[2];
      const c = state.canalDaConta;
      return { data: c && conta === 'acct-1' && id === c.id ? c : null, error: null };
    }
    if (table === 'pipelines') return { data: state.pipeline, error: null };
    if (table === 'pipeline_stages') return { data: state.stage, error: null };
    if (table === 'deals') {
      if (type === 'insert') {
        state.dealInserts.push(ops.payload as Record<string, unknown>);
        return {
          data: { id: 'd-novo', ...(ops.payload as Record<string, unknown>) },
          error: null,
        };
      }
      state.dealSelects.push(ops.filters);
      if (state.erroNoNegocio) {
        return { data: null, error: { message: state.erroNoNegocio } };
      }
      // A lista dos abertos do contato (`estadiaSemEvento`, limit > 1) vs. a
      // linha única de todos os outros leitores.
      if ((ops.limite ?? 0) > 1) {
        return { data: state.dealExistente ? [state.dealExistente] : [], error: null };
      }
      if (state.dealPorStatus) {
        const status = ops.filters.find(([op, k]) => op === 'eq' && k === 'status')?.[2];
        if (typeof status === 'string') return { data: state.dealPorStatus[status] ?? null, error: null };
        // Leitura POR ID (o status do card que o "Mover" vai mexer): devolve o
        // card com o status da chave em que ele está.
        const id = ops.filters.find(([op, k]) => op === 'eq' && k === 'id')?.[2];
        const achado = Object.entries(state.dealPorStatus).find(([, d]) => d?.id === id);
        return { data: achado ? { ...achado[1], status: achado[0] } : null, error: null };
      }
      return { data: state.dealExistente, error: null };
    }
    if (table === 'automation_pending_executions') {
      if (type === 'insert') {
        // O Supabase DEVOLVE o erro, não lança — é por isso que um insert
        // não conferido falha em silêncio.
        if (state.erroNaFila) {
          return { data: null, error: { message: state.erroNaFila } };
        }
        state.esperasEnfileiradas.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (type === 'update') {
        state.statusDaFila.push((ops.payload as { status?: unknown })?.status);
        // Registrado também em `updateCalls`, com os filtros: é como o pino do
        // `stop_automation` confere as cercas da varredura.
        state.updateCalls.push({ table, filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      if (type === 'select') {
        // ⚠️ Respeita o `.neq('id', …)`: é ele que faz a guarda de `fecharLog`
        // ignorar a espera que o cron está processando AGORA. Sem isto o mock
        // devolveria a própria espera em curso e o pino do resume passaria
        // por um motivo errado.
        const excluido = ops.filters.find(
          ([op, k]) => op === 'neq' && k === 'id'
        )?.[2];
        const vivas = excluido
          ? state.esperasVivas.filter((e) => e.id !== excluido)
          : state.esperasVivas;
        return { data: vivas, error: null };
      }
      return { data: null, error: null };
    }
    if (table === 'cb_tasks') {
      if (type === 'insert') {
        state.taskInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: 't-1' }, error: null };
      }
      return { data: null, error: null };
    }
    if (table === 'notifications') {
      if (type === 'insert') {
        state.notifInserts.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === 'automations') {
      // ⚠️ Consulta POR ID (o resume e o `run_automation`) espera UM objeto —
      // `.single()`. Devolver a lista fazia `automation.is_active` ser
      // `undefined`, e o resume desistia achando a automação desligada: o
      // pino do desfecho pós-espera reprovava por um motivo que não era o dele.
      const porId = ops.filters.find(
        ([op, k]) => op === 'eq' && k === 'id'
      )?.[2];
      if (porId) {
        return {
          data: state.automations.find((a) => a.id === porId) ?? null,
          error: null,
        };
      }
      if (state.automacoesPorGatilho) {
        const gatilho = String(ops.filters.find(([op, k]) => op === 'eq' && k === 'trigger_type')?.[2]);
        if (state.erroPorGatilho[gatilho]) return { data: null, error: { message: state.erroPorGatilho[gatilho] } };
        const soLigadas = ops.filters.some(([op, k, v]) => op === 'eq' && k === 'is_active' && v === true);
        const lista = state.automacoesPorGatilho[gatilho] ?? [];
        return { data: soLigadas ? lista.filter((a) => a.is_active === true) : lista, error: null };
      }
      return { data: state.automations, error: null };
    }
    if (table === 'tags') return { data: state.tagDaConta, error: null };
    if (table === 'automation_logs') {
      if (type === 'insert') {
        state.logInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: 'log1' }, error: null };
      }
      if (type === 'update') {
        state.logUpdates.push(ops.payload as Record<string, unknown>);
        state.updateFiltros.push([...ops.filters]);
        if ('interrompida_por' in (ops.payload as Record<string, unknown>)) {
          const alvo = ops.filters.find(([op, k]) => (op === 'in' || op === 'eq') && k === 'id')?.[2];
          for (const id of Array.isArray(alvo) ? alvo : [alvo]) {
            if (typeof id === 'string') state.logMarcados.add(id);
          }
        }
        // Uma linha de volta: a anotação de interrupção grava com cerca
        // ("ninguém acrescentou desde que li") e lê o RETURNING para saber se
        // venceu. Os demais updates ignoram o retorno.
        return { data: [{ id: 'log1' }], error: null };
      }
      // ⚠️ O que já estava GRAVADO em `steps_executed` antes desta chamada.
      // Configurável porque é a única forma de encenar uma execução que
      // atravessou um "Aguardar": a retomada é um processo novo, e o que
      // aconteceu antes da espera só existe nesta coluna.
      return {
        data: {
          steps_executed: state.historicoDoLog,
          status: 'success',
          // A marca da 1005, lida pela retomada, por `fecharLog` e antes de
          // cada passo. Vale a flag do teste OU uma marca escrita DURANTE a
          // execução (os caminhos de erro marcam e depois o fim do escopo
          // relê) — sem isto o mock afirmava "não marcada" sobre execução que
          // o próprio motor acabou de marcar.
          interrompida_em:
            state.interrompida ||
            state.logMarcados.has(
              String(ops.filters.find(([op, k]) => op === 'eq' && k === 'id')?.[2])
            )
              ? '2026-09-18T12:00:00Z'
              : null,
        },
        error: null,
      };
    }
    if (table === 'automation_steps') {
      // A GRAVAÇÃO do construtor (`replaceSteps`, 26/09/2026): o upsert por
      // `id` e o DELETE dos que saíram, com a CASCADE da FK dos ramos.
      if (type === 'upsert') {
        for (const linha of ops.payload as Record<string, unknown>[]) {
          const i = state.steps.findIndex((p) => p.id === linha.id);
          if (i >= 0) state.steps[i] = { ...state.steps[i], ...linha };
          else state.steps.push({ ...linha });
        }
        return { data: null, error: null };
      }
      if (type === 'delete') {
        const conta = ops.filters.find(([op, k]) => op === 'eq' && k === 'automation_id')?.[2];
        const fora = String(
          ops.filters.find(([op, k]) => op === 'not.in' && k === 'id')?.[2] ?? '()'
        )
          .slice(1, -1)
          .split(',')
          .filter(Boolean);
        const apagados = new Set(
          state.steps
            .filter((p) => p.automation_id === conta && !fora.includes(String(p.id)))
            .map((p) => String(p.id))
        );
        let cresceu = true;
        while (cresceu) {
          cresceu = false;
          for (const p of state.steps) {
            if (p.parent_step_id && apagados.has(String(p.parent_step_id)) && !apagados.has(String(p.id))) {
              apagados.add(String(p.id));
              cresceu = true;
            }
          }
        }
        state.steps = state.steps.filter((p) => !apagados.has(String(p.id)));
        for (const id of apagados) state.passosApagados.add(id);
        return { data: null, error: null };
      }
      // Recorte por ESCOPO (parent_step_id / branch / position), para os
      // testes de ramo e espera: sem ele a consulta do ramo devolvia a lista
      // inteira — inclusive a própria condição, em recursão infinita. Passo
      // sem a coluna (helpers antigos) conta como escopo de fora, posição 0.
      let lista = state.steps;
      for (const [op, k, v] of [...ops.filters, ...(ops.recorte ?? [])]) {
        if (k === 'automation_id') {
          if (state.passosPorAutomacao && op === 'eq') lista = lista.filter((s) => s[k] === v);
          continue;
        }
        if (op === 'is' && v === null)
          lista = lista.filter((s) => s[k] == null);
        else if (op === 'eq') lista = lista.filter((s) => (s[k] ?? null) === v);
        else if (op === 'in') lista = lista.filter((s) => (v as unknown[]).includes(s[k]));
        else if (op === 'gte')
          lista = lista.filter(
            (s) => s[k] === undefined || Number(s[k]) >= Number(v)
          );
      }
      // A conferência da retomada (`retomada.ts`) procura UM passo por id.
      if (ops.unico) return { data: lista[0] ?? null, error: null };
      return { data: lista, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select',
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
      recorte: [] as [string, string, unknown][],
      limite: 0 as number,
      colunas: '',
    };
    const b: Record<string, unknown> = {
      select: (c?: string) => ((ops.colunas = c ?? ''), b),
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      delete: () => ((ops.type = 'delete'), b),
      upsert: (p: unknown) => ((ops.type = 'upsert'), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(['eq', k, v]), b),
      // `create_task` pergunta pelos DOIS perfis (autor e responsável) numa
      // consulta só — é ela que prova que o responsável é da conta.
      in: (k: string, v: unknown) => (ops.filters.push(['in', k, v]), b),
      // A guarda de `fecharLog` exclui a espera em curso com `.neq('id', …)`.
      neq: (k: string, v: unknown) => (ops.filters.push(['neq', k, v]), b),
      not: (k: string, o: string, v: unknown) => (
        ops.filters.push([`not.${o}`, k, v]), b
      ),
      // `fecharLog` usa `.or('desfecho.is.null,desfecho.neq.falhou')` para
      // NUNCA REGREDIR um 'falhou' já gravado. O mock só registra: o que os
      // pinos medem é o payload do update, não o filtro do PostgREST.
      or: (expr: string) => (ops.filters.push(['or', 'expr', expr]), b),
      gte: (k: string, v: unknown) => (ops.recorte.push(['gte', k, v]), b),
      gt: (k: string, v: unknown) => (ops.filters.push(['gt', k, v]), b),
      is: (k: string, v: unknown) => (ops.recorte.push(['is', k, v]), b),
      order: () => b,
      limit: (n: number) => ((ops.limite = n), b),
      single: () => Promise.resolve(resolve({ ...ops, unico: true })),
      maybeSingle: () => Promise.resolve(resolve({ ...ops, unico: true })),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      // `cb_estacionar_espera` (1005) é a ÚNICA porta da fila pelo motor:
      // registra o que foi mandado, recusa (null) com a execução marcada e
      // devolve erro quando a fila recusa a linha.
      rpc: (nome: string, args?: Record<string, unknown>) => {
        if (nome === 'cb_estacionar_espera') {
          if (state.erroNaFila) {
            return Promise.resolve({
              data: null,
              error: { message: state.erroNaFila },
            });
          }
          if (state.interrompida || state.logMarcados.has(String(args?.log_id))) {
            return Promise.resolve({ data: null, error: null });
          }
          state.esperasEnfileiradas.push(args ?? {});
          return Promise.resolve({ data: 'espera-nova', error: null });
        }
        if (nome === 'cb_atualizar_negocio') {
          state.rpcMover.push(args ?? {});
          if (state.rpcMoverRecusa) {
            return Promise.resolve({ data: [{ ok: false, motivo: state.rpcMoverRecusa }], error: null });
          }
          state.depoisDeMover?.();
          return Promise.resolve({
            data: [{ ok: true, motivo: null, status_gravado: state.rpcStatusGravado }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
});

import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client';
import { MetaApiError } from '@/lib/whatsapp/meta-api';

vi.mock('./meta-send', () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
}));

// `send_to_number` (977): a ficha/conversa do número avisado e a conferência
// da conexão são mockadas — o que se testa aqui é o que chega ao sender e a
// regra de falhar FECHADO quando a conexão pedida não resolve.
const destinatarioMock = vi.hoisted(() => ({
  resolverDestinatario: vi.fn(async () => ({
    contactId: 'equipe-1',
    conversationId: 'conv-equipe',
    criouContato: false,
  })),
  // A conversa que os passos de envio criam para a ficha SEM conversa
  // (27/09/2026) — o que ela grava (encerrada, dono da conta) é testado em
  // `destinatario.test.ts`; aqui, com o quê o motor a chama.
  conversaDoContato: vi.fn(async () => 'conv-criada'),
}));
vi.mock('./destinatario', () => destinatarioMock);
const canalMock = vi.hoisted(() => ({
  resolveEngineChannelPreferring: vi.fn(
    async (
      _db: unknown,
      _acc: string,
      _conv: string,
      preferido: string | null | undefined
    ) => ({
      channelId: preferido ?? 'ch-padrao',
    })
  ),
}));
vi.mock('@/lib/cb-channels/engine-send', () => canalMock);
// "Criar cliente no Atlas": o I/O (chave, busca, criar, reativar, vínculo) é
// testado em `src/lib/atlas/criar-cliente.test.ts`; aqui, a ENTRADA que o
// motor monta e o que ele faz com o resultado e com a falha.
const atlasMock = vi.hoisted(() => ({
  criarOuReativarNoAtlas: vi.fn<(admin: unknown, entrada: Record<string, unknown>) => Promise<unknown>>(
    async () => ({ acao: 'criado', atlasClientId: 'atl-1' })
  ),
}));
vi.mock('@/lib/atlas/criar-cliente', async (original) => ({
  ...(await original<typeof import('@/lib/atlas/criar-cliente')>()),
  criarOuReativarNoAtlas: atlasMock.criarOuReativarNoAtlas,
}));

import {
  dispararAutomacoes,
  resumePendingExecution,
  runAutomationsForTrigger,
  triggerMatches,
  runAutomationById,
  valorDaVariavel,
  valoresParaPrevia,
} from './engine';
import { classificarCodigo, CODIGOS_DO_CLIENTE, VARIAVEIS_FIXAS } from './variaveis/catalogo';
import {
  engineSendText,
  engineSendTemplate,
  engineSendInteractive,
} from './meta-send';
import { loadStepsTree, replaceSteps, type BuilderStepInput } from './steps-tree';
import {
  MOTIVO_PASSO_REMOVIDO,
  MOTIVO_RAMO_REMOVIDO,
  comPassoDaFila,
} from './retomada';
import type { Automation, KeywordMatchTriggerConfig } from '@/types';
import { diaNoFuso, somarDias } from '@/lib/tasks/prazo';

const ACCOUNT = 'acct-1';

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.pipeline = null;
  h.state.stage = null;
  h.state.dealExistente = null;
  h.state.dealPorStatus = null;
  h.state.rpcMover = [];
  h.state.depoisDeMover = null;
  h.state.rpcMoverRecusa = null;
  h.state.rpcStatusGravado = 'open';
  h.state.conversaLida = {};
  h.state.canalDaConta = null;
  h.state.dealSelects = [];
  h.state.dealInserts = [];
  h.state.automations = [];
  h.state.automacoesPorGatilho = null;
  h.state.erroPorGatilho = {};
  h.state.steps = [];
  h.state.passosApagados = new Set();
  h.state.passosPorAutomacao = false;
  h.state.tagDaConta = null;
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.logInserts = [];
  h.state.logUpdates = [];
  h.state.updateFiltros = [];
  h.state.historicoDoLog = [];
  h.state.taskInserts = [];
  h.state.notifInserts = [];
  h.state.customValues = [];
  h.state.erroNosValoresDoContato = null;
  h.state.esperasVivas = [];
  h.state.erroNaFila = null;
  h.state.erroNoNegocio = null;
  h.state.movimentosDepois = [];
  h.state.movimentosPorChamada = null;
  h.state.erroNosMovimentos = null;
  h.state.conversasDoContato = [];
  h.state.contaDaConversa = {};
  h.state.contatoDaConversa = {};
  h.state.responsavelDaConversa = undefined;
  h.state.conversaDaJanela = null;
  h.state.valorDoCampo = undefined;
  h.state.erroNaCondicaoDoCampo = null;
  h.state.leiturasDoCampo = [];
  h.state.respostasDesde = [];
  h.state.erroNasRespostas = null;
  h.state.ultimoMovimento = null;
  h.state.statusDaFila = [];
  h.state.interrompida = false;
  h.state.logMarcados = new Set();
  h.state.membros = [
    { user_id: 'agente-fallback', full_name: 'Agente Um', email: 'um@cb.test' },
  ];
});

describe('runAutomationsForTrigger — tenant isolation', () => {
  it('refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)', async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'victim-contact-uuid',
      context: { message_text: 'manual trigger' },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain('contacts');
    expect(h.state.fromCalls).not.toContain('automations');
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it('proceeds past the guard when the contact belongs to the account', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.fromCalls).toContain('automations');
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(['eq', 'id', 'c1']);
    expect(filters).toContainEqual(['eq', 'account_id', ACCOUNT]);
  });
});

describe('automation_logs — status is seeded pessimistically (issue #409)', () => {
  it("writes the log row as 'failed' before any step runs", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // The insert happens before execution, so a run killed mid-flight must
    // not leave behind a row that claims it succeeded.
    expect(h.state.logInserts).toHaveLength(1);
    expect(h.state.logInserts[0]).toMatchObject({
      status: 'failed',
      steps_executed: [],
    });
  });

  it("still promotes the log to 'success' once the steps complete", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // The seed is only a floor — the outermost scope still writes the real
    // verdict, so a completed run reports success as it always did.
    const withStatus = h.state.logUpdates.filter((u) => 'status' in u);
    expect(withStatus.at(-1)).toMatchObject({ status: 'success' });
  });
});

describe('update_contact_field — custom fields', () => {
  it('upserts contact_custom_values when the field is account-owned', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = { id: 'cf1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:cf1', 'Premium')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: 'c1',
      custom_field_id: 'cf1',
      value: 'Premium',
    });
  });

  it('interpolates {{ vars.* }} into the custom value', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = { id: 'cf1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:cf1', '{{ vars.source }}')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { vars: { source: 'WhatsApp Ad' } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect((h.state.upsertCalls[0].payload as { value: string }).value).toBe(
      'WhatsApp Ad'
    );
  });

  // 21/09/2026: o Typebot manda TODAS as variáveis em todo ponto do fluxo, e
  // as ainda não respondidas chegam vazias. Gravar o vazio apagava o que a
  // ficha já sabia (o "Tamanho da Divida" e a campanha que a Kommo trouxe).
  it('CRÍTICO: variável VAZIA não apaga o campo — nem ausente, nem só espaços', async () => {
    for (const vars of [{}, { source: '' }, { source: '   ' }]) {
      h.state.upsertCalls = [];
      h.state.updateCalls = [];
      h.state.owned = { id: 'c1' };
      h.state.ownedCustomField = { id: 'cf1' };
      h.state.automations = [automationWithUpdateStep()];
      h.state.steps = [customStep('custom:cf1', '{{ vars.source }}')];

      await runAutomationsForTrigger({
        accountId: ACCOUNT,
        triggerType: 'new_message_received',
        contactId: 'c1',
        context: { vars },
      });

      expect(h.state.upsertCalls).toHaveLength(0);
      expect(h.state.updateCalls).toHaveLength(0);
    }
  });

  it('CRÍTICO: e-mail e empresa vazios também não apagam a coluna da ficha', async () => {
    for (const campo of ['email', 'company']) {
      h.state.updateCalls = [];
      h.state.owned = { id: 'c1' };
      h.state.automations = [automationWithUpdateStep()];
      h.state.steps = [customStep(campo, '{{ vars.nada }}')];

      await runAutomationsForTrigger({
        accountId: ACCOUNT,
        triggerType: 'new_message_received',
        contactId: 'c1',
        context: { vars: { nada: '' } },
      });

      expect(h.state.updateCalls).toHaveLength(0);
    }
  });

  // A trava do lembrete (935) é por VALOR: a automação do Calendly gravava
  // "…:00.000000Z" e a API v1 "…:00.000Z" no MESMO campo, e o lembrete saía
  // duas vezes. Campo de data grava o instante numa forma só.
  it('CRÍTICO: campo de DATA grava o instante canônico (…000000Z → …000Z)', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = { id: 'cf1', field_type: 'datetime' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:cf1', '{{ vars.agendamento_inicio }}')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { vars: { agendamento_inicio: '2026-09-28T17:30:00.000000Z' } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect((h.state.upsertCalls[0].payload as { value: string }).value).toBe(
      '2026-09-28T17:30:00.000Z'
    );
  });

  it('campo de TEXTO com o mesmo valor grava cru', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = { id: 'cf1', field_type: 'text' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:cf1', '2026-09-28T17:30:00.000000Z')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect((h.state.upsertCalls[0].payload as { value: string }).value).toBe(
      '2026-09-28T17:30:00.000000Z'
    );
  });

  it('campo de DATA sem fuso escrito grava como veio (não escolhe fuso em silêncio)', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = { id: 'cf1', field_type: 'datetime' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:cf1', '2026-09-28T17:30:00')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect((h.state.upsertCalls[0].payload as { value: string }).value).toBe(
      '2026-09-28T17:30:00'
    );
  });

  it('refuses to write a custom field from another account', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:foreign-cf', 'x')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

// 1031 (21/09/2026): o lead desqualificado pode voltar a ser qualificado. Sem
// card aberto, o "Mover card" acha o PERDIDO mais recente — e o gatilho da
// 1031 o reabre ao entrar numa etapa neutra. O GANHO nunca: é o card do
// cliente que fechou (e foi para o Jurídico).
describe('Mover card — sem card aberto, o PERDIDO (1031)', () => {
  const moverPara = (stage_id: string) => ({
    id: 's-mover',
    automation_id: 'a1',
    step_type: 'move_deal_stage',
    position: 0,
    parent_step_id: null,
    step_config: { stage_id },
  });

  it('CRÍTICO: sem aberto, move o perdido mais recente', async () => {
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: null, lost: { id: 'd-perdido' } };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-lead')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.rpcMover).toHaveLength(1);
    expect(h.state.rpcMover[0]).toMatchObject({
      p_deal_id: 'd-perdido',
      p_stage_id: 'etapa-lead',
      p_status: null,
      // Achado pela BUSCA como perdido: a RPC só escreve se ele continua perdido.
      p_status_esperado: 'lost',
    });
  });

  it('com card aberto, o aberto vence — o perdido nem é consultado', async () => {
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: { id: 'd-aberto' }, lost: { id: 'd-perdido' } };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-lead')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.rpcMover[0]).toMatchObject({ p_deal_id: 'd-aberto', p_status_esperado: 'open' });
    expect(h.state.dealSelects.some((f) => f.some(([op, k, v]) => op === 'eq' && k === 'status' && v === 'lost'))).toBe(false);
  });

  it('o "Mover" NÃO pede status — quem reabre o perdido é a RPC, na mesma escrita (1031)', async () => {
    // Ler "está perdido?" aqui e pedir `open` depois abria corrida com quem
    // marcasse o card como GANHO no meio: o ganho seria sobrescrito (Codex,
    // PR #245). O CASE da RPC olha o status da linha na hora do UPDATE.
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: null, lost: { id: 'd-perdido', stage_id: 'etapa-reuniao' } };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-reuniao')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.rpcMover[0]).toMatchObject({ p_deal_id: 'd-perdido', p_stage_id: 'etapa-reuniao', p_status: null });
  });

  it('CRÍTICO: o card fica FIXADO na execução — depois de fechado, o "Mover" seguinte não troca de card', async () => {
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: { id: 'd-contrato' }, lost: { id: 'd-outro-funil' } };
    // O primeiro "Mover" leva o card a "Contrato Fechado" e ele deixa de estar aberto.
    h.state.depoisDeMover = () => {
      if (h.state.dealPorStatus) h.state.dealPorStatus = { won: { id: 'd-contrato' }, lost: { id: 'd-outro-funil' } };
    };
    // "Contrato Fechado" é etapa marcada: a RPC devolve o GANHO que gravou.
    h.state.rpcStatusGravado = 'won';
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-contrato-fechado'), { ...moverPara('etapa-cliente-ativo'), id: 's-mover-2', position: 1 }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.rpcMover.map((r) => r.p_deal_id)).toEqual(['d-contrato', 'd-contrato']);
    // O 2º "Mover" vai no card FIXADO e espera o status que o 1º GRAVOU (o
    // ganho da etapa marcada): quem fechou, segue para o Jurídico; quem
    // mudasse o status no meio faria a RPC recusar.
    expect(h.state.rpcMover.map((r) => r.p_status_esperado)).toEqual(['open', 'won']);
  });

  it('o card fixado NÃO vaza para a automação seguinte do mesmo disparo', async () => {
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: { id: 'd-1' } };
    h.state.depoisDeMover = () => {
      if (h.state.dealPorStatus) h.state.dealPorStatus = { open: { id: 'd-2' } };
    };
    h.state.automations = [automationWithUpdateStep(), { ...automationWithUpdateStep(), id: 'a2' }];
    h.state.steps = [moverPara('etapa-x'), { ...moverPara('etapa-y'), id: 's-a2', automation_id: 'a2' }];

    const contexto = {};
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: contexto,
    });

    expect(contexto).toEqual({});
  });

  it('CRÍTICO: o GANHO nunca é alvo — só o card ganho = nenhum negócio, e nada se move', async () => {
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: null, lost: null, won: { id: 'd-ganho' } };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-lead')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.rpcMover).toHaveLength(0);
  });

  it('CRÍTICO: contato com card GANHO não tem o PERDIDO puxado — o formulário público não alcança a ficha de cliente', async () => {
    // Revisão do PR #245: cliente com o caso ganho (foi para o Jurídico) e um
    // card perdido antigo de outra área. Sem a regra, o Typebot reabriria o
    // perdido e a trava de etapa gravaria e-mail e respostas na ficha dele.
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: null, lost: { id: 'd-perdido' }, won: { id: 'd-ganho' } };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-lead')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.rpcMover).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('nenhum negócio aberto');
  });

  it('CRÍTICO: o card fixado vai com o status que a execução GRAVOU — a espera não apaga a guarda', async () => {
    // Revisão do PR #245: "Mover" → "Aguardar 3 dias" → "Marcar perdido". O
    // contexto que acorda da fila traz o card E o status fixado; se o
    // operador ganhou o card durante a espera, a RPC recusa.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-lead')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { deal_id: 'd-fixado', deal_status_fixado: 'open' },
    });

    expect(h.state.rpcMover[0]).toMatchObject({ p_deal_id: 'd-fixado', p_status_esperado: 'open' });
  });

  it('o "Aguardar" leva o card E o status fixados para a fila', async () => {
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: { id: 'd-1' } };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      moverPara('etapa-lead'),
      { id: 's-espera', automation_id: 'a1', step_type: 'wait', position: 1, parent_step_id: null, step_config: { amount: 3, unit: 'days' } },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    expect(h.state.esperasEnfileiradas[0].context).toMatchObject({ deal_id: 'd-1', deal_status_fixado: 'open' });
  });

  it('a condição de etapa enxerga o PERDIDO sem aberto nem ganho — é como o Typebot puxa o desqualificado', async () => {
    // A 4ª rodada do Codex pediu condição só-aberto; mantido: condição e ação
    // falam do mesmo card, e `deal_stage == Desqualificado` só passa assim.
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: null, lost: { id: 'd-perdido', stage_id: 'etapa-desq' } };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      { id: 'c-desq', automation_id: 'a1', step_type: 'condition', position: 0, parent_step_id: null, step_config: { subject: 'deal_stage', operand: 'etapa-desq' } },
      { ...moverPara('etapa-lead'), id: 's-puxa', parent_step_id: 'c-desq', branch: 'yes' },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.rpcMover).toHaveLength(1);
    expect(h.state.rpcMover[0]).toMatchObject({ p_deal_id: 'd-perdido', p_stage_id: 'etapa-lead', p_status_esperado: 'lost' });
  });

  it('o card do EVENTO de funil é alvo explícito — vai sem a guarda da busca', async () => {
    // O gatilho de etapa carrega o card exato que se moveu, e ele pode estar
    // ganho (entrou em "Contrato Fechado"): levá-lo ao funil do Jurídico é
    // legítimo. A guarda é só para o card que a BUSCA achou.
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { won: { id: 'd-evento' } };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-juridico')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { deal_id: 'd-evento' },
    });

    expect(h.state.rpcMover[0]).toMatchObject({ p_deal_id: 'd-evento', p_status_esperado: null });
  });

  it('CRÍTICO: a RPC recusou (o card mudou de status no meio) — a execução para ali, com o motivo no registro', async () => {
    // Codex, PR #245: marcado ganho entre a busca e a escrita, o card não pode
    // ir para a etapa do comercial. A recusa é da RPC (a guarda mora no
    // UPDATE); aqui se cobra que o motor não siga adiante com aquele card.
    h.state.owned = { id: 'c1' };
    h.state.dealPorStatus = { open: null, lost: { id: 'd-perdido' } };
    h.state.rpcMoverRecusa = 'o negocio deixou de estar lost durante a automacao';
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [moverPara('etapa-lead'), { ...moverPara('etapa-mql'), id: 's-mover-2', position: 1 }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // O 2º "Mover" não roda: passo recusado encerra a execução.
    expect(h.state.rpcMover).toHaveLength(1);
    expect(JSON.stringify(h.state.logUpdates)).toContain('deixou de estar lost');
  });
});

describe('update_contact_field — o NOME (999)', () => {
  // Revisão do PR #208: o passo gravava `contacts.name` por chave computada,
  // sem respeitar nem gravar a marca. A automação ativa do Calendly tem este
  // passo com {{vars.agendamento_nome}} — um telefone digitado no campo de nome
  // ia para a ficha e a marca antiga o CONGELAVA.
  it('CRÍTICO: nome de verdade é gravado FIXADO', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('name', '{{ vars.nome }}')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { vars: { nome: '  Diego   Exemplo ' } },
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const payload = h.state.updateCalls[0].payload as Record<string, unknown>;
    expect(payload.name).toBe('Diego Exemplo');
    expect(typeof payload.nome_fixado_em).toBe('string');
    expect(h.state.updateCalls[0].filters).toContainEqual(['eq', 'account_id', ACCOUNT]);
  });

  it('CRÍTICO: valor que não é nome (telefone, vazio) NÃO sobrescreve a ficha', async () => {
    for (const valor of ['+55 62 99000-0009', '']) {
      h.state.updateCalls = [];
      h.state.owned = { id: 'c1' };
      h.state.automations = [automationWithUpdateStep()];
      h.state.steps = [customStep('name', '{{ vars.nome }}')];

      await runAutomationsForTrigger({
        accountId: ACCOUNT,
        triggerType: 'new_message_received',
        contactId: 'c1',
        context: { vars: { nome: valor } },
      });

      expect(h.state.updateCalls).toHaveLength(0);
    }
  });

  it('e-mail e empresa seguem sem marca nenhuma', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('company', 'ACME')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    const payload = h.state.updateCalls[0].payload as Record<string, unknown>;
    expect(payload.company).toBe('ACME');
    expect(payload).not.toHaveProperty('nome_fixado_em');
  });
});

describe('create_deal — um card por contato', () => {
  // O índice único da 911 é PARCIAL (WHERE source = 'channel') e este passo
  // insere com source 'automation' — o banco não barra o duplicado, então a
  // regra é uma checagem explícita no motor, antes do insert.
  function dealStep() {
    return {
      id: 's1',
      automation_id: 'a1',
      step_type: 'create_deal',
      position: 0,
      parent_step_id: null,
      step_config: {
        pipeline_id: 'p1',
        stage_id: 'st1',
        title: 'Novo negócio',
      },
    };
  }

  function executados() {
    return h.state.logUpdates.flatMap(
      (u) =>
        (u.steps_executed as
          { status: string; detail: string }[] | undefined) ?? []
    );
  }

  beforeEach(() => {
    h.state.owned = { id: 'c1' };
    h.state.pipeline = { id: 'p1' };
    h.state.stage = { id: 'st1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [dealStep()];
  });

  it('desiste sem inserir quando o contato já tem card — qualquer funil, qualquer origem', async () => {
    h.state.dealExistente = { id: 'd-antigo' };

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.dealInserts).toHaveLength(0);
    // A checagem roda em service-role (ignora RLS) — o escopo de conta é o filtro.
    expect(h.state.dealSelects[0]).toContainEqual([
      'eq',
      'account_id',
      ACCOUNT,
    ]);
    expect(h.state.dealSelects[0]).toContainEqual(['eq', 'contact_id', 'c1']);
    // Não é falha do passo: é a regra funcionando, com o log que a documenta.
    expect(executados()).toContainEqual(
      expect.objectContaining({
        status: 'success',
        detail: 'deal already existed',
      })
    );
  });

  it('⚠️ título LITERAL do autor nasce FIXADO — o gatilho da 1007 não o troca depois', async () => {
    // "Caso trabalhista" é texto que o autor da automação escolheu para todo
    // card que ela criar. Sem a marca, a primeira renomeação deliberada da
    // ficha o trocaria pelo nome da pessoa, apagando o que ele quis dizer
    // (achado do Codex, PR #225).
    h.state.dealExistente = null;

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.dealInserts[0].titulo_fixado_em).toEqual(expect.any(String));
  });

  it('⚠️ título com {{…}} é DERIVADO de quem está do outro lado: fica SOLTO', async () => {
    // É o caso real em produção (`{{vars.agendamento_nome}}`, a automação do
    // Calendly): o título é o nome da pessoa, e tem de continuar acompanhando
    // a ficha quando alguém corrigir o nome.
    h.state.dealExistente = null;
    h.state.steps = [
      {
        ...dealStep(),
        step_config: {
          pipeline_id: 'p1',
          stage_id: 'st1',
          title: '{{vars.agendamento_nome}}',
        },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { vars: { agendamento_nome: 'Paula Exemplo' } },
    });

    expect(h.state.dealInserts[0]).toMatchObject({
      title: 'Paula Exemplo',
      titulo_fixado_em: null,
    });
  });

  it("cria o card com source 'automation' quando o contato não tem nenhum", async () => {
    h.state.dealExistente = null;

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.dealInserts).toHaveLength(1);
    expect(h.state.dealInserts[0]).toMatchObject({
      account_id: ACCOUNT,
      contact_id: 'c1',
      pipeline_id: 'p1',
      stage_id: 'st1',
      source: 'automation',
    });
    expect(executados()).toContainEqual(
      expect.objectContaining({ status: 'success', detail: 'deal created' })
    );
  });
});

describe('send_webhook — SSRF guard (GHSA-8jqh-598v-rfxc)', () => {
  it('refuses a private / link-local destination and never calls fetch', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    // Aimed at the cloud metadata endpoint — the classic SSRF target.
    h.state.steps = [webhookStep('http://169.254.169.254/latest/meta-data/')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // The automation matched and its steps were loaded (so we genuinely
    // reached the send_webhook case)...
    expect(h.state.fromCalls).toContain('automation_steps');
    // ...yet the guard blocked it before any outbound request left the box.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

function webhookStep(url: string) {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'send_webhook',
    position: 0,
    parent_step_id: null,
    step_config: {
      url,
      headers: { 'Metadata-Flavor': 'Google' },
      body_template: '{}',
    },
  };
}

// ------------------------------------------------------------
// Canal de SAÍDA por passo — a precedência que o seletor "Enviar por" promete.
//
// stepChannel é privado, então o teste passa pelo motor de verdade e observa o
// que chega ao sender. Nenhuma conta tem 2 conexões hoje, então esta é a única
// forma de provar a regra.
// ------------------------------------------------------------

function sendStep(step_config: Record<string, unknown>) {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'send_message',
    position: 0,
    parent_step_id: null,
    step_config,
  };
}

async function dispararEnvio(
  step_config: Record<string, unknown>,
  context: Record<string, unknown>
) {
  h.state.owned = { id: 'c1' };
  h.state.automations = [automationWithUpdateStep()];
  h.state.steps = [sendStep(step_config)];
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    // conversation_id no contexto evita a busca de conversa em `resolveConversationId`.
    context: { conversation_id: 'conv1', ...context },
  });
  const chamadas = vi.mocked(engineSendText).mock.calls;
  return chamadas[0]?.[0];
}

describe('send_message — canal de saída por passo', () => {
  beforeEach(() => vi.mocked(engineSendText).mockClear());

  it('CRÍTICO: o canal do PASSO vence o canal do disparo', async () => {
    // "o cliente escreveu no pessoal, mas a confirmação sai pelo oficial".
    const args = await dispararEnvio(
      { text: 'oi', channel_id: 'ch-oficial' },
      { channel_id: 'ch-pessoal' }
    );
    expect(args?.preferredChannelId).toBe('ch-oficial');
  });

  it('sem canal no passo, herda o canal do DISPARO', async () => {
    // É o que faz o follow-up parado num `wait` de 24h voltar pelo número por
    // onde o cliente escreveu, e não pelo que ele usou no meio-tempo.
    const args = await dispararEnvio(
      { text: 'oi' },
      { channel_id: 'ch-pessoal' }
    );
    expect(args?.preferredChannelId).toBe('ch-pessoal');
  });

  it('sem canal em lugar nenhum, o sender cai na conversa (undefined)', async () => {
    const args = await dispararEnvio({ text: 'oi' }, {});
    expect(args?.preferredChannelId).toBeUndefined();
  });

  it('channel_id nulo no passo (config antiga) não apaga o canal do disparo', async () => {
    // `??` e não `||`: um `null` gravado por config antiga tem de cair para o
    // disparo, não virar "sem canal".
    const args = await dispararEnvio(
      { text: 'oi', channel_id: null },
      { channel_id: 'ch-pessoal' }
    );
    expect(args?.preferredChannelId).toBe('ch-pessoal');
  });
});

// ------------------------------------------------------------
// Conversa de OUTRA conta no contexto (upstream #589, GHSA-m4fx-g6pr-hrw8).
//
// O `POST /api/automations/engine` copia o contexto do corpo, e todo envio
// grava a mensagem e a prévia pelo id da conversa em service-role. A fake
// entrega a conversa por id só quando o filtro de conta casa com a dona.
// ------------------------------------------------------------

describe('conversa de outra conta no contexto (upstream #589)', () => {
  beforeEach(() => vi.mocked(engineSendText).mockClear());

  it('o disparo recusa a conversa alheia antes de buscar automações, sem enviar', async () => {
    h.state.owned = { id: 'c1' };
    h.state.contaDaConversa = { 'conv-da-vitima': 'outra-conta' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text: 'oi' })];

    const r = await dispararAutomacoes({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-da-vitima' },
    });

    expect(r.erro).toBe('conversation not in account');
    expect(h.state.fromCalls).not.toContain('automations');
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it('a conversa da própria conta segue normalmente', async () => {
    const args = await dispararEnvio({ text: 'oi' }, {});
    expect(args?.conversationId).toBe('conv1');
  });

  it('quem não passa pelo disparo (runAutomationById — o mesmo trecho da retomada) é barrado antes do envio', async () => {
    // `resolveConversationId` é o último ponto antes da escrita: a retomada
    // reusa o contexto gravado, e `runAutomationById` não confere a conversa.
    h.state.owned = { id: 'c1' };
    h.state.contaDaConversa = { 'conv-da-vitima': 'outra-conta' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text: 'oi' })];

    await runAutomationById({
      automationId: 'a1',
      accountId: ACCOUNT,
      contactId: 'c1',
      context: { conversation_id: 'conv-da-vitima' },
      triggerType: 'new_message_received',
    });

    expect(engineSendText).not.toHaveBeenCalled();
    // E é ESTA guarda que barra — não outra coisa que tenha parado a execução.
    expect(JSON.stringify(h.state.logUpdates)).toContain(
      'conversation does not belong to this account'
    );
  });

  it('⚠️ contato A + conversa de B, da MESMA conta: o disparo recusa (Codex, 3ª rodada)', async () => {
    h.state.owned = { id: 'c1' };
    h.state.contatoDaConversa = { 'conv-de-b': 'c2' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text: 'oi' })];

    const r = await dispararAutomacoes({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-de-b' },
    });

    expect(r.erro).toBe('conversation not in account');
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it('⚠️ contato A + conversa de B pela execução direta: barrado em resolveConversationId', async () => {
    h.state.owned = { id: 'c1' };
    h.state.contatoDaConversa = { 'conv-de-b': 'c2' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text: 'oi' })];

    await runAutomationById({
      automationId: 'a1',
      accountId: ACCOUNT,
      contactId: 'c1',
      context: { conversation_id: 'conv-de-b' },
      triggerType: 'new_message_received',
    });

    expect(engineSendText).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain(
      'conversation does not belong to this account'
    );
  });

  it('controle: a mesma execução com a conversa da PRÓPRIA conta envia', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text: 'oi' })];

    await runAutomationById({
      automationId: 'a1',
      accountId: ACCOUNT,
      contactId: 'c1',
      context: { conversation_id: 'conv-da-casa' },
      triggerType: 'new_message_received',
    });

    expect(engineSendText).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------
// assign_conversation: a conversa DO DISPARO, não todas as do contato.
//
// O codigo anterior filtrava so por conta+contato, entao um contato com tres
// conversas tinha as tres atribuidas de uma vez — inclusive as de outro
// numero, atropelando o recorte por conexao.
// ------------------------------------------------------------

describe('assign_conversation — alvo', () => {
  const passoAtribuir = {
    id: 's1',
    automation_id: 'a1',
    step_type: 'assign_conversation',
    position: 0,
    parent_step_id: null,
    step_config: { mode: 'specific', agent_id: 'agente-1' },
  };

  it('CRÍTICO: mira a conversa do contexto, não o contato inteiro', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAtribuir];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-do-disparo' },
    });

    const conversas = h.state.updateCalls.filter(
      (u) => u.table === 'conversations'
    );
    expect(conversas).toHaveLength(1);
    const colunas = conversas[0].filters.map((f) => f[1]);
    expect(colunas).toContain('id');
    expect(colunas).not.toContain('contact_id');
  });

  it('sem conversa no disparo, cai em todas as do contato (como antes)', async () => {
    // É o caso da etiqueta adicionada na ficha: não há conversa no contexto,
    // e não atribuir nada seria pior que atribuir todas.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAtribuir];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    const conversas = h.state.updateCalls.filter(
      (u) => u.table === 'conversations'
    );
    expect(conversas).toHaveLength(1);
    expect(conversas[0].filters.map((f) => f[1])).toContain('contact_id');
  });

  it('1067: atendente fixo SUSPENSO não recebe — a conversa fica na fila', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAtribuir];
    h.state.membros = [
      { user_id: 'agente-1', full_name: 'Agente Suspenso', suspenso_em: '2026-09-29T12:00:00Z' },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-do-disparo' },
    });

    const conversas = h.state.updateCalls.filter(
      (u) => u.table === 'conversations'
    );
    expect(conversas).toHaveLength(0);
  });
});

// ------------------------------------------------------------
// Ficha SEM conversa (27/09/2026): o lead de anúncio chega pela API v1 —
// ficha e card, sem conversa — e a automação da etapa é o primeiro contato.
// Os passos que FALAM com o contato criam a conversa (encerrada); os que só
// leem ou mexem nela não criam nada.
// ------------------------------------------------------------

describe('ficha sem conversa — os passos de envio criam a conversa (27/09/2026)', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockClear();
    vi.mocked(engineSendTemplate).mockClear();
    vi.mocked(engineSendInteractive).mockClear();
    destinatarioMock.conversaDoContato.mockClear();
  });

  async function executar(
    passo: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ) {
    h.state.owned = { id: 'c1', name: 'Lead' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passo];
    await runAutomationById({
      automationId: 'a1',
      accountId: ACCOUNT,
      contactId: 'c1',
      context,
      triggerType: 'deal_stage_changed',
    });
  }

  const passoDe = (step_type: string, step_config: Record<string, unknown>) => ({
    ...sendStep(step_config),
    step_type,
  });

  it('CRÍTICO: send_message sem conversa cria a conversa ENCERRADA e envia por ela', async () => {
    await executar(sendStep({ text: 'Olá! Recebemos o seu contato.' }));

    expect(destinatarioMock.conversaDoContato).toHaveBeenCalledTimes(1);
    expect(destinatarioMock.conversaDoContato).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      'c1',
      { conversaNovaEncerrada: true }
    );
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'conv-criada',
      contactId: 'c1',
    });
  });

  it.each([
    ['send_template', { template_name: 'boas_vindas', language: 'pt_BR' }],
    [
      'send_buttons',
      {
        kind: 'buttons',
        body: 'Podemos conversar?',
        buttons: [{ id: 'b1', title: 'Sim' }],
      },
    ],
  ])('%s sem conversa também cria (encerrada) e envia por ela', async (tipo, cfg) => {
    await executar(passoDe(tipo, cfg));

    expect(destinatarioMock.conversaDoContato).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      'c1',
      { conversaNovaEncerrada: true }
    );
    const sender =
      tipo === 'send_template' ? engineSendTemplate : engineSendInteractive;
    expect(vi.mocked(sender).mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'conv-criada',
    });
  });

  it('contato COM conversa: usa a que existe, e nada é criado', async () => {
    h.state.conversasDoContato = [{ id: 'conv-existente' }];

    await executar(sendStep({ text: 'oi' }));

    expect(destinatarioMock.conversaDoContato).not.toHaveBeenCalled();
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'conv-existente',
    });
  });

  it('⚠️ conversa de OUTRA conta no contexto: continua recusada — nunca trocada por uma nova', async () => {
    h.state.contaDaConversa = { 'conv-da-vitima': 'outra-conta' };

    await executar(sendStep({ text: 'oi' }), {
      conversation_id: 'conv-da-vitima',
    });

    expect(destinatarioMock.conversaDoContato).not.toHaveBeenCalled();
    expect(engineSendText).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain(
      'conversation does not belong to this account'
    );
  });

  it('⚠️ conversa de OUTRO contato no contexto: continua recusada — nunca trocada por uma nova', async () => {
    h.state.contatoDaConversa = { 'conv-de-b': 'c2' };

    await executar(sendStep({ text: 'oi' }), { conversation_id: 'conv-de-b' });

    expect(destinatarioMock.conversaDoContato).not.toHaveBeenCalled();
    expect(engineSendText).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain(
      'conversation does not belong to this account'
    );
  });

  it('set_ai NÃO fala com o contato: sem conversa, continua recusando e não cria nada', async () => {
    await executar(passoDe('set_ai', { enabled: false }));

    expect(destinatarioMock.conversaDoContato).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain(
      'cannot send: contact has no existing conversation'
    );
  });

  it('a criação falhou: o passo falha com o motivo, e nada é enviado', async () => {
    destinatarioMock.conversaDoContato.mockRejectedValueOnce(
      new Error('destinatário: dono da conta não resolvido')
    );

    await executar(sendStep({ text: 'oi' }));

    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.logUpdates).toContainEqual(
      expect.objectContaining({
        status: 'failed',
        error_message: 'destinatário: dono da conta não resolvido',
      })
    );
  });
});

describe('set_ai — a pausa com MOTIVO (1049, D26)', () => {
  function passoSetAi(enabled: boolean) {
    return {
      id: 's1',
      automation_id: 'a1',
      step_type: 'set_ai',
      position: 0,
      parent_step_id: null,
      step_config: { enabled },
    };
  }

  async function rodar(enabled: boolean) {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoSetAi(enabled)];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
    });
  }

  function passos() {
    return h.state.logUpdates.flatMap(
      (u) => (u.steps_executed as { status: string; detail?: string }[] | undefined) ?? []
    );
  }

  const escritasNaConversa = () => h.state.updateCalls.filter((u) => u.table === 'conversations');

  it('desligar grava a pausa por automação, só se ainda não havia pausa', async () => {
    await rodar(false);
    const conversas = escritasNaConversa();
    expect(conversas).toHaveLength(1);
    expect(conversas[0].payload).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'automacao' });
    expect(conversas[0].filters).toContainEqual(['eq', 'ai_autoreply_disabled', false]);
  });

  it('ligar desfaz a pausa por AUTOMAÇÃO, com a condição no próprio UPDATE, e não zera o teto', async () => {
    h.state.conversaLida = { ai_autoreply_disabled: true, ia_pausada_por: 'automacao' };
    await rodar(true);
    const conversas = escritasNaConversa();
    expect(conversas).toHaveLength(1);
    expect(conversas[0].payload).toEqual({ ai_autoreply_disabled: false, ia_pausada_por: null, ia_pausada_em: null });
    expect(conversas[0].filters).toContainEqual(['eq', 'ia_pausada_por', 'automacao']);
    expect(conversas[0].filters).toContainEqual(['eq', 'ai_autoreply_disabled', true]);
    expect(passos()).toContainEqual(expect.objectContaining({ status: 'success', detail: 'IA ligada na conversa' }));
  });

  it.each(['gente', 'botao', 'transferencia'])(
    'ligar NÃO desfaz a pausa por %s (só o "Retomar IA" desfaz) — e não escreve nada',
    async (motivo) => {
      h.state.conversaLida = { ai_autoreply_disabled: true, ia_pausada_por: motivo };
      await rodar(true);
      expect(escritasNaConversa()).toHaveLength(0);
      expect(passos()).toContainEqual(
        expect.objectContaining({ status: 'success', detail: `IA segue pausada: a pausa foi de gente (${motivo})` })
      );
    }
  );

  it('ligar com a IA já ligada: nada a escrever', async () => {
    h.state.conversaLida = { ai_autoreply_disabled: false, ia_pausada_por: null };
    await rodar(true);
    expect(escritasNaConversa()).toHaveLength(0);
    expect(passos()).toContainEqual(expect.objectContaining({ status: 'success', detail: 'IA já estava ligada' }));
  });
});

describe('pin_conversation_channel — fixar a conversa no número (Comercial → Jurídico)', () => {
  const JURIDICO = { id: 'ch-jur', label: 'Bancário - Jurídico', kind: 'evolution' };

  async function rodar(step_config: Record<string, unknown> = { channel_id: 'ch-jur' }) {
    h.state.owned ??= { id: 'c1', phone: '5583999990000' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      {
        id: 's1',
        automation_id: 'a1',
        step_type: 'pin_conversation_channel',
        position: 0,
        parent_step_id: null,
        step_config,
      },
    ];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1', channel_id: 'ch-comercial' },
    });
  }

  function passos() {
    return h.state.logUpdates.flatMap(
      (u) => (u.steps_executed as { status: string; detail?: string }[] | undefined) ?? []
    );
  }

  const escritasNaConversa = () => h.state.updateCalls.filter((u) => u.table === 'conversations');

  beforeEach(() => {
    h.state.canalDaConta = JURIDICO;
    h.state.conversaLida = { group_id: null, channel_id: 'ch-comercial', channel_pinned: false };
  });

  it('CRÍTICO: fixa a conversa DO DISPARO no número escolhido, cercada pela conta', async () => {
    await rodar();

    const conversas = escritasNaConversa();
    expect(conversas).toHaveLength(1);
    expect(conversas[0].payload).toEqual({ channel_id: 'ch-jur', channel_pinned: true });
    expect(conversas[0].filters).toContainEqual(['eq', 'id', 'conv-1']);
    expect(conversas[0].filters).toContainEqual(['eq', 'account_id', ACCOUNT]);
    expect(passos()).toContainEqual(
      expect.objectContaining({ status: 'success', detail: 'conversa fixada no número "Bancário - Jurídico"' })
    );
  });

  it('fixada em OUTRO número: troca para o escolhido', async () => {
    h.state.conversaLida = { group_id: null, channel_id: 'ch-comercial', channel_pinned: true };
    await rodar();
    expect(escritasNaConversa()[0]?.payload).toEqual({ channel_id: 'ch-jur', channel_pinned: true });
  });

  it('já fixada neste número: nada a escrever', async () => {
    h.state.conversaLida = { group_id: null, channel_id: 'ch-jur', channel_pinned: true };
    await rodar();
    expect(escritasNaConversa()).toHaveLength(0);
    expect(passos()).toContainEqual(
      expect.objectContaining({ status: 'success', detail: 'conversa já estava fixada no número "Bancário - Jurídico"' })
    );
  });

  it('no número certo mas SOLTA (segue o cliente): fixa — a próxima mensagem pelo Comercial a puxaria de volta', async () => {
    h.state.conversaLida = { group_id: null, channel_id: 'ch-jur', channel_pinned: false };
    await rodar();
    expect(escritasNaConversa()[0]?.payload).toEqual({ channel_id: 'ch-jur', channel_pinned: true });
  });

  it('⚠️ conexão apagada ou de OUTRA conta: FALHA, e a conversa não é tocada', async () => {
    h.state.canalDaConta = null;
    await rodar();
    expect(escritasNaConversa()).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('a conexão escolhida não existe nesta conta');
  });

  it('⚠️ conexão do Instagram: FALHA — prenderia a conversa do telefone num transporte que não o alcança', async () => {
    h.state.canalDaConta = { id: 'ch-jur', label: 'Instagram', kind: 'instagram' };
    await rodar();
    expect(escritasNaConversa()).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('só vale para conexão de WhatsApp');
  });

  it('⚠️ contato só com o BSUID num número por QR Code: FALHA antes de fixar (não chegaria a ele)', async () => {
    h.state.owned = { id: 'c1', phone: null, wa_user_id: 'BR.1234567890' };
    await rodar();
    expect(escritasNaConversa()).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('não é número oficial');
  });

  it('contato só com o BSUID num número OFICIAL: fixa (a Meta o alcança pelo usuário)', async () => {
    h.state.owned = { id: 'c1', phone: null, wa_user_id: 'BR.1234567890' };
    h.state.canalDaConta = { id: 'ch-jur', label: 'Oficial', kind: 'meta' };
    await rodar();
    expect(escritasNaConversa()[0]?.payload).toEqual({ channel_id: 'ch-jur', channel_pinned: true });
  });

  it('⚠️ contato sem telefone nem usuário: FALHA', async () => {
    h.state.owned = { id: 'c1', phone: null, wa_user_id: null };
    await rodar();
    expect(escritasNaConversa()).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('não tem telefone nem usuário');
  });

  it('⚠️ conversa de grupo: FALHA (o número do grupo é o de `cb_groups`)', async () => {
    h.state.conversaLida = { group_id: 'g1', channel_id: null, channel_pinned: false };
    await rodar();
    expect(escritasNaConversa()).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('não vale em conversa de grupo');
  });

  it('sem conexão escolhida: FALHA com o motivo, sem ler nada', async () => {
    await rodar({ channel_id: '' });
    expect(escritasNaConversa()).toHaveLength(0);
    expect(h.state.fromCalls).not.toContain('cb_channels');
    expect(JSON.stringify(h.state.logUpdates)).toContain('nenhuma conexão escolhida');
  });
});

describe('atlas_criar_cliente — criar cliente no Atlas (Fase 0)', () => {
  const dataDe = (field_key: string, value: string, account_id = ACCOUNT) => ({
    value,
    custom_fields: { field_key, field_type: 'datetime', account_id },
  });

  function passoAtlas(step_config: Record<string, unknown>) {
    return {
      id: 's-atlas',
      automation_id: 'a1',
      step_type: 'atlas_criar_cliente',
      position: 0,
      parent_step_id: null,
      step_config,
    };
  }

  async function rodar(step_config: Record<string, unknown>, context: Record<string, unknown> = {}) {
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAtlas(step_config)];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context,
    });
  }

  function passos() {
    return h.state.logUpdates.flatMap(
      (u) => (u.steps_executed as { status: string; detail?: string }[] | undefined) ?? []
    );
  }

  const entrada = () => atlasMock.criarOuReativarNoAtlas.mock.calls.at(-1)?.[1];

  beforeEach(() => {
    atlasMock.criarOuReativarNoAtlas.mockReset();
    atlasMock.criarOuReativarNoAtlas.mockResolvedValue({ acao: 'criado', atlasClientId: 'atl-1' });
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.exemplo.com/');
    h.state.owned = { id: 'c1', name: 'Ana Souza', phone: '5583999990000', email: 'ana@exemplo.com' };
    // Não é zerada no `beforeEach` de fora.
    h.state.esperasEnfileiradas = [];
    h.state.catalogoDeCampos = [
      { field_key: 'data_do_primeiro_contato', field_type: 'datetime' },
      { field_key: 'data_da_proposta', field_type: 'datetime' },
      { field_key: 'data_de_fechamento_do_contrato', field_type: 'datetime' },
      { field_key: 'origem_da_divida', field_type: 'text' },
    ];
    h.state.erroNoCatalogoDeCampos = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('CRÍTICO: monta a entrada pelas leituras do motor — ficha, card, campos de data CRUS, link da conversa e a chave <logId>:<stepId>', async () => {
    h.state.dealExistente = {
      id: 'd1',
      value: 3500.5,
      created_at: '2025-07-09T19:25:23.000003+00:00',
    } as unknown as { id: string };
    h.state.customValues = [
      dataDe('data_do_primeiro_contato', '2026-09-01T12:00:00.000Z'),
      dataDe('data_da_proposta', '2026-09-10T13:30:00.000Z'),
      dataDe('data_de_fechamento_do_contrato', '2026-09-29T02:10:00.000Z'),
      // Mesma chave, OUTRA conta: nunca entra.
      dataDe('campo_de_outra_conta', '2020-01-01T00:00:00.000Z', 'acct-2'),
    ];
    await rodar(
      {
        tipo_de_contrato: 'mensal',
        campo_primeiro_contato: 'data_do_primeiro_contato',
        campo_proposta: ' data_da_proposta ',
        campo_fechamento: 'data_de_fechamento_do_contrato',
      },
      { conversation_id: 'conv1', deal_id: 'd1' }
    );

    expect(atlasMock.criarOuReativarNoAtlas).toHaveBeenCalledTimes(1);
    expect(entrada()).toEqual({
      accountId: ACCOUNT,
      contactId: 'c1',
      chaveDeIdempotencia: 'log1:s-atlas',
      contato: { nome: 'Ana Souza', telefone: '5583999990000', email: 'ana@exemplo.com' },
      negocio: { valor: 3500.5, criadoEm: '2025-07-09T19:25:23.000003+00:00' },
      datas: {
        primeiroContato: '2026-09-01T12:00:00.000Z',
        proposta: '2026-09-10T13:30:00.000Z',
        fechamento: '2026-09-29T02:10:00.000Z',
      },
      linkDaConversa: 'https://crm.exemplo.com/inbox?c=conv1',
      conversaDaExecucao: 'conv1',
      tipoDeContrato: 'mensal',
      agora: expect.any(Date),
    });
    // O card é LIDO pelo id do contexto e pela conta.
    expect(
      h.state.dealSelects.some(
        (f) =>
          f.some(([op, k, v]) => op === 'eq' && k === 'id' && v === 'd1') &&
          f.some(([op, k, v]) => op === 'eq' && k === 'account_id' && v === ACCOUNT)
      )
    ).toBe(true);
    expect(passos()).toContainEqual(
      expect.objectContaining({ step_type: 'atlas_criar_cliente', status: 'success', detail: 'cliente criado no Atlas' })
    );
  });

  it('sem campos escolhidos, sem card e sem conversa: datas, negócio e link vão nulos; contrato fixo por padrão', async () => {
    h.state.customValues = [dataDe('data_do_primeiro_contato', '2026-09-01T12:00:00.000Z')];
    h.state.owned = { id: 'c1', name: 'Ana Souza', phone: '', email: '' };
    await rodar({});

    expect(entrada()).toMatchObject({
      contato: { nome: 'Ana Souza', telefone: null, email: null },
      negocio: null,
      datas: { primeiroContato: null, proposta: null, fechamento: null },
      linkDaConversa: null,
      conversaDaExecucao: null,
      tipoDeContrato: 'fixo',
    });
    // Nenhuma conversa criada: o passo não fala com o contato.
    expect(destinatarioMock.conversaDoContato).not.toHaveBeenCalled();
  });

  it('sem conversa no contexto, o link é o da conversa MAIS ANTIGA do contato (como o {{conversation.link}})', async () => {
    h.state.conversasDoContato = [{ id: 'conv-antiga' }];
    await rodar({});
    expect(entrada()?.linkDaConversa).toBe('https://crm.exemplo.com/inbox?c=conv-antiga');
  });

  it('campo escolhido sem valor na ficha vai nulo (o Atlas usa a reserva)', async () => {
    await rodar({ campo_fechamento: 'data_de_fechamento_do_contrato' });
    expect((entrada()?.datas as Record<string, unknown>).fechamento).toBeNull();
  });

  it('⚠️ campo escolhido que SUMIU do catálogo (ou não é de data) FALHA o passo — a reserva viraria data errada no Atlas', async () => {
    await rodar({ campo_fechamento: 'campo_apagado' });
    expect(atlasMock.criarOuReativarNoAtlas).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain('o campo de data \\"campo_apagado\\" escolhido no passo não existe mais');
    atlasMock.criarOuReativarNoAtlas.mockClear();
    await rodar({ campo_proposta: 'origem_da_divida' });
    expect(atlasMock.criarOuReativarNoAtlas).not.toHaveBeenCalled();
  });

  it('leitura do catálogo de campos que falha FALHA o passo sem chamar o Atlas', async () => {
    h.state.erroNoCatalogoDeCampos = 'fora do ar';
    await rodar({ campo_fechamento: 'data_de_fechamento_do_contrato' });
    expect(atlasMock.criarOuReativarNoAtlas).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain('a leitura dos campos de data falhou');
  });

  it('o detalhe diz o que aconteceu no Atlas (reativado)', async () => {
    atlasMock.criarOuReativarNoAtlas.mockResolvedValue({
      acao: 'reativado',
      atlasClientId: 'atl-1',
      situacaoAnterior: 'rescindido',
    });
    await rodar({});
    expect(passos()).toContainEqual(
      expect.objectContaining({ status: 'success', detail: 'cadastro reativado no Atlas (estava rescindido)' })
    );
  });

  it('⚠️ a falha do Atlas FALHA o passo com o motivo, e a execução termina', async () => {
    atlasMock.criarOuReativarNoAtlas.mockRejectedValue(
      new Error('o Atlas não está conectado (Configurações → Integrações)')
    );
    await rodar({});
    expect(passos()).toContainEqual(
      expect.objectContaining({
        step_type: 'atlas_criar_cliente',
        status: 'failed',
        detail: 'o Atlas não está conectado (Configurações → Integrações)',
      })
    );
    expect(h.state.logUpdates).toContainEqual(expect.objectContaining({ desfecho: 'falhou' }));
    // Fora de PASSOS_DE_ENVIO: nada volta para a fila.
    expect(h.state.esperasEnfileiradas).toHaveLength(0);
  });

  it('⚠️ leitura do CRM que falha FALHA o passo sem chamar o Atlas (o vazio viraria dado gravado lá)', async () => {
    h.state.erroNoNegocio = 'fora do ar';
    await rodar({}, { deal_id: 'd1' });
    expect(atlasMock.criarOuReativarNoAtlas).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain('a leitura dos dados do cliente no CRM falhou');
  });

  it('tipo de contrato desconhecido: FALHA antes de ler ou chamar', async () => {
    await rodar({ tipo_de_contrato: 'anual' });
    expect(atlasMock.criarOuReativarNoAtlas).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain('tipo de contrato desconhecido');
  });

  it('⚠️ execução SEM registro (espera antiga sem log_id): não chama o Atlas', async () => {
    h.state.automations = [{ ...automationWithUpdateStep(), id: 'a-resume' }];
    h.state.steps = [{ ...passoAtlas({}), automation_id: 'a-resume', position: 1 }];
    await resumePendingExecution({
      id: 'espera-sem-log',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: null,
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });
    expect(atlasMock.criarOuReativarNoAtlas).not.toHaveBeenCalled();
  });
});

function automationWithUpdateStep() {
  return {
    id: 'a1',
    account_id: ACCOUNT,
    user_id: 'u1',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'update_contact_field',
    position: 0,
    parent_step_id: null,
    step_config: { field: 'company', value: 'pwned-by-automation' },
  };
}

function customStep(field: string, value: string) {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'update_contact_field',
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

describe('triggerMatches — interactive_reply', () => {
  function automation(reply_ids: string[]): Automation {
    return {
      id: 'a1',
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'menu step',
      trigger_type: 'interactive_reply',
      trigger_config: { reply_ids },
      is_active: true,
      execution_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  it('matches when the tapped id is in reply_ids (exact)', () => {
    expect(
      triggerMatches(automation(['yes', 'no']), { interactive_reply_id: 'yes' })
    ).toBe(true);
  });

  it('does not match a different id', () => {
    expect(
      triggerMatches(automation(['yes']), { interactive_reply_id: 'maybe' })
    ).toBe(false);
  });

  it('does not match on a substring (exact only)', () => {
    expect(
      triggerMatches(automation(['yes']), {
        interactive_reply_id: 'yes_please',
      })
    ).toBe(false);
  });

  it('does not match when no reply id is present or config is empty', () => {
    expect(triggerMatches(automation(['yes']), {})).toBe(false);
    expect(
      triggerMatches(automation([]), { interactive_reply_id: 'yes' })
    ).toBe(false);
  });
});

describe('triggerMatches — tag_added', () => {
  function automation(tagId?: string): Automation {
    return {
      id: 'a1',
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'tag follow-up',
      trigger_type: 'tag_added',
      trigger_config: tagId ? { tag_id: tagId } : {},
      is_active: true,
      execution_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  it('matches only the exact tag id', () => {
    expect(triggerMatches(automation('tag-a'), { tag_id: 'tag-a' })).toBe(true);
    expect(triggerMatches(automation('tag-a'), { tag_id: 'tag-ab' })).toBe(
      false
    );
  });

  it('fails closed when the config or event tag is missing', () => {
    expect(triggerMatches(automation(), { tag_id: 'tag-a' })).toBe(false);
    expect(triggerMatches(automation('tag-a'), {})).toBe(false);
    expect(triggerMatches(automation('tag-a'), undefined)).toBe(false);
  });
});

describe('triggerMatches — date_field_offset (952)', () => {
  function lembrete(id: string): Automation {
    return {
      id,
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'lembrete',
      trigger_type: 'date_field_offset',
      trigger_config: {
        fonte: 'reuniao',
        offset_hours: 24,
        direction: 'antes',
      },
      is_active: true,
      execution_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  it('⚠️ roda SÓ a automação carimbada no contexto', () => {
    // O "aconteceu?" deste gatilho é decidido pela varredura, fora do motor.
    // Sem o recorte, o alvo de um lembrete executava TODOS os lembretes da
    // conta — o de 48h saía junto com o de 24h, fora da própria janela.
    expect(triggerMatches(lembrete('a1'), { automation_id: 'a1' })).toBe(true);
    expect(triggerMatches(lembrete('a2'), { automation_id: 'a1' })).toBe(false);
  });

  it('fail closed: sem carimbo no contexto, nada roda', () => {
    // Inclusive o dispatch manual (POST /api/automations/engine) sem
    // automation_id — rodar "todos, agora" ignoraria as datas.
    expect(triggerMatches(lembrete('a1'), {})).toBe(false);
    expect(triggerMatches(lembrete('a1'), undefined)).toBe(false);
  });
});

describe('triggerMatches — a régua do Asaas (998)', () => {
  function regua(id: string, tipo: 'asaas_cobranca_vencida' | 'asaas_cobranca_vence_hoje'): Automation {
    return {
      id,
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'cobrança',
      trigger_type: tipo,
      trigger_config: tipo === 'asaas_cobranca_vencida' ? { dias_de_atraso: 5 } : {},
      is_active: true,
      execution_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  it('⚠️ roda SÓ a automação carimbada no contexto, nos DOIS gatilhos', () => {
    // O "aconteceu?" é decidido pela varredura; o dispatch por tipo rodaria
    // a de 5 dias junto com a de 1 (a mesma cerca do `date_field_offset`).
    expect(triggerMatches(regua('a1', 'asaas_cobranca_vencida'), { automation_id: 'a1' })).toBe(true);
    expect(triggerMatches(regua('a2', 'asaas_cobranca_vencida'), { automation_id: 'a1' })).toBe(false);
    expect(triggerMatches(regua('l1', 'asaas_cobranca_vence_hoje'), { automation_id: 'l1' })).toBe(true);
    expect(triggerMatches(regua('l2', 'asaas_cobranca_vence_hoje'), { automation_id: 'l1' })).toBe(false);
  });

  it('fail closed: sem carimbo no contexto, nada roda', () => {
    expect(triggerMatches(regua('a1', 'asaas_cobranca_vencida'), {})).toBe(false);
    expect(triggerMatches(regua('a1', 'asaas_cobranca_vencida'), undefined)).toBe(false);
    expect(triggerMatches(regua('l1', 'asaas_cobranca_vence_hoje'), {})).toBe(false);
  });
});

describe('tag_added — conversation policy', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockClear();
    destinatarioMock.conversaDoContato.mockClear();
  });

  // Até 27/09/2026 o passo falhava com "tag_added automation cannot send:
  // contact has no existing conversation" (upstream). A etiqueta que a
  // integração aplica pela API (o lead de anúncio) é justamente a ficha sem
  // conversa — agora a conversa nasce ENCERRADA e a mensagem sai por ela.
  it('contato sem conversa: a conversa nasce ENCERRADA e a mensagem sai por ela', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [
      {
        id: 'a1',
        account_id: ACCOUNT,
        user_id: 'u1',
        name: 'tag outreach',
        trigger_type: 'tag_added',
        trigger_config: { tag_id: 'tag-a' },
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: 's1',
        automation_id: 'a1',
        step_type: 'send_message',
        position: 0,
        parent_step_id: null,
        step_config: { text: 'Hello' },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'tag_added',
      contactId: 'c1',
      context: { tag_id: 'tag-a' },
    });

    expect(destinatarioMock.conversaDoContato).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      'c1',
      { conversaNovaEncerrada: true }
    );
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'conv-criada',
      contactId: 'c1',
      text: 'Hello',
    });
    expect(JSON.stringify(h.state.logUpdates)).not.toContain(
      'no existing conversation'
    );
  });
});

describe('triggerMatches — keyword_match', () => {
  function automation(
    cfg: Partial<KeywordMatchTriggerConfig> & { keywords: string[] }
  ): Automation {
    return {
      id: 'a1',
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'kw',
      trigger_type: 'keyword_match',
      trigger_config: { match_type: 'contains', ...cfg },
      is_active: true,
    } as unknown as Automation;
  }

  const on = (a: Automation, text: string) =>
    triggerMatches(a, { message_text: text });

  it('keeps `contains` as a raw substring test', () => {
    // Issue #409 asked for this to become word-boundary matching. It
    // deliberately did NOT change: existing automations relying on
    // substring behaviour ("cat" firing on "category") must keep working,
    // and `contains` is the builder's default. `word` is the opt-in fix.
    expect(on(automation({ keywords: ['k'] }), 'thanks')).toBe(true);
    expect(on(automation({ keywords: ['cat'] }), 'category')).toBe(true);
  });

  it('`word` matches only standalone words', () => {
    const a = automation({ keywords: ['k'], match_type: 'word' });
    expect(on(a, 'thanks')).toBe(false);
    expect(on(a, 'k')).toBe(true);
    expect(on(a, 'press k to continue')).toBe(true);
    expect(on(a, 'press K!')).toBe(true);
  });

  it('`word` respects punctuation and line edges around the keyword', () => {
    const a = automation({ keywords: ['hi'], match_type: 'word' });
    expect(on(a, 'hi')).toBe(true);
    expect(on(a, 'hi!')).toBe(true);
    expect(on(a, '(hi)')).toBe(true);
    expect(on(a, 'say hi.')).toBe(true);
    expect(on(a, 'this')).toBe(false);
    expect(on(a, 'hiya')).toBe(false);
  });

  it('`word` handles a keyword that itself carries punctuation', () => {
    // `\b` can't do this: /\bhi!\b/ demands a word char after the "!",
    // so it never matches. Hence the lookaround implementation.
    const a = automation({ keywords: ['hi!'], match_type: 'word' });
    expect(on(a, 'say hi!')).toBe(true);
    expect(on(a, 'hi! there')).toBe(true);
  });

  it('`word` treats regex metacharacters in a keyword as literal', () => {
    // Account-supplied free text — an unescaped "(" would throw.
    const a = automation({ keywords: ['c++ (beginner)'], match_type: 'word' });
    expect(on(a, 'I want the c++ (beginner) course')).toBe(true);
    expect(on(a, 'I want the cxx beginner course')).toBe(false);
    expect(() =>
      on(automation({ keywords: ['('], match_type: 'word' }), '(')
    ).not.toThrow();
  });

  it('`word` is case-insensitive unless case_sensitive is set', () => {
    expect(on(automation({ keywords: ['Hi'], match_type: 'word' }), 'hi')).toBe(
      true
    );
    expect(
      on(
        automation({
          keywords: ['Hi'],
          match_type: 'word',
          case_sensitive: true,
        }),
        'hi'
      )
    ).toBe(false);
    expect(
      on(
        automation({
          keywords: ['Hi'],
          match_type: 'word',
          case_sensitive: true,
        }),
        'Hi'
      )
    ).toBe(true);
  });

  it('`word` finds a space-delimited keyword in a non-Latin script', () => {
    // ASCII `\b` fails outright here — every character of "안녕" is a
    // non-word character to it, so /\b안녕\b/ matches nothing.
    const a = automation({ keywords: ['안녕'], match_type: 'word' });
    expect(on(a, '안녕')).toBe(true);
    expect(on(a, '저기 안녕 하세요')).toBe(true);
    // Documented limitation, not an accident: a language written without
    // spaces has no word edge inside a run of characters.
    expect(on(a, '안녕하세요')).toBe(false);
  });

  it('`exact` still requires the whole message to be the keyword', () => {
    const a = automation({ keywords: ['hi'], match_type: 'exact' });
    expect(on(a, 'hi')).toBe(true);
    expect(on(a, 'hi there')).toBe(false);
  });

  it('ignores empty keywords and empty messages in `word` mode', () => {
    expect(
      on(automation({ keywords: [''], match_type: 'word' }), 'anything')
    ).toBe(false);
    expect(on(automation({ keywords: ['hi'], match_type: 'word' }), '')).toBe(
      false
    );
  });
});

// ------------------------------------------------------------
// send_to_number (977): avisa um NÚMERO fixo, não o contato do disparo.
// ------------------------------------------------------------

function passoAvisar(step_config: Record<string, unknown>) {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'send_to_number',
    position: 0,
    parent_step_id: null,
    step_config,
  };
}

async function dispararAviso(
  step_config: Record<string, unknown>,
  context: Record<string, unknown> = {}
) {
  h.state.owned = { id: 'c1' };
  h.state.automations = [automationWithUpdateStep()];
  h.state.steps = [passoAvisar(step_config)];
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    context: {
      conversation_id: 'conv-cliente',
      channel_id: 'ch-do-cliente',
      ...context,
    },
  });
}

describe('send_to_number — aviso para a equipe', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockClear();
    destinatarioMock.resolverDestinatario.mockClear();
    canalMock.resolveEngineChannelPreferring.mockClear();
  });

  it('manda para a conversa do NÚMERO avisado, com o texto interpolado, pela conexão do passo', async () => {
    await dispararAviso(
      {
        phone: '(83) 98000-0016',
        contact_name: 'Leonardo',
        text: 'Novo agendamento: {{vars.agendamento_nome}}',
        channel_id: 'ch-comercial',
      },
      { vars: { agendamento_nome: 'Marcelo' } }
    );
    expect(destinatarioMock.resolverDestinatario).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      '5583980000016',
      'Leonardo'
    );
    const args = vi.mocked(engineSendText).mock.calls[0]?.[0];
    expect(args?.conversationId).toBe('conv-equipe');
    expect(args?.contactId).toBe('equipe-1');
    expect(args?.text).toBe('Novo agendamento: Marcelo');
    expect(args?.preferredChannelId).toBe('ch-comercial');
  });

  it('CRÍTICO: sem conexão no passo NÃO herda o canal do disparo (é o número do cliente, não o da equipe)', async () => {
    await dispararAviso({ phone: '5583980000016', text: 'oi' });
    const args = vi.mocked(engineSendText).mock.calls[0]?.[0];
    expect(args?.preferredChannelId).toBeUndefined();
  });

  it('CRÍTICO: conexão pedida que não resolve FALHA, em vez de sair por outro número', async () => {
    canalMock.resolveEngineChannelPreferring.mockResolvedValueOnce({
      channelId: 'ch-padrao',
    });
    await dispararAviso({
      phone: '5583980000016',
      text: 'oi',
      channel_id: 'ch-apagado',
    });
    expect(engineSendText).not.toHaveBeenCalled();
    // ⚠️ O update do STATUS, não o último: desde a 985 `fecharLog` escreve
    // depois dele (o desfecho e, em update próprio, a hora de fim).
    const log = h.state.logUpdates.filter((u) => 'status' in u).at(-1) as
      { status?: string; error_message?: string } | undefined;
    expect(log?.status).toBe('failed');
    expect(log?.error_message).toContain('conexão escolhida');
  });

  it('telefone inválido falha antes de criar ficha', async () => {
    await dispararAviso({ phone: '123', text: 'oi' });
    expect(destinatarioMock.resolverDestinatario).not.toHaveBeenCalled();
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it.each([
    // A régua dos sistemas (até a Fase 3-III) aceitava os dois: "98000-0016"
    // virava +98, e o LID de um contato virava telefone — os 15 dígitos dele
    // como destino do aviso. (O JID de pessoa, `…@s.whatsapp.net`, caía no
    // número certo por acaso; agora é recusado junto, por não ser número.)
    ['sem DDD', '98000-0016', 'curto demais (faltou o DDD?)'],
    ['LID colado', '123456789012345@lid', 'não é um número'],
  ])('%s falha antes de criar ficha (a régua das telas)', async (_caso, phone, frase) => {
    await dispararAviso({ phone, text: 'oi' });
    expect(destinatarioMock.resolverDestinatario).not.toHaveBeenCalled();
    expect(engineSendText).not.toHaveBeenCalled();
    const log = h.state.logUpdates.filter((u) => 'status' in u).at(-1) as
      { status?: string; error_message?: string } | undefined;
    expect(log?.status).toBe('failed');
    // A frase, nunca o código do motivo ("curto"/"invalido").
    expect(log?.error_message).toContain(`send_to_number: telefone inválido — ${frase}`);
  });

  it('texto vazio depois da interpolação falha antes de enviar', async () => {
    await dispararAviso({ phone: '5583980000016', text: '{{vars.nada}}' });
    expect(engineSendText).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// calendly_booking (977): vazio = qualquer evento; URI = só aquele.
// ------------------------------------------------------------

describe('triggerMatches — calendly_booking', () => {
  const auto = (trigger_config: Record<string, unknown>) =>
    ({
      id: 'a1',
      trigger_type: 'calendly_booking',
      trigger_config,
    }) as unknown as Automation;

  it('config vazia dispara para qualquer evento — inclusive sem URI no contexto', () => {
    expect(
      triggerMatches(auto({}), {
        calendly_event_type: 'https://api.calendly.com/event_types/A',
      })
    ).toBe(true);
    expect(triggerMatches(auto({ event_type_uri: '' }), {})).toBe(true);
    expect(triggerMatches(auto({}), undefined)).toBe(true);
  });

  it('com URI, só o evento igual', () => {
    const a = auto({
      event_type_uri: 'https://api.calendly.com/event_types/A',
    });
    expect(
      triggerMatches(a, {
        calendly_event_type: 'https://api.calendly.com/event_types/A',
      })
    ).toBe(true);
    expect(
      triggerMatches(a, {
        calendly_event_type: 'https://api.calendly.com/event_types/B',
      })
    ).toBe(false);
  });

  it('com URI e disparo sem evento, falha fechado', () => {
    expect(
      triggerMatches(
        auto({ event_type_uri: 'https://api.calendly.com/event_types/A' }),
        {}
      )
    ).toBe(false);
  });

  // "Ignorar reagendamentos" (28/09/2026): o Calendly manda a remarcação como
  // invitee.created NOVO; a sequência de boas-vindas não pode sair de novo.
  it('ignorar_reagendamento === true: o reagendamento não dispara; o novo, sim', () => {
    const uri = 'https://api.calendly.com/event_types/A';
    const a = auto({ event_type_uri: uri, ignorar_reagendamento: true });
    expect(
      triggerMatches(a, {
        calendly_event_type: uri,
        vars: { agendamento_situacao: 'Reagendamento' },
      })
    ).toBe(false);
    expect(
      triggerMatches(a, {
        calendly_event_type: uri,
        vars: { agendamento_situacao: 'Novo agendamento' },
      })
    ).toBe(true);
    // Config vazia de evento também respeita a caixa.
    expect(
      triggerMatches(auto({ ignorar_reagendamento: true }), {
        vars: { agendamento_situacao: 'Reagendamento' },
      })
    ).toBe(false);
  });

  it('sem a caixa (ou com valor que não é o booleano true), o reagendamento dispara como antes', () => {
    const uri = 'https://api.calendly.com/event_types/A';
    const ctx = {
      calendly_event_type: uri,
      vars: { agendamento_situacao: 'Reagendamento' },
    };
    expect(triggerMatches(auto({ event_type_uri: uri }), ctx)).toBe(true);
    expect(
      triggerMatches(auto({ event_type_uri: uri, ignorar_reagendamento: false }), ctx)
    ).toBe(true);
    expect(
      triggerMatches(auto({ event_type_uri: uri, ignorar_reagendamento: 'true' }), ctx)
    ).toBe(true);
  });
});

// ------------------------------------------------------------
// Variáveis do CONTATO (977): {{contact.*}} e {{conversation.link}}.
// ------------------------------------------------------------

describe('interpolate — variáveis do contato', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockClear();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.exemplo.com/');
  });

  async function textoEnviado(
    text: string,
    context: Record<string, unknown> = {}
  ) {
    h.state.owned = {
      id: 'c1',
      name: 'Marcelo',
      phone: '5596990000016',
      email: 'm@x.com',
      company: null,
    } as unknown as { id: string };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1', ...context },
    });
    return vi.mocked(engineSendText).mock.calls[0]?.[0]?.text;
  }

  it('lê nome, telefone e e-mail do contato, e o link da conversa do disparo', async () => {
    const texto = await textoEnviado(
      '{{contact.name}} · {{contact.phone}} · {{contact.email}} · {{conversation.link}}'
    );
    expect(texto).toBe(
      'Marcelo · 5596990000016 · m@x.com · https://crm.exemplo.com/inbox?c=conv1'
    );
  });

  it("campo personalizado ausente vira vazio, nunca 'undefined'; empresa nula idem", async () => {
    const texto = await textoEnviado(
      '[{{contact.campo.tamanho_da_divida}}] [{{contact.company}}] [{{contact.nada}}]'
    );
    expect(texto).toBe('[] [] []');
  });

  it('{{contact.origem}} junta campanha - conjunto - anúncio, só as partes preenchidas', async () => {
    // O mock de contact_custom_values devolve null: sem campos, a origem é vazia
    // (nunca " -  - ", que foi o que o primeiro aviso real imprimiu).
    expect(await textoEnviado('[{{contact.origem}}]')).toBe('[]');
  });

  it('link da ficha do contato', async () => {
    expect(await textoEnviado('{{contact.link}}')).toBe(
      'https://crm.exemplo.com/contacts?contact=c1'
    );
  });

  it('texto sem `contact.` NÃO consulta o contato (só a guarda de posse)', async () => {
    h.state.fromCalls = [];
    await textoEnviado('oi {{vars.x}}');
    expect(
      h.state.fromCalls.filter((t) => t === 'contact_custom_values')
    ).toHaveLength(0);
  });

  it('texto com `contact.` consulta o contato UMA vez por execução', async () => {
    h.state.fromCalls = [];
    await textoEnviado(
      '{{contact.name}} e de novo {{contact.name}} e {{contact.campo.x}}'
    );
    expect(
      h.state.fromCalls.filter((t) => t === 'contact_custom_values')
    ).toHaveLength(1);
  });
});

// ------------------------------------------------------------
// Ramo e espera (Codex, PR #128 — 2ª rodada). O que `dispararAutomacoes`
// devolve é o que o evento do Calendly grava: "disparado" tem de significar
// "rodou até o fim, sem falha". O mock de `automation_steps` recorta por
// escopo (lá em cima) justamente para estes testes.
// ------------------------------------------------------------

const condicao = {
  id: 'cond',
  automation_id: 'a1',
  step_type: 'condition',
  position: 0,
  parent_step_id: null,
  step_config: { subject: 'message_content', value: 'oi' },
};
const noRamo = (step: Record<string, unknown>) => ({
  ...step,
  id: `ramo-${String(step.step_type)}`,
  parent_step_id: 'cond',
  branch: 'yes',
  position: 0,
});
const depoisDoRamo = { ...updateStep(), id: 'depois', position: 1 };
const espera = () => ({
  id: 'esp',
  automation_id: 'a1',
  step_type: 'wait',
  position: 0,
  parent_step_id: null,
  step_config: { amount: 1, unit: 'hours' },
});

async function dispararComRamo() {
  h.state.owned = { id: 'c1' };
  h.state.automations = [automationWithUpdateStep()];
  return dispararAutomacoes({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    context: { message_text: 'oi' },
  });
}
const ultimoStatusDoLog = () =>
  (
    h.state.logUpdates.filter((u) => 'status' in u).at(-1) as
      { status?: string } | undefined
  )?.status;

describe('dispararAutomacoes — o gancho antesDeExecutar', () => {
  // O Calendly fixa o nome da ficha por este gancho: ele só pode rodar quando
  // alguma automação VAI RODAR, e antes dela (Codex, PR #208).
  function disparar(antesDeExecutar: () => Promise<void>, channel_id?: string) {
    h.state.owned = { id: 'c1' };
    return dispararAutomacoes({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { message_text: 'oi', channel_id },
      antesDeExecutar,
    });
  }

  it('CRÍTICO: roda UMA vez, ANTES do primeiro passo, mesmo com várias automações', async () => {
    const ordem: string[] = [];
    h.state.automations = [automationWithUpdateStep(), { ...automationWithUpdateStep(), id: 'a2' }];
    h.state.steps = [updateStep()];
    const gancho = vi.fn(async () => {
      ordem.push('gancho:' + h.state.updateCalls.length);
    });
    const r = await disparar(gancho);
    expect(r.executadas).toBe(2);
    expect(gancho).toHaveBeenCalledTimes(1);
    // Nenhuma escrita de passo tinha acontecido quando o gancho rodou.
    expect(ordem).toEqual(['gancho:0']);
  });

  it('CRÍTICO: todas fora do escopo — o gancho NÃO roda', async () => {
    h.state.automations = [{ ...automationWithUpdateStep(), channel_ids: ['outro-canal'] }];
    h.state.steps = [updateStep()];
    const gancho = vi.fn(async () => {});
    const r = await disparar(gancho, 'este-canal');
    expect(r).toMatchObject({ candidatas: 1, foraDoEscopo: 1, executadas: 0 });
    expect(gancho).not.toHaveBeenCalled();
  });

  it('falha do gancho não segura o disparo', async () => {
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await disparar(async () => {
      throw new Error('ficha fora do ar');
    });
    expect(r.executadas).toBe(1);
    expect(h.state.updateCalls).toHaveLength(1);
    erro.mockRestore();
  });
});

describe('dispararAutomacoes — ramo e espera (Codex, 2ª rodada)', () => {
  it("CRÍTICO: passo que falha DENTRO do ramo derruba a execução: log 'failed', comFalha, e o passo seguinte ao ramo não roda", async () => {
    // "123" não é telefone: `send_to_number` lança antes de tocar em nada.
    h.state.steps = [
      condicao,
      noRamo(passoAvisar({ phone: '123', text: 'oi' })),
      depoisDoRamo,
    ];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 1, emEspera: 0 });
    expect(ultimoStatusDoLog()).toBe('failed');
    // `depois` escreve em contacts; antes ele rodava como se nada tivesse falhado.
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it('ramo que termina bem não muda nada: sucesso, e o passo seguinte ao ramo roda', async () => {
    h.state.steps = [condicao, noRamo(updateStep()), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 0 });
    expect(ultimoStatusDoLog()).toBe('success');
    expect(h.state.updateCalls).toHaveLength(2);
  });

  it("CRÍTICO: 'Aguardar' no escopo de fora é emEspera, não execução sem falha", async () => {
    h.state.steps = [espera(), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 1 });
    expect(ultimoStatusDoLog()).toBe('partial');
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("'Aguardar' DENTRO do ramo também é emEspera — mas o escopo de fora segue e o LOG termina por ele (semântica do upstream)", async () => {
    h.state.steps = [condicao, noRamo(espera()), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 1 });
    expect(h.state.updateCalls).toHaveLength(1);
    expect(ultimoStatusDoLog()).toBe('success');
  });
});

// ------------------------------------------------------------
// Passo "Criar tarefa" — a tarefa que a regra abre para a equipe.
//
// O que estes testes protegem: o prazo é RELATIVO ao dia do ESCRITÓRIO (não do
// contêiner, que roda em UTC), os nomes são carimbados no servidor, o
// responsável é conferido contra a conta, e o aviso SAI mesmo quando o
// responsável é o autor da automação — o contrário da rota da tela, de
// propósito, porque aqui a pessoa escreveu uma regra meses antes.
// ------------------------------------------------------------

function automacaoDeTarefa(cfg: Record<string, unknown>) {
  return {
    automacao: {
      id: 'a-tarefa',
      account_id: ACCOUNT,
      user_id: 'agente-fallback',
      name: 'Contrato fechado',
      trigger_type: 'new_message_received',
      trigger_config: {},
      is_active: true,
    },
    passo: {
      id: 's-tarefa',
      automation_id: 'a-tarefa',
      step_type: 'create_task',
      position: 0,
      parent_step_id: null,
      step_config: cfg,
    },
  };
}

describe('create_task', () => {
  it('abre a tarefa com prazo relativo, nomes carimbados e aviso', async () => {
    h.state.owned = { id: 'c1' };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: 'Conferir documentação de {{contact.name}}',
      responsavel_user_id: 'agente-fallback',
      prazo_em_dias: 1,
      hora: '09:00',
      importante: true,
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(1);
    const tarefa = h.state.taskInserts[0];
    expect(tarefa.account_id).toBe(ACCOUNT);
    expect(tarefa.contact_id).toBe('c1');
    expect(tarefa.responsavel_user_id).toBe('agente-fallback');
    // Carimbado do banco, não do config: é o que faz a autoria sobreviver à
    // saída do membro.
    expect(tarefa.responsavel_nome).toBe('Agente Um');
    expect(tarefa.criador_nome).toBe('Agente Um');
    expect(tarefa.vence_as).toBe('09:00:00');
    expect(tarefa.importante).toBe(true);
    expect(tarefa.tipo).toBe('tarefa');
    // Prazo relativo: 1 dia à frente do dia de HOJE no escritório.
    const hoje = diaNoFuso(new Date(), 'America/Sao_Paulo');
    expect(tarefa.vence_em).toBe(somarDias(hoje, 1));

    // Aviso: mesmo com o responsável sendo o autor da automação.
    expect(h.state.notifInserts).toHaveLength(1);
    expect(h.state.notifInserts[0]).toMatchObject({
      user_id: 'agente-fallback',
      type: 'task_assigned',
      task_id: 't-1',
      contact_id: 'c1',
    });
    // Sem conversa, de propósito: quem roteia o clique é `task_id`; com
    // `conversation_id` preenchido a tela levaria ao fio, não à tarefa.
    expect('conversation_id' in h.state.notifInserts[0]).toBe(false);
    expect(String(h.state.notifInserts[0].title)).toContain('Contrato fechado');
  });

  it('interpola o título com os dados do contato', async () => {
    h.state.owned = { id: 'c1', name: 'Joel' };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: 'Ligar para {{contact.name}}',
      responsavel_user_id: 'agente-fallback',
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts[0].titulo).toBe('Ligar para Joel');
  });

  it('sem prazo escrito, a tarefa é para HOJE', async () => {
    h.state.owned = { id: 'c1' };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: 'Assinar',
      responsavel_user_id: 'agente-fallback',
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts[0].vence_em).toBe(
      diaNoFuso(new Date(), 'America/Sao_Paulo')
    );
    // Sem hora = o dia inteiro, nunca "00:00".
    expect(h.state.taskInserts[0].vence_as).toBeNull();
  });

  it('recusa responsável que não é membro da conta, sem criar tarefa', async () => {
    h.state.owned = { id: 'c1' };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: 'Tarefa para fora',
      responsavel_user_id: 'gente-de-outro-escritorio',
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(0);
    expect(h.state.notifInserts).toHaveLength(0);
    // A falha fica no registro, com motivo — é onde o operador vai olhar.
    expect(JSON.stringify(h.state.logUpdates)).toContain('não é membro');
  });

  it('título vazio depois da interpolação não vira tarefa sem nome', async () => {
    h.state.owned = { id: 'c1' };
    const { automacao, passo } = automacaoDeTarefa({
      // A variável não resolve (não há campo), então o título inteiro some.
      titulo: '{{contact.campo.inexistente}}',
      responsavel_user_id: 'agente-fallback',
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(0);
  });
});

describe('interpolação de campo de DATA', () => {
  it('campo datetime sai formatado, nunca o ISO cru', async () => {
    h.state.owned = { id: 'c1' };
    h.state.customValues = [
      {
        value: '2026-08-30T19:00:00.000Z',
        custom_fields: {
          field_key: 'data_e_hora_reuniao',
          field_type: 'datetime',
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: 'a-msg',
        account_id: ACCOUNT,
        user_id: 'u1',
        trigger_type: 'new_message_received',
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: 's-msg',
        automation_id: 'a-msg',
        step_type: 'send_message',
        position: 0,
        parent_step_id: null,
        step_config: {
          text: 'Sua reunião é {{contact.campo.data_e_hora_reuniao}}.',
        },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(enviado.text).toBe('Sua reunião é 30/08/2026 às 16:00h.');
  });

  it('campo de texto continua saindo como está', async () => {
    h.state.owned = { id: 'c1' };
    h.state.customValues = [
      {
        value: 'https://meet.google.com/abc-defg-hij',
        custom_fields: {
          field_key: 'link_reuniao',
          field_type: 'text',
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: 'a-msg',
        account_id: ACCOUNT,
        user_id: 'u1',
        trigger_type: 'new_message_received',
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: 's-msg',
        automation_id: 'a-msg',
        step_type: 'send_message',
        position: 0,
        parent_step_id: null,
        step_config: { text: 'Link: {{contact.campo.link_reuniao}}' },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(enviado.text).toBe('Link: https://meet.google.com/abc-defg-hij');
  });

  it('data ilegível no campo cai no valor cru, não em vazio', async () => {
    // A coluna é TEXT livre — pode ter "amanhã de tarde" digitado à mão.
    // Melhor o cliente ler o que a pessoa escreveu do que uma frase truncada.
    h.state.owned = { id: 'c1' };
    h.state.customValues = [
      {
        value: 'amanhã de tarde',
        custom_fields: {
          field_key: 'data_e_hora_reuniao',
          field_type: 'datetime',
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: 'a-msg',
        account_id: ACCOUNT,
        user_id: 'u1',
        trigger_type: 'new_message_received',
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: 's-msg',
        automation_id: 'a-msg',
        step_type: 'send_message',
        position: 0,
        parent_step_id: null,
        step_config: { text: 'Reunião: {{contact.campo.data_e_hora_reuniao}}' },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(enviado.text).toBe('Reunião: amanhã de tarde');
  });
});

// ------------------------------------------------------------
// O MESMO campo de data em dois modos (achado do Codex no PR #152).
//
// Em texto para gente, formatado. Onde a saída é DADO — `update_contact_field`
// grava no banco, `send_webhook` fala com um sistema — cru. Trocar isto faz o
// campo copiado ficar ilegível para a tela e, pior, invisível para a varredura
// de lembretes (`cb_para_timestamp` de uma data em português devolve NULL, e o
// lembrete nunca sai).
// ------------------------------------------------------------

function comCampoDeData(passo: Record<string, unknown>) {
  h.state.owned = { id: 'c1' };
  h.state.customValues = [
    {
      value: '2026-08-30T19:00:00.000Z',
      custom_fields: {
        field_key: 'data_e_hora_reuniao',
        field_type: 'datetime',
        account_id: ACCOUNT,
      },
    },
  ];
  h.state.automations = [
    {
      id: 'a-cru',
      account_id: ACCOUNT,
      user_id: 'u1',
      trigger_type: 'new_message_received',
      trigger_config: {},
      is_active: true,
    },
  ];
  h.state.steps = [
    {
      id: 's-cru',
      automation_id: 'a-cru',
      position: 0,
      parent_step_id: null,
      ...passo,
    },
  ];
}

describe('campo de data: formatado na mensagem, CRU no dado', () => {
  it('update_contact_field grava o ISO, não a data em português', async () => {
    comCampoDeData({
      step_type: 'update_contact_field',
      step_config: {
        field: 'company',
        value: '{{contact.campo.data_e_hora_reuniao}}',
      },
    });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    const escrita = h.state.updateCalls.find((u) => u.table === 'contacts');
    expect(escrita).toBeDefined();
    // O payload do update passa pelo mock como `ops.payload`; aqui basta
    // provar que o valor gravado é o instante, não "30/08/2026 às 16:00h".
    expect(JSON.stringify(h.state.updateCalls)).not.toContain('às 16:00h');
  });

  it('send_webhook manda o ISO no corpo', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { body?: string }) =>
        ({ ok: true, status: 200 }) as unknown as Response
    );
    vi.stubGlobal('fetch', fetchMock);
    comCampoDeData({
      step_type: 'send_webhook',
      step_config: {
        // IP público literal: a guarda decide sem DNS (e sem mock, que
        // quebraria o teste vizinho que prova o BLOQUEIO). O fetch está
        // stubbed, então nada sai da máquina.
        url: 'https://8.8.8.8/hook',
        body_template: '{"quando":"{{contact.campo.data_e_hora_reuniao}}"}',
      },
    });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    vi.unstubAllGlobals();
    const corpo = String(fetchMock.mock.calls.at(-1)?.[1]?.body ?? '');
    expect(corpo).toContain('2026-08-30T19:00:00.000Z');
    expect(corpo).not.toContain('às 16:00h');
  });
});

// ------------------------------------------------------------
// Variáveis do NEGÓCIO e do instante (23/09/2026): {{deal.value}},
// {{deal.created_at}} e {{now}} — o que o aviso do contrato fechado manda ao
// sistema do escritório. Na mensagem, formatados; no webhook, crus. E o corpo
// do webhook ESCAPA cada valor: um nome com aspas quebrava o JSON inteiro.
// ------------------------------------------------------------

function comNegocio(passo: Record<string, unknown>) {
  h.state.owned = {
    id: 'c1',
    name: 'Ana "Aninha" Souza\nda Silva',
    phone: '558388745316',
  } as unknown as { id: string };
  h.state.dealExistente = {
    id: 'd1',
    value: 3500.5,
    created_at: '2025-07-09T19:25:23.000003+00:00',
  } as unknown as { id: string };
  h.state.automations = [automationWithUpdateStep()];
  h.state.steps = [
    {
      id: 's-neg',
      automation_id: 'a1',
      position: 0,
      parent_step_id: null,
      ...passo,
    },
  ];
}

async function dispararComNegocio(context: Record<string, unknown> = {}) {
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    context: { conversation_id: 'conv1', deal_id: 'd1', ...context },
  });
}

describe('{{deal.*}} e {{now}}', () => {
  beforeEach(() => vi.mocked(engineSendText).mockClear());

  it('na mensagem, valor em reais e data do negócio no formato do escritório', async () => {
    comNegocio({
      step_type: 'send_message',
      step_config: { text: '[{{deal.value}}] [{{deal.created_at}}]' },
    });
    await dispararComNegocio();
    const texto = vi.mocked(engineSendText).mock.calls[0]?.[0]?.text;
    // NBSP entre "R$" e o número — é o que o ICU produz (currency.ts).
    expect(texto).toBe('[R$\u00a03.500,50] [09/07/2025 às 16:25h]');
  });

  it('lê o negócio pelo id do contexto E pela conta', async () => {
    comNegocio({
      step_type: 'send_message',
      step_config: { text: '{{deal.value}}' },
    });
    await dispararComNegocio();
    const porId = h.state.dealSelects.find((f) =>
      f.some(([op, k, v]) => op === 'eq' && k === 'id' && v === 'd1')
    );
    expect(porId).toBeDefined();
    expect(
      porId!.some(([op, k, v]) => op === 'eq' && k === 'account_id' && v === ACCOUNT)
    ).toBe(true);
  });

  it('sem card no contexto nem aberto, lê o GANHO mais recente (só leitura)', async () => {
    comNegocio({
      step_type: 'send_message',
      step_config: { text: '{{deal.value}}' },
    });
    h.state.dealPorStatus = {
      open: null,
      lost: null,
      won: { id: 'dw', value: 1200, created_at: '2026-01-02T12:00:00Z' } as unknown as { id: string },
    };
    await dispararComNegocio({ deal_id: null });
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]?.text).toBe('R$\u00a01.200,00');
  });

  it('leitura do negócio que falha vira vazio e o passo segue', async () => {
    comNegocio({
      step_type: 'send_message',
      step_config: { text: '[{{deal.value}}]' },
    });
    h.state.erroNoNegocio = 'fora do ar';
    await dispararComNegocio();
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]?.text).toBe('[]');
  });

  it('a MENSAGEM não é escapada: aspas e quebra de linha chegam como são', async () => {
    comNegocio({
      step_type: 'send_message',
      step_config: { text: '{{contact.name}}' },
    });
    await dispararComNegocio();
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]?.text).toBe(
      'Ana "Aninha" Souza\nda Silva'
    );
  });

  it('{{now}} na mensagem sai formatado, nunca ISO', async () => {
    comNegocio({ step_type: 'send_message', step_config: { text: '{{now}}' } });
    await dispararComNegocio();
    const texto = String(vi.mocked(engineSendText).mock.calls[0]?.[0]?.text);
    expect(texto).toMatch(/^\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}h$/);
  });

  it('sem negócio, as variáveis saem vazias (nunca "undefined")', async () => {
    comNegocio({
      step_type: 'send_message',
      step_config: { text: '[{{deal.value}}][{{deal.created_at}}][{{deal.x}}]' },
    });
    h.state.dealExistente = null;
    await dispararComNegocio({ deal_id: null });
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]?.text).toBe('[][][]');
  });

  it('texto sem `deal.` não lê o negócio', async () => {
    comNegocio({ step_type: 'send_message', step_config: { text: 'oi' } });
    h.state.dealSelects = [];
    await dispararComNegocio();
    expect(h.state.dealSelects).toHaveLength(0);
  });

  it('webhook: valor e datas CRUS, e o corpo continua JSON válido com aspas e quebra de linha no nome', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { body?: string }) =>
        ({ ok: true, status: 200 }) as unknown as Response
    );
    vi.stubGlobal('fetch', fetchMock);
    comNegocio({
      step_type: 'send_webhook',
      step_config: {
        url: 'https://8.8.8.8/hook',
        body_template:
          '{"nome":"{{contact.name}}","valor":"{{deal.value}}","entrada":"{{deal.created_at}}","agora":"{{now}}"}',
      },
    });
    await dispararComNegocio();
    vi.unstubAllGlobals();

    const corpo = JSON.parse(
      String(fetchMock.mock.calls.at(-1)?.[1]?.body ?? '')
    ) as Record<string, string>;
    expect(corpo.nome).toBe('Ana "Aninha" Souza\nda Silva');
    expect(corpo.valor).toBe('3500.5');
    expect(corpo.entrada).toBe('2025-07-09T19:25:23.000Z');
    expect(corpo.agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('{{now}} no campo personalizado de data grava ISO — é o que a data da proposta usa', async () => {
    comNegocio({
      step_type: 'update_contact_field',
      step_config: { field: 'custom:cf1', value: '{{now}}' },
    });
    h.state.ownedCustomField = { id: 'cf1' };
    await dispararComNegocio();
    expect(h.state.upsertCalls).toHaveLength(1);
    expect((h.state.upsertCalls[0].payload as { value: string }).value).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });
});

// ------------------------------------------------------------
// DESFECHO da execução (migration 985).
//
// O que estes pinos protegem: a execução que uma condição barrou deixa de ser
// registrada como "concluída com sucesso" (era o defeito que motivou a
// feature), sem que `status` mude de vocabulário — as quatro telas que leem
// `status` sem cobertura de tipo continuam vendo os mesmos três valores.
// ------------------------------------------------------------

function automacaoSimples(id = 'a-desf') {
  return {
    id,
    account_id: ACCOUNT,
    user_id: 'u1',
    name: 'Contrato fechado',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: true,
  };
}

/** Condição no escopo raiz. Sem passo com este `parent_step_id`, o ramo é VAZIO. */
function passoCondicao(id: string, position: number) {
  return {
    id,
    automation_id: 'a-desf',
    step_type: 'condition',
    position,
    parent_step_id: null,
    step_config: { subject: 'tag_presence', operand: 'tag-x' },
  };
}

/**
 * Passo que representa TRABALHO FEITO. É `update_contact_field` e não
 * `add_tag` porque o harness mocka a escrita em `contacts`, enquanto `add_tag`
 * exige que a etiqueta exista na conta — o que aqui viraria falha e mediria
 * outra coisa.
 */
function passoDeTrabalho(id: string, position: number) {
  return {
    id,
    automation_id: 'a-desf',
    step_type: 'update_contact_field',
    position,
    parent_step_id: null,
    step_config: { field: 'company', value: 'trabalho feito' },
  };
}

const desfechoGravado = () =>
  h.state.logUpdates.filter((u) => 'desfecho' in u).at(-1) as
    { desfecho?: string; finalizado_em?: string } | undefined;

/**
 * ⚠️ A HORA DE FIM vem em UPDATE PRÓPRIO desde a 2ª rodada da revisão: a cerca
 * anti-regressão recusa a linha inteira quando o log já diz 'falhou', e
 * juntas as duas colunas a falha ficava para sempre sem hora de fim — ou
 * seja, invisível no fio, que exige as duas. Procurar `finalizado_em` dentro
 * do update do desfecho passaria a medir sempre `undefined`.
 */
const horaDeFimGravada = () =>
  (
    h.state.logUpdates.filter((u) => 'finalizado_em' in u).at(-1) as
      { finalizado_em?: string } | undefined
  )?.finalizado_em;

/** Os filtros do update que carregou a hora de fim (para provar que vai SEM cerca). */
const filtrosDaHoraDeFim = () => {
  const i = h.state.logUpdates.findIndex((u) => 'finalizado_em' in u);
  return i < 0 ? null : h.state.updateFiltros[i];
};

const statusGravado = () =>
  (
    h.state.logUpdates.filter((u) => 'status' in u).at(-1) as
      { status?: string } | undefined
  )?.status;

async function dispara() {
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    context: {},
  });
}

describe('retentativa de passo que falhou (13/09/2026)', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockReset();
    vi.mocked(engineSendText).mockResolvedValue({ whatsapp_message_id: 'm1' });
    // ⚠️ O acumulador é do harness e atravessa os testes: o "Aguardar" dos
    // blocos anteriores também enfileira, e sem esta linha a contagem daqui
    // mede o que outro teste fez.
    h.state.esperasEnfileiradas = [];
  });

  /** O cenário real: o aviso ao advogado falha e o card fica para trás. */
  async function avisoQueFalha(
    erro: unknown,
    context: Record<string, unknown> = {}
  ) {
    vi.mocked(engineSendText).mockRejectedValueOnce(erro);
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAvisar({ phone: '5583980000016', text: 'oi' })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-cliente', ...context },
    });
  }

  it('provedor RECUSOU (4xx): volta para a fila NA MESMA POSIÇÃO, e a execução não fecha', async () => {
    await avisoQueFalha(new EvolutionApiError('Error: Connection Closed', 400));

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    const fila = h.state.esperasEnfileiradas[0];
    // ⚠️ A posição do PRÓPRIO passo: é ele que roda de novo. O "Aguardar"
    // enfileira `position + 1` porque já terminou.
    expect(fila.next_step_position).toBe(0);
    // ⚠️ O contador vai AMARRADO À POSIÇÃO: guardar só o número contaria
    // por execução, e o próximo passo a falhar nasceria perto do teto.
    expect((fila.context as Record<string, unknown>)._tentativa).toEqual({
      pos: 0,
      n: 1,
    });
    expect(typeof fila.run_at).toBe('string');
    // Sem desfecho: a execução continua, como no "Aguardar".
    expect(desfechoGravado()?.desfecho).toBeUndefined();
  });

  it('⚠️ entrega INCERTA (5xx) não volta para a fila — a mensagem pode ter saído', async () => {
    await avisoQueFalha(new EvolutionApiError('timeout', 504));

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(desfechoGravado()?.desfecho).toBe('falhou');
  });

  it('⚠️ erro que não é do provedor não volta para a fila — não melhora sozinho', async () => {
    await avisoQueFalha(new Error('contact phone invalid: null'));

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(desfechoGravado()?.desfecho).toBe('falhou');
  });

  it('⚠️ execução JÁ interrompida não volta à fila pela retentativa (Codex, 4ª rodada)', async () => {
    h.state.interrompida = true;
    await avisoQueFalha(new EvolutionApiError('Error: Connection Closed', 400));

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    // Sem desfecho: cancelamento não é erro, e a execução não terminou por
    // conta própria — o mesmo estado da espera não estacionada.
    expect(desfechoGravado()?.desfecho).toBeUndefined();
  });

  it('⚠️ contador de OUTRO passo não consome as chances deste', async () => {
    // O passo 7 falhou duas vezes antes e se recuperou; este é o passo 0.
    await avisoQueFalha(new EvolutionApiError('recusado', 400), {
      _tentativa: { pos: 7, n: 2 },
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    expect(
      (h.state.esperasEnfileiradas[0].context as Record<string, unknown>)
        ._tentativa
    ).toEqual({ pos: 0, n: 1 });
  });

  it('⚠️ no TETO de tentativas desiste e grava a falha, em vez de reenfileirar para sempre', async () => {
    await avisoQueFalha(new EvolutionApiError('recusado de novo', 400), {
      _tentativa: { pos: 0, n: 2 },
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(desfechoGravado()?.desfecho).toBe('falhou');
    expect(horaDeFimGravada()).toBeTruthy();
  });
});

describe('desfecho da execução (985)', () => {
  it("condição de ramo vazio, sem trabalho: desfecho 'barrada' e status intocado", async () => {
    // É a trava por etiqueta da automação de contrato fechado: o ramo "sim"
    // existe vazio de propósito, para a segunda passada morrer nele.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoCondicao('s-cond', 0)];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('barrada');
    expect(horaDeFimGravada()).toBeTruthy();
    // ⚠️ `status` continua nos três valores do upstream — é o que impede as
    // telas que o leem sem cobertura de tipo de pintar "barrada" de vermelho.
    expect(statusGravado()).toBe('success');
  });

  it("marca a própria condição como 'skipped', para a tela dizer qual desviou", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoCondicao('s-cond', 0)];

    await dispara();

    const passos = h.state.logUpdates
      .flatMap(
        (u) => (u.steps_executed as Array<Record<string, unknown>>) ?? []
      )
      .filter((p) => p.step_type === 'condition');
    expect(passos.at(-1)).toMatchObject({
      step_id: 's-cond',
      status: 'skipped',
    });
  });

  it("barreira DEPOIS de trabalho feito é 'concluida', não 'barrada'", async () => {
    // A etiqueta foi aplicada; chamar a execução de interrompida faria o
    // operador ler "não rodou" sobre algo que rodou.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoDeTrabalho('s-tag', 0), passoCondicao('s-cond', 1)];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it('a regra não depende da ORDEM em steps_executed', async () => {
    // `[condição vazia][condição cheia]`: o ramo cheio faz seu próprio flush
    // ANTES do escopo de fora, então uma régua baseada em `at(-1)` acharia a
    // condição errada. Aqui a segunda condição tem um passo no ramo.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [
      passoCondicao('s-vazia', 0),
      passoCondicao('s-cheia', 1),
      {
        id: 's-dentro',
        automation_id: 'a-desf',
        step_type: 'update_contact_field',
        position: 0,
        parent_step_id: 's-cheia',
        // ⚠️ Ramo "no": o contato do harness não tem etiqueta, então
        // `tag_presence` reprova e é este o ramo que o motor escolhe. Pôr o
        // passo no "yes" deixaria os DOIS ramos vazios e o teste mediria
        // 'barrada' — o oposto do que ele existe para provar.
        branch: 'no',
        step_config: { field: 'company', value: 'dentro do ramo' },
      },
    ];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it("passo que falha vira desfecho 'falhou'", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    // `add_tag` sem tag_id estoura dentro do motor.
    h.state.steps = [
      {
        ...passoDeTrabalho('s-ruim', 0),
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('falhou');
    expect(statusGravado()).toBe('failed');
    // ⚠️ A FALHA TAMBÉM PRECISA DA HORA DE FIM, e sem esta linha o pino não
    // existia: um mutante que gateasse a 2ª escrita em `desfecho !== 'falhou'`
    // passava na suíte inteira (75/75) enquanto deixava toda execução falhada
    // invisível no fio, que exige as duas colunas (medido pela revisão).
    expect(horaDeFimGravada()).toBeTruthy();
  });

  it('CRÍTICO: espera VIVA adia a HORA DE FIM, mas o desfecho é gravado', async () => {
    // ⚠️ A régua mudou depois da revisão adversarial de 09/09: antes a espera
    // viva fazia `fecharLog` DESCARTAR o desfecho — e o 'falhou' de um escopo
    // cujo ramo continuava era perdido, para horas depois o resume daquele
    // ramo gravar 'concluida' por cima. Hoje o desfecho é gravado sempre; o
    // que a espera adia é só `finalizado_em`. Como a régua do fio exige os
    // DOIS, a execução continua não aparecendo como encerrada — sem que o
    // fato se perca.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoDeTrabalho('s-tag', 0)];
    h.state.esperasVivas = [{ id: 'espera-1' }];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
    expect(horaDeFimGravada()).toBeUndefined();
  });

  it("CRÍTICO: 'falhou' de um escopo NÃO é apagado pelo ramo que conclui depois", async () => {
    // O cenário que a revisão achou, no nível do que dá para observar aqui:
    // quando o desfecho não é 'falhou', o update sai com a cerca
    // `desfecho.is.null,desfecho.neq.falhou` — é ela que impede a regressão
    // no banco. 'falhou' grava sem cerca, porque é o pior desfecho.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [
      {
        ...passoDeTrabalho('s-ruim', 0),
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ];

    await dispara();

    const semCerca = h.state.updateFiltros.filter((f) =>
      f.some(([op]) => op === 'or')
    );
    expect(desfechoGravado()?.desfecho).toBe('falhou');
    expect(semCerca).toHaveLength(0);
  });
});

describe('desfecho depois de uma ESPERA (achado do teste ponta a ponta)', () => {
  it('CRÍTICO: o resume fecha o log, ignorando a própria espera que está processando', async () => {
    // ⚠️ Este pino nasceu de um defeito MEDIDO no preview em 09/09: a guarda
    // de `fecharLog` enxergava a espera que o cron acabou de reivindicar
    // (`status='running'`, que é ESTA execução), concluía que a automação
    // continuava e nunca fechava. Resultado: toda automação com "Aguardar"
    // terminava sem desfecho e ficava invisível no fio — para sempre.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoDeTrabalho('s-depois', 1), automation_id: 'a-resume' },
    ];
    // A espera em curso está `running` e é a que o resume está processando.
    h.state.esperasVivas = [{ id: 'espera-em-curso' }];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it('mas uma espera de OUTRO ramo, ainda viva, continua segurando o fechamento', async () => {
    // A exceção é só para a espera em processamento. Outra pendente do mesmo
    // log significa que a automação REALMENTE continua — é o follow-up de 30
    // dias com nove mensagens pela frente.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoDeTrabalho('s-depois', 1), automation_id: 'a-resume' },
    ];
    h.state.esperasVivas = [{ id: 'espera-em-curso' }, { id: 'outra-espera' }];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    // O desfecho é registrado; a HORA DE FIM é que espera a outra ponta.
    expect(desfechoGravado()?.desfecho).toBe('concluida');
    expect(horaDeFimGravada()).toBeUndefined();
  });
});

// ============================================================
// A 2ª rodada da revisão (Codex, PR #155). Os dois achados são do mesmo
// tronco: o desfecho é decidido por uma CHAMADA, e uma execução com
// "Aguardar" atravessa várias.
// ============================================================
describe('desfecho: os dois furos da 2ª rodada da revisão', () => {
  it('CRÍTICO: a HORA DE FIM vai SEM cerca — senão a falha nunca aparece', async () => {
    // ⚠️ O cenário: um ramo estoura enquanto a espera irmã segue viva, então o
    // log fica 'falhou' e SEM hora de fim. Horas depois a outra ponta termina
    // bem e chama `fecharLog` com 'concluida' — que sai com a cerca
    // `desfecho.is.null,desfecho.neq.falhou`. Com as duas colunas no MESMO
    // update, a cerca recusava a linha inteira e a hora de fim nunca era
    // gravada; como `itensDoFio` descarta linha sem hora de fim, a falha
    // sumia do fio e do histórico — some justamente o cartão vermelho.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoDeTrabalho('s-tag', 0)];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
    expect(horaDeFimGravada()).toBeTruthy();
    // O update do desfecho leva a cerca; o da hora de fim, não.
    expect(filtrosDaHoraDeFim()?.some(([op]) => op === 'or')).toBe(false);
    expect(
      h.state.updateFiltros.some((f) => f.some(([op]) => op === 'or'))
    ).toBe(true);
  });

  it("CRÍTICO: trabalho feito ANTES da espera impede o 'barrada' na retomada", async () => {
    // ⚠️ `[enviar][aguardar][condição de ramo vazio]` — a forma do follow-up
    // de no-show. A retomada não faz trabalho e acha a barreira, então os
    // contadores DELA dizem "barrada": "a automação não fez nada", sobre uma
    // execução que já mandou a mensagem. Quem sabe do trecho anterior é o
    // registro persistido.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoCondicao('s-cond', 1), automation_id: 'a-resume' },
    ];
    h.state.historicoDoLog = [
      { step_id: 's-enviou', step_type: 'send_message', status: 'success' },
      { step_id: 's-esperou', step_type: 'wait', status: 'success' },
    ];
    h.state.esperasVivas = [{ id: 'espera-em-curso' }];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it('sem trabalho nenhum no registro, a barreira da retomada CONTINUA valendo', async () => {
    // A cerca de cima não pode virar "nunca mais barra": execução que só
    // esperou e morreu numa trava é `barrada` de verdade.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoCondicao('s-cond', 1), automation_id: 'a-resume' },
    ];
    h.state.historicoDoLog = [
      { step_id: 's-esperou', step_type: 'wait', status: 'success' },
    ];
    h.state.esperasVivas = [{ id: 'espera-em-curso' }];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('barrada');
  });
});

// ============================================================
// Os DOIS fechadores irmãos que a 1ª tentativa da correção #2 não alcançou
// (medidos por dois céticos da revisão, que não conseguiram refutar).
//
// ⚠️ Importa mais do que parece: as automações deste escritório põem o
// "Aguardar" DENTRO do ramo da condição — é assim que a trava por etiqueta e o
// "ainda está em No Show?" gateiam de verdade, porque ramo vazio NÃO para o
// escopo de fora. Ou seja, o caminho de ramo é o comum aqui, não a borda.
// ============================================================
describe('desfecho: os fechadores que não têm o histórico em mão', () => {
  it("retomada de RAMO sem trabalho, com barreira no registro, é 'barrada'", async () => {
    h.state.automations = [automacaoSimples('a-resume')];
    // O escopo do ramo não tem mais passo depois da espera.
    h.state.steps = [];
    h.state.historicoDoLog = [
      {
        step_id: 's-cond',
        step_type: 'condition',
        status: 'skipped',
        detail: 'branch=no',
      },
      { step_id: 's-esperou', step_type: 'wait', status: 'success' },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: 's-pai',
      branch: 'yes',
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('barrada');
  });

  it("retomada de RAMO com trabalho no registro continua 'concluida'", async () => {
    // A correção não pode virar "tudo é barrada": mensagem que saiu antes da
    // espera manda no desfecho.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [];
    h.state.historicoDoLog = [
      { step_id: 's-enviou', step_type: 'send_message', status: 'success' },
      {
        step_id: 's-cond',
        step_type: 'condition',
        status: 'skipped',
        detail: 'branch=no',
      },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: 's-pai',
      branch: 'yes',
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it("retomada da RAIZ sem passo restante lê o registro em vez de cravar 'concluida'", async () => {
    // Alcançável sem nada de exótico: o motor enfileira `position + 1` sem
    // perguntar se sobrou passo, então "Aguardar" como ÚLTIMO passo cai aqui.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [];
    h.state.historicoDoLog = [
      {
        step_id: 's-cond',
        step_type: 'condition',
        status: 'skipped',
        detail: 'branch=no',
      },
      { step_id: 's-esperou', step_type: 'wait', status: 'success' },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('barrada');
  });

  it("automação SEM passo nenhum, no disparo fresco, continua 'concluida'", async () => {
    // O outro morador do mesmo ramo: registro vazio, e a resposta de sempre.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });
});

// ============================================================
// Passo "Parar automação": a marca no registro e a segunda varredura (1005).
// ============================================================
describe('stop_automation — marca a execução e varre a fila DUAS vezes', () => {
  it('⚠️⚠️ "Parar automação: a si mesma" numa retomada NÃO marca a própria execução — só as outras (auditoria pré-Codex)', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [
      { id: 's-stop', automation_id: 'a-desf', position: 1, step_type: 'stop_automation', step_config: { automation_id: 'a-desf' } },
      passoDeTrabalho('s-msg', 2),
    ];
    // Duas esperas `running` da mesma automação para o contato: a desta
    // execução (o cron acabou de reivindicá-la) e a de OUTRA execução.
    h.state.esperasVivas = [
      { id: 'espera-1', log_id: 'log-1' },
      { id: 'espera-outra', log_id: 'log-outra' },
    ];

    await resumePendingExecution({
      id: 'espera-1',
      automation_id: 'a-desf',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-1',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { conversation_id: 'conv-1' },
    });

    expect(h.state.logMarcados.has('log-outra')).toBe(true);
    expect(h.state.logMarcados.has('log-1')).toBe(false);
    // …e o passo seguinte da própria execução roda — o construtor promete
    // que a execução em curso não se autocancela.
    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
  });

  it('cancela a foto da fila, MARCA os registros, e cancela de novo por log_id', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [
      {
        id: 's-parar',
        automation_id: 'a-desf',
        step_type: 'stop_automation',
        position: 0,
        parent_step_id: null,
        step_config: { automation_id: 'a-alvo' },
      },
    ];

    await dispara();

    const naFila = h.state.updateCalls.filter(
      (c) => c.table === 'automation_pending_executions'
    );
    // Duas varreduras na fila: a foto (por automação + contato) e a segunda,
    // por registro, DEPOIS da marca.
    expect(naFila.length).toBeGreaterThanOrEqual(1);
    expect(naFila[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'automation_id', 'a-alvo'],
        ['eq', 'contact_id', 'c1'],
        ['eq', 'status', 'pending'],
      ])
    );
  });
});

// ============================================================
// "Aguardar — parar se o cliente responder" (18/09/2026).
//
// O motor só tem DUAS responsabilidades aqui, e as duas são sobre a MARCA no
// contexto da fila: escrevê-la (ou limpá-la) a cada estacionamento, e tirá-la
// na retomada. Quem cancela é `parar-se-responder.ts`, na ingestão.
// ============================================================
describe('Aguardar — parar se o cliente responder', () => {
  beforeEach(() => {
    h.state.esperasEnfileiradas = [];
  });

  const esperaMarcada = (config: Record<string, unknown>) => ({
    id: 'esp-1',
    automation_id: 'a-desf',
    step_type: 'wait',
    position: 0,
    parent_step_id: null,
    step_config: { amount: 30, unit: 'hours', ...config },
  });

  const contextoNaFila = () =>
    h.state.esperasEnfileiradas[0]?.context as Record<string, unknown>;

  /**
   * A marca como o agendador a devolve: dentro do JSONB da fila. Entra por
   * espalhamento porque NÃO faz parte de `AutomationContext` — de propósito:
   * ela nunca vive num contexto de execução, só no contexto GRAVADO de uma
   * espera (é o que a retomada garante). Mesmo trato do `_tentativa`.
   */
  const marcaDaEsperaAnterior: Record<string, unknown> = {
    _parar_se_responder: 'esp-1',
  };

  it('marcada: a fila guarda o ID DO PASSO na marca', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [esperaMarcada({ parar_se_responder: true })];

    await dispara();

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    // O id, e não `true`: é o que deixa anotar QUAL espera foi interrompida.
    expect(contextoNaFila()._parar_se_responder).toBe('esp-1');
  });

  it('sem a caixa marcada, nenhuma marca vai para a fila', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [esperaMarcada({})];

    await dispara();

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    expect('_parar_se_responder' in contextoNaFila()).toBe(false);
  });

  it('⚠️ só o booleano true liga — "true" e 1 chegam de JSONB e são truthy', async () => {
    for (const valor of ['true', 1]) {
      h.state.esperasEnfileiradas = [];
      h.state.owned = { id: 'c1' };
      h.state.automations = [automacaoSimples()];
      h.state.steps = [esperaMarcada({ parar_se_responder: valor })];

      await dispara();

      expect('_parar_se_responder' in contextoNaFila()).toBe(false);
    }
  });

  it('⚠️⚠️ a espera seguinte, NÃO marcada, nasce limpa mesmo com a marca no contexto', async () => {
    // O contexto é copiado de ponta a ponta da execução. Sem a limpeza, a
    // marca da 1ª espera viajaria para a 2ª — que o operador NÃO marcou — e
    // a resposta do cliente pararia a sequência num ponto que ele não
    // escolheu. São DUAS defesas: a retomada limpa (pino abaixo, pela
    // retentativa) e o estacionamento reescreve a decisão — este pino.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      {
        ...esperaMarcada({}),
        id: 'esp-2',
        automation_id: 'a-resume',
        position: 1,
      },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { conversation_id: 'conv-1', ...marcaDaEsperaAnterior },
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    expect('_parar_se_responder' in contextoNaFila()).toBe(false);
    // O resto do contexto atravessa intacto — é o que carrega canal e negócio.
    expect(contextoNaFila().conversation_id).toBe('conv-1');
  });

  it('⚠️⚠️ a RETOMADA tira a marca: a retentativa do passo seguinte não a herda', async () => {
    // A retentativa reenfileira copiando `args.context` cru — ela não passa
    // por `contextoDaEspera`. Se a retomada não limpasse, a marca da espera
    // que JÁ ACABOU iria junto, e uma resposta do cliente nos 30 s da
    // retentativa cancelaria a sequência num ponto que ninguém marcou.
    // (Medido por mutação: sem a limpeza na retomada, só este pino reprova.)
    vi.mocked(engineSendText).mockReset();
    vi.mocked(engineSendText).mockRejectedValueOnce(
      new EvolutionApiError('Error: Connection Closed', 400)
    );
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      {
        ...passoAvisar({ phone: '5583980000016', text: 'oi' }),
        automation_id: 'a-resume',
        position: 1,
        parent_step_id: null,
      },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { conversation_id: 'conv-1', ...marcaDaEsperaAnterior },
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    // É a retentativa (mesma posição, contador gravado), e sem a marca.
    expect(h.state.esperasEnfileiradas[0].next_step_position).toBe(1);
    expect(contextoNaFila()._tentativa).toEqual({ pos: 1, n: 1 });
    expect('_parar_se_responder' in contextoNaFila()).toBe(false);
    vi.mocked(engineSendText).mockReset();
    vi.mocked(engineSendText).mockResolvedValue({ whatsapp_message_id: 'm1' });
  });

  it('a retomada seguida de OUTRA espera marcada grava a marca da NOVA', async () => {
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      {
        ...esperaMarcada({ parar_se_responder: true }),
        id: 'esp-2',
        automation_id: 'a-resume',
        position: 1,
      },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { ...marcaDaEsperaAnterior },
    });

    expect(contextoNaFila()._parar_se_responder).toBe('esp-2');
  });

  it('⚠️⚠️ execução JÁ interrompida pela resposta: a continuação que acorda depois não roda (Codex, PR #223)', async () => {
    // A espera marcada estava num RAMO; o escopo de fora seguiu e estacionou a
    // SUA espera — sem marca — um instante depois de o cliente responder. O
    // cancelamento das irmãs não a viu (ainda não existia); quem a segura é a
    // retomada, perguntando à fila se a execução já foi interrompida.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoDeTrabalho('s-msg-seguinte', 1), automation_id: 'a-resume' },
    ];
    h.state.interrompida = true;

    await resumePendingExecution({
      id: 'espera-irma',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(new Set(h.state.statusDaFila)).toEqual(new Set(['cancelled']));
  });

  describe('SEGUNDA LINHA DE DEFESA na retomada (revisão por duas lentes, 19/09)', () => {
    const marca: Record<string, unknown> = { _parar_se_responder: 's-wait' };
    const esperaMarcada = (context: Record<string, unknown>) => ({
      id: 'espera-1',
      automation_id: 'a-desf',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-1',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { conversation_id: 'conv-1', ...context },
      created_at: '2026-09-19T10:00:00+00:00',
    });

    it('⚠️⚠️ o cliente escreveu depois de a espera marcada ser estacionada: cancela, marca "resposta" e anota — nada é enviado', async () => {
      h.state.owned = { id: 'c1' };
      h.state.automations = [automacaoSimples()];
      h.state.steps = [passoDeTrabalho('s-msg', 1)];
      h.state.conversasDoContato = [{ id: 'conv-1' }];
      h.state.respostasDesde = [{ id: 'm-resposta' }];

      await resumePendingExecution(esperaMarcada(marca));

      expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
      expect(h.state.statusDaFila).toContain('cancelled');
      expect(h.state.logUpdates.some((u) => u.interrompida_por === 'resposta')).toBe(true);
      const ultimo = h.state.logUpdates
        .filter((u) => 'steps_executed' in u)
        .flatMap((u) => u.steps_executed as { status: string; detail?: string }[])
        .at(-1);
      expect(ultimo?.detail).toMatch(/cliente respondeu/);
    });

    it('espera marcada, cliente calado: segue normalmente', async () => {
      h.state.owned = { id: 'c1' };
      h.state.automations = [automacaoSimples()];
      h.state.steps = [passoDeTrabalho('s-msg', 1)];
      h.state.conversasDoContato = [{ id: 'conv-1' }];
      h.state.respostasDesde = [];

      await resumePendingExecution(esperaMarcada(marca));

      expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
    });

    it('espera SEM a caixa: a resposta não é sequer perguntada — a caixa vale só na espera marcada', async () => {
      h.state.owned = { id: 'c1' };
      h.state.automations = [automacaoSimples()];
      h.state.steps = [passoDeTrabalho('s-msg', 1)];
      h.state.conversasDoContato = [{ id: 'conv-1' }];
      h.state.respostasDesde = [{ id: 'm-resposta' }];

      await resumePendingExecution(esperaMarcada({}));

      expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
    });

    it('⚠️ a leitura das mensagens falhou: falha VISÍVEL (failed/falhou), nunca palpite', async () => {
      const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        h.state.owned = { id: 'c1' };
        h.state.automations = [automacaoSimples()];
        h.state.steps = [passoDeTrabalho('s-msg', 1)];
        h.state.conversasDoContato = [{ id: 'conv-1' }];
        h.state.erroNasRespostas = 'timeout';

        await resumePendingExecution(esperaMarcada(marca));

        expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
        expect(h.state.statusDaFila).toContain('failed');
        expect(statusGravado()).toBe('failed');
        // ⚠️ `falhou` COM hora de fim (11ª rodada): o fechamento por segurança
        // não espera espera viva nenhuma — senão a marca em seguida o calava
        // para sempre e a falha nunca chegava ao fio.
        expect(desfechoGravado()).toMatchObject({ desfecho: 'falhou', finalizado_em: expect.any(String) });
        // ⚠️ A execução inteira para (10ª rodada): a marca DEPOIS do desfecho, e
        // as irmãs estacionadas caem.
        expect(h.state.logUpdates.some((u) => u.interrompida_por === 'resposta')).toBe(true);
        expect(h.state.statusDaFila).toContain('cancelled');
      } finally {
        calado.mockRestore();
      }
    });
  });

  it('⚠️⚠️ a execução interrompida NO MEIO do escopo não roda o passo seguinte (7ª rodada)', async () => {
    // Espera marcada num ramo, escopo de fora ainda rodando: a resposta do
    // cliente marca o registro, e o passo comum que vinha a seguir — uma
    // mensagem — não pode sair. A marca é lida antes de cada passo.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoDeTrabalho('s-msg', 0)];
    h.state.interrompida = true;

    await dispara();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(statusGravado()).toBe('partial');
    expect(desfechoGravado()).toBeUndefined();
    const ultimo = h.state.logUpdates
      .filter((u) => 'steps_executed' in u)
      .flatMap((u) => u.steps_executed as { status: string; detail?: string }[])
      .at(-1);
    expect(ultimo).toMatchObject({ status: 'skipped' });
    expect(ultimo?.detail).toMatch(/já foi interrompida/);
  });

  it('⚠️⚠️ execução JÁ interrompida NÃO estaciona espera nova (Codex, 4ª rodada) — sem linha zumbi na aba', async () => {
    // A resposta do cliente cancelou a espera do ramo enquanto o escopo de
    // fora ainda rodava; ao chegar no SEU "Aguardar", ele não pode criar uma
    // linha `pending` que a aba mostraria por dias e a retomada cancelaria.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [esperaMarcada({})];
    h.state.interrompida = true;

    await dispara();

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(statusGravado()).toBe('partial');
    expect(desfechoGravado()).toBeUndefined();
    const ultimo = h.state.logUpdates
      .filter((u) => 'steps_executed' in u)
      .flatMap((u) => u.steps_executed as { status: string; detail?: string }[])
      .at(-1);
    expect(ultimo).toMatchObject({ status: 'skipped' });
    expect(ultimo?.detail).toMatch(/já foi interrompida/);
  });

  it('⚠️ fila que RECUSA a espera vira falha visível, não "esperando" para sempre', async () => {
    // Até 18/09/2026 este INSERT não era conferido: recusado, o log dizia
    // "waiting…", nada retomava, e a execução ficava `partial` eternamente —
    // fora do fio e fora do bloco de correções do Meu dia.
    h.state.erroNaFila = 'new row violates check constraint';
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [esperaMarcada({ parar_se_responder: true })];

    await dispara();

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(statusGravado()).toBe('failed');
    expect(desfechoGravado()?.desfecho).toBe('falhou');
  });
});


// ============================================================
// Automação PRESA À ETAPA (18/09/2026): a espera que acorda com o card fora
// da etapa não retoma nada. Aqui se prende a ponta da RETOMADA — a garantia;
// o cancelamento imediato no dreno do funil é de `so-na-etapa.test.ts`.
// ============================================================
describe('retomada de automação presa à etapa', () => {
  const NO_SHOW = 'etapa-no-show';

  const recuperacao = (config: Record<string, unknown>) => ({
    ...automacaoSimples('a-noshow'),
    name: 'No-Show Recuperação',
    trigger_type: 'deal_stage_changed',
    trigger_config: { stage_ids: [NO_SHOW], ...config },
  });

  async function acordar() {
    h.state.steps = [
      { ...passoDeTrabalho('s-msg-4', 1), automation_id: 'a-noshow' },
    ];
    await resumePendingExecution({
      id: 'espera-1',
      automation_id: 'a-noshow',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-noshow',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { deal_id: 'deal-1', to_stage_id: NO_SHOW },
    });
  }

  const passosGravados = () =>
    h.state.logUpdates
      .filter((u) => 'steps_executed' in u)
      .flatMap((u) => u.steps_executed as { step_id: string; detail?: string; status: string }[]);

  it('⚠️⚠️ o cliente REAGENDOU (card saiu da etapa): nada roda, a espera vira cancelled e o motivo fica escrito', async () => {
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: 'etapa-reuniao-agendada' };

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(new Set(h.state.statusDaFila)).toEqual(new Set(['cancelled']));
    // A MARCA da 1005 vai para o registro, com o motivo.
    expect(h.state.logUpdates.some((u) => u.interrompida_por === 'etapa')).toBe(true);
    expect(passosGravados().at(-1)).toMatchObject({
      status: 'skipped',
      detail: 'interrompida: o card saiu da etapa desta automação',
    });
    // Cancelamento não é desfecho: o precedente da 936.
    expect(desfechoGravado()).toBeUndefined();
  });

  it('⚠️⚠️ card VOLTOU à etapa, mas a execução já tinha sido interrompida: a espera irmã não a ressuscita (Codex, 3ª rodada)', async () => {
    // A saída cancelou a espera do ramo; a espera de fora, estacionada depois
    // do evento, ficou fora do corte por data. O card reentra (execução NOVA
    // começa) e ela acorda com o card NA etapa — sem o sinal, a execução
    // antiga seguiria ao lado da nova, mandando a sequência em dobro.
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };
    h.state.interrompida = true;

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(new Set(h.state.statusDaFila)).toEqual(new Set(['cancelled']));
  });

  it('⚠️⚠️ a ESTADIA acabou (o card se mexeu depois de entrar), mesmo estando de volta: não retoma (7ª rodada)', async () => {
    // O card saiu e VOLTOU antes de a espera acordar; a posição diz "na
    // etapa", mas a fila de eventos tem um movimento posterior ao evento que
    // abriu esta execução. A entrada nova dispara execução nova; a antiga
    // sairia em dobro.
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };
    h.state.movimentosDepois = [{ id: 'ev-saida' }];
    h.state.steps = [
      { ...passoDeTrabalho('s-msg-4', 1), automation_id: 'a-noshow' },
    ];

    await resumePendingExecution({
      id: 'espera-1',
      automation_id: 'a-noshow',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-noshow',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { deal_id: 'deal-1', to_stage_id: NO_SHOW, evento_em: '2026-09-18T10:00:00+00:00' },
    });

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(new Set(h.state.statusDaFila)).toEqual(new Set(['cancelled']));
  });

  it('⚠️⚠️ evento de ENTRADA processado depois da SAÍDA: a execução não nasce (7ª rodada)', async () => {
    // Dois drenos concorrentes (ou o cron atrasado): a entrada chega ao motor
    // com o card já fora — e a marca de saída não alcança uma execução que
    // ainda não existia. Sai como "fora do escopo": nem registro ganha.
    h.state.owned = { id: 'c1' };
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: 'etapa-reuniao-agendada' };
    h.state.steps = [
      { ...passoDeTrabalho('s-msg-1', 0), automation_id: 'a-noshow' },
    ];

    const r = await dispararAutomacoes({
      accountId: ACCOUNT,
      triggerType: 'deal_stage_changed',
      contactId: 'c1',
      context: { deal_id: 'deal-1', to_stage_id: NO_SHOW, evento_em: '2026-09-18T10:00:00+00:00' },
    });

    expect(r.executadas).toBe(0);
    expect(r.foraDoEscopo).toBe(1);
    expect(h.state.logInserts).toHaveLength(0);
    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
  });

  it('entrada processada com o card ainda na etapa e sem movimento posterior: nasce normalmente', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };
    h.state.steps = [
      { ...passoDeTrabalho('s-msg-1', 0), automation_id: 'a-noshow' },
    ];

    const r = await dispararAutomacoes({
      accountId: ACCOUNT,
      triggerType: 'deal_stage_changed',
      contactId: 'c1',
      context: { deal_id: 'deal-1', to_stage_id: NO_SHOW, evento_em: '2026-09-18T10:00:00+00:00' },
    });

    expect(r.executadas).toBe(1);
    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
  });

  it('⚠️⚠️ o card sai ENTRE a conferência do dispatch e o 1º passo: a guarda por passo pega (8ª rodada)', async () => {
    // A conferência ao nascer viu a estadia de pé; o card saiu antes de o
    // registro existir (o dreno da saída não tinha o que marcar). A saída
    // está na fila de eventos, e a pergunta se repete antes de cada passo.
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      h.state.owned = { id: 'c1' };
      h.state.automations = [recuperacao({ parar_ao_sair: true })];
      h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };
      h.state.movimentosPorChamada = [[], [{ id: 'ev-saida' }]];
      h.state.steps = [
        { ...passoDeTrabalho('s-msg-1', 0), automation_id: 'a-noshow' },
      ];

      const r = await dispararAutomacoes({
        accountId: ACCOUNT,
        triggerType: 'deal_stage_changed',
        contactId: 'c1',
        context: { deal_id: 'deal-1', to_stage_id: NO_SHOW, evento_em: '2026-09-18T10:00:00+00:00' },
      });

      expect(r.executadas).toBe(1);
      expect(r.emEspera).toBe(1);
      expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
      expect(h.state.logUpdates.some((u) => u.interrompida_por === 'etapa')).toBe(true);
      const ultimo = h.state.logUpdates
        .filter((u) => 'steps_executed' in u)
        .flatMap((u) => u.steps_executed as { status: string; detail?: string }[])
        .at(-1);
      expect(ultimo).toMatchObject({ status: 'skipped' });
      expect(ultimo?.detail).toMatch(/saiu da etapa/);
    } finally {
      calado.mockRestore();
    }
  });

  it('⚠️ a fila de eventos falha ANTES de um passo: falha visível, nada é enviado (8ª rodada)', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      h.state.owned = { id: 'c1' };
      h.state.automations = [recuperacao({ parar_ao_sair: true })];
      h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };
      h.state.movimentosPorChamada = [[], 'erro'];
      h.state.steps = [
        { ...passoDeTrabalho('s-msg-1', 0), automation_id: 'a-noshow' },
      ];

      const r = await dispararAutomacoes({
        accountId: ACCOUNT,
        triggerType: 'deal_stage_changed',
        contactId: 'c1',
        context: { deal_id: 'deal-1', to_stage_id: NO_SHOW, evento_em: '2026-09-18T10:00:00+00:00' },
      });

      expect(r.comFalha).toBe(1);
      expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
      expect(statusGravado()).toBe('failed');
      // Fechada por segurança (11ª rodada): `falhou` COM hora de fim, e a
      // execução inteira marcada — um escopo irmão `running` para no próximo passo.
      expect(desfechoGravado()).toMatchObject({ desfecho: 'falhou', finalizado_em: expect.any(String) });
      expect(h.state.logUpdates.some((u) => u.interrompida_por === 'etapa')).toBe(true);
      expect(h.state.statusDaFila).toContain('cancelled');
      const ultimo = h.state.logUpdates
        .filter((u) => 'steps_executed' in u)
        .flatMap((u) => u.steps_executed as { status: string; detail?: string }[])
        .at(-1);
      expect(ultimo).toMatchObject({ status: 'failed' });
      expect(ultimo?.detail).toMatch(/conferir em que etapa/);
    } finally {
      calado.mockRestore();
    }
  });

  it('⚠️ a conferência ao NASCER falha: registro failed/falhou com o motivo, nunca descarte em silêncio (8ª rodada)', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      h.state.owned = { id: 'c1' };
      h.state.automations = [recuperacao({ parar_ao_sair: true })];
      h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };
      h.state.erroNosMovimentos = 'timeout';
      h.state.steps = [
        { ...passoDeTrabalho('s-msg-1', 0), automation_id: 'a-noshow' },
      ];

      const r = await dispararAutomacoes({
        accountId: ACCOUNT,
        triggerType: 'deal_stage_changed',
        contactId: 'c1',
        context: { deal_id: 'deal-1', to_stage_id: NO_SHOW, evento_em: '2026-09-18T10:00:00+00:00' },
      });

      expect(r.foraDoEscopo).toBe(0);
      expect(r.executadas).toBe(1);
      expect(r.comFalha).toBe(1);
      expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
      expect(h.state.logInserts).toHaveLength(1);
      expect(h.state.logInserts[0]).toMatchObject({ status: 'failed', steps_executed: [] });
      expect(String(h.state.logInserts[0].error_message)).toMatch(/conferir em que etapa/);
      expect(desfechoGravado()).toMatchObject({ desfecho: 'falhou' });
    } finally {
      calado.mockRestore();
    }
  });

  it('⚠️⚠️ execução MANUAL com o card FORA da etapa e o 1º passo "Aguardar": não estaciona, interrompe (9ª rodada)', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: 'etapa-reuniao-agendada' };
    h.state.steps = [
      { id: 's-wait-0', automation_id: 'a-noshow', position: 0, step_type: 'wait', step_config: { amount: 1, unit: 'days' } },
      { ...passoDeTrabalho('s-msg-1', 1), automation_id: 'a-noshow' },
    ];

    const r = await runAutomationById({
      automationId: 'a-noshow',
      accountId: ACCOUNT,
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
      triggerType: 'deal_stage_changed',
      rotuloDoDisparo: 'manual',
    });

    expect(r.ok).toBe(true);
    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(h.state.logUpdates.some((u) => u.interrompida_por === 'etapa')).toBe(true);
    const ultimo = h.state.logUpdates
      .filter((u) => 'steps_executed' in u)
      .flatMap((u) => u.steps_executed as { status: string; detail?: string }[])
      .at(-1);
    expect(ultimo).toMatchObject({ status: 'skipped', step_type: 'wait' });
    expect(ultimo?.detail).toMatch(/saiu da etapa/);
  });

  it('⚠️ execução MANUAL ganha a própria estadia: ancorada no último movimento conhecido do contato (9ª rodada)', async () => {
    // A lista de estacionadas não é zerada entre os testes deste describe.
    h.state.esperasEnfileiradas = [];
    h.state.owned = { id: 'c1' };
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };
    h.state.ultimoMovimento = { criado_em: '2026-09-18T09:00:00+00:00' };
    h.state.steps = [
      { id: 's-wait-0', automation_id: 'a-noshow', position: 0, step_type: 'wait', step_config: { amount: 1, unit: 'days' } },
    ];

    await runAutomationById({
      automationId: 'a-noshow',
      accountId: ACCOUNT,
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
      triggerType: 'deal_stage_changed',
      rotuloDoDisparo: 'manual',
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    const contexto = h.state.esperasEnfileiradas[0].context as { evento_em?: string; deal_id?: string };
    expect(contexto.evento_em).toBe('2026-09-18T09:00:00+00:00');
    // …e o CARD-ALVO (10ª rodada): sem ele, mover qualquer card do contato matava a manual.
    expect(contexto.deal_id).toBe('deal-1');
  });

  it('⚠️ a filha acionada com o card HERDADO ancora nesse card, não num escolhido à parte (12ª rodada)', async () => {
    // A lista de estacionadas não é zerada entre os testes deste describe.
    h.state.esperasEnfileiradas = [];
    h.state.owned = { id: 'c1' };
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-outro', stage_id: NO_SHOW };
    h.state.ultimoMovimento = { criado_em: '2026-09-18T11:00:00+00:00' };
    h.state.steps = [
      { id: 's-wait-0', automation_id: 'a-noshow', position: 0, step_type: 'wait', step_config: { amount: 1, unit: 'days' } },
    ];

    await runAutomationById({
      automationId: 'a-noshow',
      accountId: ACCOUNT,
      contactId: 'c1',
      context: { conversation_id: 'conv-1', deal_id: 'deal-herdado', evento_em: null },
      triggerType: 'deal_stage_changed',
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    const contexto = h.state.esperasEnfileiradas[0].context as { evento_em?: string; deal_id?: string };
    expect(contexto.deal_id).toBe('deal-herdado');
    expect(contexto.evento_em).toBe('2026-09-18T11:00:00+00:00');
    // A lista de cards abertos do contato não é sequer consultada.
    expect(h.state.dealSelects.some((f) => f.some(([op, k, v]) => op === 'eq' && k === 'status' && v === 'open'))).toBe(false);
  });

  it('card ainda em No Show: a sequência segue', async () => {
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
    expect(h.state.statusDaFila).toEqual(['done']);
  });

  it('⚠️ card APAGADO conta como fora da etapa', async () => {
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = null;

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(new Set(h.state.statusDaFila)).toEqual(new Set(['cancelled']));
  });

  it('⚠️⚠️ automação SEM a opção (gravada antes dela) segue mesmo com o card fora — nada muda retroativamente', async () => {
    h.state.automations = [recuperacao({})];
    h.state.dealExistente = { id: 'deal-1', stage_id: 'etapa-reuniao-agendada' };

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
    expect(h.state.statusDaFila).toEqual(['done']);
  });

  it('⚠️⚠️ não consegui ler a etapa: falha VISÍVEL — nem segue cobrando, nem cancela calada', async () => {
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.erroNoNegocio = 'timeout';

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    // A própria espera falha; as irmãs estacionadas caem (10ª rodada).
    expect(h.state.statusDaFila).toEqual(['failed', 'cancelled']);
    // …e o registro é fechado por segurança, COM hora de fim, antes da marca (11ª rodada).
    expect(desfechoGravado()).toMatchObject({ desfecho: 'falhou', finalizado_em: expect.any(String) });
    expect(h.state.logUpdates.some((u) => u.interrompida_por === 'etapa')).toBe(true);
    expect(statusGravado()).toBe('failed');
    expect(desfechoGravado()?.desfecho).toBe('falhou');
    expect(horaDeFimGravada()).toBeTruthy();
  });
});

// ------------------------------------------------------------
// Fase 2 do plano do previdenciário (26/09/2026): os valores do "Enviar
// modelo" (2.3), o responsável dinâmico do "Criar tarefa" (2.4) e a condição
// "janela de 24h da Meta aberta" (2.8). As regras puras têm teste próprio
// (`parametros-do-modelo`, `responsavel-da-tarefa`, `janela-da-meta`); aqui o
// que se prova é o ENCANAMENTO no motor.
// ------------------------------------------------------------

describe('send_template — os valores do modelo (Fase 2.3)', () => {
  beforeEach(() => vi.mocked(engineSendTemplate).mockClear());

  async function dispararModelo(step_config: Record<string, unknown>) {
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [{ ...sendStep(step_config), step_type: 'send_template' }];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1' },
    });
    return vi.mocked(engineSendTemplate).mock.calls[0]?.[0];
  }

  it('interpola cada {{N}} e manda os valores ESTRUTURADOS ao remetente', async () => {
    h.state.owned = { id: 'c1', name: 'Joana' };
    const args = await dispararModelo({
      template_name: 'boas_vindas',
      language: 'pt_BR',
      variables: { '1': '{{contact.name}}', '2': 'auxílio-acidente' },
    });
    expect(args?.params).toEqual(['Joana', 'auxílio-acidente']);
    expect(args?.messageParams).toEqual({ body: ['Joana', 'auxílio-acidente'] });
  });

  it('nome vazio cai no texto de reserva — a Meta recusaria o parâmetro vazio', async () => {
    h.state.owned = { id: 'c1', name: '' };
    const args = await dispararModelo({
      template_name: 'boas_vindas',
      variables: { '1': '{{contact.name}}' },
      variaveis_reserva: { '1': 'cliente' },
    });
    expect(args?.params).toEqual(['cliente']);
  });

  it('várias variáveis com {{deal.*}} leem o negócio UMA vez no passo', async () => {
    const lerCom = async (variables: Record<string, string>) => {
      vi.mocked(engineSendTemplate).mockClear();
      comNegocio({
        step_type: 'send_template',
        step_config: { template_name: 'proposta', language: 'pt_BR', variables },
      });
      h.state.dealSelects = [];
      await dispararComNegocio();
      return {
        leituras: h.state.dealSelects.length,
        body: vi.mocked(engineSendTemplate).mock.calls[0]?.[0]?.messageParams?.body,
      };
    };
    const uma = await lerCom({ '1': '{{deal.value}}' });
    const tres = await lerCom({ '1': '{{deal.value}}', '2': '{{deal.value}}', '3': '{{deal.created_at}}' });
    expect(tres.body).toHaveLength(3);
    expect(tres.body?.[0]).toContain('3.500,50');
    expect(tres.leituras).toBe(uma.leituras);
  });

  it('botão de URL: o valor da variável sai CODIFICADO; o caminho literal, não', async () => {
    h.state.owned = { id: 'c1', name: 'Ana Maria/2' } as unknown as { id: string };
    const args = await dispararModelo({
      template_name: 'assinatura',
      button_params: { '0': 'caso/{{contact.name}}' },
    });
    expect(args?.messageParams?.buttonParams).toEqual({ 0: 'caso/Ana%20Maria%2F2' });
  });

  it('config ANTIGA (só modelo e idioma) continua mandando o modelo, sem valor nenhum', async () => {
    h.state.owned = { id: 'c1' };
    const args = await dispararModelo({ template_name: 'estatico', language: 'pt_BR' });
    expect(args?.templateName).toBe('estatico');
    expect(args?.params).toEqual([]);
  });
});

describe('create_task — o responsável da conversa ou do card (Fase 2.4)', () => {
  const MEMBROS = [
    { id: 'p-autor', user_id: 'agente-fallback', full_name: 'Agente Um', email: 'um@cb.test' },
    { id: 'p-bia', user_id: 'bia-login', full_name: 'Bia Closer', email: 'bia@cb.test' },
  ];

  async function dispararTarefa(cfg: Record<string, unknown>) {
    h.state.owned = { id: 'c1' };
    h.state.membros = MEMBROS;
    const { automacao, passo } = automacaoDeTarefa({ titulo: 'Conferir documentos', ...cfg });
    h.state.automations = [automacao];
    h.state.steps = [passo];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
  }

  it('conversa: vai para quem está atribuído (id de LOGIN), com nome e aviso', async () => {
    h.state.responsavelDaConversa = 'bia-login';
    await dispararTarefa({ responsavel_modo: 'conversa', responsavel_user_id: '' });
    expect(h.state.taskInserts[0]).toMatchObject({
      responsavel_user_id: 'bia-login',
      responsavel_nome: 'Bia Closer',
    });
    expect(h.state.notifInserts[0]).toMatchObject({ user_id: 'bia-login' });
  });

  it('CRÍTICO: card guarda profiles.id — o motor TRADUZ para o id de login', async () => {
    h.state.dealExistente = { id: 'd1', assigned_to: 'p-bia' } as never;
    await dispararTarefa({ responsavel_modo: 'card', responsavel_user_id: '' });
    expect(h.state.taskInserts[0]).toMatchObject({ responsavel_user_id: 'bia-login' });
  });

  it('ninguém atribuído: cai na RESERVA, e o registro diz isso', async () => {
    h.state.responsavelDaConversa = null;
    await dispararTarefa({ responsavel_modo: 'conversa', responsavel_user_id: 'agente-fallback' });
    expect(h.state.taskInserts[0]).toMatchObject({ responsavel_user_id: 'agente-fallback' });
    expect(JSON.stringify(h.state.logUpdates)).toContain('responsável reserva');
  });

  it('ninguém atribuído e sem reserva: NÃO cria tarefa, e a falha diz por quê', async () => {
    h.state.responsavelDaConversa = null;
    await dispararTarefa({ responsavel_modo: 'conversa', responsavel_user_id: '' });
    expect(h.state.taskInserts).toHaveLength(0);
    expect(h.state.notifInserts).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('não tem responsável');
  });

  it('o atribuído SAIU da conta e não há reserva: falha com o motivo', async () => {
    h.state.dealExistente = { id: 'd1', assigned_to: 'perfil-de-quem-saiu' } as never;
    await dispararTarefa({ responsavel_modo: 'card', responsavel_user_id: '' });
    expect(h.state.taskInserts).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('não é mais membro');
  });

  it('o contato SEM conversa: a reserva, e o registro diz que não há conversa', async () => {
    h.state.responsavelDaConversa = undefined;
    await dispararTarefa({ responsavel_modo: 'conversa', responsavel_user_id: 'agente-fallback' });
    expect(h.state.taskInserts[0]).toMatchObject({ responsavel_user_id: 'agente-fallback' });
    expect(JSON.stringify(h.state.logUpdates)).toContain('o contato não tem conversa');
  });

  it('o atribuído SAIU e a reserva recebe: o registro diz que ele saiu, não "sem responsável"', async () => {
    h.state.dealExistente = { id: 'd1', assigned_to: 'perfil-de-quem-saiu' } as never;
    await dispararTarefa({ responsavel_modo: 'card', responsavel_user_id: 'agente-fallback' });
    expect(h.state.taskInserts[0]).toMatchObject({ responsavel_user_id: 'agente-fallback' });
    expect(JSON.stringify(h.state.logUpdates)).toContain(
      'quem estava atribuído ao card não é mais membro'
    );
  });

  it('modo desconhecido falha em vez de adivinhar', async () => {
    await dispararTarefa({ responsavel_modo: 'rodizio', responsavel_user_id: 'agente-fallback' });
    expect(h.state.taskInserts).toHaveLength(0);
    expect(JSON.stringify(h.state.logUpdates)).toContain('modo de responsável desconhecido');
  });
});

describe("condição 'janela de 24h da Meta aberta' (Fase 2.8)", () => {
  const RECENTE = () => new Date(Date.now() - 60 * 60_000).toISOString();
  const VELHA = () => new Date(Date.now() - 25 * 60 * 60_000).toISOString();

  const condicaoDaJanela = (operand = '') => ({
    id: 'cond-janela',
    automation_id: 'a1',
    step_type: 'condition',
    position: 0,
    parent_step_id: null,
    step_config: { subject: 'meta_window_open', operand },
  });
  const ramo = (branch: 'yes' | 'no', text: string) => ({
    ...sendStep({ text }),
    id: `ramo-${branch}`,
    parent_step_id: 'cond-janela',
    branch,
    position: 0,
  });

  async function avaliar(saida: { provider: string; channelId: string | null } | null, operand = '') {
    vi.mocked(engineSendText).mockClear();
    canalMock.resolveEngineChannelPreferring.mockImplementationOnce((async () => saida) as never);
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [condicaoDaJanela(operand), ramo('yes', 'texto livre'), ramo('no', 'vai modelo')];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1', channel_id: 'ch-oficial' },
    });
    return vi.mocked(engineSendText).mock.calls[0]?.[0]?.text;
  }

  it('cliente escreveu há 1h pelo número de saída: SIM', async () => {
    h.state.conversaDaJanela = { group_id: null, janela_meta: { 'ch-oficial': RECENTE() } };
    expect(await avaliar({ provider: 'meta', channelId: 'ch-oficial' })).toBe('texto livre');
  });

  it('passou das 24h: NÃO', async () => {
    h.state.conversaDaJanela = { group_id: null, janela_meta: { 'ch-oficial': VELHA() } };
    expect(await avaliar({ provider: 'meta', channelId: 'ch-oficial' })).toBe('vai modelo');
  });

  it('conexão por QR Code não tem janela: SIM', async () => {
    h.state.conversaDaJanela = { group_id: null, janela_meta: null };
    expect(await avaliar({ provider: 'evolution', channelId: 'ch-qr' })).toBe('texto livre');
  });

  it('leitura da conversa falhou: NÃO — o modelo é o lado seguro — e o registro DIZ que não conferiu', async () => {
    h.state.conversaDaJanela = null;
    expect(await avaliar({ provider: 'meta', channelId: 'ch-oficial' })).toBe('vai modelo');
    expect(JSON.stringify(h.state.logUpdates)).toContain('janela não conferida');
  });

  it('janela MEDIDA fechada não leva a nota de "não conferida"', async () => {
    h.state.conversaDaJanela = { group_id: null, janela_meta: { 'ch-oficial': VELHA() } };
    await avaliar({ provider: 'meta', channelId: 'ch-oficial' });
    expect(JSON.stringify(h.state.logUpdates)).not.toContain('janela não conferida');
  });

  it('pergunta pelo número de SAÍDA: o do operando, senão o do disparo', async () => {
    h.state.conversaDaJanela = { group_id: null, janela_meta: {} };
    canalMock.resolveEngineChannelPreferring.mockClear();
    await avaliar({ provider: 'meta', channelId: 'ch-oficial' });
    expect(canalMock.resolveEngineChannelPreferring.mock.calls[0]?.[3]).toBe('ch-oficial');
    canalMock.resolveEngineChannelPreferring.mockClear();
    await avaliar({ provider: 'meta', channelId: 'ch-outro' }, 'ch-outro');
    expect(canalMock.resolveEngineChannelPreferring.mock.calls[0]?.[3]).toBe('ch-outro');
  });
});

describe("condição 'campo personalizado da ficha' (Fase 2.10)", () => {
  const CAMPO = '11111111-1111-4111-8111-111111111111';

  const condicaoDoCampo = (cfg: Record<string, unknown>) => ({
    id: 'cond-campo',
    automation_id: 'a1',
    step_type: 'condition',
    position: 0,
    parent_step_id: null,
    step_config: { subject: 'custom_field', operand: CAMPO, ...cfg },
  });
  const ramo = (branch: 'yes' | 'no', text: string) => ({
    ...sendStep({ text }),
    id: `ramo-${branch}`,
    parent_step_id: 'cond-campo',
    branch,
    position: 0,
  });

  async function avaliar(cfg: Record<string, unknown>) {
    vi.mocked(engineSendText).mockClear();
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [condicaoDoCampo(cfg), ramo('yes', 'sim'), ramo('no', 'nao')];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1' },
    });
    return vi.mocked(engineSendText).mock.calls[0]?.[0]?.text;
  }

  it('o caso do plano: motivo = "Não respondeu" → SIM; outro motivo → NÃO', async () => {
    h.state.ownedCustomField = { id: CAMPO, field_type: 'select' };
    h.state.valorDoCampo = 'Não respondeu';
    expect(await avaliar({ operator: 'equals', value: 'Não respondeu' })).toBe('sim');
    h.state.valorDoCampo = 'Já tem advogado';
    expect(await avaliar({ operator: 'equals', value: 'Não respondeu' })).toBe('nao');
  });

  it('"é" sem diferença de maiúsculas nem espaços; operador ausente = "é"', async () => {
    h.state.ownedCustomField = { id: CAMPO, field_type: 'text' };
    h.state.valorDoCampo = '  NÃO RESPONDEU ';
    expect(await avaliar({ value: 'não respondeu' })).toBe('sim');
  });

  it('está vazio: sem linha em contact_custom_values É vazio; preenchido não é', async () => {
    h.state.ownedCustomField = { id: CAMPO, field_type: 'text' };
    h.state.valorDoCampo = undefined;
    expect(await avaliar({ operator: 'empty' })).toBe('sim');
    h.state.valorDoCampo = 'x';
    expect(await avaliar({ operator: 'empty' })).toBe('nao');
    expect(await avaliar({ operator: 'not_empty' })).toBe('sim');
  });

  it('contém', async () => {
    h.state.ownedCustomField = { id: CAMPO, field_type: 'text' };
    h.state.valorDoCampo = 'Acidente de moto na volta do trabalho';
    expect(await avaliar({ operator: 'contains', value: 'MOTO' })).toBe('sim');
    expect(await avaliar({ operator: 'contains', value: 'carro' })).toBe('nao');
  });

  it('CRÍTICO: o campo é lido pela CONTA da automação — campo de outra conta responde NÃO, com a nota', async () => {
    h.state.ownedCustomField = null;
    h.state.valorDoCampo = 'Não respondeu';
    expect(await avaliar({ operator: 'equals', value: 'Não respondeu' })).toBe('nao');
    expect(h.state.leiturasDoCampo[0]).toContainEqual(['eq', 'account_id', ACCOUNT]);
    expect(h.state.leiturasDoCampo[0]).toContainEqual(['eq', 'id', CAMPO]);
    expect(JSON.stringify(h.state.logUpdates)).toContain('não existe nesta conta');
  });

  it('leitura que falha: NÃO — e o registro DIZ que não conferiu', async () => {
    h.state.ownedCustomField = { id: CAMPO, field_type: 'select' };
    h.state.erroNaCondicaoDoCampo = 'timeout';
    expect(await avaliar({ operator: 'not_empty' })).toBe('nao');
    expect(JSON.stringify(h.state.logUpdates)).toContain('campo não conferido');
  });

  it('resposta MEDIDA não leva nota, e o VALOR lido nunca vai para o registro', async () => {
    h.state.ownedCustomField = { id: CAMPO, field_type: 'text' };
    h.state.valorDoCampo = 'senha-secreta-123';
    await avaliar({ operator: 'not_empty' });
    const registro = JSON.stringify(h.state.logUpdates);
    expect(registro).not.toContain('campo não conferido');
    expect(registro).not.toContain('senha-secreta-123');
  });

  it('operando sem forma de id nem vai ao banco: NÃO, "não existe nesta conta"', async () => {
    h.state.ownedCustomField = { id: CAMPO, field_type: 'text' };
    vi.mocked(engineSendText).mockClear();
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      { ...condicaoDoCampo({ operator: 'not_empty' }), step_config: { subject: 'custom_field', operand: 'lixo', operator: 'not_empty' } },
      ramo('yes', 'sim'),
      ramo('no', 'nao'),
    ];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1' },
    });
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]?.text).toBe('nao');
    expect(h.state.leiturasDoCampo).toEqual([]);
  });
});

describe("condição 'hora do dia' — no fuso do escritório", () => {
  // Instantes UTC explícitos: o pino vale com a máquina em qualquer fuso. O
  // relógio falso é SÓ o Date — timers de verdade, senão os awaits do motor
  // não andam.
  afterEach(() => vi.useRealTimers());

  const condicaoDeHora = (step_config: Record<string, unknown>) => ({
    id: 'cond-hora',
    automation_id: 'a1',
    step_type: 'condition',
    position: 0,
    parent_step_id: null,
    step_config: { subject: 'time_of_day', ...step_config },
  });
  const ramo = (branch: 'yes' | 'no', text: string) => ({
    ...sendStep({ text }),
    id: `ramo-${branch}`,
    parent_step_id: 'cond-hora',
    branch,
    position: 0,
  });

  async function avaliar(agoraIso: string, step_config: Record<string, unknown>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(agoraIso));
    vi.mocked(engineSendText).mockClear();
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [condicaoDeHora(step_config), ramo('yes', 'dentro'), ramo('no', 'fora')];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1' },
    });
    return vi.mocked(engineSendText).mock.calls[0]?.[0]?.text;
  }

  it('20:59 em Brasília (23:59 UTC) está dentro de 08:00-21:00; 21:00 (00:00 UTC) já não', async () => {
    expect(await avaliar('2026-09-25T23:59:00Z', { operand: '08:00-21:00' })).toBe('dentro');
    expect(await avaliar('2026-09-26T00:00:00Z', { operand: '08:00-21:00' })).toBe('fora');
  });

  it('06:00 em Brasília (09:00 UTC) está fora — com a hora do servidor, estaria dentro', async () => {
    expect(await avaliar('2026-09-25T09:00:00Z', { operand: '08:00-21:00' })).toBe('fora');
  });

  it('só de segunda a sexta: sábado ao meio-dia de Brasília responde Não', async () => {
    expect(
      await avaliar('2026-09-26T15:00:00Z', { operand: '08:00-21:00', somente_seg_a_sex: true }),
    ).toBe('fora');
  });

  it('o registro diz que hora o motor leu, no fuso do escritório', async () => {
    await avaliar('2026-09-26T00:30:00Z', { operand: '08:00-21:00' });
    expect(JSON.stringify(h.state.logUpdates)).toContain('hora no escritório: sex 21:30');
  });
});

describe('Aguardar até estar dentro do horário (B6a, 26/09/2026)', () => {
  // Instantes UTC explícitos (Brasília = UTC-3). Relógio falso SÓ do Date:
  // timers de verdade, senão os awaits do motor não andam. 25/09/2026 é
  // sexta; 28/09, segunda.
  afterEach(() => vi.useRealTimers());

  const esperaPeloHorario = (config: Record<string, unknown>) => ({
    id: 'esp-horario',
    automation_id: 'a1',
    step_type: 'wait',
    position: 0,
    parent_step_id: null,
    // `amount`/`unit` ficam gravados no modo horário e NÃO valem.
    step_config: { amount: 1, unit: 'hours', modo: 'horario', ...config },
  });
  const lembrete = { ...sendStep({ text: 'lembrete' }), id: 'lembrete', position: 1 };

  async function roda(agoraIso: string, config: Record<string, unknown>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(agoraIso));
    vi.mocked(engineSendText).mockClear();
    h.state.esperasEnfileiradas = [];
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [esperaPeloHorario(config), lembrete];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1' },
    });
  }

  it('fora do horário: estaciona pela porta de sempre até o PRÓXIMO início, e o lembrete não sai', async () => {
    // Sexta 22:40 em Brasília, de segunda a sexta → segunda 08:00 (11:00 UTC).
    await roda('2026-09-26T01:40:00Z', { janela: '08:00-21:00', somente_seg_a_sex: true });

    expect(vi.mocked(engineSendText)).not.toHaveBeenCalled();
    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    const espera = h.state.esperasEnfileiradas[0];
    expect(espera.run_at).toBe('2026-09-28T11:00:00.000Z');
    // Retoma no passo SEGUINTE, como o "Aguardar" comum.
    expect(espera.next_step_position).toBe(1);
    expect(espera.log_id).toBeTruthy();
    expect(JSON.stringify(h.state.logUpdates)).toContain(
      'fora do horário (sex 22:40); aguarda até seg 08:00'
    );
  });

  it('dentro do horário: segue na hora, sem estacionar — o lembrete sai já', async () => {
    await roda('2026-09-25T13:00:00Z', { janela: '08:00-21:00', somente_seg_a_sex: true });

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]?.text).toBe('lembrete');
    expect(JSON.stringify(h.state.logUpdates)).toContain('dentro do horário (sex 10:00); segue');
  });

  it('é a hora de Brasília: 06:00 BRT (09:00 UTC) espera as 08:00 de hoje', async () => {
    await roda('2026-09-25T09:00:00Z', { janela: '08:00-21:00' });

    expect(vi.mocked(engineSendText)).not.toHaveBeenCalled();
    expect(h.state.esperasEnfileiradas[0]?.run_at).toBe('2026-09-25T11:00:00.000Z');
  });

  it('"parar se o cliente responder" continua valendo nesta espera: a marca vai para a fila', async () => {
    await roda('2026-09-26T01:40:00Z', { janela: '08:00-21:00', parar_se_responder: true });

    const contexto = h.state.esperasEnfileiradas[0]?.context as Record<string, unknown>;
    expect(contexto._parar_se_responder).toBe('esp-horario');
    // O resto do contexto atravessa intacto.
    expect(contexto.conversation_id).toBe('conv1');
    expect(JSON.stringify(h.state.logUpdates)).toContain(
      'aguarda até sáb 08:00 (para se o cliente responder)'
    );
  });

  it('janela que o motor não lê: o passo FALHA e nada sai (a ativação já a recusa)', async () => {
    await roda('2026-09-25T13:00:00Z', { janela: '09:00-09:00' });

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(vi.mocked(engineSendText)).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain('janela de horário inválida: \\"09:00-09:00\\"');
  });

  it('a execução já interrompida não estaciona (a mesma porta, a mesma recusa)', async () => {
    h.state.interrompida = true;
    await roda('2026-09-26T01:40:00Z', { janela: '08:00-21:00' });

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(vi.mocked(engineSendText)).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.logUpdates)).toContain('não estacionada');
  });

  it('o modo "tempo" (e a ausência de modo) é o Aguardar de sempre', async () => {
    for (const modo of ['tempo', undefined]) {
      await roda('2026-09-26T01:40:00Z', { modo, janela: '08:00-21:00' });
      expect(h.state.esperasEnfileiradas[0]?.run_at).toBe('2026-09-26T02:40:00.000Z');
    }
  });
});

// ============================================================
// E4 dos agentes de IA: a fala de uma automação ANINHADA por etiqueta sobe.
// O passo "Adicionar etiqueta" dispara `tag_added` e espera as automações
// dele; se uma delas falou com o contato, a execução de cima FALOU — senão a
// ingestão via `falou: false` e o agente da etapa respondia uma segunda vez
// à mesma mensagem (Codex, #292).
// ============================================================
describe('add_tag: a fala da automação de tag_added sobe para quem disparou (E4)', () => {
  function montar(passoDaFilha: Record<string, unknown>) {
    const automacao = (id: string, trigger_type: string, trigger_config: Record<string, unknown>) => ({
      id,
      account_id: ACCOUNT,
      user_id: 'u1',
      name: id,
      trigger_type,
      trigger_config,
      is_active: true,
    });
    h.state.owned = { id: 'c1' };
    h.state.tagDaConta = { id: 'tag-x' };
    h.state.passosPorAutomacao = true;
    h.state.automacoesPorGatilho = {
      new_message_received: [automacao('a-mae', 'new_message_received', {})],
      tag_added: [automacao('a-filha', 'tag_added', { tag_id: 'tag-x' })],
    };
    h.state.steps = [
      {
        id: 's-etiqueta',
        automation_id: 'a-mae',
        step_type: 'add_tag',
        position: 0,
        parent_step_id: null,
        step_config: { tag_id: 'tag-x' },
      },
      { id: 's-filha', automation_id: 'a-filha', position: 0, parent_step_id: null, ...passoDaFilha },
    ];
  }

  const disparar = () =>
    dispararAutomacoes({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
    });

  beforeEach(() => {
    vi.mocked(engineSendText).mockReset();
    vi.mocked(engineSendText).mockResolvedValue({ whatsapp_message_id: 'm-filha' });
  });

  it('a automação de tag_added MANDOU mensagem: a de cima conta como tendo falado', async () => {
    montar({ step_type: 'send_message', step_config: { text: 'Bem-vindo!' } });

    const r = await disparar();

    expect(engineSendText).toHaveBeenCalledTimes(1);
    expect(r.falou).toBe(true);
  });

  it('a de tag_added só mexeu em dado (não falou): continua sem fala — etiquetar não cala o agente', async () => {
    montar({ step_type: 'update_contact_field', step_config: { field: 'company', value: 'x' } });

    const r = await disparar();

    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
    expect(r.falou).toBeFalsy();
  });

  it('nenhuma automação escuta a etiqueta: sem fala', async () => {
    montar({ step_type: 'send_message', step_config: { text: 'Bem-vindo!' } });
    h.state.automacoesPorGatilho!.tag_added = [];

    const r = await disparar();

    expect(r.falou).toBeFalsy();
  });
});

// ============================================================
// E4, a fala ADIADA do funil: "Mover card" e "Criar negócio" só gravam um
// evento; a automação de `deal_stage_changed` que escuta a etapa de destino
// fala DEPOIS, no dreno — e o agente já teria respondido a mesma mensagem. O
// passo conta como fala quando alguma automação LIGADA dispararia para a
// etapa (`triggerMatches`), e só se o card mudou ou nasceu.
// ============================================================
describe('mover card / criar negócio: a fala adiada do funil conta (E4)', () => {
  function automacao(id: string, trigger_type: string, trigger_config: Record<string, unknown>, is_active = true) {
    return { id, account_id: ACCOUNT, user_id: 'u1', name: id, trigger_type, trigger_config, is_active };
  }

  function montar(passo: Record<string, unknown>, ouvintes: Record<string, unknown>[]) {
    h.state.owned = { id: 'c1' };
    h.state.pipeline = { id: 'p1' };
    h.state.stage = { id: 'etapa-destino' };
    h.state.passosPorAutomacao = true;
    h.state.automacoesPorGatilho = {
      new_message_received: [automacao('a-mae', 'new_message_received', {})],
      deal_stage_changed: ouvintes,
    };
    h.state.steps = [{ id: 's-funil', automation_id: 'a-mae', position: 0, parent_step_id: null, ...passo }];
  }

  const mover = { step_type: 'move_deal_stage', step_config: { stage_id: 'etapa-destino' } };
  const criar = { step_type: 'create_deal', step_config: { pipeline_id: 'p1', stage_id: 'etapa-destino', title: 'Novo' } };

  const disparar = () =>
    dispararAutomacoes({ accountId: ACCOUNT, triggerType: 'new_message_received', contactId: 'c1', context: {} });

  /** O card aberto do contato, na etapa dada (o "Mover" o acha pela busca e relê a etapa por id). */
  function cardEm(stage_id: string) {
    h.state.dealPorStatus = { open: { id: 'd-1', stage_id } };
  }

  it('MOVER: alguém escuta a etapa de destino e o card muda de etapa → fala', async () => {
    cardEm('etapa-lead');
    montar(mover, [automacao('a-boas-vindas', 'deal_stage_changed', { stage_ids: ['etapa-destino'] })]);

    const r = await disparar();

    expect(h.state.rpcMover).toHaveLength(1);
    expect(r.falou).toBe(true);
  });

  it('MOVER: o card JÁ estava na etapa (sem evento) → não é fala', async () => {
    cardEm('etapa-destino');
    montar(mover, [automacao('a-boas-vindas', 'deal_stage_changed', { stage_ids: ['etapa-destino'] })]);

    const r = await disparar();

    expect(h.state.rpcMover).toHaveLength(1);
    expect(r.falou).toBeFalsy();
  });

  it('MOVER: ninguém escuta a etapa de destino (só outra etapa) → não é fala, e a etapa de antes nem é lida', async () => {
    cardEm('etapa-lead');
    montar(mover, [automacao('a-outra', 'deal_stage_changed', { stage_ids: ['etapa-outra'] })]);

    const r = await disparar();

    expect(r.falou).toBeFalsy();
    // Só a busca do card aberto (com `status`); a releitura por id não acontece.
    expect(h.state.dealSelects.every((f) => f.some(([op, k]) => op === 'eq' && k === 'status'))).toBe(true);
  });

  it('automação DESLIGADA que escuta a etapa não conta', async () => {
    cardEm('etapa-lead');
    montar(mover, [automacao('a-desligada', 'deal_stage_changed', { stage_ids: ['etapa-destino'] }, false)]);

    const r = await disparar();

    expect(r.falou).toBeFalsy();
  });

  it('lista de etapas VAZIA = qualquer etapa (a régua do motor) → fala', async () => {
    cardEm('etapa-lead');
    montar(mover, [automacao('a-qualquer', 'deal_stage_changed', { stage_ids: [] })]);

    const r = await disparar();

    expect(r.falou).toBe(true);
  });

  it('erro ao conferir quem escuta → conta como fala (o agente cala)', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      cardEm('etapa-lead');
      montar(mover, []);
      h.state.erroPorGatilho = { deal_stage_changed: 'timeout do PostgREST' };

      const r = await disparar();

      expect(r.falou).toBe(true);
    } finally {
      calado.mockRestore();
    }
  });

  it('CRIAR: o card nasce na etapa que alguém escuta → fala', async () => {
    montar(criar, [automacao('a-boas-vindas', 'deal_stage_changed', { stage_ids: ['etapa-destino'] })]);

    const r = await disparar();

    expect(h.state.dealInserts).toHaveLength(1);
    expect(r.falou).toBe(true);
  });

  it('CRIAR: o contato já tinha card (nada nasceu) → não é fala', async () => {
    h.state.dealExistente = { id: 'd-antigo' };
    montar(criar, [automacao('a-boas-vindas', 'deal_stage_changed', { stage_ids: ['etapa-destino'] })]);

    const r = await disparar();

    expect(h.state.dealInserts).toHaveLength(0);
    expect(r.falou).toBeFalsy();
  });

  it('CRIAR: ninguém escuta a etapa → não é fala', async () => {
    montar(criar, []);

    const r = await disparar();

    expect(h.state.dealInserts).toHaveLength(1);
    expect(r.falou).toBeFalsy();
  });
});

// ============================================================
// E4, a falha INCERTA: o envio que estourou sem recusa comprovada (tempo
// esgotado ou 5xx da Evolution, qualquer erro que não seja 4xx do provedor)
// pode ter saído — o `entrega_incerta`. Sem contar como fala, o agente de IA
// respondia de novo à mesma mensagem. Só a recusa comprovada (4xx) não fala.
// ============================================================
describe('envio que falhou sem recusa comprovada conta como fala (E4)', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockReset();
    h.state.esperasEnfileiradas = [];
  });

  async function falhaNoEnvio(erro: unknown, context: Record<string, unknown> = {}) {
    vi.mocked(engineSendText).mockRejectedValueOnce(erro);
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text: 'oi' })];
    return dispararAutomacoes({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1', ...context },
    });
  }

  it('Evolution 5xx (entrega incerta): falou', async () => {
    const r = await falhaNoEnvio(new EvolutionApiError('timeout', 504));
    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(r.comFalha).toBe(1);
    expect(r.falou).toBe(true);
  });

  it('erro da Meta que não é 4xx: falou', async () => {
    const r = await falhaNoEnvio(new MetaApiError('Service unavailable', { httpStatus: 503 }));
    expect(r.falou).toBe(true);
  });

  it('erro que não veio do provedor (pode ter sido depois do envio): falou', async () => {
    const r = await falhaNoEnvio(new Error('sent but DB insert failed: x'));
    expect(r.falou).toBe(true);
  });

  it('recusa COMPROVADA da Meta (4xx): não falou', async () => {
    const r = await falhaNoEnvio(new MetaApiError('(#131047) Re-engagement message', { httpStatus: 400 }));
    expect(r.comFalha).toBe(1);
    expect(r.falou).toBeFalsy();
  });

  it('recusa COMPROVADA da Evolution no teto de tentativas: não falou', async () => {
    const r = await falhaNoEnvio(new EvolutionApiError('recusado', 400), {
      _tentativa: { pos: 0, n: 2 },
    });
    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(r.comFalha).toBe(1);
    expect(r.falou).toBeFalsy();
  });
});

// ============================================================
// SALVAR a automação com uma execução parada num "Aguardar" DENTRO de um ramo
// (26/09/2026). Achado no e2e: `replaceSteps` apagava todos os passos e
// reinseria com ids novos; a FK `ON DELETE SET NULL` zerava o
// `parent_step_id` da espera, e a retomada rodava o escopo de FORA a partir da
// posição do ramo — outro passo, outra mensagem. Aqui a gravação de verdade
// (`replaceSteps`) roda contra o mesmo banco falso da retomada.
// ============================================================
describe('salvar a automação com uma espera parada num ramo (26/09/2026)', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const COND = uuid(1);
  const ESPERA = uuid(2);
  const NO_RAMO = uuid(3);
  const DE_FORA = uuid(4);

  const passo = (
    id: string,
    step_type: string,
    position: number,
    parent_step_id: string | null,
    step_config: Record<string, unknown>
  ) => ({
    id,
    automation_id: 'a-ramo',
    step_type,
    position,
    parent_step_id,
    branch: parent_step_id ? 'yes' : null,
    step_config,
  });

  beforeEach(() => {
    h.state.automations = [automacaoSimples('a-ramo')];
    // [condição → sim: [Aguardar, "do ramo"]], "de fora"
    h.state.steps = [
      passo(COND, 'condition', 0, null, { subject: 'tag_presence', operand: 'tag-x' }),
      passo(ESPERA, 'wait', 0, COND, { amount: 30, unit: 'hours' }),
      passo(NO_RAMO, 'update_contact_field', 1, COND, { field: 'company', value: 'do ramo' }),
      passo(DE_FORA, 'update_contact_field', 1, null, { field: 'company', value: 'de fora' }),
    ];
  });

  /** A espera como o "Aguardar" do ramo a estacionou (a posição SEGUINTE e o passo). */
  const esperaNoRamo = (context: Record<string, unknown> = comPassoDaFila({}, { id: ESPERA, position: 0 })) => ({
    id: 'espera-ramo',
    automation_id: 'a-ramo',
    account_id: ACCOUNT,
    user_id: 'u1',
    contact_id: 'c1',
    log_id: 'log-ramo',
    parent_step_id: COND,
    branch: 'yes' as const,
    next_step_position: 1,
    context,
  });

  /** A FK `ON DELETE SET NULL`: a condição apagada zera a coluna da espera. */
  const depoisDaFk = (e: ReturnType<typeof esperaNoRamo>) => ({
    ...e,
    parent_step_id: e.parent_step_id && h.state.passosApagados.has(e.parent_step_id) ? null : e.parent_step_id,
  });

  const valoresGravados = () =>
    h.state.updateCalls
      .filter((c) => c.table === 'contacts')
      .map((c) => (c.payload as Record<string, unknown>).company);

  /** A árvore como o construtor a manda de volta: o GET, com os ids do banco. */
  const arvoreDoConstrutor = async (): Promise<BuilderStepInput[]> =>
    (await loadStepsTree('a-ramo')) as BuilderStepInput[];

  it('CRÍTICO: depois de salvar com um passo NOVO no começo do ramo, a espera retoma no MESMO ramo, pelo passo seguinte a ela', async () => {
    const arvore = await arvoreDoConstrutor();
    arvore[0].branches!.yes!.unshift({
      step_type: 'update_contact_field',
      step_config: { field: 'company', value: 'novo no ramo' },
    });
    expect(await replaceSteps('a-ramo', arvore)).toBeNull();

    // A identidade ficou: nada apagado, a condição com o mesmo id.
    expect(h.state.passosApagados.size).toBe(0);
    const espera = depoisDaFk(esperaNoRamo());
    expect(espera.parent_step_id).toBe(COND);

    await resumePendingExecution(espera);

    // Nem o passo novo (antes da espera), nem a espera de novo, nem o escopo
    // de fora: só o passo que vinha DEPOIS da espera, no ramo dela.
    expect(valoresGravados()).toEqual(['do ramo']);
    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(h.state.statusDaFila).toContain('done');
  });

  it('⚠️⚠️ o defeito medido: salvar SEM os ids (o construtor antigo) apaga a condição — e a retomada NÃO roda o escopo de fora, falha visível', async () => {
    const semIds = (steps: BuilderStepInput[]): BuilderStepInput[] =>
      steps.map((s) => ({
        step_type: s.step_type,
        step_config: s.step_config,
        branches: s.branches
          ? { yes: semIds(s.branches.yes ?? []), no: semIds(s.branches.no ?? []) }
          : undefined,
      }));
    expect(await replaceSteps('a-ramo', semIds(await arvoreDoConstrutor()))).toBeNull();
    expect(h.state.passosApagados.has(COND)).toBe(true);

    await resumePendingExecution(depoisDaFk(esperaNoRamo()));

    // Antes: "de fora" (a posição 1 da RAIZ) era gravado — outro passo.
    expect(valoresGravados()).toEqual([]);
    expect(h.state.statusDaFila).toContain('failed');
    expect(desfechoGravado()?.desfecho).toBe('falhou');
    const registro = h.state.logUpdates.find((u) => 'steps_executed' in u) as
      | { steps_executed: { detail?: string; status: string }[]; error_message?: string }
      | undefined;
    expect(registro?.steps_executed.at(-1)).toMatchObject({ status: 'failed', detail: MOTIVO_RAMO_REMOVIDO });
    expect(registro?.error_message).toBe(MOTIVO_RAMO_REMOVIDO);
  });

  it('o operador REMOVEU o "Aguardar" em que a execução parou: falha visível, nada roda', async () => {
    const arvore = await arvoreDoConstrutor();
    arvore[0].branches!.yes = arvore[0].branches!.yes!.filter((p) => p.id !== ESPERA);
    expect(await replaceSteps('a-ramo', arvore)).toBeNull();
    expect([...h.state.passosApagados]).toEqual([ESPERA]);

    await resumePendingExecution(depoisDaFk(esperaNoRamo()));

    expect(valoresGravados()).toEqual([]);
    expect(desfechoGravado()?.desfecho).toBe('falhou');
    const registro = h.state.logUpdates.find((u) => 'steps_executed' in u) as
      | { steps_executed: { detail?: string; step_id: string }[] }
      | undefined;
    expect(registro?.steps_executed.at(-1)).toMatchObject({ step_id: ESPERA, detail: MOTIVO_PASSO_REMOVIDO });
  });

  it('espera gravada ANTES desta entrega (sem o passo no contexto) retoma pela posição, como sempre', async () => {
    await resumePendingExecution(esperaNoRamo({}));
    expect(valoresGravados()).toEqual(['do ramo']);
  });

  it('o "Aguardar" grava no contexto da fila QUAL passo estacionou', async () => {
    h.state.esperasEnfileiradas = [];
    h.state.owned = { id: 'c1' };
    h.state.steps = [
      { ...passo(ESPERA, 'wait', 0, null, { amount: 1, unit: 'hours' }), automation_id: 'a-desf' },
    ];
    h.state.automations = [automacaoSimples()];
    await dispara();
    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    expect(
      (h.state.esperasEnfileiradas[0].context as Record<string, unknown>)._passo_da_fila
    ).toEqual({ id: ESPERA, pos: 0 });
  });
});

// ------------------------------------------------------------
// O seletor de variáveis do construtor (29/09/2026). A etiqueta e a prévia
// só dizem a verdade se seguirem o MOTOR: `classificarCodigo` é o espelho de
// `valorDaVariavel`, e `valoresParaPrevia` passa pelas mesmas funções do
// envio — e só LÊ.
// ------------------------------------------------------------

describe('seletor de variáveis — o espelho do motor', () => {
  const args = {
    automation: { account_id: ACCOUNT } as Automation,
    contactId: 'c1',
    context: { message_text: 'oi', vars: { a: 'va' }, channel_id: 'ch1' },
    parentStepId: null,
    branch: null,
    startPosition: 0,
    logId: null,
    triggerEvent: 't',
  } as unknown as Parameters<typeof valorDaVariavel>[1];
  const dados = {
    contato: { name: 'N', phone: 'P', email: 'E', company: 'C' },
    campos: { k: 'vk', nome_da_campanha: 'Camp' },
    camposCru: { k: 'vk', nome_da_campanha: 'Camp' },
    conversationId: 'conv1',
  };
  const negocio = { value: 10, created_at: '2026-01-01T00:00:00Z' };

  it('o que o seletor chama de vazio o motor deixa em branco; o resto ele preenche', () => {
    const codigos = [
      ...VARIAVEIS_FIXAS.map((v) => v.codigo),
      'contact.campo.k',
      'vars.a',
      'vars.a.b',
      'contact.name.extra',
      '1',
      'foo',
      'contact.foo',
      'deal.title',
      'now.x',
      'vars',
      'channel.nome',
      'conversation.id',
      'message.x',
    ];
    for (const codigo of codigos) {
      const valor = valorDaVariavel(codigo, args, dados, negocio, {});
      if (classificarCodigo(codigo).tipo === 'vazio') expect(valor, codigo).toBe('');
      else expect(valor, codigo).not.toBe('');
    }
  });
});

describe('valoresParaPrevia — a prévia usa as funções do envio e só lê', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.exemplo.com/'));

  it('os dois modos, pelas mesmas regras, e os campos preenchidos do contato', async () => {
    h.state.owned = {
      id: 'c1',
      name: 'Marcelo',
      phone: '5596990000016',
      email: 'm@x.com',
      company: null,
    } as unknown as { id: string };
    h.state.dealPorStatus = {
      open: { id: 'd9', value: 3500.5, created_at: '2025-07-09T19:25:00Z' } as unknown as { id: string },
      won: null,
      lost: null,
    };
    h.state.customValues = [
      {
        value: '2026-08-30T19:00:00.000Z',
        custom_fields: { field_key: 'data_e_hora_reuniao', field_type: 'datetime', account_id: ACCOUNT },
      },
      // Campo de OUTRA conta nunca entra.
      { value: 'alheio', custom_fields: { field_key: 'segredo', field_type: 'text', account_id: 'outra' } },
    ];

    const v = await valoresParaPrevia({ accountId: ACCOUNT, contactId: 'c1', codigos: CODIGOS_DO_CLIENTE });

    expect(v['contact.name']).toEqual({ mensagem: 'Marcelo', cru: 'Marcelo' });
    expect(v['contact.company']).toEqual({ mensagem: '', cru: '' });
    expect(v['deal.value']).toEqual({ mensagem: 'R$ 3.500,50', cru: '3500.5' });
    expect(v['deal.created_at']).toEqual({ mensagem: '09/07/2025 às 16:25h', cru: '2025-07-09T19:25:00.000Z' });
    expect(v['contact.campo.data_e_hora_reuniao']).toEqual({
      mensagem: '30/08/2026 às 16:00h',
      cru: '2026-08-30T19:00:00.000Z',
    });
    expect(v['contact.campo.segredo']).toBeUndefined();
    expect(v['contact.link'].mensagem).toBe('https://crm.exemplo.com/contacts?contact=c1');
    // Nada do evento: a prévia não inventa texto de mensagem nem conexão.
    expect(v['message.text']).toBeUndefined();
    expect(v['channel.id']).toBeUndefined();
  });

  it('não escreve NADA no banco', async () => {
    h.state.esperasEnfileiradas = [];
    h.state.owned = { id: 'c1', name: 'Marcelo' } as unknown as { id: string };
    await valoresParaPrevia({ accountId: ACCOUNT, contactId: 'c1', codigos: CODIGOS_DO_CLIENTE });
    expect(h.state.updateCalls).toEqual([]);
    expect(h.state.upsertCalls).toEqual([]);
    expect(h.state.logInserts).toEqual([]);
    expect(h.state.dealInserts).toEqual([]);
    expect(h.state.taskInserts).toEqual([]);
    expect(h.state.esperasEnfileiradas).toEqual([]);
  });

  it('leitura dos campos que FALHA lança — nunca "vazio" sobre campo que tem valor', async () => {
    h.state.owned = { id: 'c1', name: 'Marcelo' } as unknown as { id: string };
    h.state.erroNosValoresDoContato = 'fora do ar';
    await expect(
      valoresParaPrevia({ accountId: ACCOUNT, contactId: 'c1', codigos: CODIGOS_DO_CLIENTE })
    ).rejects.toThrow(/leitura do contato falhou/);
  });

  it('leitura do negócio que FALHA lança na prévia (no envio, segue vazia)', async () => {
    h.state.owned = { id: 'c1', name: 'Marcelo' } as unknown as { id: string };
    h.state.erroNoNegocio = 'fora do ar';
    await expect(
      valoresParaPrevia({ accountId: ACCOUNT, contactId: 'c1', codigos: CODIGOS_DO_CLIENTE })
    ).rejects.toThrow();
  });

  it('o ENVIO continua tratando a falha dos campos como vazio: o passo segue', async () => {
    vi.mocked(engineSendText).mockClear();
    h.state.owned = { id: 'c1', name: 'Marcelo' } as unknown as { id: string };
    h.state.erroNosValoresDoContato = 'fora do ar';
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text: 'Oi {{contact.name}} [{{contact.campo.x}}]' })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1' },
    });
    expect(vi.mocked(engineSendText).mock.calls[0]?.[0]?.text).toBe('Oi Marcelo []');
  });
});
