import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// A 1104 troca os nós do robô numa transação (`cb_trocar_nos_do_robo`). O
// comportamento foi provado num Postgres 16 com as restrições reais (CHECK de
// `node_type`, UNIQUE, NOT NULL); a conferência da migration o repete a cada
// aplicação. O que este pino cobra é o que um merge do original devolveria
// sem conflito: a 052 deles recria o CHECK de `flow_runs.status` sem os
// nossos status e cancela run com `cancelled`, que não existe aqui.
// ============================================================

const DIR = __dirname
const sql = fs.readFileSync(path.join(DIR, '1104_cb_robo_salva_nos_numa_transacao.sql'), 'utf8')
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n')

describe('1104 — os nós do robô numa transação', () => {
  it('SECURITY INVOKER, e só o service_role executa (as duas metades do REVOKE)', () => {
    expect(semComentarios).toMatch(/LANGUAGE plpgsql\s+SECURITY INVOKER\s+SET search_path = public/)
    expect(semComentarios).toMatch(
      /REVOKE ALL ON FUNCTION public\.cb_trocar_nos_do_robo\(uuid, jsonb\) FROM PUBLIC, anon, authenticated;/
    )
    expect(semComentarios).toMatch(/GRANT EXECUTE ON FUNCTION public\.cb_trocar_nos_do_robo\(uuid, jsonb\) TO service_role;/)
  })

  it('apaga e insere DENTRO da função, depois de recusar a lista que não é lista e travar o robô', () => {
    const corpo = semComentarios.slice(
      semComentarios.indexOf('CREATE OR REPLACE FUNCTION public.cb_trocar_nos_do_robo'),
      semComentarios.indexOf('$$;')
    )
    const recusa = corpo.indexOf("jsonb_typeof(p_nodes) <> 'array'")
    const trava = corpo.indexOf('FOR UPDATE')
    const apaga = corpo.indexOf('DELETE FROM public.flow_nodes')
    const insere = corpo.indexOf('INSERT INTO public.flow_nodes')
    expect(recusa).toBeGreaterThan(-1)
    expect(recusa).toBeLessThan(trava)
    expect(trava).toBeLessThan(apaga)
    expect(apaga).toBeLessThan(insere)
  })

  it('a conferência CHAMA a função como service_role, num subbloco desfeito pelo SQLSTATE próprio', () => {
    expect(semComentarios).toMatch(/SET LOCAL ROLE service_role;/)
    expect(semComentarios).toMatch(/json_to_record\(/)
    expect(semComentarios).toMatch(/RAISE EXCEPTION USING ERRCODE = 'P1104'/)
    expect(semComentarios).toMatch(/WHEN SQLSTATE 'P1104' THEN/)
    expect(semComentarios).not.toMatch(/WHEN OTHERS/)
  })

  it('⚠️ não traz a 052 do original: nada de CHECK de flow_runs nem de `cancelled`', () => {
    expect(semComentarios).not.toMatch(/flow_runs_status_check/)
    expect(semComentarios).not.toMatch(/'cancelled'/)
    expect(semComentarios).not.toMatch(/transition_seq/)
    expect(fs.existsSync(path.join(DIR, '052_flow_run_integrity.sql'))).toBe(false)
  })
})
