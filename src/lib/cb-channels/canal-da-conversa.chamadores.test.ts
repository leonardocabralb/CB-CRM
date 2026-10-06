import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Todo caminho que GRAVA mensagem numa conversa 1:1 deixa a conversa com um
// número. DEFAULT-DENY: arquivo novo que insere em `messages` sem estar numa
// das três listas reprova.
//
// Em 05/10/2026 havia 291 conversas 1:1 com `conversations.channel_id` NULO
// e todas as mensagens delas carimbadas. A conversa nascia sem número (a do
// Calendly, a que o motor cria para a ficha da API) e o robô só gravava prévia
// e hora: o filtro por conexão da caixa a escondia (`canalDaConversa`), e a
// resposta da equipe saía pelo padrão da conta — outro número no celular do
// cliente.
//
//  - ENTRADA: a conversa SEGUE o cliente (`followConversationChannel`).
//  - SAÍDA: a conversa sem número ganha o número por onde a nossa mensagem
//    saiu, e só ela (`preencherCanalDaConversa`, a cerca `channel_id IS NULL`
//    no próprio UPDATE). Uma chamada por INSERT: o arquivo que ganhar um
//    remetente novo sem a chamada reprova pela contagem.
//  - FORA: com o motivo escrito.
// ============================================================

const raiz = path.join(__dirname, '..', '..');

/** Fonte sem comentários: os arquivos citam os nomes ao EXPLICAR a decisão. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const INSERE_MENSAGEM = /from\(\s*['"]messages['"]\s*\)\s*\.(?:insert|upsert)\(/g;

function contar(texto: string, padrao: RegExp): number {
  return (texto.match(padrao) ?? []).length;
}

const ENTRADA = [
  'app/api/whatsapp/webhook/route.ts',
  'lib/whatsapp/inbound-store.ts',
  'lib/instagram/persistir.ts',
  'lib/whatsapp/ligacoes/registrar.ts',
];

const SAIDA = [
  'lib/automations/meta-send.ts',
  'lib/flows/meta-send.ts',
  'lib/whatsapp/send-message.ts',
  // O eco grava a fala que o TURNO enviou quando o processo do envio morreu
  // antes do INSERT: aí ele é o único que grava, e faz o que o envio faria.
  'lib/ia-agentes/eco.ts',
];

const FORA: Record<string, string> = {
  'lib/cb-groups/persist.ts':
    'grupo: `conversations.channel_id` é nulo por desenho; o número é `cb_groups.channel_id`',
  'lib/cb-groups/system-events.ts': 'aviso de sistema do grupo — mesmo motivo',
  'lib/whatsapp/sem-telefone/historica.ts':
    'modo `historica`: só o fio, nunca a conversa — a mensagem mais nova que a fez histórica já passou pela entrada ou pela saída',
};

function arquivosQueInseremMensagem(): string[] {
  const achados: string[] = [];
  const andar = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) andar(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        const rel = path.relative(raiz, p).split(path.sep).join('/');
        if (contar(fonte(rel), INSERE_MENSAGEM) > 0) achados.push(rel);
      }
    }
  };
  andar(raiz);
  return achados.sort();
}

describe('quem grava mensagem deixa a conversa 1:1 com número', () => {
  it('todo arquivo que insere em messages está classificado (default-deny)', () => {
    const conhecidos = new Set([...ENTRADA, ...SAIDA, ...Object.keys(FORA)]);
    const soltos = arquivosQueInseremMensagem().filter((a) => !conhecidos.has(a));
    expect(soltos).toEqual([]);
  });

  it('a lista não guarda arquivo que deixou de inserir mensagem', () => {
    const atuais = new Set(arquivosQueInseremMensagem());
    const mortos = [...ENTRADA, ...SAIDA, ...Object.keys(FORA)].filter((a) => !atuais.has(a));
    expect(mortos).toEqual([]);
  });

  for (const arquivo of ENTRADA) {
    it(`${arquivo} (entrada) segue o cliente`, () => {
      expect(fonte(arquivo)).toContain('followConversationChannel(');
    });
  }

  for (const arquivo of SAIDA) {
    it(`${arquivo} (saída) preenche o número da conversa a cada INSERT, e nunca segue o cliente`, () => {
      const f = fonte(arquivo);
      expect(contar(f, /preencherCanalDaConversa\(/g)).toBe(contar(f, INSERE_MENSAGEM));
      // Seguir o cliente num envio NOSSO tiraria do Comercial a conversa que
      // corre por ele só porque a automação falou pelo Jurídico.
      expect(f).not.toContain('followConversationChannel(');
    });
  }
});
