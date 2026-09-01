import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// #27 do plano 31/08: o canal de realtime era destruído e recriado a CADA
// evento de flow_runs — `nonce` estava nas deps do efeito da assinatura, e
// o callback bumpa o nonce. O re-join por evento é exatamente a janela de
// perda que o comentário do código dizia ter fechado. A regressão natural
// (juntar os dois efeitos de novo "por limpeza") devolve o bug inteiro —
// este pino a barra no fonte, porque testar o comportamento exigiria
// montar o hook com um stub de realtime que não existe no projeto.
//
// O irmão `useQuemVeAConversa` é o molde: assina UMA vez, deps só do id.
// ============================================================

const fonte = fs
  .readFileSync(path.join(__dirname, 'use-execucoes-do-contato.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('use-execucoes-do-contato: a assinatura é uma por contato (#27)', () => {
  it('o efeito que assina NÃO depende do nonce', () => {
    // O bloco que contém `.subscribe()` tem de terminar em `}, [contactId]);`
    const idx = fonte.indexOf('.subscribe()');
    expect(idx).toBeGreaterThan(-1);
    const depois = fonte.slice(idx, idx + 400);
    const deps = depois.match(/\},\s*\[([^\]]*)\]\)/);
    expect(deps, 'não achei as deps do efeito da assinatura').not.toBeNull();
    expect(deps![1].replace(/\s/g, '')).toBe('contactId');
  });

  it('o `nonce` continua disparando o REFETCH — senão a aba para de atualizar', () => {
    // O outro efeito (o do snapshot) precisa dele: sem `nonce` nas deps de
    // ninguém, o evento de realtime vira um setState sem consequência.
    const depsComNonce = [...fonte.matchAll(/\},\s*\[([^\]]*)\]\)/g)].filter((m) =>
      /\bnonce\b/.test(m[1]),
    );
    expect(depsComNonce.length).toBeGreaterThan(0);
  });

  it('cada efeito limpa o que ele criou — o removeChannel mora no da assinatura', () => {
    const idxSub = fonte.indexOf('.subscribe()');
    const idxRemove = fonte.indexOf('removeChannel');
    expect(idxRemove).toBeGreaterThan(idxSub);
    // O `removeChannel` tem de vir ANTES do próximo efeito (o do snapshot,
    // reconhecível pela IIFE assíncrona) — se cair lá dentro, volta a
    // derrubar o canal a cada refetch.
    const idxSnapshot = fonte.indexOf('void (async () =>');
    expect(idxSnapshot).toBeGreaterThan(-1);
    expect(idxRemove).toBeLessThan(idxSnapshot);
  });
});
