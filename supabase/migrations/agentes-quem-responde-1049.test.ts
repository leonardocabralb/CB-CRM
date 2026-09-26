import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1049 — quem responde (F2a dos agentes de IA). Os comportamentos foram
// provados num Postgres 16 descartável (rajada por conexão, trava por
// conversa, pausa por gente, D17, encerramento, arquivamento, banco vazio);
// estes pinos seguram a FORMA que os sustenta.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1049_cb_ia_quem_responde.sql'), 'utf8');
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

// Do `create or replace function` até o `as $$`: parâmetros e atributos.
function cabecalho(nome: string): string {
  const ini = compacto.indexOf(`create or replace function ${nome}`);
  expect(ini, nome).toBeGreaterThan(-1);
  return compacto.slice(ini, compacto.indexOf('as $$', ini));
}

describe('1049 — a fila de turnos', () => {
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
      'public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid, boolean)',
    ]) {
      expect(compacto).toContain(`revoke execute on function ${f} from public, anon, authenticated`);
      expect(compacto).toContain(`grant execute on function ${f} to service_role`);
    }
  });
});

describe('1049 — a D17 decide no BANCO (E12)', () => {
  it('trava a conversa, nunca retoma botão/transferência (nem pausa sem motivo) e nunca toca o responsável', () => {
    const corpo = funcao('public.cb_atribuir_agente_de_ia');
    expect(corpo).toContain('for update');
    expect(corpo).toContain("c.ia_pausada_por is null or c.ia_pausada_por in ('botao', 'transferencia')");
    // A pergunta das 24 h é UMA função, que o `set_ai` também usa (E13).
    expect(corpo).toContain('public.cb_ia_gente_respondeu_em_24h(p_conversation_id)');
    expect(corpo).not.toContain("interval '24 hours'");
    expect(corpo).not.toContain('assigned_agent_id');
  });

  it('a pergunta das 24 h: resposta de GENTE (sender_id ou celular, sem agente), pelo created_at', () => {
    const corpo = funcao('public.cb_ia_gente_respondeu_em_24h');
    expect(corpo).toContain('h.conversation_id = p_conversation_id');
    expect(corpo).toContain("h.sender_type = 'agent'");
    expect(corpo).toContain('h.sender_id is not null or h.from_device');
    expect(corpo).toContain('h.ia_agente_id is null');
    expect(corpo).toContain("h.created_at > now() - interval '24 hours'");
    // Apagada inclusive (a D17 conta a resposta que existiu).
    expect(corpo).not.toContain('deleted_at');
  });

  it('a reatribuição que não muda nada (o mesmo agente, sem pausa) não escreve: nem zera o teto nem avança a geração (E12)', () => {
    const corpo = funcao('public.cb_atribuir_agente_de_ia');
    const nadaMuda = corpo.indexOf(
      "if c.ia_agente_id = p_ia_agente_id and not c.ai_autoreply_disabled then return query select 'retomada'::text, null::text; return; end if;",
    );
    expect(nadaMuda).toBeGreaterThan(-1);
    // Depois da pergunta das 24 h (gente respondeu = pausa, mesmo agente)...
    expect(nadaMuda).toBeGreaterThan(corpo.indexOf("return query select 'pausada_gente'::text"));
    // ...e antes da ÚNICA escrita que retoma (e zera o teto).
    const retomada = corpo.lastIndexOf('update conversations');
    expect(nadaMuda).toBeLessThan(retomada);
  });

  it('relê o agente na EXECUÇÃO: arquivado ou desligado não é atribuído (Codex, #292)', () => {
    const corpo = funcao('public.cb_atribuir_agente_de_ia');
    expect(corpo).toMatch(/a\.arquivado_em is null and a\.ativo/);
    // E atende a conexão do disparo, quando ela vem (Codex, #292).
    expect(corpo).toContain('p_canal_id is null or p_canal_id = any (a.conexoes)');
  });
});

