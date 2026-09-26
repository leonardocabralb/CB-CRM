import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1044 — quem responde (F2a dos agentes de IA). Os comportamentos foram
// provados num Postgres 16 descartável (rajada por conexão, trava por
// conversa, pausa por gente, D17, encerramento, arquivamento, banco vazio);
// estes pinos seguram a FORMA que os sustenta.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1044_cb_ia_quem_responde.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');
const compacto = semComentarios.replace(/\s+/g, ' ').toLowerCase();

function funcao(nome: string): string {
  const ini = compacto.indexOf(`create or replace function ${nome}`);
  expect(ini, nome).toBeGreaterThan(-1);
  const abre = compacto.indexOf('as $$', ini);
  const fecha = compacto.indexOf('$$;', abre + 5);
  return compacto.slice(abre, fecha);
}

describe('1044 — a fila de turnos', () => {
  it('fechada ao navegador: RLS, nenhuma policy, as duas metades do REVOKE', () => {
    expect(compacto).toContain('alter table cb_ia_turnos enable row level security');
    expect(compacto).toContain('revoke all on table cb_ia_turnos from public, anon, authenticated');
    expect(compacto).not.toMatch(/create policy[^;]*on cb_ia_turnos/);
    expect(compacto).toContain('grant all on table cb_ia_turnos to service_role');
  });

  it('pendente POR CONEXÃO (Codex, #292) e um só RODANDO por conversa', () => {
    expect(compacto).toMatch(
      /cb_ia_turnos_um_aguardando_idx on cb_ia_turnos \(conversation_id, canal_id\) nulls not distinct where status = 'aguardando'/,
    );
    expect(compacto).toMatch(/cb_ia_turnos_um_rodando_idx on cb_ia_turnos \(conversation_id\) where status = 'rodando'/);
    expect(funcao('public.cb_ia_enfileirar_turno')).toContain(
      "on conflict (conversation_id, canal_id) where status = 'aguardando'",
    );
  });

  it('a rajada não troca a PRIMEIRA mensagem, e o relógio é o do banco', () => {
    const corpo = funcao('public.cb_ia_enfileirar_turno');
    const conflito = corpo.slice(corpo.indexOf('do update set'));
    expect(conflito).toContain('mensagem_gatilho_id = excluded.mensagem_gatilho_id');
    expect(conflito).not.toContain('mensagem_inicial_id');
    expect(corpo).toContain('now() + make_interval');
  });

  it('reivindicar com o 23505 do RODANDO virando "ocupado", nunca erro', () => {
    const corpo = funcao('public.cb_ia_reivindicar_turno');
    expect(corpo).toContain("status = 'aguardando'");
    expect(corpo).toContain('executar_apos <= now()');
    expect(corpo).toContain('exception when unique_violation then return');
  });

  it('as RPCs são só do service_role (as duas metades + o GRANT de volta)', () => {
    for (const f of [
      'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, integer)',
      'public.cb_ia_reivindicar_turno(uuid)',
      'public.cb_atribuir_agente_de_ia(uuid, uuid, uuid)',
    ]) {
      expect(compacto).toContain(`revoke execute on function ${f} from public, anon, authenticated`);
      expect(compacto).toContain(`grant execute on function ${f} to service_role`);
    }
  });
});

describe('1044 — a D17 decide no BANCO (E12)', () => {
  it('trava a conversa, nunca retoma botão/transferência (nem pausa sem motivo) e nunca toca o responsável', () => {
    const corpo = funcao('public.cb_atribuir_agente_de_ia');
    expect(corpo).toContain('for update');
    expect(corpo).toContain("c.ia_pausada_por is null or c.ia_pausada_por in ('botao', 'transferencia')");
    expect(corpo).toContain("interval '24 hours'");
    expect(corpo).not.toContain('assigned_agent_id');
  });
});

