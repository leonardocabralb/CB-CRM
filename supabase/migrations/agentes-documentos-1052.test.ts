import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1052 — a base de conhecimento POR AGENTE (F3, D20) e o retrato do turno.
// Os comportamentos foram provados num Postgres 16 descartável com dados (o
// vínculo, as FKs compostas recusando documento e agente de outra conta, o
// CASCADE dos dois lados, arquivar que não apaga, as buscas devolvendo SÓ os
// documentos do agente, agente nulo = nada, os privilégios com os padrões do
// Supabase emulados) e no replay de todas as migrations num banco vazio;
// estes pinos seguram a FORMA que os sustenta.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1052_cb_ia_agente_documentos.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');
const compacto = semComentarios.replace(/\s+/g, ' ').toLowerCase();

function funcao(nome: string): string {
  const ini = compacto.indexOf(`create function public.${nome}(`);
  expect(ini, nome).toBeGreaterThan(-1);
  const abre = compacto.indexOf('as $$', ini);
  return compacto.slice(ini, compacto.indexOf('$$;', abre + 5));
}

const conferencia = () => compacto.slice(compacto.lastIndexOf('do $$'));

describe('1052 — a forma da migration', () => {
  it('a trava de lock vem antes da primeira alteração', () => {
    const lock = compacto.indexOf("set local lock_timeout = '5s'");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(compacto.indexOf('alter table'));
  });

  it('o alvo da FK composta: UNIQUE (id, account_id) em ai_knowledge_documents, só se ainda não existe', () => {
    expect(compacto).toContain(
      'alter table public.ai_knowledge_documents add constraint ai_knowledge_documents_id_conta_key unique (id, account_id)',
    );
    expect(compacto).toMatch(/if not exists \( select 1 from pg_constraint[^;]*ai_knowledge_documents_id_conta_key/);
  });
});

describe('1052 — cb_ia_agente_documentos', () => {
  it('um vínculo por (agente, documento), com as DUAS FKs compostas pela conta e CASCADE', () => {
    expect(compacto).toContain('create table if not exists cb_ia_agente_documentos');
    expect(compacto).toContain('primary key (ia_agente_id, documento_id)');
    expect(compacto).toContain(
      'foreign key (ia_agente_id, account_id) references cb_ia_agentes (id, account_id) on delete cascade',
    );
    expect(compacto).toContain(
      'foreign key (documento_id, account_id) references ai_knowledge_documents (id, account_id) on delete cascade',
    );
    expect(compacto).toContain('create index if not exists cb_ia_agente_documentos_documento_idx on cb_ia_agente_documentos (documento_id)');
  });

  it('FECHADA ao navegador: RLS ligada, NENHUMA policy, as duas metades do REVOKE, tudo ao serviço', () => {
    expect(compacto).toContain('alter table cb_ia_agente_documentos enable row level security');
    expect(compacto).not.toMatch(/create policy[^;]*on cb_ia_agente_documentos/);
    expect(compacto).toContain('revoke all on table cb_ia_agente_documentos from public, anon, authenticated');
    expect(compacto).toContain('grant all on table cb_ia_agente_documentos to service_role');
    expect(compacto).not.toMatch(/grant [^;]*on table cb_ia_agente_documentos to [^;]*(anon|authenticated)/);
  });
});

describe('1052 — as buscas com o recorte pelo agente (D20)', () => {
  for (const nome of ['cb_ia_buscar_conhecimento_semantico', 'cb_ia_buscar_conhecimento_fts']) {
    it(`${nome}: SÓ os documentos marcados — JOIN pela conta E pelo agente; nulo = nada`, () => {
      const f = funcao(nome);
      expect(f).toContain('returns table (id uuid, documento_id uuid, content text, score real)');
      expect(f).toMatch(/language (sql|plpgsql) stable security invoker/);
      expect(f).toContain("set search_path to 'public'");
      expect(f).toContain('join cb_ia_agente_documentos d on d.documento_id = c.document_id and d.account_id = c.account_id');
      expect(f).toContain('where c.account_id = p_account_id and d.ia_agente_id = p_ia_agente_id');
      // ⚠️ O padrão da 0903 ("parâmetro nulo = sem recorte") diria o contrário da D20.
      expect(f).not.toMatch(/p_ia_agente_id is null/);
      expect(f).toContain('limit greatest(p_match_count, 0)');
    });

    it(`${nome}: recriada idempotente, EXECUTE só do serviço (as duas metades)`, () => {
      expect(compacto).toContain(`drop function if exists public.${nome}(uuid, uuid, text, integer)`);
      expect(compacto.indexOf(`drop function if exists public.${nome}(`)).toBeLessThan(
        compacto.indexOf(`create function public.${nome}(`),
      );
      expect(compacto).toContain(
        `revoke execute on function public.${nome}(uuid, uuid, text, integer) from public, anon, authenticated`,
      );
      expect(compacto).toContain(`grant execute on function public.${nome}(uuid, uuid, text, integer) to service_role`);
    });
  }

  it('as funções de hoje (0903) ficam intocadas: o rascunho continua nelas', () => {
    expect(compacto).not.toContain('match_ai_knowledge');
  });

  it('INVOKER: o serviço recebe por escrito o SELECT dos trechos (banco novo não tem padrão)', () => {
    expect(compacto).toContain('grant select on table ai_knowledge_chunks to service_role');
  });

  it('a busca por palavras: QUALQUER palavra de 3+ letras (OU), o mesmo `simple` da coluna, ordem total', () => {
    const f = funcao('cb_ia_buscar_conhecimento_fts');
    // ⚠️ `plainto_tsquery` da mensagem inteira exige TODAS as palavras (revisão da F3).
    expect(f).not.toContain("plainto_tsquery('simple', p_query)");
    expect(f).toContain("from unnest(to_tsvector('simple', coalesce(p_query, ''))) as t where char_length(t.lexeme) >= 3");
    expect(f).toContain("else v_q || plainto_tsquery('simple', v_palavra) end");
    expect(f).toContain('c.fts @@ v_q');
    // RETURNS TABLE + plpgsql: nomes qualificados e ordem por posição (a colisão 42702 da 1030).
    expect(f).toContain('#variable_conflict use_column');
    expect(f).toContain('order by 4 desc, 1');
  });

  it('a busca por sentido recebe o embedding como TEXTO e ordena pela distância', () => {
    const f = funcao('cb_ia_buscar_conhecimento_semantico');
    expect(f).toContain('p_query_embedding text');
    expect(f).toContain('order by c.embedding <=> p_query_embedding::vector(1536)');
    expect(f).toContain('c.embedding is not null');
  });
});

describe('1052 — o retrato do turno', () => {
  it('cb_ia_turnos.contexto jsonb, nulo nos turnos antigos', () => {
    expect(compacto).toContain('alter table cb_ia_turnos add column if not exists contexto jsonb;');
  });
});

describe('1052 — a conferência', () => {
  it('CHAMA as duas funções como service_role, num subbloco desfeito por SQLSTATE próprio (nunca WHEN OTHERS)', () => {
    const c = conferencia();
    const sub = c.slice(c.indexOf('set local role service_role'), c.indexOf("exception when sqlstate 'p1052'"));
    expect(sub).toContain('public.cb_ia_buscar_conhecimento_fts(');
    expect(sub).toContain('public.cb_ia_buscar_conhecimento_semantico(');
    expect(sub).toContain("raise exception using errcode = 'p1052'");
    expect(c).not.toMatch(/when others/);
  });

  it('prova agente nulo = nada e o recorte com dado; em banco vazio pula com NOTICE', () => {
    const c = conferencia();
    expect(c).toContain('a busca por palavras com agente nulo devolveu trecho');
    expect(c).toContain('a busca por sentido com agente nulo devolveu trecho');
    expect(c).toContain('trecho de documento não marcado');
    expect(c).toContain("raise notice '1052: banco sem trecho da base");
  });

  it('confere as duas metades do fechamento e as FKs com CASCADE', () => {
    const c = conferencia();
    expect(c).toContain("has_table_privilege('anon', 'public.cb_ia_agente_documentos', f)");
    expect(c).toContain("has_table_privilege('authenticated', 'public.cb_ia_agente_documentos', f)");
    expect(c).toContain("has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')");
    expect(c).toContain("confdeltype = 'c'");
  });
});
