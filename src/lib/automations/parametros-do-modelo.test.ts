import { describe, expect, it } from 'vitest'

import type { MessageTemplate, SendTemplateStepConfig } from '@/types'
import { buildSendComponents } from '@/lib/whatsapp/template-send-builder'

import {
  faltaNoModelo,
  linhaDoModeloNaTela,
  MAX_POSICOES_DO_MODELO,
  montarParametrosDoModelo,
  recortarAoModelo,
  textoDeParametro,
  type Interpolar,
} from './parametros-do-modelo'

// Interpolação de mentira: `{{contact.name}}` vira o nome (ou vazio), e o modo
// cru é marcado para o teste enxergar QUEM pediu dado cru. Com `url`, só o
// valor SUBSTITUÍDO é codificado — como no motor.
function interpolador(nome: string): Interpolar {
  return async (texto, { cru, url }) => {
    const v = (x: string) => (url ? encodeURIComponent(x) : x)
    return texto
      .replace(/\{\{contact\.name\}\}/g, v(nome))
      .replace(/\{\{deal\.value\}\}/g, v(cru ? '3500' : 'R$ 3.500,00'))
  }
}

function cfg(extra: Partial<SendTemplateStepConfig>): SendTemplateStepConfig {
  return { template_name: 'boas_vindas', language: 'pt_BR', ...extra }
}

function modelo(extra: Partial<MessageTemplate>): MessageTemplate {
  return {
    id: 't1',
    user_id: 'u1',
    name: 'boas_vindas',
    category: 'Utility',
    language: 'pt_BR',
    body_text: 'Olá {{1}}, seu contrato de {{2}} foi recebido.',
    created_at: '2026-09-01T00:00:00Z',
    ...extra,
  }
}

describe('montarParametrosDoModelo', () => {
  it('interpola cada {{N}} do corpo, na POSIÇÃO', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ variables: { '1': '{{contact.name}}', '2': '{{deal.value}}' } }),
      interpolador('Ana')
    )
    expect(p.body).toEqual(['Ana', 'R$ 3.500,00'])
  })

  it('valor vazio cai na reserva', async () => {
    const p = await montarParametrosDoModelo(
      cfg({
        variables: { '1': '{{contact.name}}', '2': 'auxílio' },
        variaveis_reserva: { '1': 'cliente' },
      }),
      interpolador('')
    )
    expect(p.body).toEqual(['cliente', 'auxílio'])
  })

  it('sem valor e sem reserva, sai VAZIO — quem barra é faltaNoModelo', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ variables: { '1': '{{contact.name}}' } }),
      interpolador('')
    )
    expect(p.body).toEqual([''])
  })

  it('posição que falta fica vazia no LUGAR dela — não empurra a seguinte', async () => {
    // A versão anterior ordenava e compactava: o "c" saía como {{2}}.
    const p = await montarParametrosDoModelo(
      cfg({ variables: { '1': 'a', '3': 'c' } }),
      interpolador('')
    )
    expect(p.body).toEqual(['a', '', 'c'])
  })

  it('10 ou mais variáveis ficam em ordem NUMÉRICA', async () => {
    const variables: Record<string, string> = {}
    for (let n = 1; n <= 11; n++) variables[String(n)] = `v${n}`
    const p = await montarParametrosDoModelo(cfg({ variables }), interpolador(''))
    expect(p.body[9]).toBe('v10')
    expect(p.body[10]).toBe('v11')
  })

  it('chave que não é posição é ignorada', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ variables: { nome: 'x', '1': 'a' } }),
      interpolador('')
    )
    expect(p.body).toEqual(['a'])
  })

  it('config antiga, sem nada de novo, continua valendo (valores literais)', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ variables: { '1': 'Maria', '2': 'amanhã' } }),
      interpolador('')
    )
    expect(p).toEqual({ body: ['Maria', 'amanhã'] })
  })

  it('achata quebra de linha, tabulação e espaços seguidos (a Meta recusa, 132018)', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ variables: { '1': 'linha 1\nlinha 2\t\tfim      ok' } }),
      interpolador('')
    )
    expect(p.body).toEqual(['linha 1 linha 2 fim ok'])
    expect(textoDeParametro('  a  \n ')).toBe('a')
  })

  it('cabeçalho de texto com reserva; arquivo do cabeçalho literal', async () => {
    const p = await montarParametrosDoModelo(
      cfg({
        header_text: '{{contact.name}}',
        header_text_reserva: 'Olá',
        header_media_url: ' https://x.test/a.png ',
      }),
      interpolador('')
    )
    expect(p.headerText).toBe('Olá')
    expect(p.headerMediaUrl).toBe('https://x.test/a.png')
  })

  it('número e booleano gravados pela API viram texto, como antes (String(v))', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ variables: { '1': 123, '2': true } as unknown as Record<string, string> }),
      interpolador('')
    )
    expect(p.body).toEqual(['123', 'true'])
  })

  it('posição acima do teto é ignorada — nada de laço de um milhão de voltas', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ variables: { '1': 'a', '999999': 'x' } }),
      interpolador('')
    )
    expect(p.body).toEqual(['a'])
    const noTeto = await montarParametrosDoModelo(
      cfg({ variables: { [String(MAX_POSICOES_DO_MODELO)]: 'z' } }),
      interpolador('')
    )
    expect(noTeto.body).toHaveLength(MAX_POSICOES_DO_MODELO)
  })

  it('botão de URL: o valor substituído sai CODIFICADO; o literal do operador, não', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ button_params: { '0': 'caso/{{contact.name}}' } }),
      interpolador('Ana Maria/2?x#y')
    )
    expect(p.buttonParams).toEqual({ 0: 'caso/Ana%20Maria%2F2%3Fx%23y' })
  })

  it('botão de URL: dado CRU e sem espaço', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ button_params: { '1': 'pagar/{{deal.value}} ' } }),
      interpolador('')
    )
    expect(p.buttonParams).toEqual({ 1: 'pagar/3500' })
  })
})

