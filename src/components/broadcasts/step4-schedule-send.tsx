'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useChannels } from '@/hooks/use-channels';
import { channelLabel } from '@/lib/cb-channels/display';
import { ehMeta } from '@/lib/cb-channels/transporte';
import { contarPublico, type AudienceConfig } from '@/hooks/use-broadcast-sending';

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  /** Canal escolhido no passo 1 — aqui só para conferência antes do envio. */
  channelId: string | null;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  channelId,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const tCanais = useTranslations('Channels');
  const { channels } = useChannels();
  const [showConfirm, setShowConfirm] = useState(false);
  // `null` = ainda não se sabe (carregando ou a conta falhou) — nunca 0.
  const [estimatedReach, setEstimatedReach] = useState<number | null>(null);
  const [loadingReach, setLoadingReach] = useState(true);
  const [tentativaDoAlcance, setTentativaDoAlcance] = useState(0);

  useEffect(() => {
    let cancelado = false;
    async function calculateReach() {
      setLoadingReach(true);
      try {
        // ⚠️ A MESMA resolução do envio (`contarPublico`). A conta própria
        // desta tela lia sem paginar (1.000 para etiqueta maior que isso),
        // ignorava as exclusões e dizia 0 para público por campo
        // personalizado — o número que a confirmação mostra antes de um
        // disparo pago.
        const total = await contarPublico(createClient(), audience);
        if (!cancelado) setEstimatedReach(total);
      } catch (err) {
        console.error('[broadcast] alcance do disparo não foi calculado', err);
        if (!cancelado) setEstimatedReach(null);
      } finally {
        if (!cancelado) setLoadingReach(false);
      }
    }

    calculateReach();
    return () => {
      cancelado = true;
    };
  }, [audience, tentativaDoAlcance]);

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : t('scheduleSend.audienceField');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('scheduleSend.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('scheduleSend.broadcastName')}</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated Reach</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : estimatedReach === null ? (
                <p className="text-xs text-red-600 dark:text-red-300">
                  {t('scheduleSend.alcanceFalhou')}{' '}
                  <button
                    type="button"
                    onClick={() => setTentativaDoAlcance((n) => n + 1)}
                    className="font-medium underline underline-offset-2"
                  >
                    {t('scheduleSend.tentarDeNovo')}
                  </button>
                </p>
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Language</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
          {/* De qual número a campanha sai. Só aparece com 2+ oficiais, e é
              leitura: quem escolhe é o passo 1, porque a lista de modelos
              depende do canal. Mostrado aqui para o operador conferir antes
              de disparar para centenas de contatos. */}
          {channels.filter((c) => ehMeta(c)).length >= 2 && (
            <div>
              <p className="text-xs text-muted-foreground">
                {tCanais('outboundLabel')}
              </p>
              <p className="text-foreground">
                {channelLabel(channels, channelId) ?? '—'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">{t('scheduleSend.sending')}</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={
              <Button
                // Sem o alcance calculado não há o que confirmar: o diálogo
                // afirmaria um número para um disparo pago (upstream #594).
                disabled={!name.trim() || isProcessing || loadingReach || estimatedReach === null}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              />
            }
          >
            <Send className="h-4 w-4" />
            {t('scheduleSend.sendNow')}
          </DialogTrigger>
          <DialogContent className="border-border bg-popover sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">Confirm Broadcast</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                You are about to send this broadcast to{' '}
                <span className="font-medium text-popover-foreground">{(estimatedReach ?? 0).toLocaleString()}</span>{' '}
                contacts using the{' '}
                <span className="font-medium text-popover-foreground">{template.name}</span> template.
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-border text-muted-foreground"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend();
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
                {t('scheduleSend.sendNow')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
