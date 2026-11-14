import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// ============================================================
// Pino da 1145: o episódio do alarme da IA parado há mais de 24 h sem falha
// nova abre um NOVO (o escritório trocou o agente de provedor, e só uma
// geração boa DESTE provedor fecharia o velho). O comportamento é provado
// pela conferência da própria migration; aqui, a forma, para um porte futuro
// não recriar o corpo da 1140.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1145_cb_alarme_da_ia_parado_abre_novo.sql'), 'utf8')

/** A ÚLTIMA definição de `cb_ia_registrar_falha` em todas as migrations: a que vale hoje. */
function vigente(): string {
  let corpo: string | null = null
  for (const f of fs.readdirSync(__dirname).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const texto = fs.readFileSync(path.join(__dirname, f), 'utf8')
    const i = texto.lastIndexOf('CREATE OR REPLACE FUNCTION public.cb_ia_registrar_falha(')
    if (i >= 0) corpo = texto.slice(i, texto.indexOf('$$;', texto.indexOf('AS $$', i)))
  }
  expect(corpo).not.toBeNull()
  return corpo!
}

describe('1145 — cb_ia_registrar_falha', () => {
  it('o episódio fechado OU parado há mais de 24 h abre um novo', () => {
    expect(SQL).toMatch(/ELSIF v\.normalizou_em IS NOT NULL OR v\.ultima_falha_em < now\(\) - interval '24 hours' THEN/)
  })

  it('a definição que vale hoje é a desta migration (ou uma que mantém a regra)', () => {
    expect(vigente()).toMatch(/v\.ultima_falha_em < now\(\) - interval '24 hours'/)
  })

  it('a função segue fechada ao navegador', () => {
    expect(SQL).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_ia_registrar_falha\(uuid, text, text, integer\) FROM PUBLIC, anon, authenticated;/,
    )
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.cb_ia_registrar_falha\(uuid, text, text, integer\) TO service_role;/)
  })
})
