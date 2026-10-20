import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1095 — a série "Conversas ao longo do tempo" e o "Tempo de resposta" do
// Painel somam no BANCO (o PostgREST cortava as linhas em 1000 sem avisar).
// Provada num Postgres 16 descartável com as duas funções e cenários de dado
// (fuso, grupo, ligação, tentativa que não saiu, canal, pares do tempo de
// resposta). Estes pinos seguram a FORMA: os filtros que a leitura antiga
// fazia pelo PostgREST e que agora só existem aqui.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1095_cb_painel_por_dia.sql'), 'utf8');
const compacto = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ')
  .toLowerCase();

function corpo(nome: string): string {
  const i = compacto.indexOf(`create or replace function public.${nome}(`);
  expect(i, nome).toBeGreaterThan(-1);
  return compacto.slice(i, compacto.indexOf('$$;', compacto.indexOf('as $$', i)));
}

const SERIE = corpo('cb_painel_mensagens_por_dia');
const RESPOSTA = corpo('cb_painel_tempo_de_resposta');

describe('1095 — as duas RPCs do Painel', () => {
  it('são SECURITY INVOKER: a RLS de messages é a cerca entre contas', () => {
    for (const c of [SERIE, RESPOSTA]) {
      expect(c).toContain('security invoker');
      expect(c).not.toContain('security definer');
      expect(c).toContain('set search_path = public');
    }
  });

  it('agrupam pelo fuso de quem olha, nunca pelo do servidor (UTC)', () => {
    expect(SERIE).toContain('(m.created_at at time zone p_fuso)::date as dia');
    expect(RESPOSTA).toContain('(p.cliente_em at time zone p_fuso)::date as dia');
  });

  it('grupo fora, tentativa do robô que não saiu (1080) fora, canal opcional', () => {
    for (const c of [SERIE, RESPOSTA]) {
      expect(c).toContain('join public.conversations c on c.id = m.conversation_id');
      expect(c).toContain('c.group_id is null');
      expect(c).toContain('not m.nao_saiu');
      expect(c).toContain('m.created_at >= p_desde');
      expect(c).toContain('(p_canal is null or m.channel_id = p_canal)');
    }
  });

  it('a ligação (1044) sai da série — a atendida é `agent` e contaria como enviada', () => {
    expect(SERIE).toContain("m.content_type <> 'call'");
  });

  it('o tempo de resposta mantém a ligação, como a leitura antiga', () => {
    // Mudar isso é decisão de produto, não conserto do corte de 1000.
    expect(RESPOSTA).not.toContain("'call'");
  });

  it('recebida = cliente; enviada = todo o resto (equipe e robô)', () => {
    expect(SERIE).toContain("count(*) filter (where m.sender_type = 'customer') as recebidas");
    expect(SERIE).toContain("count(*) filter (where m.sender_type <> 'customer') as enviadas");
  });

  it('o par do tempo de resposta: primeira fala do cliente do turno, fechada pela fala de fora', () => {
    // A ordem desempata por `id`: sem ele, duas falas no mesmo instante
    // trocariam de turno entre uma chamada e outra.
    expect(RESPOSTA).toContain(
      "count(*) filter (where m.sender_type <> 'customer') over ( partition by m.conversation_id order by m.created_at, m.id rows between unbounded preceding and 1 preceding ) as turno",
    );
    expect(RESPOSTA).toContain('min(f.created_at) filter (where f.do_cliente) as cliente_em');
    expect(RESPOSTA).toContain('max(f.created_at) filter (where not f.do_cliente) as resposta_em');
    expect(RESPOSTA).toContain('group by f.conversation_id, f.turno');
    expect(RESPOSTA).toContain('where p.cliente_em is not null and p.resposta_em is not null');
  });

  it('nada para anon; authenticated e service_role chamam', () => {
    for (const nome of ['cb_painel_mensagens_por_dia', 'cb_painel_tempo_de_resposta']) {
      expect(compacto).toContain(
        `revoke execute on function public.${nome}(timestamptz, text, uuid) from public, anon;`,
      );
      expect(compacto).toContain(
        `grant execute on function public.${nome}(timestamptz, text, uuid) to authenticated, service_role;`,
      );
    }
  });
});

describe('1095 — o Painel chama as RPCs', () => {
  const queries = fs
    .readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'dashboard', 'queries.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it("um merge que traga a leitura do upstream (linhas de messages somadas no navegador) reprova", () => {
    expect(queries).toContain("db.rpc('cb_painel_mensagens_por_dia', {");
    expect(queries).toContain("db.rpc('cb_painel_tempo_de_resposta', {");
    // A leitura antiga das duas: as linhas cruas, sem `head` nem `limit`.
    expect(queries).not.toMatch(/\.select\(`created_at, sender_type, /);
    expect(queries).not.toMatch(/\.select\(`conversation_id, sender_type, created_at, /);
  });
});
