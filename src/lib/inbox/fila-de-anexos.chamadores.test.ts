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
    // Solto no `finally` de `sendDraft`, no efeito de troca E no desmonte
    // (fila por conversa, 21/10/2026: vivo depois do desmonte, o laço de
    // agendar seguiria com a fila que o compositor remontado oferece de novo).
    // Com só a do `finally`, o trinco atravessa a troca. O desmonte não mexe
    // em estado: as duas quedas de `setEnviandoFila` continuam sendo duas.
    expect(ocorrencias(c, 'enviandoFilaRef.current = 0;')).toBe(3);
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
    expect(corpo).not.toContain('conversaNaTelaRef.current !== origem');
    // E agendar desvia ANTES da janela de desfazer (925): a janela dispara
    // na troca de conversa e mandaria em 3 s o que era para amanhã.
    expect(corpo.indexOf('if (quandoAg) {')).toBeLessThan(corpo.indexOf('setPendente('));
  });

  it('os anexos LIBERADOS não param na troca de conversa — saem para a origem', () => {
    // Antes da janela de desfazer, a troca no meio de uma fila descartava em
    // silêncio os anexos que faltavam. Agora o despachante é preso à origem
    // e o envio não consulta posse nem conversa para seguir; a conversa só
    // decide o que volta à fila de rascunho da origem.
    const c = compositor();
    const laco = c.slice(c.indexOf('const enviarAnexo = useCallback('), c.indexOf('const despachar = useCallback('));
    expect(laco).not.toContain('enviandoFilaRef');
    expect(laco).not.toContain('posse');
    expect(laco).toContain('if (montadoRef.current && conversaNaTelaRef.current === p.origem) {');
  });

  it('quem volta de uma espera confere a conversa NA TELA pelo ref de LAYOUT', () => {
    // Codex, PRs #414 e #415: o `conversaAnteriorRef` é escrito no efeito de
    // troca, que é PASSIVO. A volta de um `fetch` (upload, envio que falhou)
    // que caísse entre o commit da troca e ele punha o arquivo de A na prévia
    // de B — e um Enviar o entregava ao cliente errado.
    const c = compositor();
    expect(c).toMatch(
      /useLayoutEffect\(\(\) => \{\s*conversaNaTelaRef\.current = conversationId;\s*\}, \[conversationId\]\);/,
    );
    // Os três uploads (arquivo, acervo, voz): desde a fila por conversa
    // (21/10/2026) o anexo vai para a fila da ORIGEM, e o ref só decide se a
    // seleção da tela muda (`anexos-da-conversa.chamadores.test.ts`).
    expect(ocorrencias(c, 'if (conversaNaTelaRef.current === origem) setSelecionado(')).toBe(3);
    expect(c).not.toContain('conversaAnteriorRef.current !== origem');
    expect(c).not.toContain('conversaAnteriorRef.current === p.origem');
  });

  it('cada anexo é um trabalho PRÓPRIO na fila, e a falha só devolve o que não começou', () => {
    // Revisão do PR #415: o lote inteiro como UM trabalho fazia o teto da
    // fila contar o lote, e o texto mandado depois de dez áudios passava na
    // frente dos últimos.
    const c = compositor();
    expect(c).toMatch(
      /p\.itens\.forEach\(\(_, i\) => \{\s*void filaDeSaida\.enfileirar\(p\.origem, \(\) => enviarAnexo\(p, i, lote\)\);/,
    );
    const laco = c.slice(c.indexOf('const enviarAnexo = useCallback('), c.indexOf('const despachar = useCallback('));
    // Um que falhou para os seguintes do MESMO lote.
    expect(laco.indexOf('if (lote.parou) return;')).toBeLessThan(laco.indexOf('await p.enviar('));
    // ⚠️ O teto pode soltar o seguinte com o anterior ainda no ar: o que já
    // COMEÇOU nunca volta à prévia (sairia duas vezes, ou perderia o arquivo).
    expect(laco.indexOf('lote.comecados = i + 1;')).toBeLessThan(laco.indexOf('await p.enviar('));
    // ⚠️ E o resto do lote é de UMA falha só (Codex, PR #415): com dois no ar
    // e os dois falhando, a mesma cauda voltaria duas vezes à prévia.
    const reivindica = laco.indexOf('const cauda = lote.parou ? [] : p.itens.slice(lote.comecados);');
    expect(reivindica).toBeGreaterThan(-1);
    expect(reivindica).toBeLessThan(laco.indexOf('lote.parou = true;'));
    // Na tela, o que falhou e os que nem começaram voltam à prévia. Fora
    // dela, à fila da ORIGEM (fila por conversa, 21/10/2026) só os que nem
    // começaram, com aviso — antes eram apagados. ⚠️ O que falhou fica
    // marcado e fora da fila: a entrega dele é incerta, e sem a bolha à vista
    // a prévia o mandaria em dobro (revisão independente do PR).
    const naTela = laco.indexOf('if (montadoRef.current && conversaNaTelaRef.current === p.origem) {');
    const tudo = laco.indexOf('devolverAPrevia(p, [item, ...cauda]);');
    const soCauda = laco.indexOf('devolverAPrevia(p, cauda);');
    expect(naTela).toBeGreaterThan(-1);
    expect(tudo).toBeGreaterThan(naTela);
    expect(soCauda).toBeGreaterThan(tudo);
    expect(laco).not.toContain('removeStaged(');
    expect(laco).toContain('t("anexosNaoSairam", { n: cauda.length })');
  });

  it('tudo o que sai passa pela fila de saída da ORIGEM — nunca `enviar` direto', () => {
    const c = compositor();
    // Os dois únicos chamadores do despachante: o texto, dentro da fila, e
    // o laço dos anexos, que também roda dentro dela.
    expect(ocorrencias(c, '.enviar(')).toBe(2);
    expect(ocorrencias(c, 'filaDeSaida.enfileirar(p.origem,')).toBe(2);
    // A desmontagem também (texto OU anexos).
    expect(c).toMatch(/pendenteRef\.current = null;\s*despacharRef\.current\(p\);/);
    // E a interativa (revisão do PR #415): fora da fila, a mandada logo
    // depois de um áudio chegaria antes dele. A retida sai primeiro.
    expect(ocorrencias(c, 'onSendInteractive(')).toBe(1);
    const interativa = c.slice(c.indexOf('const sendInteractive = useCallback('), c.indexOf('const saveAsQuickReply'));
    expect(interativa.indexOf('liberarPendente();')).toBeGreaterThan(-1);
    expect(interativa.indexOf('liberarPendente();')).toBeLessThan(
      interativa.indexOf('void filaDeSaida.enfileirar(conversationId, () => onSendInteractive(payload, citada));'),
    );
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
    // ⚠️ E só quando o lote INTEIRO saiu (revisão do PR #415): limpando na
    // liberação, o anexo que falhava voltava à prévia sem a citação, e a nova
    // tentativa saía solta (#146 de novo, por outro caminho).
    const liberar = c.slice(c.indexOf('const liberarPendente = useCallback('), c.indexOf('const desfazerEnvio'));
    // O texto limpa ao sair — menos o REENVIO de uma bolha que não saiu
    // (19/10/2026): ele leva a citação DELA, e a da tela é de quem escreve
    // outra coisa (`reenvio-da-bolha.chamadores.test.ts`).
    expect(liberar).toContain('if (p.tipo === "texto" && !p.substitui) onClearReplyRef.current?.();');
    expect(liberar).not.toContain('p.replyToId');
    const laco = c.slice(c.indexOf('const enviarAnexo = useCallback('), c.indexOf('const despachar = useCallback('));
    expect(ocorrencias(laco, 'lote.faltam -= 1;')).toBe(1);
    expect(laco.indexOf('if (entregou) {')).toBeLessThan(laco.indexOf('lote.faltam -= 1;'));
    expect(laco).toContain('if (lote.faltam === 0 && p.replyToId) onClearReplyRef.current?.(p.replyToId);');
    expect(c).toContain('const lote: Lote = { parou: false, comecados: 0, faltam: p.itens.length };');
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
    expect(compositor()).toContain('onClearReplyRef.current?.(p.replyToId);');
  });

  it('o anexo RETIDO já é da mensagem: marcado na retenção, desmarcado só no Desfazer e na falha', () => {
    // Pela Evolution uma nota de voz leva segundos para sair. Sem a marca, a
    // limpeza de troca de conversa apagava o arquivo que a mensagem enviada
    // usa: o cliente recebia e a bolha do CRM ficava sem o áudio (#413). Com
    // a janela de desfazer a marca vem JÁ na retenção. Desde a fila por
    // conversa (21/10/2026) a troca não apaga mais nada, mas a marca segue
    // protegendo o descarte e a retenção em dobro.
    const c = compositor();
    const corpo = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    const marca = corpo.indexOf('for (const d of itens) entreguesRef.current.add(d.path);');
    expect(marca).toBeGreaterThan(-1);
    expect(marca).toBeLessThan(corpo.indexOf('setPendente('));
    // O segundo clique no mesmo quadro não retém os mesmos anexos de novo.
    expect(corpo).toContain('drafts.filter((d) => !entreguesRef.current.has(d.path))');
    // Desfazer devolve à prévia — e à posse do rascunho.
    const desfazer = c.slice(c.indexOf('const desfazerEnvio'), c.indexOf('const agendar = useCallback('));
    expect(desfazer).toContain('devolverAPrevia(p, p.itens);');
    const devolver = c.slice(c.indexOf('const devolverAPrevia = useCallback('), c.indexOf('const enviarAnexo = useCallback('));
    expect(devolver).toContain('for (const d of devolvidos) entreguesRef.current.delete(d.path);');
    // ⚠️ No envio, só a FALHA desmarca, e só o que volta à fila (pela
    // devolução); o sucesso nunca, e o que falhou fora da tela também não.
    const laco = c.slice(c.indexOf('const enviarAnexo = useCallback('), c.indexOf('const despachar = useCallback('));
    expect(ocorrencias(laco, 'entreguesRef.current.delete(')).toBe(0);
    expect(ocorrencias(laco, 'devolverAPrevia(')).toBe(2);
    expect(laco.indexOf('if (entregou) {')).toBeLessThan(laco.indexOf('devolverAPrevia(p, [item, ...cauda]);'));
  });

  it('o teto é cobrado na SAÍDA; a devolução volta inteira e não apaga nada', () => {
    // Revisão do PR #415 + teste no preview (16/10/2026): durante a janela (ou
    // enquanto o lote saía) o compositor fica livre, e um upload em voo pousa
    // DEPOIS do Desfazer — nenhuma conta feita na devolução o enxerga. A soma
    // passava de `MAX_ANEXOS` e saía inteira.
    const c = compositor();
    // Desfazer e falha (na tela, e fora dela) passam pela MESMA porta.
    expect(ocorrencias(c, 'devolverAPrevia(')).toBe(3);
    expect(c).not.toContain('[...p.itens, ...atual]');
    expect(c).not.toContain('[...sobra, ...atual]');
    const devolver = c.slice(c.indexOf('const devolverAPrevia = useCallback('), c.indexOf('const enviarAnexo = useCallback('));
    // ⚠️ Não corta nem recolhe: o arquivo é de um anexo que o operador pediu
    // de volta. E a atualização é funcional (o upload que pousa no mesmo
    // quadro não some).
    expect(devolver).not.toContain('removeStaged(');
    expect(devolver).toContain('p.rascunho((atual) => [...devolvidos, ...atual]);');
    // A saída confere — antes de reter E de agendar.
    const corpo = c.slice(c.indexOf('const sendDraft'), c.indexOf('const discardDraft'));
    const teto = corpo.indexOf('if (drafts.length > MAX_ANEXOS) {');
    expect(teto).toBeGreaterThan(-1);
    expect(teto).toBeLessThan(corpo.indexOf('if (quandoAg) {'));
    expect(teto).toBeLessThan(corpo.indexOf('setPendente('));
    expect(corpo).toContain('t("tetoDeAnexosNoEnvio", { max: MAX_ANEXOS, n: drafts.length - MAX_ANEXOS })');
  });

  it('o fio separa a conversa de ORIGEM da que está NA TELA', () => {
    // Revisão do PR #415: a fila pode soltar o envio de A depois da troca
    // para B. Sem a guarda, a bolha de A caía no fio de B, a janela de 24h
    // de B recusava o anexo de A e o texto de A apagava a citação de B.
    const f = fio();
    // Num efeito de LAYOUT (a fila roda em microtarefa depois do commit), e a
    // limpeza ZERA: o fio desmonta na conversa de outra área com a página
    // (e as mensagens dela) ainda montada.
    expect(f).toMatch(
      /useLayoutEffect\(\(\) => \{\s*conversaNaTelaRef\.current = conversation\?\.id \?\? null;\s*return \(\) => \{\s*conversaNaTelaRef\.current = null;\s*\};\s*\}, \[conversation\?\.id\]\);/,
    );
    expect(ocorrencias(f, 'const naTela = conversaNaTelaRef.current === conversation.id;')).toBe(3);
    expect(ocorrencias(f, 'if (naTela) publicarMensagemOtimista(optimisticMsg);')).toBe(2);
    // A citação da tela só sai no envio NOVO; o reenvio de uma bolha que não
    // saiu (19/10/2026) não mexe nela.
    expect(f).toMatch(
      /if \(naTela\) \{\s*publicarMensagemOtimista\(optimisticMsg\);\s*if \(substitui\) \{[\s\S]*?\} else \{\s*setReplyTo\(null\);\s*\}\s*\}/,
    );
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