describe('1049 — a ENTRADA só atribui conversa SEM agente (5.3, regra 5; Codex, #292)', () => {
  it('o 5º parâmetro nasce falso: o passo da automação e a régua seguem trocando o agente', () => {
    expect(cabecalho('public.cb_atribuir_agente_de_ia')).toContain('p_so_se_vazio boolean default false');
  });

  it('sem overload: as assinaturas antigas saem antes do CREATE', () => {
    const drop = compacto.indexOf('drop function if exists public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid);');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(compacto.indexOf('create or replace function public.cb_atribuir_agente_de_ia'));
  });

  it('ocupada: pergunta com a conversa TRAVADA e sai antes de qualquer escrita', () => {
    const corpo = funcao('public.cb_atribuir_agente_de_ia');
    const trava = corpo.indexOf('for update');
    const ocupada = corpo.indexOf("if p_so_se_vazio and c.ia_agente_id is not null then return query select 'ocupada'::text, null::text; return;");
    expect(trava).toBeGreaterThan(-1);
    expect(ocupada).toBeGreaterThan(trava);
    expect(ocupada).toBeLessThan(corpo.indexOf('update conversations'));
  });

  it('a conferência chama a entrada numa conversa com agente e cobra `ocupada`', () => {
    const conferencia = compacto.slice(compacto.lastIndexOf('do $$'));
    expect(conferencia).toContain('public.cb_atribuir_agente_de_ia(v_conta_ia, v_conv_ia, v_agente, null, true)');
    expect(conferencia).toContain("if v_res <> 'ocupada' then");
  });
});

describe('1049 — o "ligar" do set_ai passa pela MESMA regra (E13)', () => {
  const corpo = () => funcao('public.cb_retomar_ia_por_automacao');

  it('trava a conversa DA CONTA antes de decidir', () => {
    expect(corpo()).toContain('where cv.id = p_conversation_id and cv.account_id = p_account_id for update');
    expect(corpo()).toContain("return 'sem_conversa'");
    expect(corpo()).toContain("return 'grupo'");
  });

  it('só retoma pausa por gente ou por automação, e só sem resposta de gente em 24 h', () => {
    const c = corpo();
    expect(c).toContain("c.ia_pausada_por is null or c.ia_pausada_por not in ('gente', 'automacao')");
    expect(c).toContain('public.cb_ia_gente_respondeu_em_24h(p_conversation_id)');
    // A ordem é a regra: botão/transferência, depois as 24 h, e só então retoma.
    const mantida = c.indexOf("return 'pausada_mantida'");
    const gente = c.indexOf("return 'pausada_gente'");
    const retomada = c.indexOf("return 'retomada'");
    expect(mantida).toBeGreaterThan(-1);
    expect(gente).toBeGreaterThan(mantida);
    expect(retomada).toBeGreaterThan(gente);
    expect(c.slice(gente, retomada)).toContain('ai_autoreply_disabled = false');
  });

  it('nunca toca o responsável humano nem o agente ativo', () => {
    expect(corpo()).not.toContain('assigned_agent_id');
    expect(corpo()).not.toContain('ia_agente_id');
  });

  it('só o service_role executa (as duas metades + o GRANT), e a conferência a CHAMA', () => {
    for (const f of ['public.cb_retomar_ia_por_automacao(uuid, uuid)', 'public.cb_ia_gente_respondeu_em_24h(uuid)']) {
      expect(compacto).toContain(`revoke execute on function ${f} from public, anon, authenticated`);
      expect(compacto).toContain(`grant execute on function ${f} to service_role`);
      expect(compacto).toContain(`'${f}'`);
    }
    const conferencia = compacto.slice(compacto.lastIndexOf('do $$'));
    const subbloco = conferencia.slice(conferencia.indexOf('set local role service_role'), conferencia.indexOf("exception when sqlstate 'p1049'"));
    expect(subbloco).toContain('public.cb_retomar_ia_por_automacao(');
  });
});

describe('1049 — as FKs que o Postgres não indexa', () => {
  it('as duas de mensagem e a do log de uso: índices PARCIAIS; a da conversa: índice cheio', () => {
    expect(compacto).toMatch(
      /cb_ia_turnos_mensagem_gatilho_idx on cb_ia_turnos \(mensagem_gatilho_id\) where mensagem_gatilho_id is not null/,
    );
    expect(compacto).toMatch(
      /cb_ia_turnos_mensagem_inicial_idx on cb_ia_turnos \(mensagem_inicial_id\) where mensagem_inicial_id is not null/,
    );
    expect(compacto).toMatch(/ai_usage_log_turno_idx on ai_usage_log \(turno_id\) where turno_id is not null/);
    expect(compacto).toMatch(/cb_ia_turnos_conversa_idx on cb_ia_turnos \(conversation_id\);/);
  });

  it('a da conexão: índice PARCIAL (apagar a conexão faz o SET NULL de canal_id)', () => {
    expect(compacto).toMatch(/cb_ia_turnos_canal_idx on cb_ia_turnos \(canal_id\) where canal_id is not null/);
  });

  it('a conferência cobra os cinco no catálogo', () => {
    for (const i of [
      'cb_ia_turnos_mensagem_gatilho_idx',
      'cb_ia_turnos_mensagem_inicial_idx',
      'cb_ia_turnos_conversa_idx',
      'cb_ia_turnos_canal_idx',
      'ai_usage_log_turno_idx',
    ]) {
      expect(compacto).toContain(`'public.${i}'`);
    }
  });
});

