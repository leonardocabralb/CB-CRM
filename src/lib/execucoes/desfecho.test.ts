import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  itensDoFio,
  itensDoHistorico,
  MOTIVOS_DA_INTERRUPCAO,
  TETO_DE_ITENS,
  type ExecucaoEncerrada,
} from './desfecho'

function linha(over: Partial<ExecucaoEncerrada> = {}): ExecucaoEncerrada {
  return {
    id: 'log-1',
    automationId: 'aut-1',
    nomeDaAutomacao: 'Contrato fechado',
    desfecho: 'concluida',
    finalizadoEm: '2026-09-09T12:00:00.000Z',
    errorMessage: null,
    stepsExecuted: [],
    ...over,
  }
}

describe('itensDoFio — o que NÃO aparece', () => {
  it('execução sem desfecho é ignorada', () => {
    // É o caso das 15 execuções gravadas antes da 985 e, todo dia, o de
    // qualquer automação que acabou de começar: `status` nasce 'failed', e sem
    // este descarte o fio ganharia um cartão vermelho a cada disparo.
    expect(itensDoFio([linha({ desfecho: null })])).toEqual([])
  })

  it('execução com desfecho mas sem hora de fim é ignorada', () => {
    expect(itensDoFio([linha({ finalizadoEm: null })])).toEqual([])
  })

  it('lista vazia devolve vazio, sem inventar item', () => {
    expect(itensDoFio([])).toEqual([])
  })
})

describe('itensDoFio — colapso', () => {
  it('mesma automação, mesmo dia, mesmo desfecho: um item com contador', () => {
    // O caso real: automação de gatilho "mensagem recebida" conclui uma vez
    // por mensagem do cliente. Sem colapso, esta feature dobra o fio.
    const itens = itensDoFio([
      linha({ id: 'a', finalizadoEm: '2026-09-09T12:00:00.000Z' }),
      linha({ id: 'b', finalizadoEm: '2026-09-09T15:00:00.000Z' }),
      linha({ id: 'c', finalizadoEm: '2026-09-09T18:00:00.000Z' }),
    ])
    expect(itens).toHaveLength(1)
    expect(itens[0].vezes).toBe(3)
    // O sobrevivente é o MAIS RECENTE — é ele que o clique abre.
    expect(itens[0].execucaoId).toBe('c')
    expect(itens[0].quando).toBe('2026-09-09T18:00:00.000Z')
  })

  it('desfechos diferentes no mesmo dia NÃO se misturam', () => {
    // Concluir três vezes e falhar uma não pode virar "4 execuções": a falha
    // é justamente a que precisa aparecer.
    const itens = itensDoFio([
      linha({ id: 'a', desfecho: 'concluida' }),
      linha({ id: 'b', desfecho: 'falhou', finalizadoEm: '2026-09-09T13:00:00.000Z' }),
    ])
    expect(itens).toHaveLength(2)
    expect(itens.map((i) => i.desfecho)).toEqual(['concluida', 'falhou'])
  })

  it('dias diferentes NÃO se misturam', () => {
    const itens = itensDoFio([
      linha({ id: 'a', finalizadoEm: '2026-09-08T12:00:00.000Z' }),
      linha({ id: 'b', finalizadoEm: '2026-09-09T12:00:00.000Z' }),
    ])
    expect(itens).toHaveLength(2)
  })

  it('automações diferentes NÃO se misturam', () => {
    const itens = itensDoFio([
      linha({ id: 'a', automationId: 'aut-1' }),
      linha({ id: 'b', automationId: 'aut-2', finalizadoEm: '2026-09-09T13:00:00.000Z' }),
    ])
    expect(itens).toHaveLength(2)
  })
})

describe('itensDoFio — ordem e teto', () => {
  it('ordena do mais antigo para o mais novo (a ordem do fio)', () => {
    const itens = itensDoFio([
      linha({ id: 'novo', automationId: 'a2', finalizadoEm: '2026-09-09T18:00:00.000Z' }),
      linha({ id: 'velho', automationId: 'a1', finalizadoEm: '2026-09-09T09:00:00.000Z' }),
    ])
    expect(itens.map((i) => i.execucaoId)).toEqual(['velho', 'novo'])
  })

  it('o teto mantém os mais RECENTES', () => {
    const muitas = Array.from({ length: TETO_DE_ITENS + 5 }, (_, i) =>
      linha({
        id: `log-${i}`,
        automationId: `aut-${i}`,
        finalizadoEm: `2026-09-09T${String(i).padStart(2, '0')}:00:00.000Z`,
      }),
    )
    const itens = itensDoFio(muitas)
    expect(itens).toHaveLength(TETO_DE_ITENS)
    // Os cinco primeiros (mais antigos) é que caem.
    expect(itens[0].execucaoId).toBe('log-5')
  })

  it('teto configurável, para a aba poder mostrar mais que o fio', () => {
    const tres = ['a', 'b', 'c'].map((id, i) =>
      linha({ id, automationId: id, finalizadoEm: `2026-09-09T0${i}:00:00.000Z` }),
    )
    expect(itensDoFio(tres, { teto: 2 })).toHaveLength(2)
  })
})

