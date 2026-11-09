import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CustomField } from '@/types'
import { TETO_DA_LEITURA_DO_ACERVO } from '@/lib/acervo/filtro'
import {
  acervoParaConferir,
  camposParaConferir,
  conferirParaLigar,
  TETO_DE_LINHAS,
  type ConferenciaParaLigar,
} from './conferir-para-ligar'
import { localizarPendencias } from './pendencias'

const base: ConferenciaParaLigar = {
  triggerType: 'manual',
  triggerConfig: {},
  channelIds: null,
  steps: [],
  canais: [],
  campos: new Map(),
  acervo: new Set(),
}

describe('conferirParaLigar', () => {
  it('o caso real: a tarefa sem responsável no ramo NÃO, com o endereço que a tela localiza', () => {
    const tarefa = { step_type: 'create_task', step_config: { titulo: 'Conferir documentos', responsavel_modo: 'fixo' } }
    const steps = [
      {
        step_type: 'condition',
        step_config: { subject: 'tag_presence', operand: 'x' },
        branches: { yes: [], no: [{ step_type: 'close_conversation', step_config: {} }, tarefa] },
      },
    ]
    const issues = conferirParaLigar({ ...base, steps })
    expect(issues.map((i) => [i.path, i.codigo])).toEqual([
      ['steps[0].no.steps[1].responsavel_user_id', 'tarefa_sem_responsavel'],
    ])
    // A tela localiza pela árvore com `cid` — a mesma forma, com o id do passo.
    interface No {
      cid: string
      step_type: string
      branches?: { yes: No[]; no: No[] }
    }
    const arvore: No[] = [
      {
        cid: 'cond',
        step_type: 'condition',
        branches: { yes: [], no: [{ cid: 'fechar', step_type: 'close_conversation' }, { cid: 'tarefa', step_type: 'create_task' }] },
      },
    ]
    expect([...localizarPendencias(arvore, issues).porPasso.keys()]).toEqual(['tarefa'])
  })

  it('gatilho primeiro, depois os passos — a ordem das rotas', () => {
    const issues = conferirParaLigar({
      ...base,
      triggerType: 'tag_added',
      steps: [{ step_type: 'send_message', step_config: {} }],
    })
    expect(issues.map((i) => i.path)).toEqual(['trigger.tag_id', 'steps[0].text'])
  })

  it('canal e campo com lista NÃO carregada (null): aquela conferência é pulada, nunca "não existe"', () => {
    const steps = [
      {
        step_type: 'condition',
        step_config: { subject: 'custom_field', operand: '00000000-0000-4000-8000-000000000001', operator: 'not_empty' },
        branches: { yes: [], no: [] },
      },
    ]
    expect(conferirParaLigar({ ...base, steps, campos: null })).toEqual([])
    // Com a lista carregada e sem o campo, é pendência (o que a rota diria).
    expect(conferirParaLigar({ ...base, steps }).map((i) => i.path)).toEqual(['steps[0].operand'])
  })

  it('o item do ACERVO apagado (09/11/2026): pendência com a lista carregada; pulada com ela null', () => {
    const item = '00000000-0000-4000-8000-0000000000aa'
    const steps = [{ step_type: 'send_media', step_config: { kind: 'video', url: 'https://x/v.mp4', acervo_id: item } }]
    expect(conferirParaLigar({ ...base, steps }).map((i) => [i.path, i.codigo])).toEqual([
      ['steps[0].acervo_id', 'midia_do_acervo_apagada'],
    ])
    expect(conferirParaLigar({ ...base, steps, acervo: new Set([item]) })).toEqual([])
    expect(conferirParaLigar({ ...base, steps, acervo: null })).toEqual([])
  })
})

describe('acervoParaConferir (09/11/2026)', () => {
  const item = (id: string, account_id: string) => ({ id, account_id })

  it('só os itens DA CONTA, somados aos escolhidos agora no seletor', () => {
    const ids = acervoParaConferir([item('a', 'c1'), item('b', 'c2')], 'c1', ['novo'])
    expect([...(ids ?? [])].sort()).toEqual(['a', 'novo'])
  })

  it('o escolhido AGORA conta mesmo que a lista lida seja de antes dele (subido noutra aba)', () => {
    expect(acervoParaConferir([], 'c1', new Set(['recém-subido']).keys())?.has('recém-subido')).toBe(true)
  })

  it('falha ABERTA: sem conta, sem lista (carregando ou falhou) ou com a lista no teto = null', () => {
    expect(acervoParaConferir([item('a', 'c1')], null)).toBeNull()
    expect(acervoParaConferir(null, 'c1', ['x'])).toBeNull()
    const cheia = Array.from({ length: TETO_DA_LEITURA_DO_ACERVO }, (_, i) => item(`i${i}`, 'c1'))
    expect(acervoParaConferir(cheia, 'c1')).toBeNull()
    expect(acervoParaConferir(cheia.slice(1), 'c1')?.size).toBe(TETO_DA_LEITURA_DO_ACERVO - 1)
  })
})

describe('camposParaConferir', () => {
  const campo = (id: string, account_id: string): CustomField =>
    ({ id, account_id, field_name: id, field_type: 'text', field_options: null }) as unknown as CustomField

  it('só os campos DA CONTA — a leitura do navegador traz os de toda conta da pessoa', () => {
    const mapa = camposParaConferir([campo('a', 'c1'), campo('b', 'c2')], 'c1')
    expect([...(mapa?.keys() ?? [])]).toEqual(['a'])
  })

  it('sem conta conhecida: null (pula a conferência)', () => {
    expect(camposParaConferir([campo('a', 'c1')], null)).toBeNull()
  })

  it('lista que pode ter vindo cortada pelo teto do PostgREST: null (a rota decide)', () => {
    const cheia = Array.from({ length: TETO_DE_LINHAS }, (_, i) => campo(`f${i}`, 'c1'))
    expect(camposParaConferir(cheia, 'c1')).toBeNull()
    expect(camposParaConferir(cheia.slice(1), 'c1')?.size).toBe(TETO_DE_LINHAS - 1)
  })
})

// A tela roda as MESMAS validações das rotas antes de mandar o pedido. Uma
// validação nova numa rota, esquecida aqui, faria a tela liberar o que o
// servidor recusa — sem quebrar nada, só com a marca vermelha chegando tarde.
describe('pino: as mesmas validações das rotas de automação', () => {
  const RAIZ = join(__dirname, '..', '..', '..')
  const nomes = (arquivo: string) =>
    new Set(readFileSync(join(RAIZ, arquivo), 'utf8').match(/\bvalidate\w+ForActivation\b/g) ?? [])

  it('criar, editar e a conferência da tela chamam o mesmo conjunto', () => {
    const daTela = nomes('src/lib/automations/conferir-para-ligar.ts')
    expect(daTela.size).toBe(7)
    expect(nomes('src/app/api/automations/route.ts')).toEqual(daTela)
    expect(nomes('src/app/api/automations/[id]/route.ts')).toEqual(daTela)
  })
})
