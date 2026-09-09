'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Link2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useReunioesTranscritasDoContato } from '@/hooks/use-reunioes-transcritas';
import { FUSO_PADRAO, diaNoFuso, horaNoFuso } from '@/lib/agenda/fuso';
import { hasMinRole } from '@/lib/auth/roles';
import { formatarDuracao } from '@/lib/tldv/texto';
import { cn } from '@/lib/utils';
import type { ReuniaoTranscrita } from '@/types';

import { TranscricaoDialog } from './transcricao-dialog';
import { TranscricaoManualDialog } from './transcricao-manual-dialog';
import { VincularTldvDialog } from './vincular-tldv-dialog';

/**
 * O histórico de reuniões TRANSCRITAS de um cliente (987), na aba Reuniões
 * da ficha, abaixo das reuniões agendadas: o que foi dito, importado do
 * tl;dv (vínculo automático pelo e-mail, ou "Do tl;dv" aqui) ou colado à
 * mão. Clicar numa linha abre a transcrição inteira.
 */
export function ReunioesTranscritasDoContato({ contactId }: { contactId: string }) {
  const t = useTranslations('Transcricoes');
  const { user, accountRole } = useAuth();
  const { reunioes, carregando, falhou, recarregar } = useReunioesTranscritasDoContato(contactId);
  const [aberta, setAberta] = useState<string | null>(null);
  const [vincularAberto, setVincularAberto] = useState(false);
  const [manualAberto, setManualAberto] = useState(false);

  const podeEditar = accountRole ? hasMinRole(accountRole, 'agent') : false;
  const podeExcluir = (r: ReuniaoTranscrita) =>
    r.origem === 'manual' && (r.created_by === user?.id || (accountRole ? hasMinRole(accountRole, 'admin') : false));

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('titulo')}</p>
          <p className="text-xs text-muted-foreground">{t('descricao')}</p>
        </div>
        {podeEditar && (
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setVincularAberto(true)}>
              <Link2 className="size-3.5" />
              {t('doTldv')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setManualAberto(true)}>
              <Plus className="size-3.5" />
              {t('manual')}
            </Button>
          </div>
        )}
      </div>

      {carregando && <p className="text-xs text-muted-foreground">{t('carregando')}</p>}
      {!carregando && falhou && <p className="text-xs text-destructive">{t('erroCarregar')}</p>}
      {!carregando && !falhou && reunioes.length === 0 && <p className="text-xs text-muted-foreground">{t('semTranscricoes')}</p>}

      <ul className="space-y-2">
        {reunioes.map((r) => {
          const inicio = new Date(r.realizada_em);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setAberta(r.id)}
                className="flex w-full items-start gap-2.5 rounded-md border border-border p-2.5 text-left transition-colors hover:bg-muted/60"
              >
                <FileText className={cn('mt-0.5 size-4 shrink-0', r.status === 'pronta' ? 'text-primary' : 'text-muted-foreground')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.titulo}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {diaNoFuso(inicio, FUSO_PADRAO)} · {horaNoFuso(inicio, FUSO_PADRAO)} · {formatarDuracao(r.duracao_seg)}
                    {r.origem === 'manual' && r.autor_nome ? ` · ${t('porAutor', { nome: r.autor_nome })}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {r.origem === 'tldv' ? t('origemTldv') : t('origemManual')}
                  {r.status !== 'pronta' ? ` · ${t(`status.${r.status}` as Parameters<typeof t>[0])}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <TranscricaoDialog
        id={aberta}
        aberto={aberta !== null}
        aoFechar={() => setAberta(null)}
        podeEditar={podeEditar}
        podeExcluir={podeExcluir}
        aoMudar={() => void recarregar()}
      />
      {podeEditar && (
        <>
          <VincularTldvDialog contactId={contactId} aberto={vincularAberto} aoFechar={() => setVincularAberto(false)} aoVincular={() => void recarregar()} />
          <TranscricaoManualDialog contactId={contactId} aberto={manualAberto} aoFechar={() => setManualAberto(false)} aoSalvar={() => void recarregar()} />
        </>
      )}
    </div>
  );
}
