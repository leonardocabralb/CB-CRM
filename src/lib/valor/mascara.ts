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

// ============================================================
// A máscara que formata ENQUANTO se digita (decisão do operador em
// 28/09/2026, a opção "centavos à vista" do preview): o campo mostra
// `R$ 40.000,00` desde a primeira tecla.
//
// - Os dígitos entram na parte INTEIRA, com o cursor parado antes da
//   vírgula: digitar 40000 dá R$ 40.000,00, quarenta mil, como sempre foi.
//   ⚠️ Não é a máscara de "app de banco", que preenche pelos centavos
//   (40000 → R$ 400,00): quem digitasse do jeito de sempre gravaria cem
//   vezes menos. Ver o primeiro teste de `parsearValor`.
// - Os centavos ficam sempre à vista (`,00`). Digitar a vírgula leva o
//   cursor para eles, e ali cada dígito escreve POR CIMA do seguinte.
// - O ponto de milhar é da máscara: um `.` digitado é ignorado.
//
// Até aqui o campo com foco mostrava o número cru (`40000`) e só formatava
// ao sair.
// ============================================================

/**
 * O prefixo exatamente como o `Intl` o escreve em pt-BR: `R$` + NBSP
 * (U+00A0). ⚠️ Tem de ser o MESMO do `formatCurrency`: o campo mostra o
 * texto do Intl sem foco e o nosso com foco, e qualquer diferença faria o
 * texto pular na hora de entrar no campo. Há teste amarrando os dois.
 */
const PREFIXO = 'R$\u00A0';

/**
 * Teto de dígitos antes da vírgula. ⚠️ `deals.value` é `numeric(12,2)`: o
 * maior valor que o banco aceita é 9.999.999.999,99, dez dígitos inteiros.
 * Um a mais passaria pela tela e o save voltaria "numeric field overflow".
 */
export const MAX_DIGITOS_INTEIROS = 10;

/** O texto do campo e onde o cursor tem de ficar. */
export interface Edicao {
  texto: string;
  cursor: number;
}

