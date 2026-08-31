import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  caminhoEhDoAcervo,
  TETO_DE_BYTES,
  tipoPeloMime,
} from '@/lib/acervo/tipos';
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';
// Server-importável: evolution-media.ts (transporte) já consome daqui.
import { MEDIA_MAX_BYTES_BY_KIND } from '@/lib/storage/upload-media';

/**
 * Cadastrar um item no acervo (migration 953).
 *
 * ⚠️ O ARQUIVO sobe direto do navegador para o Storage (a policy da 020/023 já
 * escopa a escrita por conta); esta rota grava só a LINHA. Passar 16 MB por
 * dentro do Next seria tráfego a mais e um limite de corpo para administrar.
 *
 * ⚠️ Três coisas que esta rota faz e o navegador NÃO pode fazer:
 *   1. conferir o papel (admin+ monta o acervo — decisão do operador);
 *   2. DERIVAR `media_url` do caminho (`getPublicUrl`). Aceitá-la do cliente
 *      permitiria casar um caminho legítimo da conta com uma URL de fora, e o
 *      CRM entregaria aquilo ao cliente (a lição da 932);
 *   3. exigir que o caminho esteja sob `account-<conta>/acervo/`. Sem isso, a
 *      linha do acervo poderia apontar para o anexo de uma mensagem — que o
 *      compositor APAGA quando o envio falha, levando o item junto.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const body = (await request.json().catch(() => null)) as {
      titulo?: unknown;
      categoria?: unknown;
      media_path?: unknown;
      mime_type?: unknown;
      size_bytes?: unknown;
      filename?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
    if (!titulo || titulo.length > 120) {
      return NextResponse.json(
        { error: "'titulo' is required (1–120 chars)" },
        { status: 400 }
      );
    }

    // Categoria é opcional: ausente, vazia ou só espaço viram NULL — "Geral"
    // na tela. Um `''` gravado furaria o CHECK da 953.
    const categoriaCrua =
      typeof body.categoria === 'string' ? body.categoria.trim() : '';
    const categoria = categoriaCrua || null;
    if (categoria && categoria.length > 60) {
      return NextResponse.json(
        { error: "'categoria' is too long (max 60)" },
        { status: 400 }
      );
    }

    const mediaPath =
      typeof body.media_path === 'string' ? body.media_path.trim() : '';
    if (!mediaPath || !caminhoEhDoAcervo(mediaPath, ctx.accountId)) {
      return NextResponse.json(
        { error: 'media_path is not inside this account acervo folder' },
        { status: 400 }
      );
    }

    const mime = typeof body.mime_type === 'string' ? body.mime_type : '';
    const tipo = tipoPeloMime(mime);
    if (!tipo) {
      return NextResponse.json(
        { error: 'UNSUPPORTED_MIME', mime },
        { status: 400 }
      );
    }

    const size = typeof body.size_bytes === 'number' ? body.size_bytes : 0;
    // ⚠️ Teto POR TIPO (o da tela e do envio), não só o chapado do bucket:
    // com 16MB para tudo, uma imagem de 5–16MB cadastrada por fora da tela
    // entrava no acervo e FALHAVA no envio com o 400 confuso da Meta (o cap
    // de imagem é 5MB). A tela já valida por tipo; a rota é o backstop do
    // POST direto (ledger 48h). O teto do bucket segue como cinto.
    const tetoDoTipo = Math.min(TETO_DE_BYTES, MEDIA_MAX_BYTES_BY_KIND[tipo]);
    if (!Number.isFinite(size) || size <= 0 || size > tetoDoTipo) {
      return NextResponse.json(
        { error: 'size_bytes out of range', max_bytes: tetoDoTipo },
        { status: 400 }
      );
    }

    const filename =
      typeof body.filename === 'string' && body.filename.trim()
        ? body.filename.trim().slice(0, 255)
        : mediaPath.split('/').pop()!;

    const admin = supabaseAdmin();

    // ⚠️⚠️ AS DUAS ARMADILHAS DO `exists()`, e esta conferência já caiu na
    // primeira (932): quando o objeto NÃO está lá, ele RESOLVE com
    // `data: false` E `error` preenchido ao mesmo tempo (o 400/404 do HEAD
    // vira StorageError e volta junto com a resposta) — ler o `error` como
    // falha responderia "existe" para todo arquivo ausente, o único caso
    // para o qual a conferência serve, e o acervo ganharia item que entrega
    // 404 ao cliente. Por isso SÓ o `data` é lido do resultado resolvido.
    // A segunda metade: qualquer OUTRA falha (5xx, rede) é LANÇADA
    // (`throw error` no storage-js). Sem o try/catch, o "Storage fora do
    // ar" era um ramo inalcançável — o blip virava 500 no toErrorResponse e
    // recusava um upload que deu certo, o oposto do desenho. Mesma família
    // do catch que o disparador da 932 já tinha (ledger 48h).
    let existe: boolean | null;
    try {
      const r = await admin.storage.from(CHAT_MEDIA_BUCKET).exists(mediaPath);
      existe = r.data;
    } catch (erroExiste) {
      // Storage fora do ar não é "sumiu": seguir e gravar a linha é melhor que
      // recusar um upload que deu certo.
      console.warn(
        '[POST /api/cb/acervo] não deu para conferir o arquivo:',
        erroExiste instanceof Error ? erroExiste.message : erroExiste
      );
      existe = null;
    }
    if (existe === false) {
      return NextResponse.json({ error: 'FILE_NOT_FOUND' }, { status: 400 });
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(mediaPath);

    // Nome congelado, mesma cascata do `memberLabel` e da 912: `full_name` é
    // NOT NULL mas o trigger de signup grava '' — vazio é possível.
    const { data: perfil } = await ctx.supabase
      .from('profiles')
      .select('full_name, email')
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const criadorNome =
      (perfil?.full_name as string | null)?.trim() ||
      (perfil?.email as string | null) ||
      null;

    const { data: item, error } = await admin
      .from('cb_media_library')
      .insert({
        account_id: ctx.accountId,
        titulo,
        categoria,
        tipo,
        media_path: mediaPath,
        media_url: publicUrl,
        mime_type: mime.split(';')[0]!.trim().toLowerCase(),
        size_bytes: Math.round(size),
        filename,
        criador_user_id: ctx.userId,
        criador_nome: criadorNome,
      })
      .select('*')
      .single();

    if (error) {
      // 23505 = o índice único do caminho: dois cadastros para o mesmo objeto.
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'FILE_ALREADY_IN_LIBRARY' },
          { status: 409 }
        );
      }
      console.error('[POST /api/cb/acervo]', error.message);
      return NextResponse.json({ error: 'Failed to save item' }, { status: 500 });
    }

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
