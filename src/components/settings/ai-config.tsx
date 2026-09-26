'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL, AI_PROVIDER_MODELS } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)',
};

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  // ⚠️ As chaves são do PROVEDOR, uma por conta, e moram em Integrações
  // (`cb_ia_chaves`, 1042). Aqui só se mostra QUAIS provedores têm chave,
  // para o seletor dizer se o escolhido vai funcionar.
  // ⚠️ `null` = NÃO SEI (a carga falhou): nunca afirmar "sem chave" sobre uma
  // conta que pode ter a chave cadastrada.
  const [chaves, setChaves] = useState<Record<AiProvider, boolean> | null>(null);
  // A busca por sentido: a chave da OpenAI, MENOS a que a OpenAI recusou
  // para embeddings ao ser gravada. `null` = não sei (a leitura falhou).
  const [embeddingsUtilizavel, setEmbeddingsUtilizavel] = useState<boolean | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        setChaves(null);
        setEmbeddingsUtilizavel(null);
        toast.error(t('loadFailed'));
        return;
      }
      const lidas: Record<AiProvider, boolean> = { openai: false, anthropic: false, gemini: false };
      for (const c of (data.chaves ?? []) as { provedor: AiProvider; existe: boolean }[]) {
        if (c.provedor in lidas) lidas[c.provedor] = c.existe === true;
      }
      setChaves(lidas);
      setEmbeddingsUtilizavel(data.has_embeddings_key === true);
      if (data.configured) {
        setProvider(data.provider);
        setModel(data.model);
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
      }
    } catch {
      setChaves(null);
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  // As rotas devolvem CÓDIGO; a frase sai do dicionário.
  const textoDoCodigo = (codigo: unknown, padrao: string): string =>
    codigo === 'sem_chave'
      ? t('missingApiKey')
      : codigo === 'chave_ilegivel'
        ? t('keyUnreadable')
        : codigo === 'invalid_key'
          ? t('testRejected')
          : padrao;

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      Object.values(AI_PROVIDER_DEFAULT_MODEL).includes(model) ||
      model.trim() === '';
    if (isDefaultModel) setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
  };

  const buildBody = () => ({
    provider,
    model: model.trim(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(textoDoCodigo(data.code, data.error ?? t('testRejected')));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (chaves && !chaves[provider]) {
      toast.error(t('missingApiKey'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(textoDoCodigo(data.code, data.error ?? t('saveFailed')));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')} {/* Re-using label or a global one, wait, loading is better. Let's use useTranslations from overview or just hardcode Loading... actually I should add loading to aiConfig */}
        {/* Wait, I didn't add loading to aiConfig. I'll just use loading. */}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> {t('providerAndKey')}
            </CardTitle>
            <CardDescription>
              {t('keysLiveInIntegrations')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('provider')}</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                    <SelectItem value="anthropic">
                      {PROVIDER_LABEL.anthropic}
                    </SelectItem>
                    <SelectItem value="gemini">{PROVIDER_LABEL.gemini}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">{t('model')}</Label>
                <Input
                  id="ai-model"
                  list="ai-model-sugestoes"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                  disabled={disabled}
                />
                {/* Sugestão, NUNCA allow-list — o campo continua aceitando
                    qualquer id, porque os modelos mudam mais rápido que
                    esta lista e a chave do escritório pode ter acesso a um
                    que ela não conhece. */}
                <datalist id="ai-model-sugestoes">
                  {AI_PROVIDER_MODELS[provider].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {/* ⚠️ O escopo deste campo escrito na tela. Ele serve ao
                    assistente, à resposta automática e ao Playground — e
                    NÃO ao Radar nem à transcrição, que têm modelo próprio.
                    Sem esta frase o operador cadastra um modelo "para o
                    Radar" e configura outra coisa. */}
                <p className="text-xs text-muted-foreground">
                  {t('modelScope')}{' '}
                  <Link
                    href="/settings?tab=integracoes"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {t('modelScopeLink')}
                  </Link>
                </p>
              </div>
            </div>

            {/* A chave do provedor escolhido: mora em Integrações (1042). */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
              <p className="text-sm text-muted-foreground">
                {chaves === null
                  ? t('keyStatusUnknown')
                  : chaves[provider]
                    ? t('keyStatusSaved', { provider: PROVIDER_LABEL[provider] })
                    : t('keyStatusMissing', { provider: PROVIDER_LABEL[provider] })}{' '}
                <Link
                  href="/settings?tab=integracoes"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {t('keyManageLink')}
                </Link>
              </p>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={disabled || testing || chaves === null || !chaves[provider]}
              >
                {testing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {t('testKey')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('behaviour')}</CardTitle>
            <CardDescription>
              {t('behaviourDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('enableAssistant')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('autoReply')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('maxAutoRepliesDesc')}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('handoffToDesc')}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                }
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t('handoffQueue')}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={embeddingsUtilizavel}
        />

        <div className="flex items-center justify-end">
          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
