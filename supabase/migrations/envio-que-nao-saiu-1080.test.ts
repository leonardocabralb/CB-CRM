import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1080 — `messages.nao_saiu` e as quatro perguntas "alguém falou?" do banco
// que passam a ignorá-la. Provada num Postgres 16 descartável (06/10/2026):
// esqueleto das tabelas com as quatro funções VIGENTES (1049/1056, os corpos
// conferidos byte a byte contra a produção), a 1080 aplicada duas vezes num
// banco VAZIO (a conferência pula) e uma com dados (a conferência passa pelos
// três cenários e se desfaz sem rastro); dois mutantes — o teto sem a cerca e
// o gatilho do "em atraso" sem ela — reprovam. Estes pinos seguram a FORMA.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1080_cb_envio_que_nao_saiu.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');
const compacto = semComentarios.replace(/\s+/g, ' ').toLowerCase();

function corpo(nome: string): string {
  const re = new RegExp(`create or replace function (public\\.)?${nome}\\(`);
  const m = re.exec(compacto);
  expect(m, nome).not.toBeNull();
  const i = m!.index;
  return compacto.slice(i, compacto.indexOf('$$;', compacto.indexOf('as $$', i)));
}

function contar(texto: string, trecho: string): number {
  return texto.split(trecho).length - 1;
}

describe('1080 — a coluna e a trava', () => {
  it('a coluna nasce false para toda linha antiga, e é idempotente', () => {
    expect(compacto).toContain(
      'alter table messages add column if not exists nao_saiu boolean not null default false;',
    );
  });

  it('lock_timeout ANTES da ALTER, e a escolha da conversa (a consulta cara) também antes dela', () => {
    const trava = compacto.indexOf("set local lock_timeout = '5s';");
    const escolha = compacto.indexOf("set_config('cb1080.conv'");
    const alter = compacto.indexOf('alter table messages');
    expect(trava).toBeGreaterThan(-1);
    expect(escolha).toBeGreaterThan(trava);
    expect(alter).toBeGreaterThan(escolha);
    // Passa para depois da trava por configuração LOCAL da transação, nunca
    // por tabela temporária (quebraria a idempotência).
    expect(compacto).not.toContain('create temp');
    expect(compacto).toContain("current_setting('cb1080.conv', true)");
  });
});

describe('1080 — as quatro perguntas "alguém falou?" ignoram o que não saiu', () => {
  it('o "em atraso" no INSERT: a resposta que não saiu não responde', () => {
    const c = corpo('cb_marcar_aguardando_resposta');
    expect(c).toContain('elsif not new.nao_saiu and (');
    // O resto da régua (gente OU a resposta do agente) continua de pé.
    expect(c).toContain("(new.sender_type = 'bot' and new.ia_agente_id is not null)");
  });

  it('o recálculo ao apagar e o assentamento da histórica: cada "gente respondeu?"', () => {
    expect(contar(corpo('cb_mensagem_apagada_recalcula_espera'), 'and not h.nao_saiu')).toBe(1);
    expect(contar(corpo('cb_assentar_mensagem_historica'), 'and not h.nao_saiu')).toBe(3);
  });

  it('a reserva do agente: os dois "o robô falou" e o teto', () => {
    const c = corpo('cb_ia_reservar_envio');
    expect(contar(c, "and m.sender_type = 'bot' and not m.nao_saiu")).toBe(2);
    expect(c).toContain('and m.ia_agente_id = t.ia_agente_id and not m.nao_saiu');
  });

  it('as funções continuam fechadas ao navegador e abertas ao service_role', () => {
    for (const f of [
      'cb_marcar_aguardando_resposta()',
      'cb_mensagem_apagada_recalcula_espera()',
      'public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)',
      'public.cb_ia_reservar_envio(uuid, timestamptz)',
    ]) {
      expect(compacto, f).toMatch(new RegExp(`revoke execute on function ${f.replace(/[().]/g, '\\$&')} from public, anon, authenticated`));
      expect(compacto, f).toMatch(new RegExp(`grant execute on function ${f.replace(/[().]/g, '\\$&')} to service_role`));
    }
  });

  it('os gatilhos da 972 NÃO são recriados (a carga da 1033 os cala pelo nome)', () => {
    expect(compacto).not.toMatch(/create trigger/);
    expect(compacto).not.toMatch(/drop trigger/);
  });
});

describe('1080 — a conferência', () => {
  it('chama as funções num subbloco desfeito por SQLSTATE PRÓPRIO, nunca WHEN OTHERS', () => {
    expect(compacto).toContain("raise exception using errcode = 'p1080';");
    expect(compacto).toContain("exception when sqlstate 'p1080' then null;");
    expect(compacto).not.toContain('when others');
  });

  it('prova os três cenários: o "em atraso", "o robô falou" e o teto', () => {
    expect(compacto).toContain('a resposta do agente que não saiu apagou o "em atraso"');
    expect(compacto).toContain("v_res <> 'robo_falou'");
    expect(compacto).toContain("v_res <> 'teto'");
    expect(compacto).toContain('public.cb_assentar_mensagem_historica(');
  });
});
