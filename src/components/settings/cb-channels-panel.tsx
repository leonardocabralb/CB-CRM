'use client';

// ============================================================
// CbChannelsPanel — Settings → Conexões
//
// O ÚNICO lar de todos os números de WhatsApp da conta:
//   · Meta Cloud API (oficial)    — cadastro por token, assistente no diálogo
//   · Evolution API (não oficial) — pareamento por QR Code
//
// Substituiu a antiga seção "WhatsApp" (EvolutionConnect, single-channel):
// o link legado ?tab=whatsapp é remapeado para cá em settings-sections.ts.
//
// LAÇO DO QR: o QR expira a cada ~45s e é regenerado sozinho, então o
// diálogo consulta `/connect` a cada 5s; cada resposta traz o QR vigente
// e, ao parear, o canal já conectado.
//
// PRÉ-MIGRATION: GET /api/cb/channels devolve { unavailable: true } quando
// a tabela cb_channels ainda não existe — o painel mostra o aviso de
// migration em vez de um toast de erro.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  Smartphone,
  Star,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RequireRole } from '@/components/auth/require-role';
import { SettingsPanelHead } from './settings-panel-head';

interface CbChannel {
  id: string;
  kind: 'meta' | 'evolution';
  label: string;
  display_phone: string | null;
  is_default: boolean;
  status: 'disconnected' | 'connecting' | 'connected';
  last_error: string | null;
}

type AddStep = 'choose' | 'evolution' | 'meta';

const POLL_MS = 5_000;

const STATUS_DOT: Record<CbChannel['status'], string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  disconnected: 'bg-red-500',
};

