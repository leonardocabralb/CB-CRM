import { describe, expect, it } from 'vitest'

import { CHAVE_SEM_CARIMBO, minutosRestantesNoMapa, seloDaJanela } from '@/lib/inbox/selo-da-janela'

import { janelaDaMetaAberta } from './janela-da-meta'

const AGORA = Date.parse('2026-09-26T15:00:00Z')
const min = (n: number) => new Date(AGORA - n * 60_000).toISOString()

const OFICIAL = { provider: 'meta', channelId: 'canal-oficial' }
const OUTRO_OFICIAL = { provider: 'meta', channelId: 'canal-oficial-2' }
const QR_CODE = { provider: 'evolution', channelId: 'canal-qr' }
const INSTAGRAM = { provider: 'instagram', channelId: 'canal-ig' }
/** O espelho legado `whatsapp_config`: número oficial sem conexão. */
const LEGADO = { provider: 'meta', channelId: null }

describe('janelaDaMetaAberta — "sim: texto; não: modelo"', () => {
  it('cliente escreveu há 2h pelo número de saída: aberta', () => {
    expect(janelaDaMetaAberta({ janela_meta: { 'canal-oficial': min(120) } }, OFICIAL, AGORA)).toBe(true)
  })

  it('passou das 24h: fechada; no último minuto, ainda aberta', () => {
    expect(janelaDaMetaAberta({ janela_meta: { 'canal-oficial': min(24 * 60) } }, OFICIAL, AGORA)).toBe(false)
    expect(janelaDaMetaAberta({ janela_meta: { 'canal-oficial': min(24 * 60 - 1) } }, OFICIAL, AGORA)).toBe(true)
  })

  it('a janela é POR NÚMERO: a do outro oficial não abre esta', () => {
    const c = { janela_meta: { 'canal-oficial-2': min(10) } }
    expect(janelaDaMetaAberta(c, OFICIAL, AGORA)).toBe(false)
    expect(janelaDaMetaAberta(c, OUTRO_OFICIAL, AGORA)).toBe(true)
  })

  it('mensagem da Meta sem carimbo conta para qualquer oficial, como no fio', () => {
    expect(janelaDaMetaAberta({ janela_meta: { [CHAVE_SEM_CARIMBO]: min(30) } }, OFICIAL, AGORA)).toBe(true)
  })

  it('cliente que nunca escreveu pelo oficial (mapa vazio ou nulo): FECHADA — ao contrário do fio vazio', () => {
    expect(janelaDaMetaAberta({ janela_meta: {} }, OFICIAL, AGORA)).toBe(false)
    expect(janelaDaMetaAberta({ janela_meta: null }, OFICIAL, AGORA)).toBe(false)
    expect(janelaDaMetaAberta({}, OFICIAL, AGORA)).toBe(false)
  })

  it('QR Code (Evolution) responde SEMPRE sim: não há janela', () => {
    expect(janelaDaMetaAberta({ janela_meta: null }, QR_CODE, AGORA)).toBe(true)
    expect(janelaDaMetaAberta({ janela_meta: { 'canal-oficial': min(48 * 60) } }, QR_CODE, AGORA)).toBe(true)
  })

  it('grupo não tem janela: sim', () => {
    expect(janelaDaMetaAberta({ group_id: 'g1', janela_meta: null }, OFICIAL, AGORA)).toBe(true)
  })

  it('Instagram e "sem número de saída": não', () => {
    expect(janelaDaMetaAberta({ janela_meta: { 'canal-ig': min(5) } }, INSTAGRAM, AGORA)).toBe(false)
    expect(janelaDaMetaAberta({ janela_meta: { 'canal-oficial': min(5) } }, null, AGORA)).toBe(false)
  })

  it('número oficial LEGADO (sem id de conexão) lê a chave sem carimbo', () => {
    expect(janelaDaMetaAberta({ janela_meta: { [CHAVE_SEM_CARIMBO]: min(5) } }, LEGADO, AGORA)).toBe(true)
    expect(minutosRestantesNoMapa({ [CHAVE_SEM_CARIMBO]: min(60) }, null, AGORA)).toBe(23 * 60)
  })
})

describe('a mesma régua da ampulheta — menos a recusa de TELA', () => {
  const casos: Record<string, string>[] = [
    { 'canal-oficial': min(1) },
    { 'canal-oficial': min(13 * 60) },
    { 'canal-oficial': min(24 * 60) },
    { 'canal-oficial-2': min(10) },
    { [CHAVE_SEM_CARIMBO]: min(200), 'canal-oficial': min(30 * 60) },
    {},
  ]

  it('conversa aberta: "aberta" ⇔ a ampulheta aparece', () => {
    for (const mapa of casos) {
      const selo = seloDaJanela(
        { status: 'open', group_id: null, janela_meta: mapa },
        { id: 'canal-oficial', kind: 'meta' },
        AGORA
      )
      expect(janelaDaMetaAberta({ janela_meta: mapa }, OFICIAL, AGORA)).toBe(selo !== null)
    }
  })

  it('conversa ENCERRADA: o selo cala, a janela continua — o lembrete sai para quem sumiu', () => {
    const mapa = { 'canal-oficial': min(60) }
    expect(
      seloDaJanela({ status: 'closed', group_id: null, janela_meta: mapa }, { id: 'canal-oficial', kind: 'meta' }, AGORA)
    ).toBeNull()
    expect(janelaDaMetaAberta({ janela_meta: mapa }, OFICIAL, AGORA)).toBe(true)
  })
})