describe('1049 — pausa por gente', () => {
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

  it('decide SÓ pela GRAVAÇÃO (relógio do banco), sem janela nenhuma pelo created_at (Codex, #292)', () => {
    const corpo = funcao('cb_pausar_ia_por_gente');
    expect(corpo).toContain("new.gravada_em >= coalesce(c.ia_agente_desde, '-infinity'::timestamptz)");
    // O relógio do aparelho (created_at): um celular mais de um dia atrasado
    // não pausava pela janela de 24 h, e a IA falaria por cima do advogado.
    expect(corpo).not.toContain('new.created_at');
    expect(corpo).not.toContain('interval');
  });
});

describe('1049 — encerrar e arquivar', () => {
  it('encerrar limpa a IA só na TRANSIÇÃO, num BEFORE UPDATE OF status', () => {
    expect(compacto).toContain('before update of status on conversations');
    const corpo = funcao('cb_encerrar_limpa_ia');
    expect(corpo).toContain("new.status = 'closed' and old.status is distinct from 'closed'");
    for (const c of ['new.ia_agente_id := null', 'new.ai_autoreply_disabled := false', 'new.ia_pausada_por := null', 'new.ai_reply_count := 0']) {
      expect(corpo).toContain(c);
    }
  });

  it('encerrar DESCARTA os turnos aguardando E rodando da conversa (E11), dentro da transição', () => {
    const corpo = funcao('cb_encerrar_limpa_ia');
    const transicao = corpo.slice(corpo.indexOf("if new.status = 'closed'"), corpo.indexOf('end if;'));
    expect(transicao).toContain(
      "update cb_ia_turnos set status = 'descartado', erro = 'conversa encerrada', terminado_em = now(), updated_at = now()",
    );
    expect(transicao).toContain('where conversation_id = new.id and account_id = new.account_id');
    expect(transicao).toContain("and status in ('aguardando', 'rodando')");
    // Inclusive o que já começou a enviar: ao contrário da entrada, aqui a
    // transferência do `incerto` não serve a ninguém.
    expect(transicao).not.toContain('enviando_desde');
  });

  it('o gatilho do encerramento é SECURITY DEFINER: o operador encerra sob RLS e cb_ia_turnos é fechada', () => {
    const cab = cabecalho('cb_encerrar_limpa_ia');
    expect(cab).toContain('security definer');
    expect(cab).toContain("set search_path to 'public'");
    const conferencia = compacto.slice(compacto.lastIndexOf('do $$'));
    expect(conferencia).toContain("'public.cb_encerrar_limpa_ia()'::regprocedure");
  });

  it('arquivar tira o agente da entrada das conexões e das conversas', () => {
    const corpo = funcao('cb_ia_agente_arquivado_sai_das_passagens');
    expect(corpo).toContain('update cb_channels set ia_agente_entrada_id = null');
    expect(corpo).toContain('update conversations set ia_agente_id = null');
  });
});

