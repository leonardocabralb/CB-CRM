'use client';

// ============================================================
// A faixa "HÁ UMA FICHA DESTA PESSOA NA LIXEIRA" (1101, a Fase 4 da Lixeira).
//
// O cliente cuja ficha foi para a Lixeira volta a escrever: a ingestão abre
// uma ficha nova com o mesmo número, e restaurar a antiga é bloqueado (B2 —
// a identidade já é da nova). A faixa avisa quem ABRE a ficha nova (na
// conversa e no formulário do card, os lugares do aviso de duplicata) e
// oferece "Restaurar e unir".
//
// Só informa: cala com `itens` nulo (carregando, falhou, quem não é admin)
// ou vazio — nunca afirma "nada na Lixeira".
//
// ⚠️ Cores: o `dark:` está INERTE (`.claude/rules/ui.md`). O texto é
// `text-foreground`; o âmbar fica na borda, no fundo e no ícone — classes
// LITERAIS, como na faixa de possível duplicata.
// ============================================================

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { nomeDoContato } from '@/lib/contacts/identidade';
import { contatoDoItemDaMesmaPessoa, type ItemDaMesmaPessoa } from '@/lib/contacts/restaurar-e-unir';
import { cn } from '@/lib/utils';

import { identidadeLegivel } from '../faixa-de-possivel-duplicata';
import { quandoLegivel } from './item-da-lixeira';

export function FaixaDeFichaNaLixeira({
  itens,
  aoRestaurarEUnir,
  className,
}: {
  itens: ItemDaMesmaPessoa[] | null;
  aoRestaurarEUnir: (item: ItemDaMesmaPessoa) => void;
  /** As margens de quem monta (no fio, `mx-3 mt-2`; no formulário, `mt-1`). */
  className?: string;
}) {
  const t = useTranslations('Contacts.lixeira');
  if (!itens || itens.length === 0) return null;

  return (
    <div
      role="status"
      data-faixa="ficha-na-lixeira"
      className={cn(
        'flex max-w-full items-start gap-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-foreground',
        className,
      )}
    >
      <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('mesmaPessoa.titulo', { count: itens.length })}</p>
        <ul className="mt-1 space-y-1.5">
          {itens.map((item) => {
            const contato = contatoDoItemDaMesmaPessoa(item);
            const identidade = identidadeLegivel(contato);
            const quando = quandoLegivel(item.movidaEm);
            return (
              <li key={item.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words">
                    <span className="font-medium">{nomeDoContato(contato, t('semNome'))}</span>
                    {item.nome && identidade && <span className="text-muted-foreground"> · {identidade}</span>}
                  </p>
                  <p className="break-words text-muted-foreground">
                    {item.movidaPorNome
                      ? t('mesmaPessoa.movidaPor', { quando, quem: item.movidaPorNome, count: item.mensagens })
                      : t('mesmaPessoa.movidaEm', { quando, count: item.mensagens })}
                  </p>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="shrink-0 bg-background"
                  onClick={() => aoRestaurarEUnir(item)}
                >
                  {t('mesmaPessoa.restaurarEUnir')}
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-muted-foreground">
          {t('mesmaPessoa.dica')}{' '}
          <Link href="/contacts/lixeira" className="font-medium text-foreground underline underline-offset-2">
            {t('mesmaPessoa.verNaLixeira')}
          </Link>
        </p>
      </div>
    </div>
  );
}
