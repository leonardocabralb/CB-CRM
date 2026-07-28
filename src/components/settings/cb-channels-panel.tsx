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
  RotateCcw,
  QrCode,
  RefreshCw,
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
import { createClient } from '@/lib/supabase/client';
import { ehUrlAlcancavel } from '@/lib/cb-channels/webhook-url';
import { SettingsPanelHead } from './settings-panel-head';

interface CbChannel {
  id: string;
  kind: 'meta' | 'evolution';
  label: string;
  display_phone: string | null;
  is_default: boolean;
  status: 'disconnected' | 'connecting' | 'connected';
  last_error: string | null;
  /** Funil em que cai quem escrever neste número (migration 908). */
  default_pipeline_id: string | null;
  default_stage_id: string | null;
}

interface PipelineOption {
  id: string;
  name: string;
}

interface StageOption {
  id: string;
  name: string;
  pipeline_id: string;
  position: number;
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

  // "Configurar" — o antigo "Renomear", que agora também escolhe o funil.
  const [configTarget, setConfigTarget] = useState<CbChannel | null>(null);
  const [configLabel, setConfigLabel] = useState('');
  const [configPipeline, setConfigPipeline] = useState('');
  const [configStage, setConfigStage] = useState('');
  const [saving, setSaving] = useState(false);

  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  /**
   * A busca de funis TERMINOU BEM. Distingue "ainda não sei" de "não existe":
   * sem isso, uma falha de rede na listagem faria toda conexão configurada
   * anunciar "o funil foi apagado", e o operador iria reconfigurar algo que
   * está intacto no banco.
   */
  const [pipelinesCarregados, setPipelinesCarregados] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<CbChannel | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Sucessor escolhido quando o canal a remover é o padrão. */
  const [successorId, setSuccessorId] = useState('');

  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState<string | null>(null);

  const [confirmRestart, setConfirmRestart] = useState<CbChannel | null>(null);
  const [restarting, setRestarting] = useState(false);

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

