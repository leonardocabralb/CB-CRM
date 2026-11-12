import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import { MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE } from '@/lib/ia-agentes/quem-responde';

import {
  AiThreadBanner,
  corpoDaAcao,
  lerProximo,
  quantoFalta,
  esperaParaReler,
  RELEITURA_SEM_PASSO_MS,
  TETO_DA_RELEITURA_MS,
  horaDaVolta,
  erroDaResposta,
  FaixaDaIa,
  faixaDaIa,
  lerEstadoDaIa,
  MOTIVOS_DA_PAUSA,
  type EstadoDaIa,
  type ErroDaFaixa,
  type Faixa,
} from './ai-thread-banner';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ============================================================
// A faixa do agente de IA no fio (D24–D26 do docs/PLANO-agentes-de-ia.md):
//   - atendendo → "IA · <nome> responde nesta conversa" + Pausar;
//   - pausada   → "IA pausada — <motivo>" + Retomar IA;
//   - nada      → não aparece.
// Quem responde é o agente da ETAPA do card, que só a rota
// `GET /api/cb/ia/conversa/[id]` sabe; a conversa guarda só a pausa e o
// último agente que respondeu.
// ============================================================

const banner = ptBR.Inbox.aiBanner;
const TRIAGEM = { id: 'ag-1', nome: 'Triagem' };

function estado(p: Partial<EstadoDaIa> = {}): EstadoDaIa {
  return {
    agente: TRIAGEM,
    pausada: false,
    pausadaPor: null,
    pausaTemporaria: false,
    voltaAposMin: 15,
    voltaEm: null,
    proximo: null,
    naoAtende: null,
    ...p,
  };
}

const CARD_ANTIGO = { agente: TRIAGEM, motivo: 'card_antigo' } as const;

function desenhar(faixa: Faixa, messages: AbstractIntlMessages = ptBR as unknown as AbstractIntlMessages) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <FaixaDaIa faixa={faixa} busy={false} aoPausar={() => {}} aoDesativar={() => {}} aoRetomar={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe('faixaDaIa — o que a faixa desenha', () => {
  it('agente da etapa atende e não há pausa: "atendendo", com o nome', () => {
    expect(faixaDaIa(estado(), null)).toEqual({ tipo: 'atendendo', agente: 'Triagem', minutos: 15 });
  });

  it('nenhum agente atende e não há pausa: não desenha', () => {
    expect(faixaDaIa(estado({ agente: null }), 'ag-1')).toBeNull();
    expect(faixaDaIa(estado({ agente: null }), null)).toBeNull();
  });

  it('pausada com agente: "pausada", com o motivo', () => {
    for (const m of MOTIVOS_DA_PAUSA) {
      expect(faixaDaIa(estado({ pausada: true, pausadaPor: m }), null)).toEqual({
        tipo: 'pausada',
        motivo: m,
        naoAtende: null,
        volta: null,
      });
    }
  });

  it('⚠️ D26: pausada continua aparecendo quando o card saiu da etapa do agente (o último que respondeu basta)', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: 'gente' }), 'ag-1')).toEqual({
      tipo: 'pausada',
      motivo: 'gente',
      naoAtende: null,
      volta: null,
    });
  });

  it('pausa antiga numa conversa que nenhum agente atende nem atendeu: não desenha (Retomar não retomaria nada)', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: null }), null)).toBeNull();
  });

  it('motivo desconhecido ou nulo: pausada, sem motivo', () => {
    expect(faixaDaIa(estado({ pausada: true, pausadaPor: 'outro' }), null)).toEqual({
      tipo: 'pausada',
      motivo: null,
      naoAtende: null,
      volta: null,
    });
    expect(faixaDaIa(estado({ pausada: true }), null)).toEqual({ tipo: 'pausada', motivo: null, naoAtende: null, volta: null });
  });

  it('sem resposta da rota (carregando, falhou, outra conversa): não desenha', () => {
    expect(faixaDaIa(null, 'ag-1')).toBeNull();
  });
});

