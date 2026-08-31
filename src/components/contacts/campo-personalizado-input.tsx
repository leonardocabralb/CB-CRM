'use client';

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

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TIPO_DATA,
  paraEntradaLocal,
  deEntradaLocal,
} from '@/lib/contacts/campo-data';
// ⚠️ `opcoesDoCampo` MORAVA aqui e foi para a lib pura: a serialização da
// API v1 também a usa, e importar de um arquivo "use client" dentro de um
// route handler vira client-reference proxy que lança em runtime (achado
// da revisão de 2026-08-29, reproduzido no Next 16.2.12).
import { OPCAO_RESERVADA, opcoesDoCampo } from '@/lib/contacts/campo-opcoes';
import type { CustomField } from '@/types';

// O sentinela mora na lib junto de `opcoesDoCampo`, que filtra opção
// homônima — os dois lados da reserva num lugar só.
const LIMPAR = OPCAO_RESERVADA;

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

  if (field.field_type === 'select') {
    const opcoes = opcoesDoCampo(field);
    // Valor herdado que não está mais na lista (opção removida do catálogo)
    // continua VISÍVEL e selecionável — sumir com ele apagaria dado do
    // contato na primeira edição, sem ninguém pedir.
    const foraDaLista = value.trim() !== '' && !opcoes.includes(value);
    return (
      <Select
        value={value.trim() === '' ? null : value}
        onValueChange={(v) =>
          onChange(v == null || v === LIMPAR ? '' : String(v))
        }
        disabled={disabled}
      >
        <SelectTrigger className="bg-muted w-full">
          <SelectValue placeholder={placeholder ?? '—'} />
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

  if (field.field_type === 'number') {
    // ⚠️ O mesmo cuidado do `foraDaLista` do select, para número: o banco é
    // TEXT e automação grava texto livre por desenho (948) — e um
    // `<input type="number" value="R$ 300">` renderiza VAZIO, porque o
    // navegador recusa valor fora da forma numérica do HTML. O operador via
    // "sem valor" sobre dado real e o Salvar o sobrescrevia. Valor que o
    // input numérico não consegue EXIBIR cai no input de texto: continua
    // visível e editável.
    // ⚠️ O regex roda no valor CRU, não no trim: o input recebe o cru, e
    // " 300 " (espaço colado por automação) passava na checagem aparada e
    // ainda renderizava vazio — o mesmo bug voltando pela borda. Só o
    // whitespace-puro conta como vazio (não há dado a esconder).
    const exibivelComoNumero =
      value.trim() === '' || /^-?(\d+|\d*\.\d+)([eE][+-]?\d+)?$/.test(value);
    if (exibivelComoNumero) {
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
