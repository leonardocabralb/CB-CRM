// ============================================================
// Aba de Integrações — montagem PURA dos cartões (sem I/O).
//
// A tela mostra um cartão por integração (Gemini / OpenAI / Anthropic /
// Google Agenda) com um chip de estado e, expandido, ONDE aquela chave é
// usada: módulo por módulo, com o MODELO de cada um e de onde esse
// modelo vem.
//
// ⚠️ A distinção de ORIGEM do modelo é o ponto deste arquivo. Os três
// módulos resolvem o modelo de formas diferentes, e antes disto a tela
// não dizia isso:
//   - o Radar tem modelo PRÓPRIO (`radar_model`, migration 946) e,
//     quando ele é nulo, HERDA o do agente de conversa;
//   - a transcrição usa modelo FIXO no código (`MODELO_TRANSCRICAO`),
//     que não é configurável e não tem relação com o do agente;
//   - o RAG usa modelo FIXO da OpenAI, casado com `vector(1536)`.
// Sem essa etiqueta, o operador lê o modelo do agente e conclui que ele
// vale para tudo — foi exatamente o engano que originou esta tela.
//
// ⚠️ Desde a 1047 a CHAVE é do PROVEDOR, uma por conta (`cb_ia_chaves`,
// D1 do docs/PLANO-agentes-de-ia.md): o cartão de um provedor existe pela
// chave dele, não por uma linha de agente. A configuração dos MÓDULOS
// (provedor e modelo do Radar, e o assistente legado) continua sendo a
// linha PADRÃO de `ai_configs`, da conta inteira — decisão de produto do
// operador (2026-08-28). A única lista de canais é a do Radar, e ela
// significa o interruptor `radar_enabled` por conexão, nunca escopo de
// chave.
// ============================================================

export type ProviderId = 'gemini' | 'openai' | 'anthropic';

export const PROVIDERS: readonly ProviderId[] = [
  'gemini',
  'openai',
  'anthropic',
];

/** Resultado de um ping de credencial. `null` = ainda não testado. */
export type Teste = { ok: boolean; motivo?: string } | null;

/** A chave de um provedor: se existe e, quando pingada, o resultado. */
export interface ChaveParaMontar {
  provedor: ProviderId;
  existe: boolean;
  teste: Teste;
}

/**
 * A linha PADRÃO de `ai_configs` — a configuração dos módulos (e do
 * assistente legado, até a F1b). `null` = a conta ainda não tem.
 */
export interface PadraoParaMontar {
  provider: ProviderId;
  model: string;
  /** Migration 946. `null` = o Radar herda `model`. */
  radarModel: string | null;
  isActive: boolean;
}

/**
 * Uma linha de CONEXÃO de `ai_configs` ligada (o agente por canal do app
 * anterior): sem escritor no app, mas herdada e ainda lida pela resposta
 * automática legada. Entra como uso da chave do provedor dela — sem isto,
 * apagar a chave diria que nada para, e pararia a resposta daquela conexão
 * (Codex, #294).
 */
export interface AgenteDeConexaoParaMontar {
  provider: ProviderId;
  model: string;
  canal: string;
}

export interface CanalParaMontar {
  id: string;
  label: string;
  radarEnabled: boolean;
}

export interface AgenteNoCartao {
  escopo: 'padrao';
  model: string;
  isActive: boolean;
  teste: Teste;
}

export type ModuloId = 'conversa' | 'radar' | 'transcricao' | 'rag';

/** De onde veio o modelo que este módulo usa. */
export type OrigemDoModelo =
  /** Herdado do agente de conversa (`ai_configs.model`). */
  | 'agente'
  /** Configurado só para este módulo (`ai_configs.radar_model`). */
  | 'proprio'
  /** Fixo no código, não configurável. */
  | 'fixo';

