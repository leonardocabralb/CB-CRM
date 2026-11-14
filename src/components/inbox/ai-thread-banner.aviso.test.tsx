import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

// ============================================================
// O aviso do "Desativar IA" (pedido do operador, 14/11/2026): a equipe usou
// o Desativar em 3 conversas e o Pausar em nenhuma, sem saber que desativar
// PARA os follow-ups automáticos. O botão agora só abre o aviso, que
// recomenda o Pausar.
//
// A suíte roda sem DOM (sem jsdom), e o diálogo do base-ui abre num portal
// que a renderização no servidor não desenha. Os dublês abaixo desenham o
// conteúdo no lugar quando aberto e anotam as props de cada botão — é pelo
// `onClick` anotado que o teste "clica".
// ============================================================

type PropsAnotadas = Record<string, unknown> & { children?: ReactNode };

const { botoes, dialogos, conteudos } = vi.hoisted(() => ({
  botoes: [] as PropsAnotadas[],
  dialogos: [] as PropsAnotadas[],
  conteudos: [] as PropsAnotadas[],
}));

vi.mock('@/components/ui/dialog', async () => {
  const { createElement } = await import('react');
  const passa = (tag: string) => (p: PropsAnotadas) => createElement(tag, null, p.children);
  return {
    Dialog: (p: PropsAnotadas) => {
      dialogos.push(p);
      return p.open === true ? createElement('div', { 'data-dialogo': '' }, p.children) : null;
    },
    DialogContent: (p: PropsAnotadas) => {
      conteudos.push(p);
      return createElement('div', null, p.children);
    },
    DialogHeader: passa('div'),
    DialogTitle: passa('h2'),
    DialogDescription: passa('p'),
    DialogFooter: passa('footer'),
  };
});

vi.mock('@/components/ui/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: (p: PropsAnotadas) => {
      botoes.push(p);
      return createElement('button', null, p.children);
    },
  };
});

import {
  AvisoAoDesativar,
  clicarNoDesativar,
  corpoDaAcao,
  FaixaDaIa,
  type CliqueNoDesativar,
  type Faixa,
} from './ai-thread-banner';

const banner = ptBR.Inbox.aiBanner;
const aviso = banner.avisoDesativar;

beforeEach(() => {
  botoes.length = 0;
  dialogos.length = 0;
  conteudos.length = 0;
});

function desenhar(no: ReactElement, messages: unknown = ptBR) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={messages as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      {no}
    </NextIntlClientProvider>,
  );
}

function desenharFaixa(faixa: Faixa) {
  return desenhar(<FaixaDaIa faixa={faixa} busy={false} aoPausar={() => {}} aoDesativar={() => {}} aoRetomar={() => {}} />);
}

/**
 * A faixa por inteiro, sem DOM: os cliques passam por `clicarNoDesativar`
 * (o que o botão da faixa faz) com os efeitos que o `AiThreadBanner` liga a
 * ela — `alternar("pausar" | "desativar")`, que manda `corpoDaAcao` à rota
 * (pino no fim). `rota` guarda o corpo de cada chamada; `avisoAberto`, se o
 * aviso ficou aberto depois do último clique.
 */
function faixaComAviso(pausada: boolean) {
  const estado = { avisoAberto: false, rota: [] as ReturnType<typeof corpoDaAcao>[] };
  const efeitos = {
    mostrarAviso: (aberto: boolean) => {
      estado.avisoAberto = aberto;
    },
    aoPausar: () => {
      estado.rota.push(corpoDaAcao('pausar'));
    },
    aoDesativar: () => {
      estado.rota.push(corpoDaAcao('desativar'));
    },
  };
  const clicar = (clique: CliqueNoDesativar) => clicarNoDesativar(clique, pausada, efeitos);
  const desenharAviso = (messages: unknown = ptBR) =>
    desenhar(<AvisoAoDesativar aberto minutos={15} pausada={pausada} aoClicar={clicar} />, messages);
  return { estado, clicar, desenharAviso };
}

/** "Clica" no botão do aviso pelo rótulo: o `onClick` que o dublê anotou. */
function clicarNoBotao(rotulo: string) {
  const botao = botoes.find((b) => b.children === rotulo);
  expect(botao, `botão "${rotulo}"`).toBeDefined();
  (botao?.onClick as () => void)();
}

