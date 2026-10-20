import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  BUCKET_DA_MARCA,
  COLUNA_DA_PECA,
  caracteres,
  corValida,
  LIMITE_DO_NOME,
  LIMITE_DO_NOME_CURTO,
  PECAS_DA_MARCA,
  resolverMarca,
  type LinhaDaMarca,
  type PecaDaMarca,
} from '@/lib/marca'
import {
  COLUNAS_DA_MARCA,
  contaDaInstalacao,
  lerLinhaDaMarca,
  TAG_DA_MARCA,
  urlPublicaDaMarca,
} from '@/lib/marca-servidor'
import { CAMPO_DA_PECA, validarPeca, type ExtensaoDaPeca } from '@/lib/marca-validacao'

// ============================================================
// /api/cb/marca — a marca da instalação (1094), lida e trocada pela aba
// Configurações → Marca. Plano: `docs/PLANO-marca-configuravel.md`.
//
// QUEM PODE (D1 do plano): ler, qualquer membro logado (a aba mostra a
// marca a todos, em modo leitura). Trocar e voltar ao padrão, só o ADMIN da
// conta MAIS ANTIGA da instalação (`contaDaInstalacao`). O cadastro dá a
// todo login novo uma conta avulsa em que ele é admin: "qualquer admin"
// deixaria essa gente trocar o logo que todas as contas veem. Falha ao
// descobrir a conta da instalação é 500 (`falha_no_banco`), nunca 403 —
// "você não pode" dito por causa de um soluço do banco faria o dono
// desistir de uma permissão que ele tem.
//
// POR QUE NOME ÚNICO POR GRAVAÇÃO: cada imagem sobe em
// `<peca>/<uuid>.<ext>`, nunca por cima da anterior. O bucket é público e a
// URL é servida com cache de um ano (`cacheControl`): o mesmo nome com outro
// conteúdo ficaria velho no navegador e na CDN por tempo indeterminado. Com
// nome novo, a URL nova chega pela marca (que o `revalidateTag` refaz) e a
// antiga simplesmente deixa de ser pedida.
//
// POR QUE GRAVAR → APAGAR: os arquivos SUBSTITUÍDOS só saem depois de a
// linha apontar para os novos. Na ordem inversa, uma falha na gravação
// deixaria a linha apontando para arquivo apagado — logo quebrado na tela
// de login de todo mundo. Arquivo órfão (apagar falhou) é só lixo no
// bucket, não erro do usuário: vira aviso no log.
//
// A gravação é PARCIAL (só as colunas que este pedido muda; o upsert do
// PostgREST atualiza só as colunas enviadas): dois admins salvando ao mesmo
// tempo, um trocando o símbolo e outro a horizontal, não desfazem um ao
// outro.
// ============================================================

type Motivo = null | 'nao_admin' | 'nao_e_a_conta_da_instalacao'

function erro(codigo: string, status: number, extra?: { peca?: string }) {
  return NextResponse.json({ erro: codigo, ...extra }, { status })
}

/** O corpo do GET — e da resposta de POST e DELETE. */
function corpo(linha: LinhaDaMarca | null, motivo: Motivo) {
  return {
    marca: resolverMarca(linha, urlPublicaDaMarca),
    linha,
    podeEditar: motivo === null,
    motivo,
  }
}

/** Por que esta pessoa NÃO troca a marca (`null` = pode). Lança em erro de leitura. */
async function motivoParaNaoEditar(ctx: AccountContext): Promise<Motivo> {
  if (!hasMinRole(ctx.role, 'admin')) return 'nao_admin'
  return (await contaDaInstalacao()) === ctx.accountId
    ? null
    : 'nao_e_a_conta_da_instalacao'
}

/** Caminho gravado de uma peça (`null` = a linha não tem essa peça). */
function caminhoDa(linha: LinhaDaMarca | null, peca: PecaDaMarca): string | null {
  const caminho = linha?.[COLUNA_DA_PECA[peca] as keyof LinhaDaMarca]
  return caminho && caminho.trim() ? caminho : null
}

