import { describe, expect, it } from 'vitest';

import { modoAnonimoAtivo, podeUsarModoAnonimo } from './modo-anonimo';

// ============================================================
// Modo anônimo (decisão do operador, 01/10/2026): só administrador liga, e
// o modo vale para o LOGIN que o ligou, neste navegador.
// ============================================================

describe('podeUsarModoAnonimo', () => {
  it('dono e administrador podem ligar', () => {
    expect(podeUsarModoAnonimo('owner')).toBe(true);
    expect(podeUsarModoAnonimo('admin')).toBe(true);
  });

  it('atendente, leitor e papel ainda desconhecido não podem', () => {
    expect(podeUsarModoAnonimo('agent')).toBe(false);
    expect(podeUsarModoAnonimo('viewer')).toBe(false);
    expect(podeUsarModoAnonimo(null)).toBe(false);
    expect(podeUsarModoAnonimo(undefined)).toBe(false);
  });
});

describe('modoAnonimoAtivo', () => {
  it('vale para o administrador que o ligou', () => {
    expect(modoAnonimoAtivo('u-admin', 'u-admin', 'admin')).toBe(true);
    expect(modoAnonimoAtivo('u-dono', 'u-dono', 'owner')).toBe(true);
  });

  it('desligado quando não há nada guardado', () => {
    expect(modoAnonimoAtivo(null, 'u-admin', 'admin')).toBe(false);
  });

  it('outra pessoa no MESMO navegador não herda o modo', () => {
    // O modo não se apaga ao sair ("dura até eu desligar"): é a amarra ao
    // login que impede o próximo a entrar de abrir conversas sem zerá-las.
    expect(modoAnonimoAtivo('u-admin', 'u-outro-admin', 'admin')).toBe(false);
  });

  it('chave plantada à mão por quem não é administrador é ignorada', () => {
    expect(modoAnonimoAtivo('u-atendente', 'u-atendente', 'agent')).toBe(false);
    expect(modoAnonimoAtivo('u-leitor', 'u-leitor', 'viewer')).toBe(false);
  });

  it('quem deixou de ser administrador perde o modo sem desligá-lo', () => {
    expect(modoAnonimoAtivo('u-ex-admin', 'u-ex-admin', 'agent')).toBe(false);
  });

  it('sem sessão ou com o papel carregando, desligado', () => {
    expect(modoAnonimoAtivo('u-admin', null, 'admin')).toBe(false);
    expect(modoAnonimoAtivo('u-admin', undefined, 'admin')).toBe(false);
    expect(modoAnonimoAtivo('u-admin', 'u-admin', null)).toBe(false);
    // `null === undefined` é falso, mas a régua não pode depender disso.
    expect(modoAnonimoAtivo(null, undefined, 'admin')).toBe(false);
  });
});
