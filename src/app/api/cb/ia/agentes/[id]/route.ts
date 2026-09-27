import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { lerAlteracao } from '@/lib/ia-agentes/agente'
import { arquivarAgente, atualizarAgente, etapasDosAgentes, obterAgenteComEtapas } from '@/lib/ia-agentes/repo'
import { recusa, respostaDoErro } from '@/lib/ia-agentes/resposta'

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Um agente de IA (só administrador, D14), com as ETAPAS em que atua (D24).
 * `PATCH` aceita `etapas: string[]` (a lista INTEIRA): etapa de outro funil
 * que não é da conta → 400; etapa de OUTRO agente → 409 `etapa_ocupada` com o
 * nome dele. `DELETE` ARQUIVA (e o gatilho solta as etapas).
 *
 * F3: o agente vem com o `acesso` (os blocos que ele vê além da conversa;
 * `lerAcesso`), e o `PATCH` aceita `acesso` inteiro — `campos` fora da forma
 * (não uuid, mais de 50) é 400 `lista_invalida`. Os documentos da base são
 * outra rota (`…/documentos`).
 *
 * F4 (D28): o agente vem com as `ferramentas` (as ações que ele pode fazer
 * junto com a resposta; `lerFerramentas`), e o `PATCH` aceita `ferramentas`
 * inteiro. Forma errada = 400 `lista_invalida`; item de outra conta, etapa de
 * ganho/perdido, campo de data vigiado por lembrete e automação com passo
 * fora da D5 ou "Aguardar" (nela ou nas que ela aciona) = 400 com `code`
 * (`item_de_outra_conta`, `etapa_de_resultado`, `campo_vigiado`,
 * `automacao_fora_da_d5`) e os ids recusados em `itens`. As automações de
 * ENTRADA da etapa e as de etiqueta não são conferidas (a D5 vale só para o
 * que o agente faz, 27/09/2026). O catálogo da tela é `…/ferramentas/opcoes`.
 *
 * F5: `ferramentas.marcar_reuniao = { tipos_de_evento: [uri] }` — no máximo
 * UMA URI de tipo de evento do Calendly (`https://api.calendly.com/event_types/<id>`;
 * outra forma ou mais de uma = 400 `lista_invalida`). Tipo que não é ATIVO
 * na conta do Calendly conectado = 400 `tipo_de_evento_invalido`; sem
 * Calendly conectado = 400 `calendly_desconectado` (os dois com `itens` =
 * [uri]).
 */
export async function GET(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    const agente = await obterAgenteComEtapas(ctx.accountId, id)
    // Arquivado é "não existe mais" para a tela: aberto pela URL, ele
    // pareceria vivo e editável, e todo botão responderia 404 (revisão da F1b).
    if (!agente || agente.arquivadoEm) {
      return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    }
    return NextResponse.json({ agente })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-agentes:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })

    const lida = lerAlteracao(await request.json().catch(() => null), false)
    if (!lida.ok) return recusa(lida.codigo)
    const agente = await atualizarAgente(ctx.accountId, ctx.userId, id, lida.valor)
    const etapas = await etapasDosAgentes(ctx.accountId, [id])
    return NextResponse.json({ agente: { ...agente, etapas: etapas.get(id) ?? [] } })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-agentes:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    await arquivarAgente(ctx.accountId, ctx.userId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
