// ============================================================
// Guarda de reaplicação do webhook.
//
// A URL e o segredo do webhook são registrados POR INSTÂNCIA na Evolution,
// mas do nosso lado nascem de envs GLOBAIS (`NEXT_PUBLIC_SITE_URL` e
// `EVOLUTION_WEBHOOK_SECRET`). Essa assimetria vira armadilha assim que
// alguém roda o CRM na própria máquina contra a MESMA conta de produção —
// que é o modo de trabalho escolhido aqui, para poder desenvolver contra o
// número e as conversas reais.
//
// Há duas formas de quebrar um webhook que funciona, e as duas são
// silenciosas: a Evolution aceita, responde 200, e o número simplesmente
// para de receber mensagem.
//
//   1. Trocar a URL por um endereço que só existe na máquina de alguém.
//      A Evolution passa a entregar num lugar que ela não alcança.
//   2. Trocar o segredo por um diferente do que o CRM de produção espera.
//      A Evolution entrega, e a produção responde 401 em tudo.
//
// Esta guarda cobre as duas. Ela nunca impede o CAMINHO DE CONSERTO
// (local → público), e nunca atrapalha instância nova, que não tem o que
// perder.
// ============================================================

/** O que a Evolution já tem registrado para a instância. */
export interface WebhookRegistrado {
  url?: string | null;
  secret?: string | null;
}

/**
 * A URL é alcançável a partir de outro host?
 *
 * Não é validação de segurança nem consulta de DNS — é a pergunta "a
 * Evolution, rodando em outro lugar, conseguiria entregar aqui?". Qualquer
 * coisa que só resolve dentro de uma máquina ou de uma rede privada responde
 * `false`.
 */
export function ehUrlAlcancavel(url: string | null | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // `new URL('localhost:3000')` NÃO lança: vira protocolo `localhost:` com
  // hostname vazio. Sem esta linha, uma URL escrita sem esquema passava por
  // alcançável — exatamente o engano de digitação mais provável no
  // `.env.local`.
  if (!host) return false;

  // Nomes que só existem para quem está na própria máquina.
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    host === 'host.docker.internal' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return false;
  }

  // Faixas privadas e de loopback do IPv4.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false; // link-local
  }

  return true;
}

/**
 * Devolve o motivo para RECUSAR a reaplicação, ou `null` quando ela pode
 * seguir.
 *
 * O texto do motivo vai parar na tela do operador, então diz o que ajustar.
 */
export function motivoParaRecusar(
  atual: WebhookRegistrado | null | undefined,
  nova: { url: string; secret: string },
): string | null {
  // Nada registrado, ou registrado num endereço que já era inalcançável:
  // não há o que proteger, e barrar aqui travaria o conserto.
  if (!ehUrlAlcancavel(atual?.url)) return null;

  if (!ehUrlAlcancavel(nova.url)) {
    return (
      `Este canal recebe mensagens em ${atual!.url}, e a reaplicação tentaria ` +
      `trocar por ${nova.url}, que só existe na máquina local. O número ` +
      `pararia de receber mensagem. Ajuste NEXT_PUBLIC_SITE_URL para a URL ` +
      `pública do CRM e tente de novo.`
    );
  }

  if (atual!.secret && atual!.secret !== nova.secret) {
    return (
      `O segredo do webhook deste canal é diferente do configurado aqui. ` +
      `Reaplicar trocaria o segredo registrado, e o CRM de produção passaria ` +
      `a recusar todos os eventos (401). Ajuste EVOLUTION_WEBHOOK_SECRET ` +
      `para o mesmo valor do ambiente que recebe os webhooks.`
    );
  }

  return null;
}

/** `Bearer abc` → `abc`. Qualquer outra forma volta como veio. */
export function segredoDoHeader(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  return authorization.replace(/^Bearer\s+/i, '').trim() || null;
}
