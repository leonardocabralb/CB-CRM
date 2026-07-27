// ============================================================
// Formatação de texto do WhatsApp → árvore de nós.
//
// O WhatsApp marca formatação no PRÓPRIO texto: `*negrito*`, `_itálico_`,
// `~riscado~`, `` `mono` `` e ```` ```bloco``` ````. O CRM mostrava esses
// marcadores crus, então uma mensagem como "agendada para *15:00*" aparecia
// literalmente com os asteriscos, e o operador não conseguia nem ler direito
// nem escrever formatado com confiança.
//
// Devolve uma ÁRVORE, não HTML. O texto vem de fora (cliente, automação,
// integração) e nunca deve virar `dangerouslySetInnerHTML`: quem renderiza
// monta nós React, e aí não existe caminho para injeção.
//
// Regras copiadas do comportamento real do WhatsApp:
//  - O marcador de abertura precisa vir colado a um caractere que não seja
//    espaço, e o de fechamento também. `*oi*` formata; `* oi *` não.
//  - Marcador sem par fecha nada e aparece como texto literal — é o caso de
//    "2 * 3 = 6", que não pode virar itálico até o fim da mensagem.
//  - Aninha: `*_negrito e itálico_*`.
//  - Dentro de bloco/monoespaçado NÃO há formatação: ali o texto é literal,
//    senão um trecho de código com underline viraria itálico.
// ============================================================

export type NoFormatado =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'negrito' | 'italico' | 'riscado'; filhos: NoFormatado[] }
  | { tipo: 'mono'; texto: string };

/** Marcador → tipo de nó. A ordem não importa; o casamento é por caractere. */
const MARCADORES: Record<string, 'negrito' | 'italico' | 'riscado'> = {
  '*': 'negrito',
  _: 'italico',
  '~': 'riscado',
};

const ESPACO = /\s/;
/** Letra ou dígito, em qualquer alfabeto. */
const ALFANUM = /[\p{L}\p{N}]/u;

/**
 * FRONTEIRA DE PALAVRA — a regra que impede o interpretador de comer
 * caracteres da mensagem do cliente.
 *
 * Não basta o vizinho de dentro não ser espaço: o vizinho de FORA também
 * não pode ser letra nem dígito. O WhatsApp real não formata marcador no
 * meio de palavra, e sem essa metade da regra o CRM apagava caracteres que
 * o remetente nunca quis como formatação:
 *
 *   "R$ 1.500_00 por parcela"      → os dois `_` sumiam da tela
 *   "processo 0001234_56.2026"     → idem
 *   "arquivo_final_v2.pdf"         → virava "arquivofinalv2.pdf" em itálico
 *
 * Num CRM jurídico isso é perda de dado silenciosa: o número aparece errado
 * e ninguém percebe, porque a mensagem original só existe no WhatsApp.
 */
function podeAbrir(texto: string, i: number): boolean {
  const depois = texto[i + 1];
  if (depois === undefined || ESPACO.test(depois)) return false;
  const antes = texto[i - 1];
  return antes === undefined || !ALFANUM.test(antes);
}

function podeFechar(texto: string, i: number): boolean {
  const antes = texto[i - 1];
  if (antes === undefined || ESPACO.test(antes)) return false;
  const depois = texto[i + 1];
  return depois === undefined || !ALFANUM.test(depois);
}

/**
 * Procura o marcador que fecha o aberto em `inicio`, respeitando a regra de
 * adjacência. Devolve -1 quando não há par — e aí o marcador é texto comum.
 */
function acharFechamento(texto: string, marcador: string, inicio: number): number {
  for (let i = inicio + 1; i < texto.length; i++) {
    if (texto[i] !== marcador) continue;
    if (podeFechar(texto, i)) return i;
  }
  return -1;
}

/** Junta nós de texto vizinhos, para a árvore não virar um nó por letra. */
function compactar(nos: NoFormatado[]): NoFormatado[] {
  const saida: NoFormatado[] = [];
  for (const no of nos) {
    const ultimo = saida[saida.length - 1];
    if (no.tipo === 'texto' && ultimo?.tipo === 'texto') {
      ultimo.texto += no.texto;
    } else {
      saida.push(no);
    }
  }
  return saida;
}

/**
 * Converte texto do WhatsApp numa árvore de nós formatados.
 *
 * Nunca lança e nunca perde caractere: o que não casa com nenhuma regra sai
 * como texto literal. Uma mensagem sem formatação devolve um único nó.
 */
