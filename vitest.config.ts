import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // `scripts/**` entra porque os checadores de i18n são PORTÃO do CI e
    // ganharam testes próprios (F6 do plano 31/08) — teste de portão que
    // não roda é portão sem prova.
    // `supabase/**` entrou pelo pino das policies de escrita (M17): o
    // replay das migrations é SINAL, não portão, então a garantia com
    // dentes tem de rodar aqui dentro de `verificar`.
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/**/*.test.ts",
      "supabase/**/*.test.ts",
    ],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
  },
});