  // Funis e etapas para o seletor de "Configurar". Vêm pelo client do
  // Supabase, sob RLS — mesmo caminho do construtor de automações. Falha
  // silenciosa de propósito: sem a lista o diálogo ainda renomeia, que é o
  // que ele já fazia antes desta tela ganhar funil.
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const supabase = createClient();
      const [funisRes, etapasRes] = await Promise.all([
        supabase.from('pipelines').select('id, name').order('name'),
        supabase
          .from('pipeline_stages')
          .select('id, name, pipeline_id, position')
          .order('position'),
      ]);
      if (cancelado) return;
      setPipelines((funisRes.data as PipelineOption[] | null) ?? []);
      setStages((etapasRes.data as StageOption[] | null) ?? []);
      if (!funisRes.error) setPipelinesCarregados(true);
    })();
    return () => {
      cancelado = true;
    };
  }, []);

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
    avisouWebhookRef.current = false;
  };

  /**
   * Ressincroniza um canal que JÁ ESTÁ conectado.
   *
   * Existe separado do pareamento porque o diálogo do QR conta outra
   * história: ele abre em "Gerando o QR Code…", termina em "Número
   * conectado" e exige um clique em "Concluir" — tudo isso para uma ação em
   * que nada conectou. O que aconteceu de fato foi a reaplicação do webhook,
   * e é isso que o operador precisa ler.
   *
   * A rota é a mesma (`/connect`), porque é ela que reaplica a lista de
   * eventos — a Evolution congela essa lista por instância no registro, e
   * este é o único caminho que a atualiza numa instância que já existe.
   */
  const ressincronizar = async (channelId: string) => {
    setResyncing(channelId);
    try {
      const res = await fetch(`/api/cb/channels/${channelId}/connect`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('connectFailed'));
        return;
      }
      // O detalhe do servidor vai junto: a recusa mais provável aqui é a
      // guarda de URL não-pública, e ela diz exatamente o que ajustar.
      if (payload.webhookError) {
        toast.warning(t('webhookRepairFailed'), { description: payload.webhookError });
      } else {
        toast.success(t('resyncedToast'));
      }
      // A conexão pode ter caído entre a listagem e o clique. Aí o gesto
      // certo passa a ser parear, e o QR é o caminho.
      if (!payload.connected) openQrFor(channelId, payload.qr ?? null);
      void load();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setResyncing(null);
    }
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
  /** Trava do aviso de webhook: um por abertura do diálogo, não um por tick. */
  const avisouWebhookRef = useRef(false);

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
        // A reaplicação do webhook é best-effort na rota, mas o operador
        // precisa saber quando ela não pegou: sem os eventos, exclusão e
        // edição feitas pelo cliente somem sem deixar rastro no CRM.
        //
        // UMA vez por diálogo. Este laço repete a cada POLL_MS enquanto o
        // pareamento não conclui, e um aviso empilhando por cima do QR a
        // cada 5 segundos vira ruído que o operador aprende a ignorar.
        if (payload.webhookError && !avisouWebhookRef.current) {
          avisouWebhookRef.current = true;
          // Com a explicação junto: quando a recusa vem da guarda, é ela que
          // diz qual env ajustar — e este é o único caminho na tela quando o
          // canal está desconectado, porque aí o botão "Ressincronizar" nem
          // aparece.
          toast.warning(t('webhookRepairFailed'), { description: payload.webhookError });
        }
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

  const abrirConfig = (channel: CbChannel) => {
    setConfigTarget(channel);
    setConfigLabel(channel.label);
    setConfigPipeline(channel.default_pipeline_id ?? '');
    setConfigStage(channel.default_stage_id ?? '');
  };

  const handleConfigure = async () => {
    if (!configTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/cb/channels/${configTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: configLabel,
          // Sempre enviado (a chave presente é o que autoriza a rota a mexer
          // no roteamento). String vazia = "sem funil".
          default_pipeline_id: configPipeline || null,
          default_stage_id: configPipeline ? configStage || null : null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('configureFailed'));
        return;
      }
      toast.success(t('configureSaved'));
      setConfigTarget(null);
      await load();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (channel: CbChannel) => {
    setDeletingId(channel.id);
    try {
      const res = await fetch(`/api/cb/channels/${channel.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // O sucessor só importa quando o canal removido é o padrão; a rota
        // ignora o campo nos outros casos.
        body: JSON.stringify({ promote_to: successorId || null }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('deleteFailed'), { duration: 10_000 });
        return;
      }
      // O espelho pode ter ficado para trás na promoção do sucessor. O canal
      // já foi removido, então isto não é erro — mas disparos e modelos
      // podem estar apontando para a credencial que acabou de ser destruída.
      if (payload.warning) {
        toast.warning(payload.warning, { duration: 15_000 });
      } else {
        toast.success(t('deleted', { label: channel.label }));
      }
      setConfirmDelete(null);
      setSuccessorId('');
      await load();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setDeletingId(null);
    }
  };

  /**
   * REPAREAR: derruba a sessão e abre o QR novo.
   *
   * Diferente de "Ressincronizar", que reaplica o webhook sem desconectar
   * ninguém. Este é o remédio da instância zumbi — a que a Evolution ainda
   * reporta como 'open' e que não entrega nada, e que por isso nem oferece
   * o botão de parear.
   */
  const handleRestart = async () => {
    if (!confirmRestart) return;
    const channelId = confirmRestart.id;
    setRestarting(true);
    try {
      const res = await fetch(`/api/cb/channels/${channelId}/restart`, {
        method: 'POST',
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('restartFailed'), { duration: 10_000 });
        return;
      }
      setConfirmRestart(null);
      await load();
      // Cai direto no diálogo do QR: a sessão JÁ caiu, então mandar o
      // operador procurar o botão de parear seria deixá-lo no escuro.
      openQrFor(channelId, payload.qr ?? null);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setRestarting(false);
    }
  };

  const handleSetDefault = async (channel: CbChannel) => {
    setPromotingId(channel.id);
    try {
      const res = await fetch(`/api/cb/channels/${channel.id}/default`, {
        method: 'POST',
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('setDefaultFailed'));
        return;
      }
      // O espelho pode falhar sem derrubar a promoção — o operador precisa
      // saber, porque broadcast e modelos continuariam no canal anterior.
      if (payload.warning) {
        toast.warning(payload.warning, { duration: 10_000 });
      } else {
        toast.success(t('setDefaultDone', { label: channel.label }));
      }
      await load();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setPromotingId(null);
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
                {/* Piso de largura: sem ele o `flex-1 min-w-0` encolhe até o
                    número e o funil saírem uma palavra por linha quando a
                    linha de botões cresce (são quatro agora). Com o piso, o
                    `flex-wrap` do pai joga os botões para baixo. */}
                <div className="min-w-56 flex-1">
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
                  {/* O funil configurado, LIDO DE VOLTA. Apagar o funil na
                      tela de Funis zera `default_pipeline_id` (ON DELETE SET
                      NULL) e o roteamento para em silêncio — sem esta linha,
                      "parou de entrar gente no funil" não teria nenhum
                      sintoma visível. Por isso resolvemos o nome contra a
                      lista, em vez de confiar no id salvo. */}
                  {(() => {
                    const classe = 'mt-1 text-xs text-muted-foreground';
                    if (!channel.default_pipeline_id) {
                      return <p className={classe}>{t('noPipeline')}</p>;
                    }
                    const funil = pipelines.find(
                      (p) => p.id === channel.default_pipeline_id,
                    );
                    if (!funil) {
                      // Sem a lista não dá para afirmar que sumiu. E com a
                      // lista carregada isto é quase impossível: a FK da 908
                      // zera a coluna quando o funil é apagado. Sobra o caso
                      // raro de outra aba ter apagado agora há pouco.
                      return (
                        <p className={classe}>
                          {pipelinesCarregados ? t('pipelineMissing') : t('pipelineUnknown')}
                        </p>
                      );
                    }
                    const etapa = channel.default_stage_id
                      ? stages.find((s) => s.id === channel.default_stage_id)
                      : null;
                    if (etapa) {
                      return (
                        <p className={classe}>
                          {t('pipelineStageBadge', {
                            pipeline: funil.name,
                            stage: etapa.name,
                          })}
                        </p>
                      );
                    }
                    // ⚠️ Funil escolhido SEM etapa de entrada não é "quase
                    // configurado": `createDeal` cai na etapa de menor
                    // `position`, e no funil real desta conta a posição 0 é
                    // "Contato Avulso" — uma faixa de estacionamento. O lead
                    // entra, mas no lugar errado, e a etiqueta antiga dizia só
                    // "Entra no funil Bancário", como se estivesse pronto.
                    // Este é o único sintoma visível de uma meia-configuração.
                    return (
                      <p className="mt-1 text-xs text-amber-500">
                        {t('pipelineNoStage', { pipeline: funil.name })}
                      </p>
                    );
                  })()}
                  {channel.last_error && (
                    <p className="mt-1 truncate text-xs text-destructive">
                      {t('lastError', { error: channel.last_error })}
                    </p>
                  )}
                </div>

                <RequireRole min="admin">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Canal Evolution tem botão em QUALQUER estado, e são
                        dois gestos diferentes:

                        - desconectado → parear pelo QR;
                        - conectado    → RESSINCRONIZAR, que reaplica a lista
                          de eventos do webhook. A Evolution congela essa
                          lista por instância no registro, então um evento
                          novo no código (foi o caso de MESSAGES_DELETE) não
                          alcança quem já está conectado. Esconder o botão
                          com o canal conectado deixava esse reparo
                          inalcançável justamente quando era necessário. */}
                    {channel.kind === 'evolution' &&
                      (channel.status === 'connected' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resyncing === channel.id}
                          onClick={() => void ressincronizar(channel.id)}
                          title={t('resyncHint')}
                        >
                          {resyncing === channel.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                          )}
                          {t('resyncAction')}
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => openQrFor(channel.id, null)}>
                          <QrCode className="mr-2 h-4 w-4" />
                          {t('connect')}
                        </Button>
                      ))}
                    {/* REPAREAR. Sem condição de status de propósito: o caso
                        que ele existe para resolver é justamente o canal que
                        SE DIZ conectado e não entrega nada. Amarrá-lo a
                        `status !== 'connected'` o esconderia exatamente
                        quando é necessário — o erro que já escondia o botão
                        de parear. */}
                    {channel.kind === 'evolution' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('restartAction')}
                        title={t('restartHint')}
                        onClick={() => setConfirmRestart(channel)}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                    {/* Texto visível, não só ícone: quem procura "funil" não
                        adivinha que ele mora atrás de um lápis mudo. */}
                    <Button variant="outline" size="sm" onClick={() => abrirConfig(channel)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      {t('configureAction')}
                    </Button>
                    {!channel.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={promotingId === channel.id}
                        onClick={() => handleSetDefault(channel)}
                        title={t('setDefaultHint')}
                      >
                        {promotingId === channel.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Star className="mr-2 h-4 w-4" />
                        )}
                        {t('setDefaultAction')}
                      </Button>
                    )}
                    {/* SEM `!channel.is_default`. Toda conta hoje tem uma
                        conexão só, e ela é a padrão — a condição antiga fazia
                        a lixeira desaparecer justamente de todo canal
                        existente. A regra de negócio (não deixar a conta sem
                        WhatsApp, nomear o sucessor) mora no servidor e no
                        diálogo, que é onde dá para explicá-la. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('deleteAction')}
                      disabled={deletingId === channel.id}
                      onClick={() => {
                        setConfirmDelete(channel);
                        setSuccessorId(
                          channels.find((c) => c.id !== channel.id)?.id ?? '',
                        );
                      }}
                    >
                      {deletingId === channel.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
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

      {/* Configurar — nome + funil padrão */}
      <Dialog
        open={configTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfigTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('configureTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cb-config-label">{t('labelField')}</Label>
              <Input
                id="cb-config-label"
                value={configLabel}
                onChange={(e) => setConfigLabel(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="cb-config-pipeline">{t('pipelineField')}</Label>
              <select
                id="cb-config-pipeline"
                value={configPipeline}
                onChange={(e) => {
                  setConfigPipeline(e.target.value);
                  // Etapa pertence ao funil: a FK composta da 908 rejeita o
                  // par órfão, então trocar de funil tem de limpar a etapa.
                  setConfigStage('');
                }}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">{t('pipelineNone')}</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{t('pipelineHint')}</p>
            </div>

            {configPipeline && (
              <div>
                <Label htmlFor="cb-config-stage">{t('stageField')}</Label>
                <select
                  id="cb-config-stage"
                  value={configStage}
                  onChange={(e) => setConfigStage(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">{t('stageAuto')}</option>
                  {stages
                    .filter((s) => s.pipeline_id === configPipeline)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
                {/* A etapa explícita importa: a de menor posição costuma ser
                    faixa de estacionamento ("Contato Avulso"), não a entrada
                    do processo. */}
                <p className="mt-1 text-xs text-muted-foreground">{t('stageHint')}</p>
              </div>
            )}

            {configPipeline && (
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {t('pipelineWarning')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigTarget(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleConfigure} disabled={saving || !configLabel.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('configureSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reparear — derruba a sessão e pede QR novo */}
      <Dialog
        open={confirmRestart !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRestart(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmRestart ? t('restartTitle', { label: confirmRestart.label }) : ''}
            </DialogTitle>
            <DialogDescription>{t('restartConfirmDesc')}</DialogDescription>
          </DialogHeader>
          {/* O CRM local roda contra a MESMA conta de produção (é assim de
              propósito, para desenvolver com o número real). Repareamento
              disparado da máquina do desenvolvedor derruba o WhatsApp DO
              ESCRITÓRIO — mesmo raio de alcance que a PR do webhook blindou,
              só que mais destrutivo. Aviso, não bloqueio: o QR aparece aqui
              mesmo e o conserto funciona daqui; travar deixaria o operador
              sem saída quando ele estivesse legitimamente em dev. */}
          {typeof window !== 'undefined' && !ehUrlAlcancavel(window.location.origin) && (
            <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              {t('restartLocalWarning')}
            </div>
          )}
          <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('restartKeepsData')}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRestart(null)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleRestart} disabled={restarting}>
              {restarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('restartConfirmAction')}
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

          <div className="space-y-3 text-sm">
            {/* O que NÃO se perde — é a metade tranquilizadora, e as 12 FKs
                que apontam para cb_channels são TODAS ON DELETE SET NULL:
                nenhuma conversa, mensagem ou contato vai junto. */}
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {t('deleteKeepsHistory')}
            </p>

            {/* Efeito colateral que nada na tela avisava: o trigger
                `cb_channels_drop_from_automations` (903) tira o canal do
                escopo e DESATIVA a automação que só valia para ele. */}
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {t('deleteDisablesAutomations')}
            </p>

            {/* O funil desta conexão para de receber. `default_pipeline_id` é
                a coluna dela, então some junto com a linha — e o roteamento
                acaba sem nenhum sinal. Só aparece quando há funil configurado:
                aviso sobre algo que não existe é ruído. */}
            {confirmDelete?.default_pipeline_id && (
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {t('deleteStopsPipeline', {
                  pipeline:
                    pipelines.find((p) => p.id === confirmDelete.default_pipeline_id)
                      ?.name ?? '',
                })}
              </p>
            )}

            {/* E os negócios que ela criou perdem a origem: a FK da 908 é
                ON DELETE SET NULL em `deals.channel_id`. Eles continuam no
                funil — mas somem de qualquer recorte por número no painel,
                que é o que a etiqueta "Originados neste número" mede. */}
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {t('deleteDealsLoseOrigin')}
            </p>

            {/* Canal padrão: a conta não pode ficar sem espelho, e trocar o
                número de envio do escritório não pode ser efeito colateral
                silencioso de um clique em "excluir". Quem sucede vai nomeado. */}
            {confirmDelete?.is_default &&
              (channels.filter((c) => c.id !== confirmDelete.id).length === 0 ? (
                <p className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">
                  {/* "Use Reparear" só vale para Evolution — canal Meta não
                      tem sessão de QR e nem desenha esse botão. Mandar o
                      operador procurá-lo seria beco sem saída. */}
                  {confirmDelete.kind === 'evolution'
                    ? t('deleteLastChannel')
                    : t('deleteLastChannelMeta')}
                </p>
              ) : (
                <div>
                  <Label htmlFor="cb-successor">{t('successorField')}</Label>
                  <select
                    id="cb-successor"
                    value={successorId}
                    onChange={(e) => setSuccessorId(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  >
                    {channels
                      .filter((c) => c.id !== confirmDelete.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">{t('successorHint')}</p>
                </div>
              ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={
                deletingId !== null ||
                // Última conexão da conta: o servidor recusa (409), então o
                // botão não deve nem prometer.
                (confirmDelete?.is_default === true &&
                  channels.filter((c) => c.id !== confirmDelete.id).length === 0)
              }
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
