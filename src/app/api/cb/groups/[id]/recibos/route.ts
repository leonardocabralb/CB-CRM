// ============================================================
// GET /api/cb/groups/[id]/recibos?mensagem=<id da mensagem no WhatsApp>
//
// "Dados da mensagem" de uma mensagem nossa num grupo (1119): quem de fora
// da conta recebeu e quem leu, com a hora, lido do BANCO (decisão do
// operador, 04/11/2026: sem ler o grupo ao vivo). Os recibos chegam um por
// participante pelo 5º patch da Evolution (`recibos-do-grupo.ts`).
//
// O nome: a FICHA gravada com o recibo (o cliente); senão a regra do painel
// de participantes (`nomes-dos-participantes.ts`: o nome com que a pessoa
// escreveu no grupo); sem nenhum, a tela diz "Número oculto" — nunca o LID
// cru. O telefone de quem recebeu NÃO é guardado (decisão do operador de
// 29/10/2026); só aparece quando o próprio participante é um JID de telefone
// (grupo endereçado por telefone, raro).
//
// ⚠️ Lista vazia é "nenhum recibo REGISTRADO", nunca "ninguém recebeu": a
// mensagem de antes do patch não tem recibo nenhum. Leitura que falha é 500,
// nunca uma lista vazia com cara de resposta. E o PostgREST corta em 1000
// linhas: o `total` vem pelo `count` exato, e a tela não afirma número acima
// do que leu.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { nomearParticipantes } from '@/lib/cb-groups/nomes-dos-participantes';
import { telefoneDoJid } from '@/lib/cb-groups/recibos-do-grupo';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** O id que a Baileys dá (`3EB0…`), com folga; nada além disso vai à consulta. */
const ID_DA_MENSAGEM = /^[A-Za-z0-9_-]{8,128}$/;

/** Fatia do `.in()` de ids de ficha: 100 uuids cabem com folga na URL. */
const FATIA_DE_FICHAS = 100;

interface LinhaDoRecibo {
  participante: string;
  contact_id: string | null;
  entregue_em: string;
  lida_em: string | null;
}

/** O nome de cada ficha. A fatia que falha só tira nomes (o log diz). */
async function nomesDasFichas(
  db: ReturnType<typeof admin>,
  accountId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += FATIA_DE_FICHAS) {
    const { data, error } = await db
      .from('contacts')
      .select('id, name')
      .eq('account_id', accountId)
      .in('id', unicos.slice(i, i + FATIA_DE_FICHAS));
    if (error) {
      console.error('[cb/groups/recibos] ler as fichas falhou:', error.message);
      continue;
    }
    for (const c of (data ?? []) as { id: string; name: string | null }[]) {
      const nome = c.name?.trim();
      if (nome) mapa.set(c.id, nome);
    }
  }
  return mapa;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('viewer');
    const limit = checkRateLimit(`cb:groupReceipts:${ctx.userId}`, RATE_LIMITS.whatsappAdmin);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const mensagem = new URL(request.url).searchParams.get('mensagem') ?? '';
    if (!ID_DA_MENSAGEM.test(mensagem)) {
      return NextResponse.json({ error: 'Mensagem inválida.' }, { status: 400 });
    }

    // Posse pela RLS do pedido: o grupo e os recibos são lidos como quem
    // pediu. Só os nomes usam o service-role, como no painel do grupo.
    const { data: grupo, error: erroDoGrupo } = await ctx.supabase
      .from('cb_groups')
      .select('id, participantes_de_fora')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (erroDoGrupo) {
      console.error('[cb/groups/recibos] ler o grupo falhou:', erroDoGrupo.message);
      return NextResponse.json({ error: 'Não foi possível ler o grupo.' }, { status: 500 });
    }
    if (!grupo) {
      return NextResponse.json({ error: 'Grupo não encontrado.' }, { status: 404 });
    }

    const { data: linhas, error: erroDosRecibos, count } = await ctx.supabase
      .from('cb_recibos_do_grupo')
      .select('participante, contact_id, entregue_em, lida_em', { count: 'exact' })
      .eq('account_id', ctx.accountId)
      .eq('group_id', id)
      .eq('message_id', mensagem);
    if (erroDosRecibos) {
      console.error('[cb/groups/recibos] ler os recibos falhou:', erroDosRecibos.message);
      return NextResponse.json({ error: 'Não foi possível ler os recibos.' }, { status: 500 });
    }
    const recibos = (linhas ?? []) as LinhaDoRecibo[];

    let fichas = new Map<string, string>();
    let doGrupo = new Map<string, string | null>();
    if (recibos.length) {
      const db = admin();
      const { data: conversa, error: erroDaConversa } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('group_id', id)
        .maybeSingle();
      if (erroDaConversa) {
        console.error('[cb/groups/recibos] ler a conversa falhou:', erroDaConversa.message);
      }
      // O nome é enfeite: a leitura que falha deixa "Número oculto" na tela.
      const [nomesDeFicha, { participantes }] = await Promise.all([
        nomesDasFichas(
          db,
          ctx.accountId,
          recibos.flatMap((r) => (r.contact_id ? [r.contact_id] : [])),
        ),
        nomearParticipantes(db, {
          accountId: ctx.accountId,
          conversationId: (conversa as { id: string } | null)?.id ?? null,
          participantes: recibos.map((r) => ({
            id: r.participante,
            telefone: telefoneDoJid(r.participante),
            lid: r.participante.endsWith('@lid') ? r.participante : null,
            papel: null,
            somosNos: false,
          })),
        }),
      ]);
      fichas = nomesDeFicha;
      doGrupo = new Map(participantes.map((p) => [p.id, p.nome]));
    }

    // Quem leu primeiro, depois quem só recebeu — cada grupo pela hora.
    const ordenados = [...recibos].sort((a, b) => {
      if (!!a.lida_em !== !!b.lida_em) return a.lida_em ? -1 : 1;
      const ta = a.lida_em ?? a.entregue_em;
      const tb = b.lida_em ?? b.entregue_em;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    return NextResponse.json({
      recibos: ordenados.map((r) => ({
        participante: r.participante,
        nome: (r.contact_id ? fichas.get(r.contact_id) : undefined) ?? doGrupo.get(r.participante) ?? null,
        telefone: telefoneDoJid(r.participante),
        entregueEm: r.entregue_em,
        lidaEm: r.lida_em,
      })),
      // Acima de 1000 o PostgREST corta: o total vem do `count`.
      total: typeof count === 'number' ? count : recibos.length,
      participantesDeFora: (grupo as { participantes_de_fora: number | null }).participantes_de_fora ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
