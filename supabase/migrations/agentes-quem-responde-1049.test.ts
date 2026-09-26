import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1049 — quem responde (F2 SIMPLIFICADA dos agentes de IA: o agente atua nas
// ETAPAS do funil, D24–D27). Os comportamentos foram provados num Postgres 16
// descartável com dados (ativado_em, uma etapa um agente, arquivar, etapa_desde,
// pausa por gente, encerrar, a fila e a passagem, cada motivo da reserva, a RLS
// das etapas) e no replay de todas as migrations num banco vazio; estes pinos
// seguram a FORMA que os sustenta.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1049_cb_ia_quem_responde.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');
const compacto = semComentarios.replace(/\s+/g, ' ').toLowerCase();
const cabecalhoDoArquivo = sql.slice(0, sql.indexOf('SET LOCAL lock_timeout'));

function funcao(nome: string): string {
  const ini = compacto.indexOf(`create or replace function ${nome}`);
  expect(ini, nome).toBeGreaterThan(-1);
  const abre = compacto.indexOf('as $$', ini);
  const fecha = compacto.indexOf('$$;', abre + 5);
  return compacto.slice(abre, fecha);
}

// Do `create or replace function` até o `as $$`: parâmetros e atributos.
function cabecalho(nome: string): string {
  const ini = compacto.indexOf(`create or replace function ${nome}`);
  expect(ini, nome).toBeGreaterThan(-1);
  return compacto.slice(ini, compacto.indexOf('as $$', ini));
}

function gatilho(nome: string): string {
  const ini = compacto.indexOf(`create trigger ${nome}`);
  expect(ini, nome).toBeGreaterThan(-1);
  return compacto.slice(ini, compacto.indexOf(';', ini));
}

const conferencia = () => compacto.slice(compacto.lastIndexOf('do $$'));
const subblocoDaConferencia = () => {
  const c = conferencia();
  return c.slice(c.indexOf('set local role service_role'), c.indexOf("exception when sqlstate 'p1049'"));
};

describe('1049 — o desenho antigo (entrada por conexão, atribuição, geração) não nasce', () => {
  it('nenhum objeto da versão anterior (nunca aplicada)', () => {
    for (const velho of [
      'ia_agente_entrada',
      'ia_atribuicao',
      'ia_agente_desde',
      'cb_atribuir_agente_de_ia',
      'cb_retomar_ia_por_automacao',
      'cb_ia_gente_respondeu_em_24h',
      'cb_ia_avanca_geracao_da_atribuicao',
      'cb_carimba_entrada_de_ia',
    ]) {
      expect(compacto, velho).not.toContain(velho);
    }
  });

  it('a trava de lock vem antes da primeira alteração', () => {
    expect(compacto.indexOf("set local lock_timeout = '5s'")).toBeGreaterThan(-1);
    expect(compacto.indexOf("set local lock_timeout = '5s'")).toBeLessThan(compacto.indexOf('alter table'));
  });

  it('o cabeçalho do arquivo escreve o contrato: as três RPCs e todo motivo da reserva', () => {
    expect(cabecalhoDoArquivo).toContain('cb_ia_enfileirar_turno(');
    expect(cabecalhoDoArquivo).toContain('cb_ia_reivindicar_turno(p_turno_id uuid) RETURNS SETOF cb_ia_turnos');
    expect(cabecalhoDoArquivo).toContain('cb_ia_reservar_envio(p_turno_id uuid, p_rodando_desde timestamptz)');
    for (const motivo of [
      'descartado',
      'encerrada',
      'pausada',
      'card_mudou',
      'card_fechado',
      'agente_desligado',
      'fora_da_conexao',
      'agente_sem_etapa',
      'mais_nova',
      'robo_falou',
      'teto',
    ]) {
      expect(cabecalhoDoArquivo, motivo).toContain(`'${motivo}'`);
    }
  });
});

describe('1049 — D27: quando o agente foi LIGADO', () => {
  it('coluna, gatilho BEFORE INSERT OR UPDATE OF ativo, e carimba só ao ligar', () => {
    expect(compacto).toContain('alter table cb_ia_agentes add column if not exists ativado_em timestamptz');
    expect(gatilho('cb_ia_agentes_carimba_ativado_em')).toContain(
      'before insert or update of ativo on cb_ia_agentes for each row execute function cb_ia_carimba_ativado_em()',
    );
    expect(funcao('cb_ia_carimba_ativado_em')).toContain(
      "if new.ativo and (tg_op = 'insert' or not old.ativo) then new.ativado_em := now(); end if;",
    );
  });

  it('acervo: o agente já ligado conta de agora', () => {
    expect(compacto).toContain('update cb_ia_agentes set ativado_em = now() where ativo and ativado_em is null');
  });
});

describe('1049 — D24: as ETAPAS de cada agente', () => {
  it('a etapa é a CHAVE (uma etapa, um agente) e some com a etapa', () => {
    expect(compacto).toContain(
      'stage_id uuid primary key references pipeline_stages (id) on delete cascade',
    );
    expect(compacto).toContain('desde timestamptz not null default now()');
  });

  it('o agente é da MESMA conta (FK composta) e leva as linhas junto', () => {
    expect(compacto).toContain(
      'foreign key (ia_agente_id, account_id) references cb_ia_agentes (id, account_id) on delete cascade',
    );
    expect(compacto).toMatch(/cb_ia_agente_etapas_agente_idx on cb_ia_agente_etapas \(account_id, ia_agente_id\)/);
  });

  it('só ADMINISTRADOR lê (forma da 1032), e só o serviço escreve', () => {
    expect(compacto).toContain('alter table cb_ia_agente_etapas enable row level security');
    expect(compacto).toContain(
      "create policy cb_ia_agente_etapas_select on cb_ia_agente_etapas for select using (account_id = any (array(select public.cb_contas_do_usuario('admin'::public.account_role_enum))))",
    );
    // Nenhuma policy de escrita.
    expect(compacto).not.toMatch(/create policy[^;]*on cb_ia_agente_etapas for (insert|update|delete|all)/);
    expect(compacto).toContain('revoke all on table cb_ia_agente_etapas from public, anon, authenticated');
    expect(compacto).toContain('grant select on table cb_ia_agente_etapas to authenticated');
    expect(compacto).toContain('grant all on table cb_ia_agente_etapas to service_role');
  });

  it('arquivar o agente APAGA as etapas dele (na transição), além de tirá-lo das passagens', () => {
    const corpo = funcao('cb_ia_agente_arquivado_sai_das_passagens');
    const transicao = corpo.slice(corpo.indexOf('if old.arquivado_em is null and new.arquivado_em is not null'));
    expect(transicao).toContain('pode_passar_para = array_remove(pode_passar_para, new.id)');
    expect(transicao).toContain(
      'delete from cb_ia_agente_etapas where account_id = new.account_id and ia_agente_id = new.id',
    );
  });
});

describe('1049 — D27: quando o card ENTROU na etapa', () => {
  it('coluna NOT NULL DEFAULT now() (todo card existente = a hora da migration)', () => {
    expect(compacto).toContain('alter table deals add column if not exists etapa_desde timestamptz not null default now()');
  });

  it('carimbada SÓ quando a etapa muda, num BEFORE UPDATE OF stage_id', () => {
    expect(gatilho('cb_deals_carimba_etapa_desde_trigger')).toContain(
      'before update of stage_id on deals for each row execute function cb_deals_carimba_etapa_desde()',
    );
    expect(funcao('cb_deals_carimba_etapa_desde')).toContain(
      'if new.stage_id is distinct from old.stage_id then new.etapa_desde := now(); end if;',
    );
  });
});

describe('1049 — a IA na conversa', () => {
  it('as quatro colunas, o motivo da pausa entre os quatro, e o último agente numa FK COMPOSTA', () => {
    for (const col of ['ia_agente_id uuid', 'ia_pausada_por text', 'ia_pausada_em timestamptz', 'ia_retomada_em timestamptz']) {
      expect(compacto).toContain(`alter table conversations add column if not exists ${col}`);
    }
    expect(compacto).toContain("ia_pausada_por in ('gente', 'botao', 'transferencia', 'automacao')");
    expect(compacto).toMatch(
      /foreign key \(ia_agente_id, account_id\) references cb_ia_agentes \(id, account_id\) on delete set null \(ia_agente_id\)/,
    );
  });

  it('messages.ia_agente_id com FK SET NULL', () => {
    expect(compacto).toContain('alter table messages add column if not exists ia_agente_id uuid');
    expect(compacto).toContain('foreign key (ia_agente_id) references cb_ia_agentes (id) on delete set null');
  });
});

describe('1049 — D26: pausa por GENTE', () => {
  it('o gatilho só dispara em resposta de gente GRAVADA de verdade (a carga da 1033 grava gravada_em nula)', () => {
    const g = gatilho('cb_pausa_ia_por_gente_trigger');
    expect(g).toContain('after insert on messages');
    expect(g).toContain("new.sender_type = 'agent'");
    expect(g).toContain('new.sender_id is not null or new.from_device');
    expect(g).toContain('new.ia_agente_id is null');
    expect(g).toContain('new.gravada_em is not null');
  });

  it('com a IA atuando (último agente OU turno vivo), no território de um agente OU sem card; 1:1, sem pausa, nunca o eco do turno', () => {
    const corpo = funcao('cb_pausar_ia_por_gente');
    expect(corpo).toContain(
      "and (c.ia_agente_id is not null or exists ( select 1 from cb_ia_turnos v where v.conversation_id = new.conversation_id and v.status in ('aguardando', 'rodando') )",
    );
    // A equipe que ABRE a conversa (o card nasce depois da mensagem) e a que fala
    // com o card na etapa de um agente pausam (revisão da F2, 26/09/2026).
    expect(corpo).toContain(
      "or not exists ( select 1 from deals d where d.contact_id = c.contact_id and d.account_id = c.account_id and d.status = 'open' )",
    );
    expect(corpo).toContain(
      "or exists ( select 1 from deals d join cb_ia_agente_etapas e on e.stage_id = d.stage_id where d.contact_id = c.contact_id and d.account_id = c.account_id and d.status = 'open' ))",
    );
    expect(corpo).toContain('c.group_id is null');
    expect(corpo).toContain('not c.ai_autoreply_disabled');
    expect(corpo).toContain('t.mensagem_enviada_id = new.message_id');
    expect(corpo).toContain("ia_pausada_por = 'gente'");
    // Sem janela pelo relógio do aparelho.
    expect(corpo).not.toContain('created_at');
    expect(cabecalho('cb_pausar_ia_por_gente')).toContain('security definer');
  });
});

describe('1049 — encerrar limpa a IA (E11)', () => {
  it('BEFORE UPDATE OF status, só na TRANSIÇÃO: último agente e pausa saem, e o teto recomeça', () => {
    expect(gatilho('cb_encerrar_limpa_ia_trigger')).toContain('before update of status on conversations');
    const corpo = funcao('cb_encerrar_limpa_ia');
    expect(corpo).toContain("new.status = 'closed' and old.status is distinct from 'closed'");
    for (const c of [
      'new.ia_agente_id := null',
      'new.ai_autoreply_disabled := false',
      'new.ia_pausada_por := null',
      'new.ia_pausada_em := null',
    ]) {
      expect(corpo).toContain(c);
    }
    // O teto recomeça no encerramento (conta desde greatest(etapa_desde, ia_retomada_em)).
    expect(corpo).toContain('new.ia_retomada_em := now()');
  });

  it('e descarta os turnos aguardando e rodando da conversa, como SECURITY DEFINER', () => {
    const corpo = funcao('cb_encerrar_limpa_ia');
    expect(corpo).toContain(
      "update cb_ia_turnos set status = 'descartado', erro = 'conversa encerrada', terminado_em = now(), updated_at = now() where conversation_id = new.id and account_id = new.account_id and status in ('aguardando', 'rodando')",
    );
    expect(cabecalho('cb_encerrar_limpa_ia')).toContain('security definer');
  });
});

describe('1049 — a fila de turnos', () => {
  it('fechada ao navegador: RLS, nenhuma policy, as duas metades do REVOKE', () => {
    expect(compacto).toContain('alter table cb_ia_turnos enable row level security');
    expect(compacto).toContain('revoke all on table cb_ia_turnos from public, anon, authenticated');
    expect(compacto).not.toMatch(/create policy[^;]*on cb_ia_turnos/);
    expect(compacto).toContain('grant all on table cb_ia_turnos to service_role');
  });

  it('o card, a etapa e a passagem no turno; `passou` no CHECK', () => {
    expect(compacto).toContain('deal_id uuid, stage_id uuid,');
    expect(compacto).toContain('veio_de_passagem boolean not null default false');
    const check = compacto.slice(compacto.indexOf("status text not null default 'aguardando' check"));
    expect(check.slice(0, check.indexOf('))'))).toContain("'passou'");
  });

  it('pendente POR CONEXÃO e um só RODANDO por conversa', () => {
    expect(compacto).toMatch(
      /cb_ia_turnos_um_aguardando_idx on cb_ia_turnos \(conversation_id, canal_id\) nulls not distinct where status = 'aguardando'/,
    );
    expect(compacto).toMatch(/cb_ia_turnos_um_rodando_idx on cb_ia_turnos \(conversation_id\) where status = 'rodando'/);
  });

  it('enfileirar: a assinatura do contrato (a passagem com DEFAULT falso)', () => {
    expect(cabecalho('public.cb_ia_enfileirar_turno')).toContain(
      'p_account_id uuid, p_conversation_id uuid, p_canal_id uuid, p_ia_agente_id uuid, p_deal_id uuid, p_stage_id uuid, p_mensagem_id uuid, p_espera_ms integer, p_veio_de_passagem boolean default false ) returns table (id uuid, executar_apos timestamptz)',
    );
  });

  it('a rajada troca o gatilho, o agente, o card e a etapa; a PASSAGEM não troca o gatilho e não passa de novo', () => {
    const corpo = funcao('public.cb_ia_enfileirar_turno');
    expect(corpo).toContain("on conflict (conversation_id, canal_id) where status = 'aguardando'");
    const conflito = corpo.slice(corpo.indexOf('do update set'));
    expect(conflito).toContain(
      'mensagem_gatilho_id = case when excluded.veio_de_passagem then t.mensagem_gatilho_id else excluded.mensagem_gatilho_id end',
    );
    expect(conflito).toContain('veio_de_passagem = t.veio_de_passagem or excluded.veio_de_passagem');
    for (const c of ['ia_agente_id = excluded.ia_agente_id', 'deal_id = excluded.deal_id', 'stage_id = excluded.stage_id']) {
      expect(conflito).toContain(c);
    }
    // A PRIMEIRA mensagem da rajada fica.
    expect(conflito).not.toContain('mensagem_inicial_id');
    expect(corpo).toContain('now() + make_interval');
  });

  it('reivindicar com o 23505 do RODANDO virando "ocupado", nunca erro', () => {
    const corpo = funcao('public.cb_ia_reivindicar_turno');
    expect(corpo).toContain("status = 'aguardando'");
    expect(corpo).toContain('executar_apos <= now()');
    expect(corpo).toContain('exception when unique_violation then return');
  });

  it('conexão apagada descarta os pendentes dela antes do SET NULL', () => {
    expect(compacto).toContain(
      'create trigger cb_channels_descarta_turnos_de_ia before delete on cb_channels for each row execute function cb_ia_descartar_turnos_da_conexao()',
    );
    expect(funcao('cb_ia_descartar_turnos_da_conexao')).toContain("where canal_id = old.id and account_id = old.account_id and status = 'aguardando'");
    expect(cabecalho('cb_ia_descartar_turnos_da_conexao')).toContain('security definer');
  });

  it('as FKs que o Postgres não indexa ganham índice', () => {
    for (const i of [
      /cb_ia_turnos_mensagem_gatilho_idx on cb_ia_turnos \(mensagem_gatilho_id\) where mensagem_gatilho_id is not null/,
      /cb_ia_turnos_mensagem_inicial_idx on cb_ia_turnos \(mensagem_inicial_id\) where mensagem_inicial_id is not null/,
      /cb_ia_turnos_conversa_idx on cb_ia_turnos \(conversation_id\);/,
      /cb_ia_turnos_canal_idx on cb_ia_turnos \(canal_id\) where canal_id is not null/,
      /ai_usage_log_turno_idx on ai_usage_log \(turno_id\) where turno_id is not null/,
    ]) {
      expect(compacto).toMatch(i);
    }
  });
});

describe('1049 — a RESERVA do envio', () => {
  const corpo = () => funcao('public.cb_ia_reservar_envio');

  it('só a posse: dois parâmetros, sem DEFAULT; o resto sai da linha do turno', () => {
    const cab = cabecalho('public.cb_ia_reservar_envio');
    expect(cab).toContain('( p_turno_id uuid, p_rodando_desde timestamptz ) returns text');
    expect(cab).not.toContain('default');
    expect(corpo()).toContain(
      "if not found or t.status <> 'rodando' or t.rodando_desde is distinct from p_rodando_desde then return 'descartado'",
    );
  });

  it('não escreve nada, e trava a conversa ANTES de decidir a pausa', () => {
    const c = corpo();
    expect(c).not.toMatch(/\bupdate\s+\w+\s+set\b|\binsert\s+into\b|\bdelete\s+from\b/);
    const trava = c.indexOf('for no key update');
    expect(trava).toBeGreaterThan(-1);
    expect(trava).toBeLessThan(c.indexOf("return 'encerrada'"));
  });

  it('os motivos, NESTA ordem', () => {
    const c = corpo();
    const ordem = [
      'descartado',
      'encerrada',
      'pausada',
      'card_mudou',
      'card_fechado',
      'agente_desligado',
      'fora_da_conexao',
      'agente_sem_etapa',
      'mais_nova',
      'robo_falou',
      'teto',
      'ok',
    ].map((r) => c.indexOf(`return '${r}'`));
    for (const i of ordem) expect(i).toBeGreaterThan(-1);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it('o card: ainda ABERTO e na etapa do turno', () => {
    const c = corpo();
    expect(c).toContain('where dl.id = t.deal_id and dl.account_id = t.account_id');
    expect(c).toContain("if not found or d.stage_id is distinct from t.stage_id then return 'card_mudou'");
    expect(c).toContain("if d.status is distinct from 'open' then return 'card_fechado'");
  });

  it('o agente: ligado, não arquivado, com a conexão, e ainda DONO da etapa', () => {
    const c = corpo();
    expect(c).toContain("if not found or not a.ativo or a.arquivado_em is not null then return 'agente_desligado'");
    expect(c).toContain("if t.canal_id is null or not (t.canal_id = any (a.conexoes)) then return 'fora_da_conexao'");
    expect(c).toContain(
      "select 1 from cb_ia_agente_etapas e where e.stage_id = t.stage_id and e.ia_agente_id = t.ia_agente_id and e.account_id = t.account_id ) then return 'agente_sem_etapa'",
    );
  });

  it('mais_nova: OUTRO turno pendente nesta conversa e conexão, com a mensagem viva e mais nova', () => {
    const c = corpo();
    const bloco = c.slice(c.indexOf('select 1 from cb_ia_turnos p'), c.indexOf("return 'mais_nova'"));
    expect(bloco).toContain('join messages n on n.id = p.mensagem_gatilho_id');
    expect(bloco).toContain('p.conversation_id = t.conversation_id');
    expect(bloco).toContain('p.canal_id is not distinct from t.canal_id');
    expect(bloco).toContain("p.status = 'aguardando'");
    expect(bloco).toContain('p.id <> t.id');
    expect(bloco).toContain('n.deleted_at is null');
    expect(bloco).toContain('(v_gatilho is null or n.gravada_em is null or n.gravada_em > v_gatilho)');
  });

  it('robo_falou: `bot` SEM ia_agente_id, não apagado, NESTA conexão, gravado depois do gatilho', () => {
    const c = corpo();
    const bloco = c.slice(c.indexOf('select 1 from messages m'), c.indexOf("return 'robo_falou'"));
    expect(bloco).toContain("m.sender_type = 'bot'");
    expect(bloco).toContain('m.ia_agente_id is null');
    expect(bloco).toContain('m.deleted_at is null');
    expect(bloco).toContain('m.channel_id is not distinct from t.canal_id');
    expect(bloco).toContain('m.gravada_em > v_gatilho');
    expect(bloco).not.toContain('created_at');
  });

  it('teto: as respostas DESTE agente desde a entrada na etapa ou a retomada, o maior dos dois', () => {
    const c = corpo();
    const bloco = c.slice(c.indexOf('select count(*) into v_contadas'), c.indexOf("return 'teto'"));
    expect(bloco).toContain('m.conversation_id = t.conversation_id');
    expect(bloco).toContain('m.ia_agente_id = t.ia_agente_id');
    expect(bloco).toContain('m.gravada_em > greatest(d.etapa_desde, c.ia_retomada_em)');
    expect(bloco).toContain('v_contadas >= a.teto_respostas');
    // O contador do assistente anterior não decide mais nada.
    expect(c).not.toContain('ai_reply_count');
  });
});

describe('1049 — privilégios e a conferência', () => {
  const rpcs = [
    'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)',
    'public.cb_ia_reivindicar_turno(uuid)',
    'public.cb_ia_reservar_envio(uuid, timestamptz)',
    'public.claim_ai_reply_slot(uuid, integer)',
  ];

  it('as RPCs são só do service_role (as duas metades + o GRANT de volta), e a conferência confere', () => {
    for (const f of rpcs) {
      expect(compacto).toContain(`revoke execute on function ${f} from public, anon, authenticated`);
      expect(compacto).toContain(`grant execute on function ${f} to service_role`);
      expect(conferencia()).toContain(`'${f}'`);
    }
  });

  it('as funções de gatilho não são RPC (as duas metades)', () => {
    for (const f of [
      'cb_ia_carimba_ativado_em()',
      'cb_deals_carimba_etapa_desde()',
      'cb_pausar_ia_por_gente()',
      'cb_encerrar_limpa_ia()',
      'cb_ia_descartar_turnos_da_conexao()',
      'cb_ia_agente_arquivado_sai_das_passagens()',
    ]) {
      expect(compacto).toContain(`revoke execute on function ${f} from public, anon, authenticated`);
      expect(conferencia()).toContain(`'public.${f}'`);
    }
  });

  it('a conferência CHAMA as RPCs num subbloco desfeito por SQLSTATE próprio, e a reserva vai até o `ok`', () => {
    const s = subblocoDaConferencia();
    expect(conferencia()).toContain("raise exception using errcode = 'p1049'");
    expect(s).toContain('public.cb_ia_reivindicar_turno(');
    expect(s).toContain('public.cb_ia_enfileirar_turno(');
    expect(s).toContain('v_res := public.cb_ia_reservar_envio(v_rod, v_desde);');
    expect(s).toContain("if v_res <> 'ok' then");
    // Banco vazio pula com NOTICE, nunca reprova por falta de dado.
    expect(s).toContain('raise notice');
  });
});

describe('1049 — "respondido" (D11) e os gatilhos que a carga da 1033 cala PELO NOME', () => {
  it('só as FUNÇÕES são recriadas: nenhum gatilho da 972 é apagado ou renomeado', () => {
    for (const g of [
      'cb_marcar_aguardando_resposta_trigger',
      'cb_marcar_janela_da_meta_trigger',
      'cb_mensagem_apagada_recalcula_espera_trigger',
    ]) {
      expect(compacto).not.toContain(`drop trigger if exists ${g}`);
    }
  });

  it('a resposta do agente conta como "respondido" nas três funções', () => {
    expect(funcao('cb_marcar_aguardando_resposta')).toContain("(new.sender_type = 'bot' and new.ia_agente_id is not null)");
    expect(funcao('cb_mensagem_apagada_recalcula_espera')).toContain("(h.sender_type = 'bot' and h.ia_agente_id is not null)");
    expect(funcao('public.cb_assentar_mensagem_historica')).toContain("(h.sender_type = 'bot' and h.ia_agente_id is not null)");
  });
});

describe('1049 — índice dos cards abertos por contato', () => {
  it('a entrada do motor e a pausa por gente perguntam por contato a cada mensagem', () => {
    expect(compacto).toContain(
      "create index if not exists cb_deals_contato_aberto_idx on deals (contact_id) where status = 'open'",
    );
  });
});
