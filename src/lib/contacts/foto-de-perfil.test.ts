import { describe, it, expect } from "vitest";
import {
  REVALIDAR_FOTO_MS,
  caminhoDaFoto,
  casarContatosComFotos,
  comCarimboDeVersao,
  fotosDosChats,
  mesmoTelefone,
  precisaConferirFoto,
  urlDaFotoNaResposta,
} from "./foto-de-perfil";

const AGORA = Date.parse("2026-09-03T12:00:00Z");
const dias = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();

describe("precisaConferirFoto — revalidação de 30 dias", () => {
  it("nunca conferida (ou carimbo com lixo) precisa", () => {
    expect(precisaConferirFoto({ avatar_checked_at: null }, AGORA)).toBe(true);
    expect(precisaConferirFoto({}, AGORA)).toBe(true);
    expect(precisaConferirFoto({ avatar_checked_at: "ontem" }, AGORA)).toBe(true);
  });
  it("conferida há 29 dias não; há 30, sim", () => {
    expect(REVALIDAR_FOTO_MS).toBe(30 * 86_400_000);
    expect(precisaConferirFoto({ avatar_checked_at: dias(29) }, AGORA)).toBe(false);
    expect(precisaConferirFoto({ avatar_checked_at: dias(30) }, AGORA)).toBe(true);
  });
});

describe("urlDaFotoNaResposta — a forma da Evolution", () => {
  it("lê profilePictureUrl e recusa o resto", () => {
    expect(
      urlDaFotoNaResposta({ wuid: "55@s.whatsapp.net", profilePictureUrl: "https://pps.whatsapp.net/x.jpg" }),
    ).toBe("https://pps.whatsapp.net/x.jpg");
    expect(urlDaFotoNaResposta({ wuid: "55@s.whatsapp.net", profilePictureUrl: null })).toBeNull();
    expect(urlDaFotoNaResposta({ profilePictureUrl: "javascript:alert(1)" })).toBeNull();
    expect(urlDaFotoNaResposta(null)).toBeNull();
    expect(urlDaFotoNaResposta("https://x")).toBeNull();
  });
});

describe("caminho e versão", () => {
  it("caminho estável na subpasta avatares/", () => {
    expect(caminhoDaFoto("conta", "contato")).toBe("account-conta/avatares/contato.jpg");
  });
  it("carimbo de versão respeita query existente", () => {
    expect(comCarimboDeVersao("https://s/x.jpg", 5)).toBe("https://s/x.jpg?v=5");
    expect(comCarimboDeVersao("https://s/x.jpg?a=1", 5)).toBe("https://s/x.jpg?a=1&v=5");
  });
});

describe("mesmoTelefone — sufixo E prefixo, tolerante ao nono dígito", () => {
  it("nono dígito e tronco não separam; DDD diferente separa", () => {
    expect(mesmoTelefone("5511999998888", "551199998888")).toBe(true);
    expect(mesmoTelefone("5511999998888", "5521999998888")).toBe(false);
    expect(mesmoTelefone("999998888", "5511999998888")).toBe(true);
    expect(mesmoTelefone("1234567", "5511999998888")).toBe(false);
  });
});

describe("fotosDosChats + casarContatosComFotos — o backfill", () => {
  const chats = [
    { remoteJid: "5511999998888@s.whatsapp.net", profilePicUrl: "https://pps/a.jpg" },
    { remoteJid: "120363@g.us", profilePicUrl: "https://pps/grupo.jpg" },
    { remoteJid: "5511777776666@s.whatsapp.net", profilePicUrl: null },
    { id: "5521888887777@s.whatsapp.net", profilePicUrl: "https://pps/b.jpg" },
    "lixo",
  ];
  it("só 1:1 com foto; grupo e sem foto ficam de fora", () => {
    expect(fotosDosChats(chats)).toEqual([
      { digitos: "5511999998888", url: "https://pps/a.jpg" },
      { digitos: "5521888887777", url: "https://pps/b.jpg" },
    ]);
  });
  it("casa pelos últimos 8 dígitos (tolerante ao nono dígito) e pula quem foi conferido há pouco", () => {
    const fotos = fotosDosChats(chats);
    const contatos = [
      { id: "c1", phone: "+55 11 9999-8888", avatar_checked_at: null }, // sem o nono dígito
      { id: "c2", phone: "+5521888887777", avatar_checked_at: dias(1) }, // recente
      { id: "c3", phone: "+5511777776666", avatar_checked_at: null }, // chat sem foto
      { id: "c4", phone: "+5531999998888", avatar_checked_at: null }, // mesmo sufixo, DDD 31: NÃO é o chat de SP
    ];
    expect(casarContatosComFotos(contatos, fotos, AGORA)).toEqual([
      { contactId: "c1", url: "https://pps/a.jpg" },
    ]);
    expect(casarContatosComFotos(contatos, fotos, AGORA, true)).toEqual([
      { contactId: "c1", url: "https://pps/a.jpg" },
      { contactId: "c2", url: "https://pps/b.jpg" },
    ]);
  });
});
