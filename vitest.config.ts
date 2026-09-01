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
    // `.github/**` entrou pelos pinos do portão do deploy: o `pipeline.yml`
    // publica em produção e seus dois modos de falha são invisíveis para
    // qualquer teste de código — só ler o YAML os alcança.
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/**/*.test.ts",
      ".github/**/*.test.ts",
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
