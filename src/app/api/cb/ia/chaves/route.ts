import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults'
import { AiError, mensagemSeguraDeAiError, type AiProvider } from '@/lib/ai/types'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { MODELO_TRANSCRICAO } from '@/lib/transcricao/transcrever'
import {
  apagarChave,
  ehProvedor,
  gravarChave,
  lerChave,
  lerEstado,
} from '@/lib/ia-chaves/repo'
import { listarAgentes } from '@/lib/ia-agentes/repo'

/**
 * Chaves de IA por PROVEDOR (migration 1047, D1 do
 * docs/PLANO-agentes-de-ia.md). Só administrador.
 *
 * - `GET`    → se cada provedor tem chave, e desde quando. Nunca a chave.
 * - `PUT`    `{ provedor, chave }` → valida no provedor e grava (troca).
 * - `DELETE` `?provedor=` → apaga. Quem chama já mostrou o que para.
 *
 * ⚠️ A chave NUNCA volta em resposta nenhuma, nem mascarada, e a falha de
 * validação passa por `mensagemSeguraDeAiError`: a OpenAI ecoa a chave na
 * mensagem de erro ("Incorrect API key provided: sk-…").
 */

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-chaves:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)
    const chaves = await lerEstado(ctx.accountId)
    return NextResponse.json({ chaves })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ia-chaves]')) {
      console.error(err.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}

/**
 * Os modelos que a conta USA com este provedor: o do assistente e o do Radar
 * (a linha padrão de `ai_configs`, quando o provedor dela é este) e os dos
 * agentes de IA deste provedor (F1b). A chave nova é conferida em CADA um
 * (Codex, #294): passando só no modelo padrão, uma chave sem acesso ao modelo
 * em uso era aceita e o Radar, o rascunho e os agentes quebravam na troca.
 */
async function modelosEmUso(accountId: string, provedor: AiProvider): Promise<string[]> {
  // A padrão (assistente e Radar — o Radar a lê desligada ou não) e as de
  // conexão LIGADAS (agente por canal do app anterior): a desligada não roda
  // (`loadAiConfig` devolve null), e conferi-la travaria a troca por um
  // modelo que nada usa (Codex, #294).
  const { data, error } = await supabaseAdmin()
    .from('ai_configs')
    .select('provider, model, radar_model, channel_id, is_active')
    .eq('account_id', accountId)
  if (error) throw new Error(`[ia-chaves] leitura dos modelos em uso falhou: ${error.message}`)
  let agentes: Awaited<ReturnType<typeof listarAgentes>>
  try {
    agentes = await listarAgentes(accountId)
  } catch (err) {
    throw new Error(`[ia-chaves] leitura dos agentes falhou: ${err instanceof Error ? err.message : String(err)}`)
  }
  // O Radar só roda nas conexões com o interruptor ligado (`radar_enabled`,
  // 941): sem nenhuma, os modelos dele não estão em uso (Codex, #294).
  const { data: comRadar, error: erroRadar } = await supabaseAdmin()
    .from('cb_channels')
    .select('id')
    .eq('account_id', accountId)
    .eq('radar_enabled', true)
    .limit(1)
  if (erroRadar) throw new Error(`[ia-chaves] leitura das conexões com Radar falhou: ${erroRadar.message}`)
  const radarLigado = (comRadar ?? []).length > 0
  // A transcrição chama SEMPRE o modelo fixo com a chave do Gemini, qualquer
  // que seja o provedor dos agentes (Codex, #294): primeiro da lista (e
  // dentro do teto de modelos conferidos).
  const candidatos: unknown[] = provedor === 'gemini' ? [MODELO_TRANSCRICAO] : []
  // A linha PADRÃO (assistente e Radar) antes das de conexão e dos agentes,
  // pela régua e não pela ordem que o banco devolveu: com teto de modelos
  // conferidos, os da conta não podem cair para depois dele (Codex, #295).
  const ordenadas = [...(data ?? [])].sort(
    (a, b) => (a.channel_id === null ? 0 : 1) - (b.channel_id === null ? 0 : 1),
  )
  for (const linha of ordenadas) {
    if (linha.provider !== provedor) continue
    if (linha.channel_id !== null && linha.is_active === false) continue
    // Na linha padrão, só o que RODA (Codex, #294): o modelo do assistente
    // quando ele está ligado ou quando o Radar ligado o herda (sem modelo
    // próprio); o do Radar quando o Radar está ligado em alguma conexão. Um
    // modelo que nada usa não pode recusar a troca da chave.
    candidatos.push(
      ...(linha.channel_id === null
        ? [
            linha.is_active !== false || (radarLigado && !linha.radar_model) ? linha.model : null,
            radarLigado ? linha.radar_model : null,
          ]
        : [linha.model]),
    )
  }
  // Só os agentes LIGADOS: o desligado não roda, e conferi-lo travaria a troca
  // por um modelo que nada usa (a mesma régua da linha de conexão).
  candidatos.push(...agentes.filter((a) => a.provedor === provedor && a.ativo).map((a) => a.modelo))
  const modelos: string[] = []
  for (const m of candidatos) {
    if (typeof m === 'string' && m.trim() && !modelos.includes(m.trim())) modelos.push(m.trim())
  }
  return modelos
}

