import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  TETO_DE_CRITERIOS,
  TETO_DE_FUNIS,
  TETO_DE_RESPOSTAS,
  TETO_DO_NOME_DO_PERFIL,
  alternarFunil,
  alternarResposta,
  camposQueFaltam,
  contarPorPerfil,
  criteriosValidos,
  funisDoPerfil,
  funisParaGravar,
  lerCriterios,
  lerFunis,
  lerDetalheDoClienteIdeal,
  nomeDoPerfilValido,
  respostaMarcada,
  respostaNormalizada,
  respostasOferecidas,
  somentePadroes,
} from './cliente-ideal';

const CAMPO_A = '11111111-1111-4111-8111-111111111111';
const CAMPO_B = '22222222-2222-4222-8222-222222222222';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/1124_cb_perfis_de_cliente_ideal.sql'),
  'utf8',
);

describe('o espelho da 1124', () => {
  it('normaliza como cb_resposta_normalizada', () => {
    expect(SQL).toContain("lower(btrim(regexp_replace(coalesce(p_texto, ''), '\\s+', ' ', 'g')))");
    expect(respostaNormalizada('  Atraso de 3  à 6\tMESES ')).toBe('atraso de 3 à 6 meses');
    expect(respostaNormalizada(null)).toBe('');
  });

  it('usa os mesmos tetos do banco', () => {
    expect(SQL).toContain(`char_length(nome) <= ${TETO_DO_NOME_DO_PERFIL}`);
    expect(SQL).toContain(`jsonb_array_length(p) > ${TETO_DE_CRITERIOS}`);
    expect(SQL).toContain(`jsonb_array_length(v_criterio -> 'respostas') > ${TETO_DE_RESPOSTAS}`);
    expect(SQL).toContain(`LIMIT ${TETO_DE_RESPOSTAS}`);
  });
});

const SQL_1125 = readFileSync(
  join(process.cwd(), 'supabase/migrations/1125_cb_cliente_ideal_por_funil.sql'),
  'utf8',
);

describe('o espelho da 1125 (funis do perfil, D8)', () => {
  it('usa o mesmo teto e a mesma forma do CHECK', () => {
    expect(SQL_1125).toContain(`cardinality(funis) BETWEEN 1 AND ${TETO_DE_FUNIS}`);
    expect(SQL_1125).toContain('funis IS NULL OR');
  });

  it('o quadro de um funil só pega os perfis daquele funil', () => {
    expect(SQL_1125).toContain('p_funil IS NULL OR p.funis IS NULL OR p_funil = ANY (p.funis)');
  });

  it('lista vazia ou ausente é NULO (todos), nunca "ninguém"', () => {
    expect(lerFunis(null)).toBeNull();
    expect(lerFunis([])).toBeNull();
    expect(lerFunis(['f1', 2, '', 'f2'])).toEqual(['f1', 'f2']);
    expect(funisParaGravar([])).toBeNull();
    expect(funisParaGravar(['f1', 'f1', 'f2'])).toEqual(['f1', 'f2']);
  });

  it('alterna um funil no editor', () => {
    expect(alternarFunil(['f1'], 'f2')).toEqual(['f1', 'f2']);
    expect(alternarFunil(['f1', 'f2'], 'f1')).toEqual(['f2']);
  });

  it('dá nome aos funis e acusa quando todos foram apagados', () => {
    const catalogo = [{ id: 'f1', name: 'Comercial' }];
    expect(funisDoPerfil(null, catalogo)).toEqual({ nomes: [], todosApagados: false });
    expect(funisDoPerfil(['f1', 'x'], catalogo)).toEqual({ nomes: ['Comercial', null], todosApagados: false });
    expect(funisDoPerfil(['x'], catalogo)).toEqual({ nomes: [null], todosApagados: true });
  });
});

