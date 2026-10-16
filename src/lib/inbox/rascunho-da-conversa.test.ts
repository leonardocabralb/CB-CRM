import { describe, expect, it, vi } from 'vitest';

import {
  chaveDoRascunho,
  criarRepositorio,
  DIAS_DO_RASCUNHO,
  lerGuardado,
  paraGuardar,
  PREFIXO_DO_RASCUNHO,
  varrerVencidos,
} from './rascunho-da-conversa';

// ============================================================
// Rascunho POR CONVERSA, guardado no navegador (pedido do operador,
// 15/10/2026). O defeito de antes: o compositor não remonta na troca de
// conversa, e o texto escrito para um cliente continuava na caixa do
// próximo — pronto para sair para a pessoa errada.
// ============================================================

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 9, 15, 12, 0, 0);

/** `localStorage` de mentira — o mesmo contrato, num Map. */
class ArmazenamentoFalso {
  dados = new Map<string, string>();
  get length() {
    return this.dados.size;
  }
  key(i: number) {
    return [...this.dados.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.dados.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.dados.set(k, v);
  }
  removeItem(k: string) {
    this.dados.delete(k);
  }
}

const A = chaveDoRascunho('u-fulana', 'conv-a');
const B = chaveDoRascunho('u-fulana', 'conv-b');

function repo(arm = new ArmazenamentoFalso(), agora = AGORA) {
  const avisar = vi.fn();
  const r = criarRepositorio(() => arm, avisar, () => agora);
  return { r, avisar, arm };
}

describe('a chave', () => {
  it('é por PESSOA e por conversa', () => {
    expect(A).toBe(`${PREFIXO_DO_RASCUNHO}u-fulana:conv-a`);
    // Outra pessoa no mesmo navegador não vê o rascunho de quem saiu.
    expect(chaveDoRascunho('u-beltrano', 'conv-a')).not.toBe(A);
    expect(B).not.toBe(A);
  });
});

describe('o que vai para o armazenamento', () => {
  it('volta igual, com o instante em que foi escrito', () => {
    const guardado = paraGuardar('Olá, Fulana!\nSegue o link.', AGORA);
    expect(guardado).not.toBeNull();
    expect(lerGuardado(guardado, AGORA)).toBe('Olá, Fulana!\nSegue o link.');
  });

  it('vazio ou só espaços NÃO fica guardado', () => {
    expect(paraGuardar('', AGORA)).toBeNull();
    expect(paraGuardar('   \n\t', AGORA)).toBeNull();
  });

  it(`vence depois de ${DIAS_DO_RASCUNHO} dias`, () => {
    const guardado = paraGuardar('esquecido', AGORA);
    expect(lerGuardado(guardado, AGORA + DIAS_DO_RASCUNHO * DIA)).toBe('esquecido');
    expect(lerGuardado(guardado, AGORA + DIAS_DO_RASCUNHO * DIA + 1)).toBe('');
  });

  it('valor ilegível ou de outro formato nunca vira texto na caixa', () => {
    expect(lerGuardado(null, AGORA)).toBe('');
    expect(lerGuardado('não é json', AGORA)).toBe('');
    expect(lerGuardado('"texto solto"', AGORA)).toBe('');
    expect(lerGuardado('{"t":42,"em":1}', AGORA)).toBe('');
    expect(lerGuardado('{"t":"sem data"}', AGORA)).toBe('');
    expect(lerGuardado('null', AGORA)).toBe('');
  });
});

describe('o repositório', () => {
  it('cada conversa guarda o SEU rascunho', () => {
    const { r } = repo();
    r.escrever(A, 'para a Fulana');
    expect(r.ler(B)).toBe('');
    r.escrever(B, 'para o Beltrano');
    expect(r.ler(A)).toBe('para a Fulana');
    expect(r.ler(B)).toBe('para o Beltrano');
  });

  it('sobrevive a recarregar a página (outro repositório, o mesmo armazenamento)', () => {
    const arm = new ArmazenamentoFalso();
    repo(arm).r.escrever(A, 'quase pronto');
    expect(repo(arm).r.ler(A)).toBe('quase pronto');
  });

  it('esvaziar o campo (enviou) apaga a chave do armazenamento', () => {
    const { r, arm } = repo();
    r.escrever(A, 'vai sair');
    expect(arm.dados.has(A)).toBe(true);
    r.escrever(A, '');
    expect(arm.dados.has(A)).toBe(false);
    expect(r.ler(A)).toBe('');
  });

  it('só espaços: a caixa mantém o que se digita, o armazenamento não guarda', () => {
    const { r, arm } = repo();
    r.escrever(A, '  ');
    expect(r.ler(A)).toBe('  ');
    expect(arm.dados.has(A)).toBe(false);
  });

  it('a atualização por função parte do rascunho GUARDADO, mesmo antes de lido', () => {
    const arm = new ArmazenamentoFalso();
    repo(arm).r.escrever(A, 'Bom dia');
    const { r } = repo(arm);
    r.escrever(A, (atual) => `${atual}, tudo bem?`);
    expect(r.ler(A)).toBe('Bom dia, tudo bem?');
  });

  it('avisa quem assina só quando o texto MUDA', () => {
    const { r, avisar } = repo();
    r.escrever(A, 'oi');
    r.escrever(A, 'oi');
    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('sem persistir (login desconhecido), vale só na memória', () => {
    const { r, arm } = repo();
    r.escrever(A, 'sem dono', false);
    expect(r.ler(A)).toBe('sem dono');
    expect(arm.dados.size).toBe(0);
  });

  it('armazenamento que LANÇA não derruba a caixa: fica na memória', () => {
    const quebrado = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const r = criarRepositorio(() => quebrado as never, () => {}, () => AGORA);
    expect(r.ler(A)).toBe('');
    expect(() => r.escrever(A, 'ainda funciona')).not.toThrow();
    expect(r.ler(A)).toBe('ainda funciona');
  });

  it('cota cheia: a versão VELHA sai do armazenamento, não ressuscita ao recarregar', () => {
    const arm = new ArmazenamentoFalso();
    repo(arm).r.escrever(A, 'versão antiga');
    // A partir daqui o `setItem` falha (cota cheia); o `removeItem` funciona.
    arm.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const { r } = repo(arm);
    r.escrever(A, 'versão nova, só na memória');
    expect(r.ler(A)).toBe('versão nova, só na memória');
    expect(arm.dados.has(A)).toBe(false);
    // Recarregar: nada guardado, nada velho a devolver.
    expect(repo(arm).r.ler(A)).toBe('');
  });

  it('sem armazenamento nenhum (null), também só memória', () => {
    const r = criarRepositorio(() => null, () => {}, () => AGORA);
    r.escrever(A, 'na memória');
    expect(r.ler(A)).toBe('na memória');
  });

  it('o vencido é lido como vazio E apagado', () => {
    const arm = new ArmazenamentoFalso();
    arm.setItem(A, paraGuardar('velho', AGORA - (DIAS_DO_RASCUNHO + 1) * DIA)!);
    const { r } = repo(arm);
    expect(r.ler(A)).toBe('');
    expect(arm.dados.has(A)).toBe(false);
  });

  it('o que OUTRA aba escreveu aparece depois de `esquecer` a chave', () => {
    const arm = new ArmazenamentoFalso();
    const aba1 = repo(arm);
    const aba2 = repo(arm);
    expect(aba2.r.ler(A)).toBe('');
    aba1.r.escrever(A, 'escrito na aba 1');
    // Sem o evento `storage`, a aba 2 segue com o que tinha em memória.
    expect(aba2.r.ler(A)).toBe('');
    aba2.r.esquecer(A);
    expect(aba2.r.ler(A)).toBe('escrito na aba 1');
    expect(aba2.avisar).toHaveBeenCalled();
  });

  it('`esquecer(null)` (a outra aba limpou tudo) zera a memória', () => {
    const arm = new ArmazenamentoFalso();
    const { r } = repo(arm);
    r.escrever(A, 'um');
    r.escrever(B, 'dois');
    arm.dados.clear();
    r.esquecer(null);
    expect(r.ler(A)).toBe('');
    expect(r.ler(B)).toBe('');
  });
});

describe('a varredura dos vencidos', () => {
  it('apaga só rascunho vencido ou ilegível, e nada de fora do prefixo', () => {
    const arm = new ArmazenamentoFalso();
    arm.setItem(A, paraGuardar('vivo', AGORA - DIA)!);
    arm.setItem(B, paraGuardar('vencido', AGORA - (DIAS_DO_RASCUNHO + 2) * DIA)!);
    arm.setItem(chaveDoRascunho('u-x', 'conv-c'), 'lixo');
    arm.setItem('cb-modo-anonimo', 'u-fulana');
    arm.setItem('outra-coisa', 'lixo');

    expect(varrerVencidos(arm, AGORA)).toBe(2);
    expect([...arm.dados.keys()].sort()).toEqual(['cb-modo-anonimo', 'outra-coisa', A].sort());
  });
});
