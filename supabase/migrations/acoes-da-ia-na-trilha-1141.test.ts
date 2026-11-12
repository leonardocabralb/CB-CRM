import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { TIPOS_DE_ACAO } from '@/lib/ia-agentes/agente'
import { ACOES_ANOTADAS } from '@/lib/ia-agentes/executar-acoes'
import { TIPOS_DA_NOTA } from '@/lib/notes/acao-da-ia'

// ============================================================
// Pino da 1141 (as AÇÕES da IA como faixas cinzas no fio).
//
// O SQL e o TS repetem três coisas que divergiriam em silêncio:
//   1. os tipos da anotação (CHECK × `TIPOS_DA_NOTA`);
//   2. o texto das anotações antigas que a 1141 converteu (os verbos do SQL ×
//      o dicionário pt-BR de `IaAgentes.transferencia`) — mudar o texto sem
//      mudar o SQL não estraga nada já gravado, mas a conferência e o
//      registro mentiriam sobre quais foram convertidas;
//   3. quais ações anotam (`ACOES_ANOTADAS`) e quais têm a faixa da trilha
//      (etapa e etiqueta, pelos gatilhos recriados aqui).
// ============================================================

const raiz = path.join(__dirname, '..', '..')
const sql = fs.readFileSync(path.join(raiz, 'supabase/migrations/1141_cb_ia_acoes_na_trilha.sql'), 'utf8')
const ptBR = JSON.parse(fs.readFileSync(path.join(raiz, 'messages/pt-BR.json'), 'utf8')) as {
  IaAgentes: { transferencia: { acoes: Record<string, string>; nota: Record<string, string> } }
}

/** O corpo de uma função da migration. */
function corpo(nome: string): string {
  const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nome}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`))
  if (!m) throw new Error(`função ${nome} não achada na 1141`)
  return m[1]
}

describe('1141 — o tipo da anotação', () => {
  it('o CHECK lista os mesmos tipos do TS, e só a anotação tem autor', () => {
    const check = sql.match(/ADD CONSTRAINT cb_conversation_notes_tipo_ck CHECK \(([\s\S]*?)\);/)?.[1] ?? ''
    for (const t of TIPOS_DA_NOTA) expect(check).toContain(`'${t}'`)
    expect(check).toContain("tipo = 'anotacao' OR author_user_id IS NULL")
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'anotacao'/)
  })
})

describe('1141 — quais ações anotam', () => {
  it('etapa e etiqueta têm a faixa da trilha; o resto anota como faixa cinza', () => {
    const naTrilha = ['mover_etapa', 'etiquetar', 'tirar_etiqueta']
    expect([...ACOES_ANOTADAS].sort()).toEqual(TIPOS_DE_ACAO.filter((t) => !naTrilha.includes(t)).sort())
  })
})

describe('1141 — a conversão das anotações antigas segue o dicionário pt-BR', () => {
  const verbos = [...(sql.match(/LIKE ANY \(ARRAY\[([\s\S]*?)\]\)/)?.[1] ?? '').matchAll(/'([^']+) %'/g)].map((m) => m[1])

  it('cada ação do dicionário tem o verbo dela na conversão', () => {
    for (const tipo of TIPOS_DE_ACAO) {
      const modelo = ptBR.IaAgentes.transferencia.acoes[tipo]
      expect(modelo, tipo).toMatch(/^\{agente\} /)
      const depois = modelo.slice('{agente} '.length)
      expect(verbos.some((v) => depois.startsWith(v)), `${tipo}: "${depois}"`).toBe(true)
    }
  })

  it('o "respondeu e passou" (agente_passou) é convertido pela frase INTEIRA', () => {
    const frase = ptBR.IaAgentes.transferencia.nota.agente_passou.replace(/^\{agente\} /, '')
    expect(sql).toContain(`= '${frase}'`)
  })

  it('os AVISOS que pedem algo da equipe ficam anotação (nenhum verbo deles casa)', () => {
    for (const [motivo, modelo] of Object.entries(ptBR.IaAgentes.transferencia.nota)) {
      if (motivo === 'agente_passou') continue
      const depois = modelo.replace(/^\{agente\} /, '')
      expect(verbos.some((v) => depois.startsWith(v)), motivo).toBe(false)
    }
  })
})

describe('1141 — os gatilhos da trilha', () => {
  for (const nome of ['cb_log_deal_event', 'cb_log_contact_tag_event']) {
    it(`${nome}: lê a via só SEM sessão e só a do agente, com o nome do agente DESTA conta`, () => {
      const c = corpo(nome)
      expect(c).toMatch(/IF v_actor IS NULL THEN\s+SELECT CASE WHEN q\.via = 'agente'/)
      expect(c).toContain('FROM public.cb_quem_mexeu_na_conversa() q')
      expect(c).toMatch(/LEFT JOIN cb_ia_agentes g ON g\.id = q\.ref AND g\.account_id = /)
      // A política de falha da 912 continua: gente estoura, servidor vira WARNING.
      expect(c).toMatch(/IF v_actor IS NOT NULL THEN\s+RAISE;/)
      expect(c).toContain('RAISE WARNING')
    })
  }

  it('cb_log_deal_event: a guarda do UPDATE OF (coluna mencionada sem mudar) continua', () => {
    expect(corpo('cb_log_deal_event')).toContain('IF NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id')
  })

  it('a conferência exercita os dois gatilhos e desfaz pelo SQLSTATE próprio', () => {
    expect(sql).toContain("RAISE EXCEPTION USING ERRCODE = 'P1141'")
    expect(sql).toContain("EXCEPTION WHEN SQLSTATE 'P1141' THEN")
    expect(sql).toContain('UPDATE deals SET stage_id = v_etapa')
    expect(sql).toContain('INSERT INTO contact_tags (contact_id, tag_id)')
  })
})