export function parseWhatsAppFormat(texto: string | null | undefined): NoFormatado[] {
  if (!texto) return [];

  const nos: NoFormatado[] = [];
  let buffer = '';

  const despejar = () => {
    if (buffer) {
      nos.push({ tipo: 'texto', texto: buffer });
      buffer = '';
    }
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    // Bloco ```...``` — literal por dentro, inclusive quebras de linha.
    if (c === '`' && texto.startsWith('```', i)) {
      const fim = texto.indexOf('```', i + 3);
      if (fim > i + 2) {
        despejar();
        nos.push({ tipo: 'mono', texto: texto.slice(i + 3, fim) });
        i = fim + 2;
        continue;
      }
    }

    // Monoespaçado `...` de uma linha.
    if (c === '`') {
      const fim = texto.indexOf('`', i + 1);
      if (fim > i + 1) {
        despejar();
        nos.push({ tipo: 'mono', texto: texto.slice(i + 1, fim) });
        i = fim;
        continue;
      }
    }

    const tipo = MARCADORES[c];
    if (tipo && podeAbrir(texto, i)) {
      const fim = acharFechamento(texto, c, i);
      if (fim > i) {
        despejar();
        // Recursão no miolo: `*_assim_*` aninha de verdade.
        nos.push({ tipo, filhos: parseWhatsAppFormat(texto.slice(i + 1, fim)) });
        i = fim;
        continue;
      }
    }

    buffer += c;
  }

  despejar();
  return compactar(nos);
}

/**
 * Mesmo texto, sem marcador nenhum. É o que a LISTA de conversas precisa:
 * ali o preview é truncado numa linha, então renderizar negrito não ajuda —
 * mas mostrar os asteriscos crus atrapalha.
 */
export function stripWhatsAppFormat(texto: string | null | undefined): string {
  return textoPlano(parseWhatsAppFormat(texto));
}

function textoPlano(nos: NoFormatado[]): string {
  return nos
    .map((no) => {
      if (no.tipo === 'texto' || no.tipo === 'mono') return no.texto;
      return textoPlano(no.filhos);
    })
    .join('');
}

/** Marcador de cada estilo, para os botões do campo de escrita. */
export const MARCADOR_POR_ESTILO = {
  negrito: '*',
  italico: '_',
  riscado: '~',
  mono: '`',
} as const;

export type EstiloFormatacao = keyof typeof MARCADOR_POR_ESTILO;

/**
 * Aplica (ou remove) um marcador na seleção do campo de escrita. Devolve o
 * texto novo e onde a seleção deve ficar depois — sem isso o cursor pula
 * para o fim a cada clique no botão.
 *
 * Alterna: clicar em negrito sobre um trecho já em negrito desfaz.
 */
export function alternarMarcador(
  texto: string,
  inicio: number,
  fim: number,
  estilo: EstiloFormatacao,
): { texto: string; inicio: number; fim: number } {
  const marca = MARCADOR_POR_ESTILO[estilo];
  const selecionado = texto.slice(inicio, fim);

  // Nada selecionado: insere o par e põe o cursor no meio, para o operador
  // já sair digitando dentro da formatação.
  if (!selecionado) {
    return {
      texto: texto.slice(0, inicio) + marca + marca + texto.slice(inicio),
      inicio: inicio + marca.length,
      fim: inicio + marca.length,
    };
  }

  // Já marcado por dentro da seleção → tira.
  //
  // Olhar só o primeiro e o último caractere NÃO serve: em "*a* e *b*" eles
  // são marcadores, mas de PARES DIFERENTES. Removê-los deixava "a* e *b",
  // destruindo a formatação do meio e entregando asteriscos crus ao cliente.
  // Selecionar tudo e clicar em negrito é o caminho mais natural do mundo
  // para cair nisso.
  //
  // Perguntar ao próprio interpretador resolve com exatidão: só é "já
  // marcado" quando a seleção inteira é UM único trecho daquele estilo.
  const arvore = parseWhatsAppFormat(selecionado);
  if (arvore.length === 1 && arvore[0].tipo === estilo) {
    const miolo = selecionado.slice(marca.length, -marca.length);
    return {
      texto: texto.slice(0, inicio) + miolo + texto.slice(fim),
      inicio,
      fim: inicio + miolo.length,
    };
  }

  // Já marcado por fora da seleção (o operador selecionou só o miolo) → tira.
  const antes = texto.slice(inicio - marca.length, inicio);
  const depois = texto.slice(fim, fim + marca.length);
  if (antes === marca && depois === marca) {
    return {
      texto: texto.slice(0, inicio - marca.length) + selecionado + texto.slice(fim + marca.length),
      inicio: inicio - marca.length,
      fim: fim - marca.length,
    };
  }

  return {
    texto: texto.slice(0, inicio) + marca + selecionado + marca + texto.slice(fim),
    inicio: inicio + marca.length,
    fim: fim + marca.length,
  };
}
