import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MOTIVOS_DE_TRANSFERENCIA } from '../../src/lib/ia-agentes/textos-do-servidor';

// ============================================================
// 1110 — o turno do agente de IA sobrevive à conversa apagada e à Lixeira
// (C1 da central dos agentes; DC1–DC3 do operador, 26/10/2026). A
// conferência da própria migration prova o banco quando ela é APLICADA; este
// pino avisa no PR, lendo os `.sql`, o que uma migration posterior (ou outra
// branch que refaça a Lixeira) desfaria em silêncio:
//
// (a) a FK da conversa é SET NULL (conversation_id), criada NOT VALID e
//     validada, com a trava e o teto ANTES da primeira ALTER;
// (b) o gatilho do turno vivo: BEFORE UPDATE OF conversation_id, o WHEN do
//     turno vivo, o ramo `incerto` de quem já enviava;
// (c) o inventário VIGENTE da Lixeira (a última `cb_lixeira_tratamento` do
//     replay): o turno fora do fecho, sem `ai_usage_log.turno_id`, com a
//     conversa dele reapontada e o gatilho em `livres`;
// (d) a exclusão definitiva VIGENTE limpa o conteúdo FORA do `IF p_pedido`
//     (DC3);
// (e) as portas das duas funções novas (e a do gatilho);
// (f) o predicado da poda e o do índice parcial são o MESMO;
// (g) os CHECKs: `motivo` = `MOTIVOS_DE_TRANSFERENCIA`, e o `detalhe` que é
//     código e que o código grava não é apagado pela limpeza;
// (h) a conferência chama as funções e o gatilho num subbloco desfeito por
//     P1110, sem WHEN OTHERS, e roda `cb_lixeira_conferir_gatilhos`.
//
// LIMITE DECLARADO: lê os `.sql`. A premissa "a ação da FK dispara o gatilho
// BEFORE UPDATE da filha" é PROVADA pela conferência (DELETE de duas
// conversas fictícias) quando a migration roda com dado, e no Postgres
// descartável antes de aplicar.
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1110_cb_ia_turnos_sobrevivem_a_conversa.sql';
const NUMERO = 1110;

