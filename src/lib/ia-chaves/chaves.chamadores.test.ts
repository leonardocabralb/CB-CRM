import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// A chave de IA é do PROVEDOR, uma por conta (1047, D1 do
// docs/PLANO-agentes-de-ia.md). Três pinos:
// 1. `cb_ia_chaves` só é tocada por `src/lib/ia-chaves/repo.ts`, que usa o
//    cliente de SERVIÇO. A tabela é fechada ao navegador: uma consulta com o
//    cliente da sessão volta ZERO linhas sem erro, e a tela diria "sem chave"
//    sobre uma conta configurada.
// 2. O Radar NÃO resolve a configuração pelo canal: um agente criado para uma
//    conexão trocaria, em silêncio, a chave e o modelo do Radar ali.
// 3. A transcrição e a leitura de imagem/PDF leem a chave do PROVEDOR direto
//    (Gemini → OpenAI, e a leitura → Anthropic), sem depender de agente
//    (27/09/2026: antes a transcrição era só do Gemini).
// ============================================================

const RAIZ = join(__dirname, '..', '..');

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('chaves de IA por provedor — quem chama', () => {
  it('só o repositório toca cb_ia_chaves', () => {
    const tocam = arquivos(RAIZ)
      .filter((f) => /['"`]cb_ia_chaves['"`]/.test(semComentarios(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(tocam).toEqual([join('lib', 'ia-chaves', 'repo.ts')]);
  });

  it('o Radar carrega a configuração SEM channelId', () => {
    const fonte = semComentarios(
      readFileSync(join(RAIZ, 'lib', 'cb-radar', 'worker.ts'), 'utf8'),
    );
    const chamadas = fonte.match(/loadAiConfig\([^)]*\)/g) ?? [];
    expect(chamadas.length).toBeGreaterThan(0);
    for (const c of chamadas) expect(c).not.toMatch(/channelId/);
  });

  it('loadAiConfig não lê mais a chave de ai_configs', () => {
    const fonte = semComentarios(readFileSync(join(RAIZ, 'lib', 'ai', 'config.ts'), 'utf8'));
    expect(fonte).not.toMatch(/api_key/);
    expect(fonte).toMatch(/lerChave\(/);
  });

  it('a transcrição e a leitura escolhem a chave pelo provedor, sem loadAiConfig', () => {
    const ler = (arquivo: string) =>
      semComentarios(readFileSync(join(RAIZ, 'lib', 'transcricao', arquivo), 'utf8'));
    const transcrever = ler('transcrever.ts');
    const lerMidia = ler('ler-midia.ts');
    for (const fonte of [transcrever, lerMidia]) expect(fonte).not.toMatch(/loadAiConfig/);
    expect(transcrever).toMatch(/escolherLeitor\(\s*args\.accountId\s*,\s*ORDEM_DA_TRANSCRICAO\s*\)/);
    expect(lerMidia).toMatch(/escolherLeitor\(\s*args\.accountId\s*,\s*ORDEM_DA_LEITURA\s*\)/);
    // A escolha lê a chave pelo repositório, provedor a provedor.
    expect(ler('escolher-leitor.ts')).toMatch(/lerChave\(\s*accountId\s*,\s*provedor\s*\)/);
  });
});
