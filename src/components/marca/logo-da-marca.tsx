"use client";

import { MessageSquare } from "lucide-react";

import { logoPara, type Marca } from "@/lib/marca";
import { cn } from "@/lib/utils";

import { useMarca } from "./marca-provider";

// ============================================================
// O logo da instalação, no fundo certo.
//
// ⚠️ O modo claro/escuro é do APP (`html[data-mode]`, gravado pelo
// `theme-boot` antes da hidratação), não do sistema operacional — e o
// variant `dark:` do Tailwind está inerte aqui (pede `.dark`). Por isso as
// DUAS versões vão no HTML e o CSS esconde a do outro modo
// (`.marca-so-no-escuro` / `.marca-so-no-claro`, no `globals.css`): ler o
// modo num hook trocaria a imagem só depois da hidratação, com um quadro do
// logo errado.
//
// `fundo` FORÇA um lado (as prévias da aba Marca mostram os dois ao mesmo
// tempo, cada um sobre o seu fundo). `marca` troca a fonte (a prévia
// desenha o RASCUNHO, ainda não gravado).
// ============================================================

type Fundo = "escuro" | "claro";

const CLASSE_DO_FUNDO: Record<Fundo, string> = {
  escuro: "marca-so-no-escuro",
  claro: "marca-so-no-claro",
};

/** Cor do nome em texto quando o fundo é forçado (a prévia não segue o modo). */
const COR_DO_NOME: Record<Fundo, string> = {
  escuro: "text-white",
  claro: "text-slate-900",
};

export function LogoDaMarca({
  forma,
  className,
  fundo,
  marca: marcaDada,
}: {
  forma: "horizontal" | "vertical";
  /** Tamanho da IMAGEM (ex.: `h-7 w-auto max-w-44`). */
  className?: string;
  fundo?: Fundo;
  marca?: Marca;
}) {
  const daInstalacao = useMarca();
  const marca = marcaDada ?? daInstalacao;
  const fundos: Fundo[] = fundo ? [fundo] : ["escuro", "claro"];

  return (
    <>
      {fundos.map((f) => {
        const visibilidade = fundo ? undefined : CLASSE_DO_FUNDO[f];
        const url = logoPara(marca, forma, f);
        if (url) {
          return (
            // Imagem vinda de configuração (Storage ou `public/marca/`):
            // `next/image` exigiria dimensões fixas e uma allow-list de origem
            // para um arquivo que cada instalação escolhe.
            // eslint-disable-next-line @next/next/no-img-element -- ver acima.
            <img
              key={f}
              src={url}
              alt={marca.nome}
              className={cn("object-contain", visibilidade, className)}
            />
          );
        }
        return (
          <SimboloENome
            key={f}
            marca={marca}
            forma={forma}
            className={visibilidade}
            corDoNome={fundo ? COR_DO_NOME[fundo] : "text-foreground"}
          />
        );
      })}
    </>
  );
}

/**
 * A marca sem logo para este fundo: o símbolo (ou o genérico, se nem ele
 * existe) com o nome em texto — o desenho que a barra lateral sempre teve.
 *
 * ⚠️ `max-w-full` no nome (e na caixa): na forma vertical ele é item de uma
 * coluna `items-center`, que o dimensiona pelo conteúdo — sem teto, o
 * `truncate` não corta nada e o nome comprido (até 60 caracteres) alarga
 * quem o contém. Quem põe o logo num item de grade ou de flex (o
 * `CardHeader` das telas de entrada) dá `min-w-0` a esse item (raiz, 8c).
 */
function SimboloENome({
  marca,
  forma,
  className,
  corDoNome,
}: {
  marca: Marca;
  forma: "horizontal" | "vertical";
  className?: string;
  corDoNome: string;
}) {
  const vertical = forma === "vertical";
  return (
    <span
      className={cn(
        "flex min-w-0 max-w-full items-center",
        vertical ? "flex-col gap-2 text-center" : "gap-2",
        className,
      )}
    >
      <SimboloDaMarca
        marca={marca}
        className={vertical ? "h-12 w-12" : "h-8 w-8"}
      />
      <span
        className={cn(
          "max-w-full truncate font-semibold",
          vertical ? "text-lg" : "text-sm",
          corDoNome,
        )}
      >
        {marca.nome}
      </span>
    </span>
  );
}

/** Só o símbolo; sem ele, o quadrado com o balão (o genérico de sempre). */
export function SimboloDaMarca({
  className,
  marca: marcaDada,
}: {
  className?: string;
  marca?: Marca;
}) {
  const daInstalacao = useMarca();
  const marca = marcaDada ?? daInstalacao;
  if (marca.simbolo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ver acima.
      <img
        src={marca.simbolo}
        alt=""
        className={cn("shrink-0 object-contain", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className,
      )}
    >
      <MessageSquare className="h-1/2 w-1/2" />
    </span>
  );
}
