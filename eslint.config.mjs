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
    // A saída de build local se chama .next.nosync (para o iCloud não
    // sincronizar node_modules/build — ver docs), então o ignore de .next
    // acima não a cobre: eram ~1.500 arquivos gerados/minificados no lint.
    ".next.nosync/**",
    // Worktrees temporárias criadas por agentes (cópias do repo inteiro).
    ".claude/**",
  ]),
]);

export default eslintConfig;
