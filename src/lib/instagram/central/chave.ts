// ============================================================
// A chave desta instância na central do Instagram (U-3) — o lado do CRM do
// escritório (`INSTAGRAM_CENTRAL_CHAVE`). A central mora no Atlas CRM, e o
// `chave.ts` de lá tem as duas pontas; daqui vem só o que a instância usa.
// Este CRM é só instância, nunca central.
//
// A chave são 32 bytes aleatórios em base64url (43 caracteres), mostrados UMA
// vez no cadastro da instância na central. A central guarda o HASH dela (que
// confere o `Bearer` do resgate e do desconectar) e o SEGREDO DO REPASSE (HKDF
// da chave), com que assina, no formato `X-Hub-Signature-256` da Meta, a
// entrega que repassa. A instância refaz o segredo da chave e o grava em
// `cb_channels.ig_app_secret` da conexão: por isso a rota de webhook não muda
// (a conexão da central é uma conexão cujo "segredo que assina a entrega" é
// este).
//
// ⚠️ A derivação tem de ser IGUAL à da central, byte a byte: diferente, toda
// entrega repassada é 401. `cliente.test.ts` a prende num valor conhecido.
// ============================================================

import { hkdfSync } from 'node:crypto';

const FORMA_DA_CHAVE = /^[A-Za-z0-9_-]{43}$/;

/** A chave tem a forma que o cadastro gera? (Uma chave colada pela metade não passa.) */
export function chaveTemForma(chave: string | null | undefined): chave is string {
  return typeof chave === 'string' && FORMA_DA_CHAVE.test(chave);
}

/** O segredo com que a central assina o repasse a esta instância. */
export function segredoDoRepasse(chave: string): string {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(chave, 'utf8'), '', 'cb-ig-central-repasse', 32)
  ).toString('hex');
}
