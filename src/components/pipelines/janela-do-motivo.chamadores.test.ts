import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================
// Os caminhos de GENTE que levam o card a outra etapa passam pela janela do
// motivo (1112, Fase 2 do docs/PLANO-motivos-de-perda.md). Decisão do
// operador (26/10/2026): o motivo é obrigatório para quem move.
//
// Mapa de 26/10/2026 (`.update({ stage_id` e o botão de status nas telas):
// o quadro (a página move pelo arrasto), a lista do funil, o painel da
// conversa (seletor de etapa e botão "Perdido"), o botão "avançar" e o
// formulário do negócio. Fora, por escrito: a pauta de reuniões
// (`src/lib/reunioes/executar.ts`, só etapas de reunião) e os caminhos que
// não são de gente (automação, robô, IA, API — Fase 3 e 5).
//
// Caminho de gente NOVO que move card entra nesta lista.
// ============================================================

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const CAMINHOS = [
  'src/app/(dashboard)/pipelines/page.tsx',
  'src/components/funil/lista-de-leads.tsx',
  'src/components/inbox/painel/painel-do-contato.tsx',
  'src/components/inbox/painel/avancar-etapa.tsx',
  'src/components/pipelines/deal-form.tsx',
];

describe('janela do motivo: quem move o card pergunta antes', () => {
  it.each(CAMINHOS)('%s chama pedirMotivo', (arquivo) => {
    expect(ler(arquivo)).toMatch(/pedirMotivo\(\{/);
  });

  it('o quadro deixa o card na coluna enquanto a janela espera', () => {
    expect(ler('src/components/pipelines/pipeline-board.tsx')).toMatch(
      /if \(onDealMoved\(dealId, targetStageId\) === false\) return;\s*setRecemSolto\(dealId\);/,
    );
  });

  it('o botão "Perdido" (painel e formulário) escolhe a etapa de perda e manda o status junto', () => {
    const painel = ler('src/components/inbox/painel/painel-do-contato.tsx');
    expect(painel).toMatch(/etapasDePerda\(allStages, deal\.pipeline_id\)/);
    expect(painel).toMatch(/\{ stage_id: etapaId, status: 'lost' \}/);
    const formulario = ler('src/components/pipelines/deal-form.tsx');
    expect(formulario).toMatch(/etapasDePerda\(etapasConhecidas, origem\.pipeline_id\)/);
    expect(formulario).toMatch(/\.update\(\{ status, stage_id: etapaId \}\)/);
  });
});
