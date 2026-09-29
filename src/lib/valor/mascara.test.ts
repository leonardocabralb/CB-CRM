import { describe, expect, it } from 'vitest';

import { formatCurrency } from '@/lib/currency';

import {
  aplicarEdicao,
  colar,
  type Edicao,
  MAX_DIGITOS_INTEIROS,
  paraEdicao,
  parsearValor,
  teclaDecimal,
} from './mascara';

describe('parsearValor', () => {
  it('lê o número cru que o operador já digitava no campo antigo', () => {
    // ⚠️ O caso que não pode regredir. O campo era `type="number"` e
    // "40000" ali valia quarenta mil. Se a máscara passasse a ler isso como
    // R$ 400,00 (o comportamento de caixa eletrônico, que preenche centavos
    // da direita para a esquerda), todo negócio reeditado seria gravado cem
    // vezes menor — sem erro nenhum na tela.
    expect(parsearValor('40000')).toBe(40000);
    expect(parsearValor('0')).toBe(0);
    expect(parsearValor('7')).toBe(7);
  });

  it('lê o texto que ele mesmo devolve formatado, com NBSP e tudo', () => {
    // Ida e volta: o campo perde o foco, vira "R$ 40.000,00", e ao receber
    // foco de novo esse mesmo texto tem de voltar a ser 40000.
    expect(parsearValor('R$ 40.000,00')).toBe(40000);
    expect(parsearValor('R$ 1.250,55')).toBe(1250.55);
  });

  it('trata três dígitos depois do separador como milhar', () => {
    expect(parsearValor('40.000')).toBe(40000);
    expect(parsearValor('40,000')).toBe(40000);
    expect(parsearValor('999,999')).toBe(999999);
    expect(parsearValor('1.234.567')).toBe(1234567);
  });

  it('só chama de milhar quando o que vem antes é um grupo de verdade', () => {
    // ⚠️ A contagem de três dígitos sozinha não basta. `1250` não é grupo de
    // milhar — quem agrupa escreve `1.250.555` —, então aqui são casas
    // decimais mal digitadas. Lendo como milhar, o valor sairia mil vezes
    // maior, e nada na tela acusaria.
    expect(parsearValor('1250,555')).toBe(1250.56);
    expect(parsearValor(',555')).toBe(0.56);
  });

  it('não lê como milhar o separador que vem depois de outro separador', () => {
    // ⚠️ Medido em produção: estas três formas gravavam MIL VEZES o valor
    // digitado. `1.250,555` é a forma brasileira de digitar um centavo a
    // mais — a cabeça agrupa com ponto, então a vírgula final só pode ser
    // decimal. O caso sem ponto (`1250,555`, acima) já era barrado; o caso
    // COM ponto, que é o que o operador realmente digita, não.
    expect(parsearValor('1.250,555')).toBe(1250.56);
    expect(parsearValor('40.000,000')).toBe(40000);
    expect(parsearValor('1,250.555')).toBe(1250.56);
  });

  it('não lê como milhar um grupo que começa por zero', () => {
    // `0,555` é meio real mal digitado, não "zero mil quinhentos e
    // cinquenta e cinco". Número agrupado nenhum começa com zero.
    expect(parsearValor('0,555')).toBe(0.56);
    expect(parsearValor('0.555')).toBe(0.56);
  });

  it('trata uma ou duas casas como centavos', () => {
    expect(parsearValor('1250,5')).toBe(1250.5);
    expect(parsearValor('1250,55')).toBe(1250.55);
    expect(parsearValor('1.250,55')).toBe(1250.55);
  });

  it('entende o formato americano colado de fora', () => {
    expect(parsearValor('1,250.55')).toBe(1250.55);
    expect(parsearValor('40,000.00')).toBe(40000);
  });

  it('devolve null para campo vazio ou só pontuação', () => {
    // Diferente de zero: apagar o campo é "não informei", e quem chama
    // decide. Zero aqui gravaria um negócio de R$ 0,00 que ninguém escreveu.
    expect(parsearValor('')).toBeNull();
    expect(parsearValor('   ')).toBeNull();
    expect(parsearValor('R$')).toBeNull();
    expect(parsearValor('abc')).toBeNull();
  });

  it('aceita valor que começa pela vírgula', () => {
    expect(parsearValor(',5')).toBe(0.5);
    expect(parsearValor('R$ ,50')).toBe(0.5);
  });

  it('descarta o sinal — negócio não vale menos que nada', () => {
    expect(parsearValor('-500')).toBe(500);
  });

  it('arredonda para centavos em vez de guardar cauda de float', () => {
    expect(parsearValor('1250,555')).toBe(1250.56);
    // Sem o arredondamento explícito isto dá 1250.5599999999999.
    expect(parsearValor('1250,5599')).toBe(1250.56);
  });
});

