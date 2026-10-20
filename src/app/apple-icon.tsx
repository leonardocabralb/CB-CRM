import { ImageResponse } from "next/og";

import { TAMANHOS_DO_ICONE } from "@/lib/marca";
import { simboloComoDataUrl, tracoSobre } from "@/lib/marca-icone";
import { obterMarca } from "@/lib/marca-servidor";

// ============================================================
// Ícone do app INSTALADO na Tela de Início. O iPhone lê o
// `apple-touch-icon` (180); o `manifest.ts` aponta os mesmos arquivos
// para o Android (192 e 512).
//
// É o símbolo da marca (o mesmo do `icon.tsx`, a aba do navegador), com
// duas diferenças de propósito:
// - fundo até a borda na COR DO ÍCONE da marca, SEM canto arredondado e
//   sem nada transparente: o iPhone arredonda o canto sozinho e pinta de
//   preto o que é transparente — um canto já arredondado sairia com borda
//   escura;
// - o símbolo ocupa metade do quadrado, dentro do círculo central que o
//   Android preserva quando recorta o ícone no formato do aparelho.
//
// ⚠️ DINÂMICO (`force-dynamic`), pelo mesmo motivo do `icon.tsx`: a marca
// é dado do banco, e gerado no `next build` (sem service role) o ícone
// ficaria com o padrão para sempre. O `manifest.ts` aponta para cá com
// `?v=<versão da marca>`, para o navegador não reaproveitar o antigo.
//
// ⚠️ O iPhone guarda o ícone NO MOMENTO da instalação: trocar a marca não
// muda o ícone de quem já instalou — é preciso apagar e adicionar de novo.
// ============================================================

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function generateImageMetadata() {
  return TAMANHOS_DO_ICONE.map((lado) => ({
    id: String(lado),
    size: { width: lado, height: lado },
    contentType: "image/png",
  }));
}

export default async function AppleIcon({
  id,
}: {
  id: Promise<string | number>;
}) {
  const lado = Number(await id);
  const metade = Math.round(lado / 2);
  const marca = await obterMarca();
  // Sem símbolo legível, o balão genérico no lugar dele: nunca ícone quebrado.
  const simbolo = await simboloComoDataUrl(marca.simbolo);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: marca.corDoIcone,
        }}
      >
        {simbolo ? (
          <img
            src={simbolo}
            alt=""
            width={metade}
            height={metade}
            style={{ objectFit: "contain" }}
          />
        ) : (
          <svg
            width={metade}
            height={metade}
            viewBox="0 0 24 24"
            fill="none"
            stroke={tracoSobre(marca.corDoIcone)}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </div>
    ),
    { width: lado, height: lado },
  );
}
