import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { gravarAnuncioDeOrigem } from './gravar-anuncio-de-origem';

// Banco falso: responde às DUAS leituras (catálogo e valores) e registra os
// upserts — é a forma que `salvarValoresDoContato` usa.
interface Estado {
  campos: { id: string; field_key: string; categoria: string }[];
  valores: { custom_field_id: string; value: string }[];
  erroCampos: { message: string } | null;
  erroValores: { message: string } | null;
  erroUpsert: { message: string } | null;
  lancaEm: 'campos' | null;
  consultas: { tabela: string; filtros: [string, string][] }[];
  upserts: { linhas: Record<string, string>[]; opcoes: unknown }[];
  deletes: number;
}

let e: Estado;

function banco(): SupabaseClient {
  return {
    from(tabela: string) {
      const filtros: [string, string][] = [];
      e.consultas.push({ tabela, filtros });
      if (tabela === 'custom_fields' && e.lancaEm === 'campos') {
        throw new Error('rede fora');
      }
      const leitura = {
        select: () => leitura,
        eq: (col: string, val: string) => {
          filtros.push([col, val]);
          return Promise.resolve(
            tabela === 'custom_fields'
              ? { data: e.erroCampos ? null : e.campos, error: e.erroCampos }
              : { data: e.erroValores ? null : e.valores, error: e.erroValores }
          );
        },
        upsert: (linhas: Record<string, string>[], opcoes: unknown) => {
          e.upserts.push({ linhas, opcoes });
          return Promise.resolve({ error: e.erroUpsert });
        },
        delete: () => {
          e.deletes++;
          return leitura;
        },
      };
      return leitura;
    },
  } as unknown as SupabaseClient;
}

const REFERRAL = {
  source_url: 'https://fb.me/3cr4Wqqkv',
  source_id: '120226305854810726',
  source_type: 'ad',
  headline: 'Fale com o advogado',
  ctwa_clid: 'clid-novo',
};

const ARGS = { accountId: 'conta-1', contactId: 'contato-1' };

