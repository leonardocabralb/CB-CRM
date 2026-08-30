// ============================================================
// A fábrica das URLs que o INBOX escreve (os `router.replace` da página) e
// que a jornada do funil produz. Existe porque o param `de=funil` (a faixa
// "Voltar ao funil") precisa SOBREVIVER aos replaces ao trocar de conversa —
// com as strings montadas à mão em cada handler, o primeiro clique já
// apagava a faixa. As outras telas que produzem `/inbox?c=` (notificações,
// agendadas, radar, tarefas, painel) ficam fora de propósito: não vêm do
// funil, e a fábrica produziria a mesma string.
//
// ⚠️ `c` VENCE `etapa`: os dois juntos não têm leitor — `c` abre uma
// conversa, `etapa` semeia o filtro da lista, e emitir os dois faria a URL
// prometer duas coisas.
//
// ⚠️ `etapa` é porta de ENTRADA, não espelho do filtro. Quem navega de novo
// (replace ao trocar de conversa) NÃO a repete: preservá-la faria o filtro
// que o operador limpou no painel voltar no reload — a pastilha do painel é
// quem conta a verdade sobre o recorte.
//
// ⚠️ `de` só é emitido com o ÚNICO valor que tem leitor ("funil"). Reemitir
// verbatim fazia um `de=qualquercoisa` de link colado grudar em todos os
// replaces da sessão, sem UI nenhuma para removê-lo.
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
  if (params.de === "funil") partes.push(`de=${params.de}`);
  return partes.length > 0 ? `/inbox?${partes.join("&")}` : "/inbox";
}
