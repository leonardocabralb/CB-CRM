import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// A ABERTURA RÁPIDA do deep link (pedido do operador, 28/10/2026): abrir a
// conversa por um aviso, pelo Meu dia ou por link levava ~5 s, ~3,4 s deles
// esperando a lista INTEIRA (3.535 conversas em quatro páginas em série). A
// página passou a ler a conversa do `?c=` sozinha e abri-la já.
//
// O que quebra calado, e por isso é pino lendo a página (arquivo do upstream:
// um merge que a traga crua devolve os 5 s sem erro nenhum):
// - a leitura sumir → volta a espera;
// - uma cerca sumir → a resposta atrasada atropela a conversa que a pessoa
//   abriu no meio (clique, "Nova conversa", a lista que chegou antes);
// - o espelho de "lida" sumir → a bolinha de não lida fica acesa na linha da
//   conversa que está aberta.
// ============================================================

const PAGINA = path.join(__dirname, '..', '..', 'app', '(dashboard)', 'inbox', 'page.tsx');

/** Fonte sem comentários: a prosa cita os nomes ao explicar. */
function fonte(): string {
  return fs
    .readFileSync(PAGINA, 'utf8')
    .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('abertura rápida do deep link', () => {
  const p = fonte();
  const efeito = p.slice(p.indexOf('if (!deepLinkConvId) return;'));

  it('lê SÓ a conversa do ?c=, com o select e o normalizador da lista', () => {
    expect(efeito).toMatch(
      /\.from\("conversations"\)\s*\.select\(CONVERSATION_SELECT\)\s*\.eq\("id", deepLinkConvId\)\s*\.maybeSingle\(\)/,
    );
    expect(efeito).toMatch(/const conversa = normalizeConversation\(data\);/);
  });

  it('as cercas valem ANTES e DEPOIS da leitura, e a URL tem de pedir esta conversa', () => {
    expect(p).toMatch(
      /const atendido = \(\) =>\s*autoSelectedForDeepLinkRef\.current === deepLinkConvId \|\|\s*conversaAbertaRef\.current !== null \|\|\s*conversaRecemAbertaRef\.current !== null;\s*if \(atendido\(\)\) return;/,
    );
    expect(efeito).toMatch(/if \(cancelado \|\| error \|\| !data \|\| atendido\(\)\) return;/);
    expect(efeito).toMatch(
      /new URLSearchParams\(window\.location\.search\)\.get\("c"\) !== deepLinkConvId\) return;/,
    );
    // Consome o deep link: o bloco da lista não reaplica (zeraria o fio).
    expect(efeito).toMatch(
      /autoSelectedForDeepLinkRef\.current = deepLinkConvId;\s*abertaAntesDaListaRef\.current = deepLinkConvId;\s*setActiveConversation\(conversa\);/,
    );
  });

  it('o aviso de anotação salta também por aqui', () => {
    expect(efeito).toMatch(
      /novoPedidoDeSalto\(prev, conversa\.id, \{ tipo: "nota", id: notaDoDeepLink \}\)/,
    );
  });

  it('a lista que chega depois paga o espelho de "lida" uma vez, só se ela ainda é a aberta', () => {
    expect(p).toMatch(
      /const abertaAntes = abertaAntesDaListaRef\.current;\s*if \(abertaAntes\) \{\s*abertaAntesDaListaRef\.current = null;/,
    );
    expect(p).toMatch(/conversaAbertaRef\.current === abertaAntes &&/);
  });
});
