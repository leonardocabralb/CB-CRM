import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { copiarDoAcervo } from '@/lib/acervo/copiar';

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
 * A cópia mora em `copiarDoAcervo` (`src/lib/acervo/copiar.ts`) desde que o
 * nó "Enviar mídia" do robô passou a mandar arquivo do acervo (26/09/2026):
 * uma regra só para os dois chamadores.
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

    const copia = await copiarDoAcervo(supabaseAdmin(), ctx.accountId, id);

    if (!copia.ok) {
      if (copia.erro === 'leitura') {
        // Erro de banco NÃO é "não encontrado" (regra do projeto): virar 404
        // aqui faria o atendente cadastrar o arquivo de novo.
        console.error('[POST /api/cb/acervo/copiar] lookup:', copia.detalhe);
        return NextResponse.json({ error: 'Failed to load item' }, { status: 500 });
      }
      if (copia.erro === 'nao_encontrado') {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }
      console.error('[POST /api/cb/acervo/copiar] copy:', copia.detalhe);
      return NextResponse.json({ error: 'COPY_FAILED' }, { status: 502 });
    }

    return NextResponse.json({
      kind: copia.tipo,
      mediaUrl: copia.mediaUrl,
      path: copia.path,
      filename: copia.filename,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
