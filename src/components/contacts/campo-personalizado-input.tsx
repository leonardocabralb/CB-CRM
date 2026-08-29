"use client";

// ============================================================
// O input de UM campo personalizado, tipado pelo `field_type`.
//
// Compartilhado entre a ficha completa (`contact-detail-view`) e o painel
// do inbox (`painel-do-contato`) — as duas telas editam o MESMO dado, e
// duas cópias divergiriam no primeiro tipo novo. O valor entra e sai como
// STRING sempre (o banco guarda TEXT para todos os tipos, de propósito —
// migration 948): número e opção são convenção de renderização, não de
// armazenamento.
// ============================================================

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TIPO_DATA,
  paraEntradaLocal,
  deEntradaLocal,
} from "@/lib/contacts/campo-data";
import type { CustomField } from "@/types";

/**
 * As opções de um campo `select`, lidas de `field_options` (JSONB).
 * Formato: `{ "opcoes": ["A", "B"] }`. Tolerante a lixo — a coluna existe
 * desde a 001 sem nunca ter sido validada, então qualquer forma inesperada
 * degrada para lista vazia em vez de quebrar a ficha.
 */
export function opcoesDoCampo(field: CustomField): string[] {
  const raw = field.field_options?.opcoes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((o): o is string => typeof o === "string" && o.trim() !== "");
}

const LIMPAR = "__limpar__";

export function CampoPersonalizadoInput({
  field,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  field: CustomField;
  value: string;
  onChange: (v: string) => void;
  /** Texto do estado vazio (a tela dona traduz; aqui não há i18n). */
  placeholder?: string;
  disabled?: boolean;
}) {
  if (field.field_type === TIPO_DATA) {
    // ⚠️ SEMPRE pelas conversões de `campo-data`: o valor no banco é ISO-UTC
    // e o input fala hora local — gravar cru faria o lembrete da 935 errar
    // por 3 horas, em silêncio.
    return (
      <Input
        type="datetime-local"
        value={paraEntradaLocal(value)}
        onChange={(e) => onChange(deEntradaLocal(e.target.value))}
        disabled={disabled}
      />
    );
  }

  if (field.field_type === "select") {
    const opcoes = opcoesDoCampo(field);
    // Valor herdado que não está mais na lista (opção removida do catálogo)
    // continua VISÍVEL e selecionável — sumir com ele apagaria dado do
    // contato na primeira edição, sem ninguém pedir.
    const foraDaLista = value.trim() !== "" && !opcoes.includes(value);
    return (
      <Select
        value={value.trim() === "" ? null : value}
        onValueChange={(v) =>
          onChange(v == null || v === LIMPAR ? "" : String(v))
        }
        disabled={disabled}
      >
        <SelectTrigger className="bg-muted w-full">
          <SelectValue placeholder={placeholder ?? "—"} />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {/* Limpar é opção explícita — sem ela, escolher errado seria
              permanente: o Select não tem "des-selecionar" nativo. */}
          <SelectItem value={LIMPAR}>—</SelectItem>
          {foraDaLista && <SelectItem value={value}>{value}</SelectItem>}
          {opcoes.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.field_type === "number") {
    return (
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}
