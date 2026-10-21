import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Anexos em rascunho por conversa — pinos estruturais no compositor e no hook.
//
// A regra pura tem teste próprio (`anexos-da-conversa.test.ts`). O que quebra
// sem erro é a AMARRAÇÃO: `message-composer.tsx` veio do upstream, e um merge
// que traga o `useState<MediaDraft[]>` de volta, ou a limpeza da troca de
// conversa, devolve o comportamento antigo (os anexos jogados fora) — ou
// pior, sem a limpeza, o documento de um cliente montado na prévia do
// próximo. O `setDrafts` é PRESO à conversa: a diretiva no topo do compositor
// faz o `exhaustive-deps` reprovar quem o chame sem levá-lo nas dependências.
// ============================================================

const raiz = path.join(__dirname, '..', '..');
const semComentarios = (texto: string) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fonte = (relativo: string) =>
  semComentarios(fs.readFileSync(path.join(raiz, relativo), 'utf8'));

const compositor = () => fonte('components/inbox/message-composer.tsx');
const hook = () => fonte('hooks/use-anexos-da-conversa.ts');

function ocorrencias(texto: string, agulha: string): number {
  return texto.split(agulha).length - 1;
}

describe('a fila de anexos é da CONVERSA', () => {
  it('vem do repositório de módulo, não de um estado do componente', () => {
    const c = compositor();
    expect(c).toContain(
      'const [drafts, setDrafts, lerDrafts] = useAnexosDaConversa(anexosDaConversa, conversationId);',
    );
    // Exportado: a marca "Rascunho" da lista lê a MESMA fila.
    expect(c).toMatch(/^export const anexosDaConversa = criarRepositorioDeAnexos<MediaDraft>\(\);$/m);
    expect(c).not.toMatch(/useState<MediaDraft\[\]>/);
    // O espelho por efeito (passivo) saiu: quem precisa da fila de AGORA lê
    // o repositório (`lerDrafts`).
    expect(c).not.toContain('draftsRef');
  });

  it('a troca de conversa e o desmonte NÃO apagam nem esvaziam a fila', () => {
    const c = compositor();
    const troca = c.slice(
      c.indexOf('const conversaAnteriorRef = useRef(conversationId);'),
      c.indexOf('const [restam, setRestam]'),
    );
    expect(troca).not.toContain('setDrafts(');
    expect(troca).not.toContain('removeStaged(');
    // Só o descarte da PESSOA apaga objeto do bucket: o "X" de um item e o
    // descartar tudo. Uma terceira chamada é uma limpeza nova — decidir antes.
    expect(ocorrencias(c, 'removeStaged(')).toBe(2);
    const descarte = c.slice(c.indexOf('const discardDraft = useCallback('), c.indexOf('const setCaption'));
    expect(ocorrencias(descarte, 'removeStaged(')).toBe(2);
  });

  it('o upload que pousa depois da troca vai para a fila da ORIGEM; a seleção, só na tela', () => {
    const c = compositor();
    // Os três uploads (arquivo, acervo, voz). Antes apagavam o objeto.
    expect(ocorrencias(c, 'if (conversaNaTelaRef.current === origem) setSelecionado((atual) => atual ?? ')).toBe(3);
    expect(c).not.toContain('if (conversaNaTelaRef.current !== origem) {');
    for (const inicio of ['const stageUpload = useCallback(', 'const escolherDoAcervo = useCallback(', 'const finalizeRecording = useCallback(']) {
      // Até a PRÓXIMA declaração do componente (dois espaços de recuo): o
      // fechamento `},\n    [` do useCallback não serve de fim — o recorte do
      // acervo engoliria o da voz, e passaria por causa dela.
      const comeco = c.indexOf(inicio);
      const corpo = c.slice(comeco, c.indexOf('\n  const ', comeco + inicio.length));
      expect(corpo).toContain('const origem = conversationId;');
      expect(corpo).toMatch(/setDrafts\(\(atual\) => \[\.\.\.atual, \w+\]\);/);
      expect(corpo).toMatch(/\[setDrafts, /);
      expect(ocorrencias(corpo, 'useCallback(')).toBe(1);
    }
  });

  it('o desfeito volta à fila da ORIGEM, presa na retenção', () => {
    const c = compositor();
    const envio = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    expect(envio).toContain('rascunho: setDrafts,');
    const devolver = c.slice(c.indexOf('const devolverAPrevia = useCallback('), c.indexOf('const enviarAnexo = useCallback('));
    expect(devolver).toContain('p.rascunho((atual) => [...devolvidos, ...atual]);');
    expect(devolver).not.toContain('setDrafts(');
    expect(devolver).toMatch(/if \(montadoRef\.current && conversaNaTelaRef\.current === p\.origem\) \{\s*setSelecionado\(/);
  });

  it('o laço de agendar tira cada anexo ao agendá-lo, pula o marcado e o que saiu da fila, e para no desmonte', () => {
    // Revisão independente do PR: vivo depois do desmonte, o laço agendava a
    // fila que o compositor remontado oferecia de novo — Enviar ou Agendar
    // outra vez mandava em dobro, e o "X" (que não trava) apagava o arquivo
    // de um anexo que o laço ainda agendaria.
    const c = compositor();
    const corpo = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    const pulaMarcado = corpo.indexOf('if (entreguesRef.current.has(item.path)) continue;');
    const pulaFora = corpo.indexOf('if (!lerDrafts().some((d) => d.id === item.id)) continue;');
    const agenda = corpo.indexOf('await agendar(');
    expect(pulaMarcado).toBeGreaterThan(-1);
    expect(pulaFora).toBeGreaterThan(-1);
    expect(pulaMarcado).toBeLessThan(agenda);
    expect(pulaFora).toBeLessThan(agenda);
    const tira = corpo.indexOf('if (ok) setDrafts((atual) => atual.filter((d) => d.id !== item.id));');
    expect(tira).toBeGreaterThan(agenda);
    expect(tira).toBeLessThan(corpo.indexOf('if (enviandoFilaRef.current !== posse) return;'));
    expect(corpo).not.toContain('restantes');
    // O desmonte zera a posse (a troca também — `fila-de-anexos.chamadores`).
    expect(c).toMatch(
      /void recorderRef\.current\?\.stop\(\)\.catch\(\(\) => \{\}\);\s*enviandoFilaRef\.current = 0;\s*\};\s*\}, \[clearTimer\]\);/,
    );
  });

  it('a falha FORA da tela devolve à fila só o que nem começou', () => {
    // O que falhou pode ter saído (tempo esgotado e 5xx chegam como falha): sem
    // a bolha à vista, a prévia o ofereceria de novo e o cliente o receberia
    // em dobro. Fica marcado e fora da fila.
    const c = compositor();
    const laco = c.slice(c.indexOf('const enviarAnexo = useCallback('), c.indexOf('const despachar = useCallback('));
    const fora = laco.slice(laco.indexOf('devolverAPrevia(p, [item, ...cauda]);'));
    expect(fora).toMatch(/if \(cauda\.length > 0\) \{\s*devolverAPrevia\(p, cauda\);/);
    expect(ocorrencias(fora, 'item')).toBe(1);
  });

  it('a gravação vence a prévia, e os despachantes andam num efeito de LAYOUT', () => {
    const c = compositor();
    // Um anexo que pousa com o microfone ligado esconderia a barra de parar.
    expect(c).toContain('{drafts.length > 0 && !recording ? (');
    // A fila de B aparece no 1º quadro de B: o despachante tem de ser o de B.
    expect(c).toMatch(/useLayoutEffect\(\(\) => \{\s*onSendRef\.current = onSend;\s*\}, \[onSend\]\);/);
    expect(c).toMatch(/useLayoutEffect\(\(\) => \{\s*onSendMediaRef\.current = onSendMedia;\s*\}, \[onSendMedia\]\);/);
  });

  it('a marca "já é de uma mensagem" é de MÓDULO, como a fila', () => {
    // O compositor que remonta com um agendamento no ar mostra o anexo na fila:
    // sem a marca do que desmontou, o "X" apagaria o arquivo da agendada.
    const c = compositor();
    expect(c).toMatch(/^const caminhosEntregues = new Set<string>\(\);$/m);
    expect(c).toContain('const entreguesRef = useRef<Set<string>>(caminhosEntregues);');
  });
});

describe('o hook', () => {
  it('a chave leva o LOGIN e a conversa — no compositor e na lista', () => {
    // Duas: a fila do compositor e a contagem da marca "Rascunho" da lista.
    expect(hook().match(/chaveDosAnexos\(user\?\.id \?\? ["']sem-login["'], conversationId\)/g)).toHaveLength(2);
    // E o leitor do TEXTO para a lista, com a mesma chave do escritor.
    expect(fonte('hooks/use-rascunho-da-conversa.ts')).toMatch(
      /chaveDoRascunho\(user\?\.id \?\? ["']sem-login["'], conversationId\)/,
    );
  });

  it('o `gravar` e o `lerAgora` são presos à chave do render', () => {
    const h = hook();
    expect(ocorrencias(h, '[repositorio, chave]')).toBe(2);
    expect(h).toContain('return [fila, gravar, lerAgora];');
  });

  it('o render lê pelo `useSyncExternalStore`, sem efeito no meio', () => {
    // Por efeito, o primeiro render depois da troca mostraria a prévia com o
    // anexo da conversa anterior (o efeito é passivo).
    const h = hook();
    expect(h).toContain('useSyncExternalStore(');
    expect(h).toContain('() => repositorio.ler(chave)');
    expect(h).not.toContain('useEffect(');
  });
});
