'use client';

// ============================================================
// ApiKeysSettings — Settings → API → aba Chaves
//
// Manage the credentials that authenticate the public REST API
// (`/api/v1/*`). Any member sees the roster (read-only); admin+ can
// mint and revoke (gated by <RequireRole min="admin"> here and the
// admin-only API routes + RLS on the server).
//
// Desde que a seção API ganhou sub-abas (Chaves | IDs | Documentação), o
// cabeçalho da SEÇÃO é do `ApiPanel`; aqui fica só o corpo da aba — a frase
// de como a chave viaja e o botão "Nova chave", que só faz sentido nesta
// aba. O spinner cobre só a LISTA: a frase e o botão não dependem da carga.
//
// ⚠️ Carga que FALHOU não é "nenhuma chave ainda". Até aqui a falha virava
// toast e a lista vazia embaixo afirmava "Nenhuma chave de API ainda" — e o
// admin criava outra chave para substituir as que continuavam valendo (a
// armadilha da lista vazia virando afirmação, no CLAUDE.md). Agora a falha
// com a lista vazia tem estado próprio, com "tentar de novo".
//
// One-time reveal: a freshly-minted key's plaintext is shown ONCE in
// the creation dialog. After it closes, only the prefix remains —
// the server stores just the hash. The UI states this explicitly so
// the absence of a "copy again" button reads as intentional, not a
// bug (same lesson as the invite-link flow).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2, Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { useMembros } from '@/hooks/use-membros';
import { OPCOES_DE_VALIDADE_DIAS } from '@/lib/api-keys/configuracao';
import {
  API_SCOPES,
  SCOPE_DESCRIPTIONS,
  ehEscopoDeLeitura,
  isApiScope,
  type ApiScope,
} from '@/lib/api-keys/scopes';
import { createClient } from '@/lib/supabase/client';
import type { AccountMember } from '@/types';
import { useTranslations } from 'next-intl';
import { FONTE_MONO } from './copiar';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** NOSSO (1120): o funcionário dono (nulo = chave da conta). */
  membro_user_id: string | null;
  /** NOSSO (1120): os funis que a chave vê (nulo = todos). */
  funis: string[] | null;
}

interface Funil {
  id: string;
  name: string;
}

/** Sentinela do "Nenhum (chave da conta)" no seletor: o Select não aceita ''. */
const SEM_FUNCIONARIO = '__conta__';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function keyStatus(k: ApiKey): 'active' | 'revoked' | 'expired' {
  if (k.revoked_at) return 'revoked';
  if (k.expires_at && new Date(k.expires_at).getTime() <= Date.now())
    return 'expired';
  return 'active';
}

/** O que o diálogo da chave está fazendo: criar uma nova ou editar uma. */
type Dialogo = { modo: 'criar' } | { modo: 'editar'; chave: ApiKey } | null;

