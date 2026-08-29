"use client";

import { Check, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Input inline com ✓/✕ — o padrão de edição das fichas do inbox.
 *
 * Nasceu no painel de grupo (apelido e nome no WhatsApp) e foi extraído na
 * Fase 2 para o nome do contato usar o MESMO componente — duas cópias
 * divergiriam no primeiro ajuste de comportamento (Enter, Escape, disabled).
 */
export function LinhaDeEdicao({
  valor,
  onChange,
  placeholder,
  salvando,
  onSalvar,
  onCancelar,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
  salvando: boolean;
  onSalvar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter salva e Escape cancela — sem isso a edição inline obriga a
          // mirar em botões de 32px para qualquer coisa.
          if (e.key === "Enter") {
            e.preventDefault();
            if (!salvando) onSalvar();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancelar();
          }
        }}
        placeholder={placeholder}
        className="h-8 text-sm"
        autoFocus
      />
      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={salvando} onClick={onSalvar}>
        <Check className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCancelar}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