function configDeTeste(provedor: AiProvider, modelo: string, apiKey: string) {
  return {
    provider: provedor,
    model: modelo,
    radarModel: null,
    apiKey,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }
}

type Veredito =
  | { ok: true; modelosIndisponiveis: string[]; naoConferidos: string[]; transcricaoIndisponivel: boolean }
  | { ok: false; erro: unknown; modelo?: string }

/**
 * Falha passageira: não é resposta sobre a chave nem sobre o modelo — tempo
 * esgotado, rede, limite, e o 5xx do provedor (Codex, #294: o 5xx chega como
 * `provider_error`, o mesmo código do modelo inexistente; quem separa é o
 * status que o provedor devolveu).
 */
function falhaPassageira(err: unknown): boolean {
  if (!(err instanceof AiError)) return false
  if (['timeout', 'network_error', 'rate_limited'].includes(err.code)) return true
  return err.code === 'provider_error' && (err.upstreamStatus ?? 0) >= 500
}

/**
 * Teto de modelos conferidos numa gravação (Codex, #295): cada um é uma
 * geração PAGA com a chave da conta, e com muitos agentes em modelos
 * diferentes uma troca de chave custaria N chamadas e N × 30 s. Os primeiros
 * (o do assistente e o do Radar vêm antes dos agentes) são conferidos, em
 * PARALELO; os demais voltam num aviso, para o operador saber que não foram.
 */
const MAX_MODELOS_CONFERIDOS = 5

async function alcanca(provedor: AiProvider, modelo: string, chave: string): Promise<unknown | null> {
  try {
    await validateAiCredentials(configDeTeste(provedor, modelo, chave))
    return null
  } catch (err) {
    return err ?? new Error('falhou')
  }
}

/**
 * A chave nova serve? Conferida em cada modelo EM USO (senão, no padrão do
 * provedor), até o teto. Um modelo em uso que ela não alcança:
 * - a chave ATUAL alcança → recusa (`modelo_em_uso_recusado`): trocar quebraria
 *   o que funciona hoje, e a chave atual continua valendo;
 * - nem a atual alcança → o MODELO é que não vale mais (aposentado): aceita, e
 *   avisa quais trocar. Recusar travaria a troca de chave justamente quando o
 *   provedor aposenta o modelo (e o modelo não se troca sem chave que funcione).
 * A chave em si é conferida no modelo padrão do provedor quando todo modelo em
 * uso falhou: recusada ali, é a chave.
 *
 * ⚠️ O modelo da TRANSCRIÇÃO (Gemini) não é "trocável": é fixo no código
 * (`MODELO_TRANSCRICAO`), e nenhuma tela o muda (Codex, #294). Por isso ele
 * tem régua própria quando a chave nova não o alcança:
 * - sem chave atual → recusa (`transcricao_recusada`): gravar deixaria a
 *   transcrição quebrada sem nada que o administrador possa trocar;
 * - a chave atual alcança → recusa (`modelo_em_uso_recusado`, a regra geral);
 * - nem a atual alcança → a transcrição JÁ está fora do ar, e recusar só
 *   travaria a troca da chave (inclusive a de uma chave vazada) sem consertar
 *   nada: aceita, com aviso próprio (`transcricao_indisponivel`), que não
 *   manda trocar modelo nenhum.
 */
