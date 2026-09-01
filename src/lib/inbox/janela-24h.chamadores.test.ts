import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Como o fio CONSOME a regra da janela de 24h — pinos estruturais (F5).
//
// A regra pura mora em `janela-24h.ts` e tem teste próprio. O que quebra em
// produção é o CONSUMO: o upstream reescreve `message-thread.tsx` a cada
// merge (o CLAUDE.md o marca como NOSSO, inteiro), e cada um destes pinos é
// uma regressão que já aconteceu ou quase:
//
//  - #06: `janelaDe24h` sem o `!canaisFalharam` — um 5xx transitório de
//    `/api/cb/channels` travava o compositor da conta Evolution.
//  - M10: o literal "No customer messages" em inglês na badge, com a chave
//    traduzida parada no dicionário.
//  - M11: `sessionInfo` lendo relógio sem tique — a badge congelava e a
//    janela fechava com o compositor liberado.
//  - M13 (na verdade #84): o portão do disparo tem de cobrir os TRÊS
//    caminhos (texto, mídia, interativa). "Reusar" um deles por fora do
//    portão passa em revisão e manda mensagem Meta fora da janela.
//  - M12: transporte desconhecido não oferece template/interativa — o
//    TemplatePicker nasceria com channelId nulo, catálogo sem recorte por
//    WABA (load-bearing no CLAUDE.md).
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

const fio = () => fonte('components/inbox/message-thread.tsx');
const compositor = () => fonte('components/inbox/message-composer.tsx');

function ocorrencias(texto: string, agulha: string): number {
  return texto.split(agulha).length - 1;
}

describe('o fio e a janela de 24h (F5)', () => {
  it('#06: falha na busca de canais conta como "não sei", nunca como "é Meta"', () => {
    expect(fio()).toContain(
      'const janelaDe24h = !canaisCarregando && !canaisFalharam && !evolutionActive;',
    );
  });

  it('M10: a badge de "sem mensagem do cliente" sai do dicionário', () => {
    expect(fio()).toContain('tTimer("noCustomerMessages")');
    expect(fio()).not.toContain('No customer messages');
  });

  it('M11: o relógio da badge é INSUMO do memo — sessionInfo envelhece', () => {
    const f = fio();
    // O tique existe…
    expect(f).toContain('setAgoraDaBadge(new Date())');
    // …e o memo depende dele. Sem o dep, o tique re-renderiza e o memo
    // devolve o valor velho — a badge congela igual.
    expect(f).toContain('}, [messages, tTimer, agoraDaBadge]);');
  });

  it('M13/#84: o portão do disparo cobre os TRÊS caminhos', () => {
    expect(ocorrencias(fio(), 'if (janelaFechadaAgora())')).toBe(3);
  });

  it('M12: transporte desconhecido chega ao compositor e esconde os atalhos Meta', () => {
    expect(fio()).toContain(
      'transporteConhecido={!canaisCarregando && !canaisFalharam}',
    );
    // Os DOIS atalhos (item de interativa no menu + e botão de templates).
    expect(
      ocorrencias(compositor(), 'transporteConhecido && channelKind !== "evolution"'),
    ).toBe(2);
  });
});
