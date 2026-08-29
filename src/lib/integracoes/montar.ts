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
// ⚠️ Os módulos NÃO resolvem por canal: leem o agente PADRÃO
// (`channel_id IS NULL`), porque a configuração é POR MÓDULO e vale para
// a conta inteira — decisão de produto do operador (2026-08-28). A única
// lista de canais é a do Radar, e ela significa o interruptor
// `radar_enabled` por conexão, nunca escopo de chave. Ver a nota maior
// dentro de `montarCartoes`.
// ============================================================

export type ProviderId = 'gemini' | 'openai' | 'anthropic';

export const PROVIDERS: readonly ProviderId[] = [
  'gemini',
  'openai',
  'anthropic',
];

/** Resultado de um ping de credencial. `null` = ainda não testado. */
export type Teste = { ok: boolean; motivo?: string } | null;

export interface ConfigParaMontar {
  id: string;
  /** `null` = agente padrão da conta. */
  channelId: string | null;
  provider: ProviderId;
  model: string;
  /** Migration 946. `null` = o Radar herda `model`. */
  radarModel: string | null;
  isActive: boolean;
  teste: Teste;
  temEmbeddings: boolean;
}

export interface CanalParaMontar {
  id: string;
  label: string;
  radarEnabled: boolean;
}

export interface AgenteNoCartao {
  configId: string;
  escopo: 'padrao' | 'canal';
  canalLabel: string | null;
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
  /** A transcrição só funciona no Gemini. */
  | 'transcricao_exige_gemini'
  /** Agente desligado: o assistente e a resposta automática não rodam. */
  | 'conversa_desligada';

export interface UsoNoCartao {
  modulo: ModuloId;
  modelo: string;
  origem: OrigemDoModelo;
  /**
   * SÓ o Radar preenche: conexões com `radar_enabled` ligado. Nos demais
   * módulos fica vazio — a configuração vale para a conta inteira, e
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
 * Monta os cartões da tela a partir das configs (já decifradas e, quando
 * pedido, já testadas) e dos canais da conta.
 *
 * `modeloTranscricao` e `modeloEmbeddings` entram por PARÂMETRO, nunca
 * importados aqui: este módulo é puro e testado, e a fonte da verdade
 * dessas constantes é o módulo que as usa de verdade. Redigitá-las
 * (aqui ou no dicionário) faria a tela mentir na primeira troca.
 */
export function montarCartoes(
  configs: ConfigParaMontar[],
  canais: CanalParaMontar[],
  embeddingsTeste: Teste,
  modeloTranscricao: string,
  modeloEmbeddings: string
): CartaoDeIntegracao[] {
  // ⚠️ DECISÃO DE PRODUTO (operador, 2026-08-28): a configuração é POR
  // MÓDULO, uma para a conta inteira — o modelo e a chave de cada módulo
  // valem para TODAS as conexões, sempre. Por isso os módulos abaixo leem
  // só o agente PADRÃO, e a lista de canais aparece apenas no Radar, onde
  // significa o interruptor `radar_enabled` por conexão (privacidade, 941)
  // — nunca "esta chave vale neste canal".
  //
  // O schema da 903 ainda permite linha de ai_configs por canal e o
  // backend (`loadAiConfig`) ainda resolveria por ela — mas NÃO EXISTE
  // escritor de agente por canal no app. Se um dia esse escritor nascer,
  // esta montagem tem de voltar a espelhar a resolução do backend, senão
  // a tela mente.
  const padrao = configs.find((c) => c.channelId === null) ?? null;

  const temEmbeddings = configs.some((c) => c.temEmbeddings);

  const cartoes: CartaoDeIntegracao[] = PROVIDERS.map((p) => {
    const doProvedor = configs.filter((c) => c.provider === p);

    const agentes = doProvedor.map<AgenteNoCartao>((c) => ({
      configId: c.id,
      escopo: c.channelId === null ? 'padrao' : 'canal',
      canalLabel:
        c.channelId === null
          ? null
          : (canais.find((k) => k.id === c.channelId)?.label ?? null),
      model: c.model,
      isActive: c.isActive,
      teste: c.teste,
    }));

    const usos: UsoNoCartao[] = [];

    // ---- Assistente de conversa (rascunho, auto-resposta, Playground) ----
    // Um uso por MODELO distinto: duas configs com modelos diferentes são
    // duas linhas, senão a tela esconderia uma delas.
    for (const modelo of [...new Set(doProvedor.map((c) => c.model))]) {
      const doModelo = doProvedor.filter((c) => c.model === modelo);
      const ligados = doModelo.filter((c) => c.isActive);
      usos.push({
        modulo: 'conversa',
        modelo,
        origem: 'agente',
        // ⚠️ Sem lista de canais aqui, de propósito: o escopo de cada
        // agente já está na seção de agentes acima, e o agente PADRÃO
        // atende todo canal que não tem agente próprio — enumerar só os
        // que têm config própria diria o contrário do que acontece.
        canais: [],
        canaisDesligados: [],
        // O interruptor do agente vale para o assistente e a resposta
        // automática — e para NADA além disso (Radar e transcrição leem a
        // config com requireActive: false).
        ...(ligados.length === 0 ? { indisponivel: 'conversa_desligada' as const } : {}),
      });
    }

    // ---- Radar ----
    // Modelo e chave do agente PADRÃO, para a conta inteira. A lista de
    // canais aqui é o INTERRUPTOR `radar_enabled` (941 — exceção
    // deliberada à convenção "vazio = todos", porque o Radar manda
    // conversa de cliente para um provedor externo): diz ONDE o Radar
    // analisa, nunca "qual chave vale em qual canal".
    if (padrao?.provider === p) {
      const ligados = canais.filter((k) => k.radarEnabled);
      usos.push({
        modulo: 'radar',
        modelo: padrao.radarModel ?? padrao.model,
        origem: padrao.radarModel ? 'proprio' : 'agente',
        canais: ligados.map((k) => k.label),
        canaisDesligados: canais
          .filter((k) => !k.radarEnabled)
          .map((k) => k.label),
        ...(ligados.length === 0
          ? { indisponivel: 'radar_sem_canal' as const }
          : {}),
      });
    }

    // ---- Transcrição de áudio ----
    // Gemini-only, modelo FIXO no código, e SEM lista de canais: vale
    // para toda conversa da conta. Nos outros provedores aparece marcada
    // como indisponível — o silêncio faria o operador supor que a chave
    // da OpenAI transcreve os áudios dele.
    if (doProvedor.length > 0) {
      usos.push({
        modulo: 'transcricao',
        modelo: p === 'gemini' ? modeloTranscricao : '—',
        origem: 'fixo',
        canais: [],
        canaisDesligados: [],
        ...(p === 'gemini'
          ? {}
          : { indisponivel: 'transcricao_exige_gemini' as const }),
      });
    }

    // ---- Base de conhecimento (RAG) ----
    // OpenAI-only e modelo fixo: aparece no cartão da OpenAI mesmo quando
    // o chat da conta é outro provedor, porque é a chave DELA que paga.
    const rag = p === 'openai' && temEmbeddings;
    if (rag) {
      usos.push({
        modulo: 'rag',
        modelo: modeloEmbeddings,
        origem: 'fixo',
        canais: [],
        canaisDesligados: [],
      });
    }

    const testes = doProvedor.map((c) => c.teste);
    if (rag) testes.push(embeddingsTeste);

    return { id: p, estado: estadoDe(testes), agentes, usos };
  });

  // Google Agenda: a integração ainda não existe no código — o cartão
  // nasce "não conectado" e vira o lar do OAuth quando ele for
  // construído (as colunas google_* da 945 já esperam por isso).
  cartoes.push({
    id: 'google_calendar',
    estado: 'nao_configurado',
    agentes: [],
    usos: [],
  });

  return cartoes;
}

