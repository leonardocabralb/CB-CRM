/**
 * O ANÚNCIO DE ORIGEM (Click-to-WhatsApp) nos campos de traqueamento da
 * ficha (949) — o miolo PURO. A gravação é `gravar-anuncio-de-origem.ts`.
 *
 * Na primeira mensagem que o cliente manda depois de clicar num anúncio, a
 * Meta junta à mensagem um objeto `referral`: o id do anúncio (`source_id`),
 * o link (`source_url`), o tipo (`source_type`: `ad` ou `post`), título,
 * texto, mídia e o `ctwa_clid` — o código do clique que a API de Conversões
 * exige. Até aqui o webhook DESCARTAVA tudo na chegada, e o que chega uma vez
 * só não volta: o lead de anúncio virava um lead sem origem.
 *
 * O que vai para qual campo (a CHAVE da 948, que é contrato):
 *
 * - `ctwa_clid` ← `ctwa_clid`, SEMPRE sobrescrito (o "último clique"). O
 *   evento de conversão precisa do código do clique que gerou ESTA conversa;
 *   o de um anúncio de meses atrás atribuiria a venda ao clique errado. Nada
 *   mais escreve esse campo (a iMotion não o manda; 0 fichas preenchidas em
 *   26/09/2026).
 *   ⚠️⚠️ Mas o campo é da FICHA, não do card: é o último clique em QUALQUER
 *   anúncio da conta. Um cliente do Bancário que clica num anúncio do
 *   Previdenciário troca o `ctwa_clid` da ficha, e o card do Bancário passa a
 *   carregar o clique do outro funil. Quem montar o evento de conversão em
 *   cima deste campo confere o FUNIL do card (o do anúncio tem de ser o do
 *   card), ou espera a tabela de cliques que liga o clique à conversa — senão
 *   o contrato de um setor vai à Meta como conversão da campanha do outro.
 * - `id_do_anuncio` ← `source_id`, só quando o tipo é `ad` (num `post`, o id
 *   é de uma publicação, não de anúncio).
 * - `utm_source` ← `instagram` quando o link é do Instagram; senão
 *   `facebook`, que aqui quer dizer "Meta Ads" — é o valor do modelo de
 *   parâmetros de URL da própria Meta para todo posicionamento, e o que os
 *   formulários da iMotion já gravam. ⚠️ O link do anúncio costuma ser o
 *   encurtador `fb.me` também quando o anúncio roda no Instagram (é o exemplo
 *   da documentação da Meta): o posicionamento de verdade sai da API de
 *   anúncios, não daqui.
 * - `utm_medium` ← `paid`, só no tipo `ad` (o mesmo valor da iMotion).
 *
 * Esses três últimos são a PRIMEIRA ORIGEM, e ela é gravada em BLOCO: só
 * quando a ficha não tem origem NENHUMA (nenhum campo de traqueamento
 * preenchido, fora os do último clique). Campo a campo, a ficha que veio de
 * um formulário da iMotion — com `utm_*` e `nome_do_anuncio`, mas sem
 * `id_do_anuncio` (186 das 194 em 26/09/2026) — ganharia o id de OUTRO
 * anúncio ao lado do nome do primeiro, e a ficha mentiria sobre de onde o
 * lead veio. A primeira origem prevalece inteira, ou nada dela entra (salvo
 * a corrida de milissegundos com a API v1, aceita e escrita em
 * `gravar-anuncio-de-origem.ts`).
 * ⚠️ E só com `source_type` CONHECIDO (`ad` ou `post`): com o tipo ausente ou
 * outro valor, gravar só o `utm_source` já contaria como "origem existente",
 * e o id do anúncio não entraria nunca mais — nem num clique seguinte. Ali só
 * o último clique é gravado, e o log registra o tipo.
 *
 * Título, texto e link do anúncio não têm campo na conta e ficam de fora
 * (pendência escrita no `docs/PLANO-funil-comercial.md`, Fase 5a). Nomes de
 * campanha, conjunto e anúncio não vêm no clique: saem da API de anúncios
 * pelo `source_id`.
 */

/** O que interessa do `referral` da Meta, já conferido. */
export interface AnuncioDeOrigem {
  /** `source_type` como veio (`ad` ou `post`), ou `null`. */
  tipo: string | null;
  /** `source_id`: o id do anúncio (ou da publicação, num `post`). */
  idDaOrigem: string | null;
  /** `source_url`: o link do anúncio. */
  link: string | null;
  /** `ctwa_clid`: o código do clique. Ausente em anúncio no Status. */
  ctwaClid: string | null;
}

/**
 * Os `source_type` que a Meta documenta: `ad` (anúncio) e `post`
 * (publicação). Só eles gravam a primeira origem.
 */
export const TIPOS_DE_ORIGEM: ReadonlyArray<string> = ['ad', 'post'];

/** Puro: o tipo é um dos que a Meta documenta? */
export function tipoConhecido(tipo: string | null): boolean {
  return tipo !== null && TIPOS_DE_ORIGEM.includes(tipo);
}

/** Chaves que são o ÚLTIMO clique: sobrescritas a cada clique novo. */
export const CHAVES_DO_ULTIMO_CLIQUE: ReadonlyArray<string> = ['ctwa_clid'];

/** Chaves que são a PRIMEIRA origem: gravadas em bloco, só na ficha sem origem. */
export const CHAVES_DA_PRIMEIRA_ORIGEM: ReadonlyArray<string> = [
  'utm_source',
  'utm_medium',
  'id_do_anuncio',
];

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Puro: o `referral` de uma mensagem da Meta, ou `null` quando não há nada
 * que valha guardar. PARSE, nunca `as`: o corpo vem de fora, e um campo com o
 * tipo errado não pode virar valor gravado na ficha.
 */
