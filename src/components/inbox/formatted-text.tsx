// ============================================================
// Texto do WhatsApp com a formatação aplicada.
//
// Renderiza a árvore de `parseWhatsAppFormat` como nós React. O texto vem
// de fora (cliente, automação, integração), então NUNCA passa por
// `dangerouslySetInnerHTML` — montando elementos, não existe caminho para
// injeção, mesmo que a mensagem contenha HTML.
// ============================================================

import { Fragment } from "react";

import { parseWhatsAppFormat, type NoFormatado } from "@/lib/inbox/whatsapp-format";
import { cn } from "@/lib/utils";

function renderizar(nos: NoFormatado[], chave = ""): React.ReactNode {
  return nos.map((no, i) => {
    const k = `${chave}.${i}`;
    switch (no.tipo) {
      case "texto":
        return <Fragment key={k}>{no.texto}</Fragment>;
      case "negrito":
        return <strong key={k}>{renderizar(no.filhos, k)}</strong>;
      case "italico":
        return <em key={k}>{renderizar(no.filhos, k)}</em>;
      case "riscado":
        return <s key={k}>{renderizar(no.filhos, k)}</s>;
      case "mono":
        return (
          <code
            key={k}
            className="rounded bg-black/10 px-1 py-px font-mono text-[0.9em] dark:bg-white/10"
          >
            {no.texto}
          </code>
        );
    }
  });
}

export function FormattedText({
  texto,
  className,
}: {
  texto: string | null | undefined;
  className?: string;
}) {
  if (!texto) return null;
  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm", className)}>
      {renderizar(parseWhatsAppFormat(texto))}
    </p>
  );
}