const rotulos = () => botoes.map((b) => b.children);

/** A frase como o React a escreve no HTML (as aspas de "Retomar IA" viram `&quot;`), com o N. */
const noHtml = (frase: string) => frase.replace('{minutos}', '15').replace(/"/g, '&quot;');

describe('o aviso do "Desativar IA" — na faixa "atendendo" (N = 15)', () => {
  it('a faixa mostra o "Desativar IA", e o aviso fica FECHADO até o clique', () => {
    const html = desenharFaixa({ tipo: 'atendendo', agente: 'Triagem', minutos: 15 });
    expect(html).toContain(banner.desativar);
    expect(html).not.toContain(aviso.titulo);
    expect(dialogos.map((d) => d.open)).toEqual([false]);
  });

  it('clicar em "Desativar IA" abre o aviso e NÃO chama a rota', () => {
    const f = faixaComAviso(false);
    f.clicar('desativarIa');
    expect(f.estado).toEqual({ avisoAberto: true, rota: [] });
  });

  it('o aviso diz que desativar é permanente e para os follow-ups, e recomenda o Pausar com o N da conta', () => {
    const html = faixaComAviso(false).desenharAviso();
    expect(html).toContain(aviso.titulo);
    expect(html).toContain(noHtml(aviso.texto));
    expect(html).toContain(noHtml(aviso.recomendaPausar));
    expect(html).toContain('15 min');
    expect(html).not.toContain(noHtml(aviso.naPausa));
    // O principal por último (à direita no computador, em cima no celular).
    expect(rotulos()).toEqual([aviso.cancelar, aviso.desativar, aviso.pausar]);
  });

  it('"Desativar mesmo assim" fecha o aviso e chama a rota com { paused: true, permanente: true }', () => {
    const f = faixaComAviso(false);
    f.clicar('desativarIa');
    f.desenharAviso();
    clicarNoBotao(aviso.desativar);
    expect(f.estado).toEqual({ avisoAberto: false, rota: [{ paused: true, permanente: true }] });
  });

  it('"Pausar em vez disso" fecha o aviso e chama a rota com { paused: true } — o mesmo do Pausar da faixa', () => {
    const f = faixaComAviso(false);
    f.clicar('desativarIa');
    f.desenharAviso();
    clicarNoBotao(aviso.pausar);
    expect(f.estado).toEqual({ avisoAberto: false, rota: [{ paused: true }] });
  });

  it('"Cancelar" fecha o aviso sem chamar nada', () => {
    const f = faixaComAviso(false);
    f.clicar('desativarIa');
    f.desenharAviso();
    clicarNoBotao(aviso.cancelar);
    expect(f.estado).toEqual({ avisoAberto: false, rota: [] });
  });

  it('fechar pelo X, pelo Esc ou clicando fora = "Cancelar": nada vai à rota', () => {
    const f = faixaComAviso(false);
    f.clicar('desativarIa');
    f.desenharAviso();
    (dialogos.at(-1)?.onOpenChange as (abrir: boolean) => void)(false);
    expect(f.estado).toEqual({ avisoAberto: false, rota: [] });
  });

  it('o foco abre no principal ("Pausar em vez disso"): um Enter a mais não desativa', () => {
    faixaComAviso(false).desenharAviso();
    const principal = botoes.find((b) => b.children === aviso.pausar);
    expect(principal?.ref).toBeDefined();
    expect(conteudos.at(-1)?.initialFocus).toBe(principal?.ref);
  });
});

describe('o aviso do "Desativar IA" — na pausa TEMPORÁRIA', () => {
  it('a faixa pausada que volta sozinha também abre o aviso, fechado até o clique', () => {
    const html = desenharFaixa({ tipo: 'pausada', motivo: 'gente', naoAtende: null, volta: { minutos: 15, em: null } });
    expect(html).toContain(banner.desativar);
    expect(dialogos.map((d) => d.open)).toEqual([false]);
  });

  it('⚠️ o principal é "Manter a pausa", sem "Cancelar" — e NÃO chama a rota: o Pausar trocaria a `gente` por `botao`, que para os follow-ups', () => {
    const f = faixaComAviso(true);
    f.clicar('desativarIa');
    const html = f.desenharAviso();
    expect(html).toContain(noHtml(aviso.texto));
    expect(html).toContain(noHtml(aviso.naPausa));
    expect(html).not.toContain(noHtml(aviso.recomendaPausar));
    expect(rotulos()).toEqual([aviso.desativar, aviso.manterPausa]);
    clicarNoBotao(aviso.manterPausa);
    expect(f.estado).toEqual({ avisoAberto: false, rota: [] });
    // O foco abre nele, nunca no "Desativar mesmo assim" (o primeiro botão).
    expect(conteudos.at(-1)?.initialFocus).toBe(botoes.find((b) => b.children === aviso.manterPausa)?.ref);
  });

  it('"Desativar mesmo assim" continua mandando o permanente', () => {
    const f = faixaComAviso(true);
    f.clicar('desativarIa');
    f.desenharAviso();
    clicarNoBotao(aviso.desativar);
    expect(f.estado).toEqual({ avisoAberto: false, rota: [{ paused: true, permanente: true }] });
  });
});

describe('o aviso do "Desativar IA" — o resto da faixa não muda', () => {
  it('N = 0 ou desconhecido (o Pausar já é permanente): sem Desativar, sem aviso', () => {
    for (const minutos of [0, null]) {
      const html = desenharFaixa({ tipo: 'atendendo', agente: 'Triagem', minutos });
      expect(html).toContain(banner.pausar);
      expect(html).not.toContain(banner.desativar);
    }
    const pausadaDeAntes = desenharFaixa({ tipo: 'pausada', motivo: 'gente', naoAtende: null, volta: null });
    expect(pausadaDeAntes).not.toContain(banner.desativar);
    expect(dialogos).toEqual([]);
  });

  it('desativada: só o Retomar, sem aviso', () => {
    desenharFaixa({ tipo: 'pausada', motivo: 'desativada', naoAtende: null, volta: null });
    expect(dialogos).toEqual([]);
  });

  it('aviso fechado não desenha nada', () => {
    expect(desenhar(<AvisoAoDesativar aberto={false} minutos={15} pausada={false} aoClicar={() => {}} />)).toBe('');
  });
});

describe('o aviso do "Desativar IA" — os dois dicionários', () => {
  it('em inglês também, sem chave crua', () => {
    for (const pausada of [false, true]) {
      const html = faixaComAviso(pausada).desenharAviso(en);
      expect(html).toContain(en.Inbox.aiBanner.avisoDesativar.titulo);
      expect(html).toContain('15 min');
      expect(html).not.toContain('avisoDesativar');
    }
  });

  it('as frases do aviso existem nos DOIS dicionários, com as mesmas chaves', () => {
    expect(Object.keys(en.Inbox.aiBanner.avisoDesativar).sort()).toEqual(Object.keys(aviso).sort());
    for (const dic of [en, ptBR]) {
      for (const [chave, texto] of Object.entries(dic.Inbox.aiBanner.avisoDesativar)) {
        expect(typeof texto, `Inbox.aiBanner.avisoDesativar.${chave}`).toBe('string');
      }
    }
  });
});

describe('pino estrutural: o Desativar só sai pelo aviso', () => {
  const fonte = readFileSync(join(__dirname, 'ai-thread-banner.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('nenhum botão chama o `aoDesativar` direto: o da faixa abre o aviso', () => {
    expect(fonte).not.toMatch(/onClick=\{aoDesativar\}/);
    expect(fonte).toContain('onClick={() => clicar("desativarIa")}');
  });

  it('cada estado da faixa tem o seu Desativar (`key`): o aviso aberto FECHA quando a faixa muda, em vez de trocar os botões de lugar debaixo do clique', () => {
    expect(fonte).toMatch(/<DesativarComAviso\s+key="atendendo"/);
    expect(fonte).toMatch(/<DesativarComAviso\s+key="pausada"/);
  });

  it('o espelho deste teste é a ligação da faixa: Pausar e Desativar vão a `alternar`, que manda `corpoDaAcao`', () => {
    expect(fonte).toContain('aoPausar={() => void alternar("pausar")}');
    expect(fonte).toContain('aoDesativar={() => void alternar("desativar")}');
    expect(fonte).toContain('JSON.stringify(corpoDaAcao(acao))');
  });
});
