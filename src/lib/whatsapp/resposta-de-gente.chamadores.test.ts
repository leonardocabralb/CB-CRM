import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// Quem pode dizer ao núcleo de envio que a mensagem é RESPOSTA DE GENTE
// (`respostaDeGente`) — e por isso usar a janela de 7 dias do Instagram, com a
// tag HUMAN_AGENT (decisão do operador, 22/11/2026).
//
// A Meta proíbe a tag em mensagem automática, e o uso fora do permitido
// restringe a conta. Default-deny: um chamador novo que passe o parâmetro
// reprova até alguém decidir, AQUI, que ali escreve uma pessoa. A API v1, o
// MCP, as automações, o robô e a IA nunca entram.
//
// E a marca da agendada (`cb_scheduled_messages.pela_tela`, 1154) só é gravada
// pela rota da TELA: a da API v1 nasce com o padrão do banco (falso).
// ============================================================

const SRC = join(__dirname, '..', '..');

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

/** Fonte sem comentários: os arquivos citam os nomes ao explicar. */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const FONTES = arquivos(SRC).map((caminho) => ({
  caminho: relative(SRC, caminho).replaceAll('\\', '/'),
  codigo: semComentarios(readFileSync(caminho, 'utf8')),
}));

describe('respostaDeGente: quem pode usar a janela de 7 dias do Instagram', () => {
  it('só a rota da caixa (sempre) e a agendada pela tela (pela coluna)', () => {
    const usos = FONTES.filter(
      (f) => f.caminho !== 'lib/whatsapp/send-message.ts' && /\brespostaDeGente\s*:/.test(f.codigo)
    ).map((f) => ({
      caminho: f.caminho,
      valor: f.codigo.match(/\brespostaDeGente\s*:\s*([^,\n}]+)/)?.[1].trim(),
    }));
    expect(usos).toEqual([
      { caminho: 'app/api/whatsapp/send/route.ts', valor: 'true' },
      { caminho: 'lib/scheduled/dispatch.ts', valor: 'linha.pela_tela === true' },
    ]);
  });

  it('a rota da API v1 de mensagens não passa o parâmetro', () => {
    const v1 = FONTES.find((f) => f.caminho === 'app/api/v1/messages/route.ts');
    expect(v1?.codigo).toContain('sendMessageToConversation');
    expect(v1?.codigo).not.toMatch(/respostaDeGente/);
  });

  it('⚠️ só a rota da TELA grava `pela_tela`; a da API v1 não toca a coluna', () => {
    // O tipo (`pela_tela: boolean`) declara; quem ESCREVE dá um valor.
    const escritores = FONTES.filter((f) => /\bpela_tela\s*:\s*(?!boolean\b)\S/.test(f.codigo)).map((f) => ({
      caminho: f.caminho,
      valor: f.codigo.match(/\bpela_tela\s*:\s*([^,\n}]+)/)?.[1].trim(),
    }));
    expect(escritores).toEqual([{ caminho: 'app/api/cb/scheduled/route.ts', valor: 'true' }]);
    const v1 = FONTES.find((f) => f.caminho === 'app/api/v1/scheduled-messages/route.ts');
    expect(v1?.codigo).toContain("from('cb_scheduled_messages')");
    expect(v1?.codigo).not.toMatch(/pela_tela/);
  });
});