/** `R$` + NBSP, como o Intl escreve. */
const rs = (numero: string) => `R$\u00A0${numero}`;

/** O campo como o navegador o vê: o texto e a seleção. */
interface Campo {
  texto: string;
  ini: number;
  fim: number;
}

const VAZIO: Campo = { texto: '', ini: 0, fim: 0 };
const campo = (e: Edicao): Campo => ({ texto: e.texto, ini: e.cursor, fim: e.cursor });
const tudoSelecionado = (texto: string): Campo => ({ texto, ini: 0, fim: texto.length });
const cursorEm = (texto: string, ini: number): Campo => ({ texto, ini, fim: ini });

/** O que o navegador faz com cada tecla de texto, e a máscara em seguida. */
function digitar(c: Campo, teclas: string): Campo {
  let atual = c;
  for (const tecla of teclas) {
    const novo = atual.texto.slice(0, atual.ini) + tecla + atual.texto.slice(atual.fim);
    atual = campo(aplicarEdicao(atual.texto, novo, atual.ini + tecla.length, 'insertText'));
  }
  return atual;
}

type Apagar = 'deleteContentBackward' | 'deleteContentForward';

function apagar(c: Campo, vezes = 1, tipo: Apagar = 'deleteContentBackward'): Campo {
  let atual = c;
  for (let i = 0; i < vezes; i++) {
    let { ini, fim } = atual;
    if (ini === fim) {
      if (tipo === 'deleteContentBackward') {
        if (ini === 0) continue;
        ini -= 1;
      } else {
        if (fim === atual.texto.length) continue;
        fim += 1;
      }
    }
    const novo = atual.texto.slice(0, ini) + atual.texto.slice(fim);
    atual = campo(aplicarEdicao(atual.texto, novo, ini, tipo));
  }
  return atual;
}

const apagarParaFrente = (c: Campo, vezes = 1) => apagar(c, vezes, 'deleteContentForward');

/** O texto com o cursor marcado por `|`: a asserção fica legível. */
const comCursor = (c: Campo) => `${c.texto.slice(0, c.ini)}|${c.texto.slice(c.ini)}`;

