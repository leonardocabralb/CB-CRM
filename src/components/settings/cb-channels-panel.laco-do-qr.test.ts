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
    // A ORDEM é o que garante: dentro do tick, o agendamento fica no `finally`
    // que vem DEPOIS do `await fetch(` — agendado antes do await, a consulta
    // lenta (8 s com a instância fechada) se sobrepõe à seguinte de novo.
    const tick = codigo.indexOf('const tick = async () => {');
    expect(tick).toBeGreaterThan(-1);
    const doTick = codigo.slice(tick, codigo.indexOf('void tick();', tick));
    const agendamentos = [...doTick.matchAll(/setTimeout\(/g)];
    expect(agendamentos).toHaveLength(1);
    const fetchEm = doTick.indexOf('await fetch(');
    const finallyEm = doTick.indexOf('} finally {', fetchEm);
    const agendaEm = doTick.indexOf('timer = setTimeout(() => void tick(), POLL_MS)');
    expect(fetchEm).toBeGreaterThan(-1);
    expect(finallyEm).toBeGreaterThan(fetchEm);
    expect(agendaEm).toBeGreaterThan(finallyEm);
  });

  it('toda chamada a /connect manda o corpo com reaplicarWebhook', () => {
    // Qualquer expressão no `${…}` (um `${channel.id}` novo não pode escapar).
    const chamadas = [...codigo.matchAll(/fetch\(`\/api\/cb\/channels\/\$\{[^}]+\}\/connect`([\s\S]*?)\);/g)];
    expect(codigo.match(/\/connect`/g)?.length).toBe(chamadas.length);
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