async function validarChaveNova(
  accountId: string,
  provedor: AiProvider,
  chave: string,
): Promise<Veredito> {
  const padrao = AI_PROVIDER_DEFAULT_MODEL[provedor]
  const emUso = await modelosEmUso(accountId, provedor)
  // O modelo da transcrição (Gemini) vem PRIMEIRO em `modelosEmUso`: fica
  // sempre dentro do teto.
  const aTestar = emUso.length > 0 ? emUso.slice(0, MAX_MODELOS_CONFERIDOS) : [padrao]
  const naoConferidos = emUso.slice(MAX_MODELOS_CONFERIDOS)

  const erros = await Promise.all(aTestar.map((m) => alcanca(provedor, m, chave)))
  // Chave recusada não melhora com outro modelo.
  const chaveRecusada = erros.find((e) => e instanceof AiError && e.code === 'invalid_key')
  if (chaveRecusada) return { ok: false, erro: chaveRecusada }
  const recusados = aTestar
    .map((modelo, i) => ({ modelo, erro: erros[i] }))
    .filter((r): r is { modelo: string; erro: unknown } => r.erro !== null)

  if (recusados.length === 0) return { ok: true, modelosIndisponiveis: [], naoConferidos, transcricaoIndisponivel: false }
  // Tempo esgotado, rede ou limite NÃO dizem nada sobre o acesso ao modelo:
  // nada é trocado, e o administrador tenta de novo (Codex, #294). Tratada como
  // "não alcança", a chave seria gravada sem ter sido conferida no modelo em uso.
  const passageira = recusados.find((r) => falhaPassageira(r.erro))
  if (passageira) return { ok: false, erro: passageira.erro }
  if (emUso.length === 0) return { ok: false, erro: recusados[0].erro }

  // Nenhum modelo em uso respondeu: a chave alcança ao menos o padrão?
  if (recusados.length === aTestar.length) {
    if (aTestar.includes(padrao)) return { ok: false, erro: recusados[0].erro }
    const noPadrao = await alcanca(provedor, padrao, chave)
    if (noPadrao !== null) return { ok: false, erro: noPadrao }
  }

  // A chave ATUAL alcança o modelo que a nova não alcança?
  // Sem conseguir LER a chave atual, não há como decidir: nada é trocado.
  let atual: string | null
  try {
    atual = (await lerChave(accountId, provedor)).chave
  } catch {
    return { ok: false, erro: 'leitura_falhou' }
  }
  const transcricao = provedor === 'gemini' ? recusados.find((r) => r.modelo === MODELO_TRANSCRICAO) : undefined
  if (transcricao && !atual) {
    return { ok: false, erro: 'transcricao_recusada', modelo: MODELO_TRANSCRICAO }
  }
  const chaveAtual = atual
  if (chaveAtual) {
    const comAtual = await Promise.all(recusados.map((r) => alcanca(provedor, r.modelo, chaveAtual)))
    // Passageira com a atual: não prova que o modelo saiu do ar.
    const passageiraComAtual = comAtual.find((e) => falhaPassageira(e))
    if (passageiraComAtual) return { ok: false, erro: passageiraComAtual }
    const i = comAtual.findIndex((e) => e === null)
    if (i >= 0) return { ok: false, erro: 'modelo_em_uso_recusado', modelo: recusados[i].modelo }
  }
  return {
    ok: true,
    modelosIndisponiveis: recusados.filter((r) => r !== transcricao).map((r) => r.modelo),
    naoConferidos,
    transcricaoIndisponivel: transcricao !== undefined,
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    // Cada gravação custa uma geração paga no provedor: o balde dos pings.
    const limite = checkRateLimit(`cb:ia-chaves:ping:${ctx.userId}`, RATE_LIMITS.integracoesPing)
    if (!limite.success) return rateLimitResponse(limite)

    const corpo = (await request.json().catch(() => null)) as {
      provedor?: unknown
      chave?: unknown
    } | null
    if (!corpo || !ehProvedor(corpo.provedor)) {
      return NextResponse.json({ error: 'provedor_invalido', code: 'provedor_invalido' }, { status: 400 })
    }
    const provedor = corpo.provedor
    const chave = typeof corpo.chave === 'string' ? corpo.chave.trim() : ''
    if (!chave) {
      return NextResponse.json({ error: 'chave_vazia', code: 'chave_vazia' }, { status: 400 })
    }

    const veredito = await validarChaveNova(ctx.accountId, provedor, chave)
    if (!veredito.ok) {
      if (veredito.erro === 'modelo_em_uso_recusado' || veredito.erro === 'transcricao_recusada') {
        return NextResponse.json(
          { error: veredito.erro, code: veredito.erro, modelo: veredito.modelo },
          { status: 400 },
        )
      }
      if (veredito.erro === 'leitura_falhou') {
        return NextResponse.json({ error: 'leitura_falhou', code: 'leitura_falhou' }, { status: 500 })
      }
      if (veredito.erro instanceof AiError) {
        // A tela conhece `network`, não o `network_error` do provedor.
        const code = veredito.erro.code === 'network_error' ? 'network' : veredito.erro.code
        return NextResponse.json(
          { error: mensagemSeguraDeAiError(veredito.erro), code },
          { status: 400 },
        )
      }
      console.error('[cb/ia/chaves PUT] validação falhou:', veredito.erro)
      return NextResponse.json(
        { error: 'provider_error', code: 'provider_error' },
        { status: 400 },
      )
    }

    // Avisos saem como CÓDIGO (a tela traduz e pinta de âmbar, não de verde):
    // - `embeddings_recusado`: a chave da OpenAI também serve à base de
    //   conhecimento, e uma chave de projeto RESTRITA pode gerar texto e não
    //   gerar embedding. Grava assim mesmo (o chat funciona), GUARDA a recusa
    //   (`serve_embeddings = false`, e a base passa a usar só a busca por
    //   palavras em vez de tentar e falhar a cada resposta) e avisa.
    // - `embeddings_nao_conferido`: a conferência não chegou a uma resposta
    //   (rede, limite, erro do provedor). Nada é afirmado: a coluna fica
    //   nula ("serve", como antes) e a tela avisa.
    // - `modelo_em_uso_indisponivel`: um modelo em uso não respondeu nem com
    //   a chave anterior (aposentado?) — a tela diz quais trocar.
    // - `transcricao_indisponivel`: o modelo FIXO da transcrição não respondeu
    //   nem com a chave anterior — não há modelo a trocar; a tela diz que a
    //   transcrição de áudio segue fora do ar.
    // - `modulos_nao_criados`: ver abaixo.
    const avisos: string[] = []
    if (veredito.modelosIndisponiveis.length > 0) avisos.push('modelo_em_uso_indisponivel')
    if (veredito.transcricaoIndisponivel) avisos.push('transcricao_indisponivel')
    if (veredito.naoConferidos.length > 0) avisos.push('modelos_nao_conferidos')
    let serveEmbeddings: boolean | null = null
    if (provedor === 'openai') {
      try {
        await embedTexts(chave, ['ping'])
        serveEmbeddings = true
      } catch (err) {
        // Só a RECUSA (401/403, `invalid_key`) é resposta sobre a chave.
        if (err instanceof AiError && err.code === 'invalid_key') {
          serveEmbeddings = false
          avisos.push('embeddings_recusado')
        } else {
          avisos.push('embeddings_nao_conferido')
        }
      }
    }

    // PRIMEIRA configuração da conta: sem a linha padrão de `ai_configs`, o
    // Radar não teria provedor nem modelo e ficaria em `sem_ia` com a chave
    // cadastrada. Nasce com o provedor desta chave, o modelo padrão dele e o
    // assistente DESLIGADO — o mesmo que salvar a primeira chave em
    // Integrações fazia antes da 1047. Linha que já existe não é tocada.
    const { data: padrao, error: erroPadrao } = await ctx.supabase
      .from('ai_configs')
      .select('id')
      .eq('account_id', ctx.accountId)
      .is('channel_id', null)
      .maybeSingle()
    if (erroPadrao) {
      console.error('[cb/ia/chaves PUT] leitura da configuração dos módulos falhou:', erroPadrao.message)
      avisos.push('modulos_nao_criados')
    } else if (!padrao) {
      const { error: erroInsert } = await ctx.supabase.from('ai_configs').insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        provider: provedor,
        model: AI_PROVIDER_DEFAULT_MODEL[provedor],
        is_active: false,
      })
      if (erroInsert) {
        // A chave ficou gravada, mas o Radar ficaria sem provedor (`sem_ia`)
        // com a tela dizendo "Salvo". Aviso, não sucesso.
        console.error('[cb/ia/chaves PUT] criação da configuração dos módulos falhou:', erroInsert.message)
        avisos.push('modulos_nao_criados')
      }
    }

    // DEPOIS da linha padrão: a gravação também atualiza a cópia legada
    // (`ai_configs.api_key`) para uma volta atrás do deploy, e a linha recém-
    // criada precisa existir para receber a cópia.
    await gravarChave(ctx.accountId, provedor, chave, ctx.userId, serveEmbeddings)

    return NextResponse.json({
      ok: true,
      avisos,
      modelos: veredito.modelosIndisponiveis,
      naoConferidos: veredito.naoConferidos,
    })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ia-chaves]')) {
      console.error(err.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-chaves:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)

    const provedor = new URL(request.url).searchParams.get('provedor')
    if (!ehProvedor(provedor)) {
      return NextResponse.json({ error: 'provedor_invalido', code: 'provedor_invalido' }, { status: 400 })
    }
    const apagada = await apagarChave(ctx.accountId, provedor)

    // ⚠️ A cópia LEGADA também sai. A 1047 deixou `ai_configs.api_key` (e
    // `embeddings_api_key`) com o texto cifrado de antes, para o app anterior
    // poder voltar atrás — e qualquer membro lê essa coluna pelo PostgREST.
    // Sem limpar, a chave "apagada" continuaria no banco e voltaria a valer
    // numa reversão do deploy (ou num replay da cópia da 1047).
    const db = supabaseAdmin()
    const { error: erroLegado } = await db
      .from('ai_configs')
      .update({ api_key: null })
      .eq('account_id', ctx.accountId)
      .eq('provider', provedor)
    const { error: erroEmbeddings } =
      provedor === 'openai'
        ? await db.from('ai_configs').update({ embeddings_api_key: null }).eq('account_id', ctx.accountId)
        : { error: null }
    if (erroLegado || erroEmbeddings) {
      console.error(
        '[cb/ia/chaves DELETE] limpeza da cópia legada falhou:',
        erroLegado?.message ?? erroEmbeddings?.message,
      )
      return NextResponse.json({ error: 'banco', code: 'banco', apagada }, { status: 500 })
    }
    return NextResponse.json({ ok: true, apagada })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ia-chaves]')) {
      console.error(err.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}