function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  // A Meta (display_phone_number) já entrega formatado ("+55 11 9…"); só os
  // dígitos crus da Evolution (ownerJid) precisam de formatação aqui.
  if (/\D/.test(raw)) return raw;
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(raw);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${raw}`;
}

export function CbChannelsPanel() {
  const t = useTranslations('Settings.channels');

  const [channels, setChannels] = useState<CbChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addStep, setAddStep] = useState<AddStep>('choose');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);

  // Campos do assistente Meta. Os rótulos técnicos (Phone Number ID, Access
  // Token…) não se traduzem — precisam bater com o painel da Meta.
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaWabaId, setMetaWabaId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaVerifyToken, setMetaVerifyToken] = useState('');
  const [metaPin, setMetaPin] = useState('');
  const [showToken, setShowToken] = useState(false);

  const [qrChannelId, setQrChannelId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrConnected, setQrConnected] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<CbChannel | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<CbChannel | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/cb/channels');
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('loadFailed'));
        return;
      }
      setChannels(payload.channels ?? []);
      setUnavailable(Boolean(payload.unavailable));
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetAdd = () => {
    setAddStep('choose');
    setLabel('');
    setMetaPhoneNumberId('');
    setMetaWabaId('');
    setMetaAccessToken('');
    setMetaVerifyToken('');
    setMetaPin('');
    setShowToken(false);
  };

  const openQrFor = (channelId: string, qr: string | null) => {
    setQrChannelId(channelId);
    setQrImage(qr);
    setQrConnected(false);
    setQrError(null);
  };

  const handleCreateEvolution = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/cb/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('createFailed'));
        return;
      }
      setAddOpen(false);
      resetAdd();
      await load();
      if (payload.channel?.status === 'connected') {
        toast.success(t('connectedToast'));
        return;
      }
      openQrFor(payload.channel.id, payload.qr ?? null);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateMeta = async () => {
    if (metaPin && !/^\d{6}$/.test(metaPin)) {
      toast.error(t('metaPinInvalid'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/cb/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'meta',
          label,
          phone_number_id: metaPhoneNumberId.trim(),
          waba_id: metaWabaId.trim() || null,
          access_token: metaAccessToken.trim(),
          verify_token: metaVerifyToken.trim() || null,
          pin: metaPin.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('createFailed'));
        return;
      }
      const reg = payload.registration as
        | { registered?: boolean; skipped?: boolean; error?: string | null }
        | undefined;
      if (reg?.error) {
        toast.error(t('metaRegistrationFailed', { error: reg.error }), {
          duration: 12_000,
        });
      } else if (reg?.skipped) {
        toast.success(t('metaRegistrationSkipped'), { duration: 10_000 });
      } else {
        toast.success(t('metaConnectedToast'));
      }
      setAddOpen(false);
      resetAdd();
      await load();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setCreating(false);
    }
  };

  // Laço de pareamento. Ref para o id, senão o intervalo lê o valor velho.
  const qrChannelIdRef = useRef<string | null>(null);
  qrChannelIdRef.current = qrChannelId;

  useEffect(() => {
    if (!qrChannelId || qrConnected) return;
    let cancelled = false;

    const tick = async () => {
      const id = qrChannelIdRef.current;
      if (!id) return;
      try {
        const res = await fetch(`/api/cb/channels/${id}/connect`, { method: 'POST' });
        const payload = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setQrError(payload.error || t('connectFailed'));
          return;
        }
        setQrError(null);
        if (payload.connected) {
          setQrConnected(true);
          setQrImage(null);
          toast.success(t('connectedToast'));
          void load();
        } else if (payload.qr) {
          setQrImage(payload.qr);
        }
      } catch {
        if (!cancelled) setQrError(t('networkError'));
      }
    };

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [qrChannelId, qrConnected, load, t]);

  const handleRename = async () => {
    if (!renameTarget) return;
    setRenaming(true);
    try {
      const res = await fetch(`/api/cb/channels/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: renameValue }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('renameFailed'));
        return;
      }
      toast.success(t('renamed'));
      setRenameTarget(null);
      await load();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async (channel: CbChannel) => {
    setDeletingId(channel.id);
    try {
      const res = await fetch(`/api/cb/channels/${channel.id}`, { method: 'DELETE' });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleted', { label: channel.label }));
      setConfirmDelete(null);
      await load();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setDeletingId(null);
    }
  };

  const metaFormValid =
    Boolean(label) && Boolean(metaPhoneNumberId.trim()) && Boolean(metaAccessToken.trim());

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <RequireRole min="admin">
            <Button onClick={() => setAddOpen(true)} disabled={unavailable}>
              <Plus className="mr-2 h-4 w-4" />
              {t('addChannel')}
            </Button>
          </RequireRole>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : unavailable ? (
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {t('unavailableTitle')}
          </AlertTitle>
          <AlertDescription>{t('unavailableDesc')}</AlertDescription>
        </Alert>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Smartphone className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('emptyTitle')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {channels.map((channel) => (
            <Card key={channel.id}>
              <CardContent className="flex flex-wrap items-center gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{channel.label}</span>
                    {channel.kind === 'meta' ? (
                      <Badge>
                        <BadgeCheck className="mr-1 h-3 w-3" />
                        {t('kindMeta')}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <QrCode className="mr-1 h-3 w-3" />
                        {t('kindEvolution')}
                      </Badge>
                    )}
                    {channel.is_default && (
                      <Badge variant="outline">
                        <Star className="mr-1 h-3 w-3" />
                        {t('defaultBadge')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    {formatPhone(channel.display_phone) ?? t('noNumberYet')}
                    <span aria-hidden="true">·</span>
                    <span
                      aria-hidden="true"
                      className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[channel.status]}`}
                    />
                    {t(`status_${channel.status}`)}
                  </p>
                  {channel.last_error && (
                    <p className="mt-1 truncate text-xs text-destructive">
                      {t('lastError', { error: channel.last_error })}
                    </p>
                  )}
                </div>

                <RequireRole min="admin">
                  <div className="flex items-center gap-2">
                    {channel.kind === 'evolution' && channel.status !== 'connected' && (
                      <Button variant="outline" size="sm" onClick={() => openQrFor(channel.id, null)}>
                        <QrCode className="mr-2 h-4 w-4" />
                        {t('connect')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('renameAction')}
                      onClick={() => {
                        setRenameTarget(channel);
                        setRenameValue(channel.label);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!channel.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('deleteAction')}
                        disabled={deletingId === channel.id}
                        onClick={() => setConfirmDelete(channel)}
                      >
                        {deletingId === channel.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </RequireRole>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Novo canal — escolha do tipo e formulário */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAdd();
        }}
      >
        <DialogContent
          className={addStep === 'meta' ? 'max-h-[85vh] overflow-y-auto sm:max-w-xl' : undefined}
        >
          {addStep === 'choose' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('addTitle')}</DialogTitle>
                <DialogDescription>{t('addDescription')}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setAddStep('meta')}
                  className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BadgeCheck className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {t('chooseMetaTitle')}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('chooseMetaDesc')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddStep('evolution')}
                  className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground">
                    <QrCode className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {t('chooseEvolutionTitle')}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('chooseEvolutionDesc')}</span>
                </button>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>
                  {t('cancel')}
                </Button>
              </DialogFooter>
            </>
          )}

          {addStep === 'evolution' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('evolutionStepTitle')}</DialogTitle>
                <DialogDescription>{t('evolutionStepDescription')}</DialogDescription>
              </DialogHeader>
              <div>
                <Label htmlFor="cb-channel-label">{t('labelField')}</Label>
                <Input
                  id="cb-channel-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t('labelPlaceholder')}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddStep('choose')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('back')}
                </Button>
                <Button onClick={handleCreateEvolution} disabled={creating || !label}>
                  {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('createAndConnect')}
                </Button>
              </DialogFooter>
            </>
          )}

          {addStep === 'meta' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('metaStepTitle')}</DialogTitle>
                <DialogDescription>{t('metaStepDescription')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="cb-meta-label">{t('labelField')}</Label>
                  <Input
                    id="cb-meta-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t('labelPlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="cb-meta-pnid">{t('metaFieldPhoneNumberId')}</Label>
                  <Input
                    id="cb-meta-pnid"
                    value={metaPhoneNumberId}
                    onChange={(e) => setMetaPhoneNumberId(e.target.value)}
                    placeholder="100234567890123"
                  />
                </div>
                <div>
                  <Label htmlFor="cb-meta-waba">
                    {t('metaFieldWabaId')}{' '}
                    <span className="text-muted-foreground">{t('metaOptional')}</span>
                  </Label>
                  <Input
                    id="cb-meta-waba"
                    value={metaWabaId}
                    onChange={(e) => setMetaWabaId(e.target.value)}
                    placeholder="100234567890456"
                  />
                </div>
                <div>
                  <Label htmlFor="cb-meta-token">{t('metaFieldAccessToken')}</Label>
                  <div className="relative">
                    <Input
                      id="cb-meta-token"
                      type={showToken ? 'text' : 'password'}
                      value={metaAccessToken}
                      onChange={(e) => setMetaAccessToken(e.target.value)}
                      placeholder={t('metaAccessTokenPlaceholder')}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={t('metaToggleToken')}
                      onClick={() => setShowToken((v) => !v)}
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="cb-meta-verify">
                    {t('metaFieldVerifyToken')}{' '}
                    <span className="text-muted-foreground">{t('metaOptional')}</span>
                  </Label>
                  <Input
                    id="cb-meta-verify"
                    value={metaVerifyToken}
                    onChange={(e) => setMetaVerifyToken(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{t('metaVerifyTokenHint')}</p>
                </div>
                <div>
                  <Label htmlFor="cb-meta-pin">
                    {t('metaFieldPin')}{' '}
                    <span className="text-muted-foreground">{t('metaOptional')}</span>
                  </Label>
                  <Input
                    id="cb-meta-pin"
                    inputMode="numeric"
                    maxLength={6}
                    value={metaPin}
                    onChange={(e) => setMetaPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t('metaPinPlaceholder')}
                    className="tracking-widest"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{t('metaPinHint')}</p>
                </div>

                <Accordion>
                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      {t('metaHelpCreds')}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li>{t('metaHelpCreds_1')}</li>
                        <li>{t('metaHelpCreds_2')}</li>
                        <li>{t('metaHelpCreds_3')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      {t('metaHelpWebhook')}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li>{t('metaHelpWebhook_1')}</li>
                        <li>{t('metaHelpWebhook_2')}</li>
                        <li>{t('metaHelpWebhook_3')}</li>
                      </ol>
                      <div className="mt-3 space-y-1">
                        <Label>{t('metaWebhookUrl')}</Label>
                        <div className="flex gap-2">
                          <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="shrink-0"
                            onClick={() => {
                              void navigator.clipboard.writeText(webhookUrl);
                              toast.success(t('metaWebhookCopied'));
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      {t('metaHelpPin')}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li>{t('metaHelpPin_1')}</li>
                        <li>{t('metaHelpPin_2')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddStep('choose')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('back')}
                </Button>
                <Button onClick={handleCreateMeta} disabled={creating || !metaFormValid}>
                  {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('metaCreate')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* QR Code */}
      <Dialog
        open={qrChannelId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setQrChannelId(null);
            setQrImage(null);
            setQrConnected(false);
            setQrError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{qrConnected ? t('qrConnectedTitle') : t('qrTitle')}</DialogTitle>
            <DialogDescription>
              {qrConnected ? t('qrConnectedDescription') : t('qrDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-3">
            {qrConnected ? (
              <CheckCircle2 className="h-16 w-16 text-primary" />
            ) : qrImage ? (
              <>
                {/* Data-URI PNG pronta da Evolution — <img> direto. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrImage}
                  alt={t('qrAlt')}
                  className="h-64 w-64 rounded-lg bg-white p-2"
                />
                <p className="text-center text-xs text-muted-foreground">{t('qrRefreshHint')}</p>
              </>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t('qrLoading')}</p>
              </>
            )}
            {qrError && <p className="text-center text-sm text-destructive">{qrError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => setQrChannelId(null)}>
              {qrConnected ? t('done') : t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renomear */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('renameTitle')}</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="cb-rename-label">{t('labelField')}</Label>
            <Input
              id="cb-rename-label"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleRename} disabled={renaming || !renameValue.trim()}>
              {renaming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('renameSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar remoção */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDelete ? t('deleteConfirmTitle', { label: confirmDelete.label }) : ''}
            </DialogTitle>
            <DialogDescription>
              {confirmDelete?.kind === 'evolution'
                ? t('deleteConfirmEvolutionDesc')
                : t('deleteConfirmMetaDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deletingId !== null}
              onClick={() => confirmDelete && void handleDelete(confirmDelete)}
            >
              {deletingId !== null ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('deleteAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
