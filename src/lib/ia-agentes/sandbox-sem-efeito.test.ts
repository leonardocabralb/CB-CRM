import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// ============================================================
// Pino DEFAULT-DENY do sandbox dos agentes de IA (o Playground; DC4 da
// central dos agentes, 26/10/2026): testar o agente — salvo ou o RASCUNHO da
// tela — nunca chega ao cliente nem muda dado real. A única escrita é a linha
// de custo em `ai_usage_log` (`agente_teste`, D13).
//
// 1. Os imports da rota do Playground são uma lista FECHADA: import novo
//    reprova até alguém decidir, por escrito aqui, que ele não escreve.
// 2. Nenhum nome de quem ENVIA ou EXECUTA (envio, ações, reserva, Calendly,
//    anotação, "digitando", funil, retomada, leitura de mídia) aparece no
//    fonte da rota, nem na lista permitida.
// 3. A rota não escreve por conta própria (insert/update/upsert/delete/rpc).
// 4. A conferência do rascunho (`conferirRascunho`, a do salvar) só LÊ.
//
// A prova pelo comportamento é `route.escritas.test.ts` (o dublê que anota
// toda escrita, com as leituras reais).
// ============================================================

const SRC = join(__dirname, '..', '..')
const ROTA = join(SRC, 'app', 'api', 'cb', 'ia', 'agentes', '[id]', 'playground', 'route.ts')

const semComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const fonteDaRota = semComentarios(readFileSync(ROTA, 'utf8'))

/**
 * O que a rota pode importar, módulo a módulo. Cada entrada foi conferida: só
 * lê, é pura, ou é a sessão/o limite. Acrescentar aqui é DECISÃO — com o
 * motivo, e nunca um nome de `PROIBIDOS`.
 */
const PERMITIDOS: Record<string, readonly string[]> = {
  'next/server': ['NextResponse'],
  '@/lib/auth/account': ['requireRole', 'toErrorResponse'],
  '@/lib/rate-limit': ['checkRateLimit', 'rateLimitResponse', 'RATE_LIMITS'],
  '@/lib/ai/admin-client': ['supabaseAdmin'],
  // O provedor: gera texto, não escreve no banco.
  '@/lib/ai/generate': ['generateReply'],
  // A ÚNICA escrita do Playground: a linha de custo `agente_teste` (D13).
  '@/lib/ai/usage': ['logAiUsage'],
  '@/lib/ai/types': ['AiError', 'mensagemSeguraDeAiError', 'ChatMessage'],
  '@/lib/ia-chaves/repo': ['lerChave', 'lerEstado'],
  '@/lib/ia-agentes/acesso': ['blocoIndisponivel', 'lerOQueOAgenteVe'],
  // As réguas PURAS do turno: ler os marcadores, resolver e as travas.
  '@/lib/ia-agentes/acoes': [
    'ACAO_TRANSFERIR',
    'ACOES_COM_A_PASSAGEM',
    'acaoPrometida',
    'equipePrometida',
    'lerAcoes',
    'linkInventado',
    'resolverAcoes',
    'reuniaoPrometida',
    'MotivoDaRecusa',
  ],
  // Os horários AO VIVO (leitura); `marcarNoCalendly` mora no mesmo módulo e é PROIBIDO.
  '@/lib/ia-agentes/agenda': ['lerAgendaDoAgente'],
  // O rascunho: ler o corpo do PATCH e aplicá-lo por cima do salvo (puras).
  '@/lib/ia-agentes/agente': ['aplicarAlteracao', 'lerAlteracao'],
  '@/lib/ia-agentes/conhecimento': ['consultaDaUltimaMensagem'],
  '@/lib/ia-agentes/ferramentas': ['opcoesDoAgente'],
  // Ler o agente e conferir o rascunho como o salvar (só lê; item 4 abaixo).
  '@/lib/ia-agentes/repo': ['conferirRascunho', 'obterAgente'],
  '@/lib/ia-agentes/pedido': ['lerPassagem', 'montarPedidoDaRetomada', 'montarPedidoDoAgente'],
  '@/lib/ia-agentes/regras-do-sistema': ['vazouOPedido'],
  '@/lib/ia-agentes/resposta': ['recusa', 'respostaDoErro'],
  '@/lib/ia-agentes/retomada': ['tempoEmIngles'],
  '@/lib/ia-agentes/retomada-resposta': ['comNotaDaRetomada', 'lerRespostaDaRetomada'],
}

/** Quem envia, executa ou grava fora do teste. Nenhum pode chegar à rota. */
const PROIBIDOS = [
  'engineSendText',
  'executarAcoes',
  'marcarNoCalendly',
  'runAutomationById',
  'addContactTagAndDispatch',
  'removeContactTag',
  'criarTarefaComAviso',
  'transferirParaGente',
  'anotarNaConversa',
  'mostrarDigitando',
  'drenarEventosDeFunil',
  'armarRetomada',
  'lerMidia',
  'transcreverAudio',
  'cb_ia_reservar_envio',
  'cb_atualizar_negocio',
] as const

