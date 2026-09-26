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
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import { lerChave, lerChaveDeEmbeddings, lerEstado } from '@/lib/ia-chaves/repo';
import { listarAgentes } from '@/lib/ia-agentes/repo';
import {
  montarCartoes,
  type ChaveParaMontar,
  type ProviderId,
  type Teste,
} from '@/lib/integracoes/montar';

/**
 * GET /api/cb/integracoes/status  (admin+)
 *
 * A aba de Integrações num pedido só: a chave de cada provedor de IA da
 * conta (`cb_ia_chaves`, 1042), com um ping REAL em cada uma (o mesmo
 * `validateAiCredentials` do botão "Testar chave" — com o modelo que o
 * assistente usa quando é o provedor dele), mais o ping de embeddings com
 * a chave da OpenAI (RAG) e o cartão do Google Agenda.
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

// ⚠️ DECORATIVO em produção: o deploy roda `node server.js` num container
// (CLAUDE.md, seção do maxDuration) e nada aplica este valor. Quem protege
// a rota de um provedor emperrado é o AbortSignal de 30s de cada geração
// (shared.ts) — os cartões rápidos respondem porque cada ping tem teto
// próprio, não por causa desta linha. Fica pelo valor documental e por
// plataformas que a leem (Vercel), como nas outras rotas de IA.
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
  if (err instanceof AiError) {
    // ⚠️ Os adapters emitem `network_error` (shared.ts); o contrato com o
    // cliente chama isso de `network`. Sem a ponte, VPS sem rede no ping
    // colapsava em `provider_error` — "o provedor devolveu um erro" — e a
    // tela mandava trocar uma chave boa, com `motivo.network` morto nos
    // dois dicionários.
    if (err.code === 'network_error') return 'network';
    if (CODIGOS.has(err.code)) return err.code;
  }
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

interface LinhaPadrao {
  provider: AiProvider;
  model: string;
  radar_model: string | null;
  is_active: boolean;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const pingar = new URL(request.url).searchParams.get('ping') !== '0';

    // ⚠️ Baldes diferentes: a carga sem ping só lê o banco; a COM ping
    // gasta uma geração paga por chave da conta.
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

    // ⚠️ Desde a 1042 a chave é do PROVEDOR (`cb_ia_chaves`, fechada ao
    // navegador — lida pelo serviço); a linha PADRÃO de `ai_configs` é a
    // configuração dos módulos (provedor e modelo do Radar) e do assistente
    // legado. As linhas de CONEXÃO (herdadas; não há escritor no app) entram
    // só como USO da chave do provedor delas, e só as ligadas — é o que a
    // resposta automática legada lê (Codex, #294).
    let estado: Awaited<ReturnType<typeof lerEstado>>;
    let padrao: LinhaPadrao | null;
    let deConexao: (LinhaPadrao & { channel_id: string })[];
    let canais: Awaited<ReturnType<typeof listChannels>>;
    try {
      const [estadoLido, linhasLidas, canaisLidos] = await Promise.all([
        lerEstado(ctx.accountId),
        ctx.supabase
          .from('ai_configs')
          .select('channel_id, provider, model, radar_model, is_active')
          .eq('account_id', ctx.accountId),
        listChannels(ctx.supabase, ctx.accountId),
      ]);
      if (linhasLidas.error) throw new Error(linhasLidas.error.message);
      const linhas = (linhasLidas.data ?? []) as (LinhaPadrao & { channel_id: string | null })[];
      estado = estadoLido;
      padrao = linhas.find((l) => l.channel_id === null) ?? null;
      deConexao = linhas.filter(
        (l): l is LinhaPadrao & { channel_id: string } => l.channel_id !== null && l.is_active
      );
      canais = canaisLidos;
    } catch (err) {
      console.error('[integracoes] leitura falhou:', err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: 'Não foi possível carregar as integrações.' },
        { status: 500 }
      );
    }

    // Um ping por chave cadastrada, com o modelo que ela vai rodar: o do
    // assistente quando é o provedor dele, senão o padrão do provedor. Mais o
    // ping dos embeddings com a chave da OpenAI (a busca da base). Tudo em
    // paralelo: em série o pior caso somava o teto de um ao do outro.
    const [testes, embeddingsTeste] = await Promise.all([
      Promise.all(
        estado.map(async (e): Promise<ChaveParaMontar> => {
          const base = { provedor: e.provedor as ProviderId, existe: e.existe };
          if (!pingar || !e.existe) return { ...base, teste: null };
          let chave: string | null;
          try {
            const lida = await lerChave(ctx.accountId, e.provedor);
            if (lida.ilegivel) return { ...base, teste: { ok: false, motivo: 'chave_ilegivel' } };
            chave = lida.chave;
          } catch {
            // Falha de LEITURA do banco não é o provedor recusando: a tela mandaria
            // trocar uma chave boa.
            return { ...base, teste: { ok: false, motivo: 'leitura_falhou' } };
          }
          if (!chave) return { ...base, existe: false, teste: null };
          // A chave da OpenAI que nasceu SÓ da base (1042) e que nada de chat
          // usa: não é pingada no modelo de chat — pode ser restrita aos
          // embeddings, e o cartão diria "falhando" sobre o único uso que ela
          // tem. Quem diz se ela funciona é o ping dos embeddings (Codex, #294).
          const usadaNoChat =
            padrao?.provider === e.provedor || deConexao.some((l) => l.provider === e.provedor);
          if (e.soDaBase && !usadaNoChat) return { ...base, teste: { ok: true } };
          const apiKey = chave;
          // ⚠️ O ping testa o modelo do CHAT (ou o padrão do provedor) E o de
          // cada agente de CONEXÃO ligado deste provedor: a resposta
          // automática legada chama o modelo da linha dela, e um modelo
          // aposentado ali falharia com o cartão dizendo "funcionando"
          // (Codex, #294). O do Radar é validado no SAVE — pingá-lo aqui
          // seria uma segunda chamada paga a cada carga desta tela.
          const modelos = [
            padrao && padrao.provider === e.provedor
              ? padrao.model
              : AI_PROVIDER_DEFAULT_MODEL[e.provedor],
            ...deConexao.filter((l) => l.provider === e.provedor).map((l) => l.model),
          ].filter((m, i, todos) => typeof m === 'string' && m.trim() !== '' && todos.indexOf(m) === i);
          const falhas = await Promise.all(
            modelos.map(async (model) => {
              try {
                await validateAiCredentials({
                  provider: e.provedor,
                  model,
                  radarModel: null,
                  apiKey,
                  systemPrompt: null,
                  isActive: true,
                  autoReplyEnabled: false,
                  autoReplyMaxPerConversation: 3,
                  handoffAgentId: null,
                  embeddingsApiKey: null,
                });
                return null;
              } catch (err) {
                return motivoSeguro(err);
              }
            })
          );
          const falha = falhas.find((f) => f !== null);
          return { ...base, teste: falha ? { ok: false, motivo: falha } : { ok: true } };
        })
      ),
      (async (): Promise<Teste | 'recusada'> => {
        const temOpenai = estado.some((e) => e.provedor === 'openai' && e.existe);
        if (!pingar || !temOpenai) return null;
        try {
          // A MESMA chave que a base usa: a própria dos embeddings (1042), ou
          // a da OpenAI — que, recusada pela OpenAI ao ser gravada, não é
          // pingada de novo (é a resposta que já se tem).
          const lida = await lerChaveDeEmbeddings(ctx.accountId);
          if (lida.ilegivel) return { ok: false, motivo: 'chave_ilegivel' };
          // Recusada ao gravar: a base usa a busca por palavras e o chat
          // funciona — o cartão não fica "falhando" por isso (Codex, #294).
          if (lida.recusada) return 'recusada';
          if (!lida.chave) return null;
          return pingEmbeddings(lida.chave);
        } catch {
          return { ok: false, motivo: 'leitura_falhou' };
        }
      })(),
    ]);

    const cartoes = montarCartoes(
      testes,
      padrao
        ? {
            provider: padrao.provider as ProviderId,
            model: padrao.model,
            radarModel: padrao.radar_model,
            isActive: padrao.is_active,
          }
        : null,
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
      EMBEDDING_MODEL,
      deConexao.map((l) => ({
        provider: l.provider as ProviderId,
        model: l.model,
        canal: canais.find((c) => c.id === l.channel_id)?.label ?? l.channel_id,
      })),
      // Os agentes de IA (1043) de cada provedor. Leitura que falha só tira a
      // lista do cartão (log) — não derruba a tela das chaves.
      await listarAgentes(ctx.accountId)
        .then((lista) =>
          lista.map((a) => ({
            nome: a.nome,
            provedor: a.provedor as ProviderId,
            modelo: a.modelo,
            ativo: a.ativo,
          }))
        )
        .catch((err) => {
          console.error('[integracoes] leitura dos agentes falhou:', err instanceof Error ? err.message : err);
          return [];
        })
    );

    return NextResponse.json({
      cartoes,
      testadoEm: pingar ? new Date().toISOString() : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
