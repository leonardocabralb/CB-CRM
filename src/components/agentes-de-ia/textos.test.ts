import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { useTranslations } from 'next-intl'

import {
  ACOES_COM_VALOR,
  CODIGOS_DE_FALHA_DA_ACAO,
  type MotivoDaRecusa,
  type MotivoForaDaD5,
} from '@/lib/ia-agentes/acoes'

import { GATILHOS_DA_CASCATA } from './ferramentas'
import {
  CHAVE_DO_ERRO_DA_ACAO,
  CODIGOS_CONHECIDOS,
  CODIGOS_DA_D5,
  MOTIVOS_DE_RECUSA,
  STATUS_DO_TURNO,
  TIPOS_DE_CAMPO,
  fraseDaAcao,
  rotuloDoTipoDoCampo,
  textoDoDetalheDaAcao,
  textoDoErroDaAcao,
} from './textos'
import { BLOCOS_DO_ACESSO, CAIXAS_DO_ACESSO, MODELOS_DE_PARTIDA, TIPOS_DE_ACAO } from './tipos'

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

  it('cada tipo de ação (F4) tem nome, dica, frase no Playground e o "nenhum" da lista; o desconhecido também', () => {
    for (const tipo of TIPOS_DE_ACAO) {
      expect(em(d, `ferramentas.tipo.${tipo}.nome`), tipo).toBeTruthy()
      expect(em(d, `ferramentas.tipo.${tipo}.dica`), tipo).toBeTruthy()
      expect(em(d, `ferramentas.nenhum.${tipo}`), tipo).toBeTruthy()
      expect(em(d, `playground.acao.${tipo}`), tipo).toBeTruthy()
    }
    expect(em(d, 'ferramentas.tipoDesconhecido')).toBeTruthy()
    expect(em(d, 'playground.acaoDesconhecida')).toBeTruthy()
  })

  it('cada ação com valor (campo, tarefa) tem a frase com o valor no Playground', () => {
    for (const tipo of ACOES_COM_VALOR) {
      const frase = em(d, `playground.acaoComValor.${tipo}`)
      expect(typeof frase === 'string' && frase.includes('{nome}') && frase.includes('{valor}'), tipo).toBe(true)
    }
  })

  it('cada tipo de campo tem rótulo, e as opções da lista também', () => {
    for (const tipo of TIPOS_DE_CAMPO) expect(em(d, `ferramentas.campo.${tipo}`), tipo).toBeTruthy()
    expect(em(d, 'ferramentas.campoOpcoes')).toBeTruthy()
  })

  it('cada gatilho da cascata (etapa, aplicar, tirar) tem o bloqueio com o motivo, e o "Aguardar" também', () => {
    for (const g of GATILHOS_DA_CASCATA) {
      const frase = em(d, `ferramentas.bloqueio.cascata.${g}`)
      expect(typeof frase === 'string' && frase.includes('{motivo}'), g).toBe(true)
    }
    expect(em(d, 'ferramentas.bloqueio.aguardar')).toBeTruthy()
  })

  it('cada código do registro de uma ação (recusa e falha) tem texto, com o genérico e o complemento', () => {
    for (const [codigo, chave] of Object.entries(CHAVE_DO_ERRO_DA_ACAO)) expect(em(d, chave), codigo).toBeTruthy()
    for (const codigo of ['automacao_fora_da_d5', 'cascata_fora_da_d5'] as const) {
      const frase = em(d, CHAVE_DO_ERRO_DA_ACAO[codigo])
      expect(typeof frase === 'string' && frase.includes('{motivo}'), codigo).toBe(true)
    }
    expect(em(d, 'turnos.acoes.erro.desconhecido')).toBeTruthy()
    expect(em(d, 'turnos.acoes.erro.semCodigo')).toBeTruthy()
    expect(em(d, 'turnos.acoes.comDetalhe')).toBeTruthy()
    expect(em(d, 'turnos.acoes.jaEstava')).toBeTruthy()
  })

  it('cada motivo da D5 (automação que não pode ser liberada) tem texto, e o "outro" também', () => {
    for (const c of CODIGOS_DA_D5) expect(em(d, `ferramentas.foraDaD5.${c}`), c).toBeTruthy()
    expect(em(d, 'ferramentas.foraDaD5.outro')).toBeTruthy()
  })

  it('cada motivo de recusa de ação (Playground e Turnos) tem texto, e o "outro" também', () => {
    for (const m of MOTIVOS_DE_RECUSA) expect(em(d, `ferramentas.recusa.${m}`), m).toBeTruthy()
    expect(em(d, 'ferramentas.recusa.outro')).toBeTruthy()
  })

  it('cada anotação de AÇÃO que o servidor grava (textosDaAcao) tem texto, e o aviso da tarefa também', () => {
    for (const tipo of TIPOS_DE_ACAO) expect(em(d, `transferencia.acoes.${tipo}`), tipo).toBeTruthy()
    expect(em(d, 'transferencia.acoes.avisoDaTarefa')).toBeTruthy()
  })

  it('o motivo de transferência link_inventado (F4) tem a anotação', () => {
    expect(em(d, 'transferencia.nota.link_inventado')).toBeTruthy()
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

describe('as listas da tela cobrem os códigos do servidor (F4)', () => {
  // Um Record literal: o COMPILADOR cobra um código novo do servidor aqui, e
  // o teste cobra que a lista da tela (e, por ela, os dicionários) o tenha.
  it('todo motivo de recusa de ação tem texto na tela', () => {
    const doServidor: Record<MotivoDaRecusa, true> = {
      malformada: true,
      teto: true,
      nao_liberada: true,
      fora_da_lista: true,
      passagem: true,
      transferencia: true,
    }
    for (const m of Object.keys(doServidor)) expect(MOTIVOS_DE_RECUSA as readonly string[], m).toContain(m)
  })

  it('todo passo fora da D5 tem texto na tela', () => {
    const doServidor: Record<MotivoForaDaD5, true> = {
      send_to_number: true,
      send_webhook: true,
      status_de_resultado: true,
      etapa_de_resultado: true,
      run_flow: true,
      campo_vigiado: true,
      aguardar: true,
    }
    for (const c of Object.keys(doServidor)) expect(CODIGOS_DA_D5 as readonly string[], c).toContain(c)
  })

  it('todo código de falha de uma ação executada, e toda recusa, tem texto na aba Turnos', () => {
    // O `satisfies Record<…>` de CHAVE_DO_ERRO_DA_ACAO já cobra no compilador;
    // aqui, a lista do SERVIDOR (runtime) contra a da tela, sem sobra.
    const naTela = Object.keys(CHAVE_DO_ERRO_DA_ACAO)
    const doServidor: string[] = [...CODIGOS_DE_FALHA_DA_ACAO, ...MOTIVOS_DE_RECUSA]
    expect([...naTela].sort()).toEqual([...doServidor].sort())
  })
})

describe('textoDoErroDaAcao — o porquê de uma ação do turno', () => {
  // Um `t` de mentira que devolve a chave e os valores: prova QUAL chave foi
  // pedida, sem depender do texto do dicionário.
  const t = ((chave: string, valores?: Record<string, unknown>) =>
    valores ? `${chave}${JSON.stringify(valores)}` : chave) as unknown as ReturnType<typeof useTranslations>

  it('código conhecido vira a frase; o de campo vigiado fala do CAMPO, não de automação', () => {
    expect(textoDoErroDaAcao(t, { erro: 'sem_card' })).toBe('turnos.acoes.erro.sem_card')
    expect(textoDoErroDaAcao(t, { erro: 'campo_vigiado' })).toBe('turnos.acoes.erro.campo_vigiado')
    expect(textoDoErroDaAcao(t, { erro: 'fora_da_lista' })).toBe('ferramentas.recusa.fora_da_lista')
  })

  it('fora da D5 (direta ou pela cascata): o passo do `detalhe` entra traduzido na frase', () => {
    expect(textoDoErroDaAcao(t, { erro: 'automacao_fora_da_d5', detalhe: 'send_webhook' })).toBe(
      'turnos.acoes.erro.automacao_fora_da_d5{"motivo":"ferramentas.foraDaD5.send_webhook"}',
    )
    expect(textoDoErroDaAcao(t, { erro: 'cascata_fora_da_d5', detalhe: 'aguardar' })).toBe(
      'turnos.acoes.erro.cascata_fora_da_d5{"motivo":"ferramentas.foraDaD5.aguardar"}',
    )
    // Passo desconhecido: o "outro" na frase e o cru depois.
    expect(textoDoErroDaAcao(t, { erro: 'automacao_fora_da_d5', detalhe: 'passo_novo' })).toBe(
      'turnos.acoes.comDetalhe{"texto":"turnos.acoes.erro.automacao_fora_da_d5{\\"motivo\\":\\"ferramentas.foraDaD5.outro\\"}","detalhe":"passo_novo"}',
    )
  })

  it('o `detalhe` cru vai depois da frase traduzida', () => {
    expect(textoDoErroDaAcao(t, { erro: 'recusado', detalhe: 'status_mudou' })).toBe(
      'turnos.acoes.comDetalhe{"texto":"turnos.acoes.erro.recusado","detalhe":"status_mudou"}',
    )
  })

  it('registro antigo com código fora das listas: o genérico com o cru, nunca a chave', () => {
    expect(textoDoErroDaAcao(t, { erro: 'recusado: status mudou' })).toBe(
      'turnos.acoes.erro.desconhecido{"erro":"recusado: status mudou"}',
    )
    expect(textoDoErroDaAcao(t, {})).toBe('turnos.acoes.erro.semCodigo')
  })

  it('`ja_estava` (a ação deu certo sem mexer) vira texto; outro detalhe sai cru', () => {
    expect(textoDoDetalheDaAcao(t, 'ja_estava')).toBe('turnos.acoes.jaEstava')
    expect(textoDoDetalheDaAcao(t, 'qualquer')).toBe('qualquer')
  })
})

describe('fraseDaAcao e rotuloDoTipoDoCampo', () => {
  const t = ((chave: string, valores?: Record<string, unknown>) =>
    valores ? `${chave}${JSON.stringify(valores)}` : chave) as unknown as ReturnType<typeof useTranslations>

  it('com valor, só nos tipos que o levam (campo e tarefa)', () => {
    expect(fraseDaAcao(t, 'criar_tarefa', 'Ana', 'Ligar amanhã')).toBe(
      'playground.acaoComValor.criar_tarefa{"nome":"Ana","valor":"Ligar amanhã"}',
    )
    expect(fraseDaAcao(t, 'preencher_campo', 'Tamanho da dívida', '200 mil')).toBe(
      'playground.acaoComValor.preencher_campo{"nome":"Tamanho da dívida","valor":"200 mil"}',
    )
    expect(fraseDaAcao(t, 'mover_etapa', 'Proposta', 'x')).toBe('playground.acao.mover_etapa{"nome":"Proposta"}')
    expect(fraseDaAcao(t, 'criar_tarefa', 'Ana')).toBe('playground.acao.criar_tarefa{"nome":"Ana"}')
  })

  it('tipo de campo conhecido tem rótulo; o desconhecido (ou ausente) não afirma nada', () => {
    expect(rotuloDoTipoDoCampo(t, 'datetime')).toBe('ferramentas.campo.datetime')
    expect(rotuloDoTipoDoCampo(t, 'coisa')).toBeNull()
    expect(rotuloDoTipoDoCampo(t, null)).toBeNull()
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