describe('faltaNoModelo', () => {
  it('nada falta: null', async () => {
    const p = await montarParametrosDoModelo(
      cfg({ variables: { '1': 'Ana', '2': 'AA' } }),
      interpolador('')
    )
    expect(faltaNoModelo(modelo({}), p)).toBeNull()
  })

  it('variável que o modelo pede e saiu vazia: a frase diz qual', () => {
    expect(faltaNoModelo(modelo({}), { body: ['Ana'] })).toContain('{{2}}')
    expect(faltaNoModelo(modelo({}), { body: ['', 'AA'] })).toContain('{{1}}')
  })

  it('valor a mais, que o modelo não pede, não importa', () => {
    expect(
      faltaNoModelo(modelo({ body_text: 'Olá {{1}}' }), { body: ['Ana', ''] })
    ).toBeNull()
  })

  it('sem a linha do modelo, só confere que nada configurado saiu vazio', () => {
    expect(faltaNoModelo(null, { body: [] })).toBeNull()
    expect(faltaNoModelo(null, { body: ['a', ''] })).toContain('{{2}}')
  })

  it('cabeçalho de texto com variável exige valor', () => {
    const m = modelo({ body_text: 'Oi', header_type: 'text', header_content: 'Caso {{1}}' })
    expect(faltaNoModelo(m, { body: [] })).toContain('cabeçalho')
    expect(faltaNoModelo(m, { body: [], headerText: 'AA' })).toBeNull()
    // Cabeçalho de texto FIXO não pede nada.
    expect(faltaNoModelo(modelo({ body_text: 'Oi', header_type: 'text', header_content: 'Fixo' }), { body: [] })).toBeNull()
  })

  it('cabeçalho de mídia: o arquivo do modelo basta; sem ele, exige o do passo', () => {
    const semArquivo = modelo({ body_text: 'Oi', header_type: 'video' })
    expect(faltaNoModelo(semArquivo, { body: [] })).toContain('vídeo')
    expect(faltaNoModelo(semArquivo, { body: [], headerMediaUrl: 'https://x/v.mp4' })).toBeNull()
    expect(
      faltaNoModelo(modelo({ body_text: 'Oi', header_type: 'image', header_media_url: 'https://x/i.png' }), { body: [] })
    ).toBeNull()
  })

  it('botão de URL com {{1}} exige o final do endereço', () => {
    const m = modelo({
      body_text: 'Oi',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Sim' },
        { type: 'URL', text: 'Assinar', url: 'https://assina.test/{{1}}' },
      ],
    })
    expect(faltaNoModelo(m, { body: [] })).toContain('Assinar')
    expect(faltaNoModelo(m, { body: [], buttonParams: { 1: 'abc' } })).toBeNull()
  })

  it('o que passa aqui passa em buildSendComponents (a outra régua, em inglês)', () => {
    const m = modelo({
      header_type: 'text',
      header_content: 'Caso {{1}}',
      buttons: [{ type: 'URL', text: 'Assinar', url: 'https://assina.test/{{1}}' }],
    })
    const p = { body: ['Ana', 'AA'], headerText: 'X', buttonParams: { 0: 'abc' } }
    expect(faltaNoModelo(m, p)).toBeNull()
    expect(() => buildSendComponents(m, p)).not.toThrow()
    // E o que falta aqui é o que ela recusaria.
    expect(faltaNoModelo(m, { ...p, body: ['Ana'] })).not.toBeNull()
    expect(() => buildSendComponents(m, { ...p, body: ['Ana'] })).toThrow()
  })
})