describe('criteriosValidos', () => {
  it('aceita a forma da 1124', () => {
    expect(criteriosValidos([{ campo: CAMPO_A, respostas: ['Maior que 500 mil reais'] }])).toBe(true);
    expect(
      criteriosValidos([
        { campo: CAMPO_A, respostas: ['a'] },
        { campo: CAMPO_B, respostas: ['b', 'c'] },
      ]),
    ).toBe(true);
  });

  it('recusa o mesmo que a conferência da migration', () => {
    expect(criteriosValidos([])).toBe(false);
    expect(criteriosValidos('x')).toBe(false);
    expect(criteriosValidos([{ campo: 'nao-e-uuid', respostas: ['a'] }])).toBe(false);
    expect(criteriosValidos([{ campo: CAMPO_A, respostas: [] }])).toBe(false);
    expect(criteriosValidos([{ campo: CAMPO_A, respostas: ['  '] }])).toBe(false);
    expect(criteriosValidos([{ campo: CAMPO_A, respostas: [1] }])).toBe(false);
    expect(
      criteriosValidos([
        { campo: CAMPO_A, respostas: ['a'] },
        { campo: CAMPO_A, respostas: ['b'] },
      ]),
    ).toBe(false);
  });

  it('recusa acima dos tetos', () => {
    const muitos = Array.from({ length: TETO_DE_CRITERIOS + 1 }, (_, i) => ({
      campo: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
      respostas: ['a'],
    }));
    expect(criteriosValidos(muitos)).toBe(false);
    const respostas = Array.from({ length: TETO_DE_RESPOSTAS + 1 }, (_, i) => `r${i}`);
    expect(criteriosValidos([{ campo: CAMPO_A, respostas }])).toBe(false);
  });
});

describe('nomeDoPerfilValido', () => {
  it('segue o CHECK do nome', () => {
    expect(nomeDoPerfilValido('Bancário')).toBe(true);
    expect(nomeDoPerfilValido('')).toBe(false);
    expect(nomeDoPerfilValido(' Bancário')).toBe(false);
    expect(nomeDoPerfilValido('x'.repeat(TETO_DO_NOME_DO_PERFIL + 1))).toBe(false);
  });
});

describe('marcar respostas', () => {
  const criterio = { campo: CAMPO_A, respostas: ['Atraso de 3  à 6 meses'] };

  it('outra grafia da mesma resposta aparece marcada', () => {
    expect(respostaMarcada(criterio, 'atraso de 3 à 6 MESES')).toBe(true);
    expect(respostaMarcada(criterio, 'Atraso de 3 meses')).toBe(false);
  });

  it('desmarcar tira todas as grafias; marcar acrescenta aparada', () => {
    const dupla = { campo: CAMPO_A, respostas: ['Sim', ' sim '] };
    expect(alternarResposta(dupla, 'SIM').respostas).toEqual([]);
    expect(alternarResposta(criterio, ' Em dia ').respostas).toEqual(['Atraso de 3  à 6 meses', 'Em dia']);
  });
});

describe('respostasOferecidas', () => {
  it('gravadas primeiro, depois opções e marcadas que ninguém gravou, sem repetir grafia', () => {
    const lista = respostasOferecidas(
      [
        { resposta: 'Maior que 500 mil reais', fichas: 257 },
        { resposta: 'Maior que 1M', fichas: 15 },
      ],
      ['Maior que 1M', 'Menor que 150 mil reais'],
      ['maior que 500 MIL reais', 'Acima de 500 Mil'],
    );
    expect(lista).toEqual([
      { resposta: 'Maior que 500 mil reais', fichas: 257 },
      { resposta: 'Maior que 1M', fichas: 15 },
      { resposta: 'Menor que 150 mil reais', fichas: 0 },
      { resposta: 'Acima de 500 Mil', fichas: 0 },
    ]);
  });
});

describe('somentePadroes', () => {
  it('a resposta de uma ficha só fica de fora (senha, id, nome)', () => {
    expect(
      somentePadroes([
        { resposta: 'Maior que 500 mil reais', fichas: 257 },
        { resposta: 'Entre 300mil a 500 mil reais', fichas: 3 },
        { resposta: 'senha-ficticia-123', fichas: 1 },
      ]),
    ).toEqual({
      padroes: [
        { resposta: 'Maior que 500 mil reais', fichas: 257 },
        { resposta: 'Entre 300mil a 500 mil reais', fichas: 3 },
      ],
      deFora: 1,
    });
  });
});

