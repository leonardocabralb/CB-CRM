import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { TRIGGER_META } from './trigger-meta'

// ============================================================
// O BURACO QUE ESTE TESTE FECHA
//
// A tela pede o rótulo do gatilho por chave MONTADA
// (`t(\`triggers.${type}.label\`)`, em `automation-builder.tsx` e em
// `automations-board.tsx`). Chave montada está FORA do alcance do portão
// de i18n do CI — `scripts/i18n-chaves-usadas.mjs` declara isso no próprio
// cabeçalho e apenas CONTA as dinâmicas que ignorou.
//
// Resultado, até este teste existir: dava para acrescentar um gatilho, o CI
// ficar inteiro verde, e o operador ver
// `Automations.builder.triggers.webhook_received.label` — cru — dentro do
// `<select>` do construtor e no cartão da grade do funil. É o mesmo defeito
// que `descrever-passo.test.ts` já previne do lado dos PASSOS; do lado dos
// GATILHOS ninguém tinha escrito o par.
//
// Itera `TRIGGER_META`, e não a lista do construtor, de propósito: aquele é
// um `Record` sobre `AutomationTriggerType` inteiro, então ele cobre também
// o gatilho aposentado que uma automação antiga ainda carrega — que a tela
// RENDERIZA, por `opcoesDeGatilho`.
// ============================================================

const TIPOS = Object.keys(TRIGGER_META).sort()

function gatilhosDoDicionario(arquivo: string): Record<string, unknown> {
  const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'))
  return bruto.Automations.builder.triggers
}

describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const triggers = gatilhosDoDicionario(arquivo)

  it('CRÍTICO: todo gatilho tem label', () => {
    const semLabel = TIPOS.filter(
      (t) =>
        typeof (triggers[t] as { label?: unknown } | undefined)?.label !==
        'string'
    )
    expect(semLabel).toEqual([])
  })

  it('CRÍTICO: todo gatilho tem hint', () => {
    // A dica é o que explica QUANDO a regra dispara. Sem ela o operador
    // escolhe pelo nome e descobre o comportamento em produção.
    const semHint = TIPOS.filter(
      (t) =>
        typeof (triggers[t] as { hint?: unknown } | undefined)?.hint !== 'string'
    )
    expect(semHint).toEqual([])
  })

  it('não sobra gatilho órfão no dicionário', () => {
    // Chave que nenhum gatilho usa é texto que envelhece sem ninguém notar.
    expect(Object.keys(triggers).filter((k) => !TIPOS.includes(k))).toEqual([])
  })
})
