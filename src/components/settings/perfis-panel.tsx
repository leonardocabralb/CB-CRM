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
import { Copy, Eye, Loader2, Lock, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';

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
import { ChannelMultiSelect } from '@/components/channels/channel-select';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { podeVerTela } from '@/lib/perfis/visibilidade';
import { ROTA_DA_TELA } from '@/lib/perfis/catalogo';
import { summarizeScope } from '@/lib/cb-channels/display';
import { useChannels } from '@/hooks/use-channels';
import type { SecaoId, TelaId } from '@/lib/perfis/catalogo';
import {
  modelosDePartida,
  semSecoesOcultas,
  type ModeloDePartida,
} from '@/lib/perfis/editor';
import type { PapelBase, PerfilDeAcesso } from '@/lib/perfis/tipos';
import { AreasDoPerfil } from './areas-do-perfil';
import { SettingsPanelHead } from './settings-panel-head';
import { PoderesDoPapel } from './poderes-do-papel';

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

/** Os três de fábrica, como ponto de partida do perfil novo (ver `partirDe`). */
const MODELOS = modelosDePartida();

export function PerfisPanel() {
  const t = useTranslations('PerfisPanel');
  const tRoles = useTranslations('Settings.roles');
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { simularPerfil } = useAuth();
  const {
    channels,
    loading: canaisCarregando,
    falhou: canaisFalharam,
    recarregar: recarregarCanais,
  } = useChannels();
  /**
   * ⚠️ "Conexão sumiu" é uma AFIRMAÇÃO, e lista vazia não a sustenta. O hook
   * devolve `[]` enquanto carrega e quando a rota falha — e nesses dois
   * estados TODO perfil restrito resolvia como `unresolved`: a lista dizia
   * "conexões que não existem mais" sobre conexões vivas a cada carga, e
   * para sempre numa falha de rede, com o editor repetindo o aviso e o
   * `ChannelMultiSelect` (que some com lista vazia) sem oferecer a saída
   * "Todas" (achado do Codex no PR #99). É a variante do CLAUDE.md de lista
   * vazia virando afirmação positiva; a cura é o sinalizador do próprio
   * hook, como no fio do inbox.
   */
  const canaisConfiaveis = !canaisCarregando && !canaisFalharam;

  /**
   * Como a LINHA do perfil resume o escopo de canal.
   *
   * ⚠️ Ids que não resolvem não entram na conta. Conexão apagada deixa o id
   * gravado, e contá-lo faria a linha prometer acesso que não existe: escopo
   * não vazio significa "restrito a estes", então um perfil cujo único id
   * sumiu enxerga ZERO conexões enquanto a lista diz "1 conexão".
   * `summarizeScope` já modela isso — o caso `unresolved` existe para não
   * cair em "todas as conexões", que seria a mentira oposta.
   */
  function resumoDeCanais(ids: string[]): string {
    if (ids.length === 0) return t('allChannels');
    // Sem catálogo confiável, o que se sabe é o que está GRAVADO: "restrito
    // a N conexões" é verdade sem depender da lista.
    if (!canaisConfiaveis) return t('someChannels', { count: ids.length });
    const resumo = summarizeScope(channels, ids);
    if (resumo.kind === 'all') return t('allChannels');
    if (resumo.kind === 'unresolved') return t('canaisSumiram');
    const n = resumo.kind === 'one' ? 1 : resumo.count;
    return t('someChannels', { count: n });
  }

  const [perfis, setPerfis] = useState<PerfilDeAcesso[]>([]);
  const [membrosPorPerfil, setMembrosPorPerfil] = useState<Map<string, number>>(
    new Map(),
  );
  const [funis, setFunis] = useState<Funil[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [semeando, setSemeando] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  /** "Novo perfil" abre primeiro a escolha do modelo; o formulário vem depois. */
  const [escolhendoModelo, setEscolhendoModelo] = useState(false);
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

  /**
   * Perfil novo NASCE PREENCHIDO a partir de um dos três de fábrica (ou em
   * branco, se pedido). Até 03/09 o rascunho começava sem tela nenhuma — e
   * "nenhuma tela" aqui é literal (ver tipos.ts): o perfil só servia depois
   * de 14 caixas marcadas à mão. O trabalho agora é desmarcar.
   */
  function partirDe(modelo: ModeloDePartida | null) {
    setEscolhendoModelo(false);
    setRascunho(
      modelo
        ? {
            ...RASCUNHO_VAZIO,
            papel_base: modelo.papel_base,
            // Cópias: `MODELOS` é de módulo e vive entre uma abertura e outra
            // do diálogo — os handlers hoje substituem os arrays, mas um
            // `push` futuro contaminaria o modelo para todo perfil novo.
            telas: [...modelo.telas],
            secoes_config: [...modelo.secoes_config],
          }
        : { ...RASCUNHO_VAZIO },
    );
  }

  function fecharEditor() {
    setEscolhendoModelo(false);
    setRascunho(null);
  }

  function editar(p: PerfilDeAcesso) {
    setRascunho({
      id: p.id,
      nome: p.nome,
      papel_base: p.papel_base,
      telas: p.telas,
      secoes_config: semSecoesOcultas(p.papel_base, p.secoes_config),
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
      secoes_config: semSecoesOcultas(p.papel_base, p.secoes_config),
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

  /**
   * "Ver como": liga a lente (ver `lib/perfis/simulacao.ts`) e leva para a
   * PRIMEIRA tela que o perfil enxerga — ficar aqui não mostraria nada,
   * porque um perfil sem `perfis` faz esta própria seção sumir. A saída é a
   * faixa no topo de toda página.
   */
  function verComo(p: PerfilDeAcesso) {
    simularPerfil(p.id);
    const primeira = TODAS_AS_TELAS.find((tela) =>
      podeVerTela({ papel: p.papel_base, perfil: p }, tela),
    );
    router.push(ROTA_DA_TELA[primeira ?? 'settings']);
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
            onClick={() => setEscolhendoModelo(true)}
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
                      {/* ⚠️ Conta o que RESOLVE, não o tamanho do array: id
                          de conexão apagada continua gravado, e somá-lo faz
                          a linha dizer "1 conexão" sobre um perfil que na
                          prática não enxerga conexão nenhuma — a tela
                          afirmando o oposto do que a pessoa vive. */}
                      {resumoDeCanais(p.channel_ids)}
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
                      onClick={() => verComo(p)}
                      title={t('simulacao.botao')}
                    >
                      <Eye className="size-4" />
                    </Button>
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
        open={rascunho !== null || escolhendoModelo}
        onOpenChange={(open) => {
          if (!open) fecharEditor();
        }}
      >
        <DialogContent className="bg-popover border-border max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {/* Passo 0 do perfil novo: de qual modelo partir. Três cartões, um
              por perfil de fábrica, e a saída "em branco" para quem quer
              montar do zero (o caminho antigo). */}
          {escolhendoModelo && !rascunho && (
            <>
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">
                  {t('createTitle')}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {t('modeloDescricao')}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2 py-2 sm:grid-cols-3">
                {MODELOS.map((m) => (
                  <button
                    key={m.papel_base}
                    type="button"
                    onClick={() => partirDe(m)}
                    className="flex flex-col items-start gap-1.5 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted"
                  >
                    {/* Nome e descrição do DICIONÁRIO, não o `nome` de
                        fábrica (dado, em português — sairia cru no locale
                        inglês). Ver `modelosDePartida`. */}
                    <span className="text-sm font-medium text-foreground">
                      {t(`modelos.${m.papel_base}.nome` as Parameters<typeof t>[0])}
                    </span>
                    {papelChip(m.papel_base)}
                    <span className="text-xs text-muted-foreground">
                      {t(`modelos.${m.papel_base}.descricao` as Parameters<typeof t>[0])}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {t('modeloTelas', { count: m.telas.length })}
                    </span>
                  </button>
                ))}
              </div>
              <DialogFooter className="bg-popover border-border sm:justify-between">
                <Button
                  variant="ghost"
                  onClick={() => partirDe(null)}
                  className="text-muted-foreground"
                >
                  {t('modeloEmBranco')}
                </Button>
                <Button
                  variant="outline"
                  onClick={fecharEditor}
                  className="border-border text-popover-foreground"
                >
                  {t('cancel')}
                </Button>
              </DialogFooter>
            </>
          )}
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
                      onValueChange={(v) => {
                        const papel = v as PapelBase;
                        // Descer o papel tira do rascunho o que ele não veria
                        // de jeito nenhum (ver `semSecoesOcultas`).
                        setRascunho({
                          ...rascunho,
                          papel_base: papel,
                          secoes_config: semSecoesOcultas(papel, rascunho.secoes_config),
                        });
                      }}
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

                {/* O que o papel escolhido PODE. Fora da grade de duas
                    colunas de propósito: a lista é a resposta à pergunta que
                    o seletor levanta, e espremida ao lado do Nome ela
                    quebraria em seis linhas de uma palavra. */}
                <PoderesDoPapel papel={rascunho.papel_base} />

                {/* Áreas com caixa de grupo, detalhe recolhido e o grupo "Só
                    leitura para este papel" — ver lib/perfis/editor.ts. */}
                <AreasDoPerfil
                  papel={rascunho.papel_base}
                  telas={rascunho.telas}
                  secoes={rascunho.secoes_config}
                  onChange={(proximo) => setRascunho({ ...rascunho, ...proximo })}
                />

                {/* ⚠️ `> 1`, a convenção da casa: "seletor some com menos de
                    2 canais" (CLAUDE.md, UI de canal) — com um número só o
                    recorte não decide nada e a caixinha única confundia
                    ("desmarcar tira o acesso ao canal?"). Escopo vazio segue
                    significando TODOS.
                    ⚠️ MAS nunca some sobre recorte JÁ GRAVADO: escopo não
                    vazio cujos ids não casam com canal nenhum (conexão
                    apagada, conta que encolheu para um número) deixa a
                    pessoa sem canal ALGUM, e esconder a grade tiraria a
                    única forma de desfazer isso pela tela. */}
                {(channels.length > 1 || rascunho.channel_ids.length > 0) && (
                  <div className="flex flex-col gap-2">
                    <Label className="text-muted-foreground">
                      {t('canaisLabel')}
                    </Label>
                    {/* ⚠️ `ChannelMultiSelect`, e não uma grade de checkbox
                        própria: a grade só desenhava os canais VIVOS, então
                        um id de conexão apagada não tinha caixinha — e como
                        o array só mudava por essas caixinhas, o id ficava
                        preso PARA SEMPRE. Desmarcar tudo deixava `[órfão]`,
                        que é escopo não vazio: a pessoa ficava restrita a um
                        canal inexistente, ou seja, sem canal algum, sem
                        caminho de conserto pela tela.
                        O componente traz as duas peças que faltavam: o item
                        "Todos" (zera o array inteiro, órfão incluso) e o
                        rótulo `unresolved`, que não mente "todos os canais"
                        sobre um recorte que existe. */}
                    <ChannelMultiSelect
                      channels={channels}
                      value={rascunho.channel_ids}
                      onChange={(ids) =>
                        setRascunho({ ...rascunho, channel_ids: ids })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('escopoVazioHint')}
                    </p>
                    {/* Catálogo que não veio: dizer isso, com a saída. Sem a
                        lista o seletor nem renderiza, e o aviso de "sumiu"
                        abaixo seria a afirmação errada. */}
                    {canaisFalharam && (
                      <p className="text-xs text-destructive">
                        {t('canaisIndisponiveis')}{' '}
                        <button
                          type="button"
                          onClick={() => void recarregarCanais()}
                          className="underline underline-offset-2"
                        >
                          {t('canaisRecarregar')}
                        </button>
                      </p>
                    )}
                    {/* Só quando há id preso — e só com catálogo confiável: a
                        frase explica o que a lista de itens não tem como
                        mostrar. */}
                    {canaisConfiaveis &&
                      summarizeScope(
                        channels,
                        rascunho.channel_ids.length === 0
                          ? null
                          : rascunho.channel_ids,
                      ).kind === 'unresolved' && (
                        <p className="text-xs text-destructive">
                          {t('canaisSumiramDica')}
                        </p>
                      )}
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
