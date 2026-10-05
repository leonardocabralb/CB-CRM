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

function cru(relativo: string): string {
  return fs.readFileSync(path.join(raiz, relativo), 'utf8');
}

/**
 * Fonte sem comentários — os arquivos citam os nomes ao EXPLICAR as
 * decisões, e checar prosa faria o teste acusar a própria documentação.
 * ⚠️ Só tira comentário que COMEÇA depois de espaço, `{` ou `(`: o corte
 * ingênuo tomava o `/*` de `"image/*"` por comentário e engolia o código até
 * o próximo `*\/` — escondendo justamente o que um pino de contagem procura.
 */
function fonte(relativo: string): string {
  return cru(relativo)
    .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function arquivosDoCodigo(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      achados.push(...arquivosDoCodigo(caminho));
    } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      achados.push(path.relative(raiz, caminho).split(path.sep).join('/'));
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
 * O fio num painel lateral, fora da caixa de entrada (pauta de reuniões,
 * 05/10/2026). Monta o MESMO `MessageThread` — o zero das não lidas segue
 * sendo dele — e é o segundo dono de seleção: escreve a presença com a mesma
 * régua da página.
 */
const PAINEL = 'components/inbox/conversa-em-painel.tsx';

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
    // Fonte CRU (comentário que cite um zero só pede uma olhada), chave com
    // ou sem aspas, objeto (`unread_count: 0`), ternário (`x ? 0 :`) e SQL em
    // texto (`unread_count = 0`).
    const zera = /["'`]?\bunread_count["'`]?\s*(?::|=)\s*(?:0\b|[\w.?]+\s*\?\s*0\s*:)/;
    const achados = arquivosDoCodigo(raiz)
      .filter((relativo) => zera.test(cru(relativo)))
      .sort();
    expect(achados).toEqual(Object.keys(QUEM_ZERA).sort());
  });

  it('o fio grava o zero num lugar só, e cada chamada passa pelo modo', () => {
    const f = fonte(FIO);
    expect(ocorrencias(f, '.update({ unread_count: 0 })')).toBe(1);
    // Definição + as TRÊS chamadas abaixo. Chamada nova, sem guarda, muda a
    // conta — e um efeito "zera ao abrir" a mais passaria por todo o resto.
    expect(ocorrencias(f, 'zerarNaoLidas(')).toBe(4);
    expect(f).toContain('function zerarNaoLidas(conversationId: string)');
    // Ver: só fora do modo. Sem o `modoAnonimo` nas dependências, desligar o
    // modo com a conversa aberta não a zeraria até chegar outra mensagem.
    expect(f).toMatch(
      /if \(!conversationId \|\| !hasUnread \|\| modoAnonimo\) return;\s*zerarNaoLidas\(conversationId\);/,
    );
    expect(f).toContain('}, [conversationId, hasUnread, modoAnonimo]);');
    // Responder pelo compositor e "Executar agora" da agendada: só no modo.
    expect(f).toContain('if (modoAnonimo) zerarNaoLidas(conversationIdDoEnvio);');
    expect(f).toMatch(
      /aoEnviarAgora=\{\s*modoAnonimo \? \(\) => zerarNaoLidas\(conversation\.id\) : undefined\s*\}/,
    );
  });

  it('todo envio do compositor confirma por `marcarEnviada`, com a conversa do envio', () => {
    const f = fonte(FIO);
    // Um 5º caminho que chame a rota sem passar por `marcarEnviada` não
    // zeraria ao responder no modo — a conta dos dois lados acusa.
    const envios = ocorrencias(f, 'fetch("/api/whatsapp/send"');
    expect(envios).toBe(4);
    expect(ocorrencias(f, 'marcarEnviada(tempId, ')).toBe(envios);
    expect(
      f.match(/marcarEnviada\(tempId, (?:payload|data), conversation\.id\);/g),
    ).toHaveLength(envios);
  });

  it('a conversa LIDA some no modo e fora do perfil — a régua do cartão de bloqueio', () => {
    const p = fonte(PAGINA);
    expect(p).toMatch(
      /const foraDoPerfil =\s*activeConversation !== null && !conversaNoEscopo\(acesso, activeConversation\);/,
    );
    expect(p).toMatch(
      /const conversaLida =\s*modoAnonimo \|\| foraDoPerfil \? null : \(activeConversation\?\.id \?\? null\);/,
    );
    // O cartão que SUBSTITUI o fio e a ficha que some usam a MESMA variável:
    // uma cópia inline divergiria, e a presença ou a lista contariam como
    // lida uma conversa que a tela mostra bloqueada (ou o contrário).
    expect(ocorrencias(p, '{foraDoPerfil ? (')).toBe(2);
    expect(p).not.toMatch(/activeConversation && !conversaNoEscopo\(acesso, activeConversation\)/);
  });

  it('a página só esvazia o espelho da lista fora do modo', () => {
    const p = fonte(PAGINA);
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
  it('os escritores da presença são os donos da seleção, com a conversa LIDA', () => {
    const escritores = arquivosDoCodigo(raiz)
      .filter((relativo) => relativo !== 'hooks/use-conversa-aberta.ts')
      .filter((relativo) => fonte(relativo).includes('useMarcarConversaAberta('))
      .sort();
    expect(escritores).toEqual([PAGINA, PAINEL].sort());
    expect(fonte(PAGINA)).toContain('useMarcarConversaAberta(conversaLida);');
    // O painel com a MESMA régua da página: nula no modo e fora do perfil.
    const p = fonte(PAINEL);
    expect(p).toContain('useMarcarConversaAberta(conversaLida);');
    expect(p).toMatch(
      /const foraDoPerfil =\s*conversation !== null && !conversaNoEscopo\(acesso, conversation\);/,
    );
    expect(p).toMatch(
      /const conversaLida =\s*modoAnonimo \|\| foraDoPerfil \? null : \(conversation\?\.id \?\? null\);/,
    );
    // E fora do perfil o fio não monta: ele zeraria as não lidas.
    expect(p).toMatch(/if \(foraDoPerfil\) \{\s*return \(/);
    // E a RPC que grava a presença só é CHAMADA pelo hook (o nome aparece em
    // comentário noutros arquivos).
    const rpc = arquivosDoCodigo(raiz).filter((relativo) =>
      /rpc\(\s*["'`]cb_marcar_conversa_aberta["'`]/.test(cru(relativo)),
    );
    expect(rpc).toEqual(['hooks/use-conversa-aberta.ts']);
  });
});

describe('modo anônimo: quem monta o fio', () => {
  it('o fio só monta onde a régua da página está escrita', () => {
    // Montar o `MessageThread` já ZERA as não lidas (o efeito mora nele), e o
    // inventário de quem zera não acusa uma tela nova que só o monte: o zero
    // continua no fio. Tela nova que monte o fio decide a régua (modo
    // anônimo, fora do perfil, presença) e entra nesta lista.
    const montadores = arquivosDoCodigo(raiz)
      .filter((relativo) => relativo !== FIO)
      .filter((relativo) => /<MessageThread\b/.test(fonte(relativo)))
      .sort();
    expect(montadores).toEqual([PAGINA, PAINEL].sort());
  });
});
