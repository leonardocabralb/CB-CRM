// ============================================================
// Aba de Integrações — montagem PURA dos cartões (sem I/O).
//
// A tela mostra um cartão por integração (Gemini / OpenAI / Anthropic /
// Google Agenda) com um chip de estado e, expandido, quem usa cada
// credencial. As chaves moram em `ai_configs` (uma por agente: o padrão
// da conta + um por canal, índices parciais da 903) — esta aba NÃO cria
// um segundo lugar para elas; só as apresenta por provedor.
//
// ⚠️ A resolução canal→config espelha `loadAiConfig` (config do canal,
// senão a padrão). É ela que responde "por qual chave o Radar e a
// transcrição deste canal saem" — divergir daqui é mentir na tela.
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
  /** Canais cujo RADAR usa uma credencial deste provedor. */
  radar: string[];
  /** Canais cuja TRANSCRIÇÃO usa esta credencial (só existe no gemini). */
  transcricao: string[];
  /** Só no cartão openai: há chave de embeddings (RAG) cadastrada. */
  rag: boolean;
  ragTeste: Teste;
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
 * `embeddingsTeste` é o ping da chave de embeddings (OpenAI, RAG) — uma
 * só por conta, no agente padrão.
 */
export function montarCartoes(
  configs: ConfigParaMontar[],
  canais: CanalParaMontar[],
  embeddingsTeste: Teste
): CartaoDeIntegracao[] {
  const padrao = configs.find((c) => c.channelId === null) ?? null;
  const porCanal = new Map(
    configs
      .filter((c) => c.channelId !== null)
      .map((c) => [c.channelId as string, c])
  );
  // Mesma queda de `loadAiConfig`: config do canal, senão a padrão.
  const resolver = (canalId: string): ConfigParaMontar | null =>
    porCanal.get(canalId) ?? padrao;

  const temEmbeddings = configs.some((c) => c.temEmbeddings);

  const cartoes: CartaoDeIntegracao[] = PROVIDERS.map((p) => {
    const agentes = configs
      .filter((c) => c.provider === p)
      .map<AgenteNoCartao>((c) => ({
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

    // ⚠️ O Radar exige `radar_enabled === true` no canal (exceção
    // deliberada à convenção "vazio = todos" — ver CLAUDE.md); a
    // transcrição vale para qualquer canal cuja credencial resolvida
    // seja Gemini.
    const radar = canais
      .filter((k) => k.radarEnabled)
      .filter((k) => resolver(k.id)?.provider === p)
      .map((k) => k.label);
    const transcricao =
      p === 'gemini'
        ? canais
            .filter((k) => resolver(k.id)?.provider === 'gemini')
            .map((k) => k.label)
        : [];

    const rag = p === 'openai' && temEmbeddings;
    const testes = agentes.map((a) => a.teste);
    if (rag) testes.push(embeddingsTeste);

    return {
      id: p,
      estado: estadoDe(testes),
      agentes,
      radar,
      transcricao,
      rag,
      ragTeste: rag ? embeddingsTeste : null,
    };
  });

  // Google Agenda: a integração ainda não existe no código — o cartão
  // nasce "não conectado" e vira o lar do OAuth quando ele for
  // construído (colunas google_* da 945 já esperam por isso).
  cartoes.push({
    id: 'google_calendar',
    estado: 'nao_configurado',
    agentes: [],
    radar: [],
    transcricao: [],
    rag: false,
    ragTeste: null,
  });

  return cartoes;
}
