import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Opções de resposta (1111) — a amarração entre arquivos. O que quebra sem
// erro nenhum: a ingestão montar a linha do botão por outro caminho (a bolha
// mostraria `[Sim]` E o botão "Sim"), alguém gravar a coluna na mensagem da
// equipe, e o clique escrever no rascunho por fora do compositor (o `setText`
// é o único escritor, preso à conversa do render).
// ============================================================

const raiz = path.join(__dirname, '..', '..');
const cru = (relativo: string) => fs.readFileSync(path.join(raiz, relativo), 'utf8');
const semComentarios = (texto: string) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const fontes = (fs.readdirSync(raiz, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => f.split(path.sep).join('/'));

describe('a linha do botão no texto', () => {
  it('a ingestão monta toda linha de botão por `linhaDoBotao` — a mesma que a bolha tira', () => {
    const fonte = semComentarios(cru('lib/whatsapp/transport/evolution-inbound.ts'));
    expect(fonte).not.toMatch(/`\[\$\{/);
    expect(fonte).toContain('linhaDoBotao(');
  });
});

describe('quem grava `messages.opcoes_de_resposta`', () => {
  it('só as gravações da mensagem do CLIENTE pela Evolution (a normal e a recuperada)', () => {
    const escritores = fontes.filter((f) => /\bopcoes_de_resposta\s*:/.test(semComentarios(cru(f))));
    expect(escritores.sort()).toEqual([
      'lib/whatsapp/inbound-store.ts',
      'lib/whatsapp/sem-telefone/historica.ts',
    ]);
  });

  it('no `inbound-store`, só o insert do CLIENTE — o do celular não grava', () => {
    // Os dois moram no mesmo arquivo: o recorte é pelo CORPO de cada função
    // (revisão do PR #443).
    const loja = semComentarios(cru('lib/whatsapp/inbound-store.ts'));
    const corpo = (nome: string) => {
      const inicio = loja.indexOf(`export async function ${nome}(`);
      const fim = loja.indexOf('\nexport ', inicio + 1);
      return loja.slice(inicio, fim === -1 ? undefined : fim);
    };
    expect(corpo('persistInboundMessage')).toMatch(/\bopcoes_de_resposta\s*:/);
    expect(corpo('persistDeviceMessage')).not.toContain('opcoes_de_resposta');
  });

  it('a recuperada grava só na mensagem do cliente, nunca na da equipe', () => {
    expect(semComentarios(cru('lib/whatsapp/sem-telefone/historica.ts'))).toContain(
      '!daEquipe && m.opcoesDeResposta',
    );
  });
});

describe('o clique numa opção da bolha', () => {
  const fio = () => semComentarios(cru('components/inbox/message-thread.tsx'));

  it('o fio cita a mensagem e pede ao compositor, que escreve pelo `setText`', () => {
    const f = fio();
    const inicio = f.indexOf('const responderComOpcao = useCallback(');
    const responder = f.slice(inicio, f.indexOf('[handleStartReply],', inicio));
    expect(responder).toContain('handleStartReply(msg);');
    expect(responder).toContain('compositorRef.current?.prepararResposta(');
    expect(f).toContain('ref={compositorRef}');
    const compositor = semComentarios(cru('components/inbox/message-composer.tsx'));
    const inicioDoPreparar = compositor.indexOf('const prepararResposta = useCallback(');
    const preparar = compositor.slice(
      inicioDoPreparar,
      compositor.indexOf('useImperativeHandle(', inicioDoPreparar),
    );
    // O texto entra pelo `setText` DESTE render, e o clique anterior só vale
    // na MESMA conversa (o compositor não remonta na troca).
    expect(preparar).toContain('const preparada = textoComAOpcao(');
    expect(preparar).toContain("anterior?.de === conversationId ? anterior : null");
    expect(preparar).toContain('setText(preparada.resultado);');
    // Um `useImperativeHandle` só: o mesmo `ref` serve também ao "Tentar de
    // novo" (`reenviarTexto`), e uma segunda chamada apagaria a primeira.
    expect(compositor.match(/useImperativeHandle\(ref,/g)).toHaveLength(1);
    expect(compositor).toMatch(
      /useImperativeHandle\(ref, \(\) => \(\{[^}]*\bprepararResposta\b[^}]*\}\), \[[^\]]*\bprepararResposta\b/,
    );
  });

  it('quem não envia não ganha o clique', () => {
    expect(fio()).toMatch(/onResponderComOpcao=\{\s*podeEnviar && msg\.opcoes_de_resposta != null/);
  });
});
