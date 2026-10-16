import { describe, expect, it, vi } from 'vitest';

import { criarFilaDeSaida } from './fila-de-saida';

// ============================================================
// A fila de saída do compositor: a ordem de chegada no celular do cliente,
// conversa por conversa (pedido do operador, 15/10/2026). O caso que a
// motiva: um áudio (4–7 s pela Evolution) seguido de "ouça o áudio acima".
// ============================================================

function adiado() {
  let resolver!: () => void;
  const promessa = new Promise<void>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

/** Deixa as promessas encadeadas andarem. */
const andar = () => new Promise((r) => setTimeout(r, 0));

/** Um teto que só solta quando o teste manda. */
function tetoManual() {
  const soltas: Array<() => void> = [];
  return {
    esperar: () =>
      new Promise<void>((r) => {
        soltas.push(r);
      }),
    soltarTodos: () => soltas.splice(0).forEach((s) => s()),
  };
}

describe('a fila de saída', () => {
  it('na MESMA conversa, o segundo só começa quando o primeiro termina', async () => {
    const teto = tetoManual();
    const fila = criarFilaDeSaida(teto.esperar);
    const audio = adiado();
    const ordem: string[] = [];

    void fila.enfileirar('conv-a', async () => {
      ordem.push('áudio começou');
      await audio.promessa;
      ordem.push('áudio saiu');
    });
    void fila.enfileirar('conv-a', () => {
      ordem.push('texto saiu');
    });
    await andar();
    expect(ordem).toEqual(['áudio começou']);

    audio.resolver();
    await andar();
    expect(ordem).toEqual(['áudio começou', 'áudio saiu', 'texto saiu']);
  });

  it('conversas DIFERENTES não esperam uma pela outra', async () => {
    const teto = tetoManual();
    const fila = criarFilaDeSaida(teto.esperar);
    const travado = adiado();
    const ordem: string[] = [];

    void fila.enfileirar('conv-a', () => travado.promessa);
    void fila.enfileirar('conv-b', () => {
      ordem.push('B saiu');
    });
    await andar();
    expect(ordem).toEqual(['B saiu']);
    expect(fila.ocupada('conv-a')).toBe(true);
    expect(fila.ocupada('conv-b')).toBe(false);
  });

  it('um envio TRAVADO solta a fila da conversa no teto', async () => {
    const teto = tetoManual();
    const fila = criarFilaDeSaida(teto.esperar);
    const ordem: string[] = [];

    void fila.enfileirar('conv-a', () => new Promise(() => {})); // nunca volta
    void fila.enfileirar('conv-a', () => {
      ordem.push('texto saiu');
    });
    await andar();
    expect(ordem).toEqual([]);

    teto.soltarTodos();
    await andar();
    expect(ordem).toEqual(['texto saiu']);
  });

  it('um envio que LANÇA não para a fila — e é avisado', async () => {
    const aoFalhar = vi.fn();
    const fila = criarFilaDeSaida(tetoManual().esperar, 1, aoFalhar);
    const ordem: string[] = [];

    void fila.enfileirar('conv-a', () => {
      throw new Error('rede caiu');
    });
    await fila.enfileirar('conv-a', () => {
      ordem.push('seguinte saiu');
    });
    expect(ordem).toEqual(['seguinte saiu']);
    expect(aoFalhar).toHaveBeenCalledTimes(1);
  });

  it('`enfileirar` resolve quando o trabalho termina; a conversa desocupa', async () => {
    const fila = criarFilaDeSaida(tetoManual().esperar);
    const fim = fila.enfileirar('conv-a', async () => {});
    expect(fila.ocupada('conv-a')).toBe(true);
    await fim;
    await andar();
    expect(fila.ocupada('conv-a')).toBe(false);
  });
});
