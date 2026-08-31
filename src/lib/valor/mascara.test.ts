import { describe, expect, it } from 'vitest';

import { paraEdicao, parsearValor } from './mascara';

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

describe('paraEdicao', () => {
  it('devolve o número sem R$ e sem ponto de milhar', () => {
    expect(paraEdicao(40000)).toBe('40000');
    expect(paraEdicao(1250.5)).toBe('1250,5');
    expect(paraEdicao(1250.55)).toBe('1250,55');
  });

  it('devolve campo vazio para zero e para ausência', () => {
    expect(paraEdicao(0)).toBe('');
    expect(paraEdicao(null)).toBe('');
    expect(paraEdicao(undefined)).toBe('');
    expect(paraEdicao(Number.NaN)).toBe('');
  });

  it('volta inteiro pelo parse — o ciclo fecha', () => {
    for (const n of [0.5, 7, 1250.55, 40000, 1234567]) {
      expect(parsearValor(paraEdicao(n))).toBe(n);
    }
  });
});
