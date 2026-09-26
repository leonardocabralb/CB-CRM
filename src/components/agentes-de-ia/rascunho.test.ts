import { describe, expect, it } from 'vitest'

import { alteracoesDoRascunho, lerTeto, type Rascunho } from './rascunho'
import type { IaAgente } from './tipos'

const SALVO: IaAgente = {
  id: 'a1',
  accountId: 'c1',
  nome: 'Triagem',
  descricao: 'Recebe o lead',
  instrucoes: 'Você é a triagem.',
  regras: ['Nunca prometa prazo.', 'Sempre peça o nome.'],
  provedor: 'gemini',
  modelo: 'gemini-3.7-flash',
  ativo: false,
  conexoes: ['x', 'y'],
  horario: { dias: [1, 2, 3], inicio: '08:00', fim: '18:00' },
  tetoRespostas: 10,
  podePassarPara: ['b', 'c'],
  transferirPara: 'membro-que-saiu',
  arquivadoEm: null,
  createdAt: '2026-09-25T00:00:00Z',
  updatedAt: '2026-09-25T00:00:00Z',
}

function rascunhoDe(a: IaAgente): Rascunho {
  return {
    nome: a.nome,
    descricao: a.descricao,
    instrucoes: a.instrucoes,
    regras: [...a.regras],
    provedor: a.provedor,
    modelo: a.modelo,
    ativo: a.ativo,
    conexoes: [...a.conexoes],
    horario: a.horario ? { ...a.horario, dias: [...a.horario.dias] } : null,
    tetoRespostas: a.tetoRespostas,
    transferirPara: a.transferirPara,
    podePassarPara: [...a.podePassarPara],
  }
}

describe('alteracoesDoRascunho — o Salvar manda só o que mudou', () => {
  it('nada mudou = corpo vazio (e o Playground não avisa)', () => {
    expect(alteracoesDoRascunho(SALVO, rascunhoDe(SALVO))).toEqual({})
  })

  it('mudar as instruções NÃO reenvia o membro da transferência que saiu da equipe (revisão da F1b)', () => {
    const r = { ...rascunhoDe(SALVO), instrucoes: 'Você é a triagem do escritório.' }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({ instrucoes: 'Você é a triagem do escritório.' })
  })

  it('espaço nas pontas e regra em branco não contam como mudança (a rota apara e descarta)', () => {
    const r = { ...rascunhoDe(SALVO), nome: ' Triagem ', regras: ['Nunca prometa prazo. ', '', ' Sempre peça o nome.'] }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({})
  })

  it('a ORDEM das regras conta (elas vão numeradas ao modelo)', () => {
    const r = { ...rascunhoDe(SALVO), regras: ['Sempre peça o nome.', 'Nunca prometa prazo.'] }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({ regras: ['Sempre peça o nome.', 'Nunca prometa prazo.'] })
  })

  it('a ordem das conexões e dos agentes de passagem NÃO conta (são conjuntos)', () => {
    const r = { ...rascunhoDe(SALVO), conexoes: ['y', 'x'], podePassarPara: ['c', 'b'] }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({})
  })

  it('horário: os dias em outra ordem são o mesmo horário; trocar a hora é mudança', () => {
    const mesmo = { ...rascunhoDe(SALVO), horario: { dias: [3, 1, 2], inicio: '08:00', fim: '18:00' } }
    expect(alteracoesDoRascunho(SALVO, mesmo)).toEqual({})
    const outro = { ...rascunhoDe(SALVO), horario: { dias: [1, 2, 3], inicio: '09:00', fim: '18:00' } }
    expect(alteracoesDoRascunho(SALVO, outro)).toEqual({ horario: outro.horario })
    expect(alteracoesDoRascunho(SALVO, { ...rascunhoDe(SALVO), horario: null })).toEqual({ horario: null })
  })

  it('escolher a fila (nulo) no lugar de quem saiu é mudança, e vai com o nome da rota', () => {
    const r = { ...rascunhoDe(SALVO), transferirPara: null }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({ transferir_para: null })
  })

  it('teto e ativo com os nomes da rota', () => {
    const r = { ...rascunhoDe(SALVO), tetoRespostas: 5, ativo: true }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({ teto_respostas: 5, ativo: true })
  })
})

describe('lerTeto — o campo não se corrige a cada tecla', () => {
  it('aceita inteiro dentro dos limites', () => {
    expect(lerTeto('15', 1, 100)).toBe(15)
    expect(lerTeto(' 1 ', 1, 100)).toBe(1)
  })
  it('vazio, fração, negativo e fora dos limites = null (o Salvar trava e o campo avisa)', () => {
    for (const t of ['', '0', '101', '1.5', '-3', 'abc']) expect(lerTeto(t, 1, 100), t).toBeNull()
  })
})
