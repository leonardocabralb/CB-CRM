// ============================================================
// Guarda de papel para rotas que já resolvem a conta à mão.
//
// A família `/api/whatsapp/*` nasceu antes do multi-usuário e autentica com
// `auth.getUser()` + consulta em `profiles`, sem nunca olhar o PAPEL. O
// resultado é que um convidado `viewer` — que existe justamente para ser
// somente-leitura — conseguia enviar mensagem para clientes, reagir,
// disparar campanha, mexer na conexão do WhatsApp e nos modelos.
//
// A RLS não fecha esse buraco: as políticas de escrita exigem `agent`, mas
// o efeito colateral que importa (a chamada à Meta ou à Evolution) acontece
// ANTES de qualquer gravação. Quando o banco recusa, a mensagem já saiu.
//
// Esta função existe em vez de trocar as 7 rotas por `requireRole`: elas têm
// preâmbulos de autenticação, limites de taxa e formatos de erro próprios, e
// reescrever tudo de uma vez em código que envia mensagem para cliente real
// é risco desnecessário. Aqui é uma linha por rota.
// ============================================================

import { NextResponse } from 'next/server';

import { hasMinRole, isAccountRole, type AccountRole } from './roles';

/**
 * Devolve a resposta de erro quando o papel não alcança o mínimo, ou `null`
 * quando a rota pode seguir.
 *
 * Papel ausente ou desconhecido é tratado como BARRADO, nunca como
 * permitido: uma linha de `profiles` sem `account_role` é estado
 * inesperado, e no caso de dúvida o certo é recusar.
 */
export function barrarPorPapel(
  papel: unknown,
  minimo: AccountRole,
): NextResponse | null {
  if (!isAccountRole(papel)) {
    return NextResponse.json(
      { error: 'Seu perfil não tem papel definido nesta conta.' },
      { status: 403 },
    );
  }
  if (!hasMinRole(papel, minimo)) {
    return NextResponse.json(
      { error: `Esta ação exige o papel '${minimo}' ou superior.` },
      { status: 403 },
    );
  }
  return null;
}
