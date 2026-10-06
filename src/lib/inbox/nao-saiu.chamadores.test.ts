import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// `messages.nao_saiu` (1080): a tentativa do robô que NÃO saiu fica no fio
// como bolha "não enviada" — e não é fala de ninguém. Inventário de 06/10/2026
// de quem lê `messages` perguntando "alguém falou?" e seria enganado por ela.
// Cada um filtra pela coluna; um merge ou uma "simplificação" que tire o
// filtro devolve o defeito sem quebrar nada visível:
//   - "Aguardar N sem conversa" recomeçaria a contagem a cada falha;
//   - o agente de IA "lembraria" do que nunca saiu e desistiria de responder
//     ("o robô falou");
//   - o Radar e o painel contariam a falha como resposta da equipe.
// As quatro funções do banco com a mesma pergunta estão no pino da migration
// (`supabase/migrations/envio-que-nao-saiu-1080.test.ts`).
// ============================================================

const raiz = path.join(__dirname, '..', '..');

/** Fonte sem comentários: os arquivos citam a coluna ao EXPLICAR a decisão. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** [arquivo, quantas leituras filtram] */
const LEITORES: [string, number][] = [
  ['lib/automations/sem-conversa.ts', 2],
  ['lib/ia-agentes/contexto.ts', 1],
  ['lib/ai/context.ts', 1],
  ['lib/ia-agentes/turno.ts', 2],
  ['lib/ia-agentes/retomada-fatos.ts', 1],
  ['lib/cb-radar/worker.ts', 1],
  ['hooks/use-radar.ts', 1],
  ['lib/dashboard/queries.ts', 2],
];

describe('quem pergunta "alguém falou?" ignora a tentativa que não saiu', () => {
  for (const [arquivo, n] of LEITORES) {
    it(`${arquivo} filtra .eq('nao_saiu', false) (${n}x)`, () => {
      const f = fonte(arquivo);
      expect((f.match(/\.eq\(\s*['"]nao_saiu['"]\s*,\s*false\s*\)/g) ?? []).length).toBe(n);
    });
  }

  it('a aba Arquivos não lista o anexo que não saiu (sairia "Enviado")', () => {
    expect(fonte('lib/media/anexos.ts')).toMatch(/message\.nao_saiu === true\) continue/);
  });

  it('a "origem do contato" pula a tentativa ao achar a primeira mensagem', () => {
    expect(fonte('components/inbox/painel/origem-do-contato.tsx')).toMatch(/m\.nao_saiu !== true/);
  });

  it('o menu da bolha esconde reagir e responder no que não saiu', () => {
    const f = fonte('components/inbox/message-actions.tsx');
    expect(f).toMatch(/const naoSaiu = message\.nao_saiu === true/);
    expect((f.match(/\{!naoSaiu && \(/g) ?? []).length).toBe(2);
  });

  it('a bolha decide por `envioQueNaoSaiu` (o booleano), e o gravador marca a linha', () => {
    expect(fonte('components/inbox/message-bubble.tsx')).toMatch(/envioQueNaoSaiu\(message\)/);
    expect(fonte('lib/whatsapp/envio-que-falhou.ts')).toMatch(/nao_saiu: true/);
  });

  it('os remetentes do robô gravam a tentativa que falhou (uma vez por INSERT de mensagem)', () => {
    for (const arquivo of ['lib/automations/meta-send.ts', 'lib/flows/meta-send.ts']) {
      const f = fonte(arquivo);
      const inserts = (f.match(/from\(\s*['"]messages['"]\s*\)\s*\.insert\(/g) ?? []).length;
      expect((f.match(/falhouAoEnviar\(/g) ?? []).length, arquivo).toBe(inserts);
    }
  });

  it('o motor passa `aoFalhar` a todo remetente e grava a bolha quando desiste', () => {
    const f = fonte('lib/automations/engine.ts');
    const envios = (f.match(/await engineSend(?:Text|Interactive|Template|Media)\(\{/g) ?? []).length;
    expect(envios).toBeGreaterThan(0);
    expect((f.match(/await engineSend(?:Text|Interactive|Template|Media)\(\{\s*aoFalhar,/g) ?? []).length).toBe(envios);
    // Duas desistências: a execução interrompida no meio e o passo que não
    // volta mais à fila.
    expect((f.match(/registrarEnvioQueFalhou\(db, falhaDoPasso\.rascunho, err\)/g) ?? []).length).toBe(2);
  });
});
