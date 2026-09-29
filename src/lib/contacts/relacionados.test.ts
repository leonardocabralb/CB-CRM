import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  TETO_DA_DESCRICAO,
  descricaoParaGravar,
  desfechoDoErro,
  montarRelacionados,
  outroLado,
  type VinculoGravado,
} from './relacionados';

const vinculo = (id: string, a: string, b: string, descricao: string | null = null): VinculoGravado => ({
  id,
  contact_a_id: a,
  contact_b_id: b,
  descricao,
});

describe('outroLado — o vínculo vale para os dois lados', () => {
  it('devolve a outra ponta, seja o contato a coluna A ou a B', () => {
    const v = vinculo('v1', 'ana', 'bruno');
    expect(outroLado(v, 'ana')).toBe('bruno');
    expect(outroLado(v, 'bruno')).toBe('ana');
  });
});

describe('descricaoParaGravar', () => {
  it('apara, e vazio vira NULO (o CHECK recusa "" e espaço nas pontas)', () => {
    expect(descricaoParaGravar('  esposa ')).toBe('esposa');
    expect(descricaoParaGravar('   ')).toBeNull();
    expect(descricaoParaGravar('')).toBeNull();
  });

  it('o teto é o mesmo do CHECK da 1069', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/1069_cb_contatos_relacionados.sql'),
      'utf8',
    );
    expect(sql).toContain(`char_length(descricao) <= ${TETO_DA_DESCRICAO}`);
  });
});

describe('montarRelacionados', () => {
  it('mostra a OUTRA ponta, com a ficha e a conversa dela, na ordem dos vínculos', () => {
    const lista = montarRelacionados(
      'ana',
      [vinculo('v1', 'ana', 'bruno', 'esposo'), vinculo('v2', 'carla', 'ana')],
      [
        { id: 'carla', name: 'Carla', phone: '5583900000002' },
        { id: 'bruno', name: 'Bruno', phone: '5583900000001' },
      ],
      [
        { id: 'cv-bruno', contact_id: 'bruno' },
        { id: 'cv-grupo', contact_id: null },
      ],
    );
    expect(lista).toEqual([
      {
        vinculoId: 'v1',
        contatoId: 'bruno',
        contato: { id: 'bruno', name: 'Bruno', phone: '5583900000001' },
        descricao: 'esposo',
        conversaId: 'cv-bruno',
      },
      {
        vinculoId: 'v2',
        contatoId: 'carla',
        contato: { id: 'carla', name: 'Carla', phone: '5583900000002' },
        descricao: null,
        // Carla ainda não conversou: sem conversa, nunca a de outro.
        conversaId: null,
      },
    ]);
  });

  it('ficha que não veio na leitura continua na lista (sumir esconderia o vínculo)', () => {
    const lista = montarRelacionados('ana', [vinculo('v1', 'ana', 'bruno')], [], []);
    expect(lista).toHaveLength(1);
    expect(lista[0].contato).toBeNull();
    expect(lista[0].contatoId).toBe('bruno');
  });
});

describe('desfechoDoErro', () => {
  it('traduz as recusas do banco', () => {
    expect(desfechoDoErro({ code: '23505' })).toBe('ja-vinculados');
    expect(desfechoDoErro({ code: '23514' })).toBe('invalido');
    expect(desfechoDoErro({ code: '42501' })).toBe('recusado');
    expect(desfechoDoErro({ code: '23503' })).toBe('sumiu');
  });

  it('código desconhecido ou ausente é falha, nunca sucesso', () => {
    expect(desfechoDoErro({ code: 'PGRST301' })).toBe('falhou');
    expect(desfechoDoErro({})).toBe('falhou');
  });
});
