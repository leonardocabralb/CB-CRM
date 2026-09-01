import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// M21 — "UMA descrição, DUAS superfícies" era só metade verdade.
//
// O cabeçalho de `lib/inbox/filtros-salvos.ts` declara que a descrição do
// recorte mora num lugar só e serve às duas telas. O menu de filtros salvos
// consumia o módulo; o PAINEL montava as pastilhas à mão — o mesmo
// conhecimento escrito duas vezes:
//
//   painel:  aoRemover: () => mexer({ tipo: "todas" })
//   módulo:  limpar:    { tipo: "todas" }
//
// Elas produziam os mesmos pedaços, na mesma ordem, com as mesmas chaves —
// conferido linha a linha antes da troca. Ou seja: não tinham divergido
// AINDA. O elo que segurava era o teste das `AMOSTRAS` (um
// `Record<keyof FiltrosDoInbox, …>` que o compilador cobra), que garantia a
// cobertura de campos e não a igualdade das duas listas.
//
// Agora há uma implementação só. Este pino existe para a regressão natural:
// alguém precisar de uma pastilha "diferente" e voltar a empurrar num array
// local — que é exatamente como a duplicata nasceu da primeira vez.
// ============================================================

const painel = fs
  .readFileSync(path.join(__dirname, 'inbox-filters.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('pastilhas do painel: uma descrição só (M21)', () => {
  it('o painel descreve o recorte pelo módulo', () => {
    expect(painel).toContain('descreverFiltro(filtros, {');
  });

  it('não voltou a montar a lista à mão', () => {
    // A forma exata da duplicata: empurrar pedaços num array local.
    expect(painel).not.toMatch(/pastilhas\.push\(/);
    expect(painel).not.toMatch(/aoRemover: \(\) => mexer\(\{ \w+:/);
  });

  it('a remoção vem do `limpar` do módulo, não de um patch reescrito', () => {
    expect(painel).toContain('aoRemover: () => mexer(p.limpar)');
  });

  it('`orfao` NÃO vira "(apagado)" na pastilha — só no menu', () => {
    // Comportamento que já existia e que o `PedacoDoFiltro` documenta: um id
    // que não resolve pode ser catálogo ainda carregando, e a pastilha
    // mantém o rótulo genérico do campo.
    expect(painel).not.toContain('deletedRef');
  });
});
