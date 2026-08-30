'use client';

// ============================================================
// PerfisPanel — Configurações → Perfis de acesso (Fase 5).
//
// A LEITURA é direta, sob RLS (a 956 dá SELECT a qualquer membro — a legenda
// de Membros precisa disso); toda ESCRITA passa pelas rotas /api/cb/perfis,
// em service-role, onde moram as travas (perfil sistema, papel via RPC 959,
// anti-auto-bloqueio, exclusão só sem membros).
//
// Convenções que a tela precisa DIZER, não só aplicar:
//   - escopo vazio = TODAS as conexões / TODOS os funis (convenção do
//     projeto) — sem o aviso o operador lê "nenhuma" e desconfigura;
//   - telas vazias = NENHUMA tela (assimetria deliberada, ver tipos.ts).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Loader2, Lock, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';

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
import { createClient } from '@/lib/supabase/client';
import { useChannels } from '@/hooks/use-channels';
import {
  SECOES_PESSOAIS,
  SECOES_TRAVADAS_PARA_ADMIN,
  TELAS_SEMPRE_VISIVEIS,
  TODAS_AS_SECOES,
  TODAS_AS_TELAS,
  type SecaoId,
  type TelaId,
} from '@/lib/perfis/catalogo';
import type { PapelBase, PerfilDeAcesso } from '@/lib/perfis/tipos';
import { SECTION_META } from './settings-sections';
import { SettingsPanelHead } from './settings-panel-head';

/** TelaId → chave de rótulo do namespace Sidebar (rótulos que já existem). */
const ROTULO_DA_TELA: Record<TelaId, string> = {
  dashboard: 'dashboard',
  radar: 'radar',
  inbox: 'inbox',
  notifications: 'notifications',
  tarefas: 'tasks',
  contacts: 'contacts',
  agenda: 'agenda',
  pipelines: 'pipelines',
  broadcasts: 'broadcasts',
  agendadas: 'scheduled',
  automations: 'automations',
  flows: 'flows',
  agents: 'aiAgents',
  settings: 'settings',
};

interface Funil {
  id: string;
  name: string;
  }

interface Rascunho {
  id: string | null; // null = criando
  nome: string;
  papel_base: PapelBase;
  telas: TelaId[];
  secoes_config: SecaoId[];
  channel_ids: string[];
  pipeline_ids: string[];
}

const RASCUNHO_VAZIO: Rascunho = {
  id: null,
  nome: '',
  papel_base: 'agent',
  telas: [],
  secoes_config: [],
  channel_ids: [],
  pipeline_ids: [],
};