const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, '');
const SQL = semComentarios(fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8'));

const MIGRATIONS = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((arquivo) => ({
    arquivo,
    numero: Number(arquivo.slice(0, 4)),
    sql: semComentarios(fs.readFileSync(path.join(DIR, arquivo), 'utf8')),
  }));

/** O texto de uma função: do CREATE até o `$$` que fecha. */
function corpoDaFuncao(sql: string, nome: string): string | null {
  const inicio = sql.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${nome}\\s*\\(`, 'i'));
  if (inicio < 0) return null;
  const resto = sql.slice(inicio);
  const abre = resto.indexOf('$$');
  return resto.slice(0, resto.indexOf('$$', abre + 2) + 2);
}

/** A definição VIGENTE de uma função: a da ÚLTIMA migration do replay que a cria. */
function vigente(nome: string): { arquivo: string; corpo: string } {
  let achada: { arquivo: string; corpo: string } | null = null;
  for (const m of MIGRATIONS) {
    const corpo = corpoDaFuncao(m.sql, nome);
    if (corpo) achada = { arquivo: m.arquivo, corpo };
  }
  expect(achada, `${nome} sumiu do replay`).not.toBeNull();
  return achada!;
}

const compacto = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('1110 — (a) a FK da conversa', () => {
  it('conversation_id aceita nulo e a FK é recriada SET NULL (conversation_id), NOT VALID e validada', () => {
    const c = compacto(SQL);
    expect(c).toContain('ALTER TABLE public.cb_ia_turnos ALTER COLUMN conversation_id DROP NOT NULL;');
    expect(c).toContain('ALTER TABLE public.cb_ia_turnos DROP CONSTRAINT IF EXISTS cb_ia_turnos_conversa_fkey;');
    expect(c).toContain(
      'ALTER TABLE public.cb_ia_turnos ADD CONSTRAINT cb_ia_turnos_conversa_fkey FOREIGN KEY (conversation_id, account_id) REFERENCES public.conversations (id, account_id) ON DELETE SET NULL (conversation_id) NOT VALID;',
    );
    expect(c).toContain('ALTER TABLE public.cb_ia_turnos VALIDATE CONSTRAINT cb_ia_turnos_conversa_fkey;');
    // Nada mais CASCADE do turno para a conversa.
    expect(SQL).not.toMatch(/REFERENCES\s+public\.conversations[^;]*ON\s+DELETE\s+CASCADE/i);
  });

  it('teto da espera e as travas (a conversa, depois o turno) ANTES da primeira ALTER', () => {
    const primeiraAlter = SQL.search(/ALTER\s+TABLE/i);
    const teto = SQL.search(/SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'/i);
    const trava = SQL.search(/LOCK\s+TABLE\s+public\.conversations\s+IN\s+ACCESS\s+EXCLUSIVE\s+MODE/i);
    const travaDoTurno = SQL.search(/LOCK\s+TABLE\s+public\.cb_ia_turnos\s+IN\s+ACCESS\s+EXCLUSIVE\s+MODE/i);
    expect(teto).toBeGreaterThanOrEqual(0);
    expect(teto).toBeLessThan(trava);
    expect(trava).toBeLessThan(travaDoTurno);
    expect(travaDoTurno).toBeLessThan(primeiraAlter);
  });

  it('a conferência confere a FK pelo catálogo (confdeltype, a coluna anulada, validada)', () => {
    expect(SQL).toContain("v_fk.confdeltype IS DISTINCT FROM 'n'");
    expect(SQL).toContain("v_fk.anula IS DISTINCT FROM ARRAY['conversation_id']");
    expect(SQL).toContain('NOT v_fk.convalidated');
  });
});

describe('1110 — (b) o gatilho do turno vivo', () => {
  const gatilho = () => {
    const m = SQL.match(/CREATE\s+TRIGGER\s+cb_ia_turnos_conversa_apagada_trigger\b([^;]*);/i);
    expect(m).not.toBeNull();
    return compacto(m![1]);
  };

  it('BEFORE UPDATE OF conversation_id, por linha, só quando a conversa VIRA nula com o turno vivo', () => {
    expect(gatilho()).toBe(
      "BEFORE UPDATE OF conversation_id ON public.cb_ia_turnos FOR EACH ROW WHEN (OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS NULL AND NEW.status IN ('aguardando', 'rodando')) EXECUTE FUNCTION public.cb_ia_turno_conversa_apagada()",
    );
  });

  it('o que já enviava vira `incerto`; o resto, `descartado`; com o erro do vocabulário do banco e o fim carimbado', () => {
    const f = compacto(corpoDaFuncao(SQL, 'cb_ia_turno_conversa_apagada')!);
    expect(f).toContain(
      "NEW.status := CASE WHEN NEW.status = 'rodando' AND NEW.enviando_desde IS NOT NULL THEN 'incerto' ELSE 'descartado' END;",
    );
    expect(f).toContain("NEW.erro := 'conversa apagada';");
    expect(f).toContain('NEW.terminado_em := now();');
    expect(f).toContain('RETURN NEW;');
    // Só mexe no NEW: nada de SECURITY DEFINER, nada de escrever em tabela.
    expect(f).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(f).not.toMatch(/\b(UPDATE|INSERT|DELETE)\s+(INTO\s+|FROM\s+)?\w+/i);
  });
});

describe('1110 — (c) o inventário VIGENTE da Lixeira', () => {
  const tratamento = () => vigente('cb_lixeira_tratamento');

  it('é o desta migration ou de uma posterior (refazer a Lixeira sem o turno durável reprova aqui)', () => {
    expect(tratamento().arquivo >= ARQUIVO).toBe(true);
  });

  it('o turno fora do fecho, sem o ponteiro do uso pelo turno, com a conversa do turno reapontada', () => {
    const corpo = tratamento().corpo;
    const fecho = corpo.slice(corpo.indexOf("'fecho'"), corpo.indexOf("'ordem'"));
    expect(fecho).not.toContain("'cb_ia_turnos'");
    const ponteiros = corpo.slice(corpo.indexOf("'ponteiros'"), corpo.indexOf("'extras'"));
    expect(ponteiros).not.toContain("'ai_usage_log.turno_id'");
    expect(compacto(ponteiros)).toContain("'cb_ia_turnos.conversation_id', 'reaponta'");
    // As mensagens do turno continuam reapontadas (eram da 1097).
    expect(compacto(ponteiros)).toContain("'cb_ia_turnos.mensagem_inicial_id', 'reaponta'");
    expect(compacto(ponteiros)).toContain("'cb_ia_turnos.mensagem_gatilho_id', 'reaponta'");
  });

  it('o gatilho novo está em `livres` (o mover precisa dele; a volta só grava conversa não nula)', () => {
    const corpo = tratamento().corpo;
    const livres = corpo.slice(corpo.indexOf("'livres'"));
    const calados = corpo.slice(corpo.indexOf("'calados'"), corpo.indexOf("'livres'"));
    expect(livres).toContain("'cb_ia_turnos.cb_ia_turnos_conversa_apagada_trigger'");
    expect(calados).not.toContain('cb_ia_turnos');
  });

  it('nada do inventário da 1102 se perdeu: toda entrada dela continua, menos as duas que o turno durável tira', () => {
    const daMigration = (arquivo: string) =>
      new Set(
        [...corpoDaFuncao(MIGRATIONS.find((m) => m.arquivo === arquivo)!.sql, 'cb_lixeira_tratamento')!.matchAll(/'([\w.,]+)'/g)].map(
          (m) => m[1],
        ),
      );
    const antes = daMigration('1102_cb_anotacao_com_anexos.sql');
    const agora = daMigration(ARQUIVO);
    const sumiram = [...antes].filter((x) => !agora.has(x)).sort();
    expect(sumiram).toEqual(['ai_usage_log.turno_id', 'cb_ia_turnos']);
    const novas = [...agora].filter((x) => !antes.has(x)).sort();
    expect(novas).toEqual(['cb_ia_turnos.cb_ia_turnos_conversa_apagada_trigger', 'cb_ia_turnos.conversation_id']);
  });
});

describe('1110 — (d) a exclusão definitiva VIGENTE limpa o conteúdo, FORA do IF p_pedido', () => {
  it('a última cb_lixeira_purgar_um chama a limpeza com `exclusao` antes do `IF p_pedido`', () => {
    const { arquivo, corpo } = vigente('cb_lixeira_purgar_um');
    expect(arquivo >= ARQUIVO).toBe(true);
    const c = compacto(corpo);
    const chamada = c.indexOf("PERFORM cb_ia_turno_sem_conteudo(v_ids, 'exclusao');");
    expect(chamada).toBeGreaterThan(-1);
    expect(chamada).toBeLessThan(c.indexOf('IF p_pedido THEN'));
    // Os ids são os turnos anotados nos ponteiros do item.
    expect(c).toContain("WHERE p ->> 'tabela' = 'cb_ia_turnos'");
    // Uma chamada só.
    expect(c.split('cb_ia_turno_sem_conteudo(').length - 1).toBe(1);
  });

  it('nada do corpo da 1097 se perdeu: a 1110 é a da 1097 + as três linhas da limpeza', () => {
    const da1097 = compacto(corpoDaFuncao(MIGRATIONS.find((m) => m.numero === 1097)!.sql, 'cb_lixeira_purgar_um')!);
    const daqui = compacto(corpoDaFuncao(SQL, 'cb_lixeira_purgar_um')!);
    const limpeza =
      "v_ids := ARRAY(SELECT DISTINCT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p, jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'cb_ia_turnos'); PERFORM cb_ia_turno_sem_conteudo(v_ids, 'exclusao'); ";
    expect(daqui.replace(limpeza, '')).toBe(da1097);
  });
});

describe('1110 — (e) as portas', () => {
  const revoga = (assinatura: string) =>
    new RegExp(
      `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${assinatura.replace(/[()[\]]/g, '\\$&')}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated\\s*;`,
      'i',
    ).test(SQL);
  const concedidas = (assinatura: string) =>
    [
      ...SQL.matchAll(
        new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${assinatura.replace(/[()[\]]/g, '\\$&')}\\s+TO\\s+([^;]+);`, 'gi'),
      ),
    ].flatMap((m) => m[1].split(',').map((p) => p.trim().toLowerCase()));

  it('a limpeza é interna: revogada das três, sem GRANT a ninguém', () => {
    expect(revoga('cb_ia_turno_sem_conteudo(uuid[], text)')).toBe(true);
    expect(concedidas('cb_ia_turno_sem_conteudo(uuid[], text)')).toEqual([]);
  });

  it('a poda: revogada das três e concedida de volta SÓ ao service_role; roda como dono', () => {
    expect(revoga('cb_ia_podar_conteudo_dos_turnos(integer, integer)')).toBe(true);
    expect(concedidas('cb_ia_podar_conteudo_dos_turnos(integer, integer)')).toEqual(['service_role']);
    const cab = corpoDaFuncao(SQL, 'cb_ia_podar_conteudo_dos_turnos')!;
    expect(cab.slice(0, cab.indexOf('$$'))).toMatch(/SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*public/i);
  });

  it('a função do gatilho não é RPC; as peças da Lixeira continuam fechadas', () => {
    expect(revoga('cb_ia_turno_conversa_apagada()')).toBe(true);
    expect(revoga('cb_lixeira_tratamento()')).toBe(true);
    expect(revoga('cb_lixeira_purgar_um(uuid, boolean)')).toBe(true);
    expect(concedidas('cb_lixeira_purgar_um(uuid, boolean)')).toEqual([]);
    expect(concedidas('cb_lixeira_tratamento()')).toEqual([]);
  });

  it('DEFAULT-DENY: migration posterior não abre a limpeza nem a poda ao navegador', () => {
    const fora: string[] = [];
    for (const m of MIGRATIONS.filter((x) => x.numero > NUMERO)) {
      for (const f of ['cb_ia_turno_sem_conteudo', 'cb_ia_podar_conteudo_dos_turnos']) {
        for (const g of m.sql.matchAll(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${f}\\b[^;]*TO\\s+([^;]+);`, 'gi'))) {
          if (/\b(anon|authenticated|public)\b/i.test(g[1])) fora.push(`${f} → ${g[1]} (${m.arquivo})`);
        }
      }
    }
    expect(fora).toEqual([]);
  });
});

describe('1110 — (f) a poda e o índice parcial: o MESMO predicado', () => {
  it('o índice (created_at) WHERE conteudo_removido_em IS NULL é o que a poda filtra e ordena', () => {
    const indice = compacto(SQL.match(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+cb_ia_turnos_conteudo_a_podar_idx\b([^;]*);/i)![1]);
    const m = indice.match(/^ON public\.cb_ia_turnos \((\w+)\) WHERE (.+)$/);
    expect(m, indice).not.toBeNull();
    const [, coluna, predicado] = m!;
    expect(coluna).toBe('created_at');
    expect(predicado).toBe('conteudo_removido_em IS NULL');

    const poda = compacto(corpoDaFuncao(SQL, 'cb_ia_podar_conteudo_dos_turnos')!);
    expect(poda).toContain(`WHERE t.${predicado}`);
    expect(poda).toContain(`AND t.${coluna} < now() - make_interval(days => p_dias)`);
    expect(poda).toContain(`ORDER BY t.${coluna}`);
    // O turno vivo nunca: ele ainda vai escrever o próprio retrato.
    expect(poda).toContain("AND t.status NOT IN ('aguardando', 'rodando')");
    expect(poda).toContain("cb_ia_turno_sem_conteudo(v_ids, 'prazo')");
    expect(poda).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('o índice da conta para o Registro', () => {
    expect(compacto(SQL)).toContain(
      'CREATE INDEX IF NOT EXISTS cb_ia_turnos_conta_criado_idx ON public.cb_ia_turnos (account_id, created_at DESC);',
    );
  });
});

describe('1110 — (g) os CHECKs e a limpeza', () => {
  it('o CHECK do motivo é EXATAMENTE a lista MOTIVOS_DE_TRANSFERENCIA (nula também vale)', () => {
    const check = compacto(SQL.match(/ADD\s+CONSTRAINT\s+cb_ia_turnos_motivo_check\s+CHECK\s*\(([\s\S]*?)\)\s*\)\s*;/i)![1]);
    expect(check.startsWith('motivo IS NULL OR motivo IN (')).toBe(true);
    const lista = [...check.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(lista).toEqual([...MOTIVOS_DE_TRANSFERENCIA]);
  });

  it('o CHECK de conteudo_removido_por: prazo ou exclusao', () => {
    expect(compacto(SQL)).toContain(
      "ADD CONSTRAINT cb_ia_turnos_conteudo_removido_por_check CHECK ( conteudo_removido_por IS NULL OR conteudo_removido_por IN ('prazo', 'exclusao'));",
    );
  });

  it('as colunas novas: só nascem (o app ainda não grava motivo, esperou_horario, saida_bruta nem erro_detalhe)', () => {
    const c = compacto(SQL);
    for (const col of [
      'saida_bruta text',
      'erro_detalhe text',
      'motivo text',
      'esperou_horario boolean NOT NULL DEFAULT false',
      'conteudo_removido_em timestamptz',
      'conteudo_removido_por text',
    ]) {
      expect(c, col).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it('a limpeza zera o conteúdo, tira o valor e o detalhe cru, corta o erro antigo e carimba UMA vez', () => {
    const f = compacto(corpoDaFuncao(SQL, 'cb_ia_turno_sem_conteudo')!);
    for (const s of [
      'SET contexto = NULL',
      'saida_bruta = NULL',
      'erro_detalhe = NULL',
      "erro = CASE WHEN position(':' IN t.erro) > 0 THEN split_part(t.erro, ':', 1) ELSE t.erro END",
      "THEN e.a - 'valor'",
      "ELSE e.a - 'valor' - 'detalhe'",
      "WHERE jsonb_typeof(e.a) = 'object'",
      'conteudo_removido_em = now()',
      'conteudo_removido_por = p_por',
      'WHERE t.id = ANY (p_ids) AND t.conteudo_removido_em IS NULL',
    ]) {
      expect(f, s).toContain(s);
    }
    // Recusa o motivo fora da lista (o CHECK não pegaria a chamada sem linhas).
    expect(f).toContain("IF p_por IS NULL OR p_por NOT IN ('prazo', 'exclusao') THEN");
  });

  it("DEFAULT-DENY: todo `detalhe: '<código>'` que o motor grava é poupado pela limpeza", () => {
    const f = corpoDaFuncao(SQL, 'cb_ia_turno_sem_conteudo')!;
    const poupados = [...f.match(/e\.a\s*->>\s*'detalhe'\s+IN\s*\(([^)]*)\)/i)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    const motor = path.join(DIR, '..', '..', 'src', 'lib', 'ia-agentes');
    const gravados = new Set<string>();
    for (const arquivo of fs.readdirSync(motor).filter((a) => a.endsWith('.ts') && !a.includes('.test.'))) {
      const fonte = fs.readFileSync(path.join(motor, arquivo), 'utf8');
      for (const m of fonte.matchAll(/\bdetalhe:\s*'(\w+)'/g)) gravados.add(m[1]);
    }
    // O leitor acha o que interessa.
    expect([...gravados].sort()).toEqual(expect.arrayContaining(['ja_estava', 'nome_sem_origem', 'sem_marcador']));
    expect([...gravados].filter((g) => !poupados.includes(g))).toEqual([]);
  });
});

describe('1110 — (h) a conferência', () => {
  const ultimaConferencia = () => SQL.slice(SQL.lastIndexOf('DO $$'));

  it('chama as duas funções e apaga conversas fictícias num subbloco desfeito por P1110, sem WHEN OTHERS', () => {
    const c = ultimaConferencia();
    expect(c).toMatch(/public\.cb_ia_turno_sem_conteudo\(/);
    expect(c).toMatch(/public\.cb_ia_podar_conteudo_dos_turnos\(/);
    expect(c).toMatch(/DELETE\s+FROM\s+public\.conversations\s+WHERE\s+id\s+IN\s*\(v_conversa_a,\s*v_conversa_b\)/i);
    // A poda pelo caminho do servidor.
    expect(c).toMatch(/SET\s+LOCAL\s+ROLE\s+service_role;\s*v_n\s*:=\s*public\.cb_ia_podar_conteudo_dos_turnos\(/i);
    expect(c).toMatch(/RAISE\s+EXCEPTION\s+USING\s+ERRCODE\s*=\s*'P1110'/);
    expect(c).toMatch(/WHEN\s+SQLSTATE\s+'P1110'\s+THEN/);
    // Banco vazio pula com NOTICE, nunca reprova por falta de dado.
    expect(c).toMatch(/IF\s+v_conta\s+IS\s+NULL\s+THEN[\s\S]*RAISE\s+NOTICE/i);
    expect(SQL).not.toMatch(/WHEN\s+OTHERS/i);
  });

  it('a conferência do catálogo roda a dos gatilhos da Lixeira', () => {
    expect(SQL).toMatch(/PERFORM\s+public\.cb_lixeira_conferir_gatilhos\(\)\s*;/);
  });

  it('a única DML depois da primeira ALTER é a da conferência, em fichas e conversas fictícias', () => {
    const depois = SQL.slice(SQL.search(/ALTER\s+TABLE/i));
    const insercoes = [...depois.matchAll(/INSERT\s+INTO\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect([...new Set(insercoes)].sort()).toEqual(['cb_ia_turnos', 'contacts', 'conversations']);
    expect(depois.match(/DELETE\s+FROM\s+public\.\w+/gi)).toEqual(['DELETE FROM public.conversations']);
    expect(depois).not.toMatch(/UPDATE\s+public\.\w+\s+SET/i);
    // Nada que mexa na Lixeira de verdade (a ida e volta é do descartável).
    expect(depois).not.toMatch(/public\.cb_(mover_contatos_para_lixeira|restaurar_da_lixeira|excluir_da_lixeira|vencer_lixeira)\s*\(/i);
  });
});
