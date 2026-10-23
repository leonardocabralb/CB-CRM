import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
    // Saída de build do arranjo do iCloud (o `.next` como atalho para
    // `.next.nosync`, ver o `.gitignore`): o ignore de .next acima não a
    // cobre, e eram ~1.500 arquivos gerados/minificados no lint.
    ".next.nosync/**",
    // Worktrees temporárias criadas por agentes (cópias do repo inteiro).
    ".claude/**",
  ]),
]);

export default eslintConfig;
