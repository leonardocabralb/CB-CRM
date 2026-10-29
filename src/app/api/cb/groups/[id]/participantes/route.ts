// ============================================================
// GET /api/cb/groups/[id]/participantes
//
// Quem está no grupo, lido AO VIVO no WhatsApp (`findGroupInfos`, ~0,8 s).
// Ao vivo de propósito: guardar a lista exigiria acompanhar cada entrada e
// saída, e ela envelheceria sem aviso. Telefone de participante é dado
// pessoal: a lista existe só nesta resposta, nunca no banco (D4 do plano:
// quem vê o grupo vê quem está nele, como no próprio WhatsApp).
//
// A mesma leitura ATUALIZA o espelho do grupo (contagem, "somos admin?",
// nome), como o detalhamento da sincronização: abrir o painel destrava o
// renomear quando o número é admin. E devolve `podeRenomear` com o
// `restrict` do grupo, que não é guardado (D2: grupo que deixa qualquer
// participante mudar os dados também libera).
//
// ⚠️ Vazio NUNCA vira "nenhum participante": o número desta conexão está no
// grupo (senão a Evolution nem leria os dados), então lista vazia é resposta
// que não se entendeu — 502, como a falha.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getChannelWithSecrets } from '@/lib/cb-channels/repo';
import { ehEvolution } from '@/lib/cb-channels/transporte';
import {
  camposDoDetalhe,
  lerParticipantes,
  parseGroupInfo,
  podeRenomearAoVivo,
} from '@/lib/cb-groups/sync';
import { nomearParticipantes, ordenarParticipantes } from '@/lib/cb-groups/nomes-dos-participantes';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { decrypt } from '@/lib/whatsapp/encryption';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('viewer');
    const limit = checkRateLimit(`cb:groupParticipants:${ctx.userId}`, RATE_LIMITS.whatsappAdmin);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Posse pela RLS do pedido, e só DEPOIS o service-role (credenciais do
    // canal, fichas e mensagens para os nomes, a gravação do espelho).
    const { data: grupo, error: erroDoGrupo } = await ctx.supabase
      .from('cb_groups')
      .select('id, jid, channel_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (erroDoGrupo) {
      console.error('[cb/groups/participantes] ler o grupo falhou:', erroDoGrupo.message);
      return NextResponse.json({ error: 'Não foi possível ler o grupo.' }, { status: 500 });
    }
    if (!grupo) {
      return NextResponse.json({ error: 'Grupo não encontrado.' }, { status: 404 });
    }
    const { jid, channel_id: channelId } = grupo as { jid: string; channel_id: string | null };

    const db = admin();
    const canal = channelId ? await getChannelWithSecrets(db, ctx.accountId, channelId) : null;
    if (!canal || !ehEvolution(canal) || !canal.server_url || !canal.instance_name || !canal.api_key) {
      return NextResponse.json(
        { error: 'A conexão deste grupo não está disponível.', code: 'SEM_CONEXAO' },
        { status: 409 },
      );
    }

    const client = new EvolutionClient({
      baseUrl: canal.server_url,
      instance: canal.instance_name,
      apikey: decrypt(canal.api_key),
    });

    let bruto: unknown;
    try {
      bruto = await client.findGroupInfos(jid);
    } catch (err) {
      console.error(
        '[cb/groups/participantes] findGroupInfos falhou:',
        err instanceof Error ? err.message : err,
      );
      bruto = null;
    }
    const participantes = lerParticipantes(bruto, canal.display_phone ?? null);
    if (!participantes.length) {
      return NextResponse.json(
        { error: 'O WhatsApp não respondeu agora.', code: 'WHATSAPP_INDISPONIVEL' },
        { status: 502 },
      );
    }
    const info = parseGroupInfo(bruto, canal.display_phone ?? null);

    // O espelho. Falhar aqui não tira a lista da tela: ela já veio.
    const { data: atualizado, error: erroDoEspelho } = await db
      .from('cb_groups')
      .update(camposDoDetalhe(info, new Date().toISOString()))
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();
    if (erroDoEspelho) {
      console.error('[cb/groups/participantes] atualizar o grupo falhou:', erroDoEspelho.message);
    }

    const { data: conversa, error: erroDaConversa } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('group_id', id)
      .maybeSingle();
    if (erroDaConversa) {
      console.error('[cb/groups/participantes] ler a conversa falhou:', erroDaConversa.message);
    }

    const comNome = await nomearParticipantes(db, {
      accountId: ctx.accountId,
      conversationId: (conversa as { id: string } | null)?.id ?? null,
      participantes,
    });

    return NextResponse.json({
      participantes: ordenarParticipantes(comNome),
      podeRenomear: podeRenomearAoVivo(info),
      soAdminEdita: info.soAdminEdita,
      grupo: erroDoEspelho ? null : (atualizado ?? null),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