describe('1049 — FKs compostas e colunas', () => {
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

describe('1049 — "respondido" e os gatilhos que a carga da 1033 cala PELO NOME', () => {
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

describe('1049 — a reserva do envio (Codex, #292)', () => {
  it('teto, pausa, mesmo agente e conversa aberta NUMA escrita, com a conta', () => {
    const corpo = funcao('public.cb_ia_reservar_envio');
    expect(corpo).toContain('set ai_reply_count = ai_reply_count + 1');
    expect(corpo).toContain('and account_id = p_account_id');
    expect(corpo).toContain('and ia_agente_id = p_ia_agente_id');
    expect(corpo).toContain('and not ai_autoreply_disabled');
    expect(corpo).toContain("and status <> 'closed'");
    expect(corpo).toContain('and ai_reply_count < p_max');
  });

  // A escrita condicional: do UPDATE até o `if found then return 'ok'`.
  const escrita = () => {
    const corpo = funcao('public.cb_ia_reservar_envio');
    const ini = corpo.indexOf('update conversations set ai_reply_count = ai_reply_count + 1');
    expect(ini).toBeGreaterThan(-1);
    return corpo.slice(ini, corpo.indexOf("if found then return 'ok'", ini));
  };

  it('na MESMA escrita: a MESMA geração da atribuição (E12); nula não confere', () => {
    expect(escrita()).toContain('and (p_ia_atribuicao is null or ia_atribuicao = p_ia_atribuicao)');
  });

  it('na MESMA escrita: o turno ainda RODANDO, desta conversa (outro caminho pode tê-lo descartado)', () => {
    expect(escrita()).toContain(
      "and exists ( select 1 from cb_ia_turnos r where r.id = p_turno_id and r.conversation_id = p_conversation_id and r.status = 'rodando' )",
    );
  });

  it('na MESMA escrita: a mensagem do turno nesta conversa, sem ter sido apagada nem EDITADA; nula não confere', () => {
    expect(escrita()).toContain(
      'and (p_gatilho_id is null or exists ( select 1 from messages g where g.id = p_gatilho_id and g.conversation_id = p_conversation_id and g.deleted_at is null and g.edited_at is null ))',
    );
  });

  it('na MESMA escrita: nenhum OUTRO turno pendente desta conversa NESTA conexão com mensagem viva e MAIS NOVA (5.7, E10)', () => {
    const e = escrita();
    const pendente = e.slice(e.indexOf('not exists ( select 1 from cb_ia_turnos t'));
    expect(pendente).toContain('join messages n on n.id = t.mensagem_gatilho_id where t.conversation_id = p_conversation_id');
    expect(pendente).toContain('t.canal_id is not distinct from p_canal_id');
    expect(pendente).toContain("t.status = 'aguardando'");
    expect(pendente).toContain('t.id is distinct from p_turno_id');
    // A mensagem do pendente apagada não conta; a mais antiga (ou do mesmo
    // instante) também não; sem o `gravada_em` de um dos lados, conta.
    expect(pendente).toContain('n.deleted_at is null');
    expect(pendente).toContain(
      'and (p_gatilho_gravada_em is null or n.gravada_em is null or n.gravada_em > p_gatilho_gravada_em)',
    );
  });

  it('na MESMA escrita: nenhuma saída do robô/automação NESTA conexão gravada depois do gatilho (E10 b)', () => {
    const e = escrita();
    expect(e).toContain('not exists ( select 1 from messages m where m.conversation_id = p_conversation_id');
    expect(e).toContain("m.sender_type = 'bot'");
    // A resposta do PRÓPRIO agente não conta; a apagada também não.
    expect(e).toContain('m.ia_agente_id is null');
    expect(e).toContain('m.deleted_at is null');
    expect(e).toContain('m.channel_id is not distinct from p_canal_id');
    // Pela GRAVAÇÃO (relógio do banco), nunca pelo created_at do aparelho.
    expect(e).toContain('m.gravada_em > p_gatilho_gravada_em');
    expect(e).not.toContain('m.created_at');
  });

  it('trava a linha ANTES da escrita (a mesma trava do UPDATE) e classifica na ordem do contrato', () => {
    const corpo = funcao('public.cb_ia_reservar_envio');
    const trava = corpo.indexOf('for no key update');
    expect(trava).toBeGreaterThan(-1);
    expect(trava).toBeLessThan(corpo.indexOf('update conversations'));
    const ordem = ['mudou', 'descartado', 'editada', 'pausada', 'mais_nova', 'robo_falou', 'teto'].map((r) =>
      corpo.indexOf(`return '${r}'`),
    );
    for (const i of ordem) expect(i).toBeGreaterThan(-1);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    // A classificação do `mudou` inclui a geração (a linha está travada).
    const classifica = corpo.slice(corpo.indexOf("if found then return 'ok'"));
    expect(classifica).toContain('(p_ia_atribuicao is not null and c.ia_atribuicao is distinct from p_ia_atribuicao)');
    // `teto` TRANSFERE para gente: só com o contador travado no teto, e a
    // prova que sumiu entre a escrita e a leitura nunca vira `teto`.
    expect(corpo).toContain("if c.ai_reply_count >= p_max then return 'teto'");
    const depoisDoTeto = corpo.slice(corpo.indexOf("return 'teto'") + "return 'teto'".length);
    expect(depoisDoTeto).not.toContain("'teto'");
    expect(depoisDoTeto).toContain("return 'mais_nova'");
  });

  it('sem overload: as assinaturas de 4 e de 7 argumentos saem antes do CREATE, e a nova não tem DEFAULT', () => {
    const criar = compacto.indexOf('create or replace function public.cb_ia_reservar_envio');
    for (const velha of [
      'drop function if exists public.cb_ia_reservar_envio(uuid, uuid, uuid, integer);',
      'drop function if exists public.cb_ia_reservar_envio(uuid, uuid, uuid, integer, uuid, uuid, timestamptz);',
    ]) {
      const drop = compacto.indexOf(velha);
      expect(drop, velha).toBeGreaterThan(-1);
      expect(drop).toBeLessThan(criar);
    }
    const cab = cabecalho('public.cb_ia_reservar_envio');
    expect(cab).toContain(
      'p_max integer, p_turno_id uuid, p_canal_id uuid, p_gatilho_gravada_em timestamptz, p_ia_atribuicao bigint, p_gatilho_id uuid )',
    );
    // Sem DEFAULT: quem chamar com os 7 de antes erra alto, em vez de reservar
    // sem conferir a geração e a mensagem.
    expect(cab).not.toContain('default');
    // E a conferência cobra no catálogo que sobrou UMA de cada.
    const conferencia = compacto.slice(compacto.lastIndexOf('do $$'));
    expect(conferencia).toContain("foreach f in array array['cb_ia_reservar_envio', 'cb_atribuir_agente_de_ia'] loop");
  });

  it('só o service_role executa (as duas metades + o GRANT de volta), e a conferência a CHAMA', () => {
    const f = 'public.cb_ia_reservar_envio(uuid, uuid, uuid, integer, uuid, uuid, timestamptz, bigint, uuid)';
    expect(compacto).toContain(`revoke execute on function ${f} from public, anon, authenticated;`);
    expect(compacto).toContain(`grant execute on function ${f} to service_role;`);
    expect(compacto).toContain(`'${f}'`);
    const conferencia = compacto.slice(compacto.lastIndexOf('do $$'));
    const subbloco = conferencia.slice(
      conferencia.indexOf('set local role service_role'),
      conferencia.indexOf("exception when sqlstate 'p1049'"),
    );
    // O pendente de mensagem mais nova recusa; o do mesmo instante, não; a
    // geração velha é `mudou`; o turno que não roda é `descartado`.
    expect(subbloco).toContain(
      "public.cb_ia_reservar_envio(v_conta_ia, v_conv_ia, v_agente, 2147483647, v_rod, null, v_msg_gravada - interval '1 second', v_ger, v_msg)",
    );
    expect(subbloco).toContain("if v_res <> 'mais_nova' then");
    expect(subbloco).toContain(
      'public.cb_ia_reservar_envio(v_conta_ia, v_conv_ia, v_agente, 2147483647, v_rod, null, v_msg_gravada, v_ger - 1, v_msg)',
    );
    expect(subbloco).toContain("if v_res <> 'mudou' then");
    expect(subbloco).toContain(
      'public.cb_ia_reservar_envio(v_conta_ia, v_conv_ia, v_agente, 2147483647, v_t1, null, v_msg_gravada, v_ger, v_msg)',
    );
    expect(subbloco).toContain("if v_res <> 'descartado' then");
    // E o encerramento dentro do subbloco: descarta os turnos e avança a geração.
    expect(subbloco).toContain("update conversations set status = 'closed' where id = v_conv_ia");
    expect(subbloco).toContain('<> v_ger + 1');
  });
});

describe('1049 — a GERAÇÃO da atribuição (E12)', () => {
  it('coluna bigint NOT NULL DEFAULT 0 em conversations', () => {
    expect(compacto).toContain('alter table conversations add column if not exists ia_atribuicao bigint not null default 0');
  });

  it('avança ao trocar o agente (inclusive para nulo), ao retomar a pausa e ao zerar o teto; senão mantém a de antes', () => {
    const corpo = funcao('cb_ia_avanca_geracao_da_atribuicao');
    expect(corpo).toContain(
      'if new.ia_agente_id is distinct from old.ia_agente_id or (old.ai_autoreply_disabled and not new.ai_autoreply_disabled) or (old.ai_reply_count > 0 and new.ai_reply_count = 0) then new.ia_atribuicao := old.ia_atribuicao + 1;',
    );
    // Só o banco escreve a geração: um UPDATE que a mande é desfeito.
    expect(corpo).toContain('else new.ia_atribuicao := old.ia_atribuicao;');
  });

  const gatilho = () => {
    const ini = compacto.indexOf('create trigger cb_ia_geracao_da_atribuicao_trigger');
    expect(ini).toBeGreaterThan(-1);
    return compacto.slice(ini, compacto.indexOf('execute function', ini));
  };

  it('BEFORE UPDATE SEM lista de colunas: o encerramento zera o agente com só `status` no SET', () => {
    expect(gatilho()).toContain('before update on conversations for each row');
    expect(gatilho()).not.toContain('update of');
  });

  it('o WHEN cobre as três mudanças e a escrita da própria geração', () => {
    const g = gatilho();
    expect(g).toContain('new.ia_agente_id is distinct from old.ia_agente_id');
    expect(g).toContain('(old.ai_autoreply_disabled and not new.ai_autoreply_disabled)');
    expect(g).toContain('(old.ai_reply_count > 0 and new.ai_reply_count = 0)');
    expect(g).toContain('new.ia_atribuicao is distinct from old.ia_atribuicao');
  });

  it('dispara DEPOIS do gatilho do encerramento (o Postgres dispara os BEFORE em ordem alfabética do nome)', () => {
    // Comparação de bytes, como o tipo `name` (collation "C").
    expect(Buffer.compare(Buffer.from('cb_encerrar_limpa_ia_trigger'), Buffer.from('cb_ia_geracao_da_atribuicao_trigger'))).toBe(-1);
    // E a conferência cobra no catálogo: nenhum BEFORE UPDATE que escreva o
    // agente, a pausa ou o teto em NEW vem depois dele.
    const conferencia = compacto.slice(compacto.lastIndexOf('do $$'));
    expect(conferencia).toContain("t.tgname > 'cb_ia_geracao_da_atribuicao_trigger'::name");
    expect(conferencia).toContain("p.prosrc ~* 'new\\.(ia_agente_id|ai_autoreply_disabled|ai_reply_count)\\s*:?='");
    expect(conferencia).toContain('coalesce(array_length(t.tgattr::int2[], 1), 0) = 0');
  });

  it('a função do gatilho não é RPC (as duas metades) e a conferência a confere', () => {
    expect(compacto).toContain(
      'revoke execute on function cb_ia_avanca_geracao_da_atribuicao() from public, anon, authenticated',
    );
    expect(compacto).toContain("'public.cb_ia_avanca_geracao_da_atribuicao()'");
  });
});

describe('1049 — conexão apagada descarta os pendentes dela', () => {
  it('gatilho BEFORE DELETE em cb_channels: roda antes do SET NULL da FK', () => {
    expect(compacto).toContain(
      'create trigger cb_channels_descarta_turnos_de_ia before delete on cb_channels for each row execute function cb_ia_descartar_turnos_da_conexao()',
    );
  });

  it('só os `aguardando` daquela conexão viram `descartado`, com o motivo e a hora', () => {
    const corpo = funcao('cb_ia_descartar_turnos_da_conexao');
    expect(corpo).toContain("set status = 'descartado'");
    expect(corpo).toContain("erro = 'conexão apagada'");
    expect(corpo).toContain('terminado_em = now()');
    expect(corpo).toContain('where canal_id = old.id');
    expect(corpo).toContain("and status = 'aguardando'");
    expect(corpo).toContain('return old');
  });

  it('SECURITY DEFINER com search_path, e fechada ao navegador (as duas metades)', () => {
    const cab = cabecalho('cb_ia_descartar_turnos_da_conexao');
    expect(cab).toContain('security definer');
    expect(cab).toContain("set search_path to 'public'");
    expect(compacto).toContain(
      'revoke execute on function cb_ia_descartar_turnos_da_conexao() from public, anon, authenticated',
    );
    expect(compacto).toContain("'public.cb_ia_descartar_turnos_da_conexao()'");
  });
});

describe('1049 — o contador de respostas fecha (E14)', () => {
  it('claim_ai_reply_slot: as duas metades do REVOKE e o GRANT ao service_role', () => {
    expect(compacto).toContain(
      'revoke execute on function public.claim_ai_reply_slot(uuid, integer) from public, anon, authenticated',
    );
    expect(compacto).toContain('grant execute on function public.claim_ai_reply_slot(uuid, integer) to service_role');
  });
});
