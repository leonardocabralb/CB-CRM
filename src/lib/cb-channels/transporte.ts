// ============================================================
// O TRANSPORTE de uma conexão — e o ÚNICO arquivo que compara com o literal.
//
// Uma conexão fala com o cliente por um de três caminhos: a API oficial da
// Meta (`meta`), a Evolution/Baileys (`evolution`) ou o Instagram Direct
// (`instagram`). Até setembro de 2026 eram dois, e o código decidia o
// transporte por `kind === 'evolution' ? … : …` em ~50 lugares — com o
// `else` significando "é Meta". Foi medido antes de o terceiro entrar
// (`docs/ESTUDO-instagram-direct.md`, §4.2): acrescentar `'instagram'` ao
// tipo dava 7 erros de compilação em 6 arquivos, e NENHUM dos ramos de
// envio aparecia. Um canal Instagram seria tratado como WhatsApp Cloud API
// em silêncio — o token do Instagram iria para `graph.facebook.com`, o IGSID
// para um campo de telefone.
//
// O que este módulo garante:
//   • `ehMeta`/`ehEvolution`/`ehInstagram` dizem o que PERGUNTAM. Um `else`
//     não significa mais nada; cada ramo nomeia o seu transporte.
//   • `transporteDe` LANÇA em valor desconhecido. Nunca "cai" num transporte
//     por omissão — era o ternário de `resolve.ts` que mandava todo kind
//     estranho para 'meta'.
//   • `transporte.chamadores.test.ts` PROÍBE a comparação crua
//     (`kind === '…'`, `provider !== '…'`) em todo `src/`, fora daqui. É a
//     rede que o compilador não dá: o TypeScript aceita `x.kind === 'meta'`
//     para sempre, e o quarto transporte encontraria os mesmos `else`.
//
// Os predicados aceitam a string, um objeto com `kind` (linhas de
// `cb_channels`, o que o browser vê) ou um objeto com `provider`
// (`ResolvedChannel`, o espelho legado `whatsapp_config`) — são as três
// formas que o código já carrega, e obrigar a extrair o campo em cada call
// site só devolveria a comparação crua por outra porta.
// ============================================================

export const TRANSPORTES = ['meta', 'evolution', 'instagram'] as const;
export type Transporte = (typeof TRANSPORTES)[number];

export function transporteValido(valor: unknown): valor is Transporte {
  return (
    typeof valor === 'string' &&
    (TRANSPORTES as readonly string[]).includes(valor)
  );
}

/**
 * O transporte, ou uma exceção. Para linha do banco (o CHECK de
 * `cb_channels.kind` só aceita os três) e para entrada de API já validada.
 * Quem recebe texto de fora e quer responder 400 usa `transporteValido`.
 */
export function transporteDe(valor: unknown): Transporte {
  if (transporteValido(valor)) return valor;
  throw new Error(`Transporte de canal desconhecido: ${JSON.stringify(valor)}`);
}

/** As formas que os predicados aceitam. `null` é "sem canal" — nenhum
 *  predicado responde `true` para ele, de propósito. */
export type ComTransporte =
  | string
  | { kind: string | null | undefined }
  | { provider: string | null | undefined }
  | null
  | undefined;

function valorDe(x: ComTransporte): string | null {
  if (x == null) return null;
  if (typeof x === 'string') return x;
  if ('kind' in x) return x.kind ?? null;
  if ('provider' in x) return x.provider ?? null;
  return null;
}

/** API oficial da Meta (WhatsApp Cloud API). */
export function ehMeta(x: ComTransporte): boolean {
  return valorDe(x) === 'meta';
}

/** Evolution API (Baileys, pareado por QR Code). */
export function ehEvolution(x: ComTransporte): boolean {
  return valorDe(x) === 'evolution';
}

/** Instagram Direct (Instagram API com login do Instagram). */
export function ehInstagram(x: ComTransporte): boolean {
  return valorDe(x) === 'instagram';
}

/**
 * WhatsApp por qualquer transporte. É o que a maior parte dos ramos que
 * hoje dizem "não é Instagram" quer dizer — telefone como identidade,
 * JID, template só na Meta etc.
 */
export function ehWhatsApp(x: ComTransporte): boolean {
  const v = valorDe(x);
  return v === 'meta' || v === 'evolution';
}