describe('paraEdicao', () => {
  it('mostra o MESMO texto de sem foco: entrar no campo não mexe em nada', () => {
    // O campo mostra o `formatCurrency` sem foco e a máscara com foco; um
    // espaço comum no lugar do NBSP, ou um ponto de milhar a menos, faria o
    // texto pular ao clicar.
    for (const n of [0.5, 7, 1250.5, 1250.55, 40000, 1234567, 9999999999.99]) {
      expect(paraEdicao(n)).toBe(formatCurrency(n));
    }
  });

  it('devolve campo vazio para zero e para ausência', () => {
    expect(paraEdicao(0)).toBe('');
    expect(paraEdicao(null)).toBe('');
    expect(paraEdicao(undefined)).toBe('');
    expect(paraEdicao(Number.NaN)).toBe('');
    expect(paraEdicao(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('volta inteiro pelo parse — o ciclo fecha', () => {
    for (const n of [0.5, 7, 1250.55, 40000, 1234567]) {
      expect(parsearValor(paraEdicao(n))).toBe(n);
    }
  });
});

describe('aplicarEdicao — digitando', () => {
  it('40000 dá R$ 40.000,00: os dígitos são REAIS, não centavos', () => {
    // ⚠️ O caso que decide a máscara. A de "app de banco" leria isto como
    // R$ 400,00, e quem digitasse do jeito de sempre gravaria cem vezes
    // menos.
    expect(comCursor(digitar(VAZIO, '4'))).toBe(rs('4|,00'));
    const c = digitar(VAZIO, '40000');
    expect(comCursor(c)).toBe(rs('40.000|,00'));
    expect(parsearValor(c.texto)).toBe(40000);
  });

  it('a vírgula leva aos centavos, e ali cada dígito escreve por cima', () => {
    const naVirgula = digitar(VAZIO, '1250,');
    expect(comCursor(naVirgula)).toBe(rs('1.250,|00'));
    const cinco = digitar(naVirgula, '5');
    expect(comCursor(cinco)).toBe(rs('1.250,5|0'));
    const sete = digitar(cinco, '7');
    expect(comCursor(sete)).toBe(rs('1.250,57|'));
    // Depois do segundo centavo não cabe mais nada.
    expect(comCursor(digitar(sete, '9'))).toBe(rs('1.250,57|'));
    expect(parsearValor(sete.texto)).toBe(1250.57);
  });

  it('o ponto de milhar é da máscara: o digitado não entra, e 40.000 continua quarenta mil', () => {
    expect(comCursor(digitar(VAZIO, '40.000'))).toBe(rs('40.000|,00'));
  });

  it('letra e sinal não entram', () => {
    expect(comCursor(digitar(VAZIO, '1a2'))).toBe(rs('12|,00'));
    expect(comCursor(digitar(VAZIO, '-5'))).toBe(rs('5|,00'));
  });

  it('zero à esquerda não fica', () => {
    expect(comCursor(digitar(VAZIO, '0'))).toBe(rs('0|,00'));
    expect(comCursor(digitar(VAZIO, '05'))).toBe(rs('5|,00'));
  });

  it('vírgula com o campo vazio abre os centavos', () => {
    const c = digitar(VAZIO, ',');
    expect(comCursor(c)).toBe(rs('0,|00'));
    const cinco = digitar(c, '5');
    expect(comCursor(cinco)).toBe(rs('0,5|0'));
    expect(parsearValor(cinco.texto)).toBe(0.5);
  });

  it('o 0 de R$ 0,50 é enchimento: o dígito digitado toma o lugar dele', () => {
    const texto = digitar(VAZIO, ',5').texto;
    expect(texto).toBe(rs('0,50'));
    // Antes do zero e depois dele, o resultado é o mesmo: 5, não 50.
    expect(comCursor(digitar(cursorEm(texto, rs('').length), '5'))).toBe(rs('5|,50'));
    expect(comCursor(digitar(cursorEm(texto, rs('0').length), '5'))).toBe(rs('5|,50'));
    expect(comCursor(digitar(cursorEm(texto, rs('0').length), '0'))).toBe(rs('0|,50'));
  });

  it('vírgula digitada nos centavos não mexe em nada', () => {
    const c = digitar(VAZIO, '1250,5');
    expect(comCursor(digitar(c, ','))).toBe(rs('1.250,5|0'));
  });

  it('digitar no meio da parte inteira deixa o cursor depois do dígito novo', () => {
    // Depois do `4` de "R$ 40.000,00".
    const c = cursorEm(rs('40.000,00'), rs('4').length);
    expect(comCursor(digitar(c, '1'))).toBe(rs('41|0.000,00'));
  });

  it('texto inserido de uma vez (ditado, autocompletar) vale como digitado tecla a tecla', () => {
    // ⚠️ Medido no navegador: ",5" chegou num evento só, e a vírgula no meio
    // se perdia — o 5 entrava na parte inteira (R$ 400.005,00).
    const depois = aplicarEdicao(rs('40.000,00'), rs('40.000,5,00'), rs('40.000,5').length, 'insertText');
    expect(comCursor(campo(depois))).toBe(rs('40.000,5|0'));
    expect(comCursor(campo(aplicarEdicao('', '4,5', 3, 'insertText')))).toBe(rs('4,5|0'));
    // Trocando uma seleção (não é inserção pura), o resultado é o mesmo.
    const tudo = rs('40.000,00');
    expect(comCursor(campo(aplicarEdicao(tudo, ',5', 2, 'insertText')))).toBe(rs('0,5|0'));
  });

  it('texto ditado sobre um TRECHO selecionado vale como digitado sobre ele (Codex, PR #334)', () => {
    // ⚠️ A versão anterior só reproduzia a inserção pura: "1,2" ditado
    // sobre o "40" de R$ 40.000,00 dava R$ 12.000,00, e digitado dá
    // R$ 1.000,20. O valor errado ia para o banco no blur.
    const texto = rs('40.000,00');
    const selecao: Campo = { texto, ini: rs('').length, fim: rs('40').length };
    const novo = rs('1,2.000,00');
    const deUmaVez = campo(aplicarEdicao(texto, novo, rs('1,2').length, 'insertText'));
    expect(comCursor(deUmaVez)).toBe(rs('1.000,2|0'));
    expect(comCursor(deUmaVez)).toBe(comCursor(digitar(selecao, '1,2')));
  });

  it('com tudo selecionado (o foco seleciona), digitar troca o valor inteiro', () => {
    expect(comCursor(digitar(tudoSelecionado(rs('40.000,00')), '7'))).toBe(rs('7|,00'));
  });

  it(`o teto é o do banco: numeric(12,2) cabe ${MAX_DIGITOS_INTEIROS} dígitos inteiros`, () => {
    const c = digitar(VAZIO, '12345678901');
    expect(comCursor(c)).toBe(rs('1.234.567.890|,00'));
    expect(MAX_DIGITOS_INTEIROS).toBe(10);
  });
});

describe('aplicarEdicao — apagando', () => {
  it('Backspace nos centavos zera no lugar; na vírgula, o cursor só pula', () => {
    const c = digitar(VAZIO, '4000,57');
    expect(comCursor(c)).toBe(rs('4.000,57|'));
    expect(comCursor(apagar(c))).toBe(rs('4.000,5|0'));
    expect(comCursor(apagar(c, 2))).toBe(rs('4.000,|00'));
    expect(comCursor(apagar(c, 3))).toBe(rs('4.000|,00'));
    expect(comCursor(apagar(c, 4))).toBe(rs('400|,00'));
  });

  it('Backspace logo depois do ponto de milhar apaga o dígito antes dele', () => {
    // ⚠️ Sem isto, o ponto voltaria na hora e a tecla não faria nada.
    const c = cursorEm(rs('40.000,00'), rs('40.').length);
    expect(comCursor(apagar(c))).toBe(rs('4|.000,00'));
  });

  it('Delete logo antes do ponto de milhar apaga o dígito depois dele', () => {
    const c = cursorEm(rs('40.000,00'), rs('40').length);
    expect(comCursor(apagarParaFrente(c))).toBe(rs('4.0|00,00'));
  });

  it('Delete nos centavos zera o dígito no lugar, sem deslocar o outro', () => {
    const c = cursorEm(rs('4,57'), rs('4,').length);
    expect(comCursor(apagarParaFrente(c))).toBe(rs('4,|07'));
  });

  it('apagar o último dígito com os centavos zerados esvazia o campo', () => {
    const c = apagar(digitar(VAZIO, '4'));
    expect(c.texto).toBe('');
    expect(c.ini).toBe(0);
  });

  it('com centavos, apagar a parte inteira deixa o 0; mais um Backspace esvazia', () => {
    const texto = digitar(VAZIO, '4,5').texto;
    const antesDaVirgula = cursorEm(texto, texto.indexOf(','));
    const semInteiro = apagar(antesDaVirgula);
    expect(comCursor(semInteiro)).toBe(rs('0|,50'));
    expect(apagar(semInteiro).texto).toBe('');
  });

  it('tudo selecionado e apagado: campo vazio', () => {
    expect(apagar(tudoSelecionado(rs('40.000,00'))).texto).toBe('');
  });

  it('Backspace logo depois do R$ não apaga nada', () => {
    const c = cursorEm(rs('40.000,00'), rs('').length);
    expect(comCursor(apagar(c))).toBe(rs('|40.000,00'));
  });

  it('sem o tipo do evento, texto mais curto conta como Backspace', () => {
    const resultado = aplicarEdicao(rs('40.000,00'), rs('40000,00'), rs('40').length);
    expect(comCursor(campo(resultado))).toBe(rs('4|.000,00'));
  });
});

describe('colar', () => {
  it('lê qualquer formato e troca o campo inteiro', () => {
    expect(comCursor(campo(colar('R$ 1.250,55')!))).toBe(rs('1.250|,55'));
    expect(comCursor(campo(colar('1,250.55')!))).toBe(rs('1.250|,55'));
    // Quarenta mil, como digitar: colar não é a máscara de app de banco.
    expect(comCursor(campo(colar('40000')!))).toBe(rs('40.000|,00'));
  });

  it('texto que não é valor, ou que passa do teto do banco, não entra', () => {
    expect(colar('abc')).toBeNull();
    expect(colar('10000000000')).toBeNull();
    expect(comCursor(campo(colar('9999999999,99')!))).toBe(rs('9.999.999.999|,99'));
  });

  it('colar zero esvazia o campo', () => {
    expect(colar('0')).toEqual({ texto: '', cursor: 0 });
  });
});

describe('teclaDecimal (a tecla decimal do teclado numérico)', () => {
  it('vale como vírgula no lugar do cursor: leva aos centavos sem mudar o valor', () => {
    expect(comCursor(campo(teclaDecimal('', 0, 0)))).toBe(rs('0,|00'));
    const antesDaVirgula = rs('40.000').length;
    expect(comCursor(campo(teclaDecimal(rs('40.000,00'), antesDaVirgula, antesDaVirgula)))).toBe(
      rs('40.000,|00'),
    );
  });

  it('com o valor todo selecionado, troca a seleção como a vírgula comum (Codex, PR #334)', () => {
    // ⚠️ A versão anterior preservava a parte inteira: tecla decimal + 50
    // sobre "R$ 40.000,00" selecionado dava R$ 40.000,50, e a vírgula
    // comum, R$ 0,50.
    const tudo = rs('40.000,00');
    const tecla = campo(teclaDecimal(tudo, 0, tudo.length));
    expect(comCursor(tecla)).toBe(rs('0,|00'));
    expect(comCursor(digitar(tecla, '50'))).toBe(comCursor(digitar(digitar(tudoSelecionado(tudo), ','), '50')));
    expect(comCursor(digitar(tecla, '50'))).toBe(rs('0,50|'));
  });
});

describe('aplicarEdicao — qualquer sequência de teclas', () => {
  it('deixa o campo vazio ou no formato do Intl, com o cursor dentro do texto', () => {
    // Gerador fixo (mulberry32): sequência aleatória, mas a mesma em toda
    // execução — uma falha aqui se reproduz.
    let semente = 0x2f6e2b1;
    const acaso = () => {
      semente = (semente + 0x6d2b79f5) | 0;
      let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const FORMATO = /^R\$\u00A0(0|[1-9]\d{0,2}(\.\d{3})*),\d{2}$/;
    const teclas = ['0', '1', '5', '9', ',', '.', 'a'];

    for (let rodada = 0; rodada < 400; rodada++) {
      let c = VAZIO;
      for (let passo = 0; passo < 14; passo++) {
        const r = acaso();
        const tecla = () => teclas[Math.floor(acaso() * teclas.length)];
        if (r < 0.45) c = digitar(c, tecla());
        else if (r < 0.55) {
          // Duas ou três teclas num evento só, sobre o cursor ou a seleção:
          // tem de dar o mesmo que digitá-las uma a uma.
          const grupo = Array.from({ length: 2 + Math.floor(acaso() * 2) }, tecla).join('');
          const novo = c.texto.slice(0, c.ini) + grupo + c.texto.slice(c.fim);
          const deUmaVez = campo(aplicarEdicao(c.texto, novo, c.ini + grupo.length, 'insertText'));
          // Menos quando o grupo começa pelo caractere que troca: aí o texto
          // que chega é ambíguo (ver `trechoDigitado`).
          if (c.ini === c.fim || grupo[0] !== c.texto[c.ini]) {
            expect(comCursor(deUmaVez)).toBe(comCursor(digitar(c, grupo)));
          }
          c = deUmaVez;
        } else if (r < 0.68) c = apagar(c);
        else if (r < 0.78) c = apagarParaFrente(c);
        else if (r < 0.88) c = cursorEm(c.texto, Math.floor(acaso() * (c.texto.length + 1)));
        else if (r < 0.95) {
          // Um trecho qualquer selecionado.
          const a = Math.floor(acaso() * (c.texto.length + 1));
          const b = Math.floor(acaso() * (c.texto.length + 1));
          c = { texto: c.texto, ini: Math.min(a, b), fim: Math.max(a, b) };
        } else c = tudoSelecionado(c.texto);

        if (c.texto !== '') expect(c.texto).toMatch(FORMATO);
        expect(c.ini).toBeGreaterThanOrEqual(0);
        expect(c.ini).toBeLessThanOrEqual(c.texto.length);
        const n = parsearValor(c.texto) ?? 0;
        expect(n).toBeLessThan(10 ** MAX_DIGITOS_INTEIROS);
        // O texto da tela é o formato canônico do valor que vai ser gravado.
        if (n > 0) expect(c.texto).toBe(paraEdicao(n));
      }
    }
  });
});
