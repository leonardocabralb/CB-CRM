import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { VOLTA_APOS_MIN_PADRAO } from '../../src/lib/ia-agentes/pausa'

// ============================================================
// 1146 — o follow-up da IA atravessa o ENCERRAMENTO (decisão do operador de
// 14/11/2026: a equipe pergunta e encerra para limpar a caixa; o follow-up
// sai com a conversa encerrada, e a resposta da cliente a reabre).
//
// O que estes pinos seguram:
//  - encerrar continua limpando agente, pausa e teto, e descartando a
//    resposta; a exceção é SÓ da retomada, SÓ com a pausa que ela atravessa
//    (nenhuma, ou a `gente` com N > 0) e SÓ com o card dela aberto na etapa do
//    agente ligado (a pré-armação, pelo card do contato);
//  - a reserva deixa SÓ a retomada passar pela encerrada; o resto do corpo é
//    o vigente (o da 1134);
//  - o resto do corpo de encerrar é o da 1130 (1109/1130 intactas);
//  - a 1146 é a definição VIGENTE das duas;
//  - a conferência CHAMA as duas num subbloco desfeito por SQLSTATE próprio;
//  - o TS: só a retomada declara `atravessaEncerrada`; a resposta não.
//
// LIMITE DECLARADO: lê o `.sql` e o fonte. O comportamento se prova no
// replay do CI (banco vazio: só o catálogo) e num Postgres descartável com
// dados antes de aplicar (na descrição do PR).
// ============================================================

const DIR = __dirname
const ARQUIVO = '1146_cb_ia_follow_up_depois_de_encerrar.sql'
const compactar = (texto: string) =>
  texto
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase()
const sql = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8')
const compacto = compactar(sql)
const fonte = (relativo: string) => fs.readFileSync(path.join(DIR, '..', '..', 'src', relativo), 'utf8')

/** Do `create or replace function <nome>(` até o `$$;` que fecha o corpo. */
function corpo(texto: string, nome: string): string | null {
  const ini = texto.indexOf(`create or replace function ${nome}(`)
  if (ini < 0) return null
  return texto.slice(ini, texto.indexOf('$$;', texto.indexOf('as $$', ini)))
}

/** A ÚLTIMA definição de `nome` nas migrations ANTES desta (a vigente que ela recria). */
function anterior(nome: string): string {
  let vigente: string | null = null
  for (const f of fs.readdirSync(DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < ARQUIVO).sort()) {
    vigente = corpo(compactar(fs.readFileSync(path.join(DIR, f), 'utf8')), nome) ?? vigente
  }
  expect(vigente, nome).not.toBeNull()
  return vigente!
}

const RESERVA = 'public.cb_ia_reservar_envio'
const ENCERRAR = 'cb_encerrar_limpa_ia'
const reserva = corpo(compacto, RESERVA)!
const encerrar = corpo(compacto, ENCERRAR)!

const RECUSA_NOVA = "if not found or (c.status = 'closed' and t.tipo <> 'retomada') then return 'encerrada';"
const RECUSA_DE_ANTES = "if not found or c.status = 'closed' then return 'encerrada';"

const LEITURA_DO_N =
  "v_segue := coalesce((select a.ia_volta_apos_min from ai_configs a where a.account_id = new.account_id and a.channel_id is null limit 1), 15) > 0;"

describe('1146 — a reserva deixa a RETOMADA sair com a conversa encerrada', () => {
  it('só a retomada passa pela encerrada; a resposta continua `encerrada`', () => {
    expect(reserva).not.toBeNull()
    expect(reserva).toContain(RECUSA_NOVA)
  })

  it('o resto do corpo é o VIGENTE (o da última migration que a definiu), só com a exceção nova', () => {
    expect(reserva.replace(RECUSA_NOVA, RECUSA_DE_ANTES)).toBe(anterior(RESERVA))
  })

  it('continua fechada ao navegador e aberta ao service_role', () => {
    expect(compacto).toContain('revoke execute on function public.cb_ia_reservar_envio(uuid, timestamptz) from public, anon, authenticated;')
    expect(compacto).toContain('grant execute on function public.cb_ia_reservar_envio(uuid, timestamptz) to service_role;')
    expect(compacto).toContain('grant select on table cb_lead_events to service_role;')
  })
})

