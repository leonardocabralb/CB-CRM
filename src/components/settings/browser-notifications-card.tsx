'use client';

import { useState, useSyncExternalStore } from 'react';
import { Bell, BellRing, CircleAlert, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { usePreferenciaDeAviso } from '@/hooks/use-browser-notifications';
import { useMediaQuery } from '@/hooks/use-media-query';
import { MIDIA_DE_TOQUE } from '@/lib/celular/teclado';
import {
  BROWSER_NOTIFY_CHANGE_EVENT,
  getNotificationPermission,
  type BrowserNotifyPermission,
} from '@/lib/notifications/browser-notify';
import type { QuaisConversas } from '@/lib/notifications/aviso-no-navegador';

// `Notification.permission` has no change event of its own. Re-read it
// whenever the tab regains focus (the user may have flipped the site
// setting in the browser UI) and whenever our own preference changes
// (right after requestPermission resolves).
function subscribePermission(onChange: () => void): () => void {
  window.addEventListener('focus', onChange);
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener(BROWSER_NOTIFY_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener(BROWSER_NOTIFY_CHANGE_EVENT, onChange);
  };
}

const serverPermission = (): BrowserNotifyPermission => 'unsupported';

/**
 * Cartão "Notificações do navegador" (#516 do original), em Seu perfil.
 * A permissão do navegador é a porta de verdade, então a chave aparece
 * desligada sempre que ela falta. Portado na Fase 8 do plano do merge do
 * upstream: a preferência é POR PESSOA neste navegador, e a pessoa escolhe
 * QUAIS conversas avisam e se o aviso mostra o texto (decisão P2).
 */
export function BrowserNotificationsCard({ className }: { className?: string }) {
  const t = useTranslations('Settings.browserNotifications');
  const { preferencia, gravar } = usePreferenciaDeAviso();
  const permission = useSyncExternalStore(
    subscribePermission,
    getNotificationPermission,
    serverPermission,
  );
  const [requesting, setRequesting] = useState(false);

  // Aparelho de toque: a API existe, mas sem service worker o aviso nunca
  // aparece (ver `avisoPossivelNoAparelho`). Dizer "não suportado" é melhor
  // que uma chave que liga e não faz nada.
  const toque = useMediaQuery(MIDIA_DE_TOQUE);
  const supported = permission !== 'unsupported' && !toque;
  const checked = preferencia.ativo && permission === 'granted';

  const onToggle = async (next: boolean) => {
    if (!next) {
      gravar({ ...preferencia, ativo: false });
      return;
    }
    if (permission === 'granted') {
      gravar({ ...preferencia, ativo: true });
      return;
    }
    if (permission === 'denied') {
      toast.error(t('statusDenied'), { description: t('deniedHint') });
      return;
    }
    setRequesting(true);
    try {
      const result = await Notification.requestPermission();
      // Também dispara o evento de mudança, que relê `permission`.
      gravar({ ...preferencia, ativo: result === 'granted' });
      if (result === 'denied') {
        toast.error(t('permissionDeniedToast'), { description: t('deniedHint') });
      }
    } finally {
      setRequesting(false);
    }
  };

  const sendTest = () => {
    try {
      new Notification(t('testTitle'), {
        body: t('testBody'),
        icon: '/icon',
        tag: 'cb-teste-de-notificacao',
      });
    } catch {
      toast.error(t('unsupported'));
    }
  };

  const statusKey =
    permission === 'granted'
      ? 'statusGranted'
      : permission === 'denied'
        ? 'statusDenied'
        : 'statusDefault';

  // Chave por opção, LITERAL: chave montada escapa do portão de i18n do CI.
  const rotuloDeQuais: Record<QuaisConversas, string> = {
    todas: t('which.todas'),
    minhas_e_sem_responsavel: t('which.minhas_e_sem_responsavel'),
    minhas: t('which.minhas'),
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Bell className="size-4 text-muted-foreground" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="size-4 shrink-0" />
            {t('unsupported')}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('toggleLabel')}
                </p>
                <p className="text-xs text-muted-foreground">{t('toggleDesc')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {requesting && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
                <Switch
                  checked={checked}
                  onCheckedChange={(next) => void onToggle(next)}
                  disabled={requesting || permission === 'denied'}
                  aria-label={t('toggleLabel')}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{t(statusKey)}</p>

            {permission === 'denied' && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{t('deniedHint')}</span>
              </p>
            )}

            {checked && (
              <div className="space-y-4 rounded-md border border-border p-3">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">{t('whichLabel')}</p>
                  <Select
                    value={preferencia.quais}
                    onValueChange={(v) =>
                      v && gravar({ ...preferencia, quais: v as QuaisConversas })
                    }
                  >
                    <SelectTrigger
                      className="w-full bg-muted border-border text-foreground"
                      aria-label={t('whichLabel')}
                    >
                      <SelectValue>{rotuloDeQuais[preferencia.quais]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">{rotuloDeQuais.todas}</SelectItem>
                      <SelectItem value="minhas_e_sem_responsavel">
                        {rotuloDeQuais.minhas_e_sem_responsavel}
                      </SelectItem>
                      <SelectItem value="minhas">{rotuloDeQuais.minhas}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t('showTextLabel')}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('showTextDesc')}</p>
                  </div>
                  <Switch
                    checked={preferencia.mostrarTexto}
                    onCheckedChange={(next) => gravar({ ...preferencia, mostrarTexto: next })}
                    aria-label={t('showTextLabel')}
                  />
                </div>

                <p className="text-xs text-muted-foreground">{t('scopeNote')}</p>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={sendTest}
              disabled={!checked}
            >
              <BellRing className="size-4" />
              {t('sendTest')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
