'use client';

// ============================================================
// Sub-aba Base de conhecimento de um agente de IA (F3, D20 do
// docs/PLANO-agentes-de-ia.md): quais documentos da base da conta ESTE agente
// consulta. Os documentos continuam sendo criados e editados onde sempre
// foram (`/agents/legado`, cartão da base); aqui só se marca quem usa o quê.
// Salva por `PUT /api/cb/ia/agentes/[id]/documentos` com a lista INTEIRA.
//
// ⚠️ Documento não marcado = o agente não o usa; NENHUM marcado = o agente
// responde sem base (fechado por padrão, como o acesso). A tela diz isso.
//
// ⚠️ São DUAS leituras (a base da conta e as marcações do agente), e a tela
// só afirma alguma coisa com as duas de volta: com uma só, "nenhum marcado"
// ou "a conta não tem documentos" seria a lista vazia virando afirmação.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ExternalLink, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { LIMITES } from '@/lib/ia-agentes/agente';
import { mesmoConjunto } from './rascunho';
import { textoDoCodigo } from './textos';

interface Documento {
  id: string;
  title: string;
  updated_at: string;
}

type Carga =
  | { fase: 'carregando' }
  | { fase: 'falhou' }
  | { fase: 'pronto'; documentos: Documento[]; salvos: string[] };

export function BaseDoAgente({
  agenteId,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  agenteId: string;
  /** A base do agente mudou (o detalhe zera a conversa do Playground). */
  aoSalvar?: () => void;
  /** Avisa o detalhe se há alteração não salva (a aba Playground diz isso). */
  aoMudarNaoSalvo?: (naoSalvo: boolean) => void;
}) {
  const t = useTranslations('IaAgentes');
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  // O rascunho nasce junto com a carga (nulo até ela voltar).
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [base, doAgente] = await Promise.all([
        fetch('/api/ai/knowledge', { cache: 'no-store' }),
        fetch(`/api/cb/ia/agentes/${agenteId}/documentos`, { cache: 'no-store' }),
      ]);
      if (!base.ok || !doAgente.ok) throw new Error(`${base.status}/${doAgente.status}`);
      const corpoDaBase = (await base.json()) as { documents?: Documento[] };
      const corpoDoAgente = (await doAgente.json()) as { documentoIds?: string[] };
      const salvos = corpoDoAgente.documentoIds ?? [];
      setCarga({ fase: 'pronto', documentos: corpoDaBase.documents ?? [], salvos });
      setMarcados([...salvos]);
    } catch {
      setCarga({ fase: 'falhou' });
    }
  }, [agenteId]);

  useEffect(() => {
    void (async () => {
      await carregar();
    })();
  }, [carregar]);

  const naoSalvo = carga.fase === 'pronto' && marcados !== null && !mesmoConjunto(marcados, carga.salvos);
  useEffect(() => {
    aoMudarNaoSalvo?.(naoSalvo);
  }, [naoSalvo, aoMudarNaoSalvo]);

  const noTeto = (marcados ?? []).length >= LIMITES.documentos;

  function alternar(id: string) {
    setMarcados((m) => (m === null ? m : m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  async function salvar() {
    if (!naoSalvo || marcados === null || carga.fase !== 'pronto') return;
    // Só o que existe na base de agora: documento apagado por fora sai sozinho
    // (o vínculo cai em cascata), e mandá-lo faria a rota recusar a lista.
    const existentes = new Set(carga.documentos.map((d) => d.id));
    const documentoIds = marcados.filter((id) => existentes.has(id));
    setSalvando(true);
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agenteId}/documentos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentoIds }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { documentoIds?: string[]; code?: string; error?: string };
      if (!res.ok || !Array.isArray(corpo.documentoIds)) {
        toast.error(textoDoCodigo(t, corpo.code, corpo.error));
        return;
      }
      toast.success(t('base.salvo'));
      setCarga({ ...carga, salvos: corpo.documentoIds });
      setMarcados([...corpo.documentoIds]);
      aoSalvar?.();
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  const gerenciar = (
    <Link
      href="/agents/legado"
      className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
    >
      {t('base.gerenciar')} <ExternalLink className="size-3.5" />
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t('base.explicacao')}</p>
        {gerenciar}
      </div>

      {carga.fase === 'carregando' || (carga.fase === 'pronto' && marcados === null) ? (
        <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : carga.fase === 'falhou' ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('base.falhou')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCarga({ fase: 'carregando' });
              void carregar();
            }}
          >
            <RefreshCw className="size-4" /> {t('tentarDeNovo')}
          </Button>
        </div>
      ) : carga.documentos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('base.vazia')}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t('base.marcados', {
              n: (marcados ?? []).filter((id) => carga.documentos.some((d) => d.id === id)).length,
            })}
            {noTeto ? ` ${t('base.teto', { n: LIMITES.documentos })}` : null}
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {carga.documentos.map((d) => (
              <li key={d.id} className="flex min-w-0 items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground" title={d.title}>
                    {d.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('base.atualizado', {
                      data: new Date(d.updated_at).toLocaleDateString(undefined, { dateStyle: 'short' }),
                    })}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {t('base.usar')}
                  <Switch
                    checked={(marcados ?? []).includes(d.id)}
                    // No teto da rota (`LIMITES.documentos`), só desmarca: o
                    // 201º faria o salvar recusar a lista sem dizer qual tirar.
                    disabled={noTeto && !(marcados ?? []).includes(d.id)}
                    onCheckedChange={() => alternar(d.id)}
                  />
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={() => void salvar()} disabled={salvando || !naoSalvo}>
          {t('base.salvar')}
        </Button>
      </div>
    </div>
  );
}
