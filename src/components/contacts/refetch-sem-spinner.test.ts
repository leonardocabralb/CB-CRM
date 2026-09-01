import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// M6 — o spinner do refetch jogava o operador de volta ao topo da lista.
//
// MEDIDO no navegador (01/09), renomeando um campo no fim de um catálogo de
// 15: a rolagem ia de **139 para 0**. O contêiner rolável NÃO desmonta — o
// que some é o conteúdo dele: `setLoading(true)` troca a lista pelo spinner,
// o `scrollHeight` desaba de **1215px para 84px**, e o navegador GRAMPEIA o
// `scrollTop` no máximo possível, que vira 0. Nada o restaura depois.
//
// Valia para as OITO escritas do catálogo (renomear, apagar, criar bloco,
// mover campo, reordenar, semear…), e a mais irritante é a renomeação: o
// gesto mais banal da tela.
//
// Depois: 139 → 139, `scrollHeight` nunca abaixo de 1215, e a gravação
// confirmada no banco (a lista fica com dados velhos por centésimos, e a
// linha que está sendo escrita já mostra o próprio spinner via `busyId`).
//
// A regressão natural é alguém "padronizar" as chamadas — passar `true` em
// todas, ou tirar o parâmetro e voltar a ligar o spinner sempre.
// ============================================================

const fonte = fs
  .readFileSync(
    path.join(__dirname, 'custom-fields-manager.tsx'),
    'utf8',
  )
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('catálogo de campos: refetch sem perder a rolagem (M6)', () => {
  it('o spinner é OPCIONAL e desligado por padrão', () => {
    expect(fonte).toContain('async (comSpinner = false)');
    expect(fonte).toContain('if (comSpinner) setLoading(true);');
  });

  it('só a montagem pede o spinner', () => {
    // Uma ocorrência de `fetchFields(true)`, e ela mora no efeito de carga:
    // ali não há lista na tela para preservar, e sem spinner a caixa nasceria
    // vazia com cara de "não há campo nenhum".
    expect(fonte.match(/fetchFields\(true\)/g)?.length).toBe(1);
  });

  it('as escritas recarregam em SILÊNCIO — todas elas', () => {
    // Oito call sites hoje. O número não é o ponto; o ponto é que nenhum
    // deles liga o spinner. Se um novo aparecer com `true`, esta conta muda
    // e o teste acima (exatamente 1) quebra junto.
    const semSpinner = fonte.match(/await fetchFields\(\)/g)?.length ?? 0;
    expect(semSpinner).toBeGreaterThanOrEqual(8);
    expect(fonte).not.toMatch(/await fetchFields\(true\)/);
  });

  it('o spinner continua substituindo a lista — é ele que colapsa o conteúdo', () => {
    // Se um dia a tela passar a mostrar o spinner AO LADO da lista (em vez
    // de no lugar dela), o defeito deixa de existir e este arquivo pode ir
    // embora. Enquanto for substituição, o gate acima é o que segura.
    expect(fonte).toMatch(/\{loading \? \(/);
  });
});
