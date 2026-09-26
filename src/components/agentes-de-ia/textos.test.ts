import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CODIGOS_CONHECIDOS, STATUS_DO_TURNO } from './textos'
import { BLOCOS_DO_ACESSO, CAIXAS_DO_ACESSO, MODELOS_DE_PARTIDA } from './tipos'

// As telas dos agentes de IA pedem chaves MONTADAS (`erro.${código}`,
// `modelos.${m}.*`, `dia.${d}`, `uso.modo.${m}`), que escapam dos portões de
// i18n do CI. Chave faltando vira a chave crua na tela, sem erro nenhum.

type Dic = { IaAgentes: Record<string, unknown> }

function ler(arquivo: string): Record<string, unknown> {
  return (JSON.parse(readFileSync(join(process.cwd(), 'messages', arquivo), 'utf8')) as Dic).IaAgentes
}

function em(obj: unknown, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

describe.each(['en.json', 'pt-BR.json'])('IaAgentes em %s', (arquivo) => {
  const d = ler(arquivo)

  it('cada código de erro tem texto', () => {
    expect(em(d, 'erro.generico')).toBeTruthy()
    for (const c of CODIGOS_CONHECIDOS) expect(em(d, `erro.${c}`), c).toBeTruthy()
  })

  it('cada modelo de partida tem nome, descrição, instruções e uma LISTA de regras', () => {
    for (const m of MODELOS_DE_PARTIDA) {
      if (m === 'em_branco') continue
      expect(em(d, `modelos.${m}.nome`), m).toBeTruthy()
      expect(em(d, `modelos.${m}.descricao`), m).toBeTruthy()
      expect(em(d, `modelos.${m}.instrucoes`), m).toBeTruthy()
      // Uma regra por linha (o dicionário não guarda lista).
      const regras = em(d, `modelos.${m}.regras`)
      expect(typeof regras === 'string' && regras.split('\n').filter((r) => r.trim()).length >= 2, m).toBe(true)
    }
  })

  it('cada status de turno tem texto (a sub-aba Turnos), e o desconhecido também', () => {
    for (const s of STATUS_DO_TURNO) expect(em(d, `turnos.status.${s}`), s).toBeTruthy()
    expect(em(d, 'turnos.statusDesconhecido')).toBeTruthy()
  })

  it('cada bloco do acesso (F3) tem nome, cada caixa tem dica, e o desconhecido também', () => {
    for (const b of BLOCOS_DO_ACESSO) expect(em(d, `acesso.bloco.${b}`), b).toBeTruthy()
    for (const c of CAIXAS_DO_ACESSO) expect(em(d, `acesso.dica.${c}`), c).toBeTruthy()
    expect(em(d, 'acesso.blocoDesconhecido')).toBeTruthy()
  })

  it('os dias e os modos de uso', () => {
    for (let dia = 0; dia <= 6; dia++) expect(em(d, `dia.${dia}`)).toBeTruthy()
    for (const m of ['agente', 'agente_teste', 'radar', 'transcricao', 'auto_reply', 'draft']) {
      expect(em(d, `uso.modo.${m}`), m).toBeTruthy()
    }
    expect(em(d, 'uso.producao')).toBeTruthy()
    expect(em(d, 'uso.teste')).toBeTruthy()
  })
})

describe('STATUS_DO_TURNO espelha o CHECK de cb_ia_turnos.status (1049)', () => {
  it('todo status que o banco aceita tem rótulo na tela', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/1049_cb_ia_quem_responde.sql'), 'utf8')
    const tabela = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS cb_ia_turnos'))
    const check = /CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/.exec(tabela)
    expect(check, 'o CHECK do status do turno').toBeTruthy()
    const doBanco = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    for (const s of doBanco) expect(STATUS_DO_TURNO as readonly string[], s).toContain(s)
  })
})
