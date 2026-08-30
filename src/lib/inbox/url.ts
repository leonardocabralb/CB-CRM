// ============================================================
// A fábrica ÚNICA das URLs do inbox. Existe porque o param `de=funil` (a
// faixa "Voltar ao funil") precisa SOBREVIVER aos `router.replace` que a
// página do inbox faz ao trocar de conversa — com as strings montadas à mão
// em cada handler, o primeiro clique já apagava a faixa.
//
// ⚠️ `c` VENCE `etapa`: os dois juntos não têm leitor — `c` abre uma
// conversa, `etapa` semeia o filtro da lista, e emitir os dois faria a URL
// prometer duas coisas.
//
// ⚠️ `etapa` é porta de ENTRADA, não espelho do filtro. Quem navega de novo
// (replace ao trocar de conversa) NÃO a repete: preservá-la faria o filtro
// que o operador limpou no painel voltar no reload — a pastilha do painel é
// quem conta a verdade sobre o recorte.
// ============================================================

export function urlDoInbox(params: {
  c?: string | null;
  etapa?: string | null;
  de?: string | null;
}): string {
  const partes: string[] = [];
  if (params.c) {
    partes.push(`c=${encodeURIComponent(params.c)}`);
  } else if (params.etapa) {
    partes.push(`etapa=${encodeURIComponent(params.etapa)}`);
  }
  if (params.de) partes.push(`de=${encodeURIComponent(params.de)}`);
  return partes.length > 0 ? `/inbox?${partes.join("&")}` : "/inbox";
}
