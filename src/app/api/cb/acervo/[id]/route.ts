import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';

/**
 * Renomear/recategorizar e apagar item do acervo (migration 953).
 *
 * Só `titulo` e `categoria` mudam. TROCAR O ARQUIVO de um item não existe de
 * propósito: as mensagens já enviadas carregam uma CÓPIA (ver a rota
 * `copiar`), então trocar aqui não reescreveria o passado — mas o item mudaria
 * de conteúdo sem mudar de nome, e ninguém na equipe saberia. Trocar arquivo é
 * apagar e cadastrar de novo.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    if (!UUID.test(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as {
      titulo?: unknown;
      categoria?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const patch: { titulo?: string; categoria?: string | null } = {};

    if (body.titulo !== undefined) {
      const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
      if (!titulo || titulo.length > 120) {
        return NextResponse.json(
          { error: "'titulo' must be 1–120 chars" },
          { status: 400 }
        );
      }
      patch.titulo = titulo;
    }

    // ⚠️ Ausente = "não mexe"; presente e vazia = "tira a categoria". Sem essa
    // distinção não haveria como devolver um item para "Geral".
    if (body.categoria !== undefined) {
      const cat =
        typeof body.categoria === 'string' ? body.categoria.trim() : '';
      if (cat.length > 60) {
        return NextResponse.json(
          { error: "'categoria' is too long (max 60)" },
          { status: 400 }
        );
      }
      patch.categoria = cat || null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // ⚠️ O `.eq('account_id')` não é decorativo: service-role ignora RLS, e
    // sem ele o id de outra conta seria editável daqui.
    const { data: item, error } = await supabaseAdmin()
      .from('cb_media_library')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/cb/acervo]', error.message);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    if (!UUID.test(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // ⚠️ A LINHA PRIMEIRO, o objeto depois — e o caminho sai do RETORNO do
    // delete, não de uma leitura anterior. Apagando o arquivo antes, uma falha
    // no delete da linha deixaria um item na lista com URL morta: o atendente
    // o enviaria e o cliente receberia um link quebrado. Na ordem inversa o
    // pior caso é um objeto órfão no bucket, que não aparece para ninguém.
    const { data: apagado, error } = await admin
      .from('cb_media_library')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('media_path')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/cb/acervo]', error.message);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
    if (!apagado) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const { error: erroStorage } = await admin.storage
      .from(CHAT_MEDIA_BUCKET)
      .remove([apagado.media_path as string]);
    if (erroStorage) {
      // Órfão no bucket não é falha do ponto de vista de quem apagou: o item
      // sumiu da lista, que é o que foi pedido.
      console.warn(
        '[DELETE /api/cb/acervo] arquivo ficou no bucket:',
        erroStorage.message
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
