import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A fila de anexos ATRAVESSANDO a troca de conversa — pinos estruturais.
//
// A fila (vários anexos, um por mensagem) vive em `message-composer.tsx` e o
// envio em `message-thread.tsx`; os dois são NOSSOS e o CLAUDE.md os marca
// como reescritos a cada merge do upstream. Não há regra pura a extrair
// aqui: o que quebra é a AMARRAÇÃO com o ciclo de vida do React — um ref
// solto no efeito de troca, uma guarda depois de um `await`. Daí os pinos.
//
// Os dois achados do Codex no PR #146, os dois medidos no código mesclado:
//
//  - O trinco `enviandoFilaRef` não era solto na troca de conversa. Como
//    ele só é liberado pelo `finally` de `sendDraft` — que espera o envio
//    em voo assentar, e o `fetch` de `/api/whatsapp/send` não tem prazo —,
//    sair de uma conversa com a fila correndo levava o trinco junto: no
//    cliente seguinte o botão Enviar do anexo nascia desabilitado e um
//    `sendDraft` novo era recusado na entrada, sem toast e sem nada a
//    clicar. Com a requisição travada, para sempre.
//
//  - `handleSendMedia` limpava a citação ANTES dos três retornos `false`
//    que mantêm o anexo na fila (PR #146). Como `MediaDraft` não guarda o
//    id da citada, a segunda tentativa saía SEM a citação — enquanto a
//    bolha falhada no fio seguia mostrando a resposta que o retry não
//    carrega. O anexo trocava de contexto em silêncio.
// ============================================================

const raiz = path.join(__dirname, '..', '..');

/** Fonte sem comentários — os dois arquivos NOMEIAM estas regras ao
 *  explicá-las, e checar prosa faria o teste acusar a própria documentação. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const fio = () => fonte('components/inbox/message-thread.tsx');
const compositor = () => fonte('components/inbox/message-composer.tsx');

function ocorrencias(texto: string, agulha: string): number {
  return texto.split(agulha).length - 1;
}

describe('a fila de anexos e a troca de conversa (#146)', () => {
  it('o trinco da fila é solto na troca de conversa, não só no fim do envio', () => {
    const c = compositor();
    // Solto no `finally` de `sendDraft` E no efeito de troca. Duas quedas,
    // não uma: com só a do `finally`, o trinco atravessa a troca.
    expect(ocorrencias(c, 'enviandoFilaRef.current = 0;')).toBe(2);
    expect(ocorrencias(c, 'setEnviandoFila(false);')).toBe(2);
  });

  it('o trinco guarda a POSSE, e o finally só solta quem ainda é dono', () => {
    const c = compositor();
    // Com booleano, o `finally` do envio de A derrubava o trinco de um envio
    // já em curso em B — e o clique seguinte reenviava os anexos de B.
    expect(c).toContain('const enviandoFilaRef = useRef(0);');
    expect(c).toContain('const posse = ++proximaPosseRef.current;');
    expect(c).toContain('if (enviandoFilaRef.current === posse) {');
    // E a entrada compara contra "ninguém", não contra a verdade do booleano.
    expect(c).toContain('enviandoFilaRef.current !== 0');
  });

  it('o laço da fila é cancelado pela POSSE depois de cada await, não pelo id da conversa', () => {
    const c = compositor();
    const corpo = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    // Um ponto por ramo: o agendado e o de enviar agora.
    expect(ocorrencias(corpo, 'if (enviandoFilaRef.current !== posse) return;')).toBe(2);
    // ⚠️ Comparar o id da conversa NÃO serve: em A → B → A ele volta a casar
    // e o laço abandonado de A retoma, mandando anexos cujos objetos já foram
    // apagados e limpando a citação da sessão nova (Codex, PR #148).
    expect(corpo).not.toContain('conversaAnteriorRef.current !== origem');
  });

  it('o fim da fila só limpa a citação se ela ainda for a que saiu', () => {
    const c = compositor();
    const corpo = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    // O operador pode clicar Responder noutra mensagem enquanto os anexos
    // sobem; limpar o que estiver vigente apagaria a escolha nova.
    expect(corpo).toContain('const citada = replyTo?.id;');
    // ⚠️⚠️ Quem COMPARA é o dono do estado, dentro do updater — o compositor
    // só informa qual citação saiu. A primeira versão comparava contra um ref
    // alimentado por `useEffect`, e efeito é PASSIVO: a promessa do upload
    // pode assentar depois de o React comprometer o `replyTo` novo e antes de
    // o efeito atualizar o ref, e aí apaga-se exatamente a citação nova — o
    // defeito que esta guarda existe para impedir (Codex, PR #149).
    expect(corpo).toContain('onClearReply?.(citada);');
    expect(corpo).not.toContain('citadaAtualRef');
    // E o que a fila manda é a citação CAPTURADA, não a lida a cada volta.
    expect(corpo).not.toContain('replyToId: replyTo?.id');
    expect(ocorrencias(corpo, 'replyToId: citada')).toBe(2);
  });

  it('o envio de mídia NÃO limpa a citação — quem limpa é o fim da fila', () => {
    const f = fio();
    // `handleSendMedia` tem três saídas `false` que retêm o anexo; limpar
    // a citação em qualquer ponto do corpo dele faz o retry sair sem resposta.
    const corpo = f.slice(f.indexOf('const handleSendMedia'), f.indexOf('const handleSendInteractive'));
    expect(corpo).toContain('publicarMensagemOtimista(optimisticMsg);');
    expect(corpo).not.toContain('setReplyTo(');
    // E o compositor continua sendo quem PEDE a limpeza, depois da fila
    // inteira — mas quem decide é este updater, com o estado mais fresco.
    expect(f).toContain('setReplyTo((atual) =>');
    expect(f).toContain('atual?.id === idQueSaiu ? null : atual');
    // ⚠️ `typeof`, e não `!== undefined`: passar esta função direto para um
    // `onClick` mandaria o MouseEvent como `idQueSaiu`, e o botão de fechar a
    // citação morreria em silêncio.
    expect(f).toContain('typeof idQueSaiu !== "string"');
    expect(compositor()).toContain('onClearReply?.();');
  });

  it('MediaDraft não guarda a citada — é por isso que ela tem de sobreviver', () => {
    // Se um dia o rascunho passar a carregar o id da citada, este pino cai
    // e a regra acima muda de forma: aí a citação pode ser limpa no envio.
    const c = compositor();
    const tipo = c.slice(c.indexOf('interface MediaDraft'), c.indexOf('function novoDraft'));
    expect(tipo).not.toContain('replyTo');
  });
});
