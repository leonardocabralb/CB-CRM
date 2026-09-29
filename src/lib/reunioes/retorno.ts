/**
 * Para onde a faixa "Voltar às reuniões" da caixa de entrada leva: a URL da
 * pauta de onde a conversa foi aberta (`/reunioes?dia=2026-09-29`), guardada
 * na aba (sessionStorage) no clique de "Abrir conversa".
 *
 * ⚠️ Guardada, e não carregada na URL do inbox: a caixa de entrada reescreve a
 * própria URL a cada troca de conversa (`urlDoInbox`), e um parâmetro a mais
 * teria de sobreviver a todos os replaces — é o que o `de=funil` já custou.
 *
 * ⚠️ Só volta para `/reunioes`: o valor mora num storage que qualquer script
 * da mesma origem escreve, e um `href` vindo dali não pode levar para fora da
 * pauta. Validade de 2 h: voltar ao inbox no dia seguinte e cair num dia velho
 * da pauta confundiria mais do que ajuda.
 */

const CHAVE = 'cb:pauta-de-reunioes:retorno';
const VALIDADE_MS = 2 * 60 * 60_000;
export const URL_DA_PAUTA = '/reunioes';

/** A URL é uma volta aceitável para a pauta? Só caminho local da própria tela. */
export function urlDaPautaValida(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (url !== URL_DA_PAUTA && !url.startsWith(`${URL_DA_PAUTA}?`)) return false;
  // `/reunioes?…` não pode esconder outro destino: sem `//`, sem `\`, sem `#`
  // (o router trata os três de formas que o `startsWith` não enxerga).
  return !/[\\#]|\/\//.test(url);
}

/** Lê o registro guardado; forma estranha ou vencido → a pauta de hoje. Puro. */
export function retornoDoRegistro(bruto: string | null, agora: number): string {
  if (!bruto) return URL_DA_PAUTA;
  try {
    const r = JSON.parse(bruto) as { url?: unknown; em?: unknown };
    if (typeof r.em !== 'number' || agora - r.em > VALIDADE_MS || agora < r.em) return URL_DA_PAUTA;
    return urlDaPautaValida(r.url) ? r.url : URL_DA_PAUTA;
  } catch {
    return URL_DA_PAUTA;
  }
}

/** Guarda a URL da pauta antes de navegar para a conversa. Nunca lança. */
export function guardarRetornoDaPauta(url: string): void {
  if (!urlDaPautaValida(url)) return;
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ url, em: Date.now() }));
  } catch {
    // Sem storage (modo privado): a faixa volta para a pauta de hoje.
  }
}

/** A URL a voltar. Nunca lança; sem registro, a pauta de hoje. */
export function lerRetornoDaPauta(): string {
  try {
    return retornoDoRegistro(sessionStorage.getItem(CHAVE), Date.now());
  } catch {
    return URL_DA_PAUTA;
  }
}
