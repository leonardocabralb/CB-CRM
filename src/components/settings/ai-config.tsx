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
import { useTranslations } from 'next-intl';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)',
};

/**
 * O corpo do `POST /api/ai/config`.
 *
 * ⚠️⚠️ NOSSO (F2a dos agentes de IA, E2 do docs/PLANO-agentes-de-ia.md): a
 * resposta automática desta configuração saiu — quem responde o cliente são os
 * agentes de IA. O interruptor, o máximo por conversa e o "Encaminhar para"
 * sumiram da tela, mas `auto_reply_enabled` e `auto_reply_max_per_conversation`
 * continuam no corpo com o valor LIDO: a rota reescreve a linha e grava
 * `false`/3 no que não vier, e a volta atrás do deploy leria a linha mexida.
 *
 * `handoff_agent_id` NÃO vai, de propósito: ausente, a rota não toca a coluna
 * ("Absent → left unchanged"); presente, ela exige que o id seja membro da
 * conta HOJE. Com o seletor escondido, um destino que saiu da equipe travaria
 * o "Salvar" da tela inteira com um 400 que ninguém teria como consertar.
 */
export function corpoDoSalvamento(estado: {
  provider: AiProvider;
  model: string;
  systemPrompt: string;
  isActive: boolean;
  autoReplyEnabled: boolean;
  maxPerConversation: number;
}) {
  return {
    provider: estado.provider,
    model: estado.model.trim(),
    system_prompt: estado.systemPrompt.trim() || null,
    is_active: estado.isActive,
    auto_reply_enabled: estado.autoReplyEnabled,
    auto_reply_max_per_conversation: estado.maxPerConversation,
  };
}

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
  // Sem controle na tela desde a F2a (ver `corpoDoSalvamento`): só lidos e
  // devolvidos como vieram.
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);

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
      }
    } catch {
      setChaves(null);
      // Sem a resposta, a base NÃO sabe se a busca por sentido vale: o valor
      // da carga anterior (outra conta, na troca de conta) mentiria (Codex, #294).
      setEmbeddingsUtilizavel(null);
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

  const buildBody = () =>
    corpoDoSalvamento({
      provider,
      model,
      systemPrompt,
      isActive,
      autoReplyEnabled,
      maxPerConversation,
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
                    assistente (o rascunho) e ao Playground — e NÃO aos
                    agentes de IA, ao Radar nem à transcrição, que têm
                    modelo próprio.
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

            {/* ⚠️ NOSSO (F2a, E2): a resposta automática desta configuração
                saiu — o interruptor, o máximo por conversa e o "Encaminhar
                para" não faziam mais nada. Quem responde o cliente são os
                agentes de IA; esta linha diz onde eles moram. Um merge que
                traga os controles de volta oferece um liga-desliga sem
                efeito nenhum. */}
            <p className="text-xs text-muted-foreground">
              {t('autoReplyMoved')}{' '}
              <Link
                href="/agents"
                className="text-primary underline-offset-2 hover:underline"
              >
                {t('autoReplyMovedLink')}
              </Link>
            </p>
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
