import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// Pino estrutural do laço do QR (sessão duplicada de 06/10/2026). Com
// `setInterval`, uma consulta lenta (a rota espera a instância fechada
// confirmar antes de pedir o QR) se sobrepunha à seguinte, e dois connects
// na Evolution abriam duas sessões com a mesma credencial. E toda chamada a
// `/connect` diz se reaplica o webhook: sem corpo, a rota reaplica (é o
// comportamento da tela antiga), e o laço voltaria aos 12 `webhook/set` por
// minuto.
// ============================================================

const fonte = fs.readFileSync(path.join(__dirname, 'cb-channels-panel.tsx'), 'utf8');

/** O fonte sem comentários: o pino olha o código, não a explicação. */
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('laço do QR do painel de Conexões', () => {
  it('não usa setInterval: a próxima consulta só depois de a anterior terminar', () => {
    expect(codigo).not.toMatch(/setInterval\s*\(/);
    expect(codigo).toMatch(/timer = setTimeout\(\(\) => void tick\(\), POLL_MS\)/);
  });

  it('toda chamada a /connect manda o corpo com reaplicarWebhook', () => {
    const chamadas = [...codigo.matchAll(/fetch\(`\/api\/cb\/channels\/\$\{\w+\}\/connect`([\s\S]*?)\);/g)];
    expect(chamadas.length).toBeGreaterThanOrEqual(2);
    for (const [, opcoes] of chamadas) {
      expect(opcoes).toMatch(/body: JSON\.stringify\(\{ reaplicarWebhook: /);
    }
  });

  it('cada abertura do diálogo volta a reaplicar na primeira consulta', () => {
    const inicio = codigo.indexOf('const openQrFor = ');
    expect(inicio).toBeGreaterThan(-1);
    expect(codigo.slice(inicio, inicio + 400)).toContain('reaplicarWebhookRef.current = true;');
  });
});