describe('lerDetalheDoClienteIdeal e camposQueFaltam', () => {
  it('lê a resposta de cb_cliente_ideal_do_contato', () => {
    const detalhe = lerDetalheDoClienteIdeal({
      nivel: 'possivel',
      perfil: { id: 'p1', nome: 'Perfil Ficticio' },
      criterios: [
        { campo_id: CAMPO_A, campo: 'Tamanho da Divida', valor: 'Maior que 1M', casa: true },
        { campo_id: CAMPO_B, campo: 'Tempo de Atraso', valor: null, casa: false },
      ],
      retrato: { do_cliente: 0, nossas: 3, nao_sairam: 1 },
    });
    expect(detalhe).toEqual({
      nivel: 'possivel',
      perfil: { id: 'p1', nome: 'Perfil Ficticio' },
      criterios: [
        { campoId: CAMPO_A, campo: 'Tamanho da Divida', valor: 'Maior que 1M', casa: true },
        { campoId: CAMPO_B, campo: 'Tempo de Atraso', valor: null, casa: false },
      ],
      retrato: { doCliente: 0, nossas: 3, naoSairam: 1 },
    });
    expect(camposQueFaltam(detalhe!)).toEqual(['Tempo de Atraso']);
  });

  it('quem não é ideal tem nível nulo; forma estranha é "não sei"', () => {
    expect(lerDetalheDoClienteIdeal({ nivel: null, perfil: null, criterios: [], retrato: {} })?.nivel).toBeNull();
    expect(lerDetalheDoClienteIdeal(null)).toBeNull();
    expect(lerDetalheDoClienteIdeal('x')).toBeNull();
  });
});

describe('lerCriterios e contarPorPerfil', () => {
  it('descarta lixo sem quebrar', () => {
    expect(lerCriterios(null)).toEqual([]);
    expect(lerCriterios([{ campo: CAMPO_A, respostas: ['a', 2] }, 'x', { respostas: ['b'] }])).toEqual([
      { campo: CAMPO_A, respostas: ['a'] },
    ]);
  });

  it('conta ideais e possíveis por perfil', () => {
    const contagem = contarPorPerfil([
      { contact_id: 'c1', nivel: 'ideal', perfil_id: 'p1' },
      { contact_id: 'c2', nivel: 'possivel', perfil_id: 'p1' },
      { contact_id: 'c3', nivel: 'ideal', perfil_id: 'p2' },
    ]);
    expect(contagem.get('p1')).toEqual({ ideais: 1, possiveis: 1 });
    expect(contagem.get('p2')).toEqual({ ideais: 1, possiveis: 0 });
  });
});

describe('o quadro relê os cards ideais a cada releitura da lista (Codex, PR #466)', () => {
  const pagina = readFileSync(
    join(process.cwd(), 'src/app/(dashboard)/pipelines/page.tsx'),
    'utf8',
  );

  it('a versão é o contador de releituras, nunca o tamanho da lista', () => {
    // Trocar o contato de um card não muda `deals.length`: com ele como
    // versão, o card seguia no quadro filtrado sem o selo.
    const chamada = pagina.match(/useNegociosDeClientesIdeais\(([\s\S]*?)\);/);
    // O 3º argumento (o 4º é o funil, 1125).
    const args = (chamada?.[1] ?? '').split(',').map((a) => a.trim());
    expect(args[2]).toBe('leiturasDosNegocios');
    expect(chamada?.[1]).not.toMatch(/deals\.length/);
  });

  it('o mapa e os negócios do quadro são do FUNIL aberto (1125)', () => {
    expect(pagina).toMatch(/useClientesIdeais\(0, selectedPipelineId \|\| null\)/);
    const chamada = pagina.match(/useNegociosDeClientesIdeais\(([\s\S]*?)\);/);
    expect(chamada?.[1]).toMatch(/selectedPipelineId \|\| null,?\s*$/);
  });

  it('as duas portas que relêem a lista inteira contam a releitura', () => {
    // `gravarNegocios` (carga do funil e `refreshDeals`) e a volta ao app.
    expect(pagina.match(/setLeiturasDosNegocios\(\(v\) => v \+ 1\)/g)?.length).toBe(2);
  });
});
