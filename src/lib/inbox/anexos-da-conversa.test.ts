import { describe, expect, it, vi } from 'vitest';

import { chaveDosAnexos, criarRepositorioDeAnexos, SEM_ANEXOS } from './anexos-da-conversa';

// ============================================================
// Anexos em rascunho POR CONVERSA, na memória da aba (pedido do operador,
// 21/10/2026, "como o WhatsApp"). Antes, trocar de conversa apagava a fila de
// anexos: o compositor não remonta na troca, e a única defesa contra o
// documento de um cliente montado no compositor de outro era jogá-lo fora.
// ============================================================

type Item = { id: string };

const A = chaveDosAnexos('u-fulana', 'conv-a');
const B = chaveDosAnexos('u-fulana', 'conv-b');

describe('a chave', () => {
  it('é por PESSOA e por conversa', () => {
    expect(A).toBe('u-fulana:conv-a');
    // A mesma aba pode trocar de pessoa sem recarregar ("Sair" e entrar).
    expect(chaveDosAnexos('u-beltrano', 'conv-a')).not.toBe(A);
    expect(B).not.toBe(A);
  });
});

describe('o repositório', () => {
  it('cada conversa tem a sua fila — a de A não aparece em B', () => {
    const r = criarRepositorioDeAnexos<Item>();
    r.escrever(A, [{ id: 'contrato-de-a.pdf' }]);
    expect(r.ler(A)).toEqual([{ id: 'contrato-de-a.pdf' }]);
    expect(r.ler(B)).toBe(SEM_ANEXOS);
    expect(r.ler(chaveDosAnexos('u-beltrano', 'conv-a'))).toBe(SEM_ANEXOS);
  });

  it('a leitura devolve a MESMA instância até a fila mudar', () => {
    // O `getSnapshot` do `useSyncExternalStore` é relido a cada render: um
    // array novo a cada leitura faria o React renderizar sem fim.
    const r = criarRepositorioDeAnexos<Item>();
    expect(r.ler(A)).toBe(r.ler(A));
    r.escrever(A, [{ id: '1' }]);
    const primeira = r.ler(A);
    expect(r.ler(A)).toBe(primeira);
    r.escrever(A, (atual) => [...atual, { id: '2' }]);
    expect(r.ler(A)).not.toBe(primeira);
  });

  it('a função recebe a fila de AGORA e roda uma vez só', () => {
    // Dois uploads que pousam no mesmo quadro: os dois ficam.
    const r = criarRepositorioDeAnexos<Item>();
    r.escrever(A, (atual) => [...atual, { id: '1' }]);
    r.escrever(A, (atual) => [...atual, { id: '2' }]);
    expect(r.ler(A).map((d) => d.id)).toEqual(['1', '2']);
    const conta = vi.fn((atual: readonly Item[]) => atual.slice(1));
    r.escrever(A, conta);
    expect(conta).toHaveBeenCalledTimes(1);
    expect(r.ler(A).map((d) => d.id)).toEqual(['2']);
  });

  it('a fila vazia sai do mapa e volta a ser `SEM_ANEXOS`', () => {
    const r = criarRepositorioDeAnexos<Item>();
    r.escrever(A, [{ id: '1' }]);
    r.escrever(A, (atual) => atual.filter((d) => d.id !== '1'));
    expect(r.ler(A)).toBe(SEM_ANEXOS);
  });

  it('avisa quem assina só quando a fila muda', () => {
    const r = criarRepositorioDeAnexos<Item>();
    const avisar = vi.fn();
    const sair = r.assinar(avisar);
    r.escrever(A, []); // vazia sobre vazia
    r.escrever(A, (atual) => atual); // a mesma
    expect(avisar).not.toHaveBeenCalled();
    r.escrever(A, [{ id: '1' }]);
    expect(avisar).toHaveBeenCalledTimes(1);
    sair();
    r.escrever(A, []);
    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('quem grava pela conversa de ORIGEM grava nela, com outra conversa na tela', () => {
    // É o upload que pousa depois de a pessoa ir de A para B (e o anexo que
    // falha, e o agendamento): o `gravar` do hook é preso à chave do render
    // em que nasceu. O anexo de A fica no rascunho de A, e B segue vazia.
    const r = criarRepositorioDeAnexos<Item>();
    const gravarDeA = (novo: (atual: readonly Item[]) => readonly Item[]) => r.escrever(A, novo);
    const naTela = B; // a conversa aberta depois da troca
    gravarDeA((atual) => [...atual, { id: 'audio-de-a.ogg' }]);
    expect(r.ler(naTela)).toBe(SEM_ANEXOS);
    expect(r.ler(A).map((d) => d.id)).toEqual(['audio-de-a.ogg']);
  });
});
