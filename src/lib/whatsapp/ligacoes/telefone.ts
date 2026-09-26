// ============================================================
// O telefone de quem ligou.
//
// A ligação chega endereçada por LID (`…@lid`) — as 5 de 25/09/2026 vieram
// assim —, e o LID JAMAIS vira `contacts.phone`: `findExistingContact` casa
// pelos últimos 8 dígitos e um LID fundiria com o celular de outra pessoa (a
// armadilha do JID de grupo, 906). Três fontes, nesta ordem, em `registrar.ts`:
//
//   1. o próprio JID, quando já é de telefone (`…@s.whatsapp.net`);
//   2. o acervo do CRM (`resolverTelefoneDoLid`, 1010): um LID que já mandou
//      mensagem tem o telefone ao lado — resolveu 3 dos 4 números de 25/09;
//   3. o `callerPn` da Baileys (PR #2190 do upstream dela, na rc13), que o
//      WhatsApp manda para quem ligou pela primeira vez.
//
// ⚠️ O `callerPn` tem defeito RELATADO (issue #2154 da Baileys): telefone
// FIXO brasileiro (12 dígitos) chega com um zero a mais no fim, e fica com 13
// dígitos sem o 9 do celular. Número assim não existe no plano brasileiro, e
// "consertar" tirando o zero seria adivinhar: a ligação é recusada como sem
// telefone, e a ficha não nasce com número errado.
//
// Puro, sem I/O.
// ============================================================

export function ehLid(jid: string | null | undefined): boolean {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

/** Os dígitos de um JID de TELEFONE (sem o `:aparelho`); `null` para LID, grupo e o resto. */
export function telefoneDoJid(jid: string | null | undefined): string | null {
  if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) return null;
  const digitos = jid.split('@')[0].split(':')[0];
  return /^\d{8,15}$/.test(digitos) ? digitos : null;
}

/**
 * O `callerPn` conferido. Aceita JID (`5583…@s.whatsapp.net`) ou só dígitos.
 * Brasileiro: 12 dígitos (fixo) ou 13 com o 9 na 5ª posição (celular). De fora
 * do Brasil: de 8 a 15 dígitos, como o E.164.
 */
export function telefoneDoCallerPn(bruto: string | null | undefined): string | null {
  if (typeof bruto !== 'string' || bruto.trim() === '') return null;
  if (bruto.includes('@') && !bruto.endsWith('@s.whatsapp.net')) return null;
  const digitos = bruto.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digitos)) return null;
  if (digitos.startsWith('55')) {
    if (digitos.length === 12) return digitos;
    if (digitos.length === 13 && digitos[4] === '9') return digitos;
    return null;
  }
  return digitos;
}
