import { describe, it, expect } from 'vitest'
import {
  claimVivo,
  descarteFoiSobreFalha,
  precisaDeAnalise,
  THROTTLE_MS,
  TRAVADA_MIN,
} from './worker'

// A regra de candidatura já produziu o bug mais caro da revisão da 941:
// linha `failed` que nunca teve sucesso (janela_fim NULL) era lida como
// "tem mensagem nova" e furava o teto de tentativas — retentativa PAGA a
// cada ciclo, para sempre, ocupando as vagas do lote. Estes testes fixam
// as regras de quem entra no lote.

const AGORA = Date.parse('2026-08-26T15:00:00Z')
const conversa = (lastMessageAt: string | null) => ({
  id: 'c1',
  account_id: 'a1',
  channel_id: 'ch1',
  last_message_at: lastMessageAt,
})
const insight = (o: {
  status: string
  janela_fim?: string | null
  analisado_em?: string | null
  tentativas?: number
  running_desde?: string | null
}) => ({
  id: 'i1',
  conversation_id: 'c1',
  status: o.status,
  janela_fim: o.janela_fim ?? null,
  analisado_em: o.analisado_em ?? null,
  tentativas: o.tentativas ?? 0,
  running_desde: o.running_desde ?? null,
})

describe('precisaDeAnalise', () => {
  it('conversa sem insight é candidata', () => {
    expect(precisaDeAnalise(conversa('2026-08-26T14:00:00Z'), undefined, AGORA)).toBe(true)
  })

  it('running nunca é candidata (outro worker está nela)', () => {
    expect(
      precisaDeAnalise(conversa('2026-08-26T14:00:00Z'), insight({ status: 'running' }), AGORA),
    ).toBe(false)
  })

  it('failed que NUNCA teve sucesso PARA no teto de tentativas', () => {
    // O bug: janela_fim NULL era lido como "tem mensagem nova" e o teto
    // nunca era avaliado.
    expect(
      precisaDeAnalise(
        conversa('2026-08-26T14:00:00Z'),
        insight({ status: 'failed', janela_fim: null, tentativas: 3 }),
        AGORA,
      ),
    ).toBe(false)
  })

  it('failed abaixo do teto retenta', () => {
    expect(
      precisaDeAnalise(
        conversa('2026-08-26T14:00:00Z'),
        insight({ status: 'failed', janela_fim: null, tentativas: 2 }),
        AGORA,
      ),
    ).toBe(true)
  })

  it('failed acima do teto volta SÓ com mensagem nova DE VERDADE', () => {
    const comSucessoAntigo = insight({
      status: 'failed',
      janela_fim: '2026-08-26T10:00:00Z',
      tentativas: 9,
    })
    expect(precisaDeAnalise(conversa('2026-08-26T14:00:00Z'), comSucessoAntigo, AGORA)).toBe(
      true,
    )
    expect(precisaDeAnalise(conversa('2026-08-26T09:00:00Z'), comSucessoAntigo, AGORA)).toBe(
      false,
    )
  })

  it('done sem mensagem nova não é candidata', () => {
    expect(
      precisaDeAnalise(
        conversa('2026-08-26T09:00:00Z'),
        insight({
          status: 'done',
          janela_fim: '2026-08-26T10:00:00Z',
          analisado_em: '2026-08-26T10:00:00Z',
        }),
        AGORA,
      ),
    ).toBe(false)
  })

  it('done com mensagem nova respeita o throttle', () => {
    const base = {
      status: 'done',
      janela_fim: '2026-08-26T14:00:00Z',
    }
    const recemAnalisada = insight({
      ...base,
      analisado_em: new Date(AGORA - THROTTLE_MS / 2).toISOString(),
    })
    const analisadaHaTempo = insight({
      ...base,
      analisado_em: new Date(AGORA - THROTTLE_MS - 60_000).toISOString(),
    })
    const conversaComNovidade = conversa('2026-08-26T14:59:00Z')
    expect(precisaDeAnalise(conversaComNovidade, recemAnalisada, AGORA)).toBe(false)
    expect(precisaDeAnalise(conversaComNovidade, analisadaHaTempo, AGORA)).toBe(true)
  })
})

// ============================================================
// As DUAS réguas de "gente" excluem a agendada (#21 do plano de 31/08).
//
// A agendada sai COM `sender_id` — o de quem a criou, dias antes — então
// pela coluna sozinha ela conta como resposta humana nas duas réguas do
// worker: a do painel (`porGente`) e a da preservação
// (`houveHumanoNaJanela`). O PR #74 corrigiu uma e esqueceu a outra: um
// follow-up agendado disparando sobre pendência congelada pulava o ramo
// preservador e o UPDATE completo zerava o alarme do cliente esquecido.
//
// As réguas são DIFERENTES de propósito (`from_device` só alarga a do
// painel), então não dá para unificá-las num helper testável — este pino
// estrutural cobra que a EXCLUSÃO exista nas duas, e reprova se um merge
// devolver qualquer uma à forma antiga. Contraprova por mutação feita em
// 31/08: remover a exclusão de qualquer uma das duas derruba o teste.
// ============================================================

import fs from 'node:fs'
import path from 'node:path'

