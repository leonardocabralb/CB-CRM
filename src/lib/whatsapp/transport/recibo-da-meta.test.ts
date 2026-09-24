import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAUSAS_DO_RECIBO_DA_META_MS,
  linhaDoMotivo,
  motivoDaFalhaDaMeta,
  pausasDoReciboDaMeta,
  reciboDaMeta,
} from './recibo-da-meta';

const SRC = path.join(__dirname, '..', '..', '..');

/** Fonte sem comentários — os arquivos citam o que proíbem ao EXPLICAR a regra. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(SRC, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** O objeto literal passado a cada `.from('messages')…insert({ … })` do arquivo. */
function insertsEmMessages(codigo: string): string[] {
  const achados: string[] = [];
  const re = /\.from\('messages'\)\s*\.insert\(\{/g;
  for (let m = re.exec(codigo); m; m = re.exec(codigo)) {
    let fundo = 0;
    const inicio = m.index + m[0].length - 1;
    for (let i = inicio; i < codigo.length; i++) {
      if (codigo[i] === '{') fundo++;
      else if (codigo[i] === '}' && --fundo === 0) {
        achados.push(codigo.slice(inicio, i + 1));
        break;
      }
    }
  }
  return achados;
}

describe('o vocabulário do recibo da Meta', () => {
  it('sent, delivered, read e failed passam como estão', () => {
    expect(reciboDaMeta('sent')).toBe('sent');
    expect(reciboDaMeta('delivered')).toBe('delivered');
    expect(reciboDaMeta('read')).toBe('read');
    expect(reciboDaMeta('failed')).toBe('failed');
  });

  it('played (nota de voz ouvida) vale como read — fica fora do CHECK de messages.status', () => {
    expect(reciboDaMeta('played')).toBe('read');
  });

  it('valor fora da lista não vira status nenhum (gravado cru, estourava o CHECK)', () => {
    for (const estranho of ['deleted', 'warning', 'pending', 'replied', '', 'SENT', null, undefined, 3]) {
      expect(reciboDaMeta(estranho)).toBeNull();
    }
  });
});

describe('o motivo da falha (Fase 5, #535)', () => {
  // A forma que a Meta documenta para `statuses[].errors[]`; o texto é
  // ilustrativo.
  const erro = {
    code: 131049,
    title: 'This message was not delivered to maintain healthy ecosystem engagement.',
    message: 'This message was not delivered to maintain healthy ecosystem engagement.',
    error_data: { details: 'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.' },
    href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
  };

  it('lê código, título e detalhes do primeiro erro de um recibo failed', () => {
    expect(motivoDaFalhaDaMeta('failed', [erro, { code: 1, title: 'outro' }])).toEqual({
      codigo: 131049,
      titulo: erro.title,
      detalhes: erro.error_data.details,
    });
  });

  it('só no failed: outro status com errors não tem motivo', () => {
    for (const s of ['sent', 'delivered', 'read', 'played', 'deleted']) {
      expect(motivoDaFalhaDaMeta(s, [erro])).toBeNull();
    }
  });

  it('failed sem errors (ou com errors vazio ou estranho) não tem motivo', () => {
    for (const errors of [undefined, null, [], [null], ['texto'], {}, 'x']) {
      expect(motivoDaFalhaDaMeta('failed', errors)).toBeNull();
    }
    expect(motivoDaFalhaDaMeta('failed', [{ href: 'https://x' }])).toBeNull();
  });

  it('⚠️ campo que o Postgres recusaria vira nulo, nunca vai cru ao UPDATE (derrubaria a situação junto)', () => {
    expect(motivoDaFalhaDaMeta('failed', [{ code: 'abc', title: 'T' }])).toEqual({
      codigo: null,
      titulo: 'T',
      detalhes: null,
    });
    // Código numérico em texto: o Postgres o converteria, e o dado não se perde.
    expect(motivoDaFalhaDaMeta('failed', [{ code: ' 131049 ', title: 'T' }])?.codigo).toBe(131049);
    expect(motivoDaFalhaDaMeta('failed', [{ code: '99999999999', title: 'T' }])?.codigo).toBeNull();
    // Fora do `integer` do Postgres, e não inteiro.
    expect(motivoDaFalhaDaMeta('failed', [{ code: 2 ** 31, title: 'T' }])?.codigo).toBeNull();
    expect(motivoDaFalhaDaMeta('failed', [{ code: 1.5, title: 'T' }])?.codigo).toBeNull();
    expect(motivoDaFalhaDaMeta('failed', [{ code: 131026, title: 5, error_data: 'x' }])).toEqual({
      codigo: 131026,
      titulo: null,
      detalhes: null,
    });
  });

  it('⚠️ o CONTEÚDO também: NUL sai e surrogate solto vira \uFFFD, senão o Postgres recusa o UPDATE', () => {
    const m = motivoDaFalhaDaMeta('failed', [
      { code: 1, title: 'a\u0000b', error_data: { details: 'x\uD800y \uDC00z \uD83D\uDE00' } },
    ]);
    expect(m?.titulo).toBe('ab');
    // O par completo (o emoji) fica; só as metades soltas são trocadas.
    expect(m?.detalhes).toBe('x\uFFFDy \uFFFDz \uD83D\uDE00');
    expect(motivoDaFalhaDaMeta('failed', [{ title: '\u0000 ' }])).toBeNull();
  });

  it('sem title, o message serve de título; texto em branco não conta', () => {
    expect(motivoDaFalhaDaMeta('failed', [{ code: 1, title: '  ', message: 'M' }])?.titulo).toBe('M');
    expect(motivoDaFalhaDaMeta('failed', [{ code: 1, error_data: { details: ' ' } }])?.detalhes).toBeNull();
  });

  it('a linha do disparo: [código] título: detalhes, sem pedaço vazio', () => {
    expect(linhaDoMotivo({ codigo: 131049, titulo: 'T', detalhes: 'D' })).toBe('[131049] T: D');
    expect(linhaDoMotivo({ codigo: 131049, titulo: 'T', detalhes: null })).toBe('[131049] T');
    expect(linhaDoMotivo({ codigo: null, titulo: 'T', detalhes: 'D' })).toBe('T: D');
    expect(linhaDoMotivo({ codigo: null, titulo: null, detalhes: 'D' })).toBe('D');
    expect(linhaDoMotivo({ codigo: 7, titulo: null, detalhes: null })).toBe('[7]');
  });
});

describe('quanto o recibo da Meta espera pela linha', () => {
  it('delivered, read e failed esperam — o recibo pode chegar antes da gravação', () => {
    for (const r of ['delivered', 'read', 'failed'] as const) {
      expect(pausasDoReciboDaMeta(r, { deDisparo: false })).toEqual(PAUSAS_DO_RECIBO_DA_META_MS);
    }
  });

  it('sent não espera: a linha já nasce sent, não há o que avançar', () => {
    expect(pausasDoReciboDaMeta('sent', { deDisparo: false })).toEqual([]);
  });

  it('o recibo de DISPARO não espera: a campanha não grava linha em messages', () => {
    for (const r of ['sent', 'delivered', 'read', 'failed'] as const) {
      expect(pausasDoReciboDaMeta(r, { deDisparo: true })).toEqual([]);
    }
  });

  it('a espera cobre o caso medido (~1,5 s) e é curta: o recibo de mensagem de fora espera até o fim', () => {
    expect(PAUSAS_DO_RECIBO_DA_META_MS[0]).toBeLessThanOrEqual(2_000);
    const total = PAUSAS_DO_RECIBO_DA_META_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(5_000);
    expect(total).toBeLessThanOrEqual(10_000);
  });
});

describe('as premissas das duas exceções', () => {
  // Se uma delas deixar de valer, o recibo que não espera passa a se perder.
  it('⚠️ todo envio pela Meta grava a linha já como sent', () => {
    const remetentes = {
      'lib/whatsapp/send-message.ts': 1,
      'lib/flows/meta-send.ts': 3,
      'lib/automations/meta-send.ts': 1,
    };
    for (const [arquivo, quantos] of Object.entries(remetentes)) {
      const inserts = insertsEmMessages(fonte(arquivo));
      expect(inserts, arquivo).toHaveLength(quantos);
      for (const corpo of inserts) {
        expect(corpo, arquivo).toMatch(/\bstatus:\s*'sent'/);
      }
    }
  });

  it('⚠️ o disparo não grava linha em messages (nem o da API, nem o da tela)', () => {
    for (const arquivo of [
      'lib/whatsapp/broadcast-core.ts',
      'lib/whatsapp/broadcast-resume.ts',
      'app/api/whatsapp/broadcast/route.ts',
    ]) {
      expect(fonte(arquivo), arquivo).not.toMatch(/\.from\(\s*'messages'\s*\)/);
    }
  });
});

describe('a rota do webhook da Meta usa a escada e a espera', () => {
  const rota = fonte('app/api/whatsapp/webhook/route.ts');

  it('o recibo passa pela escada, pela espera e pelo vocabulário — nunca por um UPDATE cru', () => {
    // Um merge do upstream que devolva o UPDATE antigo rebaixa a bolha em
    // silêncio: nada estoura, ela só volta a um ✓.
    expect(rota).toContain('aplicarReciboQuandoAMensagemExistir(');
    expect(rota).toContain('aceitamORecibo(recibo)');
    expect(rota).toContain('pausasDoReciboDaMeta(recibo');
    expect(rota).toContain('reciboDaMeta(status.status)');
    expect(rota).not.toMatch(/\.update\(\{\s*status:\s*status\.status\s*\}\)/);
  });

  it('os recibos do POST são aplicados no finally, depois das mensagens, cada um no seu try', () => {
    expect(rota).toMatch(
      /finally\s*\{\s*for \(const \{ status, canal \} of recibos\) \{\s*try \{\s*await handleStatusUpdate\(status, canal\)\s*\} catch/,
    );
    const entradas = rota.slice(
      rota.indexOf('async function processarEntradas('),
      rota.indexOf('function ladderLevel('),
    );
    expect(entradas).toContain('recibos.push(');
    expect(entradas).not.toContain('handleStatusUpdate(');
  });
});
