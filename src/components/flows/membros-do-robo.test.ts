import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// O módulo importa o cliente do navegador para o hook; aqui só as funções
// puras e a carga (com um banco falso) são exercitadas.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { carregarMembrosDoRobo, montarMembros, nomeDoMembro } from './membros-do-robo';

// Os membros da conta do robô, para o "Atribuir a" do "Transferir" (2.7):
// recortados pela conta DO ROBÔ, pelo `user_id` de login, e só dão nome
// quando SABEM — "carregando" e "falhou" nunca viram "não existe".

const LINHAS = [
  { user_id: 'u-isa', full_name: 'Dra. Isa Lenier', email: 'isa@x' },
  { user_id: 'u-leo', full_name: ' Leonardo ', email: 'leo@x' },
  { user_id: 'u-sem', full_name: '', email: 'sem-nome@x' },
  { user_id: 'u-nada', full_name: null, email: null },
  { user_id: 'u-leo', full_name: 'Leonardo (duplicado)', email: null },
];

describe('montarMembros', () => {
  it('usa o user_id, cai para o e-mail sem nome, tira duplicado e ordena pelo nome', () => {
    expect(montarMembros(LINHAS)).toEqual([
      { userId: 'u-nada', nome: '' },
      { userId: 'u-isa', nome: 'Dra. Isa Lenier' },
      { userId: 'u-leo', nome: 'Leonardo' },
      { userId: 'u-sem', nome: 'sem-nome@x' },
    ]);
  });
});

describe('nomeDoMembro', () => {
  const pronto = { status: 'pronto' as const, membros: montarMembros(LINHAS) };
  it('acha o nome; não conhece (ou ainda carregando/falhou) = null', () => {
    expect(nomeDoMembro(pronto, 'u-isa')).toBe('Dra. Isa Lenier');
    expect(nomeDoMembro(pronto, 'u-de-fora')).toBeNull();
    expect(nomeDoMembro({ status: 'carregando' }, 'u-isa')).toBeNull();
    expect(nomeDoMembro({ status: 'falhou' }, 'u-isa')).toBeNull();
  });
});

describe('carregarMembrosDoRobo', () => {
  function banco(resp: { data: unknown; error: { message: string } | null }) {
    const pedido = { tabela: '', colunas: '', filtros: [] as Array<[string, unknown]> };
    const db = {
      from(tabela: string) {
        pedido.tabela = tabela;
        const b = {
          select: (c: string) => ((pedido.colunas = c), b),
          eq: (c: string, v: unknown) => {
            pedido.filtros.push([c, v]);
            return Promise.resolve(resp);
          },
        };
        return b;
      },
    } as unknown as SupabaseClient;
    return { db, pedido };
  }

  it('CRÍTICO: lê os perfis DA CONTA do robô (a RLS devolveria os de toda conta do usuário)', async () => {
    const { db, pedido } = banco({ data: LINHAS, error: null });
    const r = await carregarMembrosDoRobo(db, 'conta-do-robo');
    expect(pedido.tabela).toBe('profiles');
    expect(pedido.colunas).toContain('user_id');
    expect(pedido.filtros).toEqual([['account_id', 'conta-do-robo']]);
    expect(r.status).toBe('pronto');
  });

  it('leitura que falha = "falhou", nunca lista vazia', async () => {
    expect(await carregarMembrosDoRobo(banco({ data: null, error: { message: 'x' } }).db, 'c')).toEqual({
      status: 'falhou',
    });
  });
});
