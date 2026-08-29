import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { listChannels } from '@/lib/cb-channels/repo';
import { validateAiCredentials } from '@/lib/ai/validate';
import { embedTexts, EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { MODELO_TRANSCRICAO } from '@/lib/transcricao/transcrever';
import { AiError, type AiProvider } from '@/lib/ai/types';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  montarCartoes,
  type ConfigParaMontar,
  type Teste,
} from '@/lib/integracoes/montar';

/**
 * GET /api/cb/integracoes/status  (admin+)
 *
 * A aba de Integrações num pedido só: as credenciais de IA da conta
 * agrupadas por provedor, com um ping REAL em cada uma (o mesmo
 * `validateAiCredentials` do botão "Testar chave" — testa exatamente o
 * modelo/chave que o agente usa, não um genérico), mais o ping da chave
 * de embeddings (RAG, OpenAI-only) e o cartão do Google Agenda.
 *
 * `?ping=0` pula os testes e devolve só a configuração — é a carga
 * instantânea da tela; o ping (que custa uma geração paga por agente)
 * vem na segunda chamada, e nunca em laço.
 *
 * ⚠️ NENHUMA CHAVE SAI DAQUI, NEM MASCARADA — e por isso a falha volta
 * como CÓDIGO (`invalid_key`, `rate_limited`, …), nunca como
 * `AiError.message`: a mensagem do provedor embute o eco da chave
 * enviada ("Incorrect API key provided: sk-proj-…abcd"), e ela seria
 * renderizada na tela e sairia em qualquer print de suporte. Quem
 * traduz o código é o cliente.
 */

// O ciclo é N gerações em paralelo (30s de teto cada) mais o ping de
// embeddings. Sem isto a rota herda o teto default da plataforma e um
// provedor emperrado derruba a tela inteira — inclusive os cartões que
// responderam rápido. Mesmo valor das outras rotas de IA (reanalisar,
// transcrição).
export const maxDuration = 60;

/** Códigos que o cliente sabe traduzir; o resto vira `provider_error`. */
const CODIGOS = new Set([
  'invalid_key',
  'rate_limited',
  'timeout',
  'network',
  'provider_error',
]);

function motivoSeguro(err: unknown): string {
  if (err instanceof AiError && CODIGOS.has(err.code)) return err.code;
  return 'provider_error';
}

/**
 * Ping da chave de embeddings pelo CAMINHO REAL (`POST /v1/embeddings`,
 * via `embedTexts`), não por uma listagem de modelos: uma chave
 * *restricted* de projeto — ou um projeto sem crédito — lista modelos e
 * falha ao gerar embedding, o que pintaria o cartão de verde com a busca
 * semântica morta.
 */
async function pingEmbeddings(apiKey: string): Promise<Teste> {
  try {
    await embedTexts(apiKey, ['ping']);
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: motivoSeguro(err) };
  }
}

interface LinhaDeConfig {
  id: string;
  channel_id: string | null;
  provider: AiProvider;
  model: string;
  radar_model: string | null;
  api_key: string | null;
  embeddings_api_key: string | null;
  is_active: boolean;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const pingar = new URL(request.url).searchParams.get('ping') !== '0';

    // ⚠️ Baldes diferentes: a carga sem ping só lê o banco; a COM ping
    // gasta uma geração paga por agente da conta.
    const limite = pingar
      ? checkRateLimit(
          `cb:integracoes:ping:${ctx.userId}`,
          RATE_LIMITS.integracoesPing
        )
      : checkRateLimit(
          `cb:integracoes:${ctx.userId}`,
          RATE_LIMITS.adminAction
        );
    if (!limite.success) return rateLimitResponse(limite);

    const [{ data: linhas, error }, canais] = await Promise.all([
      ctx.supabase
        .from('ai_configs')
        .select(
          'id, channel_id, provider, model, radar_model, api_key, embeddings_api_key, is_active'
        )
        .eq('account_id', ctx.accountId),
      listChannels(ctx.supabase, ctx.accountId),
    ]);

    if (error) {
      console.error('[integracoes] leitura de ai_configs falhou:', error.message);
      return NextResponse.json(
        { error: 'Não foi possível carregar as integrações.' },
        { status: 500 }
      );
    }

    const configs = ((linhas ?? []) as LinhaDeConfig[]).filter(
      (l) => !!l.api_key
    );

    // ⚠️ A chave de embeddings é a DO AGENTE PADRÃO (`channel_id IS
    // NULL`) — é a única que `loadEmbeddingsKey` consegue ler. Pegar
    // "a primeira linha com chave" testaria uma credencial de canal que
    // o RAG nunca usa, e o cartão ficaria verde com a busca semântica
    // apontando para outra chave.
    const configEmbeddings = ((linhas ?? []) as LinhaDeConfig[]).find(
      (l) => l.channel_id === null && !!l.embeddings_api_key
    );

    // Tudo em paralelo: os pings dos agentes e o do embeddings. Em série
    // o pior caso somava o teto de um ao do outro.
    const [testes, embeddingsTeste] = await Promise.all([
      Promise.all(
        configs.map(async (l): Promise<Teste> => {
          if (!pingar) return null;
          let chave: string;
          try {
            chave = decrypt(l.api_key as string);
          } catch {
            return { ok: false, motivo: 'chave_ilegivel' };
          }
          try {
            await validateAiCredentials({
              provider: l.provider,
              // ⚠️ O ping testa o modelo do CHAT. O do Radar é validado no
              // SAVE (/api/ai/config) — pingá-lo aqui seria uma segunda
              // chamada paga a cada carga desta tela.
              model: l.model,
              radarModel: null,
              apiKey: chave,
              systemPrompt: null,
              isActive: true,
              autoReplyEnabled: false,
              autoReplyMaxPerConversation: 3,
              handoffAgentId: null,
              embeddingsApiKey: null,
            });
            return { ok: true };
          } catch (err) {
            return { ok: false, motivo: motivoSeguro(err) };
          }
        })
      ),
      (async (): Promise<Teste> => {
        if (!pingar || !configEmbeddings) return null;
        let chave: string;
        try {
          chave = decrypt(configEmbeddings.embeddings_api_key as string);
        } catch {
          return { ok: false, motivo: 'chave_ilegivel' };
        }
        return pingEmbeddings(chave);
      })(),
    ]);

    const cartoes = montarCartoes(
      configs.map(
        (l, i): ConfigParaMontar => ({
          id: l.id,
          channelId: l.channel_id,
          provider: l.provider as ConfigParaMontar['provider'],
          model: l.model,
          radarModel: l.radar_model,
          isActive: l.is_active,
          teste: testes[i],
          // Só a chave do agente PADRÃO conta como RAG configurado —
          // ver a nota do `configEmbeddings` acima.
          temEmbeddings: l.channel_id === null && !!l.embeddings_api_key,
        })
      ),
      canais.map((c) => ({
        id: c.id,
        label: c.label,
        radarEnabled: c.radar_enabled === true,
      })),
      embeddingsTeste,
      // ⚠️ As constantes REAIS, importadas de quem as usa — nunca
      // redigitadas aqui nem no dicionário: a tela mentiria na primeira
      // troca de modelo.
      MODELO_TRANSCRICAO,
      EMBEDDING_MODEL
    );

    return NextResponse.json({
      cartoes,
      testadoEm: pingar ? new Date().toISOString() : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
