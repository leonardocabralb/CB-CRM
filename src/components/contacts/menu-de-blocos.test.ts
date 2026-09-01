import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// M21 — o menu de blocos era escrito duas vezes, e as cópias JÁ DIVERGIRAM.
//
// Medido antes da extração: a ficha de `/contatos` usava `text-xs` (12px)
// com as classes num ternário; o painel da conversa, `text-[11px]` com
// `cn()`. O mesmo widget, dois tamanhos de fonte, sem ninguém ter decidido
// isso — e as duas telas editam o MESMO dado.
//
// Divergência de aparência é barata; o que ela anuncia não é. O gate "some
// com menos de dois blocos" e a resolução do bloco à vista são regras de
// produto (966), e mantê-las em duplicata é esperar que a próxima correção
// entre em uma cópia só.
// ============================================================

const raiz = path.join(__dirname, '..', '..');

function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const FICHAS = [
  'components/contacts/contact-detail-view.tsx',
  'components/inbox/painel/painel-do-contato.tsx',
];

describe('menu de blocos: uma implementação, duas telas (M21)', () => {
  for (const ficha of FICHAS) {
    it(`${ficha} monta o menu pelo componente`, () => {
      expect(fonte(ficha)).toContain('<MenuDeBlocos');
    });

    it(`${ficha} não redesenha as pastilhas à mão`, () => {
      // A forma exata da duplicata: mapear os blocos direto em <button>.
      // É assim que a divergência de fonte nasceu, e um merge do upstream
      // que "restaure" o JSX antigo cai aqui.
      expect(fonte(ficha)).not.toMatch(/blocos(DaFicha)?\.map\([\s\S]{0,300}?<button/);
    });
  }

  it('o gate de "menos de dois blocos" mora NO componente, não nos chamadores', () => {
    // Se o gate voltar para as telas, ele volta a ser duas regras — e a
    // próxima mudança (três blocos? um sempre visível?) entra em uma só.
    const menu = fonte('components/contacts/menu-de-blocos.tsx');
    expect(menu).toContain('if (blocos.length < 2) return null;');
    for (const ficha of FICHAS) {
      expect(fonte(ficha)).not.toMatch(/blocos(DaFicha)?\.length > 1 &&/);
    }
  });
});
