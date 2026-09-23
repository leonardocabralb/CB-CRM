import { describe, expect, it } from 'vitest';

import { lerResultadoDoTeste } from './resultado-do-teste';

// ============================================================
// A tela lê a resposta do "Enviar teste" CAMPO A CAMPO. O que estes testes
// cobram: nada inventado. Corpo estranho não vira "Entregue", motivo novo não
// vira chave crua, e um trecho de resposta malformado SOME — nunca vira
// "o endereço respondeu sem corpo", que seria uma afirmação falsa sobre o
// sistema de fora.
// ============================================================

describe('lerResultadoDoTeste', () => {
  it('entregue, com o trecho do corpo', () => {
    expect(
      lerResultadoDoTeste({
        ok: true,
        status: 200,
        ms: 312.4471,
        resposta: { corpo: '{"message":"Workflow was started"}', cortado: false },
      })
    ).toEqual({
      ok: true,
      status: 200,
      ms: 312,
      resposta: { binario: false, corpo: '{"message":"Workflow was started"}', cortado: false },
    });
  });

  it('falha http com o corpo cortado', () => {
    expect(
      lerResultadoDoTeste({
        ok: false,
        status: 404,
        motivo: 'http',
        ms: 80,
        resposta: { corpo: 'The requested webhook is not registered.', cortado: true },
      })
    ).toEqual({
      ok: false,
      status: 404,
      motivo: 'http',
      ms: 80,
      resposta: { binario: false, corpo: 'The requested webhook is not registered.', cortado: true },
    });
  });

  it('corpo vazio é "sem corpo" — e só ele', () => {
    expect(
      lerResultadoDoTeste({ ok: true, status: 204, ms: 5, resposta: { corpo: '', cortado: false } })
        ?.resposta
    ).toEqual({ binario: false, corpo: '', cortado: false });
  });

  it('binário: só a marca, sem texto', () => {
    expect(
      lerResultadoDoTeste({
        ok: true,
        status: 200,
        ms: 5,
        resposta: { corpo: null, cortado: false, binario: true },
      })?.resposta
    ).toEqual({ binario: true });
  });

  it.each([
    ['corpo que não é texto', { corpo: 42, cortado: false }],
    ['corpo nulo sem a marca de binário', { corpo: null, cortado: false }],
    ['corpo como objeto', { corpo: { html: '<b>x</b>' }, cortado: false }],
    ['trecho que não é objeto', 'texto solto'],
    ['trecho nulo (a leitura falhou)', null],
  ])('⚠️ %s: sem trecho — nunca "resposta vazia"', (_, resposta) => {
    const r = lerResultadoDoTeste({ ok: false, status: 500, motivo: 'http', ms: 9, resposta });
    expect(r).toMatchObject({ ok: false, status: 500, motivo: 'http' });
    expect(r?.resposta).toBeNull();
  });

  it('`cortado` só é verdadeiro com o booleano `true`', () => {
    expect(
      lerResultadoDoTeste({ ok: true, status: 200, ms: 1, resposta: { corpo: 'x', cortado: 'true' } })
        ?.resposta
    ).toEqual({ binario: false, corpo: 'x', cortado: false });
  });

  it('sem `resposta` (tempo, rede, endereço bloqueado): trecho nulo', () => {
    expect(lerResultadoDoTeste({ ok: false, status: null, motivo: 'tempo', ms: 5000 })).toEqual({
      ok: false,
      status: null,
      motivo: 'tempo',
      ms: 5000,
      resposta: null,
    });
  });

  it('motivo que a tela não conhece vira null (texto genérico), nunca chave crua', () => {
    expect(lerResultadoDoTeste({ ok: false, status: null, motivo: 'dns_novo', ms: 1 })).toMatchObject({
      motivo: null,
    });
  });

  it.each([
    ['nulo', null],
    ['texto', 'ok'],
    ['sem `ok`', { status: 200 }],
    ['ok sem status', { ok: true }],
  ])('corpo estranho (%s) não vira "Entregue"', (_, corpo) => {
    expect(lerResultadoDoTeste(corpo)).toBeNull();
  });
});