describe('1146 — encerrar mantém a RETOMADA que seguiria', () => {
  it('⚠️ pesa a pausa de ANTES (que o encerramento apaga): só nenhuma, ou a `gente` com N > 0', () => {
    expect(encerrar).toContain('v_segue := not old.ai_autoreply_disabled;')
    expect(encerrar).toContain(`if old.ai_autoreply_disabled and old.ia_pausada_por = 'gente' then ${LEITURA_DO_N} end if;`)
    // O N lido como a pré-armação da 1138 o lê, com o MESMO padrão do TS.
    expect(compactar(fs.readFileSync(path.join(DIR, '1138_cb_ia_pausa_temporaria.sql'), 'utf8'))).toContain(
      "coalesce((select a.ia_volta_apos_min from ai_configs a where a.account_id = c.account_id and a.channel_id is null limit 1), 15)",
    )
    expect(VOLTA_APOS_MIN_PADRAO).toBe(15)
  })

  it('⚠️ a exceção é só da RETOMADA, com a pausa que ela atravessa e o card na etapa do agente ligado', () => {
    for (const trecho of [
      "and not ( v_segue and cb_ia_turnos.tipo = 'retomada' and exists ( select 1 from deals d",
      'join cb_ia_agente_etapas e on e.stage_id = d.stage_id and e.account_id = d.account_id',
      'join cb_ia_agentes ag on ag.id = e.ia_agente_id and ag.account_id = d.account_id',
      "where d.account_id = new.account_id and d.status = 'open' and ag.ativo and ag.arquivado_em is null",
      'and cb_ia_turnos.canal_id = any (ag.conexoes)',
      "and coalesce(ag.retomada -> 'ativa' = 'true'::jsonb, false)",
      // A pré-armação (sem agente): o card do contato; a resolvida: o MESMO card, etapa e agente.
      'when cb_ia_turnos.ia_agente_id is null then d.contact_id = new.contact_id',
      'else d.id = cb_ia_turnos.deal_id and d.stage_id = cb_ia_turnos.stage_id and ag.id = cb_ia_turnos.ia_agente_id end',
    ]) {
      expect(encerrar, trecho).toContain(trecho)
    }
  })

  it('o resto do corpo é o da 1130: limpa agente e pausa, recomeça o teto, e pula o que respondeu ou está enviando', () => {
    const semAExcecao = encerrar
      .replace('declare v_segue boolean; ', '')
      .replace(
        `v_segue := not old.ai_autoreply_disabled; if old.ai_autoreply_disabled and old.ia_pausada_por = 'gente' then ${LEITURA_DO_N} end if; `,
        '',
      )
    const ini = semAExcecao.indexOf(' and not ( v_segue')
    const fim = semAExcecao.indexOf('; end if; return new;')
    expect(ini).toBeGreaterThan(-1)
    expect(fim).toBeGreaterThan(ini)
    expect(semAExcecao.slice(0, ini) + semAExcecao.slice(fim)).toBe(anterior(ENCERRAR))
    expect(encerrar).toContain('and mensagem_enviada_id is null and enviando_desde is null')
  })

  it('SECURITY DEFINER, fechada ao navegador, e o gatilho da 1049 fica (só o corpo muda)', () => {
    const cabecalho = compacto.slice(compacto.indexOf(`create or replace function ${ENCERRAR}()`), compacto.indexOf('as $$', compacto.indexOf(`create or replace function ${ENCERRAR}()`)))
    expect(cabecalho).toContain('security definer')
    expect(cabecalho).toContain("set search_path to 'public'")
    expect(compacto).toContain(`revoke execute on function ${ENCERRAR}() from public, anon, authenticated;`)
    expect(compacto).not.toMatch(/create (or replace )?trigger/)
    expect(compacto).not.toMatch(/drop trigger/)
  })
})

