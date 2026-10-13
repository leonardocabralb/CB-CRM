import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../next.config";

// As exceções NOSSAS à regra `private, no-store` do #626 do original. Em
// arquivo próprio para o `next-config.test.ts` continuar igual ao do original
// (um merge futuro o traz sem conflito).

async function cacheControlFor(pathname: string) {
  const rules = (await nextConfig.headers?.()) ?? [];
  const values = rules
    .filter((rule) => getPathMatch(rule.source, { strict: true })(pathname))
    .flatMap((rule) => rule.headers)
    .filter((header) => header.key.toLowerCase() === "cache-control")
    .map((header) => header.value);
  return values.at(-1);
}

describe("Cache-Control — arquivos de public/ usados a toda hora", () => {
  // O codificador da nota de voz e o fundo do fio: com no-store o navegador
  // os baixaria de novo a cada gravação e a cada conversa aberta. Sem
  // cabeçalho nosso, vale o `public, max-age=0` do Next, revalidado por ETag.
  it.each(["/opus/encoderWorker.min.js", "/inbox-doodle.svg"])(
    "deixa %s com o cache do próprio Next",
    async (pathname) => {
      expect(await cacheControlFor(pathname)).toBeUndefined();
    },
  );

  // A exclusão é só desses dois: uma tela que COMEÇA com o mesmo texto
  // continua fora de cache compartilhado.
  it.each(["/opus", "/inbox-doodle"])("mantém %s privado", async (pathname) => {
    expect(await cacheControlFor(pathname)).toBe("private, no-store");
  });
});
