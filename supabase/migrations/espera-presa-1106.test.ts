import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// A 1106 dá à fila das automações o relógio do recolhimento das esperas
// presas em `running` (`recolherEsperasPresas`, `engine.ts`). O que este pino
// cobra é o que passa em revisão e some em produção: o índice PARCIAL só serve
// enquanto a consulta carrega o MESMO filtro do predicado, e a coluna só tem
// valor se a reivindicação do cron a grava.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1106_cb_espera_presa_falha_visivel.sql'), 'utf8')
const fonte = (relativo: string) =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', relativo), 'utf8')

describe('1106 — a espera presa vira falha visível', () => {
  it('a coluna nasce NULA e sem padrão (o estacionamento não a escreve)', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.automation_pending_executions\s+ADD COLUMN IF NOT EXISTS claimed_at timestamptz;/
    )
    expect(sql).not.toMatch(/claimed_at timestamptz\s+(NOT NULL|DEFAULT)/i)
  })

  it('⚠️ o índice parcial ESPELHA o filtro do recolhimento', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS automation_pending_executions_presas_idx\s+ON public\.automation_pending_executions \(claimed_at\)\s+WHERE status = 'running';/
    )
    const motor = fonte('lib/automations/engine.ts')
    const inicio = motor.indexOf('export async function recolherEsperasPresas')
    const corpo = motor.slice(inicio, motor.indexOf('\n}\n', inicio))
    expect(inicio).toBeGreaterThan(-1)
    // As duas cercas: o carimbo velho, e as antigas sem carimbo.
    expect(corpo.match(/\.eq\('status', 'running'\)/g)).toHaveLength(2)
    expect(corpo).toMatch(/\.lt\('claimed_at',/)
    expect(corpo).toMatch(/\.is\('claimed_at', null\)/)
  })

  it('a reivindicação do cron grava o carimbo junto do running', () => {
    expect(fonte('app/api/automations/cron/route.ts')).toMatch(
      /\.update\(\{ status: 'running', claimed_at: new Date\(\)\.toISOString\(\) \}\)\s+\.eq\('id', row\.id\)\s+\.eq\('status', 'pending'\)/
    )
  })

  it('ADITIVA antes do deploy, e a conferência mede o catálogo', () => {
    expect(sql).toMatch(/ADITIVA/)
    expect(sql).toMatch(/ANTES do deploy/)
    expect(sql).toMatch(/SET LOCAL lock_timeout/)
    expect(sql).toMatch(/FROM pg_indexes/)
    // A contagem informativa (a única leitura da tabela) vem ANTES do ALTER:
    // depois dele, tudo roda sob a trava exclusiva.
    expect(sql.indexOf("WHERE status = 'running';\n  IF v_running")).toBeLessThan(
      sql.indexOf('ALTER TABLE public.automation_pending_executions')
    )
  })
})
