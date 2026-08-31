// ============================================================
// Ler e escrever valor de dinheiro num campo de TEXTO.
//
// Existe porque os dois campos de valor do app eram `<input type="number">`,
// que NÃO aceita máscara: o navegador recusa qualquer caractere fora de
// dígito/ponto/menos, então "R$ 40.000,00" simplesmente não entra ali. Para o
// operador ver o valor formatado enquanto edita, o campo tem de virar
// `type="text"` — e aí a conversão dos dois lados passa a ser nossa.
//
// Funções PURAS, sem React: é o que dá para testar de verdade. O componente
// que as usa (`src/components/valor/valor-input.tsx`) só cuida de foco e de
// quando chamar cada uma.
// ============================================================

/**
 * Quantos dígitos formam um grupo de milhar.
 *
 * ⚠️ É o que desempata `40.000` (quarenta mil) de `40.50` (quarenta e
 * cinquenta): o separador só é de milhar quando sobram exatamente três
 * dígitos depois dele. Nem o formato brasileiro nem o americano escrevem
 * dinheiro com três casas decimais.
 */
const DIGITOS_DE_MILHAR = 3;

/**
 * O trecho antes do último separador é um começo de número AGRUPADO?
 *
 * ⚠️ A contagem de três dígitos sozinha não basta, e o teste pegou o furo:
 * `1250,555` também tem três na cauda, mas `1250` não é grupo de milhar
 * nenhum — quem agrupa escreve `1.250.555`. Quatro dígitos soltos antes do
 * separador denunciam que aquilo são casas decimais mal digitadas, não
 * milhar, e ler como milhar multiplicaria o valor por mil.
 *
 * ⚠️ Duas recusas que a primeira versão não fazia, e que valiam mil vezes o
 * valor digitado:
 *
 * - **Separadores MISTOS**: em `1.250,555` a cabeça agrupa com ponto e o
 *   último separador é vírgula. Quem escreve os dois usa o último como
 *   decimal — é a forma brasileira de digitar centavos demais, não um milhar.
 * - **Zero à esquerda**: `0,555` é meio real mal digitado. Ninguém escreve o
 *   primeiro grupo de um número agrupado começando por zero.
 *
 * Vale como grupo: `40` em `40.000`, `999` em `999,999`, e `1.234` em
 * `1.234.567` (que já vem agrupado). Não vale a parte vazia de `,555`.
 */
function ehGrupoDeMilhar(inteiro: string, separador: string): boolean {
  if (inteiro === '') return false;
  if (inteiro.startsWith('0')) return false;
  const outro = separador === ',' ? '.' : ',';
  if (inteiro.includes(outro)) return false;
  return inteiro.includes(separador) || inteiro.length <= DIGITOS_DE_MILHAR;
}

/**
 * Texto digitado (ou colado) → número, ou `null` quando não há valor.
 *
 * Aceita, todos com o mesmo resultado 40000:
 *   `40000` · `40.000` · `40,000` · `R$ 40.000,00` · `40.000,00` · `R$40000`
 *
 * E preserva centavos: `1250,5` → 1250.5, `1.250,55` → 1250.55,
 * `1,250.55` (colado de sistema americano) → 1250.55.
 *
 * `null` é diferente de zero: campo apagado é "sem valor informado", e quem
 * chama decide o que fazer com isso. Devolver 0 aqui faria apagar o campo
 * gravar um negócio de zero real sem o operador ter escrito zero.
 *
 * Negativo não existe: o sinal é descartado junto com o resto da pontuação.
 * Nenhum negócio vale menos que nada, e o campo antigo já tinha `min="0"`.
 */
export function parsearValor(texto: string): number | null {
  // Fora dígitos e separadores, tudo é enfeite: `R$`, o NBSP que o ICU
  // insere, espaço comum, sinal.
  const limpo = texto.replace(/[^\d.,]/g, '');
  if (limpo === '') return null;

  const ultimoSeparador = Math.max(limpo.lastIndexOf(','), limpo.lastIndexOf('.'));

  let inteiro: string;
  let decimais: string;
  if (ultimoSeparador === -1) {
    inteiro = limpo;
    decimais = '';
  } else {
    const cauda = limpo.slice(ultimoSeparador + 1);
    const cabeca = limpo.slice(0, ultimoSeparador);
    if (cauda.length === DIGITOS_DE_MILHAR && ehGrupoDeMilhar(cabeca, limpo[ultimoSeparador])) {
      // Milhar: o separador não separa nada, faz parte do número inteiro.
      inteiro = limpo;
      decimais = '';
    } else {
      inteiro = cabeca;
      decimais = cauda;
    }
  }

  const digitos = inteiro.replace(/[.,]/g, '');
  // `,5` e `R$ ,50` chegam aqui sem parte inteira — vale como 0,5.
  const numero = Number(`${digitos || '0'}.${decimais || '0'}`);
  if (!Number.isFinite(numero)) return null;

  // Centavos são o fim da linha: `1250,555` vira 1250.56, não um float com
  // cauda que depois apareceria arredondado de forma diferente na tela e no
  // banco.
  return Math.round(numero * 100) / 100;
}

/**
 * Número → o texto que aparece no campo COM FOCO.
 *
 * Sem `R$` e sem ponto de milhar de propósito: com o cursor dentro, o
 * operador está redigitando, e separador que se move sozinho a cada tecla
 * atrapalha mais do que informa. A vírgula fica, porque é ela que ele
 * digitaria: `1250,5`, não `1250.5`.
 *
 * Zero vira campo VAZIO — é o que o `defaultValue={deal.value || ''}` antigo
 * já fazia, e um `0` grudado obriga a apagar antes de digitar.
 */
export function paraEdicao(valor: number | null | undefined): string {
  const n = Number(valor) || 0;
  if (n === 0) return '';
  return String(n).replace('.', ',');
}