describe('1146 — a forma da migration', () => {
  it('a 1146 é a definição VIGENTE das duas funções: nenhuma migration posterior as recria sem a exceção', () => {
    const depois = fs
      .readdirSync(DIR)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f > ARQUIVO)
      .sort()
    for (const arquivo of depois) {
      const texto = compactar(fs.readFileSync(path.join(DIR, arquivo), 'utf8'))
      const r = corpo(texto, RESERVA)
      if (r) expect(r, arquivo).toContain(RECUSA_NOVA)
      const e = corpo(texto, ENCERRAR)
      if (e) expect(e, arquivo).toContain("cb_ia_turnos.tipo = 'retomada'")
    }
  })

  it('a conferência CHAMA as duas funções, como o service role, num subbloco desfeito por SQLSTATE próprio', () => {
    const conferencia = compacto.slice(compacto.lastIndexOf('do $$'))
    expect(conferencia).toContain('set local role service_role')
    expect(conferencia).toContain("raise exception using errcode = 'p1146'")
    expect(conferencia).toContain("exception when sqlstate 'p1146' then null")
    expect(conferencia).not.toContain('when others')
    expect(conferencia).toContain('v_res := public.cb_ia_reservar_envio(v_retomada, v_desde);')
    expect(conferencia).toContain('v_res := public.cb_ia_reservar_envio(v_resposta, v_desde);')
    // Quatro encerramentos: a retomada fica e a resposta sai; o Desativar; a
    // etapa sem o agente; a pré-armação.
    expect(conferencia.match(/update conversations set status = 'closed' where id = v_conv/g)).toHaveLength(4)
    for (const recusa of [
      'encerrar descartou a retomada com o card na etapa do agente',
      'encerrar não descartou o turno de resposta',
      'a reserva recusou a retomada na conversa encerrada',
      'a reserva deixou a resposta sair na conversa encerrada',
      'encerrar com a ia desativada não descartou a retomada',
      'encerrar com o card fora da etapa do agente não descartou a retomada',
      'encerrar descartou a pré-armação da fala da equipe',
    ]) {
      expect(conferencia, recusa).toContain(recusa)
    }
    // Banco vazio: só o catálogo, com aviso.
    expect(conferencia).toContain('raise notice')
    expect(sql.indexOf('SET LOCAL lock_timeout')).toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION'))
  })
})

describe('1146 — o TS: só a RETOMADA atravessa a encerrada', () => {
  const turno = fonte('lib/ia-agentes/turno.ts')
  const funcao = (nome: string) => {
    const ini = turno.indexOf(`async function ${nome}(`)
    expect(ini, nome).toBeGreaterThan(-1)
    return turno.slice(ini, turno.indexOf('\n}\n', ini))
  }

  it('a regra pura e a leitura: a encerrada segura (e para a leitura antes do card), menos com a declaração', () => {
    const quemResponde = fonte('lib/ia-agentes/quem-responde.ts')
    expect(quemResponde).toContain(
      "if (f.encerrada && f.atravessaEncerrada !== true) return { quem: 'ninguem', motivo: 'encerrada' }",
    )
    expect(quemResponde).toContain('const encerradaQueSegura = leitura.encerrada && args.atravessaEncerrada !== true')
  })

  it('a conferência da retomada e a pré-armação declaram na leitura E na regra; o turno de RESPOSTA, em nenhuma', () => {
    for (const nome of ['conferirRetomada', 'resolverArmacaoDaEquipe']) {
      expect(funcao(nome).match(/atravessaEncerrada: true/g), nome).toHaveLength(2)
    }
    expect(funcao('armarRetomada').match(/atravessaEncerrada: segueEncerrada/g)).toHaveLength(2)
    expect(funcao('conferir')).not.toContain('atravessaEncerrada')
  })
})