export function PerfisPanel() {
  const t = useTranslations('PerfisPanel');
  const tSidebar = useTranslations('Sidebar');
  const tRoles = useTranslations('Settings.roles');
  const supabase = useMemo(() => createClient(), []);
  const { channels } = useChannels();

  const [perfis, setPerfis] = useState<PerfilDeAcesso[]>([]);
  const [membrosPorPerfil, setMembrosPorPerfil] = useState<Map<string, number>>(
    new Map(),
  );
  const [funis, setFunis] = useState<Funil[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [semeando, setSemeando] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [apagando, setApagando] = useState<PerfilDeAcesso | null>(null);

  const carregar = useCallback(async () => {
    const [perfisRes, funisRes, membrosRes] = await Promise.all([
      supabase
        .from('cb_perfis_de_acesso')
        .select('*')
        .order('sistema', { ascending: false })
        .order('nome'),
      supabase.from('pipelines').select('id, name').order('name'),
      supabase.from('profiles').select('perfil_id'),
    ]);
    if (perfisRes.error) {
      console.error('[PerfisPanel] load error:', perfisRes.error);
      toast.error(t('loadError'));
      setCarregando(false);
      return;
    }
    setPerfis((perfisRes.data ?? []) as PerfilDeAcesso[]);
    setFunis((funisRes.data ?? []) as Funil[]);
    const contagem = new Map<string, number>();
    for (const linha of membrosRes.data ?? []) {
      if (linha.perfil_id) {
        contagem.set(linha.perfil_id, (contagem.get(linha.perfil_id) ?? 0) + 1);
      }
    }
    setMembrosPorPerfil(contagem);
    setCarregando(false);
  }, [supabase, t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function semearPadrao() {
    setSemeando(true);
    try {
      const res = await fetch('/api/cb/perfis/padrao', { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('seedError'));
        return;
      }
      toast.success(t('seedOk', { count: payload.criados ?? 0 }));
      await carregar();
    } finally {
      setSemeando(false);
    }
  }

  async function salvar() {
    if (!rascunho) return;
    setSalvando(true);
    try {
      const corpo = {
        nome: rascunho.nome,
        papel_base: rascunho.papel_base,
        telas: rascunho.telas,
        secoes_config: rascunho.secoes_config,
        channel_ids: rascunho.channel_ids,
        pipeline_ids: rascunho.pipeline_ids,
      };
      const res = await fetch(
        rascunho.id ? `/api/cb/perfis/${rascunho.id}` : '/api/cb/perfis',
        {
          method: rascunho.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('saveError'));
        return;
      }
      if ((payload.membrosAtualizados ?? 0) > 0) {
        toast.success(t('saveOkComMembros', { count: payload.membrosAtualizados }));
      } else {
        toast.success(t('saveOk'));
      }
      setRascunho(null);
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function apagar() {
    if (!apagando) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/cb/perfis/${apagando.id}`, {
        method: 'DELETE',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('deleteError'));
        return;
      }
      toast.success(t('deleteOk'));
      setApagando(null);
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  function editar(p: PerfilDeAcesso) {
    setRascunho({
      id: p.id,
      nome: p.nome,
      papel_base: p.papel_base,
      telas: p.telas,
      secoes_config: p.secoes_config,
      channel_ids: p.channel_ids,
      pipeline_ids: p.pipeline_ids,
    });
  }

  /** Duplicar: o antídoto para a multiplicação por área — nasce editável. */
  function duplicar(p: PerfilDeAcesso) {
    setRascunho({
      id: null,
      nome: t('copyName', { nome: p.nome }),
      papel_base: p.papel_base,
      telas: p.telas,
      secoes_config: p.secoes_config,
      channel_ids: p.channel_ids,
      pipeline_ids: p.pipeline_ids,
    });
  }

  /** Sugere os funis a partir do funil padrão das conexões marcadas. */
  function sugerirFunis() {
    if (!rascunho) return;
    const sugeridos = new Set(rascunho.pipeline_ids);
    for (const canal of channels) {
      if (
        rascunho.channel_ids.includes(canal.id) &&
        canal.default_pipeline_id &&
        funis.some((f) => f.id === canal.default_pipeline_id)
      ) {
        sugeridos.add(canal.default_pipeline_id);
      }
    }
    setRascunho({ ...rascunho, pipeline_ids: [...sugeridos] });
  }

  function alternar<T extends string>(lista: T[], valor: T): T[] {
    return lista.includes(valor)
      ? lista.filter((v) => v !== valor)
      : [...lista, valor];
  }

  const papelChip = (papel: PapelBase) => (
    <Badge variant="outline" className="border-border text-muted-foreground">
      {papel === 'admin'
        ? tRoles('admin')
        : papel === 'agent'
          ? tRoles('agent')
          : tRoles('viewer')}
    </Badge>
  );

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button
            onClick={() => setRascunho({ ...RASCUNHO_VAZIO })}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            {t('newProfile')}
          </Button>
        }
      />

      {carregando ? (
        <Card className="border-border bg-card">
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t('loading')}
          </CardContent>
        </Card>
      ) : perfis.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
            <Button
              onClick={semearPadrao}
              disabled={semeando}
              variant="outline"
              className="border-border"
            >
              {semeando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {t('seedButton')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {perfis.map((p) => {
            const membros = membrosPorPerfil.get(p.id) ?? 0;
            return (
              <Card key={p.id} className="border-border bg-card">
                <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {p.sistema && (
                        <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm font-medium text-foreground">
                        {p.nome}
                      </span>
                      {papelChip(p.papel_base)}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('rowSummary', {
                        telas: p.telas.length,
                        membros,
                      })}
                      {' · '}
                      {p.channel_ids.length === 0
                        ? t('allChannels')
                        : t('someChannels', { count: p.channel_ids.length })}
                      {' · '}
                      {p.pipeline_ids.length === 0
                        ? t('allPipelines')
                        : t('somePipelines', { count: p.pipeline_ids.length })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => duplicar(p)}
                      title={t('duplicate')}
                    >
                      <Copy className="size-4" />
                    </Button>
                    {!p.sistema && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => editar(p)}
                          title={t('edit')}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setApagando(p)}
                          title={t('delete')}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ---------- Editor ---------- */}
      <Dialog
        open={rascunho !== null}
        onOpenChange={(open) => {
          if (!open) setRascunho(null);
        }}
      >
        <DialogContent className="bg-popover border-border max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {rascunho && (
            <>
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">
                  {rascunho.id ? t('editTitle') : t('createTitle')}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {t('editorDescription')}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4 py-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label className="text-muted-foreground">{t('nameLabel')}</Label>
                    <Input
                      value={rascunho.nome}
                      onChange={(e) =>
                        setRascunho({ ...rascunho, nome: e.target.value })
                      }
                      placeholder={t('namePlaceholder')}
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="text-muted-foreground">{t('roleLabel')}</Label>
                    <Select
                      value={rascunho.papel_base}
                      onValueChange={(v) =>
                        setRascunho({ ...rascunho, papel_base: v as PapelBase })
                      }
                    >
                      <SelectTrigger className="border-border bg-muted text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                        <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                        <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t('roleHint')}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground">{t('telasLabel')}</Label>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {TODAS_AS_TELAS.map((tela) => {
                      const travada = (TELAS_SEMPRE_VISIVEIS as readonly string[]).includes(tela);
                      const marcada = travada || rascunho.telas.includes(tela);
                      return (
                        <label
                          key={tela}
                          className={`flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs ${travada ? 'opacity-60' : 'cursor-pointer hover:bg-muted'}`}
                        >
                          <Checkbox
                            checked={marcada}
                            disabled={travada}
                            onCheckedChange={() =>
                              setRascunho({
                                ...rascunho,
                                telas: alternar(rascunho.telas, tela),
                              })
                            }
                          />
                          <span className="text-foreground">
                            {tSidebar(ROTULO_DA_TELA[tela])}
                          </span>
                          {travada && <Lock className="size-3 text-muted-foreground" />}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('telasHint')}</p>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground">{t('secoesLabel')}</Label>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {TODAS_AS_SECOES.filter(
                      (s) => !(SECOES_PESSOAIS as readonly string[]).includes(s),
                    ).map((secao) => {
                      const travadaAdmin =
                        rascunho.papel_base === 'admin' &&
                        (SECOES_TRAVADAS_PARA_ADMIN as readonly string[]).includes(secao);
                      const marcada =
                        travadaAdmin || rascunho.secoes_config.includes(secao);
                      // A seção `perfis` ainda não existe no rail (chega nesta
                      // fase); mostra com o rótulo próprio.
                      const rotulo =
                        secao in SECTION_META
                          ? SECTION_META[secao as keyof typeof SECTION_META].label
                          : t('secaoPerfis');
                      return (
                        <label
                          key={secao}
                          className={`flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs ${travadaAdmin ? 'opacity-60' : 'cursor-pointer hover:bg-muted'}`}
                        >
                          <Checkbox
                            checked={marcada}
                            disabled={travadaAdmin}
                            onCheckedChange={() =>
                              setRascunho({
                                ...rascunho,
                                secoes_config: alternar(
                                  rascunho.secoes_config,
                                  secao,
                                ),
                              })
                            }
                          />
                          <span className="text-foreground">{rotulo}</span>
                          {travadaAdmin && (
                            <Lock className="size-3 text-muted-foreground" />
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('secoesHint')}</p>
                </div>

                {channels.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <Label className="text-muted-foreground">
                      {t('canaisLabel')}
                    </Label>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {channels.map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted"
                        >
                          <Checkbox
                            checked={rascunho.channel_ids.includes(c.id)}
                            onCheckedChange={() =>
                              setRascunho({
                                ...rascunho,
                                channel_ids: alternar(
                                  rascunho.channel_ids,
                                  c.id,
                                ),
                              })
                            }
                          />
                          <span className="truncate text-foreground">{c.label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('escopoVazioHint')}
                    </p>
                  </div>
                )}

                {funis.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-muted-foreground">
                        {t('funisLabel')}
                      </Label>
                      {rascunho.channel_ids.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={sugerirFunis}
                          className="h-7 text-xs text-primary"
                        >
                          <Sparkles className="size-3.5" />
                          {t('sugerirFunis')}
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {funis.map((f) => (
                        <label
                          key={f.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted"
                        >
                          <Checkbox
                            checked={rascunho.pipeline_ids.includes(f.id)}
                            onCheckedChange={() =>
                              setRascunho({
                                ...rascunho,
                                pipeline_ids: alternar(
                                  rascunho.pipeline_ids,
                                  f.id,
                                ),
                              })
                            }
                          />
                          <span className="truncate text-foreground">{f.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="bg-popover border-border">
                <Button
                  variant="outline"
                  onClick={() => setRascunho(null)}
                  className="border-border text-popover-foreground"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={salvar}
                  disabled={salvando || rascunho.nome.trim() === ''}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {salvando && <Loader2 className="size-4 animate-spin" />}
                  {t('save')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- Confirmação de exclusão ---------- */}
      <Dialog
        open={apagando !== null}
        onOpenChange={(open) => {
          if (!open) setApagando(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteTitle', { nome: apagando?.nome ?? '' })}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteBody')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setApagando(null)}
              className="border-border text-popover-foreground"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={apagar}
              disabled={salvando}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {salvando && <Loader2 className="size-4 animate-spin" />}
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
