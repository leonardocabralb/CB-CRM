import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  computadorDoCabecalho,
  segredoDoCrm,
  todosOsComputadores,
  veioPeloDominioPublico,
} from '@/lib/whatsapp/ligacoes/computador'
import { ARQUIVOS_DA_GRAVACAO, receberGravacao, TETO_DA_GRAVACAO } from '@/lib/whatsapp/ligacoes/pelo-crm'

type Params = { params: Promise<{ ligacao: string; arquivo: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PUT /api/cb/ligacoes/gravacao/[ligacao]/[arquivo]  (o computador de
 * ligações, pela rede interna)
 *
 * A máquina manda cada arquivo da gravação (`estereo.ogg`, `cliente.ogg`,
 * `atendente.ogg`, Opus) e o apaga quando recebe 2xx; em qualquer outra
 * resposta ele fica lá e volta 5 min depois. O CRM guarda no bucket PRIVADO
 * `ligacoes` — a chave de serviço do Supabase nunca vai à máquina.
 *
 * ⚠️ O Next guarda só os primeiros 10 MB do corpo quando há middleware, e
 * corta o resto SEM erro (`proxyClientMaxBodySize`): o tamanho lido é
 * conferido contra o declarado, e o arquivo cortado é recusado (fica na
 * máquina). 30 min de estéreo dão ~5,4 MB.
 */
export async function PUT(request: Request, { params }: Params) {
  if (veioPeloDominioPublico(request)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const segredo = segredoDoCrm()
  if (!segredo) return NextResponse.json({ error: 'ligacoes_nao_configuradas' }, { status: 503 })

  const db = supabaseAdmin()
  const computadores = await todosOsComputadores(db)
  if (computadores === 'falhou') return NextResponse.json({ error: 'falhou' }, { status: 500 })
  const computador = computadorDoCabecalho(request.headers.get('authorization'), computadores, segredo)
  if (!computador) return NextResponse.json({ error: 'sem_autorizacao' }, { status: 401 })

  const { ligacao, arquivo } = await params
  if (!UUID.test(ligacao) || !(ARQUIVOS_DA_GRAVACAO as readonly string[]).includes(arquivo)) {
    return NextResponse.json({ error: 'pedido_invalido' }, { status: 400 })
  }
  const declarado = Number(request.headers.get('content-length'))
  if (!Number.isInteger(declarado) || declarado <= 0 || declarado > TETO_DA_GRAVACAO) {
    return NextResponse.json({ error: 'tamanho_invalido' }, { status: 413 })
  }
  const corpo = Buffer.from(await request.arrayBuffer())
  if (corpo.length !== declarado) return NextResponse.json({ error: 'corpo_cortado' }, { status: 413 })

  const r = await receberGravacao({ db, computador, ligacaoId: ligacao, arquivo, corpo })
  if (r === 'falhou') return NextResponse.json({ error: 'falhou' }, { status: 500 })
  if (r === 'desconhecida') return NextResponse.json({ error: 'ligacao_desconhecida' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
