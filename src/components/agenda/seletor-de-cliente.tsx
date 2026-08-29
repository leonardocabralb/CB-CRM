'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { Contact } from '@/types';

/**
 * Escolher o cliente de uma reunião (migration 945).
 *
 * ⚠️ BUSCA NO BANCO, não uma lista carregada inteira. A conta real tem 113
 * contatos hoje e cresce; um `<select>` com todos seria ilegível, e carregar
 * tudo para filtrar no cliente esbarra no teto de 1000 linhas do PostgREST
 * sem avisar — a mesma armadilha que a busca do inbox documenta.
 *
 * ⚠️ Casa por nome **e** por telefone. Metade dos contatos desta conta não tem
 * nome (chegaram pelo WhatsApp e ficaram só com o número), e procurar por
 * nome ali não acha nada.
 */

interface Props {
  /** Id do contato escolhido, ou `null`. */
  valor: string | null;
  /** Nome já conhecido — evita uma busca só para exibir o que já se sabe. */
  nomeAtual?: string | null;
  aoEscolher: (contato: Contact | null) => void;
  /** Trava o campo: a reunião nasceu da ficha do cliente, o vínculo é fixo. */
  travado?: boolean;
}

const LIMITE = 8;

export function SeletorDeCliente({ valor, nomeAtual, aoEscolher, travado }: Props) {
  const t = useTranslations('Agenda');
  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<Contact[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora — sem isto a lista fica aberta sobre o resto do
  // formulário depois de escolher.
  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2) {
      // Mesmo padrão do `use-conversation-notes`: a regra aponta o `setState`
      // de dentro do efeito, não a linha do `useEffect`.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAchados([]);
      return;
    }

    // Espera a digitação parar: sem isto cada tecla vira uma consulta, e as
    // respostas voltam fora de ordem.
    let vivo = true;
    const timer = setTimeout(async () => {
      setBuscando(true);
      const supabase = createClient();
      const escapado = limpo.replace(/[%_]/g, (c) => `\\${c}`);
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .or(`name.ilike.%${escapado}%,phone.ilike.%${escapado}%`)
        .order('name', { nullsFirst: false })
        .limit(LIMITE);

      if (!vivo) return;
      setAchados((data ?? []) as Contact[]);
      setBuscando(false);
    }, 250);

    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [termo]);

  /**
   * ⚠️ Busca o nome quando só o id foi informado.
   *
   * É o caso de abrir o formulário pela ficha do cliente, que passa só o
   * `contactId`. Sem isto o componente caía na caixa de busca vazia e a tela
   * dizia que não havia cliente vinculado — enquanto o vínculo ia no corpo e
   * era gravado.
   */
  const [nomeBuscado, setNomeBuscado] = useState<string | null>(null);

  useEffect(() => {
    if (!valor || nomeAtual) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNomeBuscado(null);
      return;
    }
    let vivo = true;
    void createClient()
      .from('contacts')
      .select('name, phone')
      .eq('id', valor)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo && data) {
          setNomeBuscado((data.name as string | null) || (data.phone as string));
        }
      });
    return () => {
      vivo = false;
    };
  }, [valor, nomeAtual]);

  const nomeExibido = nomeAtual ?? nomeBuscado;

  // Já escolhido: mostra quem é, com o botão de desfazer.
  if (valor && nomeExibido) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <span className="truncate text-sm">{nomeExibido}</span>
        {!travado && (
          <button
            type="button"
            onClick={() => aoEscolher(null)}
            aria-label={t('desvincularCliente')}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={caixa} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          placeholder={t('buscarCliente')}
          className="pl-8"
        />
      </div>

      {aberto && termo.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {buscando && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {t('carregando')}
            </p>
          )}

          {!buscando && achados.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {t('nenhumClienteEncontrado')}
            </p>
          )}

          {achados.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                aoEscolher(c);
                setTermo('');
                setAberto(false);
              }}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left',
                'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
              )}
            >
              <span className="text-sm">{c.name || c.phone}</span>
              {c.name && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {c.phone}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