describe('faixaDaIa — "não atende": a etapa TEM agente, mas ele não atende (validação de 25/10/2026)', () => {
  it('⚠️ card antigo depois de religar o agente: a linha aparece onde antes não se desenhava NADA', () => {
    expect(faixaDaIa(estado({ agente: null, naoAtende: CARD_ANTIGO }), null)).toEqual({
      tipo: 'naoAtende',
      agente: 'Triagem',
      motivo: 'card_antigo',
    });
    // Com o último agente que respondeu na conversa, também (sem pausa não há Retomar a oferecer).
    expect(faixaDaIa(estado({ agente: null, naoAtende: CARD_ANTIGO }), 'ag-1')).toMatchObject({ tipo: 'naoAtende' });
  });

  it('cada motivo da lista do motor chega à faixa', () => {
    for (const motivo of MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE) {
      expect(faixaDaIa(estado({ agente: null, naoAtende: { agente: TRIAGEM, motivo } }), null)).toEqual({
        tipo: 'naoAtende',
        agente: 'Triagem',
        motivo,
      });
    }
  });

  it('os estados de hoje ficam: pausada com agente segue pausada + Retomar, e ganha a linha embaixo', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: 'gente', naoAtende: CARD_ANTIGO }), 'ag-1')).toEqual({
      tipo: 'pausada',
      motivo: 'gente',
      naoAtende: { agente: 'Triagem', motivo: 'card_antigo' },
      volta: null,
    });
  });

  it('pausada sem agente nenhum a retomar, mas com o da etapa que não atende: só a linha (sem Retomar)', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: 'gente', naoAtende: CARD_ANTIGO }), null)).toEqual({
      tipo: 'naoAtende',
      agente: 'Triagem',
      motivo: 'card_antigo',
    });
  });

  it('sem `naoAtende` e sem agente: continua não desenhando', () => {
    expect(faixaDaIa(estado({ agente: null }), null)).toBeNull();
  });
});

describe('lerEstadoDaIa — o corpo da rota', () => {
  it('lê o agente, a pausa e o motivo', () => {
    expect(lerEstadoDaIa({ agente: TRIAGEM, pausada: true, pausadaPor: 'botao', motivo: null })).toEqual({
      agente: TRIAGEM,
      pausada: true,
      pausadaPor: 'botao',
      // Servidor sem os campos da 1138: a faixa de antes (nada de "volta sozinha").
      pausaTemporaria: false,
      voltaAposMin: null,
      voltaEm: null,
      // Servidor sem o campo: não se sabe — nunca "sem follow-up agendado".
      proximo: null,
      naoAtende: null,
    });
  });
  it('forma estranha: agente nulo, pausa só com o booleano true', () => {
    expect(lerEstadoDaIa({ agente: { id: 1 }, pausada: 'true', pausaTemporaria: 'true', voltaAposMin: '15', voltaEm: 'ontem' })).toEqual({
      agente: null,
      pausada: false,
      pausadaPor: null,
      pausaTemporaria: false,
      voltaAposMin: null,
      voltaEm: null,
      // Servidor sem o campo: não se sabe — nunca "sem follow-up agendado".
      proximo: null,
      naoAtende: null,
    });
    expect(lerEstadoDaIa(null)).toBeNull();
  });
  it('lê `naoAtende`; motivo fora da lista ou agente sem nome = nulo (nunca chave crua na tela)', () => {
    expect(lerEstadoDaIa({ agente: null, pausada: false, naoAtende: CARD_ANTIGO })?.naoAtende).toEqual(CARD_ANTIGO);
    expect(lerEstadoDaIa({ naoAtende: { agente: TRIAGEM, motivo: 'motivo_novo' } })?.naoAtende).toBeNull();
    expect(lerEstadoDaIa({ naoAtende: { agente: { id: 'ag-1' }, motivo: 'card_antigo' } })?.naoAtende).toBeNull();
    expect(lerEstadoDaIa({ naoAtende: 'card_antigo' })?.naoAtende).toBeNull();
  });
});