describe('itensDoFio — o motivo da falha', () => {
  it('acha o passo que falhou pelo STATUS, não pela posição', () => {
    // ⚠️ O ramo de uma condição faz flush ANTES do escopo de fora, então
    // `at(-1)` não é o último passo a rodar. Aqui o passo que falhou está no
    // MEIO do array de propósito.
    const itens = itensDoFio([
      linha({
        desfecho: 'falhou',
        errorMessage: 'send_webhook: destination not allowed',
        stepsExecuted: [
          { step_id: '1', step_type: 'add_tag', status: 'success' },
          { step_id: '2', step_type: 'send_webhook', status: 'failed', detail: 'destino recusado' },
          { step_id: '3', step_type: 'condition', status: 'success', detail: 'branch=yes' },
        ],
      }),
    ])
    expect(itens[0].passoQueParou).toBe('send_webhook')
    expect(itens[0].motivoBruto).toBe('send_webhook: destination not allowed')
  })

  it('execução barrada carrega qual condição desviou, não o motivo de erro', () => {
    const itens = itensDoFio([
      linha({
        desfecho: 'barrada',
        stepsExecuted: [
          { step_id: '1', step_type: 'condition', status: 'skipped', detail: 'branch=yes' },
        ],
      }),
    ])
    expect(itens[0].motivoBruto).toBe('branch=yes')
    expect(itens[0].passoQueParou).toBeUndefined()
  })

  it('execução concluída não carrega motivo nenhum', () => {
    const itens = itensDoFio([linha({ errorMessage: 'sobra de execução anterior' })])
    expect(itens[0].motivoBruto).toBeUndefined()
  })

  it('passos ausentes ou malformados não derrubam a régua', () => {
    // `steps_executed` é JSONB: pode ter sido gravado por uma versão que não
    // conhecia um campo de hoje.
    const itens = itensDoFio([
      linha({ desfecho: 'falhou', stepsExecuted: null }),
      linha({
        id: 'outro',
        automationId: 'aut-2',
        desfecho: 'falhou',
        stepsExecuted: [null as unknown as never],
      }),
    ])
    expect(itens).toHaveLength(2)
    expect(itens[0].passoQueParou).toBeUndefined()
  })
})

// ------------------------------------------------------------
// ⚠️ Este bloco é a ÚNICA guarda possível para estas chaves: a tela monta
// `aviso.${desfecho}`, e `scripts/i18n-chaves-usadas.mjs` conta chave montada
// como "dinâmica ignorada" — ou seja, o portão do CI não a confere. Sem o
// teste, apagar uma delas do dicionário passa verde e vira caminho de chave
// cru no fio do cliente (o fallback do next-intl é por ARQUIVO, não por chave).
// ------------------------------------------------------------
describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const dic = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'))

  // ⚠️ SÃO DOIS blocos de chaves montadas por desfecho, e a primeira versão
  // deste teste cobria só o do fio. MEDIDO: apagando
  // `Automations.logs.desfecho.barrada` dos dois dicionários, a suíte inteira,
  // o `i18n-parity` e o `i18n-chaves-usadas` ficavam VERDES — e a etiqueta da
  // tela de logs imprimia o caminho da chave cru (achado da revisão, 09/09).
  const blocos = {
    'Inbox.execucoes.aviso (o fio)': dic?.Inbox?.execucoes?.aviso,
    'Automations.logs.desfecho (a tela de logs)': dic?.Automations?.logs?.desfecho,
  }

  for (const [onde, bloco] of Object.entries(blocos)) {
    it(`${onde}: uma chave por desfecho, nenhuma órfã`, () => {
      expect(Object.keys(bloco ?? {}).sort()).toEqual(['barrada', 'concluida', 'falhou'])
    })

    it(`${onde}: nenhuma chave vazia`, () => {
      for (const [k, v] of Object.entries(bloco ?? {})) {
        expect(typeof v === 'string' && v.trim().length > 0, `${k} está vazia`).toBe(true)
      }
    })
  }
})

