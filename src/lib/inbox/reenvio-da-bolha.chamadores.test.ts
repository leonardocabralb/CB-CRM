import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// O "Tentar de novo" da bolha que não saiu (19/10/2026) — pinos estruturais.
//
// O botão mora na bolha, o reenvio no COMPOSITOR e o envio no FIO. O que
// quebra é a amarração, e nenhum teste de regra pura a vê:
//
//  - um reenvio que NÃO passe pela trava, pela janela de desfazer e pela
//    fila de saída fura as decisões de 05/10 (conexão fora do ar trava o que
//    sai) e de 15/10 (tudo o que sai é retido e sai em ordem);
//  - o "Desfazer" de um reenvio que devolvesse o texto ao campo deixaria a
//    pessoa mandá-lo pelos dois lugares;
//  - o reenvio que limpasse a citação da tela apagaria a de quem está
//    escrevendo OUTRA coisa;
//  - o botão fora da bolha de TEXTO (o anexo já volta à prévia; modelo e
//    interativa têm o próprio diálogo) seria uma segunda porta para o mesmo
//    envio.
// ============================================================

const raiz = path.join(__dirname, '..', '..');

/** Fonte sem comentários — o código NOMEIA estas regras ao explicá-las. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/.*$/gm, '');
}

/** O trecho de `inicio` até a primeira ocorrência de `fim` depois dele. */
function trecho(src: string, inicio: string, fim: string): string {
  const i = src.indexOf(inicio);
  expect(i, `não achei "${inicio}"`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf(fim, i + inicio.length);
  expect(j, `não achei "${fim}" depois de "${inicio}"`).toBeGreaterThan(i);
  return src.slice(i, j);
}

const composer = fonte('components/inbox/message-composer.tsx');
const thread = fonte('components/inbox/message-thread.tsx');

describe('o reenvio passa pelo trilho do Enviar (compositor)', () => {
  const reenviar = trecho(composer, 'const reenviarTexto = useCallback(', 'const conversaAnteriorRef = useRef(');

  it('respeita a trava, retém na janela de desfazer e solta a retida anterior antes', () => {
    expect(reenviar).toMatch(/if \(envioTravado/);
    expect(reenviar).toMatch(/liberarPendente\(\)/);
    expect(reenviar).toMatch(/setPendente\(/);
    expect(reenviar).toMatch(/SEGUNDOS_DESFAZER/);
    expect(reenviar).toMatch(/substitui,/);
    // O despachante é preso à origem, como no Enviar.
    expect(reenviar).toMatch(/enviar: onSendRef\.current/);
  });

  it('não mexe no campo nem na hora de agendar de quem escreve outra coisa', () => {
    expect(reenviar).not.toMatch(/setText\(/);
    expect(reenviar).not.toMatch(/agendar\(/);
  });

  it('sai pela fila de saída levando o id da bolha', () => {
    expect(composer).toMatch(/filaDeSaida\.enfileirar\(p\.origem, \(\) => p\.enviar\(p\.texto, p\.replyToId, p\.substitui\)\)/);
  });

  it('o "Desfazer" de um reenvio devolve o botão, e NÃO o texto ao campo — salvo se a bolha sumiu', () => {
    const desfazer = trecho(composer, 'const desfazerEnvio = useCallback(', 'const agendar = useCallback(');
    expect(desfazer).toMatch(
      /const reenvioSemBolha =\s*p\.tipo === "texto" && !!p\.substitui && !onReenvioDesfeitoRef\.current\?\.\(p\.substitui\);/,
    );
    const saida = desfazer.indexOf('if (p.tipo === "texto" && p.substitui && !reenvioSemBolha) return;');
    expect(saida).toBeGreaterThanOrEqual(0);
    expect(saida).toBeLessThan(desfazer.indexOf('setText('));
    // Sem a bolha, o texto volta SOMADO ao que está no campo — o reenvio não
    // mexeu no campo, e ali pode haver outro rascunho.
    expect(desfazer).toContain(
      'setText((atual) => (reenvioSemBolha && atual.trim() ? `${atual}\\n${p.texto}` : p.texto));',
    );
  });

  it('soltar um reenvio não limpa a citação da tela', () => {
    const liberar = trecho(composer, 'const liberarPendente = useCallback(', 'const onReenvioDesfeitoRef');
    expect(liberar).toMatch(/p\.tipo === "texto" && !p\.substitui\) onClearReplyRef\.current\?\.\(\)/);
  });
});

describe('o fio: botão só no texto, e a mesma bolha no reenvio', () => {
  it('o botão some com o envio travado e enquanto o reenvio está retido', () => {
    expect(thread).toMatch(
      /onTentarDeNovo=\{\s*!envioTravado && reenviaveis\.get\(msg\.id\)\?\.retida === false/,
    );
  });

  it('o reenvio reaproveita a id da bolha e não limpa a citação da tela', () => {
    const envio = trecho(thread, 'const handleSend = useCallback(', 'const tentarDeNovo = useCallback(');
    expect(envio).toMatch(/const tempId = substitui \?\? `temp-/);
    expect(envio).toMatch(/if \(substitui\) \{[\s\S]*?\} else \{\s*setReplyTo\(null\);/);
  });

  it('só a recusa COMPROVADA guarda o texto — o incerto nunca vira botão (CLAUDE.md, 8e)', () => {
    const envio = trecho(thread, 'const handleSend = useCallback(', 'const tentarDeNovo = useCallback(');
    expect(envio).toMatch(/if \(naTela && falha\.podeTentarDeNovo\) \{\s*marcarReenviavel\(tempId/);
    expect((envio.match(/marcarReenviavel\(tempId/g) ?? []).length).toBe(1);
  });

  it('o "Desfazer" só devolve o botão se a bolha ainda está no fio', () => {
    const desfeito = trecho(thread, 'const aoDesfazerReenvio = useCallback(', 'const messagesById = useMemo(');
    expect(desfeito).toMatch(
      /if \(!r \|\| !messages\.some\(\(m\) => m\.id === id\)\) \{\s*marcarReenviavel\(id, null\);\s*return false;/,
    );
  });

  it('só o caminho de TEXTO guarda o que reenviar', () => {
    const fora = [
      trecho(thread, 'const handleSendMedia = useCallback(', 'const handleSendInteractive = useCallback('),
      trecho(thread, 'const handleSendInteractive = useCallback(', 'const handleStatusChange = useCallback('),
      trecho(thread, 'const handleSendTemplate = useCallback(', 'const messagesById = useMemo('),
    ];
    for (const caminho of fora) {
      expect(caminho).not.toMatch(/marcarReenviavel/);
      // Mas a bolha diz POR QUÊ em todos.
      expect(caminho).toMatch(/naBolha\(/);
      expect(caminho).not.toMatch(/onUpdateMessage\(tempId, \{ status: "failed" \}\)/);
    }
  });
});