/** Melhor esforço: arquivo que não saiu é lixo no bucket, não erro do usuário. */
async function apagarArquivos(caminhos: string[], contexto: string) {
  if (caminhos.length === 0) return
  try {
    const { error } = await supabaseAdmin().storage.from(BUCKET_DA_MARCA).remove(caminhos)
    if (error) {
      console.warn(`[api/cb/marca] ${contexto}: ${caminhos.length} arquivo(s) ficaram no bucket:`, error.message)
    }
  } catch (falha) {
    console.warn(`[api/cb/marca] ${contexto}: ${caminhos.length} arquivo(s) ficaram no bucket:`, falha)
  }
}


/** Conta de quem pede pode trocar a marca? Responde o erro pronto, ou `null`. */
async function recusaDeEscrita(ctx: AccountContext): Promise<NextResponse | null> {
  let motivo: Motivo
  try {
    motivo = await motivoParaNaoEditar(ctx)
  } catch (falha) {
    console.error('[api/cb/marca] conta da instalação ilegível:', falha)
    return erro('falha_no_banco', 500)
  }
  return motivo ? erro(motivo, 403) : null
}

// Ponto de código, não unidade UTF-16: é o que o `char_length` do CHECK
// conta (um emoji vale 1 lá e 2 em `.length`). A aba conta pela MESMA função.
const tamanho = caracteres

/** Texto aparado; `undefined` = o campo não veio (ou veio como arquivo). */
function textoDe(form: FormData, campo: string): string | undefined {
  const valor = form.get(campo)
  return typeof valor === 'string' ? valor.trim() : undefined
}

const PECA_DO_CAMPO = new Map(PECAS_DA_MARCA.map((peca) => [CAMPO_DA_PECA[peca], peca]))
const CAMPOS_DE_TEXTO = new Set(['nome', 'nome_curto', 'cor_do_icone', 'remover'])

/**
 * GET — a marca da linha LIDA AGORA (nunca `obterMarca`, que é cacheada):
 * a aba precisa ver a verdade logo depois de gravar. Erro de leitura é 500,
 * nunca o padrão fingido (a aba ofereceria "trocar" uma marca que existe).
 */
export async function GET() {
  let ctx: AccountContext
  try {
    ctx = await getCurrentAccount()
  } catch (falha) {
    return toErrorResponse(falha)
  }
  try {
    const motivo = await motivoParaNaoEditar(ctx)
    return NextResponse.json(corpo(await lerLinhaDaMarca(), motivo))
  } catch (falha) {
    console.error('[GET /api/cb/marca]', falha)
    return erro('falha_no_banco', 500)
  }
}

/**
 * POST multipart — grava a marca própria. Campos de texto `nome`
 * (obrigatório), `nome_curto` e `cor_do_icone` (ausente = mantém; vazio =
 * limpa); arquivos por peça (ausente = mantém); `remover` repetível. Peça
 * com arquivo novo E em `remover`: vale o arquivo (substituir já remove a
 * anterior).
 */
