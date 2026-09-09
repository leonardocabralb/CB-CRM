/**
 * As notas da IA do tl;dv em linhas legíveis — puro. O `markdownContent`
 * chega como markdown simples: títulos (`## 1. Resumo da situação`), itens
 * (`- …`) e, dentro deles, carimbos de tempo como link relativo
 * (`[02:31](/app/meetings/<id>?t=151)`). Mostrar o texto CRU deixava o
 * link inteiro no meio da frase (medido na ficha em 09/09/2026). Não é um
 * renderizador de markdown: só o que o tl;dv usa.
 */

export const ORIGEM_DO_APP_TLDV = "https://tldv.io";

export type ParteDeNotas = { texto: string; href?: string };

export interface LinhaDeNotas {
  tipo: "titulo" | "item" | "texto";
  partes: ParteDeNotas[];
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** `[rótulo](url)` vira link; relativo (`/app/…`) aponta para o app do tl;dv; `**` some. */
export function partesDaLinha(texto: string): ParteDeNotas[] {
  const partes: ParteDeNotas[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(LINK)) {
    if (m.index === undefined) continue;
    if (m.index > ultimo) partes.push({ texto: semEnfase(texto.slice(ultimo, m.index)) });
    const alvo = m[2];
    const href = alvo.startsWith("/") ? `${ORIGEM_DO_APP_TLDV}${alvo}` : /^https?:\/\//i.test(alvo) ? alvo : null;
    partes.push(href ? { texto: semEnfase(m[1]), href } : { texto: semEnfase(m[1]) });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) partes.push({ texto: semEnfase(texto.slice(ultimo)) });
  return partes.filter((p) => p.texto !== "");
}

function semEnfase(t: string): string {
  return t.replaceAll("**", "");
}

export function linhasDasNotas(markdown: string): LinhaDeNotas[] {
  const saida: LinhaDeNotas[] = [];
  for (const cru of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const linha = cru.trim();
    if (linha === "") continue;
    const titulo = /^#{1,6}\s+(.*)$/.exec(linha);
    if (titulo) {
      saida.push({ tipo: "titulo", partes: partesDaLinha(titulo[1]) });
      continue;
    }
    const item = /^[-*•]\s+(.*)$/.exec(linha);
    if (item) {
      saida.push({ tipo: "item", partes: partesDaLinha(item[1]) });
      continue;
    }
    saida.push({ tipo: "texto", partes: partesDaLinha(linha) });
  }
  return saida;
}