describe('FaixaDaIa — o texto, nos dois dicionários', () => {
  it('atendendo: "IA · Triagem responde nesta conversa" e Pausar', () => {
    const html = desenhar({ tipo: 'atendendo', agente: 'Triagem', minutos: 0 });
    expect(html).toContain('IA · Triagem responde nesta conversa');
    expect(html).toContain(banner.pausar);
    expect(html).not.toContain(banner.resume);
    // N = 0 na conta: o Pausar já é permanente — sem o Desativar ao lado.
    expect(html).not.toContain(banner.desativar);
  });

  it('atendendo com N > 0 (1138): Pausar (temporário, com a dica do N) e Desativar IA', () => {
    const html = desenhar({ tipo: 'atendendo', agente: 'Triagem', minutos: 15 });
    expect(html).toContain(banner.pausar);
    expect(html).toContain(banner.desativar);
    expect(html).toContain(banner.pausarDica.replace('{minutos}', '15'));
  });

  it.each(MOTIVOS_DA_PAUSA.filter((m) => m !== 'desativada'))('pausada por %s: "IA pausada — <motivo>" e Retomar IA', (motivo) => {
    const html = desenhar({ tipo: 'pausada', motivo, naoAtende: null, volta: null });
    expect(html).toContain(`IA pausada — ${banner.motivo[motivo]}`);
    expect(html).toContain(banner.resume);
    expect(html).not.toContain(banner.pausar);
    expect(html).not.toContain(banner.desativar);
  });

  it('desativada: "IA desativada nesta conversa" e só o Retomar', () => {
    const html = desenhar({ tipo: 'pausada', motivo: 'desativada', naoAtende: null, volta: null });
    expect(html).toContain(banner.desativadaNaConversa);
    expect(html).toContain(banner.resume);
    expect(html).not.toContain(`>${banner.desativar}<`);
  });

  it('pausa TEMPORÁRIA com mensagem esperando: "volta às <hora>", Retomar (agora) e Desativar', () => {
    const html = desenhar({
      tipo: 'pausada',
      motivo: 'gente',
      naoAtende: null,
      volta: { minutos: 15, em: '2026-11-11T17:32:00Z' },
    });
    expect(html).toContain(`IA pausada — ${banner.motivo.gente}`);
    // A hora sai no idioma de quem olha (`toLocaleTimeString(undefined, …)`): 14:32 ou 02:32 PM.
    expect(html).toMatch(/A IA volta a partir de \d\d:\d\d( [AP]M)? se ninguém da equipe responder\./);
    expect(html).toContain(banner.resume);
    expect(html).toContain(banner.retomarAgoraDica);
    expect(html).toContain(banner.desativar);
  });

  it('pausa TEMPORÁRIA sem mensagem esperando: "volta sozinha se o cliente esperar N min"', () => {
    const html = desenhar({ tipo: 'pausada', motivo: 'botao', naoAtende: null, volta: { minutos: 15, em: null } });
    expect(html).toContain(banner.voltaSeEsperar.replace('{minutos}', '15'));
    expect(html).toContain(banner.desativar);
  });

  it('pausada sem motivo: só "IA pausada"', () => {
    const html = desenhar({ tipo: 'pausada', motivo: null, naoAtende: null, volta: null });
    expect(html).toContain(`>${banner.pausada}<`);
  });

  it('⚠️ não atende, card antigo: "IA · Triagem não atende esta conversa: <motivo>", a dica, e nenhum botão', () => {
    const html = desenhar({ tipo: 'naoAtende', agente: 'Triagem', motivo: 'card_antigo' });
    expect(html).toContain(
      `IA · Triagem não atende esta conversa: ${banner.naoAtendeMotivo.card_antigo}`,
    );
    expect(html).toContain(banner.naoAtendeDica);
    expect(html).not.toContain('<button');
  });

  it('não atende por agente desligado ou fora da conexão: o motivo, sem a dica do card antigo', () => {
    for (const motivo of ['agente_desligado', 'fora_da_conexao'] as const) {
      const html = desenhar({ tipo: 'naoAtende', agente: 'Triagem', motivo });
      expect(html).toContain(`IA · Triagem não atende esta conversa: ${banner.naoAtendeMotivo[motivo]}`);
      expect(html).not.toContain(banner.naoAtendeDica);
    }
  });

  it('pausada com a linha "não atende" embaixo: Retomar continua, e a linha diz que ele ainda não atenderia', () => {
    const html = desenhar({ tipo: 'pausada', motivo: 'gente', naoAtende: { agente: 'Triagem', motivo: 'card_antigo' }, volta: null });
    expect(html).toContain(`IA pausada — ${banner.motivo.gente}`);
    expect(html).toContain(banner.resume);
    expect(html).toContain(banner.naoAtendeMotivo.card_antigo);
  });

  it('⚠️ o motivo do "não atende" é chave MONTADA: cada um da lista do motor existe nos DOIS dicionários', () => {
    for (const dic of [en, ptBR]) {
      const b = dic.Inbox.aiBanner as Record<string, unknown> & { naoAtendeMotivo?: Record<string, unknown> };
      expect(typeof b.naoAtende, 'Inbox.aiBanner.naoAtende').toBe('string');
      expect(typeof b.naoAtendeDica, 'Inbox.aiBanner.naoAtendeDica').toBe('string');
      for (const m of MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE) {
        expect(typeof b.naoAtendeMotivo?.[m], `Inbox.aiBanner.naoAtendeMotivo.${m}`).toBe('string');
      }
    }
  });

  it('não atende em inglês também, sem chave crua', () => {
    for (const motivo of MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE) {
      const html = desenhar({ tipo: 'naoAtende', agente: 'Triagem', motivo }, en as unknown as AbstractIntlMessages);
      expect(html).not.toContain('Inbox.aiBanner');
      expect(html).toContain('Triagem');
    }
  });

  it('nada: não desenha', () => {
    expect(desenhar(null)).toBe('');
  });

  it('⚠️ o motivo é chave MONTADA: cada um existe nos DOIS dicionários', () => {
    for (const dic of [en, ptBR]) {
      for (const m of MOTIVOS_DA_PAUSA) {
        expect(typeof dic.Inbox.aiBanner.motivo[m], `Inbox.aiBanner.motivo.${m}`).toBe('string');
      }
    }
  });

  it('desenha em inglês também, sem chave crua', () => {
    const html = desenhar(
      { tipo: 'pausada', motivo: 'gente', naoAtende: null, volta: { minutos: 15, em: '2026-11-11T17:32:00Z' } },
      en as unknown as AbstractIntlMessages,
    );
    expect(html).toContain(en.Inbox.aiBanner.motivo.gente);
    expect(html).not.toContain('Inbox.aiBanner');
  });
});

