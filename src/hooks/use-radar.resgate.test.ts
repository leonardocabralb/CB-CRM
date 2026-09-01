import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// M3 do plano 31/08 — as DUAS consultas de resgate do painel do Radar.
//
// A consulta principal ordena por `analisado_em DESC NULLS LAST` e corta em
// 200. Duas classes de linha somem por aí, e as duas são justamente as que
// não podem sumir:
//
//   pendência congelada  — nunca reanalisada, `analisado_em` envelhece
//   análise `failed`     — `analisado_em` fica NULO, então vai para o FIM
//
// A da pendência foi escrita em 2026-08-27; a da falha ficou faltando até
// agora. Sem ela, num acervo acima do teto a garantia "análise que falhou
// aparece no painel independente de gatilho" expira em silêncio, e com ela
// some o botão "Reanalisar" — o único caminho de correção que restou
// depois que a aba "Todos" foi removida.
//
// Pino no FONTE: exercitar isto de verdade exigiria um acervo de 200+
// linhas no banco (ou um stub de PostgREST que o projeto não tem), e o
// modo de falha é silencioso — some uma linha, ninguém percebe.
// ============================================================

const fonte = fs
  .readFileSync(path.join(__dirname, 'use-radar.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('use-radar: o resgate do que cai do teto (M3)', () => {
  it('existe consulta dedicada a `status = failed`', () => {
    expect(fonte).toContain("eq('status', 'failed')");
  });

  it('a consulta de falhas NÃO ordena por `analisado_em` — é a coluna nula', () => {
    const i = fonte.indexOf("eq('status', 'failed')");
    expect(i).toBeGreaterThan(-1);
    const bloco = fonte.slice(i, i + 220);
    expect(bloco).toContain("order('created_at'");
    expect(bloco).not.toContain('analisado_em');
  });

  it('as duas consultas de resgate são MESCLADAS com deduplicação por id', () => {
    // O `vistos` tem de crescer enquanto mescla: com um Set montado só a
    // partir das principais, uma linha presente nas DUAS listas de resgate
    // entraria duas vezes e o painel mostraria o cartão duplicado.
    expect(fonte).toContain('vistos.add(i.id)');
    expect(fonte).toMatch(/\[\s*\.\.\.dePendencia,\s*\.\.\.deFalha\s*\]/);
  });

  it('o resgate é best-effort: falhar nele não derruba a lista', () => {
    // Só `lista.error` devolve cedo. Se o resgate abortasse a carga, uma
    // consulta secundária lenta apagaria o painel inteiro.
    expect(fonte).toContain('if (lista.error)');
    expect(fonte).not.toContain('if (falhas.error)');
  });
});

describe('o resgate das falhas é só das ABERTAS (Codex, PR #96)', () => {
  it('a consulta de falhas filtra `estado = aberto`, como a irmã da pendência', () => {
    // A tela mostra só `estado === 'aberto'`: falha tratada/descartada no
    // resgate só ocupa vaga, e 100 delas escondem uma falha aberta mais
    // antiga — com o único "Reanalisar" dela junto.
    const i = fonte.indexOf("eq('status', 'failed')");
    expect(i).toBeGreaterThan(-1);
    const bloco = fonte.slice(i, i + 220);
    expect(bloco).toContain("eq('estado', 'aberto')");
  });
});