export function ApiKeysSettings() {
  const { canEditSettings, accountId } = useAuth();
  const t = useTranslations('Settings.apiKeys');
  const tSecao = useTranslations('Settings.secaoApi');

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // NOSSO (1120): nomes para a lista e opções para o diálogo. `undefined` =
  // ainda não chegou; `null` = falhou — nunca "a conta não tem funil".
  const { membros, carregando: membrosCarregando, falhou: membrosFalhou } = useMembros();
  const [funis, setFunis] = useState<Funil[] | null | undefined>(undefined);
  useEffect(() => {
    if (!accountId) return;
    let cancelado = false;
    void (async () => {
      // ⚠️ `account_id` explícito: a RLS da 1032 devolve os funis de TODA conta
      // da pessoa, e a chave só aceita funil desta (o servidor confere de novo).
      const { data, error } = await createClient()
        .from('pipelines')
        .select('id, name')
        .eq('account_id', accountId)
        .order('name');
      if (cancelado) return;
      if (error) {
        console.error('[ApiKeysSettings] pipelines load error:', error.message);
        setFunis(null);
        return;
      }
      setFunis((data ?? []) as Funil[]);
    })();
    return () => {
      cancelado = true;
    };
  }, [accountId]);

  function nomeDoMembro(userId: string): string | null {
    return membros.find((m) => m.user_id === userId)?.full_name ?? null;
  }

  function nomesDosFunis(ids: string[]): string | null {
    if (!funis) return null; // carregando ou falhou: não afirma nome nenhum
    return ids
      .map((id) => funis.find((f) => f.id === id)?.name ?? t('pipelineGone'))
      .join(', ');
  }

  /** "Funcionário: Ana · Funis: Trabalhista - Comercial", ou nada. */
  function resumoDoRecorte(k: ApiKey): string | null {
    const partes: string[] = [];
    if (k.membro_user_id && !membrosCarregando && !membrosFalhou) {
      const nome = nomeDoMembro(k.membro_user_id);
      partes.push(nome ? t('ofMember', { name: nome }) : t('memberGone'));
    }
    if (k.funis) {
      const nomes = nomesDosFunis(k.funis);
      if (nomes !== null) partes.push(t('onlyPipelines', { names: nomes }));
    }
    return partes.length > 0 ? partes.join(' · ') : null;
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/api-keys', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('loadFailed'));
        setFalhou(true);
        return;
      }
      const data = (await res.json()) as { keys: ApiKey[] };
      setKeys(data.keys);
      setFalhou(false);
    } catch (err) {
      console.error('[ApiKeysSettings] load error:', err);
      toast.error(t('networkError'));
      setFalhou(true);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(key: ApiKey) {
    setRevoking(key.id);
    try {
      const res = await fetch(`/api/account/api-keys/${key.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('revokeFailed'));
        return;
      }
      toast.success(t('revokeSuccess', { name: key.name }));
      // Reflect the revoke locally without a refetch.
      setKeys((prev) =>
        prev.map((k) =>
          k.id === key.id ? { ...k, revoked_at: new Date().toISOString() } : k
        )
      );
    } catch (err) {
      console.error('[ApiKeysSettings] revoke error:', err);
      toast.error(t('networkError'));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-muted-foreground max-w-[62ch] min-w-0 text-sm">
          {t.rich('description', {
            apiCode: (chunks: React.ReactNode) => <code className="text-xs">{chunks}</code>,
            headerCode: (chunks: React.ReactNode) => <code className="text-xs">{chunks}</code>,
          })}
        </p>
        <RequireRole min="admin">
          <Button onClick={() => setDialogo({ modo: 'criar' })} className="shrink-0 self-start">
            <Plus className="size-4" />
            {t('newApiKey')}
          </Button>
        </RequireRole>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      ) : falhou && keys.length === 0 ? (
        // A recarga que falha DEPOIS de criar uma chave cai aqui só se a
        // lista estava vazia; com chaves na tela, elas ficam (o toast avisa).
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <p className="text-muted-foreground text-sm">{t('loadFailed')}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              <RotateCw className="size-3.5" />
              {tSecao('tentarDeNovo')}
            </Button>
          </CardContent>
        </Card>
      ) : keys.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <KeyRound className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">
              {t('noApiKeys')}
            </p>
            {canEditSettings ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t.rich('createOneHint', {
                  bold: (chunks: React.ReactNode) => (
                    <span className="text-foreground">{chunks}</span>
                  ),
                })}
              </p>
            ) : (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('askAdminHint')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {keys.map((k) => {
                const status = keyStatus(k);
                const inactive = status !== 'active';
                return (
                  <li
                    key={k.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm font-medium ${
                            inactive
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground'
                          }`}
                        >
                          {k.name}
                        </span>
                        {status === 'revoked' && (
                          <Badge className="border-border bg-muted text-muted-foreground text-[10px] tracking-wide uppercase">
                            {t('revoked')}
                          </Badge>
                        )}
                        {status === 'expired' && (
                          <Badge className="border-border bg-muted text-muted-foreground text-[10px] tracking-wide uppercase">
                            {t('expired')}
                          </Badge>
                        )}
                      </div>
                      {/* Fonte mono EXPLÍCITA: a classe `font-mono` do projeto
                          cai na Inter (ver `copiar.tsx`). */}
                      <p
                        className="text-muted-foreground mt-0.5 text-xs"
                        style={{ fontFamily: FONTE_MONO }}
                      >
                        {k.key_prefix}…
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {k.scopes.length === 0 ? (
                          <span className="text-muted-foreground text-xs">
                            {t('noScopes')}
                          </span>
                        ) : (
                          k.scopes.map((s) => (
                            <Badge
                              key={s}
                              className="border-border bg-muted text-muted-foreground text-[10px]"
                            >
                              {s}
                            </Badge>
                          ))
                        )}
                      </div>
                      {/* NOSSO (1120): de quem é a chave e o que ela vê. Sem
                          funcionário nem funis, nada aparece (a chave de
                          sempre). Nome que ainda não chegou fica de fora,
                          nunca vira "fora da equipe". */}
                      {resumoDoRecorte(k) && (
                        <p className="text-muted-foreground mt-1.5 min-w-0 text-xs">
                          {resumoDoRecorte(k)}
                        </p>
                      )}
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        {t('created', { date: fmtDate(k.created_at) })}
                        {' · '}
                        {k.last_used_at
                          ? t('lastUsed', { date: fmtDate(k.last_used_at) })
                          : t('neverUsed')}
                        {k.expires_at && status !== 'expired'
                          ? ` · ${t('expires', { date: fmtDate(k.expires_at) })}`
                          : ''}
                      </p>
                    </div>

                    {status === 'active' && (
                      <RequireRole min="admin">
                        <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                          {/* NOSSO (1120): o admin edita a chave sem gerar outra. */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDialogo({ modo: 'editar', chave: k })}
                          >
                            <Pencil className="size-4" />
                            {t('edit')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRevoke(k)}
                            disabled={revoking === k.id}
                            className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                          >
                            {revoking === k.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                            {t('revoke')}
                          </Button>
                        </div>
                      </RequireRole>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* `key` por chave: o diálogo guarda rascunho, e trocar de chave (ou
          de criar para editar) recomeça o formulário do zero. */}
      <KeyDialog
        key={dialogo?.modo === 'editar' ? `editar:${dialogo.chave.id}` : 'criar'}
        dialogo={dialogo}
        onClose={() => setDialogo(null)}
        onSaved={load}
        membros={membros}
        membrosCarregando={membrosCarregando}
        membrosFalhou={membrosFalhou}
        funis={funis}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Diálogo da chave — criar (formulário → a chave inteira, UMA vez) ou
// editar (NOSSO, 1120: o mesmo formulário sobre a chave existente; o
// segredo não muda).
//
// NOSSO (1120): validade (padrão 90 dias, decisão do operador), funcionário
// dono e funis. Chave com funis é SÓ DE LEITURA: os escopos de escrita
// ficam desmarcados e travados (o servidor recusa de novo).
// ------------------------------------------------------------

type Validade = 'manter' | 'sem' | `${(typeof OPCOES_DE_VALIDADE_DIAS)[number]}`;

function mesmosItens(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function KeyDialog({
  dialogo,
  onClose,
  onSaved,
  membros,
  membrosCarregando,
  membrosFalhou,
  funis,
}: {
  dialogo: Dialogo;
  onClose: () => void;
  onSaved: () => void;
  membros: AccountMember[];
  membrosCarregando: boolean;
  membrosFalhou: boolean;
  /** Os funis da conta; `undefined` = carregando, `null` = a leitura falhou. */
  funis: Funil[] | null | undefined;
}) {
  const t = useTranslations('Settings.apiKeys');
  const chave = dialogo?.modo === 'editar' ? dialogo.chave : null;
  const editando = chave !== null;

  // Semeado na MONTAGEM: o `key` do pai remonta o diálogo a cada chave.
  const [name, setName] = useState(chave?.name ?? '');
  const [scopes, setScopes] = useState<ApiScope[]>(
    (chave?.scopes ?? []).filter((s): s is ApiScope => isApiScope(s))
  );
  const [validade, setValidade] = useState<Validade>(editando ? 'manter' : '90');
  const [membro, setMembro] = useState<string>(chave?.membro_user_id ?? SEM_FUNCIONARIO);
  const [funisEscolhidos, setFunisEscolhidos] = useState<string[]>(chave?.funis ?? []);
  const [submitting, setSubmitting] = useState(false);
  // Once set, we switch from the form to the reveal view.
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const recortada = funisEscolhidos.length > 0;

  function toggleScope(scope: ApiScope, checked: boolean) {
    setScopes((prev) =>
      checked ? [...prev, scope] : prev.filter((s) => s !== scope)
    );
  }

  function toggleFunil(id: string, checked: boolean) {
    const proximos = checked
      ? [...funisEscolhidos, id]
      : funisEscolhidos.filter((f) => f !== id);
    setFunisEscolhidos(proximos);
    // Recortada só lê: ao recortar, a escrita sai junto (e a caixa trava).
    if (proximos.length > 0) setScopes((s) => s.filter(ehEscopoDeLeitura));
  }

  function marcarSoLeitura() {
    setScopes(API_SCOPES.filter(ehEscopoDeLeitura));
  }

  // Membros que se pode ESCOLHER: os ativos. O atual (se suspenso ou fora da
  // lista) fica visível como opção, para o seletor não mostrar vazio.
  const opcoesDeMembro = membros.filter((m) => !m.suspenso_em);
  const atual = chave?.membro_user_id
    ? membros.find((m) => m.user_id === chave.membro_user_id)
    : undefined;
  const rotuloDoMembro = (userId: string): string => {
    if (userId === SEM_FUNCIONARIO) return t('memberNone');
    const m = membros.find((x) => x.user_id === userId);
    if (!m) return t('memberGone');
    return m.suspenso_em ? t('memberSuspended', { name: m.full_name }) : m.full_name;
  };

  function rotuloDaValidade(v: Validade): string {
    if (v === 'manter') {
      return chave?.expires_at
        ? t('validityKeepUntil', { date: fmtDate(chave.expires_at) })
        : t('validityKeepNever');
    }
    if (v === 'sem') return t('validityNever');
    return v === '90' ? t('validityDaysDefault', { days: Number(v) }) : t('validityDays', { days: Number(v) });
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('nameRequired'));
      return;
    }
    const membroUserId = membro === SEM_FUNCIONARIO ? null : membro;
    const funisDaChave = recortada ? funisEscolhidos : null;
    const expiresInDays = validade === 'sem' ? null : Number(validade);

    // Na edição vai SÓ o que mudou: reenviar o funcionário de hoje, se ele
    // estiver suspenso, faria o servidor recusar a edição inteira.
    const corpo: Record<string, unknown> = {};
    if (!chave) {
      Object.assign(corpo, { name: trimmed, scopes, membroUserId, funis: funisDaChave, expiresInDays });
    } else {
      if (trimmed !== chave.name) corpo.name = trimmed;
      if (!mesmosItens(scopes, chave.scopes)) corpo.scopes = scopes;
      if (membroUserId !== chave.membro_user_id) corpo.membroUserId = membroUserId;
      if (!mesmosItens(funisDaChave ?? [], chave.funis ?? []) || (funisDaChave === null) !== (chave.funis === null)) {
        corpo.funis = funisDaChave;
      }
      if (validade !== 'manter') corpo.expiresInDays = expiresInDays;
      if (Object.keys(corpo).length === 0) {
        onClose();
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        chave ? `/api/account/api-keys/${chave.id}` : '/api/account/api-keys',
        {
          method: chave ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || (chave ? t('editError') : t('createError')));
        return;
      }
      onSaved();
      if (chave) {
        toast.success(t('editSuccess', { name: trimmed }));
        onClose();
      } else {
        setCreatedKey(payload.plaintext as string);
      }
    } catch (err) {
      console.error('[KeyDialog] save error:', err);
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      toast.success(t('copySuccess'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <Dialog
      open={dialogo !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t('copyTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('copyDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="min-w-0 space-y-1.5">
              <Label className="text-muted-foreground">{t('apiKeyLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={createdKey}
                  className="min-w-0 text-xs"
                  style={{ fontFamily: FONTE_MONO }}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={copyKey}>
                  <Copy className="size-4" />
                  {t('copy')}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={onClose}>{t('done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {editando ? t('editKeyTitle') : t('newKeyTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {editando ? t('editKeyDesc') : t('newKeyDesc')}
              </DialogDescription>
            </DialogHeader>

            {/* Teto com rolagem: com funis e permissões, o formulário passa da
                altura de uma tela de notebook. */}
            <div className="min-w-0 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              <div className="space-y-1.5">
                <Label htmlFor="api-key-name" className="text-muted-foreground">
                  {t('nameLabel')}
                </Label>
                <Input
                  id="api-key-name"
                  value={name}
                  maxLength={80}
                  placeholder={t('namePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('validityLabel')}</Label>
                <Select value={validade} onValueChange={(v) => v && setValidade(v as Validade)}>
                  <SelectTrigger className="bg-muted border-border text-foreground w-full">
                    <SelectValue>{rotuloDaValidade(validade)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {editando && (
                      <SelectItem value="manter">{rotuloDaValidade('manter')}</SelectItem>
                    )}
                    {OPCOES_DE_VALIDADE_DIAS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {rotuloDaValidade(String(d) as Validade)}
                      </SelectItem>
                    ))}
                    <SelectItem value="sem">{t('validityNever')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">{t('validityHint')}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('memberLabel')}</Label>
                {membrosCarregando ? (
                  <p className="text-muted-foreground text-xs">{t('loadingOptions')}</p>
                ) : !membrosFalhou ? (
                  <Select value={membro} onValueChange={(v) => v && setMembro(v)}>
                    <SelectTrigger className="bg-muted border-border text-foreground w-full">
                      <SelectValue>{rotuloDoMembro(membro)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_FUNCIONARIO}>{t('memberNone')}</SelectItem>
                      {opcoesDeMembro.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name}
                        </SelectItem>
                      ))}
                      {/* O atual que não se pode escolher de novo (suspenso). */}
                      {atual?.suspenso_em && (
                        <SelectItem value={atual.user_id}>
                          {t('memberSuspended', { name: atual.full_name })}
                        </SelectItem>
                      )}
                      {chave?.membro_user_id && !atual && (
                        <SelectItem value={chave.membro_user_id}>{t('memberGone')}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-muted-foreground text-xs">{t('memberLoadFailed')}</p>
                )}
                <p className="text-muted-foreground text-xs">{t('memberHint')}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('pipelinesLabel')}</Label>
                {funis === undefined ? (
                  <p className="text-muted-foreground text-xs">{t('loadingOptions')}</p>
                ) : funis === null ? (
                  <p className="text-muted-foreground text-xs">{t('pipelinesLoadFailed')}</p>
                ) : (
                  <div className="border-border max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                    {funis.map((f) => (
                      <label key={f.id} className="flex cursor-pointer items-center gap-2.5">
                        <Checkbox
                          checked={funisEscolhidos.includes(f.id)}
                          onCheckedChange={(checked) => toggleFunil(f.id, checked === true)}
                        />
                        <span className="text-foreground min-w-0 truncate text-sm">{f.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-muted-foreground text-xs">{t('pipelinesHint')}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-muted-foreground">{t('scopesLabel')}</Label>
                  <Button type="button" variant="outline" size="sm" onClick={marcarSoLeitura}>
                    {t('readOnly')}
                  </Button>
                </div>
                {recortada && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('writeDisabledHint')}
                  </p>
                )}
                {/* Sem teto próprio: quem rola é o formulário inteiro (uma
                    rolagem só, em vez de uma caixa rolando dentro da outra). */}
                <div className="border-border space-y-2 rounded-md border p-3">
                  {API_SCOPES.map((scope) => {
                    const travado = recortada && !ehEscopoDeLeitura(scope);
                    return (
                      <label
                        key={scope}
                        className={`flex items-start gap-2.5 ${
                          travado ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                        }`}
                      >
                        <Checkbox
                          checked={scopes.includes(scope)}
                          disabled={travado}
                          onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span
                            className="text-foreground block text-xs"
                            style={{ fontFamily: FONTE_MONO }}
                          >
                            {scope}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {SCOPE_DESCRIPTIONS[scope]}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t.rich('scopesHint', {
                    code: (chunks: React.ReactNode) => (
                      <code className="text-[11px]">{chunks}</code>
                    ),
                  })}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={onClose}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {editando ? t('saving') : t('creating')}
                  </>
                ) : editando ? (
                  t('saveKey')
                ) : (
                  t('createKey')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
