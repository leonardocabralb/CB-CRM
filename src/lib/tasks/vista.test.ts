import { describe, expect, it } from 'vitest';

import {
  contaComoVista,
  IDS_POR_PEDIDO,
  idsDoPedido,
  type TarefaParaVista,
} from './vista';

const EU = 'u-eu';
const OUTRO = 'u-outro';

const ABERTA_MINHA: TarefaParaVista = {
  responsavel_user_id: EU,
  status: 'aberta',
  vista_em: null,
};

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('contaComoVista', () => {
  it('conta a tarefa aberta, minha, ainda não vista', () => {
    expect(contaComoVista(ABERTA_MINHA, EU)).toBe(true);
  });

  it('não conta quando quem olha não é o responsável (o gestor não vê por ele)', () => {
    expect(contaComoVista(ABERTA_MINHA, OUTRO)).toBe(false);
  });

  it('não conta a tarefa já vista — a primeira vez é o registro', () => {
    expect(
      contaComoVista({ ...ABERTA_MINHA, vista_em: '2026-09-29T12:00:00Z' }, EU),
    ).toBe(false);
  });

  it('não conta a concluída', () => {
    expect(contaComoVista({ ...ABERTA_MINHA, status: 'concluida' }, EU)).toBe(
      false,
    );
  });

  it('responsável nulo (saiu da conta) nunca casa, nem com sessão sem id', () => {
    const orfa = { ...ABERTA_MINHA, responsavel_user_id: null };
    expect(contaComoVista(orfa, EU)).toBe(false);
    expect(contaComoVista(orfa, null)).toBe(false);
    expect(contaComoVista(ABERTA_MINHA, null)).toBe(false);
  });
});

describe('idsDoPedido', () => {
  it('aceita UUIDs e tira a repetição', () => {
    expect(idsDoPedido({ ids: [uuid(1), uuid(2), uuid(1)] })).toEqual([
      uuid(1),
      uuid(2),
    ]);
  });

  it('recusa corpo sem lista, lista vazia ou com id malformado', () => {
    expect(idsDoPedido(null)).toBeNull();
    expect(idsDoPedido({})).toBeNull();
    expect(idsDoPedido({ ids: [] })).toBeNull();
    expect(idsDoPedido({ ids: 'x' })).toBeNull();
    expect(idsDoPedido({ ids: [uuid(1), 'nao-e-uuid'] })).toBeNull();
    expect(idsDoPedido({ ids: [uuid(1), 7] })).toBeNull();
  });

  it('recusa acima do teto', () => {
    const ids = Array.from({ length: IDS_POR_PEDIDO + 1 }, (_, i) => uuid(i));
    expect(idsDoPedido({ ids })).toBeNull();
    expect(idsDoPedido({ ids: ids.slice(0, IDS_POR_PEDIDO) })).toHaveLength(
      IDS_POR_PEDIDO,
    );
  });
});
