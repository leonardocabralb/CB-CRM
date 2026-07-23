'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type ConnState = 'open' | 'connecting' | 'close';

/** Evolution v2 may return a bare base64 or a full data URI — normalize. */
function toImgSrc(qr: string): string {
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
}

/**
 * WhatsApp connection panel for the Evolution transport: provisions the
 * account's instance, shows a QR to pair a number, and polls until the
 * session is open.
 */
export function EvolutionConnect() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ConnState>('close');
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/evolution/connect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect');
      setState(data.state);
      setQr(data.qr ?? null);
      if (data.connected) toast.success('WhatsApp connected');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/evolution/state');
      const data = await res.json();
      if (!res.ok) return;
      setState(data.state);
      if (data.qr) setQr(data.qr);
      if (data.connected) {
        setQr(null);
        toast.success('WhatsApp connected');
      }
    } catch {
      // transient — the next tick retries
    }
  }, []);

  // Provision + fetch the QR on mount.
  useEffect(() => {
    connect();
  }, [connect]);

  // Poll for the paired state while a QR is on screen.
  useEffect(() => {
    if (state === 'open') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(poll, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state, poll]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Smartphone className="size-5" /> WhatsApp
        </h2>
        <p className="text-muted-foreground text-sm">
          Connect a WhatsApp number to this account via the Evolution gateway.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Connection error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {state === 'open' ? (
              <>
                <CheckCircle2 className="size-5 text-green-600" /> Connected
              </>
            ) : (
              'Pair your WhatsApp'
            )}
          </CardTitle>
          <CardDescription>
            {state === 'open'
              ? 'This number is linked and receiving messages.'
              : 'Open WhatsApp → Linked devices → Link a device, and scan the code below.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Preparing connection…
            </div>
          ) : state === 'open' ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="size-4" /> WhatsApp is connected.
            </div>
          ) : qr ? (
            <div className="flex flex-col items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={toImgSrc(qr)}
                alt="WhatsApp pairing QR code"
                width={264}
                height={264}
                className="rounded-lg border bg-white p-2"
              />
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-3 animate-spin" /> Waiting for the scan…
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No QR available yet — click “Refresh QR”.
            </p>
          )}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={connect} disabled={busy}>
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        {state === 'open' ? 'Reconnect' : 'Refresh QR'}
      </Button>
    </div>
  );
}
