import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A ORIGEM (`source`) que a doc pública promete para os agentes de IA,
// amarrada ao fonte.
//
// `docs/public-api.md`, `docs/webhooks.md` e a aba Documentação
// (`Settings.documentacao.avisos.regra.negocio`, nos dois dicionários) dizem
// ao integrador:
//   - a ferramenta "Mover o card" dos agentes chega como `automation` — ela
//     move pela RPC `cb_atualizar_negocio`, que carimba `cb.cadeia` (mesmo
//     com a cadeia vazia), e o gatilho da 1040 lê a cadeia antes de tudo;
//   - a PASSAGEM entre agentes (`[[PASSAR:n]]`) chega como `system` — ela
//     move por UPDATE direto, em service role: sem `auth.uid()`, sem cadeia
//     e sem o cabeçalho da API, o gatilho cai na sobra.
//
// O portão `scripts/doc-acompanha.mjs` vigia `executar-acoes.ts` por
// caminho, mas NÃO `ia-agentes/turno.ts`: ele muda toda semana por outros
// motivos, e vigiá-lo inteiro faria do `Doc-inalterada` rotina. A promessa
// da passagem mora aqui (achado do Codex no PR #368): trocar o UPDATE pela
// RPC — ou a RPC por um UPDATE — muda o `source` que o n8n recebe sem erro
// nenhum. Reprovou? Atualize as três docs acima e este pino no mesmo PR.
// ============================================================

const src = path.join(__dirname, '..', '..');

/** Fonte sem comentários — os dois arquivos citam a RPC ao EXPLICAR decisões. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(src, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** O texto da função de topo `nome`, até a próxima declaração de topo. */
function funcao(texto: string, nome: string): string {
  const inicio = texto.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThan(-1);
  const resto = texto.slice(inicio + 1);
  const fim = resto.slice(1).search(/\n(?:export )?(?:async )?function |\n(?:export )?const /);
  return fim > -1 ? resto.slice(0, fim + 1) : resto;
}

describe('a origem que a doc promete para os agentes de IA', () => {
  it('a PASSAGEM entre agentes move o card por UPDATE direto (chega `system`)', () => {
    const passar = funcao(fonte('lib/ia-agentes/turno.ts'), 'passar');
    expect(passar).toMatch(/\.from\('deals'\)\s*\.update\(/);
    expect(passar).not.toContain('cb_atualizar_negocio');
  });

  it('…e em service role, sem a sessão de ninguém (sem `auth.uid()`)', () => {
    const turno = fonte('lib/ia-agentes/turno.ts');
    expect(turno).toMatch(/import \{ supabaseAdmin \} from '@\/lib\/ai\/admin-client'/);
    expect(funcao(turno, 'executarTurno')).toContain('supabaseAdmin()');
  });

  it('a ferramenta "Mover o card" move pela RPC que carimba a cadeia (chega `automation`)', () => {
    const mover = funcao(fonte('lib/ia-agentes/executar-acoes.ts'), 'moverEtapa');
    expect(mover).toContain("rpc('cb_atualizar_negocio'");
    expect(mover).not.toMatch(/\.from\('deals'\)\s*\.update\(/);
  });
});