describe('AiThreadBanner — antes da resposta da rota não desenha nada', () => {
  it('primeiro render (a rota ainda não respondeu): vazio — nunca o estado de outra conversa', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR as unknown as AbstractIntlMessages} timeZone="America/Sao_Paulo">
        <AiThreadBanner conversationId="conv-1" iaAgenteId="ag-1" disabled pausadaPor="gente" />
      </NextIntlClientProvider>,
    );
    expect(html).toBe('');
  });
});

describe('erroDaResposta — a recusa da rota vira frase do dicionário', () => {
  it.each<[number, unknown, ErroDaFaixa]>([
    [400, 'grupo', 'grupo'],
    [400, 'instagram', 'instagram'],
    [409, 'nada_gravado', 'nadaGravado'],
    [404, undefined, 'naoEncontrada'],
    [403, undefined, 'semPermissao'],
    [429, undefined, 'muitasTentativas'],
    [500, undefined, 'generico'],
    [401, undefined, 'generico'],
    [400, undefined, 'generico'],
  ])('%i + %s → %s', (status, code, esperado) => {
    expect(erroDaResposta(status, code)).toBe(esperado);
  });

  it('toda frase de erro existe nos DOIS dicionários', () => {
    const chaves = [
      'erroGrupo',
      'erroInstagram',
      'erroNadaGravado',
      'erroNaoEncontrada',
      'erroSemPermissao',
      'erroMuitasTentativas',
      'updateError',
      'networkError',
      'pausou',
      'resumed',
      'retomarDica',
      'pausarDica',
      'desativar',
      'desativarDica',
      'desativou',
      'desativadaNaConversa',
      'voltaAs',
      'voltaSeEsperar',
      'retomarAgoraDica',
    ] as const;
    for (const dic of [en, ptBR]) {
      for (const c of chaves) {
        expect(typeof dic.Inbox.aiBanner[c], `Inbox.aiBanner.${c}`).toBe('string');
      }
    }
  });
});

describe('horaDaVolta — a hora diz o dia quando não é hoje (1138)', () => {
  it('no mesmo dia em que a rota respondeu: só a hora; noutro dia: com o dia da semana', () => {
    const volta = '2026-11-11T17:32:00Z';
    const mesmoDia = horaDaVolta(volta, Date.parse('2026-11-11T17:20:00Z'));
    const outroDia = horaDaVolta(volta, Date.parse('2026-11-09T17:20:00Z'));
    expect(mesmoDia).toMatch(/^\d\d:\d\d( [AP]M)?$/);
    expect(outroDia.length).toBeGreaterThan(mesmoDia.length);
    expect(horaDaVolta(volta)).toBe(mesmoDia);
  });
});

