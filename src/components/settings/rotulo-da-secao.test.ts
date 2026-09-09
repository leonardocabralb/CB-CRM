import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS } from './settings-sections';

// ============================================================
// O MESMO BURACO DO `rotulo-do-gatilho.test.ts`, noutra tela.
//
// O rail de Configurações pede o rótulo por chave MONTADA
// (`t(\`sections.${s}\`)`, em `settings-rail.tsx`). Chave montada está fora
// do alcance do portão de i18n do CI, então dava para acrescentar uma seção,
// o CI ficar verde, e o menu mostrar `Settings.sections.webhooks` — cru — no
// lugar do nome.
//
// Não é hipótese: aconteceu ao acrescentar a seção Webhooks (982), e só a
// verificação na tela pegou. Este teste é o par que faltava.
// ============================================================

function secoesDoDicionario(arquivo: string): Record<string, unknown> {
  const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'));
  return bruto.Settings.sections;
}

describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const sections = secoesDoDicionario(arquivo);

  it('CRÍTICO: toda seção de Configurações tem rótulo', () => {
    const semRotulo = SETTINGS_SECTIONS.filter(
      (s) => typeof sections[s] !== 'string'
    );
    expect(semRotulo).toEqual([]);
  });

  it('não sobra seção órfã no dicionário', () => {
    const conhecidas = new Set<string>(SETTINGS_SECTIONS);
    expect(Object.keys(sections).filter((k) => !conhecidas.has(k))).toEqual([]);
  });
});