/** Os imports do fonte: `{ módulo, nomes }` (o `type` do nome tirado; default e namespace com o nome local). */
function importsDe(fonte: string): Array<{ modulo: string; nomes: string[] }> {
  const saida: Array<{ modulo: string; nomes: string[] }> = []
  for (const m of fonte.matchAll(/^\s*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const [, clausula, modulo] = m
    const nomes: string[] = []
    const chaves = clausula.match(/\{([\s\S]*)\}/)
    if (chaves) {
      for (const parte of chaves[1].split(',')) {
        const nome = parte.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
        if (nome) nomes.push(nome)
      }
    }
    const fora = clausula.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim()
    if (fora) nomes.push(fora)
    saida.push({ modulo, nomes })
  }
  return saida
}

function arquivos(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho))
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho)
  }
  return saida
}

/** O corpo de uma função de topo (`function nome(` até a chave que a fecha na coluna 0). */
function corpoDaFuncao(fonte: string, nome: string): string {
  const inicio = fonte.search(new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${nome}\\s*\\(`))
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThanOrEqual(0)
  const fim = fonte.indexOf('\n}\n', inicio)
  return fonte.slice(inicio, fim + 2)
}

const ESCRITA = /\.(insert|update|upsert|delete|rpc)\s*\(/

describe('o sandbox do agente de IA não envia nem muda dado (default-deny)', () => {
  const imports = importsDe(fonteDaRota)

  it('a varredura acha os imports de hoje (senão o pino não vigia nada)', () => {
    const modulos = imports.map((i) => i.modulo)
    expect(modulos).toContain('@/lib/ai/generate')
    expect(modulos).toContain('@/lib/ai/usage')
    expect(modulos).toContain('@/lib/ia-agentes/repo')
    expect(imports.find((i) => i.modulo === '@/lib/ia-agentes/acoes')?.nomes).toContain('resolverAcoes')
  })

  it('⚠️ todo import da rota está na lista FECHADA (import novo = decidir aqui, por escrito)', () => {
    const fora = imports.flatMap(({ modulo, nomes }) =>
      nomes.filter((n) => !(PERMITIDOS[modulo] ?? []).includes(n)).map((n) => `${modulo} → ${n}`),
    )
    expect(fora, 'import fora da lista do sandbox').toEqual([])
  })

  it('sem import dinâmico nem require (escapariam da lista)', () => {
    expect(fonteDaRota).not.toMatch(/\bimport\s*\(/)
    expect(fonteDaRota).not.toMatch(/\brequire\s*\(/)
  })

  it('nenhum nome de quem envia ou executa aparece no fonte da rota — nem na lista permitida', () => {
    for (const nome of PROIBIDOS) {
      expect(fonteDaRota, nome).not.toMatch(new RegExp(`\\b${nome}\\b`))
      expect(Object.values(PERMITIDOS).flat(), nome).not.toContain(nome)
    }
  })

  it('os proibidos EXISTEM no código (a lista não envelheceu com uma renomeação)', () => {
    const tudo = arquivos(SRC).map((f) => readFileSync(f, 'utf8')).join('\n')
    for (const nome of PROIBIDOS) {
      const definido = nome.startsWith('cb_')
        ? new RegExp(`['"]${nome}['"]`)
        : new RegExp(`(?:function|const)\\s+${nome}\\b`)
      expect(tudo, nome).toMatch(definido)
    }
  })

  it('a rota não escreve por conta própria: a única escrita é a do `logAiUsage`', () => {
    expect(fonteDaRota).not.toMatch(ESCRITA)
    expect(fonteDaRota).toMatch(/mode:\s*'agente_teste'/)
    expect(fonteDaRota).not.toMatch(/mode:\s*'(?!agente_teste')/)
  })

  it('⚠️ a conferência do rascunho (a mesma do salvar) só LÊ', () => {
    const repo = semComentarios(readFileSync(join(SRC, 'lib', 'ia-agentes', 'repo.ts'), 'utf8'))
    const rascunho = corpoDaFuncao(repo, 'conferirRascunho')
    expect(rascunho).toContain('conferirReferencias(')
    expect(rascunho).not.toMatch(ESCRITA)
    expect(corpoDaFuncao(repo, 'conferirReferencias')).not.toMatch(ESCRITA)
    const ferramentas = semComentarios(readFileSync(join(SRC, 'lib', 'ia-agentes', 'ferramentas.ts'), 'utf8'))
    expect(ferramentas).not.toMatch(ESCRITA)
  })
})