describe('exclusão da agendada nas duas réguas de humano (#21)', () => {
  const fonte = fs
    .readFileSync(path.join(__dirname, 'worker.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('`porGente` e `houveHumanoNaJanela` carregam `!deAgendada.has`', () => {
    const ocorrencias = fonte.match(/!deAgendada\.has\(m\.id\)/g) ?? []
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2)
  })

  it('a exclusão está DENTRO do `houveHumanoNaJanela` — não noutro lugar', () => {
    const inicio = fonte.indexOf('const houveHumanoNaJanela')
    expect(inicio).toBeGreaterThan(-1)
    const trecho = fonte.slice(inicio, inicio + 300)
    expect(trecho).toContain('!deAgendada.has(m.id)')
    expect(trecho).toContain('sender_id !== null')
  })
})

describe('claimVivo (#28)', () => {
  // `running` órfão (worker morto por rollout — que acontece a cada merge
  // no main) não pode congelar Tratar/Descartar/Reanalisar por 10–25 min.
  const agora = Date.parse('2026-08-31T12:00:00Z')

  it('claim fresco é vivo; velho, nulo e lixo são abandonados', () => {
    expect(claimVivo(new Date(agora - 60_000).toISOString(), agora)).toBe(true)
    expect(
      claimVivo(new Date(agora - (TRAVADA_MIN * 60_000 + 1)).toISOString(), agora),
    ).toBe(false)
    expect(claimVivo(null, agora)).toBe(false)
    expect(claimVivo('nao-e-data', agora)).toBe(false)
  })

  it('offsets diferentes não invertem a régua — comparação por instante', () => {
    // O mesmo instante (11:59Z) escrito de dois jeitos: os dois são vivos.
    expect(claimVivo('2026-08-31T11:59:00+00:00', agora)).toBe(true)
    expect(claimVivo('2026-08-31T08:59:00-03:00', agora)).toBe(true)
  })
})

describe('descarteFoiSobreFalha (#23)', () => {
  // A exceção ESTREITA à regra "descartado nunca reabre": só a linha
  // `failed` que nunca teve análise concluída — ali o operador descartou o
  // aviso "análise falhou", não um veredito da IA, e a linha reanalisa
  // sozinha no ciclo seguinte (tentativas < 3), deixando o sinal real
  // invisível para sempre sob o descarte.
  it('failed sem análise concluída: o descarte era sobre a falha', () => {
    expect(
      descarteFoiSobreFalha(insight({ status: 'failed', analisado_em: null })),
    ).toBe(true)
  })

  it('failed com análise antiga por baixo NÃO entra na exceção', () => {
    // Havia conteúdo real no cartão (a análise velha) — foi ele que o
    // descarte rejeitou; reabrir repetiria o falso positivo.
    expect(
      descarteFoiSobreFalha(
        insight({ status: 'failed', analisado_em: '2026-08-25T10:00:00Z' }),
      ),
    ).toBe(false)
  })

  it('done e ausente ficam na regra geral', () => {
    expect(
      descarteFoiSobreFalha(
        insight({ status: 'done', analisado_em: '2026-08-26T10:00:00Z' }),
      ),
    ).toBe(false)
    expect(descarteFoiSobreFalha(undefined)).toBe(false)
  })

  it('o fio está ligado: os DOIS call sites passam o flag e o update confere o estado', () => {
    // A regra pura acima não prova que alguém a chama. O flag tem de ser
    // calculado no CHAMADOR (depois do UPDATE principal o analisado_em
    // antigo já foi sobrescrito) — no ciclo e na reanálise manual — e o
    // update da reabertura confere `estado='descartado'` na hora (clique
    // do operador no meio-tempo vira no-op).
    const fonte = fs
      .readFileSync(path.join(__dirname, 'worker.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    const chamadas = fonte.match(/descarteSobreFalha: descarteFoiSobreFalha\(/g) ?? []
    expect(chamadas.length).toBe(2)
    const reabre = fonte.indexOf('args.descarteSobreFalha')
    expect(reabre).toBeGreaterThan(-1)
    expect(fonte.slice(reabre, reabre + 400)).toContain("eq('estado', 'descartado')")
  })
})

describe('cerca do recolhedor de travadas (Codex, PR #89)', () => {
  const fonte = fs
    .readFileSync(path.join(__dirname, 'worker.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  // Entre o SELECT das presas e o UPDATE de cada uma cabe uma reanálise
  // manual TOMANDO o claim abandonado (#28). O UPDATE tem de exigir o MESMO
  // `running_desde` velho que o SELECT viu — senão marca `failed` o claim
  // fresco e a escrita cercada do worker vivo é descartada.
  it('o SELECT das presas traz `running_desde`, e o UPDATE o exige de volta', () => {
    const inicio = fonte.indexOf('async function recolherTravadas')
    expect(inicio).toBeGreaterThan(-1)
    const fim = fonte.indexOf('async function reivindicar', inicio)
    const corpo = fonte.slice(inicio, fim)
    expect(corpo).toContain("select('id, tentativas, running_desde')")
    expect(corpo).toContain("base.is('running_desde', null)")
    expect(corpo).toContain("base.eq('running_desde', p.running_desde)")
  })

  it('claim tomado no meio NÃO conta como recolhido (o update confere o retorno)', () => {
    const inicio = fonte.indexOf('async function recolherTravadas')
    const fim = fonte.indexOf('async function reivindicar', inicio)
    const corpo = fonte.slice(inicio, fim)
    expect(corpo).toContain('.maybeSingle()')
    expect(corpo).toContain('else if (!data)')
  })
})
