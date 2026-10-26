import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// 1109 — encerrar a conversa não apaga o turno da IA que JÁ respondeu.
//
// Medido em 25/10/2026: a automação que o agente executou (anotação +
// "Encerrar conversa") disparou `cb_encerrar_limpa_ia` no meio do turno, e o
// turno que respondeu ficou "descartado — conversa encerrada", sem as ações.
// O que estes pinos seguram:
//  - o descarte pula SÓ o turno com `mensagem_enviada_id` (a resposta saiu),
//    e o resto do corpo é o da 1049 (último agente, pausa, o teto);
//  - a 1109 é a definição VIGENTE (nenhuma migration depois a desfaz);
//  - só o corpo muda: o gatilho da 1049 (um "livre" da Lixeira) fica;
//  - a conferência CHAMA a função pelo gatilho, num subbloco desfeito pelo
//    SQLSTATE próprio, e prova os dois lados (o que respondeu fica, o que
//    não respondeu sai);
//  - o app grava o id do provedor na coluna que a função lê, e não arma
//    retomada em conversa encerrada.
//
// LIMITE DECLARADO: lê o `.sql` e o fonte. O comportamento se prova no
// replay do CI (banco vazio: só o catálogo) e num Postgres descartável com
// dados antes de aplicar.
// ============================================================

const DIR = __dirname
const ARQUIVO = '1109_cb_encerrar_nao_apaga_turno_que_ja_respondeu.sql'
const sql = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8')
const semComentarios = (texto: string) =>
  texto
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n')
const compacto = semComentarios(sql).replace(/\s+/g, ' ').toLowerCase()
const fonte = (relativo: string) => fs.readFileSync(path.join(DIR, '..', '..', 'src', relativo), 'utf8')

function corpo(texto: string): string {
  const ini = texto.indexOf('create or replace function cb_encerrar_limpa_ia()')
  expect(ini).toBeGreaterThan(-1)
  const abre = texto.indexOf('as $$', ini)
  return texto.slice(abre, texto.indexOf('$$;', abre + 5))
}

describe('1109 — encerrar não apaga o turno que já respondeu', () => {
  it('⚠️ o descarte pula o turno cuja resposta saiu (`mensagem_enviada_id`) — e só ele', () => {
    expect(corpo(compacto)).toContain(
      "update cb_ia_turnos set status = 'descartado', erro = 'conversa encerrada', terminado_em = now(), updated_at = now() where conversation_id = new.id and account_id = new.account_id and status in ('aguardando', 'rodando') and mensagem_enviada_id is null",
    )
  })

  it('o resto do corpo é o da 1049: só na TRANSIÇÃO, limpa agente e pausa, e o teto recomeça', () => {
    const c = corpo(compacto)
    expect(c).toContain("new.status = 'closed' and old.status is distinct from 'closed'")
    for (const linha of [
      'new.ia_agente_id := null',
      'new.ai_autoreply_disabled := false',
      'new.ia_pausada_por := null',
      'new.ia_pausada_em := null',
      'new.ia_retomada_em := now()',
    ]) {
      expect(c).toContain(linha)
    }
    const cabecalho = compacto.slice(compacto.indexOf('create or replace function cb_encerrar_limpa_ia()'), compacto.indexOf('as $$'))
    expect(cabecalho).toContain('security definer')
    expect(cabecalho).toContain("set search_path to 'public'")
    expect(compacto).toContain('revoke execute on function cb_encerrar_limpa_ia() from public, anon, authenticated')
  })

  it('⚠️ é a definição VIGENTE: nenhuma migration posterior recria a função sem o recorte', () => {
    const depois = fs
      .readdirSync(DIR)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f > ARQUIVO)
      .sort()
    for (const arquivo of depois) {
      const texto = semComentarios(fs.readFileSync(path.join(DIR, arquivo), 'utf8')).replace(/\s+/g, ' ').toLowerCase()
      if (!texto.includes('function cb_encerrar_limpa_ia()')) continue
      expect(corpo(texto), arquivo).toContain('mensagem_enviada_id is null')
    }
  })

  it('só o corpo muda: o gatilho da 1049 não é recriado (um "livre" da Lixeira, 1097)', () => {
    expect(compacto).not.toMatch(/create (or replace )?trigger/)
    expect(compacto).not.toMatch(/drop trigger/)
    expect(fs.readFileSync(path.join(DIR, '1097_cb_lixeira_de_contatos.sql'), 'utf8')).toContain(
      "'conversations.cb_encerrar_limpa_ia_trigger'",
    )
  })

  it('a conferência CHAMA a função pelo gatilho, como o service role, num subbloco desfeito por SQLSTATE próprio — e prova os dois lados', () => {
    const conferencia = compacto.slice(compacto.lastIndexOf('do $$'))
    expect(conferencia).toContain('set local role service_role')
    expect(conferencia).toContain("raise exception using errcode = 'p1109'")
    expect(conferencia).toContain("exception when sqlstate 'p1109' then null")
    expect(conferencia).not.toContain('when others')
    // O que respondeu fica; o pendente sai; e o que roda sem ter respondido também sai.
    expect(conferencia).toContain("'wamid.conferencia-1109'")
    expect(conferencia.match(/update conversations set status = 'closed' where id = v_conv/g)).toHaveLength(2)
    expect(conferencia).toContain('encerrar descartou o turno que já respondeu')
    expect(conferencia).toContain('encerrar não descartou o turno pendente')
    expect(conferencia).toContain('encerrar não descartou o turno que ainda não respondeu')
    // Banco vazio: só o catálogo, com aviso.
    expect(conferencia).toContain('raise notice')
    expect(sql.indexOf('SET LOCAL lock_timeout')).toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION'))
  })

  it('o app grava o id do provedor na coluna que a função lê — antes do INSERT da mensagem (`gravarIdEnviado`)', () => {
    const turno = fonte('lib/ia-agentes/turno.ts')
    const ini = turno.indexOf('async function gravarIdEnviado')
    expect(ini).toBeGreaterThan(-1)
    const funcao = turno.slice(ini, turno.indexOf('\n}\n', ini))
    expect(funcao).toContain(".update({ mensagem_enviada_id: id, updated_at: new Date().toISOString() })")
  })

  it('⚠️ conversa encerrada durante o turno (a automação do agente fechou) NÃO arma retomada', () => {
    const turno = fonte('lib/ia-agentes/turno.ts')
    const ini = turno.indexOf('async function armarRetomada')
    expect(ini).toBeGreaterThan(-1)
    const funcao = turno.slice(ini, turno.indexOf('\n}\n', ini))
    expect(funcao).toMatch(/if \(!c \|\| c\.status === 'closed' \|\| c\.ai_autoreply_disabled === true\) return/)
  })
})
