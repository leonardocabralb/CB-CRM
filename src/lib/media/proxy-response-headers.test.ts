import { describe, it, expect } from "vitest";
import {
  baseMimeType,
  isInlineSafeMimeType,
  mediaProxyHeaders,
} from "./proxy-response-headers";

describe("baseMimeType", () => {
  it("strips parameters and lowercases", () => {
    expect(baseMimeType("Audio/OGG; codecs=opus")).toBe("audio/ogg");
  });

  it("rejects missing or malformed types", () => {
    expect(baseMimeType(null)).toBeNull();
    expect(baseMimeType("")).toBeNull();
    expect(baseMimeType("not a mime")).toBeNull();
    expect(baseMimeType("text/html\r\nSet-Cookie: x=1")).toBeNull();
  });
});

describe("isInlineSafeMimeType", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "audio/ogg", "video/mp4"])(
    "allows %s",
    (type) => {
      expect(isInlineSafeMimeType(type)).toBe(true);
    },
  );

  it.each([
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "text/xml",
    "application/xml",
    "application/pdf",
    "application/javascript",
    "application/octet-stream",
  ])("refuses %s", (type) => {
    expect(isInlineSafeMimeType(type)).toBe(false);
  });
});

describe("mediaProxyHeaders", () => {
  it("serves a photo inline", () => {
    const headers = mediaProxyHeaders("123", "image/jpeg");
    expect(headers["Content-Type"]).toBe("image/jpeg");
    expect(headers["Content-Disposition"]).toBe("inline");
  });

  it("forces an HTML document to download", () => {
    const headers = mediaProxyHeaders("123", "text/html; charset=utf-8");
    expect(headers["Content-Type"]).toBe("text/html");
    expect(headers["Content-Disposition"]).toBe("attachment");
  });

  it("forces an SVG to download", () => {
    expect(mediaProxyHeaders("123", "image/svg+xml")["Content-Disposition"]).toBe(
      "attachment",
    );
  });

  it("names a known document type after the media id", () => {
    expect(mediaProxyHeaders("987", "application/pdf")["Content-Disposition"]).toBe(
      'attachment; filename="987.pdf"',
    );
  });

  it("omits the filename when the media id is not a plain token", () => {
    expect(
      mediaProxyHeaders('9"; x=', "application/pdf")["Content-Disposition"],
    ).toBe("attachment");
  });

  it("falls back to octet-stream for a malformed type", () => {
    const headers = mediaProxyHeaders("1", "garbage");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Disposition"]).toBe("attachment");
  });

  it("always sends the hardening and private cache headers", () => {
    for (const type of ["image/png", "text/html", undefined]) {
      const headers = mediaProxyHeaders("1", type);
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Cache-Control"]).toBe("private, max-age=86400");
    }
  });

  // ⚠️ NOSSO (diverge do original): ver o topo de proxy-response-headers.ts.
  it("o que vira download vai com sandbox", () => {
    for (const type of ["text/html", "image/svg+xml", "application/pdf", undefined]) {
      expect(mediaProxyHeaders("1", type)["Content-Security-Policy"]).toBe("default-src 'none'; sandbox");
    }
  });

  it("a mídia exibida vai sem sandbox (aberta em aba, áudio e vídeo tocam), sem script", () => {
    for (const type of ["image/png", "audio/ogg; codecs=opus", "video/mp4"]) {
      const csp = mediaProxyHeaders("1", type)["Content-Security-Policy"];
      expect(csp).not.toMatch(/sandbox/);
      expect(csp).toMatch(/^default-src 'none';/);
      expect(csp).not.toMatch(/script-src/);
      expect(csp).toMatch(/media-src 'self'/);
    }
  });

  it("o download leva o nome que o link trouxe, com acento pelo filename*", () => {
    expect(mediaProxyHeaders("987", "application/pdf", "Petição Inicial.pdf")["Content-Disposition"]).toBe(
      `attachment; filename="Peti__o Inicial.pdf"; filename*=UTF-8''Peti%C3%A7%C3%A3o%20Inicial.pdf`,
    );
  });

  it("o nome do link não injeta cabeçalho nem caminho", () => {
    const d = mediaProxyHeaders("987", "application/pdf", '../x"\r\nSet-Cookie: a=1.pdf')["Content-Disposition"];
    expect(d).not.toMatch(/[\r\n]/);
    expect(d).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(d).not.toContain("..");
  });

  it("nome longo com emoji na borda do corte não lança (Codex, #436)", () => {
    const d = mediaProxyHeaders("987", "application/pdf", `${"a".repeat(75)}😀.pdf`)["Content-Disposition"];
    expect(d).toBe(`attachment; filename="${"a".repeat(75)}.pdf"; filename*=UTF-8''${"a".repeat(75)}.pdf`);
  });

  it("nome vazio ou só lixo cai no nome do id", () => {
    expect(mediaProxyHeaders("987", "application/pdf", "  ")["Content-Disposition"]).toBe(
      'attachment; filename="987.pdf"',
    );
  });

  it("mídia exibida ignora o nome (inline)", () => {
    expect(mediaProxyHeaders("1", "image/jpeg", "foto.jpg")["Content-Disposition"]).toBe("inline");
  });
});
