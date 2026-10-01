import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Modo anônimo — pinos estruturais (decisão do operador, 01/10/2026).
//
// A regra pura (`modo-anonimo.ts`) tem teste próprio. O que quebra em
// produção é o CONSUMO, e quebra calado: um caminho novo que zere as não
// lidas ao abrir a conversa, ou que marque a presença com o id cru, devolve
// o rastro que o administrador desligou — sem erro nenhum, e sem tela que o
// denuncie a ele. `page.tsx` e `message-thread.tsx` vêm do upstream: um
// merge que traga a versão crua deles faz exatamente isso.
// ============================================================

const raiz = path.join(__dirname, '..', '..');

/** Fonte sem comentários — os arquivos citam os nomes ao EXPLICAR as
 *  decisões, e checar prosa faria o teste acusar a própria documentação. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function arquivosDoCodigo(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      achados.push(...arquivosDoCodigo(caminho));
    } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

function ocorrencias(texto: string, agulha: string): number {
  return texto.split(agulha).length - 1;
}

const PAGINA = 'app/(dashboard)/inbox/page.tsx';
const FIO = 'components/inbox/message-thread.tsx';

/**
 * Todo lugar que ZERA as não lidas, com o porquê de ele respeitar o modo.
 * Arquivo novo aqui = decidir se ele roda quando alguém só LÊ a conversa e,
 * se roda, passar pelo modo anônimo antes de entrar na lista.
 */
const QUEM_ZERA: Record<string, string> = {
  [PAGINA]:
    'os espelhos da lista: clique e link (`!modoAnonimo`), tempo real e mensagem nova (`conversaLida`)',
  [FIO]: 'o banco, por `zerarNaoLidas`: ao ver (fora do modo) e ao responder (no modo)',
  'lib/inbox/ordem-da-lista.ts': '`comMensagemNova` recebe da página `conversaLida === id`',
};

describe('modo anônimo: quem zera as não lidas', () => {
  it('o inventário de quem zera é exatamente a lista conferida', () => {
    const zera = /unread_count\s*:\s*0\b|unread_count\s*:\s*[\w.?]+\s*\?\s*0\s*:/;
    const achados = arquivosDoCodigo(raiz)
      .filter((arquivo) => zera.test(fonte(path.relative(raiz, arquivo))))
      .map((arquivo) => path.relative(raiz, arquivo).split(path.sep).join('/'))
      .sort();
    expect(achados).toEqual(Object.keys(QUEM_ZERA).sort());
  });

  it('o fio grava o zero num lugar só, e ver não zera no modo', () => {
    const f = fonte(FIO);
    expect(ocorrencias(f, '.update({ unread_count: 0 })')).toBe(1);
    expect(f).toContain('if (!conversationId || !hasUnread || modoAnonimo) return;');
    // Sem o `modoAnonimo` nas dependências, desligar o modo com a conversa
    // aberta não a zeraria até chegar outra mensagem.
    expect(f).toContain('}, [conversationId, hasUnread, modoAnonimo]);');
  });

  it('responder zera no modo, depois de o servidor confirmar o envio', () => {
    const f = fonte(FIO);
    expect(f).toContain('if (modoAnonimo) zerarNaoLidas(conversationIdDoEnvio);');
    // Os quatro caminhos de envio (texto, anexo, interativa e modelo) passam
    // a conversa para a qual a mensagem SAIU.
    expect(ocorrencias(f, 'marcarEnviada(tempId, ')).toBe(4);
    expect(
      f.match(/marcarEnviada\(tempId, (?:payload|data), conversation\.id\);/g),
    ).toHaveLength(4);
  });

  it('a página só esvazia o espelho da lista fora do modo', () => {
    const p = fonte(PAGINA);
    expect(p).toContain(
      'const conversaLida = modoAnonimo ? null : (activeConversation?.id ?? null);',
    );
    expect(ocorrencias(p, '{ ...c, unread_count: 0 }')).toBe(2);
    expect(p).toContain('if (!bloqueadaAoSelecionar && !modoAnonimo) {');
    expect(p).toMatch(/!modoAnonimo &&\s*conversaNoEscopo\(acesso, match\) &&/);
    expect(p).toContain('const lida = conversaLida === conv.id;');
    expect(p).toContain('unread_count: lida ? 0 : conv.unread_count,');
    // `aberta` é o nome que o pino de `ordem-da-lista.test.ts` cobra.
    expect(p).toContain('const aberta = conversaLida === newMsg.conversation_id;');
    expect(p).toContain('comMensagemNova(c, newMsg, aberta)');
  });
});

describe('modo anônimo: a presença na conversa', () => {
  it('o único escritor da presença é a página, com a conversa LIDA', () => {
    const escritores = arquivosDoCodigo(raiz)
      .map((arquivo) => path.relative(raiz, arquivo).split(path.sep).join('/'))
      .filter((relativo) => relativo !== 'hooks/use-conversa-aberta.ts')
      .filter((relativo) => fonte(relativo).includes('useMarcarConversaAberta('));
    expect(escritores).toEqual([PAGINA]);
    expect(fonte(PAGINA)).toContain('useMarcarConversaAberta(conversaLida);');
  });
});
