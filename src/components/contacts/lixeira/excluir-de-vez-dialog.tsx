'use client';

// ============================================================
// "Excluir agora" (B3) — tira uma ficha da Lixeira de vez, antes dos 90 dias.
//
// ⚠️ Confirmação FORTE: digitar a palavra, porque não há volta (a fotografia
// sai e os arquivos vão para a fila de apagar). A caixa "pedido de exclusão
// do titular (LGPD)" apaga também o que ficou FORA da ficha, e a tela diz o
// quê. ⚠️ Nunca afirmar eliminação total: cópias de segurança, a Evolution e
// o que terceiros já receberam ficam fora do alcance do CRM, e o texto diz
// isso com ou sem a caixa.
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { excluirDeVez } from '@/hooks/use-lixeira';

import { textoDoMotivo } from './textos-da-lixeira';

export function ExcluirDeVezDialog({
  item,
  nome,
  aoFechar,
  aoExcluir,
}: {
  /** O item da Lixeira; NULO = fechado. */
  item: { id: string } | null;
  nome: string;
  aoFechar: () => void;
  /** Depois da resposta do banco (excluída, sumida ou recusada): a lista relê. */
  aoExcluir: () => void;
}) {
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(abrir) => {
        if (!abrir) aoFechar();
      }}
    >
      <DialogContent className="max-h-[calc(var(--altura-visivel,100dvh)-2rem)] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-lg">
        {/* Um formulário novo a cada item: a palavra digitada e a caixa da
            LGPD nunca passam de uma ficha para outra. */}
        {item && (
          <Formulario
            key={item.id}
            itemId={item.id}
            nome={nome}
            aoFechar={aoFechar}
            aoExcluir={aoExcluir}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  itemId,
  nome,
  aoFechar,
  aoExcluir,
}: {
  itemId: string;
  nome: string;
  aoFechar: () => void;
  aoExcluir: () => void;
}) {
  const t = useTranslations('Contacts.lixeira');
  const [digitado, setDigitado] = useState('');
  const [pedido, setPedido] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const palavra = t('excluir.palavra');
  const confere = digitado.trim().toLocaleUpperCase() === palavra.toLocaleUpperCase();

  async function confirmar() {
    setExcluindo(true);
    const r = await excluirDeVez([itemId], pedido);
    setExcluindo(false);
    const desfecho = r.ok ? r.itens.find((i) => i.itemId === itemId) : undefined;
    if (!r.ok) {
      toast.error(t('excluir.toastFalhou'), { description: textoDoMotivo(t, r.motivo) });
    } else if (desfecho?.resultado === 'excluida') {
      toast.success(pedido ? t('excluir.toastExcluidaPedido') : t('excluir.toastExcluida'), {
        description:
          desfecho.arquivos > 0 ? t('excluir.toastArquivos', { count: desfecho.arquivos }) : undefined,
      });
    } else if (desfecho?.resultado === 'sumiu') {
      toast.info(t('excluir.toastSumiu'));
    } else {
      // Recusada (outra pessoa mexendo nela) ou resposta sem este item.
      toast.error(t('excluir.toastFalhou'), {
        description: textoDoMotivo(t, desfecho?.motivo ?? 'falhou'),
      });
    }
    aoExcluir();
    aoFechar();
  }

  return (
    <>
      <DialogHeader className="min-w-0">
        <DialogTitle className="text-popover-foreground">{t('excluir.titulo')}</DialogTitle>
        <DialogDescription className="break-words text-muted-foreground">
          {t('excluir.texto', { nome })}
        </DialogDescription>
      </DialogHeader>

      <div className="min-w-0 space-y-3 text-sm">
        <p className="text-muted-foreground">{t('excluir.negociosFicam')}</p>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
          <Checkbox
            checked={pedido}
            onCheckedChange={(v) => setPedido(v === true)}
            className="mt-0.5"
          />
          <span className="min-w-0 space-y-1">
            <span className="block font-medium text-foreground">{t('excluir.pedidoRotulo')}</span>
            <span className="block text-muted-foreground">{t('excluir.pedidoTexto')}</span>
          </span>
        </label>

        <p className="rounded-md border border-amber-600/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
          {t('excluir.foraDoAlcance')}
        </p>

        <div className="space-y-1.5">
          <label htmlFor="lixeira-confirmar-palavra" className="block text-muted-foreground">
            {t('excluir.digite', { palavra })}
          </label>
          <Input
            id="lixeira-confirmar-palavra"
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="bg-card border-border text-foreground"
          />
        </div>
      </div>

      <DialogFooter className="bg-popover border-border">
        <Button
          variant="outline"
          onClick={aoFechar}
          disabled={excluindo}
          className="border-border text-muted-foreground hover:bg-muted"
        >
          {t('cancelar')}
        </Button>
        <Button
          variant="destructive"
          onClick={() => void confirmar()}
          disabled={!confere || excluindo}
        >
          {excluindo ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          {t('excluir.confirmar')}
        </Button>
      </DialogFooter>
    </>
  );
}