const soDigitos = (texto: string) => texto.replace(/\D/g, '');
const semZerosAEsquerda = (digitos: string) => digitos.replace(/^0+/, '');
const comPontoDeMilhar = (inteiro: string) =>
  (inteiro || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** `inteiro` sem zero à esquerda (`''` = zero); `centavos` com dois dígitos. */
function montar(inteiro: string, centavos: string): string {
  return `${PREFIXO}${comPontoDeMilhar(inteiro)},${centavos}`;
}

const centavosDe = (digitos: string) => `${digitos}00`.slice(0, 2);

/**
 * Número → o texto do campo COM FOCO: o mesmo `R$ 40.000,00` de sem foco.
 * Entrar no campo não troca o texto; só seleciona tudo.
 *
 * Zero vira campo VAZIO — é o que o `defaultValue={deal.value || ''}` antigo
 * já fazia: a coluna é NOT NULL com default 0, e `R$ 0,00` em todo negócio
 * novo faria "não informei" parecer "vale zero".
 */
export function paraEdicao(valor: number | null | undefined): string {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return '';
  const centavos = Math.round(n * 100);
  return montar(
    semZerosAEsquerda(String(Math.floor(centavos / 100))),
    String(centavos % 100).padStart(2, '0'),
  );
}

/** Posição logo depois do `k`-ésimo dígito da parte inteira (0 = antes do primeiro). */
function cursorNoInteiro(texto: string, k: number): number {
  const virgula = texto.indexOf(',');
  if (k <= 0) return PREFIXO.length;
  let vistos = 0;
  for (let i = PREFIXO.length; i < virgula; i++) {
    if (texto[i] >= '0' && texto[i] <= '9' && ++vistos === k) return i + 1;
  }
  return virgula;
}

/**
 * O que o navegador fez com o texto → o texto formatado e o cursor.
 *
 * A máscara lê o RESULTADO da tecla (o `onChange`), não a tecla: é o que
 * funciona igual no teclado do computador, no do celular e no ditado, que
 * nem sempre avisam qual tecla foi.
 *
 * @param anterior o texto que estava no campo — sempre escrito por esta
 *   máscara, ou vazio.
 * @param novo o que ficou no campo depois da edição.
 * @param cursor o `selectionStart` depois da edição.
 * @param tipo o `InputEvent.inputType`, quando o navegador o informa: decide
 *   para que lado o cursor pula a vírgula. Sem ele, um texto mais curto conta
 *   como Backspace.
 */
export function aplicarEdicao(
  anterior: string,
  novo: string,
  cursor: number,
  tipo?: string,
): Edicao {
  const apagando = tipo ? tipo.startsWith('delete') : novo.length < anterior.length;

  // ⚠️ Texto INSERIDO DE UMA VEZ (ditado, autocompletar, alguns teclados de
  // celular) vale como digitado tecla a tecla. Medido no navegador: ",5"
  // chegou num evento só, a vírgula no meio se perdeu e o 5 foi parar na
  // parte inteira (R$ 400.005,00 no lugar de R$ 40.000,50).
  const inserido = novo.length - anterior.length;
  const inicio = cursor - inserido;
  if (
    !apagando &&
    inserido > 1 &&
    inicio >= 0 &&
    novo.slice(0, inicio) + novo.slice(cursor) === anterior
  ) {
    let atual: Edicao = { texto: anterior, cursor: inicio };
    for (const tecla of novo.slice(inicio, cursor)) {
      const comTecla = atual.texto.slice(0, atual.cursor) + tecla + atual.texto.slice(atual.cursor);
      atual = aplicarEdicao(atual.texto, comTecla, atual.cursor + 1, 'insertText');
    }
    return atual;
  }

  const virgulas: number[] = [];
  for (let i = 0; i < novo.length; i++) if (novo[i] === ',') virgulas.push(i);

  // Apagou tudo, ou só sobrou enfeite (`R$`): campo vazio.
  if (virgulas.length === 0 && soDigitos(novo) === '') return { texto: '', cursor: 0 };

  if (anterior === '') return lidoDoZero(novo, cursor);
  if (virgulas.length >= 2) return virgulaDigitada(novo, cursor, virgulas);
  if (virgulas.length === 0) return virgulaApagada(anterior, novo, cursor, tipo);
  return cursor <= virgulas[0]
    ? naParteInteira(anterior, novo, cursor, virgulas[0], apagando, tipo === 'deleteContentForward')
    : nosCentavos(novo, cursor, virgulas[0]);
}

/** O campo estava vazio: o que entrou é lido do zero. */
function lidoDoZero(novo: string, cursor: number): Edicao {
  const v = novo.indexOf(',');
  const inteiro = semZerosAEsquerda(soDigitos(v < 0 ? novo : novo.slice(0, v))).slice(
    0,
    MAX_DIGITOS_INTEIROS,
  );
  const texto = montar(inteiro, v < 0 ? '00' : centavosDe(soDigitos(novo.slice(v + 1))));
  const virgula = texto.indexOf(',');
  if (v >= 0 && cursor > v) {
    const k = Math.min(2, soDigitos(novo.slice(v + 1, cursor)).length);
    return { texto, cursor: virgula + 1 + k };
  }
  return { texto, cursor: virgula };
}

/**
 * Digitou uma vírgula (o texto ficou com duas): ela não entra — a do campo
 * já está lá —, e o cursor vai para os centavos. Digitada já dentro dos
 * centavos, o cursor fica onde estava.
 */
function virgulaDigitada(novo: string, cursor: number, virgulas: number[]): Edicao {
  const digitada = novo[cursor - 1] === ',' ? cursor - 1 : virgulas[0];
  const limpo = novo.slice(0, digitada) + novo.slice(digitada + 1);
  const v = limpo.indexOf(',');
  const inteiro = semZerosAEsquerda(soDigitos(limpo.slice(0, v))).slice(0, MAX_DIGITOS_INTEIROS);
  const texto = montar(inteiro, centavosDe(soDigitos(limpo.slice(v + 1))));
  const virgula = texto.indexOf(',');
  if (digitada > v) {
    return { texto, cursor: virgula + 1 + Math.min(2, soDigitos(limpo.slice(v + 1, digitada)).length) };
  }
  return { texto, cursor: virgula + 1 };
}

/**
 * A vírgula sumiu do texto. Se foi SÓ ela (Backspace logo depois dela, ou
 * Delete logo antes), é separador fixo: o cursor pula por cima e o valor
 * não muda. Senão, uma seleção que a atravessava foi trocada ou apagada: o
 * que ficou antes do cursor é a parte inteira, o que ficou depois, centavos.
 */
function virgulaApagada(anterior: string, novo: string, cursor: number, tipo?: string): Edicao {
  if (soDigitos(novo) === soDigitos(anterior)) {
    const virgula = anterior.indexOf(',');
    return { texto: anterior, cursor: tipo === 'deleteContentForward' ? virgula + 1 : virgula };
  }
  const inteiro = semZerosAEsquerda(soDigitos(novo.slice(0, cursor))).slice(0, MAX_DIGITOS_INTEIROS);
  const centavos = centavosDe(soDigitos(novo.slice(cursor)));
  if (inteiro === '' && centavos === '00') return { texto: '', cursor: 0 };
  const texto = montar(inteiro, centavos);
  return { texto, cursor: texto.indexOf(',') };
}

/** Edição antes da vírgula. */
function naParteInteira(
  anterior: string,
  novo: string,
  cursor: number,
  v: number,
  apagando: boolean,
  paraFrente: boolean,
): Edicao {
  const iAnterior = anterior.indexOf(',');
  const inteiroAnterior = semZerosAEsquerda(soDigitos(anterior.slice(0, iAnterior)));
  const brutos = soDigitos(novo.slice(0, v));
  let inteiro = semZerosAEsquerda(brutos);
  // Dígitos antes do cursor, descontados os zeros à esquerda que saíram.
  let k = Math.max(0, soDigitos(novo.slice(0, cursor)).length - (brutos.length - inteiro.length));
  const centavos = centavosDe(soDigitos(novo.slice(v + 1)));

  // ⚠️ O `0` de "R$ 0,50" é ENCHIMENTO, não dígito: digitado antes dele, um
  // 5 viraria R$ 50,50. O que entrou toma o lugar do zero.
  const inserido = novo.length - anterior.length;
  const inicio = cursor - inserido;
  if (
    inteiroAnterior === '' &&
    inserido > 0 &&
    novo.slice(0, inicio) + novo.slice(cursor) === anterior
  ) {
    inteiro = semZerosAEsquerda(soDigitos(novo.slice(inicio, cursor)));
    k = inteiro.length;
  }

  // ⚠️ Apagar em cima de um SEPARADOR (o ponto de milhar, ou um pedaço do
  // `R$`) não muda dígito nenhum, e a máscara o reporia na hora: sem isto, o
  // Backspace logo depois do ponto não faria nada visível. Apaga o dígito
  // vizinho, que é o que a pessoa quis.
  if (
    apagando &&
    inteiro === inteiroAnterior &&
    centavos === centavosDe(soDigitos(anterior.slice(iAnterior + 1)))
  ) {
    // Backspace no `0` de enchimento (`R$ 0,50`): não há mais dígito
    // inteiro para apagar, e a pessoa está apagando tudo.
    if (!paraFrente && inteiro === '') return { texto: '', cursor: 0 };
    if (paraFrente) {
      inteiro = inteiro.slice(0, k) + inteiro.slice(k + 1);
    } else if (k > 0) {
      inteiro = inteiro.slice(0, k - 1) + inteiro.slice(k);
      k -= 1;
    }
    const antes = inteiro.length;
    inteiro = semZerosAEsquerda(inteiro);
    k = Math.max(0, k - (antes - inteiro.length));
  }

  // Passou do teto do banco: a tecla não entra.
  if (inteiro.length > MAX_DIGITOS_INTEIROS) {
    return { texto: anterior, cursor: Math.max(0, cursor - Math.max(0, novo.length - anterior.length)) };
  }

  if (apagando && inteiro === '' && centavos === '00') return { texto: '', cursor: 0 };
  const texto = montar(inteiro, centavos);
  // Sem parte inteira, o `0` na tela é enchimento: o cursor fica depois
  // dele, senão o próximo dígito entraria antes do zero.
  return { texto, cursor: inteiro === '' ? texto.indexOf(',') : cursorNoInteiro(texto, k) };
}

/** Edição depois da vírgula: os centavos são sempre dois. */
function nosCentavos(novo: string, cursor: number, v: number): Edicao {
  const inteiro = semZerosAEsquerda(soDigitos(novo.slice(0, v))).slice(0, MAX_DIGITOS_INTEIROS);
  const brutos = soDigitos(novo.slice(v + 1));
  let k = soDigitos(novo.slice(v + 1, cursor)).length;
  let centavos: string;
  if (brutos.length > 2) {
    // Digitou com os dois centavos preenchidos: o dígito novo escreve POR
    // CIMA do seguinte; depois do último, não cabe mais nada.
    const excesso = brutos.length - 2;
    if (k > 2) {
      centavos = brutos.slice(0, 2);
      k = 2;
    } else {
      centavos = brutos.slice(0, k) + brutos.slice(k + excesso);
    }
  } else if (brutos.length < 2) {
    // ⚠️ Apagou um centavo: vira zero NO LUGAR (`,57` → Backspace → `,50`),
    // nunca desloca o outro — deslocar mudaria o valor sem aviso.
    centavos = brutos.slice(0, k) + '0'.repeat(2 - brutos.length) + brutos.slice(k);
  } else {
    centavos = brutos;
  }
  const texto = montar(inteiro, centavos);
  return { texto, cursor: texto.indexOf(',') + 1 + Math.min(k, 2) };
}

/**
 * A tecla decimal do teclado numérico (`NumpadDecimal`) escreve `.` em
 * vários layouts, e aqui o ponto é ignorado. Quem a aperta quer os
 * centavos: vale como vírgula.
 */
export function irParaCentavos(texto: string): Edicao {
  const base = texto || montar('', '00');
  return { texto: base, cursor: base.indexOf(',') + 1 };
}

/**
 * Colar troca o campo INTEIRO pelo valor lido. O texto colado vem em
 * qualquer formato (`R$ 1.250,55`, `1,250.55`, `40000`), e é o
 * `parsearValor` que sabe ler todos — deixado com a máscara, a vírgula do
 * texto colado seria lida como "vá para os centavos".
 *
 * `null` = não é valor, ou passa do teto do banco: o campo fica como estava.
 */
export function colar(texto: string): Edicao | null {
  const n = parsearValor(texto);
  if (n === null || n >= 10 ** MAX_DIGITOS_INTEIROS) return null;
  const formatado = paraEdicao(n);
  return { texto: formatado, cursor: formatado ? formatado.indexOf(',') : 0 };
}
