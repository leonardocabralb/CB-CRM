'use client';

// ============================================================
// "RESTAURAR E UNIR" (1101) — a prévia e o botão.
//
// A ficha da Lixeira volta e é unida à ficha aberta, que FICA (o cliente
// voltou a escrever e já está nela). Sem prévia, sem botão (a regra da
// união): o banco faz a volta e a união num subbloco, lê a prévia da união
// e desfaz tudo — e a tela mostra o MESMO corpo da revisão da união
// (`CorpoDaPrevia`), sem o "Trocar", mais o que a volta traz com ressalva.
//
// Sem desfazer, como a união. Recusa (bloqueio da união, identidade de uma
// terceira ficha, trava) não muda nada: a ficha continua na Lixeira.
// ============================================================

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { restaurarEUnir, usePreviaDoRestaurarEUnir } from '@/hooks/use-lixeira-da-mesma-pessoa';
import type { ItemDaMesmaPessoa, RecusaDoRestaurarEUnir } from '@/lib/contacts/restaurar-e-unir';
import type { ResultadoDaUniao } from '@/lib/contacts/uniao';

import { CorpoDaPrevia } from '../revisao-da-uniao';
import { textoDaRecusaDoRestaurarEUnir, textosDasRessalvas, type TradutorDaLixeira } from './textos-da-lixeira';

/** A recusa SABIDA não mudou nada (o banco desfez a transação inteira). A
 *  resposta que não se leu (`falhou`), o tempo esgotado (`demorou`) e o item
 *  que já saiu da Lixeira (`sumiu`) não permitem afirmar isso. */
function afirmaQueNadaMudou(motivo: RecusaDoRestaurarEUnir['motivo']): boolean {
  return motivo !== 'falhou' && motivo !== 'demorou' && motivo !== 'sumiu';
}

function TextoDaRecusa({ t, recusa }: { t: TradutorDaLixeira; recusa: RecusaDoRestaurarEUnir }) {
  return (
    <div className="min-w-0 space-y-1 text-sm text-red-600">
      <p className="break-words">{textoDaRecusaDoRestaurarEUnir(t, recusa.motivo)}</p>
      {recusa.motivo === 'identidade_ocupada' && recusa.ocupadaPorNome && (
        <p className="break-words">{t('volta.ocupadaPor', { nomes: recusa.ocupadaPorNome })}</p>
      )}
      {afirmaQueNadaMudou(recusa.motivo) && <p className="text-muted-foreground">{t('mesmaPessoa.nadaMudou')}</p>}
    </div>
  );
}

export function RestaurarEUnirDialog({
  item,
  fichaQueFica,
  aoFechar,
  aoUnir,
}: {
  /** O item da Lixeira escolhido na faixa; nulo = diálogo fechado. */
  item: ItemDaMesmaPessoa | null;
  /** A ficha aberta: é ela que fica. */
  fichaQueFica: string;
  aoFechar: () => void;
  aoUnir: (resultado: ResultadoDaUniao) => void;
}) {
  const t = useTranslations('Contacts.lixeira');
  const tUniao = useTranslations('Duplicatas.uniao');
  const tDuplicatas = useTranslations('Duplicatas');
  const { previa, recusa, carregando, tentarDeNovo } = usePreviaDoRestaurarEUnir(
    item?.id ?? null,
    item ? fichaQueFica : null,
  );
  const [unindo, setUnindo] = useState(false);
  const [falha, setFalha] = useState<RecusaDoRestaurarEUnir | null>(null);

  const podeUnir = !carregando && !unindo && previa !== null && previa.uniao.bloqueios.length === 0;
  const ressalvas = previa ? textosDasRessalvas(t, previa.ressalvas) : [];

  async function confirmar() {
    if (!item || !podeUnir) return;
    setUnindo(true);
    setFalha(null);
    const r = await restaurarEUnir(item.id, fichaQueFica);
    if (!r.ok) {
      setUnindo(false);
      setFalha(r.recusa);
      return;
    }
    aoFechar();
    toast.success(t('mesmaPessoa.toastUnidas'));
    aoUnir(r.resultado);
  }

  return (
    <Dialog open={item !== null} onOpenChange={(aberto) => !aberto && !unindo && aoFechar()}>
      <DialogContent className="max-h-[calc(var(--altura-visivel,100dvh)-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>{t('mesmaPessoa.dialogoTitulo')}</DialogTitle>
          <DialogDescription className="break-words">{t('mesmaPessoa.dialogoDescricao')}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0">
          {carregando ? (
            <p className="text-muted-foreground">{t('mesmaPessoa.conferindo')}</p>
          ) : recusa || !previa ? (
            <TextoDaRecusa t={t} recusa={recusa ?? { motivo: 'falhou', ocupadaPor: null, ocupadaPorNome: null }} />
          ) : (
            <div className="min-w-0 space-y-4">
              <CorpoDaPrevia
                t={tUniao}
                previa={previa.uniao}
                ficaFicha={previa.fica}
                saiFicha={previa.sai}
                ficaEhSugerida={false}
                semNome={tDuplicatas('semNome')}
              />
              {ressalvas.length > 0 && (
                <section className="text-sm">
                  <h4 className="text-xs font-medium text-muted-foreground">{t('mesmaPessoa.ressalvasTitulo')}</h4>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                    {ressalvas.map((linha) => (
                      <li key={linha} className="break-words">
                        {linha}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
          {falha && (
            <div className="mt-3">
              <TextoDaRecusa t={t} recusa={falha} />
            </div>
          )}
        </div>

        <DialogFooter className="min-w-0 sm:items-center">
          <Button type="button" variant="outline" disabled={unindo} onClick={aoFechar}>
            {t('cancelar')}
          </Button>
          {!carregando && (recusa || !previa) ? (
            <Button type="button" variant="outline" onClick={tentarDeNovo}>
              {t('mover.tentarDeNovo')}
            </Button>
          ) : (
            <Button type="button" variant="destructive" disabled={!podeUnir} onClick={() => void confirmar()}>
              {unindo ? t('mesmaPessoa.unindo') : t('mesmaPessoa.confirmar')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
