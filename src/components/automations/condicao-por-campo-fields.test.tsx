import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'

import ptBR from '../../../messages/pt-BR.json'
import type { CustomField, GrupoDeCampos } from '@/types'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ accountId: 'acc' }) }))

import { CamposDaCondicaoPorCampo, type EstadoDosCampos } from './condicao-por-campo-fields'

// ============================================================
// A condição "Campo personalizado da ficha" no construtor (2.10): os campos
// repartidos por BLOCO (o "Previdenciário" aparece como grupo), a condição
// que o TIPO aceita, e o valor como uma das OPÇÕES quando o campo é lista.
// Carregando, o gravado é "o campo escolhido", nunca "apagado" nem o UUID.
// ============================================================

const c = ptBR.Automations.builder.config
const PREV: GrupoDeCampos = { id: 'g-prev', account_id: 'acc', nome: 'Previdenciário', posicao: 1, created_at: '' }
const MOTIVO = '11111111-1111-4111-8111-111111111111'
const DATA = '22222222-2222-4222-8222-222222222222'

function campo(id: string, nome: string, tipo: string, extra: Partial<CustomField> = {}): CustomField {
  return {
    id,
    user_id: 'u',
    account_id: 'acc',
    field_name: nome,
    field_type: tipo,
    field_key: nome,
    categoria: 'geral',
    created_at: '',
    ...extra,
  } as CustomField
}

const PRONTO: EstadoDosCampos = {
  status: 'pronto',
  todos: [
    campo(MOTIVO, 'Motivo da desqualificação', 'select', {
      grupo_id: 'g-prev',
      field_options: { opcoes: ['Não respondeu', 'Outro'] },
    }),
    campo(DATA, 'Data e Hora Reunião', 'datetime'),
  ],
  grupos: [PREV],
}

function desenhar(cfg: Record<string, unknown>, estado: EstadoDosCampos = PRONTO) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={ptBR as unknown as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      <CamposDaCondicaoPorCampo cfg={cfg} set={() => {}} estado={estado} tentarDeNovo={() => {}} mostrarCarregando />
    </NextIntlClientProvider>,
  )
}

describe('CamposDaCondicaoPorCampo', () => {
  it('os campos vêm por BLOCO: o "Previdenciário" é um grupo, e o Geral também', () => {
    const html = desenhar({ subject: 'custom_field', operand: '', operator: 'equals' })
    expect(html).toContain('<optgroup label="Previdenciário">')
    expect(html).toContain(`<optgroup label="${c.campoDaFichaBlocoGeral}">`)
    expect(html).toContain('Motivo da desqualificação')
  })

  it('campo de LISTA: o valor é escolhido entre as OPÇÕES, e "contém" não é oferecido', () => {
    const html = desenhar({ operand: MOTIVO, operator: 'equals', value: 'Não respondeu' })
    expect(html).toContain('<option value="Não respondeu" selected="">Não respondeu</option>')
    expect(html).toContain('<option value="Outro">Outro</option>')
    expect(html).not.toContain(`>${c.campoDaFichaOpContains}<`)
  })

  it('opção que não existe mais aparece DITA', () => {
    const html = desenhar({ operand: MOTIVO, operator: 'equals', value: 'Sumiu' })
    expect(html).toContain(c.campoDaFichaOpcaoSumiuHelp)
  })

  it('campo de DATA: só vazio/preenchido, e sem campo de valor', () => {
    const html = desenhar({ operand: DATA, operator: 'empty' })
    expect(html).toContain(c.campoDaFichaDataHelp)
    expect(html).not.toContain(`>${c.campoDaFichaOpEquals}<`)
    expect(html).not.toContain(c.campoDaFichaValor)
  })

  it('carregando: o gravado é "o campo escolhido", nunca "apagado" nem o UUID', () => {
    const html = desenhar({ operand: MOTIVO, operator: 'equals', value: 'x' }, { status: 'carregando' })
    expect(html).toContain(c.campoDaFichaEscolhido)
    expect(html).toContain(c.campoDaFichaCarregando)
    expect(html).not.toContain(c.campoDaFichaSumiu)
    expect(html).not.toContain(`>${MOTIVO}<`)
  })

  it('campo que não existe mais na conta (lista pronta): "apagado", com o aviso', () => {
    const html = desenhar({ operand: '33333333-3333-4333-8333-333333333333', operator: 'empty' })
    expect(html).toContain(c.campoDaFichaApagado)
    expect(html).toContain(c.campoDaFichaSumiu)
  })

  it('leitura que falhou: o aviso e o "tentar de novo"', () => {
    const html = desenhar({ operand: MOTIVO, operator: 'empty' }, { status: 'falhou' })
    expect(html).toContain(c.campoDaFichaFalhou)
    expect(html).toContain(c.campoDaFichaTentarDeNovo)
  })
})

describe('CamposDaCondicaoPorCampo — valor gravado com outra caixa', () => {
  it('"não respondeu" casa com a opção "Não respondeu" (a régua do motor): aparece, sem aviso', () => {
    const html = desenhar({ operand: MOTIVO, operator: 'equals', value: 'não respondeu' })
    expect(html).toContain('<option value="não respondeu" selected="">não respondeu</option>')
    expect(html).not.toContain(c.campoDaFichaOpcaoSumiuHelp)
  })
})
