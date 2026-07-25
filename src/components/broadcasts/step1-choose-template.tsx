'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, ArrowRight, PlugZap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ChannelSelect } from '@/components/channels/channel-select';
import { useChannels } from '@/hooks/use-channels';
import { metaChannels, preferredChannel } from '@/lib/cb-channels/display';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Utility: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Authentication: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

interface Step1Props {
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  /** Canal de saída escolhido aqui e usado até o envio. */
  channelId: string | null;
  onChannelChange: (channelId: string | null) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({
  selectedTemplate,
  onSelect,
  channelId,
  onChannelChange,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('Broadcasts.wizard');
  const tCanais = useTranslations('Channels');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Disparo é conceito da API oficial: um canal Evolution não tem WABA nem
  // modelos. O número sai ESCOLHIDO AQUI, e não no passo 4, porque a lista
  // de modelos depende dele — desde a 903 o mesmo nome de modelo pode
  // existir em dois WABAs, e oferecer o modelo do outro número levaria a
  // uma campanha que falha no envio.
  const { channels, loading: canaisCarregando } = useChannels();
  const canaisMeta = useMemo(() => metaChannels(channels), [channels]);
  const semCanalMeta =
    !canaisCarregando && channels.length > 0 && canaisMeta.length === 0;

  // Pré-seleciona o padrão da conta assim que os canais chegam.
  useEffect(() => {
    if (channelId || canaisMeta.length === 0) return;
    const escolha = preferredChannel(canaisMeta);
    if (escolha) onChannelChange(escolha.id);
  }, [canaisMeta, channelId, onChannelChange]);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        // Only APPROVED templates can be sent via Meta — anything else
        // would 400 at broadcast time. Hide them rather than letting
        // the user pick a template that will fail.
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        setTemplates(data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('chooseTemplate.errorLoad'));
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  // Guarda: antes, uma conta só com número não oficial percorria os quatro
  // passos e só descobria no envio que disparo exige a API da Meta.
  if (semCanalMeta) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 text-center">
        <PlugZap className="mb-1 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-foreground">{tCanais('metaOnlyNone')}</p>
      </div>
    );
  }

  // Modelo do canal escolhido + os globais (channel_id nulo, anteriores à
  // 903, que qualquer canal Meta ainda serve).
  const visiveis = channelId
    ? templates.filter((tp) => !tp.channel_id || tp.channel_id === channelId)
    : templates;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('chooseTemplate.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chooseTemplate.subtitle')}
        </p>
      </div>

      {canaisMeta.length >= 2 && (
        <div className="max-w-sm">
          <label className="mb-1 block text-xs text-muted-foreground">
            {tCanais('outboundLabel')}
          </label>
          <ChannelSelect
            channels={canaisMeta}
            value={channelId}
            onChange={onChannelChange}
          />
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-border bg-card/50">
          <FileText className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('chooseTemplate.noTemplates')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('chooseTemplate.createFirst')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;
            const catColor = categoryColors[template.category] ?? categoryColors.Utility;

            return (
              <button
                key={template.id}
                onClick={() => onSelect(template)}
                className={`flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border bg-card/50 hover:border-border hover:bg-card'
                }`}
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
                  >
                    {template.category}
                  </span>
                </div>
                <p className="line-clamp-3 text-xs text-muted-foreground">{template.body_text}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{template.language ?? 'en_US'}</span>
                  {/* Status is omitted on purpose — every template
                      shown here is already filtered to APPROVED,
                      so the chip carried no information. */}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!selectedTemplate}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
