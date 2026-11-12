import { describe, expect, it } from 'vitest'

import { ERRO_DA_ESPERA_DO_HORARIO } from './horario'
import { ERRO_DA_ARMACAO_PELA_EQUIPE, ERRO_DA_ESPERA_DA_EQUIPE } from './pausa'
import { COLUNAS_DO_PROXIMO_PASSO, proximoPassoDaIa, type TurnoVivo } from './proximo-passo'

// ============================================================
// O próximo passo da IA na faixa do fio (pedido do operador, 12/11/2026).
// ============================================================

function turno(p: Partial<TurnoVivo>): TurnoVivo {
  return {
    tipo: 'resposta',
    status: 'aguardando',
    executar_apos: '2026-11-12T18:00:00Z',
    tentativa: null,
    tentativas: null,
    erro: null,
    ia_agente_id: 'ag-1',
    deal_id: 'd1',
    stage_id: 'e1',
    ...p,
  }
}
const retomada = (p: Partial<TurnoVivo> = {}) => turno({ tipo: 'retomada', tentativa: 2, tentativas: 5, ...p })
const DONO = { agenteId: 'ag-1', dealId: 'd1', stageId: 'e1' }
const ATIVA = { atravessaRetomada: true, dono: DONO }

describe('proximoPassoDaIa', () => {
  it('nada na fila: nulo', () => {
    expect(proximoPassoDaIa([], ATIVA)).toBeNull()
  })

  it('um turno rodando vence tudo: "agora"', () => {
    expect(proximoPassoDaIa([retomada(), turno({ status: 'rodando' })], ATIVA)).toEqual({ tipo: 'agora' })
  })

  it('resposta na fila: a hora; fora do horário do agente, com a marca', () => {
    expect(proximoPassoDaIa([turno({})], ATIVA)).toEqual({
      tipo: 'resposta',
      em: '2026-11-12T18:00:00Z',
      foraDoHorario: false,
    })
    expect(proximoPassoDaIa([turno({ erro: ERRO_DA_ESPERA_DO_HORARIO })], ATIVA)).toMatchObject({
      foraDoHorario: true,
    })
  })

  it('a resposta na fila vem antes do follow-up', () => {
    expect(proximoPassoDaIa([retomada({ executar_apos: '2026-11-12T17:00:00Z' }), turno({})], ATIVA)).toMatchObject({
      tipo: 'resposta',
    })
  })

  it('follow-up agendado: o MAIS CEDO, com a tentativa e de quantas', () => {
    expect(
      proximoPassoDaIa(
        [retomada({ executar_apos: '2026-11-13T12:00:00Z', tentativa: 3 }), retomada({ executar_apos: '2026-11-12T19:00:00Z' })],
        ATIVA,
      ),
    ).toEqual({ tipo: 'retomada', em: '2026-11-12T19:00:00Z', tentativa: 2, tentativas: 5 })
  })

  it('⚠️ a resposta que espera a EQUIPE não entra (a faixa da pausa já diz quando a IA volta)', () => {
    expect(proximoPassoDaIa([turno({ erro: ERRO_DA_ESPERA_DA_EQUIPE })], ATIVA)).toBeNull()
  })

  it('⚠️ a pré-armação do follow-up da equipe, ainda não resolvida: `agendando` (só a releitura; a hora dela não é a do follow-up) — Codex, #515', () => {
    // A pré-armação nasce SEM dono (a 1138 não grava agente, card nem etapa).
    const armacao = retomada({
      tentativa: 1,
      tentativas: 1,
      erro: ERRO_DA_ARMACAO_PELA_EQUIPE,
      ia_agente_id: null,
      deal_id: null,
      stage_id: null,
    })
    expect(proximoPassoDaIa([armacao], ATIVA)).toEqual({ tipo: 'agendando', em: '2026-11-12T18:00:00Z' })
    // O follow-up já resolvido vem antes; e a pausa que ele não atravessa cala os dois.
    expect(proximoPassoDaIa([armacao, retomada({ executar_apos: '2026-11-13T12:00:00Z' })], ATIVA)).toMatchObject({ tipo: 'retomada' })
    expect(proximoPassoDaIa([armacao], { atravessaRetomada: false, dono: DONO })).toBeNull()
  })

  it('⚠️ pausa que o follow-up não atravessa: nenhum follow-up (seria descartado no vencimento)', () => {
    expect(proximoPassoDaIa([retomada()], { atravessaRetomada: false, dono: DONO })).toBeNull()
  })

  it('⚠️ linha de OUTRO dono (card movido para a etapa de outro agente): ignorada — a conferência do motor a descarta (Codex, #515)', () => {
    const outraEtapa = { ia_agente_id: 'ag-2', stage_id: 'e2' }
    expect(proximoPassoDaIa([retomada(outraEtapa)], ATIVA)).toBeNull()
    expect(proximoPassoDaIa([turno(outraEtapa)], ATIVA)).toBeNull()
    expect(proximoPassoDaIa([turno({ ...outraEtapa, status: 'rodando' })], ATIVA)).toBeNull()
    // Outro card do mesmo agente e etapa também.
    expect(proximoPassoDaIa([retomada({ deal_id: 'd9' })], ATIVA)).toBeNull()
    // A do dono de agora vence a velha.
    expect(
      proximoPassoDaIa([retomada({ ...outraEtapa, executar_apos: '2026-11-12T17:00:00Z' }), retomada()], ATIVA),
    ).toMatchObject({ tipo: 'retomada', em: '2026-11-12T18:00:00Z' })
    // Marca de pré-armação com dono já gravado não é pré-armação: vale a régua do dono.
    expect(proximoPassoDaIa([retomada({ ...outraEtapa, erro: ERRO_DA_ARMACAO_PELA_EQUIPE })], ATIVA)).toBeNull()
  })

  it('linha estranha (sem hora, tentativa ilegível ou maior que o total): ignorada, nunca inventada', () => {
    expect(proximoPassoDaIa([turno({ executar_apos: null })], ATIVA)).toBeNull()
    expect(proximoPassoDaIa([retomada({ tentativa: null })], ATIVA)).toBeNull()
    expect(proximoPassoDaIa([retomada({ tentativa: 6, tentativas: 5 })], ATIVA)).toBeNull()
    expect(proximoPassoDaIa([turno({ status: 'respondeu' })], ATIVA)).toBeNull()
  })

  it('as colunas pedidas são as que a regra lê', () => {
    expect(COLUNAS_DO_PROXIMO_PASSO.split(', ').sort()).toEqual(Object.keys(turno({})).sort())
  })
})
