import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { TIPOS_DE_ACAO } from './agente'
import {
  avisoDaTarefa,
  chaveDoMotivoDaReuniao,
  CODIGOS_DA_REUNIAO_NAO_MARCADA,
  MOTIVOS_DE_TRANSFERENCIA,
  textosDaAcao,
  textosDaPassagem,
  textosDaTransferencia,
} from './textos-do-servidor'

// As chaves da anotação de transferência são MONTADAS (`nota.<motivo>`), e o
// portão de i18n do CI não alcança chave montada: este teste cobra os dois
// dicionários, e a montagem de verdade no idioma da instalação.

const raiz = join(__dirname, '../../..')
function dicionario(nome: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(raiz, 'messages', nome), 'utf8'))
}
function pegar(d: Record<string, unknown>, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), d)
}

describe('textos da transferência do agente', () => {
  for (const arquivo of ['en.json', 'pt-BR.json']) {
    it(`${arquivo}: autor e uma nota por motivo`, () => {
      const d = dicionario(arquivo)
      expect(typeof pegar(d, 'IaAgentes.transferencia.autor')).toBe('string')
      for (const m of MOTIVOS_DE_TRANSFERENCIA) {
        expect(typeof pegar(d, `IaAgentes.transferencia.nota.${m}`), m).toBe('string')
      }
      expect(typeof pegar(d, 'IaAgentes.transferencia.passagem')).toBe('string')
      // As AÇÕES (F4): uma anotação por tipo, e o aviso da tarefa.
      for (const tipo of TIPOS_DE_ACAO) {
        expect(typeof pegar(d, `IaAgentes.transferencia.acoes.${tipo}`), tipo).toBe('string')
      }
      expect(typeof pegar(d, 'IaAgentes.transferencia.acoes.avisoDaTarefa')).toBe('string')
      // A reunião não marcada (F5): o `{motivo}` sai do texto de cada código.
      for (const c of CODIGOS_DA_REUNIAO_NAO_MARCADA) {
        expect(typeof pegar(d, `IaAgentes.${chaveDoMotivoDaReuniao(c)}`), c).toBe('string')
      }
    })
  }

  it('monta o autor e o texto com o nome do agente', async () => {
    const { autor, texto } = await textosDaTransferencia('Triagem', 'sentinela')
    expect(autor).toContain('Triagem')
    expect(texto).toContain('Triagem')
  })

  it('o link inventado (F4) é um motivo de transferência', async () => {
    expect(MOTIVOS_DE_TRANSFERENCIA).toContain('link_inventado')
    const { texto } = await textosDaTransferencia('Triagem', 'link_inventado')
    expect(texto).toContain('Triagem')
  })

  it('a reunião prometida sem marcar (F5, 27/09) é um motivo de transferência', async () => {
    expect(MOTIVOS_DE_TRANSFERENCIA).toContain('reuniao_prometida')
    const { autor, texto } = await textosDaTransferencia('Reagendamento', 'reuniao_prometida')
    expect(autor).toContain('Reagendamento')
    expect(texto).toContain('Reagendamento')
    expect(texto).not.toMatch(/\{agente\}|IaAgentes/)
  })

  it('a anotação de cada ação (F4) diz o agente, o alvo e o valor', async () => {
    const mover = await textosDaAcao('Triagem', 'mover_etapa', 'Bancário · Proposta')
    expect(mover.autor).toContain('Triagem')
    expect(mover.texto).toContain('Bancário · Proposta')
    const campo = await textosDaAcao('Triagem', 'preencher_campo', 'Tamanho da dívida', 'R$ 150 mil')
    expect(campo.texto).toContain('R$ 150 mil')
    const tarefa = await textosDaAcao('Triagem', 'criar_tarefa', 'Ana', 'Ligar {amanhã}')
    expect(tarefa.texto).toContain('Ligar {amanhã}')
    expect(tarefa.texto).toContain('Ana')
    expect(await avisoDaTarefa('Triagem')).toContain('Triagem')
  })

  it('a passagem (D25): autor da triagem e o nome do destino no texto', async () => {
    const { autor, texto } = await textosDaPassagem('Triagem', 'Cobrança')
    expect(autor).toContain('Triagem')
    expect(texto).toContain('Triagem')
    expect(texto).toContain('Cobrança')
  })

  it('F5: a reunião não marcada diz o agente e o MOTIVO (o texto do código), no idioma da instalação', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', 'pt-BR')
    try {
      const semEmail = await textosDaTransferencia('Reagendamento', 'reuniao_nao_marcada', 'sem_email')
      expect(semEmail.autor).toContain('Reagendamento')
      expect(semEmail.texto).toContain('Reagendamento')
      expect(semEmail.texto).toContain('e-mail')
      expect(semEmail.texto).not.toContain('{motivo}')
      // Falha por tempo/5xx pode ter criado a reunião: a nota manda conferir no Calendly antes de marcar de novo.
      // (O dicionário é lido uma vez por processo: o idioma aqui é o do primeiro teste que o carregou.)
      expect(semEmail.texto).toMatch(
        /confira no Calendly se a reunião não foi criada antes de marcar de novo|check in Calendly that the meeting was not created before booking it again/,
      )
      // A recusa da leitura (horário fora da lista) também tem texto.
      const fora = await textosDaTransferencia('Reagendamento', 'reuniao_nao_marcada', 'fora_da_lista')
      expect(fora.texto).not.toMatch(/ferramentas\.recusa|turnos\.acoes/)
      // Código que não é da lista (ou ausente) cai no genérico, nunca na chave crua.
      const outro = await textosDaTransferencia('Reagendamento', 'reuniao_nao_marcada', 'qualquer')
      expect(outro.texto).not.toMatch(/IaAgentes|\{motivo\}/)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a chave do motivo: falha na execução em `turnos.acoes.erro`, recusa em `ferramentas.recusa`', () => {
    expect(chaveDoMotivoDaReuniao('sem_email')).toBe('turnos.acoes.erro.sem_email')
    expect(chaveDoMotivoDaReuniao('fora_da_lista')).toBe('ferramentas.recusa.fora_da_lista')
  })
})
