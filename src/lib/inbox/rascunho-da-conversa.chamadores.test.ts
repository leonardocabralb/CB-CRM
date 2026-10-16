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

  it('o que termina DEPOIS de uma troca só mexe na tela se ela ainda for a de origem', () => {
    // O texto vai para o rascunho de origem pelo `setText` preso; o resto
    // (foco, hora agendada, citação) é da conversa aberta AGORA.
    const c = semComentarios(compositor());
    const agendar = c.slice(c.indexOf('const agendar = useCallback('), c.indexOf('const handleSend = useCallback('));
    expect(agendar).toContain('const origem = conversationId;');
    expect(agendar).toMatch(
      /if \(conversaNaTelaRef\.current === origem\) \{\s*limparAgendamento\(\);\s*onClearReply\?\.\(\);\s*\}/,
    );
    // E só limpa o rascunho se ele ainda for o texto agendado.
    expect(agendar).toContain('setText((atual) => (atual.trim() === texto ? "" : atual))');
    const ia = c.slice(c.indexOf('const handleDraft = useCallback('), c.indexOf('const openInteractiveBuilder'));
    expect(ia).toContain('const origem = conversationId;');
    expect(ia.indexOf('if (conversaNaTelaRef.current !== origem) return;')).toBeLessThan(
      ia.indexOf('el.focus();'),
    );
    // ⚠️ A marca "na tela" anda num efeito de LAYOUT: no passivo, a
    // continuação de um `fetch` entre o commit da troca e o efeito leria a
    // conversa anterior (Codex, PR #414).
    expect(c).toMatch(
      /useLayoutEffect\(\(\) => \{\s*conversaNaTelaRef\.current = conversationId;\s*\}, \[conversationId\]\);/,
    );
    expect(c).not.toMatch(/conversaAnteriorRef\.current (?:===|!==) origem/);
  });

  it('a altura é medida no efeito sobre `text` e quando a caixa volta a montar, não por tecla', () => {
    const c = semComentarios(compositor());
    expect(c).toMatch(/useLayoutEffect\(\(\) => \{\s*acertarAltura\(\);\s*\}, \[text, acertarAltura\]\);/);
    expect(c).toContain('ref={refDaCaixa}');
    const troca = c.slice(c.indexOf('const handleChange = useCallback('), c.indexOf('const handleDraft = useCallback('));
    expect(troca).not.toContain('adjustHeight');
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
    // As duas aspas: o `.prettierrc` pede simples, o arquivo usa duplas.
    expect(h).toMatch(/chaveDoRascunho\(userId \?\? ["']sem-login["'], conversationId\)/);
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
