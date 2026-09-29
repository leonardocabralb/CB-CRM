// ============================================================
// Endereços que viram link clicável no texto — na bolha do fio (dentro da
// formatação do WhatsApp) e nas anotações internas (pedido do operador,
// 29/09/2026: o endereço colado na conversa ou na nota era texto morto).
//
// Só `http://`, `https://` e `www.` — o lado conservador. O WhatsApp também
// liga domínio solto ("site.com.br"), mas o texto de um escritório é cheio de
// pontos que não são endereço (número de processo, CNPJ, "fls.23"), e link
// falso é pior que link ausente.
//
// ⚠️ O esquema do `href` sai do PREFIXO casado (e o `new URL` confere), nunca
// do texto livre: `javascript:` e companhia não têm como virar link.
// ============================================================

export type LinkNoTexto = {
  /** Posição no texto original — o fim é exclusivo. */
  inicio: number;
  fim: number;
  /** O endereço como está escrito (é o que aparece na tela). */
  texto: string;
  /** Para onde vai: `www.` ganha `https://`. */
  href: string;
};

export type TrechoComLink =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'link'; texto: string; href: string };

/**
 * Candidato: o prefixo e tudo até um espaço. Fica de fora o que nunca é
 * endereço colado: aspas, `<>`, crase (é o marcador de monoespaçado),
 * caractere invisível de formatação (o WhatsApp manda U+200E/U+200B) e emoji.
 */
const CANDIDATO =
  /(?:https?:\/\/|www\.)[^\s<>"'`\p{Cf}\p{Extended_Pictographic}]+/giu;

/**
 * Colado nisto, o prefixo é pedaço de outra coisa ("abcwww.", "a@www.").
 * Os marcadores do WhatsApp (`*`, `_`, `~`) NÃO entram: `_www.x.com_` é
 * itálico em volta de um link.
 */
const ANTES_PROIBIDO = /[\p{L}\p{N}@./-]/u;

/** Pontuação que fecha a FRASE, não o endereço: "veja https://x.com." */
const FIM_DE_FRASE = /[.,;:!?'"”’»…]/u;
const ABRE_DO_PAR: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * Marcador do WhatsApp que PODE ABRIR formatação no texto antes do endereço
 * (a régua de `podeAbrir` do interpretador: sem letra/dígito colado à
 * esquerda, sem espaço à direita).
 *
 * ⚠️ É o que decide se o `_`/`~`/`*` do FIM é da formatação ou do endereço
 * (Codex, PR #347). Tirá-lo sempre quebrava link de verdade: código de
 * compartilhamento (Drive, SharePoint) termina em `_` uma vez em 64, e o
 * `href` apontaria para outra página. Só sai quando há quem o abra antes:
 * `*veja https://x.com*`, `_https://x.com_`.
 */
const ABRE_ANTES: Record<string, RegExp> = {
  '*': /(?:^|[^\p{L}\p{N}])\*(?=\S)/u,
  _: /(?:^|[^\p{L}\p{N}])_(?=\S)/u,
  '~': /(?:^|[^\p{L}\p{N}])~(?=\S)/u,
};

/** Depois de aparado, o mínimo para ser endereço de verdade. */
const VALIDO = /^(?:https?:\/\/[\p{L}\p{N}]|www\.[\p{L}\p{N}-]+\.[\p{L}\p{N}])/iu;

function contar(texto: string, c: string): number {
  let n = 0;
  for (const x of texto) if (x === c) n++;
  return n;
}

/**
 * Tira do fim o que é da frase. O parêntese de fechamento só sai quando está
 * SOBRANDO: `https://pt.wikipedia.org/wiki/Direito_(Brasil)` o mantém. O
 * marcador do WhatsApp só sai quando algum o abre ANTES do endereço
 * (`antes` = o texto até o 1º caractere dele) — ver {@link ABRE_ANTES}.
 */
function aparar(url: string, antes: string): string {
  let u = url;
  for (;;) {
    const ultimo = u[u.length - 1];
    if (ultimo === undefined) return u;
    const abre = ABRE_DO_PAR[ultimo];
    const marcador = ABRE_ANTES[ultimo];
    if (
      FIM_DE_FRASE.test(ultimo) ||
      (marcador !== undefined && marcador.test(antes)) ||
      (abre !== undefined && contar(u, abre) < contar(u, ultimo))
    ) {
      u = u.slice(0, -1);
      continue;
    }
    return u;
  }
}

function hrefDe(url: string): string | null {
  const href = /^www\./i.test(url) ? `https://${url}` : url;
  try {
    const { protocol } = new URL(href);
    return protocol === 'http:' || protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

/** Os endereços do texto, em ordem e sem sobreposição. */
export function acharLinks(texto: string | null | undefined): LinkNoTexto[] {
  if (!texto) return [];
  const achados: LinkNoTexto[] = [];
  for (const m of texto.matchAll(CANDIDATO)) {
    const inicio = m.index ?? 0;
    const antes = texto[inicio - 1];
    if (antes !== undefined && ANTES_PROIBIDO.test(antes)) continue;
    // O 1º caractere do endereço entra no `antes`: o marcador colado nele
    // (`*https://…`) tem de enxergar que à direita não há espaço.
    const url = aparar(m[0], texto.slice(0, inicio + 1));
    if (!VALIDO.test(url)) continue;
    const href = hrefDe(url);
    if (!href) continue;
    achados.push({ inicio, fim: inicio + url.length, texto: url, href });
  }
  return achados;
}

/**
 * O texto em trechos alternados de texto e link, para quem desenha. Juntos,
 * os trechos devolvem o texto original sem perder caractere.
 */
export function partirEmLinks(texto: string | null | undefined): TrechoComLink[] {
  if (!texto) return [];
  const trechos: TrechoComLink[] = [];
  let pos = 0;
  for (const l of acharLinks(texto)) {
    if (l.inicio > pos) trechos.push({ tipo: 'texto', texto: texto.slice(pos, l.inicio) });
    trechos.push({ tipo: 'link', texto: l.texto, href: l.href });
    pos = l.fim;
  }
  if (pos < texto.length) trechos.push({ tipo: 'texto', texto: texto.slice(pos) });
  return trechos;
}
