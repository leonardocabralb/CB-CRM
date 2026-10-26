import { describe, expect, it } from 'vitest';

import {
  MAX_OPCOES,
  lerOpcoesGravadas,
  linhaDoBotao,
  textoComAOpcao,
  textoSemAsOpcoes,
} from './opcoes-de-resposta';

// ============================================================
// Opções de resposta da mensagem de empresa (1111): a linha no texto, o que a
// bolha tira dele e o que a caixa do compositor recebe no clique.
// ============================================================

describe('linhaDoBotao', () => {
  it('o rótulo entre colchetes, com o destino depois quando há', () => {
    expect(linhaDoBotao('Sim')).toBe('[Sim]');
    expect(linhaDoBotao('Ligar', null)).toBe('[Ligar]');
    expect(linhaDoBotao('Ver boleto', 'https://exemplo.test/boleto')).toBe(
      '[Ver boleto] https://exemplo.test/boleto',
    );
  });
});

describe('lerOpcoesGravadas — o JSON vem de fora', () => {
  it('só os rótulos legíveis', () => {
    expect(lerOpcoesGravadas(['Sim', '', '  ', 3, null, 'Não'])).toEqual(['Sim', 'Não']);
  });

  it('o que não é lista vira nenhuma opção', () => {
    expect(lerOpcoesGravadas(null)).toEqual([]);
    expect(lerOpcoesGravadas(undefined)).toEqual([]);
    expect(lerOpcoesGravadas('Sim')).toEqual([]);
    expect(lerOpcoesGravadas({ 0: 'Sim' })).toEqual([]);
  });

  it('com teto', () => {
    const muitas = Array.from({ length: MAX_OPCOES + 10 }, (_, i) => `Opção ${i}`);
    expect(lerOpcoesGravadas(muitas)).toHaveLength(MAX_OPCOES);
  });
});

describe('textoSemAsOpcoes — a bolha troca as linhas por botões', () => {
  it('tira as linhas das opções do bloco dos botões', () => {
    expect(
      textoSemAsOpcoes('Olá! Responda esta mensagem.\n\n[Sim]\n[Retorna mais tarde]', [
        'Sim',
        'Retorna mais tarde',
      ]),
    ).toBe('Olá! Responda esta mensagem.');
  });

  it('a linha do botão com link fica, e o rodapé também', () => {
    expect(
      textoSemAsOpcoes(
        'Sua fatura vence amanhã.\n\nBanco Fictício\n\n[Já paguei]\n[Ver boleto] https://exemplo.test/boleto',
        ['Já paguei'],
      ),
    ).toBe('Sua fatura vence amanhã.\n\nBanco Fictício\n\n[Ver boleto] https://exemplo.test/boleto');
  });

  it('linha igual no MEIO do corpo não sai — só a do bloco dos botões', () => {
    expect(textoSemAsOpcoes('Responda:\n[Sim]\n\n[Sim]', ['Sim'])).toBe('Responda:\n[Sim]');
  });

  it('opção repetida tira uma linha por vez', () => {
    expect(textoSemAsOpcoes('Olá\n\n[Sim]\n[Sim]', ['Sim'])).toBe('Olá\n\n[Sim]');
  });

  it('só os botões: não sobra texto', () => {
    expect(textoSemAsOpcoes('[Sim]\n[Não]', ['Sim', 'Não'])).toBeNull();
  });

  it('sem opções, ou sem linha que case: o texto inteiro', () => {
    expect(textoSemAsOpcoes('Olá\n\n[Sim]', [])).toBe('Olá\n\n[Sim]');
    expect(textoSemAsOpcoes('Olá\n\n[Talvez]', ['Sim'])).toBe('Olá\n\n[Talvez]');
    expect(textoSemAsOpcoes(null, ['Sim'])).toBeNull();
  });
});

describe('textoComAOpcao — a caixa do compositor depois do clique', () => {
  const opcoes = ['Sim', 'Retorna mais tarde'];

  it('caixa vazia (ou só com espaço) vira a opção', () => {
    expect(textoComAOpcao('', 'Sim', opcoes)).toBe('Sim');
    expect(textoComAOpcao('  \n', 'Sim', opcoes)).toBe('Sim');
  });

  it('trocar de opção troca o texto, sem acumular', () => {
    expect(textoComAOpcao('Sim', 'Retorna mais tarde', opcoes)).toBe('Retorna mais tarde');
    expect(textoComAOpcao(' Sim ', 'Sim', opcoes)).toBe('Sim');
  });

  it('o que a pessoa escreveu não se perde: a opção vai numa linha nova', () => {
    expect(textoComAOpcao('Bom dia', 'Sim', opcoes)).toBe('Bom dia\nSim');
    expect(textoComAOpcao('Bom dia\n', 'Sim', opcoes)).toBe('Bom dia\nSim');
  });
});
