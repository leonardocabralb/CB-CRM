import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

// ============================================================
// Dois pinos DEFAULT-DENY dos agentes de IA (F2 do
// docs/PLANO-agentes-de-ia.md, E6 e 5.3):
//
// 1. Só o TURNO (`src/lib/ia-agentes/turno.ts`) passa `iaAgenteId` ao
//    `engineSendText`. ⚠️ O banco CONFIA nesse carimbo: a 1049 conta a
//    mensagem `bot` COM `ia_agente_id` como "respondido" — o gatilho da 972
//    apaga o alerta de atraso da conversa e o Radar fecha a pendência. Um
//    fluxo, uma automação ou a régua do Asaas que o passassem calariam o
//    alerta de todo cliente esperando gente, sem erro nenhum. Chamada que
//    monta o argumento fora da vista (variável, espalhamento) também reprova:
//    é por onde o carimbo entraria sem aparecer aqui.
//    EXCEÇÃO decidida (09/11/2026, o vídeo e o link da assinatura do
//    Trabalhista): o MOTOR DE AUTOMAÇÕES passa a marca no texto e na mídia —
//    mas só a que `runAutomationById` recebeu do turno (`executar-acoes.ts`,
//    `ctx.agente.id`) e o "Acionar automação" repassa. O agente já respondeu
//    ao cliente no MESMO turno, então o "respondido" não muda; e sem a marca
//    a fala da automação parava a retomada dele ("robô falou"). O disparo por
//    evento a descarta (`dispararAutomacoes`). Os pinos abaixo amarram cada
//    elo dessa cadeia.
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

  it('só o turno e o motor de automações passam o carimbo', () => {
    const comCarimbo = [...new Set(chamadas.filter((c) => /\biaAgenteId\b/.test(c.argumento)).map((c) => c.arquivo))]
    expect(comCarimbo.sort()).toEqual(['lib/automations/engine.ts', 'lib/ia-agentes/turno.ts'])
  })

  it('o motor passa só a marca do CONTEXTO, e só no "Enviar mensagem" (o aviso a outro número fica sem)', () => {
    const doMotor = chamadas.filter((c) => c.arquivo === 'lib/automations/engine.ts')
    const comCarimbo = doMotor.filter((c) => /\biaAgenteId\b/.test(c.argumento))
    expect(comCarimbo).toHaveLength(1)
    expect(comCarimbo[0].argumento).toMatch(/\biaAgenteId:\s*args\.context\.ia_agente_id \?\? null\b/)
    expect(comCarimbo[0].argumento).toMatch(/\bassinarComo\b/) // é o `send_message`
    expect(doMotor.length).toBeGreaterThan(1) // o `send_to_number` existe, sem a marca
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

  it('o remetente do robô grava `ia_agente_id` no texto e na mídia, e só vindo de `args.iaAgenteId`', () => {
    const remetente = FONTES.find((f) => f.arquivo === REMETENTE)!.fonte
    expect(remetente.match(/\bia_agente_id\b/g) ?? []).toHaveLength(2)
    expect(remetente.match(/\bia_agente_id:\s*args\.iaAgenteId\b/g) ?? []).toHaveLength(2)
  })

  it('o remetente das automações grava `ia_agente_id` num lugar só, vindo do TEXTO (`input.iaAgenteId`)', () => {
    const remetente = FONTES.find((f) => f.arquivo === 'lib/automations/meta-send.ts')!.fonte
    expect(remetente.match(/\bia_agente_id\b/g) ?? []).toHaveLength(1)
    expect(remetente).toMatch(/\bia_agente_id:\s*iaAgenteId\b/)
    expect(remetente).toMatch(/const iaAgenteId = input\.kind === 'text' \? \(input\.iaAgenteId \?\? null\) : null/)
  })
})

describe('a marca do agente no motor de automações: cada elo da cadeia (default-deny)', () => {
  const MOTOR = 'lib/automations/engine.ts'
  const motor = FONTES.find((f) => f.arquivo === MOTOR)!.fonte

  it('engineSendMedia: só o motor passa o carimbo, e só a marca do contexto', () => {
    const chamadas = FONTES.filter((f) => f.arquivo !== REMETENTE).flatMap((f) =>
      argumentosDasChamadas(f.fonte, 'engineSendMedia').map((argumento) => ({ arquivo: f.arquivo, argumento })),
    )
    expect(new Set(chamadas.map((c) => c.arquivo))).toContain('lib/flows/engine.ts') // a varredura vê o robô
    const comCarimbo = chamadas.filter((c) => /\biaAgenteId\b/.test(c.argumento))
    expect(comCarimbo.map((c) => c.arquivo)).toEqual([MOTOR])
    expect(comCarimbo[0].argumento).toMatch(/\biaAgenteId:\s*args\.context\.ia_agente_id \?\? null\b/)
  })

  it('runAutomationById: só o turno (o agente do turno) e o "Acionar automação" (repassando o contexto) passam a marca', () => {
    const chamadas = FONTES.flatMap((f) =>
      argumentosDasChamadas(f.fonte, 'runAutomationById').map((argumento) => ({ arquivo: f.arquivo, argumento })),
    )
    const comCarimbo = chamadas.filter((c) => /\biaAgenteId\b/.test(c.argumento))
    expect(comCarimbo.map((c) => c.arquivo).sort()).toEqual([MOTOR, 'lib/ia-agentes/executar-acoes.ts'])
    expect(comCarimbo.find((c) => c.arquivo === 'lib/ia-agentes/executar-acoes.ts')!.argumento).toMatch(
      /\biaAgenteId:\s*ctx\.agente\.id\b/,
    )
    expect(comCarimbo.find((c) => c.arquivo === MOTOR)!.argumento).toMatch(/\biaAgenteId:\s*args\.context\.ia_agente_id \?\? null\b/)
    const escondidas = chamadas.filter((c) => !c.argumento.startsWith('{')).map((c) => c.arquivo)
    expect(escondidas).toEqual([])
  })

  it('o contexto só ganha a marca por `comMarcaDoAgente`: o argumento em `runAutomationById`, NADA no disparo por evento', () => {
    expect(motor.match(/\bia_agente_id:/g) ?? []).toHaveLength(1) // o retorno de `comMarcaDoAgente`
    expect(motor).toMatch(/let context = comMarcaDoAgente\(args\.context, args\.iaAgenteId\)/)
    expect(motor).toMatch(/context: comMarcaDoAgente\(entrada\.context, null\)/)
    expect(argumentosDasChamadas(motor, 'comMarcaDoAgente')).toHaveLength(2)
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
