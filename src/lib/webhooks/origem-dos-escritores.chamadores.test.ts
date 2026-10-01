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
//
// E o INVENTÁRIO (default-deny): todo ponto do código que escreve em `deals`
// está em `ESCRITORES`, com a origem que produz. Escritor novo, sumido ou que
// troca de mecanismo reprova até alguém classificá-lo — e conferir se a lista
// de origens da doc ainda diz a verdade sobre ele.
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

/**
 * Arquivo → as escritas em `deals` dele, na ordem do fonte: `update`,
 * `insert`, `upsert`, `delete` (direto na tabela), `rpc` (a
 * `cb_atualizar_negocio`) e `createDeal`. O comentário diz a origem.
 */
const ESCRITORES: Record<string, string[]> = {
  // ---- `user`: gente nas telas — a sessão do navegador (`auth.uid()`) ----
  'app/(dashboard)/pipelines/page.tsx': ['update'], // arrastar no quadro
  'components/funil/lista-de-leads.tsx': ['update'], // a lista do funil
  'components/inbox/painel/painel-do-contato.tsx': ['update'], // painel da conversa
  // o formulário do card (apagar não gera aviso)
  'components/pipelines/deal-form.tsx': ['update', 'insert', 'update', 'delete'],
  'lib/reunioes/executar.ts': ['update'], // a pauta de reuniões (cliente da tela)
  'app/api/cb/negocios/[id]/mover/route.ts': ['update'], // "avançar" (sessão de quem clicou)
  // ---- `channel`: o roteador da conexão, `source: 'channel'` ----
  'lib/cb-channels/pipeline-routing.ts': ['createDeal'],
  // ---- `automation`: `source: 'automation'` e a RPC que carimba a cadeia ----
  'lib/automations/engine.ts': ['createDeal', 'rpc'],
  'lib/flows/mover-card.ts': ['createDeal', 'rpc'], // o bloco do robô
  'lib/ia-agentes/executar-acoes.ts': ['rpc'], // a ferramenta "Mover o card"
  // ---- `api`: o cliente da API, cabeçalho `x-cb-origem: api` ----
  'app/api/v1/deals/route.ts': ['createDeal'],
  'app/api/v1/deals/[id]/route.ts': ['update'],
  // ---- `system`: service role sem cadeia nem cabeçalho ----
  'lib/ia-agentes/turno.ts': ['update'], // a passagem entre agentes
  // ---- não move card: só o TÍTULO, que a fila do funil não olha ----
  'lib/calendly/processar.ts': ['update'],
  // ---- a própria criação: a definição de `createDeal` e o INSERT dela ----
  'lib/deals/create-deal.ts': ['createDeal', 'insert'],
};

function arquivos(dir: string, saida: string[] = []): string[] {
  for (const nome of fs.readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    if (fs.statSync(caminho).isDirectory()) arquivos(caminho, saida);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

describe('o inventário de quem escreve em `deals`', () => {
  it('é EXATO: escritor novo, sumido ou que troca de mecanismo reprova', () => {
    const medido: Record<string, string[]> = {};
    const escrita =
      /\.from\(\s*['"]deals['"]\s*\)\s*\.(update|insert|upsert|delete)\(|rpc\(\s*['"]cb_atualizar_negocio['"]|\bcreateDeal\(/g;
    for (const caminho of arquivos(src)) {
      const ops = [...fonte(path.relative(src, caminho)).matchAll(escrita)].map(
        (m) => m[1] ?? (m[0].startsWith('rpc') ? 'rpc' : 'createDeal')
      );
      if (ops.length > 0) medido[path.relative(src, caminho)] = ops;
    }
    expect(medido).toEqual(ESCRITORES);
  });
});

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
