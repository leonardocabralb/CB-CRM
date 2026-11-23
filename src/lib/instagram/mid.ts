// ============================================================
// O MESMO `mid` do Instagram em duas grafias (medido em 23/11/2026).
//
// O `mid` é o base64 de um texto como `ig_dm_item:1:IGMessageID:<a>:<b>:<c>`,
// com dois escapes da Meta: `ZA` = `Z` e `ZD` = `=`. O envio pelo
// graph.instagram.com (login do Instagram) devolve essa grafia, a mesma do
// eco do webhook. O envio pelo graph.facebook.com (a conexão pela central)
// devolve `new_ig_dm_item:1:IGMessageID:…`, com o MESMO IGMessageID, e o eco
// chega na grafia antiga. Comparado como texto, o eco não achava a nossa linha
// e cada resposta do CRM aparecia duas vezes no fio.
//
// `chaveDoMid` devolve o trecho a partir de `IGMessageID:`, que identifica a
// mensagem nas duas grafias. `null` quando o mid não tem essa forma (formato
// novo da Meta, o `#n` da linha irmã de anexo, o mid de teste): aí só vale a
// comparação exata, como antes.
// ============================================================

/** Só os caracteres do base64 da Meta: o Node ignoraria o resto em silêncio. */
const BASE64 = /^[A-Za-z0-9+/]+$/;
const FORMA = /^[a-z_]+:\d+:(IGMessageID:[\d:]+)$/;

export function chaveDoMid(mid: string): string | null {
  if (!BASE64.test(mid)) return null;
  const base64 = mid.replace(/Z([AD])/g, (_, c: string) => (c === 'A' ? 'Z' : '='));
  const texto = Buffer.from(base64, 'base64').toString('latin1');
  return FORMA.exec(texto)?.[1] ?? null;
}