describe('corpoDaAcao — o que cada botão manda à rota (1138)', () => {
  it('Pausar = temporário; Desativar = permanente; Retomar limpa — e nenhum atribui ninguém', () => {
    expect(corpoDaAcao('pausar')).toEqual({ paused: true });
    expect(corpoDaAcao('desativar')).toEqual({ paused: true, permanente: true });
    expect(corpoDaAcao('retomar')).toEqual({ paused: false });
  });
});

describe('faixaDaIa — a pausa TEMPORÁRIA (1138)', () => {
  it('temporária com o N da conta: a volta, com a hora quando há mensagem esperando', () => {
    expect(
      faixaDaIa(estado({ pausada: true, pausadaPor: 'gente', pausaTemporaria: true, voltaEm: '2026-11-11T17:32:00Z' }), null),
    ).toEqual({ tipo: 'pausada', motivo: 'gente', naoAtende: null, volta: { minutos: 15, em: '2026-11-11T17:32:00Z' } });
  });

  it('N desconhecido (servidor antigo) ou 0: a faixa de antes, nunca "volta sozinha"', () => {
    expect(faixaDaIa(estado({ pausada: true, pausadaPor: 'gente', pausaTemporaria: true, voltaAposMin: null }), null)).toMatchObject({ volta: null });
    expect(faixaDaIa(estado({ pausada: true, pausadaPor: 'gente', pausaTemporaria: true, voltaAposMin: 0 }), null)).toMatchObject({ volta: null });
  });
});

describe('pino estrutural do fonte da faixa', () => {
  const fonte = readFileSync(join(__dirname, 'ai-thread-banner.tsx'), 'utf8')
    // Sem comentários: o cabeçalho descreve a versão antiga por extenso.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('pergunta à rota da conversa quem responde (o agente é o da ETAPA, D24)', () => {
    expect(fonte).toContain('/api/cb/ia/conversa/');
  });

  it('não pergunta à configuração legada se a IA está ligada', () => {
    expect(fonte).not.toContain('/api/ai/config');
    expect(fonte).not.toContain('auto_reply_enabled');
    expect(fonte).not.toContain('is_active');
  });

  it('Pausar não atribui a conversa a ninguém (o "Assumir" saiu)', () => {
    expect(fonte).toContain('JSON.stringify(corpoDaAcao(acao))');
    expect(fonte).not.toContain('assign_to_me');
  });

  it('o toast de erro nunca mostra o `error` cru da rota (inglês)', () => {
    expect(fonte).not.toMatch(/\.error\s*\?\?/);
    expect(fonte).not.toMatch(/toast\.error\(\s*j\b/);
  });

  it('o responsável humano não esconde a faixa', () => {
    expect(fonte).not.toMatch(/assignedAgentId/);
  });
});

// ============================================================
// O PRÓXIMO PASSO da IA (pedido do operador, 12/11/2026): embaixo de
// "IA · X responde nesta conversa", o follow-up agendado com a hora e
// quanto falta, a resposta na fila, "respondendo agora" ou "sem follow-up".
// ============================================================

const EM = '2026-11-12T18:00:00Z';
const AGORA = Date.parse(EM) - (2 * 60 + 13) * 60_000; // faltam 2 h 13 min
const FOLLOW_UP = { tipo: 'retomada', em: EM, tentativa: 2, tentativas: 5 } as const;

