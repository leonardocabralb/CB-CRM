import { NextResponse } from 'next/server';

/**
 * GET /api/whatsapp/evolution/state — DESATIVADA (410 Gone).
 *
 * Par da rota `connect`: consultava o estado da instância única e espelhava
 * em `whatsapp_config`. Com N canais, "qual é o estado da instância?" perdeu
 * sentido sem dizer DE QUAL canal.
 *
 * Substituída por POST /api/cb/channels/[id]/connect, que devolve o QR e o
 * estado de um canal específico. Nenhuma tela aponta para cá.
 */
export async function GET() {
  return NextResponse.json(
    {
      error:
        'Esta rota foi desativada. Use POST /api/cb/channels/[id]/connect para o QR e o estado de um canal específico.',
      code: 'route_retired',
    },
    { status: 410 },
  );
}
