import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { robosQueDependem } from '../../src/lib/cb-channels/dependencias';

// ============================================================
// 1077 — o robô de uma conexão apagada fica DESLIGADO, nunca curinga. O que
// este pino segura:
//
// 1. BEFORE DELETE: num AFTER, o SET NULL da FK já teria rodado e o robô não
//    seria achado pelo `channel_id` — o gatilho existiria e não faria nada.
// 2. Só o robô ATIVO da conexão vai a `draft` (o rascunho fica; o de outra
//    conexão não é tocado), e a função não vira RPC.
// 3. A tela de remover diz "serão desligados" para os MESMOS robôs que o
//    gatilho desliga (`robosQueDependem`).
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1077_cb_robo_da_conexao_apagada.sql'), 'utf8');
const CODIGO = SQL.replace(/--.*$/gm, '');

describe('1077 — robô da conexão apagada', () => {
  it('o gatilho é BEFORE DELETE em cb_channels', () => {
    expect(CODIGO).toMatch(
      /CREATE TRIGGER cb_channels_desliga_robos\s+BEFORE DELETE ON public\.cb_channels\s+FOR EACH ROW EXECUTE FUNCTION public\.cb_desliga_robos_da_conexao\(\);/,
    );
  });

  it('desliga só o robô ATIVO restrito à conexão', () => {
    const funcao = CODIGO.match(/FUNCTION public\.cb_desliga_robos_da_conexao[\s\S]*?\$\$;/)?.[0] ?? '';
    expect(funcao).toMatch(/UPDATE flows\s+SET status = 'draft'\s+WHERE channel_id = OLD\.id\s+AND status = 'active';/);
    expect(funcao).toContain('RETURN OLD;');
    expect(funcao).toContain('SECURITY DEFINER');
  });

  it('a função de gatilho não é RPC', () => {
    expect(CODIGO).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_desliga_robos_da_conexao\(\) FROM PUBLIC, anon, authenticated;/,
    );
  });

  it('a prova se desfaz pelo SQLSTATE próprio, nunca por WHEN OTHERS', () => {
    expect(CODIGO).toContain("ERRCODE = 'P1077'");
    expect(CODIGO).toContain("WHEN SQLSTATE 'P1077'");
    expect(CODIGO).not.toMatch(/WHEN OTHERS/);
  });

  it('a tela lista como "desligados" exatamente os robôs que o gatilho desliga', () => {
    const r = robosQueDependem(
      'c1',
      [
        { id: 'r1', name: 'Só desta', status: 'active', channel_id: 'c1' },
        { id: 'r2', name: 'Rascunho desta', status: 'draft', channel_id: 'c1' },
        { id: 'r3', name: 'De todos', status: 'active', channel_id: null },
        { id: 'r4', name: 'De outra', status: 'active', channel_id: 'c2' },
      ],
      [{ flow_id: 'r3', config: { channel_id: 'c1' } }],
    );
    expect(r.robosDesligados.map((x) => [x.id, x.ativo])).toEqual([
      ['r1', true],
      ['r2', false],
    ]);
    expect(r.robosComPasso.map((x) => x.id)).toEqual(['r3']);
  });
});
