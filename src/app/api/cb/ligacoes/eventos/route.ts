import { after, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  computadorDoCabecalho,
  segredoDoCrm,
  todosOsComputadores,
  veioPeloDominioPublico,
} from '@/lib/whatsapp/ligacoes/computador'
import { lerAviso, receberAviso } from '@/lib/whatsapp/ligacoes/pelo-crm'

/** Os avisos são JSON pequeno; o teto só barra o absurdo. */
const TETO_DO_AVISO = 16 * 1024

/**
 * POST /api/cb/ligacoes/eventos  (o computador de ligações, pela rede interna)
 *
 * Os avisos da máquina (`maquina-de-ligacoes/src/avisos.ts`): sinal de vida,
 * chamando, atendida, encerrada. Autenticação: o segredo DO computador no
 * cabeçalho (`computador.ts`); o pedido pelo domínio público é 404.
 *
 * O contrato com a máquina, que repete o aviso: 2xx entregue; 5xx/408/429
 * tenta de novo (até 30 min); outro 4xx larga o aviso. Por isso a falha do
 * banco é 500 (volta) e o aviso malformado ou de ligação desconhecida é 4xx
 * (não adianta voltar). Repetir um aviso não estraga nada: cada informação é
 * gravada uma vez só.
 */
export async function POST(request: Request) {
  if (veioPeloDominioPublico(request)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const segredo = segredoDoCrm()
  if (!segredo) return NextResponse.json({ error: 'ligacoes_nao_configuradas' }, { status: 503 })

  const db = supabaseAdmin()
  const computadores = await todosOsComputadores(db)
  if (computadores === 'falhou') return NextResponse.json({ error: 'falhou' }, { status: 500 })
  const computador = computadorDoCabecalho(request.headers.get('authorization'), computadores, segredo)
  if (!computador) return NextResponse.json({ error: 'sem_autorizacao' }, { status: 401 })

  const tamanho = Number(request.headers.get('content-length') ?? '0')
  if (tamanho > TETO_DO_AVISO) return NextResponse.json({ error: 'corpo_grande' }, { status: 413 })
  const aviso = lerAviso(await request.json().catch(() => null), computador.nome)
  if (!aviso) return NextResponse.json({ error: 'aviso_invalido' }, { status: 400 })

  const r = await receberAviso({ db, computador, aviso, agendar: (tarefa) => after(tarefa) })
  if (r === 'falhou') return NextResponse.json({ error: 'falhou' }, { status: 500 })
  if (r === 'desconhecida') return NextResponse.json({ error: 'ligacao_desconhecida' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