/** Por que um módulo não está usando esta chave, quando não está. */
export type Indisponibilidade =
  /** Nenhum canal com o Radar ligado. */
  | 'radar_sem_canal'
  /** Agente desligado: o assistente e a resposta automática não rodam. */
  | 'conversa_desligada'
  /** O provedor ainda não tem chave: o módulo PRECISA dela para rodar. */
  | 'sem_chave'
  /**
   * A OpenAI recusou os embeddings a esta chave ao gravá-la
   * (`serve_embeddings = false`): o chat funciona e a base usa só a busca
   * por palavras. É o MÓDULO que não roda, não a chave que falha (Codex, #294).
   */
  | 'embeddings_recusados';

export interface UsoNoCartao {
  modulo: ModuloId;
  modelo: string;
  origem: OrigemDoModelo;
  /**
   * O Radar preenche com as conexões de `radar_enabled` ligado, e o
   * assistente POR CONEXÃO (linha de canal herdada) com a conexão dele. Nos
   * demais módulos fica vazio — a configuração vale para a conta inteira, e
   * listar canais sugeriria chave por conexão (modelo descartado).
   */
  canais: string[];
  /** Idem, só o Radar: conexões com o interruptor desligado. */
  canaisDesligados: string[];
  indisponivel?: Indisponibilidade;
}

export type EstadoDaIntegracao =
  | 'ok'
  | 'erro'
  | 'nao_configurado'
  /** Há credencial, mas o ping ainda não rodou (carga rápida). */
  | 'conferindo';

export interface CartaoDeIntegracao {
  id: ProviderId | 'google_calendar';
  estado: EstadoDaIntegracao;
  /** O provedor tem chave cadastrada (sempre `false` no Google Agenda). */
  temChave: boolean;
  /** Este provedor é o do Radar (a linha padrão): o cartão edita o modelo dele. */
  ehDoRadar: boolean;
  agentes: AgenteNoCartao[];
  /** Onde esta chave é usada, com o modelo de cada módulo. */
  usos: UsoNoCartao[];
}

function estadoDe(testes: Teste[]): EstadoDaIntegracao {
  if (testes.length === 0) return 'nao_configurado';
  if (testes.some((t) => t === null)) return 'conferindo';
  if (testes.some((t) => t !== null && !t.ok)) return 'erro';
  return 'ok';
}

/**
 * Monta os cartões da tela a partir das chaves (já pingadas, quando
 * pedido), da linha padrão e dos canais da conta.
 *
 * `modeloTranscricao` e `modeloEmbeddings` entram por PARÂMETRO, nunca
 * importados aqui: este módulo é puro e testado, e a fonte da verdade
 * dessas constantes é o módulo que as usa de verdade. Redigitá-las
 * (aqui ou no dicionário) faria a tela mentir na primeira troca.
 */
