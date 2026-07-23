'use client';

// ============================================================
// CbChannelsPanel — Settings → Conexões
//
// Lista os números de WhatsApp da conta e conecta um número novo por QR
// Code (Evolution). O servidor Evolution é um só (configurado no ambiente
// do servidor), então o operador só dá um rótulo — nada de URL/chave.
//
// LAÇO DO QR: o QR expira a cada ~45s e é regenerado sozinho, então o
// diálogo consulta `/connect` a cada 5s; cada resposta traz o QR vigente
// e, ao parear, o canal já conectado.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  Plus,
  QrCode,
  Smartphone,
  Star,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

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
}

const POLL_MS = 5_000;

function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(raw);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${raw}`;
}

export function CbChannelsPanel() {
  const t = useTranslations('Settings.channels');

  const [channels, setChannels] = useState<CbChannel[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);

  const [qrChannelId, setQrChannelId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrConnected, setQrConnected] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/cb/channels');
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('loadFailed'));
        return;
      }
      setChannels(payload.channels ?? []);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openQrFor = (channelId: string, qr: string | null) => {
    setQrChannelId(channelId);
    setQrImage(qr);
    setQrConnected(false);
    setQrError(null);
  };

  const handleCreate = async () => {
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
      setLabel('');
      setAddOpen(false);
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
      await load();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <RequireRole min="admin">
            <Button onClick={() => setAddOpen(true)}>
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
                    <Badge variant="secondary">
                      {channel.kind === 'meta' ? t('kindMeta') : t('kindEvolution')}
                    </Badge>
                    {channel.is_default && (
                      <Badge variant="outline">
                        <Star className="mr-1 h-3 w-3" />
                        {t('defaultBadge')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatPhone(channel.display_phone) ?? t('noNumberYet')}
                    {' · '}
                    {t(`status_${channel.status}`)}
                  </p>
                </div>

                <RequireRole min="admin">
                  <div className="flex items-center gap-2">
                    {channel.kind === 'evolution' && channel.status !== 'connected' && (
                      <Button variant="outline" size="sm" onClick={() => openQrFor(channel.id, null)}>
                        <QrCode className="mr-2 h-4 w-4" />
                        {t('connect')}
                      </Button>
                    )}
                    {channel.kind === 'evolution' && !channel.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deletingId === channel.id}
                        onClick={() => handleDelete(channel)}
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

      {/* Novo canal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addTitle')}</DialogTitle>
            <DialogDescription>{t('addDescription')}</DialogDescription>
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
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !label}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('createAndConnect')}
            </Button>
          </DialogFooter>
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
    </div>
  );
}
