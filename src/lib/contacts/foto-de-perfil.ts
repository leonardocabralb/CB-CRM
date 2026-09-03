// ============================================================
// Foto de perfil do contato — as regras PURAS (pedido do operador,
// 2026-09-03; a busca e a gravação moram em `lib/whatsapp/foto-do-contato`).
//
// O WhatsApp devolve a foto como URL ASSINADA, que expira em dias — por isso
// a imagem é copiada para o nosso bucket e `contacts.avatar_url` aponta para
// lá. `avatar_checked_at` (973) guarda a última conferência, COM ou SEM
// foto: quem esconde a foto devolve `null`, e sem o carimbo a conta faria uma
// chamada à Evolution a cada mensagem desse contato, para sempre.
// ============================================================

/** Revalida a foto a cada 30 dias — troca de foto é rara, e cada conferência custa uma chamada. */
export const REVALIDAR_FOTO_MS = 30 * 24 * 60 * 60_000;

/** Teto do download: foto de perfil do WhatsApp tem ~30–100 KB; 2 MB já é abuso. */
export const FOTO_MAX_BYTES = 2 * 1024 * 1024;

export function precisaConferirFoto(
  c: { avatar_checked_at?: string | null },
  agoraMs: number,
): boolean {
  if (!c.avatar_checked_at) return true;
  const ultima = Date.parse(c.avatar_checked_at);
  if (Number.isNaN(ultima)) return true;
  return agoraMs - ultima >= REVALIDAR_FOTO_MS;
}

/**
 * A resposta de `POST /chat/fetchProfilePictureUrl` é `{ wuid,
 * profilePictureUrl }`, com `profilePictureUrl: null` quando não há foto (ou
 * o cliente a esconde). Qualquer outra forma vira `null` — nunca lança.
 */
export function urlDaFotoNaResposta(resposta: unknown): string | null {
  if (!resposta || typeof resposta !== "object") return null;
  const url = (resposta as { profilePictureUrl?: unknown }).profilePictureUrl;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

/**
 * Caminho ESTÁVEL por contato, na subpasta `avatares/` do bucket `chat-media`
 * (as policies da 020/023 casam só o primeiro segmento — aninhar é de graça,
 * e a subpasta é o que permite reconhecer o que é foto numa varredura).
 * Estável de propósito: a revalidação SOBRESCREVE (`upsert`) em vez de
 * deixar uma cópia órfã por mês.
 */
export function caminhoDaFoto(accountId: string, contactId: string): string {
  return `account-${accountId}/avatares/${contactId}.jpg`;
}

/**
 * O caminho é estável, logo a URL pública também — e o navegador guardaria a
 * foto velha pelo `cacheControl`. O `?v=` muda a cada gravação.
 */
export function comCarimboDeVersao(publicUrl: string, agoraMs: number): string {
  return `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${agoraMs}`;
}

export function digitosDoTelefone(phone: string): string {
  return phone.replace(/\D+/g, "");
}

/**
 * As fotos que `chat/findChats` já traz, só dos chats 1:1 (`@s.whatsapp.net`)
 * — o mesmo registro de onde os grupos tiram a foto (`cb-groups/sync`). É o
 * caminho do BACKFILL: uma chamada devolve a foto de todos os chats, contra
 * uma chamada por contato do caminho unitário.
 */
export function fotosDosChats(chats: unknown[]): { digitos: string; url: string }[] {
  const saida: { digitos: string; url: string }[] = [];
  for (const bruto of chats) {
    if (!bruto || typeof bruto !== "object") continue;
    const c = bruto as Record<string, unknown>;
    const jid =
      typeof c.remoteJid === "string" ? c.remoteJid : typeof c.id === "string" ? c.id : null;
    if (!jid || !jid.endsWith("@s.whatsapp.net")) continue;
    const url = c.profilePicUrl;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
    saida.push({ digitos: digitosDoTelefone(jid.split("@")[0]), url });
  }
  return saida;
}

/**
 * Dois números são o MESMO telefone quando os últimos 8 dígitos batem E o
 * que vem antes deles também bate depois de descontado o nono dígito (o `9`
 * que o Brasil inseriu) — é a régua de `findExistingContact`, reescrita
 * sobre dígitos. Só o sufixo cruzaria `(11) 9999-8888` com `(21) 9999-8888`:
 * dois clientes reais com a foto de um só.
 */
export function mesmoTelefone(a: string, b: string): boolean {
  if (a.length < 8 || b.length < 8 || a.slice(-8) !== b.slice(-8)) return false;
  const prefixo = (d: string) => d.slice(0, -8).replace(/9$/, "");
  const pa = prefixo(a);
  const pb = prefixo(b);
  // Um dos lados pode vir sem país/DDD (número digitado curto): aí o
  // prefixo vazio aceita qualquer coisa — é o que o LIKE de sufixo já fazia.
  return pa === "" || pb === "" || pa === pb;
}

/**
 * Casa os chats com os contatos da conta por `mesmoTelefone`. Contato
 * conferido há menos de 30 dias fica de fora, salvo `forcar`.
 */
export function casarContatosComFotos(
  contatos: { id: string; phone: string; avatar_checked_at?: string | null }[],
  fotos: { digitos: string; url: string }[],
  agoraMs: number,
  forcar = false,
): { contactId: string; url: string }[] {
  const porSufixo = new Map<string, { digitos: string; url: string }[]>();
  for (const f of fotos) {
    if (f.digitos.length < 8) continue;
    const chave = f.digitos.slice(-8);
    porSufixo.set(chave, [...(porSufixo.get(chave) ?? []), f]);
  }
  const pares: { contactId: string; url: string }[] = [];
  for (const c of contatos) {
    if (!forcar && !precisaConferirFoto(c, agoraMs)) continue;
    const d = digitosDoTelefone(c.phone);
    if (d.length < 8) continue;
    const foto = (porSufixo.get(d.slice(-8)) ?? []).find((f) => mesmoTelefone(d, f.digitos));
    if (foto) pares.push({ contactId: c.id, url: foto.url });
  }
  return pares;
}