function desenharNoRelogio(faixa: Faixa, agora: number, messages: AbstractIntlMessages = ptBR as unknown as AbstractIntlMessages) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <FaixaDaIa
        faixa={faixa}
        lidoEm={agora}
        agora={agora}
        busy={false}
        aoPausar={() => {}}
        aoDesativar={() => {}}
        aoRetomar={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

describe('lerProximo — o próximo passo que a rota manda', () => {
  it('`null` da rota = nada na fila; ausente ou forma estranha = não se sabe (nulo)', () => {
    expect(lerProximo(null)).toBe('nada');
    expect(lerProximo(undefined)).toBeNull();
    expect(lerEstadoDaIa({ agente: TRIAGEM, proximo: null })?.proximo).toBe('nada');
    expect(lerEstadoDaIa({ agente: TRIAGEM })?.proximo).toBeNull();
    expect(lerProximo({ tipo: 'retomada', em: 'amanhã', tentativa: 1, tentativas: 3 })).toBeNull();
    expect(lerProximo({ tipo: 'retomada', em: EM, tentativa: 4, tentativas: 3 })).toBeNull();
    expect(lerProximo({ tipo: 'outro', em: EM })).toBeNull();
  });

  it('lê os quatro tipos', () => {
    expect(lerProximo({ tipo: 'agendando', em: EM })).toEqual({ tipo: 'agendando', em: EM });
    expect(lerProximo({ tipo: 'agora' })).toEqual({ tipo: 'agora' });
    expect(lerProximo({ tipo: 'resposta', em: EM, foraDoHorario: 'true' })).toEqual({ tipo: 'resposta', em: EM, foraDoHorario: false });
    expect(lerProximo(FOLLOW_UP)).toEqual(FOLLOW_UP);
  });
});

describe('quantoFalta', () => {
  it('em minutos inteiros, para cima; hora passada = nulo', () => {
    expect(quantoFalta(EM, AGORA)).toEqual({ dias: 0, horas: 2, minutos: 13 });
    expect(quantoFalta(EM, Date.parse(EM) - 30_000)).toEqual({ dias: 0, horas: 0, minutos: 1 });
    expect(quantoFalta(EM, Date.parse(EM) - (26 * 60) * 60_000)).toEqual({ dias: 1, horas: 2, minutos: 0 });
    expect(quantoFalta(EM, Date.parse(EM))).toBeNull();
    expect(quantoFalta(EM, Date.parse(EM) + 1)).toBeNull();
  });
});

describe('esperaParaReler — quando a faixa pergunta de novo', () => {
  it('20 s depois da hora marcada; 15 s escrevendo; 1 min com a hora vencida', () => {
    expect(esperaParaReler('comHora', EM, Date.parse(EM) - 60_000)).toBe(80_000);
    expect(esperaParaReler('agora', null, AGORA)).toBe(15_000);
    expect(esperaParaReler('comHora', EM, Date.parse(EM) + 1)).toBe(60_000);
  });

  it('⚠️ passo a mais de 12 h: relê em 12 h, nunca desliga (Codex, #515)', () => {
    expect(esperaParaReler('comHora', EM, Date.parse(EM) - 48 * 3_600_000)).toBe(TETO_DA_RELEITURA_MS);
    expect(TETO_DA_RELEITURA_MS).toBe(12 * 3_600_000);
  });

  it('⚠️ fila vazia com agente atendendo: relê a cada 2 min — o vão entre a resposta e o follow-up seguinte não pode ser a última leitura (Codex, #515)', () => {
    expect(esperaParaReler('nada', null, AGORA)).toBe(RELEITURA_SEM_PASSO_MS);
    expect(RELEITURA_SEM_PASSO_MS).toBe(120_000);
  });
});

describe('faixaDaIa — o próximo passo', () => {
  it('atendendo leva o próximo passo da rota; sem saber, nenhum', () => {
    expect(faixaDaIa(estado({ proximo: FOLLOW_UP }), null)).toMatchObject({ tipo: 'atendendo', proximo: FOLLOW_UP });
    expect(faixaDaIa(estado({ proximo: 'nada' }), null)).toMatchObject({ tipo: 'atendendo', proximo: 'nada' });
    expect(faixaDaIa(estado(), null)).not.toHaveProperty('proximo');
  });

  it('pausada: só o follow-up, e só na pausa que VOLTA', () => {
    const temporaria = estado({ pausada: true, pausadaPor: 'gente', pausaTemporaria: true, proximo: FOLLOW_UP });
    expect(faixaDaIa(temporaria, null)).toMatchObject({ tipo: 'pausada', followUp: FOLLOW_UP });
    expect(faixaDaIa({ ...temporaria, pausaTemporaria: false }, null)).not.toHaveProperty('followUp');
    expect(faixaDaIa({ ...temporaria, proximo: { tipo: 'agora' } }, null)).not.toHaveProperty('followUp');
  });
});

describe('FaixaDaIa — a linha do próximo passo, nos dois dicionários', () => {
  const atendendo = (proximo: Faixa extends infer F ? (F extends { tipo: 'atendendo'; proximo?: infer P } ? P : never) : never) =>
    ({ tipo: 'atendendo', agente: 'Triagem', minutos: 15, proximo }) as Faixa;

  it('follow-up agendado: a tentativa, de quantas, a hora e quanto falta', () => {
    const html = desenharNoRelogio(atendendo(FOLLOW_UP), AGORA);
    expect(html).toContain('IA · Triagem responde nesta conversa');
    expect(html).toContain(`Próximo follow-up (2 de 5) a partir de ${horaDaVolta(EM, AGORA)} · em 2 h 13 min`);
  });

  it('a contagem: minutos, horas sem "0 min", dias', () => {
    expect(desenharNoRelogio(atendendo(FOLLOW_UP), Date.parse(EM) - 45 * 60_000)).toContain('· em 45 min');
    expect(desenharNoRelogio(atendendo(FOLLOW_UP), Date.parse(EM) - 120 * 60_000)).toContain('· em 2 h<');
    expect(desenharNoRelogio(atendendo(FOLLOW_UP), Date.parse(EM) - (27 * 60) * 60_000)).toContain('· em 1 d 3 h');
  });

  it('⚠️ hora passada (o cron ainda não pegou): "a qualquer momento", nunca "em 0 min"', () => {
    const html = desenharNoRelogio(atendendo(FOLLOW_UP), Date.parse(EM) + 60_000);
    expect(html).toContain('Próximo follow-up (2 de 5) a qualquer momento');
    expect(html).not.toContain('em 0 min');
  });

  it('respondendo agora; resposta na fila em instantes; fora do horário com a hora', () => {
    expect(desenharNoRelogio(atendendo({ tipo: 'agora' }), AGORA)).toContain(banner.proximo.agora);
    expect(desenharNoRelogio(atendendo({ tipo: 'resposta', em: EM, foraDoHorario: false }), Date.parse(EM) - 8_000)).toContain(
      banner.proximo.respostaJa,
    );
    expect(desenharNoRelogio(atendendo({ tipo: 'resposta', em: EM, foraDoHorario: true }), AGORA)).toContain(
      `Fora do horário do agente: responde a partir de ${horaDaVolta(EM, AGORA)}.`,
    );
  });

  it('nada na fila: "Sem follow-up agendado"; sem saber: nenhuma linha', () => {
    expect(desenharNoRelogio(atendendo('nada'), AGORA)).toContain(banner.proximo.nada);
    const semSaber = desenharNoRelogio({ tipo: 'atendendo', agente: 'Triagem', minutos: 15 }, AGORA);
    expect(semSaber).not.toContain(banner.proximo.nada);
    expect(semSaber).not.toContain('follow-up');
    // Nenhuma segunda linha embaixo do nome.
    expect(semSaber).not.toContain('mt-0.5 pl-5');
  });

  it('⚠️ pré-armação do follow-up da equipe (`agendando`): nenhuma linha — nem "sem follow-up", que seria falso (Codex, #515)', () => {
    const atendendoArmando = desenharNoRelogio(atendendo({ tipo: 'agendando', em: EM }), AGORA);
    expect(atendendoArmando).not.toContain('mt-0.5 pl-5');
    expect(atendendoArmando).not.toContain(banner.proximo.nada);
    const pausada = faixaDaIa(
      estado({ pausada: true, pausadaPor: 'gente', pausaTemporaria: true, proximo: { tipo: 'agendando', em: EM } }),
      null,
    );
    expect(pausada).not.toHaveProperty('followUp');
  });

  it('pausa `gente` com follow-up: a linha dele, embaixo da volta', () => {
    const html = desenharNoRelogio(
      { tipo: 'pausada', motivo: 'gente', naoAtende: null, volta: { minutos: 15, em: null }, followUp: FOLLOW_UP },
      AGORA,
    );
    expect(html).toContain(`Se o cliente não responder, a IA manda um follow-up a partir de ${horaDaVolta(EM, AGORA)} · em 2 h 13 min`);
  });

  it('em inglês também, sem chave crua', () => {
    const html = desenharNoRelogio(atendendo(FOLLOW_UP), AGORA, en as unknown as AbstractIntlMessages);
    expect(html).toContain('Next follow-up (2 of 5) from');
    expect(html).toContain('in 2 h 13 min');
    expect(html).not.toContain('Inbox.aiBanner');
  });

  it('as frases do próximo passo existem nos DOIS dicionários, com as mesmas chaves', () => {
    expect(Object.keys(en.Inbox.aiBanner.proximo).sort()).toEqual(Object.keys(ptBR.Inbox.aiBanner.proximo).sort());
  });
});