export function montarCartoes(
  chaves: ChaveParaMontar[],
  padrao: PadraoParaMontar | null,
  canais: CanalParaMontar[],
  /**
   * O ping da chave que a base usa; `'recusada'` = a OpenAI já recusou os
   * embeddings a ela (não é pingada de novo, e não conta como falha do cartão).
   */
  embeddingsTeste: Teste | 'recusada',
  modeloTranscricao: string,
  modeloEmbeddings: string,
  agentesDeConexao: AgenteDeConexaoParaMontar[] = []
): CartaoDeIntegracao[] {
  const cartoes: CartaoDeIntegracao[] = PROVIDERS.map((p) => {
    const chave = chaves.find((c) => c.provedor === p);
    const temChave = chave?.existe === true;
    const ehDoPadrao = padrao?.provider === p;

    const agentes: AgenteNoCartao[] = ehDoPadrao
      ? [
          {
            escopo: 'padrao',
            model: padrao.model,
            isActive: padrao.isActive,
            teste: temChave ? (chave?.teste ?? null) : null,
          },
        ]
      : [];

    const usos: UsoNoCartao[] = [];
    // Todo módulo aparece mesmo SEM a chave, marcado: é quando o operador
    // mais precisa descobrir o que a chave destrava.
    const semChave = temChave ? {} : { indisponivel: 'sem_chave' as const };

    // ---- Assistente de conversa (rascunho, auto-resposta, Playground) ----
    if (ehDoPadrao) {
      usos.push({
        modulo: 'conversa',
        modelo: padrao.model,
        origem: 'agente',
        canais: [],
        canaisDesligados: [],
        // O interruptor do agente vale para o assistente e a resposta
        // automática — e para NADA além disso (o Radar lê a config com
        // requireActive: false; a transcrição nem lê a config).
        ...(temChave
          ? padrao.isActive
            ? {}
            : { indisponivel: 'conversa_desligada' as const }
          : semChave),
      });
    }

    // ---- Assistente POR CONEXÃO (linhas de canal herdadas, ligadas) ----
    // Um uso por modelo, com as conexões que o rodam.
    const porModelo = new Map<string, string[]>();
    for (const a of agentesDeConexao) {
      if (a.provider !== p) continue;
      porModelo.set(a.model, [...(porModelo.get(a.model) ?? []), a.canal]);
    }
    for (const [modelo, conexoes] of porModelo) {
      usos.push({
        modulo: 'conversa',
        modelo,
        origem: 'agente',
        canais: conexoes,
        canaisDesligados: [],
        ...semChave,
      });
    }

    // ---- Radar ----
    // Provedor e modelo da linha PADRÃO, para a conta inteira. A lista de
    // canais é o INTERRUPTOR `radar_enabled` (941 — exceção deliberada à
    // convenção "vazio = todos": o Radar manda conversa de cliente para um
    // provedor externo): diz ONDE o Radar analisa.
    if (ehDoPadrao) {
      const ligados = canais.filter((k) => k.radarEnabled);
      usos.push({
        modulo: 'radar',
        modelo: padrao.radarModel ?? padrao.model,
        origem: padrao.radarModel ? 'proprio' : 'agente',
        canais: ligados.map((k) => k.label),
        canaisDesligados: canais
          .filter((k) => !k.radarEnabled)
          .map((k) => k.label),
        ...(temChave
          ? ligados.length === 0
            ? { indisponivel: 'radar_sem_canal' as const }
            : {}
          : semChave),
      });
    }

    // ---- Transcrição de áudio ----
    // Gemini-only, modelo FIXO, e desde a 1047 lê a chave do Gemini
    // DIRETO — não depende do provedor de agente nenhum. Só no cartão do
    // Gemini.
    if (p === 'gemini') {
      usos.push({
        modulo: 'transcricao',
        modelo: modeloTranscricao,
        origem: 'fixo',
        canais: [],
        canaisDesligados: [],
        ...semChave,
      });
    }

    // ---- Base de conhecimento (RAG) ----
    // A chave da OpenAI é a dos embeddings (modelo fixo): aparece no cartão
    // da OpenAI mesmo quando o chat da conta é outro provedor, porque é a
    // chave DELA que paga.
    if (p === 'openai') {
      usos.push({
        modulo: 'rag',
        modelo: modeloEmbeddings,
        origem: 'fixo',
        canais: [],
        canaisDesligados: [],
        ...(temChave && embeddingsTeste === 'recusada'
          ? { indisponivel: 'embeddings_recusados' as const }
          : semChave),
      });
    }

    const testes: Teste[] = temChave ? [chave?.teste ?? null] : [];
    if (temChave && p === 'openai' && embeddingsTeste !== 'recusada') testes.push(embeddingsTeste);

    return {
      id: p,
      estado: estadoDe(testes),
      temChave,
      ehDoRadar: ehDoPadrao,
      agentes,
      usos,
    };
  });

  // Google Agenda: a integração ainda não existe no código — o cartão
  // nasce "não conectado" e vira o lar do OAuth quando ele for
  // construído (as colunas google_* da 945 já esperam por isso).
  cartoes.push({
    id: 'google_calendar',
    estado: 'nao_configurado',
    temChave: false,
    ehDoRadar: false,
    agentes: [],
    usos: [],
  });

  return cartoes;
}
