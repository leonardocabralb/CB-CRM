import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';
import { buildMediaPath } from '@/lib/storage/media-path';

/**
 * Preparar o envio de um item do acervo: COPIA o objeto para o caminho normal
 * de anexo e devolve o rascunho que o compositor já sabe tratar.
 *
 * ⚠️⚠️ A CÓPIA É O CORAÇÃO DESTA ROTA, não uma otimização. Duas razões:
 *
 *   1. o compositor APAGA o objeto quando o envio falha ou o rascunho é
 *      descartado (`deleteAccountMedia`), e cancelar uma agendada apaga também
 *      (932). Enviando por referência, um envio falho destruiria o arquivo do
 *      escritório inteiro — e ninguém ligaria uma coisa à outra;
 *   2. num CRM jurídico o que FOI ENVIADO não muda depois. Com a cópia, apagar
 *      ou trocar o item não mexe na mensagem que o cliente recebeu.
 *
 * `copy()` roda dentro do Storage: nada trafega por aqui, nem para baixar nem
 * para subir.
 *
 * Papel `agent` — quem envia mensagem envia do acervo. Montar o acervo é que é
 * de admin.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const admin = supabaseAdmin();
    const { data: item, error } = await admin
      .from('cb_media_library')
      .select('id, tipo, media_path, filename, mime_type')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      // Erro de banco NÃO é "não encontrado" (regra do projeto): virar 404
      // aqui faria o atendente cadastrar o arquivo de novo.
      console.error('[POST /api/cb/acervo/copiar] lookup:', error.message);
      return NextResponse.json({ error: 'Failed to load item' }, { status: 500 });
    }
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const destino = buildMediaPath(ctx.accountId, item.filename as string);
    const { error: erroCopia } = await admin.storage
      .from(CHAT_MEDIA_BUCKET)
      .copy(item.media_path as string, destino);

    if (erroCopia) {
      console.error('[POST /api/cb/acervo/copiar] copy:', erroCopia.message);
      return NextResponse.json({ error: 'COPY_FAILED' }, { status: 502 });
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(destino);

    return NextResponse.json({
      kind: item.tipo,
      mediaUrl: publicUrl,
      path: destino,
      filename: item.filename,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