export function lerReferralDaMeta(bruto: unknown): AnuncioDeOrigem | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const r = bruto as Record<string, unknown>;
  const anuncio: AnuncioDeOrigem = {
    tipo: texto(r.source_type),
    idDaOrigem: texto(r.source_id),
    link: texto(r.source_url),
    ctwaClid: texto(r.ctwa_clid),
  };
  if (!anuncio.idDaOrigem && !anuncio.link && !anuncio.ctwaClid) return null;
  return anuncio;
}

/**
 * Puro: a FORMA de um `referral` — chaves e tipos, NUNCA valores — para o log
 * do aviso que chegou e não pôde ser lido. O formato veio da documentação da
 * Meta, sem um clique real medido: se a Meta mandar outra forma (outra chave,
 * id numérico, objeto aninhado), o clique se perde, e esta linha é o único
 * rastro de como ele era. Valor fica de fora (o `referral` traz título e
 * texto do anúncio, e o log não é lugar deles); até 30 chaves.
 */
export function formaDoReferral(
  bruto: unknown
): string | Record<string, string> {
  const tipoDe = (v: unknown): string =>
    v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return tipoDe(bruto);
  }
  return Object.fromEntries(
    Object.entries(bruto as Record<string, unknown>)
      .slice(0, 30)
      .map(([k, v]) => [k.slice(0, 60), tipoDe(v)])
  );
}

/**
 * Puro: `instagram` quando o link é do Instagram; `facebook` (Meta Ads) em
 * qualquer outro caso, inclusive sem link — o `referral` só existe em clique
 * num anúncio ou publicação da Meta.
 */
export function utmSourceDoLink(link: string | null): 'instagram' | 'facebook' {
  if (!link) return 'facebook';
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    return 'facebook';
  }
  const doInstagram =
    host === 'instagram.com' ||
    host.endsWith('.instagram.com') ||
    host === 'instagr.am';
  return doInstagram ? 'instagram' : 'facebook';
}

/**
 * Puro: chave do campo → valor, separado pela regra de escrita. Tipo que não
 * é `ad` nem `post` não tem primeira origem (ver o cabeçalho).
 */
export function valoresDoAnuncio(anuncio: AnuncioDeOrigem): {
  primeiraOrigem: Record<string, string>;
  ultimoClique: Record<string, string>;
} {
  const ehAnuncio = anuncio.tipo === 'ad';
  const primeiraOrigem: Record<string, string> = {};
  if (tipoConhecido(anuncio.tipo)) {
    primeiraOrigem.utm_source = utmSourceDoLink(anuncio.link);
  }
  if (ehAnuncio) primeiraOrigem.utm_medium = 'paid';
  if (ehAnuncio && anuncio.idDaOrigem) {
    primeiraOrigem.id_do_anuncio = anuncio.idDaOrigem;
  }
  const ultimoClique: Record<string, string> = {};
  if (anuncio.ctwaClid) ultimoClique.ctwa_clid = anuncio.ctwaClid;
  return { primeiraOrigem, ultimoClique };
}

export interface CampoDaConta {
  id: string;
  field_key: string;
  categoria: string | null;
}

export interface PlanoDoAnuncio {
  /** Id do campo → valor. Gravado só onde não há linha (primeira origem). */
  primeiraOrigem: Record<string, string>;
  /** Id do campo → valor. Gravado por cima do que houver (último clique). */
  ultimoClique: Record<string, string>;
  /** A ficha já tinha origem: nada da primeira origem foi planejado. */
  origemJaExistia: boolean;
  /** Chaves do mapeamento sem campo na conta — ficam de fora. */
  semCampo: string[];
}

/**
 * Puro: o que gravar nesta ficha.
 *
 * `campos` é o catálogo da conta; `valores`, o que a ficha já tem (id do
 * campo → texto). "A ficha já tem origem" = algum campo de traqueamento
 * (`categoria = 'tracking'`, ou uma chave da primeira origem criada noutro
 * bloco) preenchido, fora os do último clique — um `ctwa_clid` sozinho não
 * diz de onde o lead veio.
 *
 * O último clique que já está gravado com o mesmo valor sai do plano: gravar
 * de novo só custaria uma escrita.
 */
export function planejarGravacaoDoAnuncio(
  anuncio: AnuncioDeOrigem,
  campos: ReadonlyArray<CampoDaConta>,
  valores: Readonly<Record<string, string>>
): PlanoDoAnuncio {
  const { primeiraOrigem, ultimoClique } = valoresDoAnuncio(anuncio);
  const porChave = new Map(campos.map((c) => [c.field_key, c]));
  const preenchido = (id: string) => (valores[id] ?? '').trim() !== '';

  const origemJaExistia = campos.some(
    (c) =>
      (c.categoria === 'tracking' ||
        CHAVES_DA_PRIMEIRA_ORIGEM.includes(c.field_key)) &&
      !CHAVES_DO_ULTIMO_CLIQUE.includes(c.field_key) &&
      preenchido(c.id)
  );

  const plano: PlanoDoAnuncio = {
    primeiraOrigem: {},
    ultimoClique: {},
    origemJaExistia,
    semCampo: [],
  };

  for (const [chave, valor] of Object.entries(primeiraOrigem)) {
    const campo = porChave.get(chave);
    if (!campo) plano.semCampo.push(chave);
    else if (!origemJaExistia) plano.primeiraOrigem[campo.id] = valor;
  }
  for (const [chave, valor] of Object.entries(ultimoClique)) {
    const campo = porChave.get(chave);
    if (!campo) plano.semCampo.push(chave);
    else if ((valores[campo.id] ?? '').trim() !== valor) {
      plano.ultimoClique[campo.id] = valor;
    }
  }
  return plano;
}