export async function POST(request: Request) {
  let ctx: AccountContext
  try {
    ctx = await requireRole('admin')
  } catch (falha) {
    return toErrorResponse(falha)
  }
  const recusa = await recusaDeEscrita(ctx)
  if (recusa) return recusa

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    // Corpo que não é multipart (ou cortado no caminho).
    return erro('corpo_invalido', 400)
  }

  const nome = textoDe(form, 'nome')
  if (!nome) return erro('nome_obrigatorio', 400)
  if (tamanho(nome) > LIMITE_DO_NOME) return erro('nome_longo', 400)

  // `undefined` = não mexe; `null` = limpa (veio vazio).
  const nomeCurtoCru = textoDe(form, 'nome_curto')
  const nomeCurto = nomeCurtoCru === undefined ? undefined : nomeCurtoCru || null
  if (nomeCurto && tamanho(nomeCurto) > LIMITE_DO_NOME_CURTO) {
    return erro('nome_curto_longo', 400)
  }
  const corCrua = textoDe(form, 'cor_do_icone')
  const cor = corCrua === undefined ? undefined : corCrua || null
  if (cor && !corValida(cor)) return erro('cor_invalida', 400)

  const remover = new Set<PecaDaMarca>()
  for (const valor of form.getAll('remover')) {
    const peca = typeof valor === 'string' ? PECA_DO_CAMPO.get(valor) : undefined
    if (!peca) {
      return erro('peca_desconhecida', 400, typeof valor === 'string' ? { peca: valor } : undefined)
    }
    remover.add(peca)
  }

  // Arquivo num campo que não é peça (`horizontalEscuro`, `logo`…) seria
  // ignorado em silêncio, e a tela diria "salvo" sem a imagem.
  for (const [campo, valor] of form.entries()) {
    if (typeof valor !== 'string' && !PECA_DO_CAMPO.has(campo) && !CAMPOS_DE_TEXTO.has(campo)) {
      return erro('peca_desconhecida', 400, { peca: campo })
    }
  }

  const novos: { peca: PecaDaMarca; bytes: Uint8Array; tipo: string; extensao: ExtensaoDaPeca }[] = []
  for (const peca of PECAS_DA_MARCA) {
    const campo = CAMPO_DA_PECA[peca]
    const valor = form.get(campo)
    if (valor === null || valor === '') continue
    if (typeof valor === 'string') return erro('tipo_nao_aceito', 400, { peca: campo })
    // Campo de arquivo deixado em branco num <form>: o navegador manda um
    // arquivo vazio e sem nome.
    if (valor.size === 0 && valor.name === '') continue
    const bytes = new Uint8Array(await valor.arrayBuffer())
    const resultado = validarPeca(peca, { tipo: valor.type, tamanho: valor.size, bytes })
    if (!resultado.ok) return erro(resultado.erro, 400, { peca: campo })
    novos.push({ peca, bytes, tipo: resultado.tipo, extensao: resultado.extensao })
  }

  let atual: LinhaDaMarca | null
  try {
    atual = await lerLinhaDaMarca()
  } catch (falha) {
    console.error('[POST /api/cb/marca] leitura da marca atual:', falha)
    return erro('falha_no_banco', 500)
  }

  const caminhoNovo = new Map<PecaDaMarca, string>(
    novos.map(({ peca, extensao }) => [
      peca,
      `${CAMPO_DA_PECA[peca].replace(/_/g, '-')}/${crypto.randomUUID()}.${extensao}`,
    ]),
  )

  // A marca própria precisa de nome E símbolo depois de aplicado o pedido:
  // é o símbolo que vira o ícone da aba e do app instalado.
  const simboloFinal =
    caminhoNovo.get('simbolo') ?? (remover.has('simbolo') ? null : caminhoDa(atual, 'simbolo'))
  if (!simboloFinal) return erro('simbolo_obrigatorio', 400, { peca: CAMPO_DA_PECA.simbolo })

  const storage = supabaseAdmin().storage.from(BUCKET_DA_MARCA)
  const subidos: string[] = []
  for (const { peca, bytes, tipo } of novos) {
    const caminho = caminhoNovo.get(peca)!
    let falha: unknown = null
    try {
      // O supabase-js DEVOLVE o erro do Storage; rede e 5xx podem LANÇAR.
      const { error } = await storage.upload(caminho, bytes, {
        contentType: tipo,
        cacheControl: '31536000',
        upsert: false,
      })
      falha = error
    } catch (lancada) {
      falha = lancada
    }
    if (falha) {
      console.error(`[POST /api/cb/marca] upload de ${caminho}:`, falha)
      // O que falhou entra junto: pode ter chegado ao bucket (resposta
      // perdida), e apagar o que não existe não custa nada.
      await apagarArquivos([...subidos, caminho], 'desfazer o upload que falhou no meio')
      return erro('falha_no_storage', 500)
    }
    subidos.push(caminho)
  }

  const gravar: Record<string, unknown> = {
    id: true,
    nome,
    atualizado_em: new Date().toISOString(),
    atualizado_por: ctx.userId,
  }
  if (nomeCurto !== undefined) gravar.nome_curto = nomeCurto
  if (cor !== undefined) gravar.cor_do_icone = cor
  for (const peca of PECAS_DA_MARCA) {
    if (caminhoNovo.has(peca)) gravar[COLUNA_DA_PECA[peca]] = caminhoNovo.get(peca)
    else if (remover.has(peca)) gravar[COLUNA_DA_PECA[peca]] = null
  }

  let linhaNova: LinhaDaMarca | null = null
  let recusaComprovada = false
  try {
    const { data, error, status } = await supabaseAdmin()
      .from('cb_marca')
      .upsert(gravar, { onConflict: 'id' })
      .select(COLUNAS_DA_MARCA)
      .single()
    if (error) {
      console.error('[POST /api/cb/marca] gravação:', status, error.message)
      // 4xx é o PostgREST recusando (CHECK, tipo): a transação não gravou.
      recusaComprovada = status >= 400 && status < 500
    } else linhaNova = data as unknown as LinhaDaMarca
  } catch (falha) {
    console.error('[POST /api/cb/marca] gravação:', falha)
  }
  if (!linhaNova) {
    // ⚠️ Só a recusa COMPROVADA apaga o que este pedido subiu. Rede, tempo
    // esgotado e 5xx (o 504 do gateway) não provam que o banco não gravou —
    // nem uma releitura logo depois prova, porque a transação pode commitar
    // depois dela (Codex no #420). Ali os arquivos ficam: órfão é lixo;
    // logo apontando para arquivo apagado é defeito.
    if (recusaComprovada) {
      await apagarArquivos(subidos, 'desfazer o upload da gravação recusada')
    } else if (subidos.length > 0) {
      console.warn('[api/cb/marca] gravação incerta; os arquivos novos ficam no bucket:', subidos)
    }
    return erro('falha_no_banco', 500)
  }

  // A marca nova vale já na próxima página — ANTES de apagar os arquivos
  // antigos, para nenhuma página nova sair apontando para eles.
  revalidateTag(TAG_DA_MARCA, { expire: 0 })

  const vivos = new Set(PECAS_DA_MARCA.map((peca) => caminhoDa(linhaNova, peca)))
  const substituidos = PECAS_DA_MARCA.filter((peca) => caminhoNovo.has(peca) || remover.has(peca))
    .map((peca) => caminhoDa(atual, peca))
    .filter((caminho): caminho is string => caminho !== null && !vivos.has(caminho))
  await apagarArquivos(substituidos, 'apagar as peças substituídas')

  return NextResponse.json(corpo(linhaNova, null))
}