describe('1044 — pausa por gente', () => {
  it('o gatilho só dispara em resposta de gente GRAVADA de verdade (a carga da 1033 grava gravada_em nula)', () => {
    const gatilho = compacto.slice(compacto.indexOf('create trigger cb_pausa_ia_por_gente_trigger'));
    const when = gatilho.slice(0, gatilho.indexOf('execute function'));
    expect(when).toContain('after insert on messages');
    expect(when).toContain("new.sender_type = 'agent'");
    expect(when).toContain('new.sender_id is not null or new.from_device');
    expect(when).toContain('new.ia_agente_id is null');
    expect(when).toContain('new.gravada_em is not null');
  });

  it('só pausa conversa COM agente e ainda não pausada, e nunca o eco do próprio turno', () => {
    const corpo = funcao('cb_pausar_ia_por_gente');
    expect(corpo).toContain('c.ia_agente_id is not null');
    expect(corpo).toContain('not c.ai_autoreply_disabled');
    expect(corpo).toContain('c.group_id is null');
    expect(corpo).toContain('t.mensagem_enviada_id = new.message_id');
    expect(corpo).toContain("ia_pausada_por = 'gente'");
  });
});

describe('1044 — encerrar e arquivar', () => {
  it('encerrar limpa a IA só na TRANSIÇÃO, num BEFORE UPDATE OF status', () => {
    expect(compacto).toContain('before update of status on conversations');
    const corpo = funcao('cb_encerrar_limpa_ia');
    expect(corpo).toContain("new.status = 'closed' and old.status is distinct from 'closed'");
    for (const c of ['new.ia_agente_id := null', 'new.ai_autoreply_disabled := false', 'new.ia_pausada_por := null', 'new.ai_reply_count := 0']) {
      expect(corpo).toContain(c);
    }
  });

  it('arquivar tira o agente da entrada das conexões e das conversas', () => {
    const corpo = funcao('cb_ia_agente_arquivado_sai_das_passagens');
    expect(corpo).toContain('update cb_channels set ia_agente_entrada_id = null');
    expect(corpo).toContain('update conversations set ia_agente_id = null');
  });
});

describe('1044 — FKs compostas e colunas', () => {
  it('o agente ativo e a entrada da conexão: FK COMPOSTA com SET NULL por coluna (Codex, #292)', () => {
    expect(compacto).toMatch(
      /foreign key \(ia_agente_entrada_id, account_id\) references cb_ia_agentes \(id, account_id\) on delete set null \(ia_agente_entrada_id\)/,
    );
    expect(compacto).toMatch(
      /foreign key \(ia_agente_id, account_id\) references cb_ia_agentes \(id, account_id\) on delete set null \(ia_agente_id\)/,
    );
  });

  it('o motivo da pausa é um dos quatro', () => {
    expect(compacto).toContain("ia_pausada_por in ('gente', 'transferencia', 'botao', 'automacao')");
  });
});

describe('1044 — "respondido" e os gatilhos que a carga da 1033 cala PELO NOME', () => {
  it('só as FUNÇÕES são recriadas: nenhum gatilho da 972 é apagado ou renomeado', () => {
    for (const g of [
      'cb_marcar_aguardando_resposta_trigger',
      'cb_marcar_janela_da_meta_trigger',
      'cb_mensagem_apagada_recalcula_espera_trigger',
    ]) {
      expect(compacto).not.toContain(`drop trigger if exists ${g}`);
    }
  });

  it('a resposta do agente conta como "respondido" nas funções da 972', () => {
    expect(funcao('cb_marcar_aguardando_resposta')).toContain(
      "(new.sender_type = 'bot' and new.ia_agente_id is not null)",
    );
    expect(funcao('cb_mensagem_apagada_recalcula_espera')).toContain(
      "(h.sender_type = 'bot' and h.ia_agente_id is not null)",
    );
  });
});

describe('1044 — o contador de respostas fecha (E14)', () => {
  it('claim_ai_reply_slot: as duas metades do REVOKE e o GRANT ao service_role', () => {
    expect(compacto).toContain(
      'revoke execute on function public.claim_ai_reply_slot(uuid, integer) from public, anon, authenticated',
    );
    expect(compacto).toContain('grant execute on function public.claim_ai_reply_slot(uuid, integer) to service_role');
  });
});
