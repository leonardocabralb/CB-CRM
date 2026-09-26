import { NextResponse } from 'next/server'

import type { CodigoDeRecusa } from './agente'
import { ErroDoAgente } from './repo'

/** Recusa da validação → 400 com o CÓDIGO (a tela traduz). */
export function recusa(codigo: CodigoDeRecusa) {
  return NextResponse.json({ error: codigo, code: codigo }, { status: 400 })
}

/** `ErroDoAgente` → resposta; outro erro volta `null` (o chamador segue com `toErrorResponse`). */
export function respostaDoErro(err: unknown): NextResponse | null {
  if (!(err instanceof ErroDoAgente)) return null
  const status =
    err.codigo === 'nao_encontrado'
      ? 404
      : err.codigo === 'nome_repetido'
        ? 409
        : err.codigo === 'banco'
          ? 500
          : 400
  if (status === 500) console.error('[ia-agentes]', err.message)
  return NextResponse.json({ error: err.codigo, code: err.codigo }, { status })
}
