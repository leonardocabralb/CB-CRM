import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  TENTATIVAS_DA_POSSE,
  disparoEmAndamento,
  renovarPosseDoDisparo,
  tomarPosseDoDisparo,
} from './broadcast-posse';

// ============================================================
// A posse do envio (1147): o assistente só manda o lote com ela, e a perde
// para a retomada. "Perdida" e "erro" PARAM o envio — nunca reenviam.
// ============================================================

type Resposta = { data: unknown; error: { message: string } | null } | Error;

function bancoQueResponde(respostas: Resposta[]) {
  const chamadas: { funcao: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: vi.fn(async (funcao: string, args: Record<string, unknown>) => {
      chamadas.push({ funcao, args });
      const r = respostas.shift() ?? { data: null, error: { message: 'sem resposta' } };
      if (r instanceof Error) throw r;
      return r;
    }),
  } as unknown as SupabaseClient;
  return { db, chamadas };
}

const semEspera = vi.fn(async () => undefined);

describe('tomarPosseDoDisparo / renovarPosseDoDisparo', () => {
  it('chama a função da 1147 com o disparo e o TOKEN', async () => {
    const { db, chamadas } = bancoQueResponde([
      { data: '2026-11-17T12:05:00+00:00', error: null },
      { data: '2026-11-17T12:06:00+00:00', error: null },
    ]);

    expect(await tomarPosseDoDisparo(db, 'bc-1', 'tok-1', semEspera)).toEqual({
      situacao: 'mantida',
      prazo: '2026-11-17T12:05:00+00:00',
    });
    expect(await renovarPosseDoDisparo(db, 'bc-1', 'tok-1', semEspera)).toEqual({
      situacao: 'mantida',
      prazo: '2026-11-17T12:06:00+00:00',
    });
    expect(chamadas).toEqual([
      { funcao: 'cb_tomar_posse_do_disparo', args: { p_broadcast_id: 'bc-1', p_token: 'tok-1' } },
      { funcao: 'cb_renovar_posse_do_disparo', args: { p_broadcast_id: 'bc-1', p_token: 'tok-1' } },
    ]);
  });

  it('a função devolveu nulo: a posse é de outro (ou de ninguém que eu possa assumir)', async () => {
    const { db } = bancoQueResponde([{ data: null, error: null }]);
    expect(await renovarPosseDoDisparo(db, 'bc-1', 'tok-1', semEspera)).toEqual({
      situacao: 'perdida',
    });
  });

  it('⚠️ "perdida" não se repete: a resposta é a decisão do banco, não uma falha', async () => {
    const { db, chamadas } = bancoQueResponde([{ data: null, error: null }]);
    await renovarPosseDoDisparo(db, 'bc-1', 'tok-1', semEspera);
    expect(chamadas).toHaveLength(1);
  });

  it('erro passageiro: repete (com o mesmo token, o que é seguro) e segue com a posse', async () => {
    const esperas: number[] = [];
    const { db, chamadas } = bancoQueResponde([
      { data: null, error: { message: 'fetch failed' } },
      { data: '2026-11-17T12:05:00+00:00', error: null },
    ]);

    const r = await renovarPosseDoDisparo(db, 'bc-1', 'tok-1', async (ms) => {
      esperas.push(ms);
    });

    expect(r.situacao).toBe('mantida');
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].args.p_token).toBe('tok-1');
    expect(esperas).toEqual([1000]);
  });

  it('todas as tentativas falham: "erro" com a última mensagem (o assistente para)', async () => {
    const esperas: number[] = [];
    const { db, chamadas } = bancoQueResponde([
      { data: null, error: { message: 'um' } },
      new Error('dois'),
      { data: null, error: { message: 'três' } },
    ]);

    const r = await tomarPosseDoDisparo(db, 'bc-1', 'tok-1', async (ms) => {
      esperas.push(ms);
    });

    expect(r).toEqual({ situacao: 'erro', mensagem: 'três' });
    expect(chamadas).toHaveLength(TENTATIVAS_DA_POSSE);
    expect(esperas).toEqual([1000, 2000]);
  });

  it('a exceção lançada (rede) também vira "erro", nunca escapa', async () => {
    const { db } = bancoQueResponde([new Error('a'), new Error('b'), new Error('rede caiu')]);
    expect(await renovarPosseDoDisparo(db, 'bc-1', 'tok-1', semEspera)).toEqual({
      situacao: 'erro',
      mensagem: 'rede caiu',
    });
  });
});

describe('disparoEmAndamento', () => {
  it('true/false vêm do banco', async () => {
    expect(await disparoEmAndamento(bancoQueResponde([{ data: true, error: null }]).db, 'bc-1')).toBe(true);
    expect(await disparoEmAndamento(bancoQueResponde([{ data: false, error: null }]).db, 'bc-1')).toBe(false);
  });

  it('⚠️ falha ou disparo invisível = null ("não sei"), nunca false ("parado")', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await disparoEmAndamento(bancoQueResponde([{ data: null, error: { message: 'x' } }]).db, 'bc-1'),
    ).toBeNull();
    expect(await disparoEmAndamento(bancoQueResponde([{ data: null, error: null }]).db, 'bc-1')).toBeNull();
    expect(await disparoEmAndamento(bancoQueResponde([new Error('rede')]).db, 'bc-1')).toBeNull();
    erro.mockRestore();
  });

  it('chama a função com o disparo', async () => {
    const { db, chamadas } = bancoQueResponde([{ data: false, error: null }]);
    await disparoEmAndamento(db, 'bc-9');
    expect(chamadas).toEqual([
      { funcao: 'cb_disparo_em_andamento', args: { p_broadcast_id: 'bc-9' } },
    ]);
  });
});
