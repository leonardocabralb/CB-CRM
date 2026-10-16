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

  it('o laço do AGENDAMENTO é cancelado pela POSSE depois de cada await, não pelo id da conversa', () => {
    const c = compositor();
    const corpo = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    // Só o ramo agendado tem laço aqui: o envio imediato RETÉM (sem await).
    expect(ocorrencias(corpo, 'if (enviandoFilaRef.current !== posse) return;')).toBe(1);
    // ⚠️ Comparar o id da conversa NÃO serve: em A → B → A ele volta a casar
    // e o laço abandonado de A retoma (Codex, PR #148).
    expect(corpo).not.toContain('conversaAnteriorRef.current !== origem');
    // E agendar desvia ANTES da janela de desfazer (925): a janela dispara
    // na troca de conversa e mandaria em 3 s o que era para amanhã.
    expect(corpo.indexOf('if (quandoAg) {')).toBeLessThan(corpo.indexOf('setPendente('));
  });

  it('os anexos LIBERADOS não param na troca de conversa — saem para a origem', () => {
    // Antes da janela de desfazer, a troca no meio de uma fila descartava em
    // silêncio os anexos que faltavam. Agora o despachante é preso à origem
    // e o laço não consulta posse nem conversa para seguir; a conversa só
    // decide se o que FALHOU volta à prévia.
    const c = compositor();
    const laco = c.slice(c.indexOf('const enviarAnexos = useCallback('), c.indexOf('const despachar = useCallback('));
    expect(laco).not.toContain('enviandoFilaRef');
    expect(laco).not.toContain('posse');
    expect(laco).toContain('if (montadoRef.current && conversaAnteriorRef.current === p.origem) {');
  });

  it('tudo o que sai passa pela fila de saída da ORIGEM — nunca `enviar` direto', () => {
    const c = compositor();
    // Os dois únicos chamadores do despachante: o texto, dentro da fila, e
    // o laço dos anexos, que também roda dentro dela.
    expect(ocorrencias(c, '.enviar(')).toBe(2);
    expect(ocorrencias(c, 'filaDeSaida.enfileirar(p.origem,')).toBe(2);
    // A desmontagem também (texto OU anexos).
    expect(c).toMatch(/pendenteRef\.current = null;\s*despacharRef\.current\(p\);/);
    // De MÓDULO: o compositor que remonta usa a mesma fila do que saiu.
    expect(c).toMatch(/^const filaDeSaida = criarFilaDeSaida\(\);$/m);
  });

  it('a citação dos anexos só é limpa se ainda for a que saiu', () => {
    const c = compositor();
    const corpo = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    // O operador pode clicar Responder noutra mensagem durante a janela;
    // limpar o que estiver vigente apagaria a escolha nova.
    expect(corpo).toContain('const citada = replyTo?.id;');
    // ⚠️⚠️ Quem COMPARA é o dono do estado, dentro do updater — o compositor
    // só informa qual citação saiu. Um ref alimentado por `useEffect` reabre
    // a corrida, porque efeito é PASSIVO (Codex, PR #149).
    const liberar = c.slice(c.indexOf('const liberarPendente = useCallback('), c.indexOf('const desfazerEnvio'));
    expect(liberar).toContain('else if (p.replyToId) onClearReplyRef.current?.(p.replyToId);');
    expect(c).not.toContain('citadaAtualRef');
    // E o que a fila manda é a citação CAPTURADA, não a relida.
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

  it('o anexo RETIDO já é da mensagem: marcado na retenção, desmarcado só no Desfazer e na falha', () => {
    // Pela Evolution uma nota de voz leva segundos para sair. Sem a marca, a
    // limpeza de troca de conversa apagava o arquivo que a mensagem enviada
    // usa: o cliente recebia e a bolha do CRM ficava sem o áudio (#413). Com
    // a janela de desfazer a marca vem JÁ na retenção: o `draftsRef` que as
    // limpezas percorrem só é atualizado por efeito (passivo).
    const c = compositor();
    const corpo = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    const marca = corpo.indexOf('for (const d of itens) entreguesRef.current.add(d.path);');
    expect(marca).toBeGreaterThan(-1);
    expect(marca).toBeLessThan(corpo.indexOf('setPendente('));
    // O segundo clique no mesmo quadro não retém os mesmos anexos de novo.
    expect(corpo).toContain('drafts.filter((d) => !entreguesRef.current.has(d.path))');
    // Desfazer devolve à prévia — e à posse do rascunho.
    const desfazer = c.slice(c.indexOf('const desfazerEnvio'), c.indexOf('const agendar = useCallback('));
    expect(desfazer).toContain('for (const d of p.itens) entreguesRef.current.delete(d.path);');
    // ⚠️ No laço, só a FALHA desmarca (o que sobrou); o sucesso nunca.
    const laco = c.slice(c.indexOf('const enviarAnexos = useCallback('), c.indexOf('const despachar = useCallback('));
    expect(ocorrencias(laco, 'entreguesRef.current.delete(')).toBe(1);
    expect(laco).toContain('for (const d of sobra) entreguesRef.current.delete(d.path);');
  });

  it('a única porta que apaga objeto do bucket é `removeStaged`, que respeita a marca', () => {
    const c = compositor();
    expect(ocorrencias(c, 'deleteAccountMedia(')).toBe(1);
    const porta = c.slice(c.indexOf('const removeStaged'), c.indexOf('deleteAccountMedia('));
    expect(porta).toContain('if (entreguesRef.current.has(path)) return;');
  });

  it('MediaDraft não guarda a citada — é por isso que ela tem de sobreviver', () => {
    // Se um dia o rascunho passar a carregar o id da citada, este pino cai
    // e a regra acima muda de forma: aí a citação pode ser limpa no envio.
    const c = compositor();
    const tipo = c.slice(c.indexOf('interface MediaDraft'), c.indexOf('function novoDraft'));
    expect(tipo).not.toContain('replyTo');
  });
});
