import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// Pino da 1040 — o que passa em revisão e só aparece em produção.
//
//   - ORIGEM `api`: o CHECK tem de aceitar o valor ANTES de a função gravá-lo
//     (o gatilho engole erro com WARNING e o evento se perderia calado); a
//     ORDEM do CASE é o contrato (automação dentro de um pedido da API
//     continua automação); e a leitura do cabeçalho não pode derrubar a
//     escrita em `deals`.
//   - AVISO DURÁVEL: sem backfill (o NULL do acervo impede reenviar 30 dias
//     ao integrador), e o índice parcial espelha a pergunta da reentrega.
// ============================================================

const cru = fs.readFileSync(path.join(__dirname, '1040_cb_origem_api_e_aviso_duravel_do_funil.sql'), 'utf8')
/** Sem comentários: o cabeçalho cita as formas ao EXPLICAR decisões. */
const sql = cru.replace(/--.*$/gm, '')
const fonte = (relativo: string) =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', relativo), 'utf8')

/** O corpo do CREATE OR REPLACE da função do gatilho. */
const funcao = (() => {
  const inicio = sql.indexOf('CREATE OR REPLACE FUNCTION public.cb_enfileira_evento_de_funil()')
  const fim = sql.indexOf('$$;', inicio)
  return sql.slice(inicio, fim)
})()

describe('1040 — a origem `api`', () => {
  it('o CHECK aceita `api` (e os quatro de antes)', () => {
    expect(sql).toMatch(
      /ADD CONSTRAINT cb_automation_events_origem_check\s+CHECK \(origem IN \('usuario', 'conexao', 'automacao', 'api', 'sistema'\)\)/
    )
  })

  it('⚠️ o CHECK é trocado ANTES da função', () => {
    const check = sql.indexOf('ADD CONSTRAINT cb_automation_events_origem_check')
    const drop = sql.indexOf('DROP CONSTRAINT')
    expect(drop).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(drop)
    expect(sql.indexOf('CREATE OR REPLACE FUNCTION public.cb_enfileira_evento_de_funil()')).toBeGreaterThan(check)
  })

  it('o CHECK antigo é achado pela FORMA (coluna origem), nunca pelo nome', () => {
    expect(sql).toMatch(/c\.contype = 'c'/)
    expect(sql).toMatch(/a\.attname = 'origem'/)
  })

  it('⚠️ a ORDEM do CASE: pessoa, cadeia, source do INSERT, cabeçalho, resto', () => {
    const ordem = [
      "WHEN v_actor IS NOT NULL THEN 'usuario'",
      "WHEN nullif(current_setting('cb.cadeia', true), '') IS NOT NULL THEN 'automacao'",
      "WHEN TG_OP = 'INSERT' AND NEW.source = 'channel'    THEN 'conexao'",
      "WHEN TG_OP = 'INSERT' AND NEW.source = 'automation' THEN 'automacao'",
      "WHEN v_pedido = 'api' THEN 'api'",
      "ELSE 'sistema'",
    ].map((t) => funcao.indexOf(t))
    for (const i of ordem) expect(i).toBeGreaterThan(-1)
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem)
  })

  it('⚠️ o cabeçalho é lido com nullif, num bloco PRÓPRIO com EXCEPTION, antes do CASE', () => {
    const bloco = funcao.match(
      /BEGIN\s+v_pedido := nullif\(current_setting\('request\.headers', true\), ''\)::jsonb ->> 'x-cb-origem';\s+EXCEPTION WHEN OTHERS THEN\s+v_pedido := NULL;\s+END;/
    )
    expect(bloco).not.toBeNull()
    expect(funcao.indexOf(bloco![0])).toBeLessThan(funcao.indexOf('v_origem := CASE'))
    // Uma leitura só, e dentro do bloco.
    expect(funcao.match(/request\.headers/g) ?? []).toHaveLength(1)
  })

  it('a função continua SECURITY DEFINER, com search_path, e fechada nas DUAS metades', () => {
    expect(funcao).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/)
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_enfileira_evento_de_funil\(\)\s+FROM PUBLIC, anon, authenticated;/
    )
  })

  it('o vocabulário do TS acompanha o CHECK (a fila e a API pública)', () => {
    expect(fonte('types/index.ts')).toMatch(/origem: 'usuario' \| 'conexao' \| 'automacao' \| 'api' \| 'sistema';/)
    expect(fonte('lib/webhooks/dados-dos-eventos.ts')).toMatch(
      /export type DealEventSource = 'user' \| 'channel' \| 'automation' \| 'api' \| 'system';/
    )
    expect(fonte('lib/webhooks/eventos-de-funil.ts')).toMatch(/api: 'api',/)
  })

  it('a conferência CHAMA o gatilho e se desfaz pelo SQLSTATE próprio, nunca WHEN OTHERS', () => {
    expect(sql).toContain("ERRCODE = 'P1040'")
    expect(sql).toMatch(/WHEN SQLSTATE 'P1040' THEN/)
    const conferencia = sql.slice(sql.lastIndexOf('DO $$'))
    expect(conferencia).toMatch(/UPDATE deals SET stage_id/)
    expect(conferencia).not.toMatch(/WHEN OTHERS/)
  })
})

