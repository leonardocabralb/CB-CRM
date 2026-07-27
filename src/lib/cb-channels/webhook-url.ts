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
//   2. Trocar o segredo por um diferente do que o receptor espera — a
//      Evolution entrega e o CRM responde 401 em tudo.
//
// ⚠️ REGRA DE PROJETO: esta guarda NUNCA pode trancar o conserto. Ela está
// no caminho do único gesto de emergência que existe na interface
// ("Ressincronizar"), e uma guarda que impede o reparo é pior que a falha
// que ela evita. Toda regra aqui tem a sua isenção correspondente, e elas
// são tão importantes quanto as regras.
// ============================================================

/** O que a Evolution já tem registrado para a instância. */
export interface WebhookRegistrado {
  url?: string | null;
  secret?: string | null;
}

export interface ContextoDaReaplicacao {
  /**
   * Origem HTTP de quem pediu — de qual endereço o operador clicou.
   *
   * É o que separa "a produção reaplicando a si mesma" de "uma máquina de
   * fora mexendo no webhook da produção". Sem isso, o dois são o mesmo
   * código rodando com envs diferentes.
   */
  origemDoPedido?: string;
  /**
   * A leitura do webhook atual FALHOU (timeout, 5xx). Diferente de "não há
   * webhook": aqui não sabemos o que existe do outro lado.
   */
  leituraFalhou?: boolean;
}

function hostnameDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    // Ponto final é FQDN absoluto: `localhost.` e `localhost` são o mesmo
    // host para o resolvedor, e sem normalizar aqui a comparação erra.
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
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
  const host = hostnameDe(url);
  // `new URL('localhost:3000')` NÃO lança: vira protocolo `localhost:` com
  // hostname vazio — o engano de digitação mais provável no `.env.local`.
  if (!host) return false;

  // Nomes que só existem para quem está na própria máquina.
  if (
    host === 'localhost' ||
    host === 'host.docker.internal' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return false;
  }

  // IPv6 chega entre colchetes. Loopback, não-especificado, link-local
  // (fe80::/10), ULA (fc00::/7) e o loopback IPv4 mapeado não saem da
  // máquina nem da rede local.
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || v6 === '::') return false;
    if (/^f[cd]/.test(v6)) return false;
    if (/^fe[89ab]/.test(v6)) return false;
    if (v6.startsWith('::ffff:')) return false;
    return true;
  }

  // Faixas privadas e de loopback do IPv4.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false; // link-local
    return true;
  }

  // Rótulo único (`http://meu-linux:3000`) só resolve dentro de uma LAN.
  // Aqui a URL do webhook é sempre um domínio público — se um dia alguém
  // usar nome de serviço interno, a recusa aparece na tela em vez de virar
  // uma entrega perdida em silêncio.
  if (!host.includes('.')) return false;

  return true;
}

/**
 * Devolve o motivo para RECUSAR a reaplicação, ou `null` quando ela pode
 * seguir. O texto vai para a tela do operador, então diz o que ajustar.
 */
export function motivoParaRecusar(
  atual: WebhookRegistrado | null | undefined,
  nova: { url: string; secret: string },
  ctx: ContextoDaReaplicacao = {},
): string | null {
  const urlNovaOk = ehUrlAlcancavel(nova.url);

  // Não conseguimos ler o que está registrado. Antes isto DESARMAVA a guarda
  // inteira: um timeout de 15s no GET — e o laço do QR consulta a cada 5s —
  // deixava passar o registro de uma URL local.
  //
  // Sem saber o que existe do outro lado, sobra UM sinal: de onde veio o
  // clique. Pedido vindo de um endereço público é o CRM implantado
  // reaplicando a si mesmo; vindo de `localhost`, é a máquina de alguém
  // mexendo num webhook que ela não recebe. Na dúvida, só o segundo é
  // barrado — a reaplicação legítima sempre parte de um host público.
  if (ctx.leituraFalhou) {
    if (!urlNovaOk) return motivoCego(nova.url);
    if (!ehUrlAlcancavel(ctx.origemDoPedido)) return motivoCego(nova.url);
    return null;
  }

  // Nada registrado, ou registrado num endereço que já era inalcançável:
  // não há o que proteger, e barrar aqui travaria o conserto.
  if (!ehUrlAlcancavel(atual?.url)) return null;

  if (!urlNovaOk) return motivoDeUrl(atual!.url!, nova.url);

  if (atual!.secret && atual!.secret !== nova.secret) {
    // ISENÇÃO: quando o pedido vem do MESMO host que hoje recebe os
    // webhooks, quem está reaplicando é o próprio destinatário — e o
    // segredo dele é, por definição, o certo. É o caso da rotação: o
    // `crm.env` da VPS muda, a produção passa a responder 401 a tudo, e o
    // conserto é exatamente reaplicar com o segredo novo. Sem esta isenção
    // a guarda mandava DESFAZER a rotação, e não havia saída pela
    // interface.
    const mesmoDestinatario =
      !!ctx.origemDoPedido && hostnameDe(atual!.url) === hostnameDe(ctx.origemDoPedido);
    if (!mesmoDestinatario) {
      return (
        `O segredo do webhook deste canal é diferente do configurado aqui, e ` +
        `este ambiente não é o que recebe os eventos (${hostnameDe(atual!.url)}). ` +
        `Reaplicar faria o CRM de produção recusar todos os eventos (401). ` +
        `Ajuste EVOLUTION_WEBHOOK_SECRET para o mesmo valor de lá, ou reaplique ` +
        `a partir do próprio ${hostnameDe(atual!.url)}.`
      );
    }
  }

  return null;
}

function motivoCego(nova: string): string {
  return (
    `Não foi possível ler o webhook atual deste canal, e o pedido não veio do ` +
    `endereço público do CRM (a reaplicação registraria ${nova}). Sem saber o ` +
    `que está registrado, reaplicar poderia derrubar o recebimento do número. ` +
    `Tente de novo a partir do CRM em produção.`
  );
}

function motivoDeUrl(atual: string, nova: string): string {
  return (
    `Este canal recebe mensagens em ${atual}, e a reaplicação tentaria trocar ` +
    `por ${nova}, que só existe na máquina local. O número pararia de receber ` +
    `mensagem. Ajuste NEXT_PUBLIC_SITE_URL para a URL pública do CRM e tente ` +
    `de novo.`
  );
}

/** `Bearer abc` → `abc`. Qualquer outra forma volta como veio. */
export function segredoDoHeader(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  return authorization.replace(/^Bearer\s+/i, '').trim() || null;
}
