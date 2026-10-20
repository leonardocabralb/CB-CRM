import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Inter } from "next/font/google";
import Script from "next/script";
import { connection } from "next/server";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import { MarcaProvider } from "@/components/marca/marca-provider";
import { obterMarca } from "@/lib/marca-servidor";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// ⚠️⚠️ A MARCA é dado da instalação (`cb_marca`, editada em Configurações →
// Marca), lida por `obterMarca()` A CADA PEDIDO — e por isso o
// `await connection()` antes de lê-la, aqui e no layout abaixo. Sem ele o
// Next pode prerenderizar a página no `next build`, e no CI não há service
// role: a leitura cairia no padrão e o padrão ficaria ASSADO no HTML para
// sempre, com a marca própria gravada no banco e ignorada.
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const marca = await obterMarca();
  return {
    // Nome e descrição saem da marca, nunca de literal: o produto é
    // instalado por outras pessoas, e um nome escrito no código faria a
    // instalação delas se apresentar com o nome de outro escritório.
    title: {
      default: marca.nome,
      template: `%s — ${marca.nome}`,
    },
    description: `Gestão de atendimento no WhatsApp — ${marca.nome}.`,
    robots: {
      index: false,
      follow: false,
    },
    // ⚠️ SEM `icons` aqui. O Next só injeta os ícones de ARQUIVO — o
    // `icon.tsx` (a aba do navegador) e o `apple-icon.tsx` (o do app instalado
    // no celular) — quando o metadata não declara `icons`. Com a declaração
    // que vinha do upstream, o `<head>` saía sem nenhum `apple-touch-icon` e o
    // iPhone improvisava o ícone (medido em 14/09/2026, Next 16.2). Há pino em
    // `manifest.test.ts`.
    // App instalado na Tela de Início do celular: o nome que o iPhone sugere
    // embaixo do ícone (o nome CURTO: ele corta nome comprido). O resto
    // (escopo, tela de abertura, ícones) mora em `manifest.ts`, e o ícone em
    // `apple-icon.tsx`.
    appleWebApp: {
      capable: true,
      title: marca.nomeCurto,
    },
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `connection()` ANTES da marca: ver o comentário de `generateMetadata`.
  await connection();
  const [locale, messages, marca] = await Promise.all([
    getLocale(),
    getMessages(),
    obterMarca(),
  ]);

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${inter.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          {/* A marca já resolvida desce para o navegador (`useMarca()`):
              ele nunca lê `cb_marca`, fechada a anon e a authenticated — e a
              tela de login precisa dela antes de haver sessão. */}
          <MarcaProvider marca={marca}>
            <ThemeProvider>
              {children}
              <ThemedToaster />
            </ThemeProvider>
          </MarcaProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