describe('1040 — o aviso durável', () => {
  it('as colunas: pendente anulável, tentativas próprias com default', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS webhooks_pendente_desde timestamptz,/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS webhooks_tentativas integer NOT NULL DEFAULT 0;/)
  })

  it('⚠️ SEM backfill: nada escreve linha da fila — fora o gatilho (que só roda em escrita nova) e a conferência desfeita', () => {
    // Tira o corpo da função (os INSERTs do gatilho) e a conferência final.
    const executado = sql.slice(0, sql.lastIndexOf('DO $$')).replace(funcao, '')
    expect(executado).not.toMatch(/UPDATE\s+(public\.)?cb_automation_events\b/i)
    expect(executado).not.toMatch(/INSERT\s+INTO\s+(public\.)?cb_automation_events\b/i)
    expect(sql).not.toMatch(/SET\s+webhooks_pendente_desde/i)
    // E a coluna nasce SEM default: o NULL é o "nada a entregar" do acervo.
    expect(sql).not.toMatch(/webhooks_pendente_desde timestamptz\s+(NOT NULL|DEFAULT)/i)
  })

  it('o índice é PARCIAL no pendente — a pergunta da reentrega', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS cb_automation_events_webhooks_pendentes_idx\s+ON public\.cb_automation_events \(webhooks_pendente_desde\)\s+WHERE webhooks_pendente_desde IS NOT NULL;/
    )
    // A reentrega filtra por `<` no pendente, o que implica NOT NULL e casa
    // com o predicado.
    expect(fonte('lib/webhooks/reentregar-eventos-de-funil.ts')).toMatch(
      /\.lt\('webhooks_pendente_desde', corte\)/
    )
  })

  it('⚠️ a ordem de deploy está escrita no cabeçalho (sem a coluna, as automações de funil param)', () => {
    expect(cru).toMatch(/ORDEM DE DEPLOY: ESTA MIGRATION VAI PARA A PRODUÇÃO ANTES DO MERGE/)
  })

  it('⚠️ …e nela, a MEDIÇÃO da origem `api` antes do merge (a conferência põe a GUC à mão)', () => {
    // A premissa (gateway repassa o cabeçalho, PostgREST o publica em
    // `request.headers`) é documentada, não medida; sem ela a receita
    // `source != api` deixa de cortar o laço — a queda não é inofensiva.
    expect(cru).toMatch(/ENTRE APLICAR E MESCLAR, MEDIR A ORIGEM `api`/)
    expect(cru).toMatch(/Sem `api` ali, NÃO mesclar/)
  })
})
