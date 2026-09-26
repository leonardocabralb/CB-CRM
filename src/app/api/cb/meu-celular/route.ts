// ============================================================
// PUT /api/cb/meu-celular — grava o celular de QUEM CHAMA.
//
// Corpo: { celular: string } — o texto como a pessoa digitou.
// Resposta: 200 { celular } (os dígitos gravados) ou 400 { error: <motivo> },
// com o motivo de `celularDigitado` ('vazio' | 'curto' | 'invalido' |
// 'nao_e_celular') ou 'corpo_invalido'.
//
// ⚠️ A ÚNICA porta de escrita de `cb_celulares_dos_membros` (1046):
// `authenticated` só tem SELECT, então a régua do número mora aqui e em mais
// lugar nenhum do banco. A linha é SEMPRE a do login da sessão — o corpo não
// carrega `user_id`, e é isso que impede alguém de gravar o número de um
// colega (a service role passa por cima da RLS).
//
// Qualquer papel grava o próprio: a tela de exigência pede o celular a todo
// membro, `viewer` incluso.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { celularDigitado } from '@/lib/account/celular';

export async function PUT(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const corpo = (await request.json().catch(() => null)) as {
      celular?: unknown;
    } | null;
    if (typeof corpo?.celular !== 'string') {
      return NextResponse.json({ error: 'corpo_invalido' }, { status: 400 });
    }

    const r = celularDigitado(corpo.celular);
    if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 400 });

    const { error } = await supabaseAdmin()
      .from('cb_celulares_dos_membros')
      .upsert(
        {
          user_id: ctx.userId,
          celular: r.digitos,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      // Só código e mensagem: o `details` do PostgREST traz a linha recusada.
      console.error('[meu-celular] upsert error:', {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json({ error: 'falhou' }, { status: 500 });
    }

    return NextResponse.json({ celular: r.digitos });
  } catch (err) {
    return toErrorResponse(err);
  }
}
