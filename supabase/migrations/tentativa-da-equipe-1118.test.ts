import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1118 — a tentativa da EQUIPE que não saiu (31/10/2026, `agent` + o
// `sender_id` de quem tentou + `nao_saiu`) não pausa a IA nem para a
// retomada. Estes pinos seguram a FORMA; a prova num Postgres descartável
// com as restrições reais está na descrição do PR.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1118_cb_tentativa_da_equipe_nao_e_resposta.sql';
const sql = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8');
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

/** A ÚLTIMA definição de `cb_ia_reservar_envio` antes desta (a vigente que ela recria). */
function reservaAnterior(): string {
  const anteriores = fs
    .readdirSync(DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < ARQUIVO)
    .sort();
  let vigente: string | null = null;
  for (const f of anteriores) {
    const texto = fs
      .readFileSync(path.join(DIR, f), 'utf8')
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    const i = texto.indexOf('create or replace function public.cb_ia_reservar_envio(');
    if (i >= 0) vigente = texto.slice(i, texto.indexOf('$$;', texto.indexOf('as $$', i)));
  }
  expect(vigente).not.toBeNull();
  return vigente!;
}

/** O texto de uma migration sem comentários, num espaço só e minúsculo. */
function compactar(texto: string): string {
  return texto
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * A ÚLTIMA definição em TODAS as migrations — a que vale hoje, inclusive
 * depois desta. É ela que um porte futuro pode estragar recriando o corpo de
 * uma versão antiga (o acidente que esta migration conta).
 */
function vigente(abre: RegExp, fim: (texto: string, i: number) => number): string {
  let corpo: string | null = null;
  for (const f of fs.readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const texto = compactar(fs.readFileSync(path.join(DIR, f), 'utf8'));
    let ultima = -1;
    for (const m of texto.matchAll(new RegExp(abre.source, 'g'))) ultima = m.index ?? -1;
    if (ultima >= 0) corpo = texto.slice(ultima, fim(texto, ultima));
  }
  expect(corpo).not.toBeNull();
  return corpo!;
}

describe('1118 — o que vale HOJE (a última definição, em qualquer migration)', () => {
  it('a reserva: o ramo da EQUIPE conta só o que saiu', () => {
    // Só o RAMO: o `not m.nao_saiu` em outro lugar da função (o corpo da
    // 1080 o tem e não filtra este ramo) não prova nada.
    const corpo = vigente(/create or replace function public\.cb_ia_reservar_envio\(/, (t, i) =>
      t.indexOf('$$;', t.indexOf('as $$', i)),
    );
    const fimDoRamo = corpo.indexOf("return 'equipe_respondeu'");
    const ramo = corpo.slice(corpo.lastIndexOf('if exists', fimDoRamo), fimDoRamo);
    expect(fimDoRamo).toBeGreaterThan(-1);
    expect(ramo).toContain("m.sender_type = 'agent'");
    expect(ramo).toContain('and not m.nao_saiu');
  });

  it('o gatilho da pausa por gente ignora a tentativa que não saiu', () => {
    const corpo = vigente(/create (or replace )?trigger cb_pausa_ia_por_gente_trigger /, (t, i) =>
      t.indexOf(';', i),
    );
    expect(corpo).toContain('(not new.nao_saiu)');
  });
});

describe('1118 — a pausa por gente', () => {
  const i = compacto.indexOf('create or replace trigger cb_pausa_ia_por_gente_trigger');
  const gatilho = compacto.slice(i, compacto.indexOf(';', i));

  it('recria o gatilho com o MESMO nome (a carga da 1033 e a Lixeira o calam pelo nome)', () => {
    expect(i).toBeGreaterThan(-1);
    expect(gatilho).toContain('after insert on public.messages for each row');
    expect(gatilho).toContain('execute function public.cb_pausar_ia_por_gente()');
  });

  it('a tentativa que NÃO saiu não pausa', () => {
    expect(gatilho).toContain('(not new.nao_saiu)');
  });

  it('o resto da régua da 1049 continua de pé', () => {
    expect(gatilho).toContain("(new.sender_type = 'agent'::text)");
    expect(gatilho).toContain('((new.sender_id is not null) or new.from_device)');
    expect(gatilho).toContain('(new.ia_agente_id is null)');
    expect(gatilho).toContain('(new.gravada_em is not null)');
  });

  it('mantém o WHEN do sinal da Lixeira, na grafia que o pino da 1097 procura', () => {
    // `lixeira-1097.test.ts` (b) compara este texto exato, sem baixar a caixa.
    expect(semComentarios).toContain("nullif(current_setting('cb.lixeira', true), '') IS NULL");
  });
});

describe('1118 — a reserva do envio do agente', () => {
  it('"a equipe respondeu" conta só o que saiu', () => {
    expect(corpo('cb_ia_reservar_envio')).toContain(
      "and m.sender_type = 'agent' and not m.nao_saiu and m.gravada_em > v_gatilho",
    );
  });

  it('o resto do corpo é o VIGENTE (o da última migration que a definiu), só com a cerca nova', () => {
    const novo = corpo('cb_ia_reservar_envio').replace(' and not m.nao_saiu and m.gravada_em > v_gatilho ) then return \'equipe_respondeu\'', ' and m.gravada_em > v_gatilho ) then return \'equipe_respondeu\'');
    expect(novo).toBe(reservaAnterior());
  });

  it('continua fechada ao navegador e aberta ao service_role', () => {
    expect(compacto).toContain(
      'revoke execute on function public.cb_ia_reservar_envio(uuid, timestamptz) from public, anon, authenticated;',
    );
    expect(compacto).toContain('grant execute on function public.cb_ia_reservar_envio(uuid, timestamptz) to service_role;');
  });
});

describe('1118 — a conferência', () => {
  it('a escolha da conversa vem ANTES do gatilho, por configuração LOCAL (nunca tabela temporária)', () => {
    const escolha = compacto.indexOf("set_config('cb1118.conv'");
    const gatilho = compacto.indexOf('create or replace trigger');
    expect(compacto.indexOf("set local lock_timeout = '5s';")).toBeLessThan(escolha);
    expect(escolha).toBeLessThan(gatilho);
    expect(compacto).not.toContain('create temp');
  });

  it('a âncora é a mensagem MAIS NOVA, apagadas incluídas, e tem de estar viva (a reserva conta a apagada)', () => {
    const passo0 = compacto.slice(0, compacto.indexOf("set_config('cb1118.conv'"));
    expect(passo0).toContain(
      'select m.deleted_at from messages m where m.conversation_id = cv.id and m.gravada_em is not null order by m.gravada_em desc, m.id desc limit 1) u where u.deleted_at is null',
    );
    const i = compacto.indexOf("set_config('cb1118.ultima'");
    const ultima = compacto.slice(i, compacto.indexOf('true);', i));
    expect(ultima).not.toContain('deleted_at');
  });

  it('a retomada só é exercitada quando a reserva diz `ok` ANTES da tentativa; senão, NOTICE', () => {
    const antes = compacto.indexOf('v_antes := public.cb_ia_reservar_envio(v_turno, v_desde);');
    expect(antes).toBeGreaterThan(-1);
    expect(antes).toBeLessThan(compacto.indexOf('a tentativa da equipe que não saiu pausou a ia'));
    expect(compacto).toContain("if v_antes = 'ok' then");
    expect(compacto).toContain("raise notice '1118: a reserva já respondia % antes da tentativa");
  });

  it('o comentário da coluna fala do robô E da equipe', () => {
    expect(compacto).toMatch(/comment on column messages\.nao_saiu is '[^']*robô \(1080\) ou da equipe \(1118\)/);
  });

  it('exercita num subbloco desfeito por SQLSTATE PRÓPRIO, nunca WHEN OTHERS', () => {
    expect(compacto).toContain("raise exception using errcode = 'p1118';");
    expect(compacto).toContain("exception when sqlstate 'p1118' then null;");
    expect(compacto).not.toContain('when others');
  });

  it('prova os quatro lados: a que não saiu não pausa nem para; a que saiu pausa e para', () => {
    expect(compacto).toContain('a tentativa da equipe que não saiu pausou a ia');
    expect(compacto).toContain('a tentativa da equipe que não saiu parou a retomada');
    expect(compacto).toContain("v_res <> 'equipe_respondeu'");
    expect(compacto).toContain('a resposta da equipe que saiu não pausou a ia');
  });

  it('o turno da conferência é de RETOMADA com tentativa/tentativas (o CHECK do tipo, 1056)', () => {
    const i = compacto.indexOf('insert into cb_ia_turnos');
    const insert = compacto.slice(i, compacto.indexOf(';', i));
    expect(insert).toContain("'retomada', 1, 1");
  });

  it('confere o gatilho pela forma que o Postgres RENDERIZA (a mesma da conferência da Lixeira)', () => {
    expect(sql).toContain("position('NOT new.nao_saiu' IN v_def)");
    expect(sql).toContain(
      "position('NULLIF(current_setting(''cb.lixeira''::text, true), ''''::text) IS NULL' IN v_def)",
    );
  });
});
