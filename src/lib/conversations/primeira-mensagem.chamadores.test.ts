import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// ============================================================
// QUEM decide a primeira mensagem do cliente — travado lendo o fonte (1105).
//
// Os dois caminhos de cliente do WhatsApp acendem o gatilho
// `first_inbound_message` e a entrada de robô por primeira mensagem. A
// resposta é a reivindicação no banco (`reivindicarPrimeiraMensagem`): a
// contagem ANTES do insert, a reivindicação DEPOIS dele (e, na Meta, depois
// do `return` da reentrega), e as duas antes do robô e das automações, que
// leem o resultado. Um merge que traga de volta o
// `isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0` do original
// devolve a saudação em dobro na rajada — e nenhum teste de comportamento
// com dublê de contagem acusaria.
// ============================================================

const SRC = path.join(__dirname, '..', '..')

/** Fonte sem comentários — os arquivos citam a função ao EXPLICAR decisões. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(SRC, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function arquivosDoSrc(dir: string): string[] {
  const saida: string[] = []
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name)
    if (entrada.isDirectory()) saida.push(...arquivosDoSrc(caminho))
    else if (/\.(ts|tsx)$/.test(entrada.name) && !/\.test\.(ts|tsx)$/.test(entrada.name)) saida.push(caminho)
  }
  return saida
}

/** Cada marco aparece, e DEPOIS do anterior. */
function emOrdem(src: string, marcos: string[]) {
  let anterior = -1
  for (const marco of marcos) {
    const i = src.indexOf(marco, anterior + 1)
    expect(i, `"${marco}" depois do marco anterior`).toBeGreaterThan(anterior)
    anterior = i
  }
}

const CAMINHOS = [
  {
    quem: 'webhook da Meta',
    corpo: () => fonte('app/api/whatsapp/webhook/route.ts'),
    // O `return` da reentrega (upsert sem linha) fica entre o insert e a
    // reivindicação: a mensagem reentregue nunca reivindica.
    depoisDoInsert: 'duplicate inbound message ignored',
  },
  {
    quem: 'persistInboundMessage (Evolution)',
    corpo: () => {
      const src = fonte('lib/whatsapp/inbound-store.ts')
      return src.slice(src.indexOf('export async function persistInboundMessage'))
    },
    depoisDoInsert: 'insert message failed',
  },
]

describe('primeira mensagem: a decisão é a reivindicação no banco (1105)', () => {
  for (const { quem, corpo, depoisDoInsert } of CAMINHOS) {
    it(`${quem}: conta antes, grava, reivindica, e só então o robô e as automações`, () => {
      const src = corpo()
      emOrdem(src, [
        'const contagemAnterior = await',
        'gravarComCanal(',
        depoisDoInsert,
        'reivindicarPrimeiraMensagem(',
        'dispatchInboundToFlows(',
        "unshift('first_inbound_message')",
      ])
      expect(src).toMatch(
        /const isFirstInboundMessage = await reivindicarPrimeiraMensagem\([\s\S]{0,120}?contagemAnterior/,
      )
      // Uma reivindicação por mensagem, e a régua antiga não volta.
      expect(src.split('reivindicarPrimeiraMensagem(').length - 1).toBe(1)
      expect(src).not.toMatch(/isFirstInboundMessage\s*=\s*\(/)
      expect(src).not.toContain('priorCustomerMsgCount')
    })
  }

  it('o celular pareado NÃO reivindica: a equipe falando não é a primeira mensagem do cliente', () => {
    const src = fonte('lib/whatsapp/inbound-store.ts')
    const inicio = src.indexOf('export async function persistDeviceMessage')
    const fim = src.indexOf('export async function persistInboundMessage')
    expect(inicio).toBeGreaterThan(-1)
    expect(fim).toBeGreaterThan(inicio)
    expect(src.slice(inicio, fim)).not.toContain('reivindicarPrimeiraMensagem')
  })

  it('DEFAULT-DENY: só os dois caminhos de cliente reivindicam', () => {
    // Grupo, Instagram, a recuperada sem telefone (histórica/tardia), o eco da
    // IA e o envio não acendem motor nenhum: reivindicar ali gastaria a
    // primeira mensagem que o cliente ainda vai mandar.
    const quemChama = arquivosDoSrc(SRC)
      .filter((absoluto) => {
        const relativo = path.relative(SRC, absoluto).split(path.sep).join('/')
        return fonte(relativo).includes('reivindicarPrimeiraMensagem(')
      })
      .map((absoluto) => path.relative(SRC, absoluto).split(path.sep).join('/'))
      .sort()
    expect(quemChama).toEqual([
      'app/api/whatsapp/webhook/route.ts',
      'lib/conversations/primeira-mensagem.ts',
      'lib/whatsapp/inbound-store.ts',
    ])
  })
})
