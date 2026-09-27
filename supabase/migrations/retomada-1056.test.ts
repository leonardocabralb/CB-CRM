import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1056 — a RETOMADA do agente de IA. Provada num Postgres 16 descartável:
// o esqueleto das tabelas com as funções da 1049/1050, a 1056 aplicada duas
// vezes num banco VAZIO (a conferência pula) e num com dados (a conferência
// passa pelo corpo inteiro), e os cenários da reserva e da fila (o cliente
// noutra conexão, a mensagem apagada, o histórico importado, o outro agente,
// o teto contando as retomadas, o CHECK). Estes pinos seguram a FORMA.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1056_cb_ia_retomada.sql'), 'utf8');
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

describe('1056 — as colunas', () => {
  it('a configuração por agente e o tipo/tentativa do turno, idempotentes', () => {
    expect(compacto).toContain('alter table cb_ia_agentes add column if not exists retomada jsonb;');
    expect(compacto).toContain("alter table cb_ia_turnos add column if not exists tipo text not null default 'resposta';");
    expect(compacto).toContain('alter table cb_ia_turnos add column if not exists tentativa integer;');
    expect(compacto).toContain('alter table cb_ia_turnos add column if not exists tentativas integer;');
  });

  it('o CHECK amarra os três — com `is not null` explícito (NULL não reprova CHECK)', () => {
    expect(compacto).toContain(
      "(tipo = 'resposta' and tentativa is null and tentativas is null) or (tipo = 'retomada' and tentativa is not null and tentativas is not null and tentativa between 1 and 8 and tentativas between tentativa and 8)",
    );
  });

  it('o índice parcial das retomadas pendentes', () => {
    expect(compacto).toContain(
      "create index if not exists cb_ia_turnos_retomada_pendente_idx on cb_ia_turnos (conversation_id) where status = 'aguardando' and tipo = 'retomada';",
    );
  });
});

describe('1056 — a fila (cb_ia_enfileirar_turno)', () => {
  const f = corpo('cb_ia_enfileirar_turno');

  it('mantém a assinatura (CREATE OR REPLACE, sem DROP)', () => {
    expect(compacto).toContain(
      'create or replace function public.cb_ia_enfileirar_turno( p_account_id uuid, p_conversation_id uuid, p_canal_id uuid, p_ia_agente_id uuid, p_deal_id uuid, p_stage_id uuid, p_mensagem_id uuid, p_espera_ms integer, p_veio_de_passagem boolean default false )',
    );
    expect(compacto).not.toContain('drop function');
  });

  it('ANTES de gravar o pendente, descarta a retomada pendente da conversa — em qualquer conexão', () => {
    const descarte = f.indexOf("update cb_ia_turnos set status = 'descartado'");
    expect(descarte).toBeGreaterThan(-1);
    expect(f.indexOf('insert into cb_ia_turnos')).toBeGreaterThan(descarte);
    const where = f.slice(descarte, f.indexOf('insert into cb_ia_turnos'));
    expect(where).toContain("status = 'aguardando' and tipo = 'retomada'");
    expect(where).toContain('conversation_id = p_conversation_id');
    // Sem o recorte da conexão: o cliente que escreve na B para a série da A.
    expect(where).not.toContain('canal_id');
  });

  it('o INSERT é o da 1050 (a rajada fica com a mais nova)', () => {
    const regua =
      'coalesce((select n.gravada_em < v.gravada_em from messages n, messages v where n.id = excluded.mensagem_gatilho_id and v.id = t.mensagem_gatilho_id), false)';
    expect(f.split(regua).length - 1).toBe(4);
    expect(f).toContain('when excluded.veio_de_passagem then t.mensagem_gatilho_id');
  });
});

describe('1056 — a reserva (cb_ia_reservar_envio)', () => {
  const f = corpo('cb_ia_reservar_envio');

  it('mantém a assinatura e as recusas da 1049, na ordem', () => {
    expect(compacto).toContain('create or replace function public.cb_ia_reservar_envio( p_turno_id uuid, p_rodando_desde timestamptz )');
    const ordem = ['descartado', 'encerrada', 'pausada', 'card_mudou', 'card_fechado', 'agente_desligado', 'fora_da_conexao', 'agente_sem_etapa', 'mais_nova', 'teto'].map((m) =>
      f.indexOf(`return '${m}'`),
    );
    for (const i of ordem) expect(i).toBeGreaterThan(-1);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(f).toContain('for no key update');
  });

  it('as recusas SÓ da retomada, entre `agente_sem_etapa` e `mais_nova`', () => {
    const semEtapa = f.indexOf("return 'agente_sem_etapa'");
    const maisNova = f.indexOf("return 'mais_nova'");
    for (const m of ['retomada_desligada', 'sem_ancora', 'cliente_respondeu', 'equipe_respondeu']) {
      const i = f.indexOf(`return '${m}'`);
      expect(i, m).toBeGreaterThan(semEtapa);
      expect(i, m).toBeLessThan(maisNova);
    }
    expect(f).toContain("if t.tipo = 'retomada' then");
  });

  it('a retomada ligada é o BOOLEANO true (o "true" em texto do jsonb não liga)', () => {
    expect(f).toContain("if t.tipo = 'retomada' and not coalesce(a.retomada -> 'ativa' = 'true'::jsonb, false) then return 'retomada_desligada';");
  });

  it('o cliente conta em QUALQUER conexão e mesmo apagado; o robô e OUTRO agente param a série', () => {
    const cliente = f.slice(f.indexOf("m.sender_type = 'customer'"), f.indexOf("return 'cliente_respondeu'"));
    expect(cliente).toContain('m.gravada_em > v_gatilho');
    expect(cliente).not.toContain('channel_id');
    expect(cliente).not.toContain('deleted_at');
    expect(f).toContain('(m.ia_agente_id is null or m.ia_agente_id <> t.ia_agente_id)');
  });

  it('âncora ausente ou apagada: sem_ancora', () => {
    expect(f).toContain("if v_gatilho is null or v_apagada is not null then return 'sem_ancora';");
  });
});

describe('1056 — privilégios e conferência', () => {
  it('lock_timeout: tabelas quentes', () => {
    expect(compacto).toContain("set local lock_timeout = '5s';");
  });

  it('as duas metades do REVOKE e o GRANT de volta, nas duas funções', () => {
    for (const assinatura of [
      'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)',
      'public.cb_ia_reservar_envio(uuid, timestamptz)',
    ]) {
      expect(compacto).toContain(`revoke execute on function ${assinatura} from public, anon, authenticated;`);
      expect(compacto).toContain(`grant execute on function ${assinatura} to service_role;`);
    }
  });

  it('a conferência CHAMA a reserva e a fila e se desfaz pelo SQLSTATE próprio (nunca WHEN OTHERS)', () => {
    expect(compacto).toContain('v_res := public.cb_ia_reservar_envio(v_ret, v_desde);');
    expect(compacto).toContain('from public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ultima, 8000) t;');
    expect(compacto).toContain("raise exception using errcode = 'p1056';");
    expect(compacto).toContain("exception when sqlstate 'p1056' then null;");
    expect(compacto).not.toContain('when others');
  });

  it('em banco vazio a conferência pula (RAISE NOTICE), nunca exige dado', () => {
    expect(compacto).toContain("raise notice '1056: nenhuma conversa com card aberto");
  });
});
