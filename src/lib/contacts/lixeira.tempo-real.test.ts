import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NEGOCIOS_POR_CHAMADA, reinseridaPelaRestauracao } from './lixeira';

// ============================================================
// A Lixeira (1097) vista pelo tempo real e pelo quadro do funil: a régua da
// mensagem DEVOLVIDA pela restauração (a lista, o aviso do navegador e o fio
// aberto usam a mesma) e a marca do card cuja ficha está na Lixeira (B4).
// ============================================================

describe('reinseridaPelaRestauracao — gravada_em × restaurada_em, os dois do banco', () => {
  const VOLTA = '2026-10-23T18:30:00.123456+00:00';

  it('gravada ANTES da volta é devolvida; DEPOIS (ou no mesmo instante) é nova', () => {
    expect(reinseridaPelaRestauracao('2026-10-20T14:00:00+00:00', VOLTA, undefined)).toBe(true);
    expect(reinseridaPelaRestauracao('2026-10-23T18:30:00.122+00:00', VOLTA, undefined)).toBe(true);
    expect(reinseridaPelaRestauracao('2026-10-23T18:30:01+00:00', VOLTA, undefined)).toBe(false);
    expect(reinseridaPelaRestauracao('2026-10-23T18:30:00.123+00:00', VOLTA, undefined)).toBe(false);
  });

  it('compara INSTANTES, não texto (o mesmo momento em fusos diferentes)', () => {
    expect(reinseridaPelaRestauracao('2026-10-23T15:29:59-03:00', VOLTA, undefined)).toBe(true);
    expect(reinseridaPelaRestauracao('2026-10-23T15:31:00-03:00', VOLTA, undefined)).toBe(false);
  });

  it('sem gravada_em (72% da produção: carga histórica), vale o created_at', () => {
    expect(reinseridaPelaRestauracao(null, VOLTA, '2025-03-01T10:00:00+00:00')).toBe(true);
    expect(reinseridaPelaRestauracao(undefined, VOLTA, '2025-03-01T10:00:00+00:00')).toBe(true);
    // gravada_em, quando há, manda — mesmo com created_at do passado (a
    // mensagem nova com carimbo do aparelho atrasado ainda é nova).
    expect(reinseridaPelaRestauracao('2026-10-23T18:31:00+00:00', VOLTA, '2025-03-01T10:00:00+00:00')).toBe(false);
    expect(reinseridaPelaRestauracao(null, VOLTA, '2026-10-23T18:31:00+00:00')).toBe(false);
  });

  it('sem nenhum carimbo, sem a volta, ou ilegível: falso — vale a régua de sempre de quem chama', () => {
    expect(reinseridaPelaRestauracao(null, VOLTA, undefined)).toBe(false);
    expect(reinseridaPelaRestauracao(undefined, VOLTA, undefined)).toBe(false);
    expect(reinseridaPelaRestauracao(null, VOLTA, null)).toBe(false);
    expect(reinseridaPelaRestauracao('2026-10-20T14:00:00Z', null, undefined)).toBe(false);
    expect(reinseridaPelaRestauracao('2026-10-20T14:00:00Z', undefined, undefined)).toBe(false);
    expect(reinseridaPelaRestauracao('não é data', VOLTA, undefined)).toBe(false);
    expect(reinseridaPelaRestauracao('2026-10-20T14:00:00Z', 'não é data', undefined)).toBe(false);
  });
});

/** O fonte sem comentários: uma nota que cite a forma não conta. */
function fonte(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('a marca do card (B4): useNegociosNaLixeira', () => {
  const hook = fonte('hooks/use-negocios-na-lixeira.ts');

  it('com o conjunto vazio, nada é perguntado', () => {
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*if \(!chave\) return;/);
  });

  it('em fatias que a resposta nunca estoura (uma linha por negócio pedido)', () => {
    expect(NEGOCIOS_POR_CHAMADA).toBeLessThanOrEqual(1000);
    expect(hook).toMatch(
      /fatiar\(chave\.split\(','\), NEGOCIOS_POR_CHAMADA\)\.map\(\(fatia\) =>\s*supabase\.rpc\('cb_negocios_na_lixeira', \{ p_negocios: fatia \}\)/,
    );
  });

  it('⚠️ leitura que falha não grava nada (o card fica como hoje, nunca "não está")', () => {
    expect(hook).toMatch(/if \(erro\) \{\s*console\.error\([^)]*\);\s*return;\s*\}/);
    const erro = hook.indexOf('if (erro)');
    const grava = hook.indexOf('setNaLixeira(mapa)');
    expect(erro).toBeGreaterThan(-1);
    expect(grava).toBeGreaterThan(erro);
    // A resposta de uma pergunta velha (outro conjunto) é descartada.
    expect(hook).toMatch(/if \(!vivo\) return;/);
  });

  it('⚠️ o que sai é recortado pelo conjunto do render ATUAL (seção 8c)', () => {
    expect(hook).toMatch(/for \(const id of chave\.split\(','\)\) \{\s*if \(naLixeira\.has\(id\)\)/);
  });

  it('o quadro pergunta só pelos cards SEM contato que têm conteúdo, e passa primitivos ao card', () => {
    const quadro = fonte('components/pipelines/pipeline-board.tsx');
    expect(quadro).toMatch(
      /const semContato = useMemo\(\s*\(\) => deals\.filter\(\(d\) => temConteudo\(d\) && !d\.contact_id\)\.map\(\(d\) => d\.id\),\s*\[deals\],\s*\);\s*const negociosNaLixeira = useNegociosNaLixeira\(semContato\);/,
    );
    expect(quadro).toContain('naLixeira={negociosNaLixeira.has(deal.id)}');
    expect(quadro).toContain('nomeNaLixeira={negociosNaLixeira.get(deal.id) ?? null}');
  });

  it('o formulário do card pergunta só aberto e num negócio sem contato', () => {
    const formulario = fonte('components/pipelines/deal-form.tsx');
    expect(formulario).toContain(
      'useNegociosNaLixeira(open && deal && !deal.contact_id ? [deal.id] : [])',
    );
  });
});
