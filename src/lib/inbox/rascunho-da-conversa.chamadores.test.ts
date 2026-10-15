import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Rascunho por conversa — pinos estruturais no compositor e no hook.
//
// A regra pura tem teste próprio (`rascunho-da-conversa.test.ts`). O que
// quebra sem erro é a AMARRAÇÃO: `message-composer.tsx` veio do upstream, e
// um merge que traga o `useState("")` de volta devolve o texto de um cliente
// na caixa do próximo. E o `setText` é PRESO à conversa: um `useCallback`
// que o chame sem levá-lo nas dependências escreve no rascunho de OUTRO
// cliente — o lint acusa, mas só vira erro pela diretiva no topo do arquivo.
// ============================================================

const raiz = path.join(__dirname, '..', '..');
const cru = (relativo: string) => fs.readFileSync(path.join(raiz, relativo), 'utf8');
const semComentarios = (texto: string) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const compositor = () => cru('components/inbox/message-composer.tsx');
const hook = () => semComentarios(cru('hooks/use-rascunho-da-conversa.ts'));

describe('o rascunho por conversa no compositor', () => {
  it('o texto da caixa vem do rascunho da CONVERSA, não de um estado único', () => {
    const c = semComentarios(compositor());
    expect(c).toContain('const [text, setText] = useRascunhoDaConversa(conversationId);');
    expect(c).not.toMatch(/const \[text, setText\] = useState/);
  });

  it('dependência esquecida do `setText` é ERRO de lint neste arquivo', () => {
    // A diretiva é comentário: lida do fonte CRU.
    expect(compositor()).toContain('/* eslint react-hooks/exhaustive-deps: "error"');
  });

  it('a troca de conversa não apaga o texto da caixa — ele fica na conversa de origem', () => {
    const c = semComentarios(compositor());
    const troca = c.slice(
      c.indexOf('const conversaAnteriorRef = useRef(conversationId);'),
      c.indexOf('const [restam, setRestam]'),
    );
    expect(troca).toContain('liberarPendente();');
    expect(troca).not.toContain('setText(');
  });
});

describe('o hook', () => {
  it('a chave leva o LOGIN e a conversa, e só grava com o login conhecido', () => {
    const h = hook();
    expect(h).toContain('chaveDoRascunho(userId ?? "sem-login", conversationId)');
    expect(h).toContain('repositorio.escrever(chave, novo, userId !== null)');
  });

  it('o `definir` é preso à chave do render (muda de identidade com a conversa)', () => {
    // É o que faz a sugestão da IA ou o agendamento que termina DEPOIS da
    // troca escrever no rascunho da conversa de origem.
    expect(hook()).toMatch(/\[chave, userId\],?\s*\);\s*return \[texto, definir\];/);
  });

  it('o render lê pelo `useSyncExternalStore`, sem efeito no meio', () => {
    // Por efeito, o primeiro render depois da troca mostraria o texto da
    // conversa anterior (o efeito é passivo).
    const h = hook();
    expect(h).toContain('useSyncExternalStore(');
    expect(h).toContain('() => repositorio.ler(chave)');
    expect(h).not.toContain('useEffect(');
  });
});
