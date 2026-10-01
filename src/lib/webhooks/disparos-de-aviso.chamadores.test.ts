import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { DEAL_WEBHOOK_EVENTS, WEBHOOK_EVENTS } from './events';

// ============================================================
// Quem EMITE cada aviso de saída — manifesto exato (default-deny).
//
// A doc pública (`docs/public-api.md` → Webhooks, `docs/webhooks.md` e a aba
// Documentação, com `Settings.webhooks.catalogoDeEventos`) promete QUAIS
// eventos saem, de onde, e uma ordem: na mensagem que abre a conversa,
// `conversation.created` sai antes de `message.received`. Quem cumpre isso
// são os caminhos de ingestão (o webhook da Meta, `inbound-store.ts`, a DM
// do Instagram) — arquivos grandes, mexidos toda semana por outros motivos,
// e por isso fora dos globs do portão `scripts/doc-acompanha.mjs` (o
// `Doc-inalterada` viraria rotina). A promessa mora aqui (achado do Codex no
// PR #368): disparo novo, disparo que some, que muda de arquivo ou de ORDEM
// reprova — e a doc muda no mesmo PR que atualiza este manifesto.
//
// A FORMA do `data` de cada evento já é cobrada pelo compilador:
// `dispatchWebhookEvent` é genérico sobre `dados-dos-eventos.ts`, que está
// no glob do portão.
// ============================================================

const SRC = path.resolve(__dirname, '..', '..');

/** Arquivo → os eventos que ele dispara, na ordem em que aparecem no fonte. */
const DISPAROS: Record<string, string[]> = {
  // Meta: o recibo (status) e a ENTRADA do cliente — a conversa antes da
  // mensagem.
  'app/api/whatsapp/webhook/route.ts': [
    'message.status_updated',
    'conversation.created',
    'message.received',
  ],
  // Evolution: o recibo; a entrada passa por `inbound-store.ts`.
  'app/api/whatsapp/evolution/webhook/route.ts': ['message.status_updated'],
  // A entrada pela Evolution: a conversa antes da mensagem.
  'lib/whatsapp/inbound-store.ts': ['conversation.created', 'message.received'],
  // A DM do Instagram: idem.
  'lib/instagram/persistir.ts': ['conversation.created', 'message.received'],
  // Os três `deal.*`, saídos da fila do funil: o evento vem da linha.
  'lib/webhooks/entregar-eventos-de-funil.ts': ['<variável>'],
};

function arquivos(dir: string, saida: string[] = []): string[] {
  for (const nome of fs.readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    if (fs.statSync(caminho).isDirectory()) arquivos(caminho, saida);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

/** O manifesto medido no fonte (sem comentários — eles citam a função ao explicar). */
function disparosNoFonte(): Record<string, string[]> {
  const medido: Record<string, string[]> = {};
  for (const caminho of arquivos(SRC)) {
    const fonte = fs
      .readFileSync(caminho, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const eventos: string[] = [];
    for (const m of fonte.matchAll(/dispatchWebhookEvent\(\s*[^,]+,\s*[^,]+,\s*(?:'([^']+)'|[\w.]+)/g)) {
      eventos.push(m[1] ?? '<variável>');
    }
    if (eventos.length > 0) medido[path.relative(SRC, caminho)] = eventos;
  }
  return medido;
}

describe('quem emite cada aviso de saída', () => {
  it('o manifesto é EXATO: disparo novo, sumido, mudado de arquivo ou de ordem reprova', () => {
    expect(disparosNoFonte()).toEqual(DISPAROS);
  });

  it('na entrada do cliente, `conversation.created` vem antes de `message.received`', () => {
    for (const [arquivo, eventos] of Object.entries(DISPAROS)) {
      const conversa = eventos.indexOf('conversation.created');
      if (conversa === -1) continue;
      expect(eventos.indexOf('message.received'), arquivo).toBeGreaterThan(conversa);
    }
  });

  it('todo evento declarado tem quem o emita', () => {
    const emitidos = new Set([
      ...Object.values(DISPAROS).flat(),
      ...DEAL_WEBHOOK_EVENTS, // pela fila do funil (`<variável>` acima)
    ]);
    for (const evento of WEBHOOK_EVENTS) expect(emitidos.has(evento), evento).toBe(true);
  });
});