beforeEach(() => {
  e = {
    campos: [
      'ctwa_clid',
      'utm_source',
      'utm_medium',
      'id_do_anuncio',
      'nome_do_anuncio',
    ].map((k) => ({ id: `id-${k}`, field_key: k, categoria: 'tracking' })),
    valores: [],
    erroCampos: null,
    erroValores: null,
    erroUpsert: null,
    lancaEm: null,
    consultas: [],
    upserts: [],
    deletes: 0,
  };
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gravarAnuncioDeOrigem', () => {
  it('sem referral não consulta nada (o caso de quase toda mensagem)', async () => {
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: undefined,
    });
    expect(r).toEqual({ anuncio: false, plano: null, erros: [] });
    expect(e.consultas).toEqual([]);
  });

  it('referral PRESENTE e ilegível: aviso no log com a forma, sem valores, sem consulta', async () => {
    const bruto = {
      sourceId: 120226305854810726,
      headline: 'Fale com o advogado',
      ad: { id: 'x' },
    };
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: bruto,
    });
    expect(r).toEqual({ anuncio: false, plano: null, erros: [] });
    expect(e.consultas).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const [rotulo, dados] = vi.mocked(console.warn).mock.calls[0];
    expect(rotulo).toBe('[anuncio-de-origem] referral ilegível:');
    expect(dados).toEqual({
      conta: 'conta-1',
      contato: 'contato-1',
      forma: { sourceId: 'number', headline: 'string', ad: 'object' },
    });
    // O título do anúncio não vai para o log.
    expect(JSON.stringify(dados)).not.toContain('advogado');
  });

  it('referral presente que nem é objeto também deixa rastro', async () => {
    await gravarAnuncioDeOrigem({ db: banco(), ...ARGS, referral: 'ad' });
    expect(console.warn).toHaveBeenCalledWith(
      '[anuncio-de-origem] referral ilegível:',
      expect.objectContaining({ forma: 'string' })
    );
  });

  it('log de sucesso diz o tipo e se vieram o id e o ctwa_clid', async () => {
    await gravarAnuncioDeOrigem({ db: banco(), ...ARGS, referral: REFERRAL });
    expect(console.info).toHaveBeenCalledWith(
      '[anuncio-de-origem] recebido:',
      expect.objectContaining({ tipo: 'ad', temId: true, temCtwaClid: true })
    );
    // No sucesso, o valor do clique não precisa ir para o log.
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      'clid-novo'
    );
  });

  it('tipo desconhecido: só o último clique é gravado, e o log avisa', async () => {
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: { ...REFERRAL, source_type: undefined },
    });
    expect(r.plano?.primeiraOrigem).toEqual({});
    expect(e.upserts).toHaveLength(1);
    expect(e.upserts[0].linhas).toEqual([
      {
        contact_id: 'contato-1',
        custom_field_id: 'id-ctwa_clid',
        value: 'clid-novo',
      },
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      '[anuncio-de-origem] tipo desconhecido:',
      expect.objectContaining({ tipo: null, temId: true })
    );
  });

  it('lê o catálogo DA CONTA e os valores DO CONTATO', async () => {
    await gravarAnuncioDeOrigem({ db: banco(), ...ARGS, referral: REFERRAL });
    expect(e.consultas.slice(0, 2)).toEqual([
      { tabela: 'custom_fields', filtros: [['account_id', 'conta-1']] },
      {
        tabela: 'contact_custom_values',
        filtros: [['contact_id', 'contato-1']],
      },
    ]);
  });

  it('ficha sem origem: primeira origem SEM sobrescrever, último clique por cima', async () => {
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: REFERRAL,
    });
    expect(r.erros).toEqual([]);
    expect(e.upserts).toHaveLength(2);

    const [primeira, ultimo] = e.upserts;
    // Primeira origem: INSERT … ON CONFLICT DO NOTHING — quem decide é o banco.
    expect(primeira.opcoes).toEqual({
      onConflict: 'contact_id,custom_field_id',
      ignoreDuplicates: true,
    });
    expect(primeira.linhas).toEqual([
      {
        contact_id: 'contato-1',
        custom_field_id: 'id-utm_source',
        value: 'facebook',
      },
      {
        contact_id: 'contato-1',
        custom_field_id: 'id-utm_medium',
        value: 'paid',
      },
      {
        contact_id: 'contato-1',
        custom_field_id: 'id-id_do_anuncio',
        value: '120226305854810726',
      },
    ]);
    // Último clique: upsert comum, sobrescreve.
    expect(ultimo.opcoes).toEqual({ onConflict: 'contact_id,custom_field_id' });
    expect(ultimo.linhas).toEqual([
      {
        contact_id: 'contato-1',
        custom_field_id: 'id-ctwa_clid',
        value: 'clid-novo',
      },
    ]);
    // Nunca apaga nada.
    expect(e.deletes).toBe(0);
  });

  it('ficha com origem: só o ctwa_clid é gravado', async () => {
    e.valores = [
      { custom_field_id: 'id-nome_do_anuncio', value: 'AD 1 - Antigo Campeão' },
      { custom_field_id: 'id-ctwa_clid', value: 'clid-velho' },
    ];
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: REFERRAL,
    });
    expect(r.plano?.origemJaExistia).toBe(true);
    expect(e.upserts).toHaveLength(1);
    expect(e.upserts[0].linhas).toEqual([
      {
        contact_id: 'contato-1',
        custom_field_id: 'id-ctwa_clid',
        value: 'clid-novo',
      },
    ]);
  });

  it('leitura do catálogo que falha: nada gravado, NÃO lança', async () => {
    e.erroCampos = { message: 'timeout' };
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: REFERRAL,
    });
    expect(r.erros).toEqual(['catálogo: timeout']);
    expect(e.upserts).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });

  it('leitura dos valores que falha: nada gravado — sem saber a origem, não se arrisca', async () => {
    e.erroValores = { message: 'timeout' };
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: REFERRAL,
    });
    expect(r.erros).toEqual(['valores: timeout']);
    expect(e.upserts).toHaveLength(0);
  });

  it('escrita que falha vira erro no resultado, e a outra metade ainda é tentada', async () => {
    e.erroUpsert = { message: 'deadlock' };
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: REFERRAL,
    });
    expect(e.upserts).toHaveLength(2);
    expect(r.erros).toEqual([
      'primeira origem: deadlock',
      'último clique: deadlock',
    ]);
  });

  it('na falha, o log guarda o ctwa_clid e o id do anúncio — para regravar à mão', async () => {
    e.erroUpsert = { message: 'deadlock' };
    await gravarAnuncioDeOrigem({ db: banco(), ...ARGS, referral: REFERRAL });
    expect(console.error).toHaveBeenCalledWith(
      '[anuncio-de-origem] falhou:',
      'primeira origem: deadlock | último clique: deadlock',
      expect.objectContaining({
        ctwaClid: 'clid-novo',
        idDaOrigem: '120226305854810726',
      })
    );
  });

  it('exceção lançada (rede) é engolida: a ingestão nunca cai por causa disto', async () => {
    e.lancaEm = 'campos';
    await expect(
      gravarAnuncioDeOrigem({ db: banco(), ...ARGS, referral: REFERRAL })
    ).resolves.toEqual({ anuncio: true, plano: null, erros: ['rede fora'] });
  });

  it('conta sem os campos: nada gravado, nada criado', async () => {
    e.campos = [];
    const r = await gravarAnuncioDeOrigem({
      db: banco(),
      ...ARGS,
      referral: REFERRAL,
    });
    expect(r.erros).toEqual([]);
    expect(e.upserts).toHaveLength(0);
    expect(r.plano?.semCampo.sort()).toEqual([
      'ctwa_clid',
      'id_do_anuncio',
      'utm_medium',
      'utm_source',
    ]);
  });
});