describe('recortarAoModelo', () => {
  const m = modelo({
    body_text: 'Oi',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Sim' },
      { type: 'URL', text: 'Assinar', url: 'https://assina.test/{{1}}' },
      { type: 'URL', text: 'Site', url: 'https://cb.test' },
    ],
  })

  it('valor que SOBROU num botão de resposta rápida não viaja — trocaria o payload da resposta', () => {
    const p = recortarAoModelo(m, { body: [], buttonParams: { 0: 'sobra', 1: 'abc', 2: 'x' } })
    expect(p.buttonParams).toEqual({ 1: 'abc' })
    expect(buildSendComponents(m, p).filter((c) => c.type === 'button')).toHaveLength(1)
  })

  it('sem botão que use valor, a chave some; sem a linha do modelo, nada muda', () => {
    expect(recortarAoModelo(m, { body: [], buttonParams: { 0: 'sobra' } })).toEqual({ body: [] })
    const p = { body: ['a'], buttonParams: { 0: 'x' } }
    expect(recortarAoModelo(null, p)).toBe(p)
  })

  it('corpo que SOBROU num modelo sem variáveis não vira componente vazio', () => {
    // `buildSendComponents` só pula o corpo com as duas listas vazias: sem o
    // corte, sairia `{ type: 'body', parameters: [] }`.
    const semVariavel = modelo({ body_text: 'Oi, tudo bem?' })
    const p = recortarAoModelo(semVariavel, { body: ['sobra'] })
    expect(p.body).toEqual([])
    expect(buildSendComponents(semVariavel, p).some((c) => c.type === 'body')).toBe(false)
    // Com variáveis, corta só o excesso.
    expect(recortarAoModelo(modelo({}), { body: ['a', 'b', 'c'] }).body).toEqual(['a', 'b'])
  })
})

describe('linhaDoModeloNaTela — espelho de resolveTemplateRow', () => {
  const doA = modelo({ id: 'a', channel_id: 'canal-a', body_text: 'A {{1}}' })
  const doB = modelo({ id: 'b', channel_id: 'canal-b', body_text: 'B {{1}} {{2}}' })
  const global = modelo({ id: 'g', channel_id: null, body_text: 'G' })

  it('com conexão no passo: a linha DAQUELE número', () => {
    expect(linhaDoModeloNaTela([doA, doB], 'boas_vindas', 'pt_BR', 'canal-b').modelo?.id).toBe('b')
  })

  it('conexão sem linha própria: a GLOBAL — nunca a de outro número (é o que o envio faz)', () => {
    expect(linhaDoModeloNaTela([doA, global], 'boas_vindas', 'pt_BR', 'canal-b').modelo?.id).toBe('g')
    expect(linhaDoModeloNaTela([doA], 'boas_vindas', 'pt_BR', 'canal-b').modelo).toBeNull()
  })

  it('idioma pela BASE quando o exato não existe (pt × pt_BR)', () => {
    const pt = modelo({ id: 'pt', language: 'pt' })
    expect(linhaDoModeloNaTela([pt], 'boas_vindas', 'pt_BR', null).modelo?.id).toBe('pt')
  })

  it('sem conexão no passo e o nome em mais de um número: avisa', () => {
    expect(linhaDoModeloNaTela([doA, doB], 'boas_vindas', 'pt_BR', null).emVariosNumeros).toBe(true)
    expect(linhaDoModeloNaTela([doA], 'boas_vindas', 'pt_BR', null).emVariosNumeros).toBe(false)
    // Com conexão escolhida a linha é conhecida: não há o que avisar.
    expect(linhaDoModeloNaTela([doA, doB], 'boas_vindas', 'pt_BR', 'canal-a').emVariosNumeros).toBe(false)
  })
})
