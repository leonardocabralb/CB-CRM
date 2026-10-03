import { describe, expect, it } from 'vitest';

import { FONTE_DO_CODIGO, textoDoCodigo } from './codigos';
import { codigoDoNumeroDaConexao, conexaoDoCodigo, conexoesDoTexto, numeroDaConexao } from './conexao';

// ============================================================
// O número de UMA conexão no texto (`{{channel.<id>.phone}}`, 03/10/2026).
// ============================================================

const ID = '11111111-2222-4333-8444-555555555555';
const OUTRO = '66666666-7777-4888-9999-000000000000';

describe('o código do número da conexão', () => {
  it('ida e volta: o id sai inteiro, com os hífens', () => {
    const codigo = codigoDoNumeroDaConexao(ID);
    expect(codigo).toBe('channel.11111111_2222_4333_8444_555555555555.phone');
    expect(conexaoDoCodigo(codigo)).toBe(ID);
  });

  it('⚠️ o código cabe na régua do motor (`[\\w.]`): com hífen, o envio o deixaria cru', () => {
    const texto = textoDoCodigo(codigoDoNumeroDaConexao(ID));
    expect(new RegExp(`^${FONTE_DO_CODIGO}$`).test(texto)).toBe(true);
  });

  it('só a forma exata é o número de uma conexão', () => {
    for (const outro of [
      'channel.id',
      'channel.11111111_2222_4333_8444_555555555555',
      'channel.11111111_2222_4333_8444_555555555555.phone.x',
      'channel.11111111-2222-4333-8444-555555555555.phone',
      'contact.11111111_2222_4333_8444_555555555555.phone',
      'channel.1111_2222.phone',
    ]) {
      expect(conexaoDoCodigo(outro), outro).toBeNull();
    }
  });

  it('as conexões citadas num texto, sem repetição', () => {
    const t = `A ${textoDoCodigo(codigoDoNumeroDaConexao(ID))}, B {{ ${codigoDoNumeroDaConexao(OUTRO)} }}, de novo ${textoDoCodigo(codigoDoNumeroDaConexao(ID))} e {{channel.id}}`;
    expect(conexoesDoTexto(t)).toEqual([ID, OUTRO]);
    expect(conexoesDoTexto('Olá, {{contact.name}}')).toEqual([]);
  });
});

describe('o número como sai', () => {
  it('Evolution (dígitos): formatado na mensagem, dígitos no dado', () => {
    expect(numeroDaConexao('559690000016', false)).toBe('(96) 9000-0016');
    expect(numeroDaConexao('5596990000016', false)).toBe('(96) 99000-0016');
    expect(numeroDaConexao('559690000016', true)).toBe('559690000016');
  });

  it('Meta (já formatado pela Meta): passa pelos dígitos', () => {
    expect(numeroDaConexao('+55 11 5000-0001', false)).toBe('(11) 5000-0001');
    expect(numeroDaConexao('+55 11 5000-0001', true)).toBe('551150000001');
  });

  it('fora do Brasil, com o +; sem número, vazio', () => {
    expect(numeroDaConexao('+1 415 555 0100', false)).toBe('+14155550100');
    expect(numeroDaConexao(null, false)).toBe('');
    expect(numeroDaConexao('', true)).toBe('');
  });
});
