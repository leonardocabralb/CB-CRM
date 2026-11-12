import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// O cliente com que o agente de IA escreve o que a TRILHA registra (1141).
//
// A marca viaja num cabeçalho que os gatilhos de `deals` e de `contact_tags`
// leem no banco (`cb_quem_mexeu_na_conversa`). Nada disso aparece num teste
// de comportamento sem o PostgREST de verdade, e as quebras são silenciosas —
// a faixa do fio só volta a dizer "pelo sistema":
//   1. o cabeçalho sumir ou mudar de nome/valor (aqui, contra o TS e o SQL);
//   2. etapa ou etiqueta voltarem a ir pelo `db` comum (`executar-acoes.test.ts`
//      confere que passam pelo `dbDaTrilha`);
//   3. o turno deixar de passar `clienteDoAgente` (pino da fonte, abaixo).
// ============================================================

const criarCliente = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ id: `${args.length}-${Math.random()}` })))
vi.mock('@supabase/supabase-js', () => ({ createClient: criarCliente }))

import { CABECALHO_REF, CABECALHO_VIA } from '@/lib/conversations/origem-da-escrita'

import { clienteDoAgente } from './cliente-do-agente'

const raiz = path.join(__dirname, '..', '..', '..')
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8')
/** Fonte sem comentários — os arquivos citam os nomes ao EXPLICAR decisões. */
const codigo = (rel: string) =>
  ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://exemplo.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'chave-de-servico-ficticia')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clienteDoAgente (1141)', () => {
  it('todo pedido leva x-cb-via: agente e x-cb-ref: <agente>', () => {
    clienteDoAgente('agente-a')
    expect(criarCliente).toHaveBeenCalledWith('https://exemplo.supabase.co', 'chave-de-servico-ficticia', {
      global: { headers: { 'x-cb-via': 'agente', 'x-cb-ref': 'agente-a' } },
    })
    expect(CABECALHO_VIA).toBe('x-cb-via')
    expect(CABECALHO_REF).toBe('x-cb-ref')
  })

  it('um cliente POR agente, guardado: o mesmo agente reusa; outro agente ganha o seu', () => {
    const a1 = clienteDoAgente('agente-b')
    const a2 = clienteDoAgente('agente-b')
    const c = clienteDoAgente('agente-c')
    expect(a1).toBe(a2)
    expect(c).not.toBe(a1)
    expect(criarCliente.mock.calls.filter((args) => JSON.stringify(args).includes('agente-b'))).toHaveLength(1)
  })

  it('⚠️ os gatilhos da 1141 leem a MESMA via (e só a do agente vai para a trilha)', () => {
    const sql = ler('supabase/migrations/1141_cb_ia_acoes_na_trilha.sql')
    expect(sql).toContain("q.via = 'agente'")
    expect(sql).toContain('public.cb_quem_mexeu_na_conversa()')
    // E a 1083 lê os mesmos nomes de cabeçalho.
    const sql1083 = ler('supabase/migrations/1083_cb_historico_da_conversa.sql')
    expect(sql1083).toContain(`->> '${CABECALHO_VIA}'`)
    expect(sql1083).toContain(`->> '${CABECALHO_REF}'`)
  })

  it('o turno passa o cliente do agente às AÇÕES, nas duas portas (resposta e passagem)', () => {
    const fonte = codigo('src/lib/ia-agentes/turno.ts')
    expect(fonte.match(/dbDaTrilha:\s*clienteDoAgente\(agente\.id\)/g)).toHaveLength(2)
  })

  it('a passagem move o card com a origem do agente', () => {
    const fonte = codigo('src/lib/ia-agentes/turno.ts')
    expect(fonte).toMatch(/\.from\('deals'\)\s*\.update\(\{ pipeline_id: etapa\.pipelineId, stage_id: etapa\.id \}\)[\s\S]{0,400}\{ via: 'agente', ref: conferido\.agente\.id \}/)
  })
})
