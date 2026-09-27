import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { NodeType } from '@/components/flows/shared';
import type { FlowNodeType } from '@/lib/flows/types';

// ============================================================
// Os tipos de nó do robô que o BANCO aceita (o CHECK de
// `flow_nodes.node_type`) batem com os que o CÓDIGO conhece?
//
// ⚠️ Por que importa: `PUT /api/flows/[id]` APAGA os nós do robô antes de
// inserir os novos, e sem transação. Um tipo novo no código sem a migration
// que o acrescenta ao CHECK faz o INSERT ser recusado DEPOIS do DELETE — o
// robô fica sem nenhum nó. Foi assim que o "Mover card" (1053) quase entrou.
//
// A lista do código é o `Record<FlowNodeType, true>` abaixo: o compilador
// cobra uma entrada para todo tipo do union de `types.ts` (e recusa tipo que
// não existe), então acrescentar um nó ao código sem mexer aqui não compila —
// e mexendo aqui, o teste cobra a migration.
//
// O CHECK vigente é o da ÚLTIMA migration que recria
// `flow_nodes_node_type_check` (lida pelo nome do arquivo). `http_fetch` é a
// única diferença aceita: reservado no banco desde a 010, sem nó no código.
// ============================================================

const TIPOS_DO_CODIGO: Record<FlowNodeType, true> = {
  start: true,
  send_message: true,
  send_buttons: true,
  send_list: true,
  send_media: true,
  collect_input: true,
  condition: true,
  set_tag: true,
  move_deal_stage: true,
  handoff: true,
  end: true,
};

/** Reservados no banco, sem nó no código — de propósito, e só estes. */
const RESERVADOS_NO_BANCO = ['http_fetch'];

// A UI tem o seu próprio union (`NodeType`, em `shared.tsx`), "em lockstep"
// com o do motor. Aqui a igualdade é cobrada pelo compilador: divergir faz
// esta atribuição deixar de compilar.
type Igual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const UI_IGUAL_AO_MOTOR: Igual<NodeType, FlowNodeType> = true;

const PASTA = path.resolve(__dirname);

/**
 * A migration do "Mover card", achada pelo NOME, não pelo número: se ela
 * precisar ser renumerada antes de aplicar (a 1052 da frente de IA já está em
 * produção — ver `docs/MIGRATIONS-APLICADAS.md`), basta renomear o arquivo.
 */
function arquivoDoMoverCard(): string {
  const achados = fs.readdirSync(PASTA).filter((f) => /^\d{4}_cb_robo_mover_card\.sql$/.test(f));
  expect(achados).toHaveLength(1);
  return achados[0];
}

function checkVigente(): { arquivo: string; tipos: string[] } {
  const arquivos = fs
    .readdirSync(PASTA)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  let achado: { arquivo: string; tipos: string[] } | null = null;
  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(PASTA, arquivo), 'utf8');
    const m = sql.match(
      /ADD\s+CONSTRAINT\s+flow_nodes_node_type_check\s+CHECK\s*\(\s*node_type\s+IN\s*\(([\s\S]*?)\)\s*\)/i,
    );
    if (m) achado = { arquivo, tipos: [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
  }
  if (!achado) throw new Error('nenhuma migration recria flow_nodes_node_type_check');
  return achado;
}

describe('tipos de nó do robô: banco × código', () => {
  it('a UI e o motor conhecem os mesmos tipos', () => {
    expect(UI_IGUAL_AO_MOTOR).toBe(true);
  });

  it('o CHECK vigente é o da migration do Mover card (ou de uma posterior)', () => {
    expect(checkVigente().arquivo >= arquivoDoMoverCard()).toBe(true);
  });

  it('o CHECK aceita exatamente os tipos do código, mais os reservados', () => {
    const { tipos } = checkVigente();
    expect(new Set(tipos).size).toBe(tipos.length);
    expect([...tipos].sort()).toEqual(
      [...Object.keys(TIPOS_DO_CODIGO), ...RESERVADOS_NO_BANCO].sort(),
    );
  });

  it('a conferência da 1053 cobra os mesmos doze tipos que o CHECK grava', () => {
    const sql = fs.readFileSync(path.join(PASTA, arquivoDoMoverCard()), 'utf8');
    const lista = sql.match(/v_tipos\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\];/);
    expect(lista).not.toBeNull();
    const conferidos = [...lista![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(conferidos).toEqual([...checkVigente().tipos].sort());
  });

  it('a 1053 leva lock_timeout e derruba o CHECK velho pela FORMA', () => {
    const sql = fs.readFileSync(path.join(PASTA, arquivoDoMoverCard()), 'utf8');
    expect(sql).toMatch(/SET LOCAL lock_timeout/);
    expect(sql).toMatch(/node_type = ANY \\\(ARRAY\\\[/);
  });
});
