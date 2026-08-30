'use client';

// ============================================================
// Seletor de contato PESQUISÁVEL (pedido do operador, 2026-08-30).
//
// O Select comum vira um menu de 100+ itens sem busca — aqui é um
// combobox-lite: gatilho com a cara do SelectTrigger, popover com campo de
// busca (nome OU telefone, via `filtrarContatos`) e a lista recortada.
// Enter escolhe o primeiro resultado; clique escolhe qualquer um.
//
// Textos chegam por PROPS (como o `CampoPersonalizadoInput`): o componente
// não conhece i18n, a tela dona traduz.
// ============================================================

import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  filtrarContatos,
  type ContatoPesquisavel,
} from '@/lib/contacts/filtrar-contatos';
import { cn } from '@/lib/utils';

export interface ContatoDoSeletor extends ContatoPesquisavel {
  id: string;
}

export function SeletorDeContato({
  contatos,
  value,
  onChange,
  disabled = false,
  placeholder,
  searchPlaceholder,
  emptyText,
  loadingText,
  ariaLabel,
}: {
  /** `null` = catálogo ainda carregando (gatilho desabilitado com aviso). */
  contatos: ContatoDoSeletor[] | null;
  /** Id do contato escolhido; `''` = nenhum. */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  loadingText: string;
  ariaLabel?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');

  const carregando = contatos === null;
  const escolhido = useMemo(
    () => contatos?.find((c) => c.id === value) ?? null,
    [contatos, value]
  );
  const filtrados = useMemo(
    () => filtrarContatos(contatos ?? [], termo),
    [contatos, termo]
  );

  const escolher = (id: string) => {
    onChange(id);
    setAberto(false);
  };

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        // A busca nasce limpa a cada abertura — reabrir com o recorte
        // anterior esconderia a lista sem dizer por quê.
        if (o) setTermo('');
      }}
    >
      {/* A cara do SelectTrigger (borda, altura, chevron), largura cheia. */}
      <PopoverTrigger
        disabled={disabled || carregando}
        aria-label={ariaLabel}
        className={cn(
          'border-input focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border bg-transparent py-2 pr-2 pl-2.5 text-sm transition-colors outline-none select-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <span className={cn('truncate', !escolhido && 'text-muted-foreground')}>
          {carregando
            ? loadingText
            : escolhido
              ? escolhido.name || escolhido.phone
              : placeholder}
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 gap-1.5 p-2">
        <Input
          autoFocus
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8"
          onKeyDown={(e) => {
            // Enter pega o PRIMEIRO resultado — digitou o suficiente para
            // sobrar um, não precisa alcançar o mouse. (O popover é portal:
            // o Enter nem chegaria ao form do diálogo, mas o preventDefault
            // deixa isso explícito.)
            if (e.key === 'Enter') {
              e.preventDefault();
              const primeiro = filtrados[0];
              if (primeiro) escolher(primeiro.id);
            }
          }}
        />
        <div className="-mx-1 max-h-56 overflow-y-auto px-1">
          {filtrados.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">
              {emptyText}
            </p>
          ) : (
            filtrados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => escolher(c.id)}
                className={cn(
                  'hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  c.id === value && 'bg-accent/50'
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {c.name || c.phone}
                </span>
                {/* O telefone sempre à vista: é ele que confirma "achei o
                    cliente certo" quando a busca foi por número. */}
                {c.name ? (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {c.phone}
                  </span>
                ) : null}
                {c.id === value ? (
                  <Check className="text-primary size-3.5 shrink-0" />
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
