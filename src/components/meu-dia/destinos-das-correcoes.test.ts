import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ORDEM_DAS_FONTES } from '@/lib/meu-dia/correcoes';

// ============================================================
// Cada correção do Meu dia leva ao lugar onde ela SE CONSERTA. Pino
// estrutural sobre `blocos-de-operacao.tsx` (o componente não tem teste de
// render): o `DESTINO` é um `Record<FonteDeCorrecao, …>`, então o compilador
// cobra uma entrada por fonte — mas não cobra que ela aponte para o log certo.
//
// Nasceu da revisão da Fase 3-III do merge do upstream: Calendly e webhooks
// eram UMA fonte com o destino de Integrações, que não tem o log dos
// webhooks — e o telefone recusado do webhook, que passou a contar ali, só se
// resolve lendo esse log.
// ============================================================

const FONTE = fs
  .readFileSync(path.join(__dirname, 'blocos-de-operacao.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

function destinoDe(fonte: string): string {
  const m = FONTE.match(new RegExp(`${fonte}: \\{\\s*href: ([^,]+),\\s*ve: (\\w+)`));
  if (!m) throw new Error(`sem destino para ${fonte}`);
  return `${m[1]} · ${m[2]}`;
}

describe('Meu dia: o clique de cada correção leva ao log dela', () => {
  it('os webhooks recebidos vão para Webhooks → Recebidos, com o gate da seção', () => {
    expect(destinoDe('webhooksNaoProcessados')).toBe(
      "'/settings?tab=webhooks&aba=recebidos' · veWebhooks"
    );
  });

  it('o Calendly vai para Integrações, onde o cartão dele mostra o log', () => {
    expect(destinoDe('agendamentosNaoProcessados')).toBe(
      "'/settings?tab=integracoes' · veIntegracoes"
    );
  });

  it('as duas fontes leem cada uma a SUA contagem, nunca a soma', () => {
    expect(FONTE).toMatch(/agendamentosNaoProcessados: fonteDe\(integracoes, \(i\) => i\.calendly\)/);
    expect(FONTE).toMatch(/webhooksNaoProcessados: fonteDe\(integracoes, \(i\) => i\.webhooks\)/);
    expect(FONTE).not.toMatch(/i\.calendly \+ i\.webhooks/);
  });

  it('toda fonte tem destino escrito (e a lista não perdeu nenhuma)', () => {
    expect(ORDEM_DAS_FONTES).toContain('agendamentosNaoProcessados');
    expect(ORDEM_DAS_FONTES).toContain('webhooksNaoProcessados');
    for (const fonte of ORDEM_DAS_FONTES) {
      expect(FONTE).toContain(`${fonte}: {`);
    }
  });
});