describe('itensDoHistorico — o "Já rodou" da aba (29/09/2026)', () => {
  it('a interrompida entra na ABA, com o motivo — e continua fora do fio', () => {
    const interrompida = linha({
      id: 'i',
      desfecho: null,
      finalizadoEm: null,
      interrompidaEm: '2026-09-09T15:00:00.000Z',
      interrompidaPor: 'resposta',
    })
    expect(itensDoFio([interrompida])).toEqual([])
    const [item] = itensDoHistorico([interrompida])
    expect(item).toMatchObject({
      desfecho: 'interrompida',
      quando: '2026-09-09T15:00:00.000Z',
      interrompidaPor: 'resposta',
      execucoes: [{ id: 'i', quando: '2026-09-09T15:00:00.000Z' }],
    })
  })

  it('motivo fora do CHECK vira "não sei" (null), nunca um motivo inventado', () => {
    const [item] = itensDoHistorico([
      linha({ desfecho: null, finalizadoEm: null, interrompidaEm: '2026-09-09T15:00:00.000Z', interrompidaPor: 'outro' }),
    ])
    expect(item.interrompidaPor).toBeNull()
  })

  it('o desfecho vence a marca: interrompida que já tinha falhado é FALHA', () => {
    const [item] = itensDoHistorico([
      linha({
        desfecho: 'falhou',
        errorMessage: 'webhook returned 404',
        interrompidaEm: '2026-09-09T15:00:00.000Z',
        interrompidaPor: 'resposta',
      }),
    ])
    expect(item.desfecho).toBe('falhou')
    expect(item.motivoBruto).toBe('webhook returned 404')
  })

  it('execução em curso (sem desfecho e sem marca) não aparece', () => {
    expect(itensDoHistorico([linha({ desfecho: null, finalizadoEm: null })])).toEqual([])
  })

  it('o grupo guarda TODAS as execuções, da mais recente para a mais antiga', () => {
    const [item] = itensDoHistorico([
      linha({ id: 'a', desfecho: 'barrada', finalizadoEm: '2026-09-09T12:00:00.000Z' }),
      linha({ id: 'b', desfecho: 'barrada', finalizadoEm: '2026-09-09T13:00:00.000Z' }),
    ])
    expect(item.execucoes.map((e) => e.id)).toEqual(['b', 'a'])
    expect(item.quando).toBe('2026-09-09T13:00:00.000Z')
  })

  it('a ordem da aba é da mais recente para a mais antiga, com teto', () => {
    const itens = itensDoHistorico(
      [
        linha({ id: 'velha', automationId: 'x', finalizadoEm: '2026-09-01T12:00:00.000Z' }),
        linha({ id: 'nova', automationId: 'y', finalizadoEm: '2026-09-09T12:00:00.000Z' }),
        linha({ id: 'meio', automationId: 'z', finalizadoEm: '2026-09-05T12:00:00.000Z' }),
      ],
      { teto: 2 },
    )
    expect(itens.map((i) => i.execucoes[0].id)).toEqual(['nova', 'meio'])
  })
})

describe('o motivo da interrupção nos dois dicionários (chave montada)', () => {
  // `historico.interrompida.${motivo ?? 'desconhecido'}`: a lista vem do código
  // (o CHECK da 1005), nunca digitada aqui.
  for (const arquivo of ['pt-BR.json', 'en.json']) {
    it(`${arquivo}: um texto por motivo, mais o "não sei", e nenhum órfão`, () => {
      const dic = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'))
      const bloco = dic?.Inbox?.execucoes?.historico?.interrompida ?? {}
      expect(Object.keys(bloco).sort()).toEqual([...MOTIVOS_DA_INTERRUPCAO, 'desconhecido'].sort())
      for (const [k, v] of Object.entries(bloco)) {
        expect(typeof v === 'string' && v.trim().length > 0, `${k} está vazia`).toBe(true)
      }
    })
  }

  it('a lista do código é a do CHECK da 1005', () => {
    const migration = readFileSync('supabase/migrations/1005_cb_execucao_interrompida.sql', 'utf8')
    const check = migration.match(/interrompida_por in \(([^)]*)\)/)?.[1] ?? ''
    const doBanco = [...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
    expect(doBanco).toEqual([...MOTIVOS_DA_INTERRUPCAO].sort())
  })
})