/**
 * DELETE — volta ao padrão: apaga a linha e as imagens dela. A linha é lida
 * PELO PRÓPRIO DELETE (`RETURNING`): os arquivos apagados são exatamente os
 * da linha que saiu, mesmo com outra gravação no meio.
 */
export async function DELETE() {
  let ctx: AccountContext
  try {
    ctx = await requireRole('admin')
  } catch (falha) {
    return toErrorResponse(falha)
  }
  const recusa = await recusaDeEscrita(ctx)
  if (recusa) return recusa

  let apagadas: LinhaDaMarca[]
  try {
    const { data, error } = await supabaseAdmin()
      .from('cb_marca')
      .delete()
      .eq('id', true)
      .select(COLUNAS_DA_MARCA)
    if (error) {
      console.error('[DELETE /api/cb/marca]', error.message)
      return erro('falha_no_banco', 500)
    }
    apagadas = (data ?? []) as unknown as LinhaDaMarca[]
  } catch (falha) {
    console.error('[DELETE /api/cb/marca]', falha)
    return erro('falha_no_banco', 500)
  }

  revalidateTag(TAG_DA_MARCA, { expire: 0 })
  await apagarArquivos(
    apagadas.flatMap((linha) =>
      PECAS_DA_MARCA.map((peca) => caminhoDa(linha, peca)).filter(
        (caminho): caminho is string => caminho !== null,
      ),
    ),
    'voltar ao padrão',
  )

  return NextResponse.json(corpo(null, null))
}
