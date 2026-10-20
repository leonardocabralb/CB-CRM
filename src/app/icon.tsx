import { ImageResponse } from "next/og";

import { obterMarca } from "@/lib/marca-servidor";
import { simboloComoDataUrl, tracoSobre } from "@/lib/marca-icone";

// ============================================================
// Ícone da ABA do navegador: o símbolo da marca da instalação, inteiro
// dentro de 32×32, sem fundo (a aba já tem o dela). Tem precedência sobre
// o `favicon.ico`, e o Next injeta o `<link rel="icon">` sozinho — desde
// que o `layout.tsx` NÃO declare `icons` (ver lá).
//
// ⚠️ DINÂMICO (`force-dynamic`): a marca é dado do banco, trocada pela aba
// Marca. Estático, o ícone seria gerado no `next build` — onde não há
// service role — e o padrão ficaria assado na imagem para sempre. Roda em
// Node: o símbolo padrão é lido do disco (`public/`).
//
// Sem símbolo, ou se ele não puder ser lido, o desenho genérico (o balão
// sobre a cor do ícone da marca): ícone feio, nunca ícone quebrado.
//
// O navegador guarda o ícone da aba por conta própria: trocada a marca, a
// aba pode precisar de um recarregar para mostrar o novo.
// ============================================================

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  const marca = await obterMarca();
  const simbolo = await simboloComoDataUrl(marca.simbolo);

  if (simbolo) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={simbolo}
            alt=""
            width={size.width}
            height={size.height}
            style={{ objectFit: "contain" }}
          />
        </div>
      ),
      { ...size },
    );
  }

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
          borderRadius: 6,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke={tracoSobre(marca.corDoIcone)}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
