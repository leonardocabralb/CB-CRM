import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A ORIGEM (`source`) que a doc pública promete para quem move card fora das
// telas e da API, amarrada ao fonte.
//
// `docs/public-api.md`, `docs/webhooks.md` e a aba Documentação
// (`Settings.documentacao.avisos.regra.negocio`, nos dois dicionários) dizem
// ao integrador:
//   - os passos "Criar negócio", "Mover card de etapa" e "Marcar ganho ou
//     perdido" das AUTOMAÇÕES chegam como `automation` — o motor cria por
//     `createDeal` com `source: 'automation'` e move/marca pela RPC
//     `cb_atualizar_negocio`, que carimba `cb.cadeia`; o gatilho da 1040 lê a
//     cadeia e o `source` antes de tudo. O motor não escreve em `deals` por
//     fora disso;
//   - a ferramenta "Mover o card" dos AGENTES DE IA também chega como
//     `automation` (a mesma RPC, com a cadeia vazia, que ainda carimba);
//   - a PASSAGEM entre agentes (`[[PASSAR:n]]`) chega como `system` — ela
//     move por UPDATE direto, em service role: sem `auth.uid()`, sem cadeia
//     e sem o cabeçalho da API, o gatilho cai na sobra.
//
// O portão `scripts/doc-acompanha.mjs` vigia `executar-acoes.ts` por
// caminho, mas NÃO `automations/engine.ts` nem `ia-agentes/turno.ts`: os
// dois mudam toda semana por outros motivos, e vigiá-los inteiros faria do
// `Doc-inalterada` rotina. A promessa mora aqui (achados do Codex no PR
// #368): trocar o mecanismo de um escritor muda o `source` que o n8n
// recebe sem erro nenhum. Reprovou? Atualize as três docs acima e este pino
// no mesmo PR.
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

/** Escrita direta em `deals` (UPDATE/INSERT/UPSERT), aspas simples ou duplas. */
const ESCRITA_DIRETA = /\.from\(['"]deals['"]\)\s*\.(update|insert|upsert)\(/;

describe('a origem que a doc promete para os passos das automações', () => {
  const motor = fonte('lib/automations/engine.ts');

  it('o motor não escreve em `deals` por fora da RPC e do createDeal', () => {
    expect(motor).not.toMatch(ESCRITA_DIRETA);
  });

  it('"Mover card de etapa" e "Marcar ganho ou perdido" passam pela RPC que carimba a cadeia', () => {
    expect(motor).toContain("rpc('cb_atualizar_negocio'");
  });

  it('"Criar negócio" cria com `source: \'automation\'`', () => {
    const i = motor.indexOf('createDeal(');
    expect(i, 'createDeal não encontrado no motor').toBeGreaterThan(-1);
    const chamada = motor.slice(i, motor.indexOf('});', i));
    expect(chamada).toContain("source: 'automation'");
  });
});

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
