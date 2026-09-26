import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

// ============================================================
// Dois pinos DEFAULT-DENY dos agentes de IA (F2 do
// docs/PLANO-agentes-de-ia.md, E6 e 5.3):
//
// 1. Só o TURNO (`src/lib/ia-agentes/turno.ts`) passa `iaAgenteId` ao
//    `engineSendText`. ⚠️ O banco CONFIA nesse carimbo: a 1044 conta a
//    mensagem `bot` COM `ia_agente_id` como "respondido" — o gatilho da 972
//    apaga o alerta de atraso da conversa e o Radar fecha a pendência. Um
//    fluxo, uma automação ou a régua do Asaas que o passassem calariam o
//    alerta de todo cliente esperando gente, sem erro nenhum. Chamada que
//    monta o argumento fora da vista (variável, espalhamento) também reprova:
//    é por onde o carimbo entraria sem aparecer aqui.
// 2. Só as DUAS ingestões do WhatsApp chamam `aoChegarMensagemDoCliente`
//    (Evolution em `inbound-store.ts`, Meta no webhook) — e as duas chamam:
//    sem uma delas o agente vale num transporte só. Outro chamador (grupo,
//    Instagram, celular pareado, mensagem histórica recuperada) faria o
//    agente responder onde a regra não foi decidida para isso.
// ============================================================

const SRC = join(__dirname, '..', '..')

function arquivos(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho))
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho)
  }
  return saida
}

const semComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const rel = (f: string) => relative(SRC, f).split(sep).join('/')

/** O texto do argumento de cada CHAMADA `nome(…)` — a declaração `function nome(` fica de fora. */
function argumentosDasChamadas(fonte: string, nome: string): string[] {
  const saida: string[] = []
  for (const m of fonte.matchAll(new RegExp(`(?<![\\w$])${nome}\\s*\\(`, 'g'))) {
    if (/function\s*$/.test(fonte.slice(Math.max(0, m.index - 12), m.index))) continue
    let profundidade = 0
    let i = m.index + m[0].length - 1
    const inicio = i + 1
    for (; i < fonte.length; i++) {
      if (fonte[i] === '(') profundidade++
      else if (fonte[i] === ')' && --profundidade === 0) break
    }
    saida.push(fonte.slice(inicio, i).trim())
  }
  return saida
}

const FONTES = arquivos(SRC).map((f) => ({ arquivo: rel(f), fonte: semComentarios(readFileSync(f, 'utf8')) }))
// O próprio remetente (a declaração e o INSERT) não é chamador.
const REMETENTE = 'lib/flows/meta-send.ts'

describe('quem passa `iaAgenteId` ao engineSendText (default-deny)', () => {
  const chamadas = FONTES.filter((f) => f.arquivo !== REMETENTE).flatMap((f) =>
    argumentosDasChamadas(f.fonte, 'engineSendText').map((argumento) => ({ arquivo: f.arquivo, argumento })),
  )

  it('a varredura acha os chamadores de hoje (senão o pino não vigia nada)', () => {
    const arquivos = new Set(chamadas.map((c) => c.arquivo))
    expect(arquivos).toContain('lib/ia-agentes/turno.ts')
    expect(arquivos).toContain('lib/flows/engine.ts')
    expect(arquivos).toContain('lib/automations/engine.ts')
  })

  it('só o turno passa o carimbo', () => {
    const comCarimbo = [...new Set(chamadas.filter((c) => /\biaAgenteId\b/.test(c.argumento)).map((c) => c.arquivo))]
    expect(comCarimbo).toEqual(['lib/ia-agentes/turno.ts'])
  })

  it('e passa o agente do TURNO, com o canal exigido', () => {
    const doTurno = chamadas.filter((c) => c.arquivo === 'lib/ia-agentes/turno.ts')
    expect(doTurno).toHaveLength(1)
    expect(doTurno[0].argumento).toMatch(/\biaAgenteId:\s*agente\.id\b/)
    expect(doTurno[0].argumento).toMatch(/\bexigirCanal:\s*true\b/)
  })

  it('nenhuma chamada monta o argumento fora da vista (variável ou espalhamento)', () => {
    const escondidas = chamadas
      .filter((c) => !c.argumento.startsWith('{') || c.argumento.includes('...'))
      .map((c) => `${c.arquivo}: ${c.argumento.slice(0, 60)}`)
    expect(escondidas).toEqual([])
  })

  it('o remetente grava `ia_agente_id` num lugar só, e só vindo de `args.iaAgenteId`', () => {
    const remetente = FONTES.find((f) => f.arquivo === REMETENTE)!.fonte
    expect(remetente.match(/\bia_agente_id\b/g) ?? []).toHaveLength(1)
    expect(remetente).toMatch(/\bia_agente_id:\s*args\.iaAgenteId\b/)
  })
})

describe('quem chama aoChegarMensagemDoCliente (default-deny)', () => {
  const PERMITIDOS = ['app/api/whatsapp/webhook/route.ts', 'lib/whatsapp/inbound-store.ts']

  it('só as duas ingestões do WhatsApp citam a porta', () => {
    const citam = FONTES.filter(
      (f) => f.arquivo !== 'lib/ia-agentes/entrada.ts' && /\baoChegarMensagemDoCliente\b/.test(f.fonte),
    ).map((f) => f.arquivo)
    expect(citam.sort()).toEqual(PERMITIDOS)
  })

  it.each(PERMITIDOS)('%s chama a porta (uma vez)', (arquivo) => {
    const fonte = FONTES.find((f) => f.arquivo === arquivo)!.fonte
    expect(argumentosDasChamadas(fonte, 'aoChegarMensagemDoCliente')).toHaveLength(1)
  })
})
