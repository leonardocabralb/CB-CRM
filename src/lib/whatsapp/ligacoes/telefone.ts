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
// ⚠️ O `callerPn` tem defeito RELATADO (issue #2154 da Baileys): número
// brasileiro de 12 dígitos chega com um zero a mais no fim (a hipótese do
// relato é um tamanho fixo de 13 na decodificação). O relato fala de FIXO, mas
// 12 dígitos é também o celular no WhatsApp fora de SP/RJ/ES (DDD 31 em
// diante: a conta foi registrada sem o 9) — o nosso caso, DDD 83. Dois
// resultados do defeito, e os dois são recusados:
//   - fixo (ou celular antigo começando em 7/8) + 0 = 13 dígitos sem o 9 na
//     5ª posição: número que não existe;
//   - celular antigo começando em 9 + 0 = 13 dígitos COM o 9 na 5ª posição, o
//     celular de OUTRA pessoa. Com DDD 31 em diante, 13 dígitos terminados em
//     0 são ambíguos (o defeito ou um celular de verdade) e são recusados.
// "Consertar" tirando o zero seria adivinhar: a ligação fica sem telefone
// (`sem_telefone`), e a ficha nunca nasce com o número de um estranho. O valor
// cru fica em `cb_ligacoes.telefone_informado` para medir o formato real.
//
// Puro, sem I/O.
// ============================================================

export function ehLid(jid: string | null | undefined): boolean {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

/**
 * O LID sem o `:aparelho` (`123:45@lid` → `123@lid`). O acervo (`remote_jid_lid`)
 * e o `own_lid` da conexão guardam a forma sem aparelho; comparar a forma com
 * aparelho erraria as duas perguntas em silêncio. O que não é LID volta igual.
 */
export function lidSemAparelho<T extends string | null>(jid: T): T {
  if (typeof jid !== 'string' || !ehLid(jid)) return jid;
  return jid.replace(/:\d+(?=@lid$)/, '') as T;
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
    if (digitos.length !== 13 || digitos[4] !== '9') return null;
    // DDD 31 em diante registra o celular com 12 dígitos: 13 terminados em 0
    // podem ser o defeito sobre um celular antigo começando em 9.
    const ddd = Number(digitos.slice(2, 4));
    if (ddd >= 31 && digitos.endsWith('0')) return null;
    return digitos;
  }
  return digitos;
}
