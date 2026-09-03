// A descrição do recorte tem UMA fonte — `descreverFiltro`, em
// `lib/inbox/filtros-salvos.ts` (M21 do plano de 31/08). Até 03/09 quem a
// consumia na tela eram as pastilhas do painel; elas SAÍRAM (decisão do
// operador: com um filtro salvo aplicado viravam um aglomerado) e a
// consumidora passou a ser a fileira de visões, que descreve cada chip no
// `title` e os diálogos de salvar/gerir. O que este teste segura: ninguém
// volta a montar a descrição à mão, nem no painel nem na fileira.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const semComentarios = (nome: string) =>
  fs
    .readFileSync(path.join(__dirname, nome), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const painel = semComentarios('inbox-filters.tsx');
const visoes = semComentarios('visoes-salvas.tsx');

describe('descrição do recorte: uma fonte só (M21)', () => {
  it('a fileira de visões descreve pelo módulo', () => {
    expect(visoes).toContain('descreverFiltro(f, catalogos)');
  });

  it('o painel NÃO descreve mais o recorte (as pastilhas saíram em 03/09)', () => {
    expect(painel).not.toContain('descreverFiltro(');
    expect(painel).not.toMatch(/pastilhas\.push\(/);
    expect(painel).not.toMatch(/aoRemover: \(\) => mexer\(\{ \w+:/);
  });

  it('ninguém reescreve o texto de um pedaço fora de `textoDoPedaco`', () => {
    // "(apagado)" é decisão do módulo (`orfao`), traduzida num lugar só.
    expect(visoes.match(/deletedRef/g)?.length ?? 0).toBe(1);
    expect(painel).not.toContain('deletedRef');
  });
});
