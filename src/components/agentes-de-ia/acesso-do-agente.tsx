'use client';

// ============================================================
// Sub-aba Acesso de um agente de IA (F3, 5.5 do docs/PLANO-agentes-de-ia.md):
// o que ele vê do cliente além da conversa — ficha, negócio, etiquetas,
// cobranças, reunião e os campos personalizados marcados um a um. Salva pelo
// PATCH do agente, mandando SÓ `acesso`.
//
// ⚠️ NADA marcado = o agente vê só a conversa (fechado por padrão, como as
// conexões): é dado do cliente indo a um provedor de IA externo, e a tela diz
// isso antes das caixas.
//
// ⚠️ O catálogo de campos carrega à parte (`custom_fields`, sob RLS): enquanto
// carrega a lista é esqueleto, e a carga que falha diz que falhou — nunca "a
// conta não tem campos", que é a lista vazia virando afirmação (CLAUDE.md).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LIMITES } from '@/lib/ia-agentes/agente';
import { semAcento } from '@/lib/inbox/busca-em-mensagens';
import { createClient } from '@/lib/supabase/client';
import { acessoMudou, acessoParaSalvar } from './rascunho';
import { rotuloDoBloco, textoDoCodigo } from './textos';
import { CAIXAS_DO_ACESSO, type AcessoDoAgente as Acesso, type IaAgente } from './tipos';

interface Campo {
  id: string;
  field_name: string;
}

type Carga = { fase: 'carregando' } | { fase: 'falhou' } | { fase: 'pronto'; campos: Campo[] };

/** Acima disto a lista de campos ganha a caixa de busca. */
const CAMPOS_PARA_BUSCAR = 10;

export function AcessoDoAgente({
  agente,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  agente: IaAgente;
  aoSalvar: (novo: IaAgente) => void;
  /** Avisa o detalhe se há alteração não salva (a aba Playground diz isso). */
  aoMudarNaoSalvo?: (naoSalvo: boolean) => void;
}) {
  const t = useTranslations('IaAgentes');
  const [rascunho, setRascunho] = useState<Acesso>(() => ({
    ...agente.acesso,
    campos: [...agente.acesso.campos],
  }));
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await createClient()
      .from('custom_fields')
      .select('id, field_name')
      // ⚠️ Alfabética: lista PLANA. `posicao` é a ordem DENTRO do bloco (966)
      // e reinicia em cada um — só quem REAGRUPA pode ordenar por ela.
      .order('field_name')
      .order('id');
    setCarga(error ? { fase: 'falhou' } : { fase: 'pronto', campos: (data ?? []) as Campo[] });
  }, []);

  useEffect(() => {
    void (async () => {
      await carregar();
    })();
  }, [carregar]);

  const naoSalvo = acessoMudou(agente.acesso, rascunho);
  useEffect(() => {
    aoMudarNaoSalvo?.(naoSalvo);
  }, [naoSalvo, aoMudarNaoSalvo]);

  const existentes = useMemo(
    () => (carga.fase === 'pronto' ? new Set(carga.campos.map((c) => c.id)) : null),
    [carga]
  );
  // Só os marcados que ainda existem contam para o teto (o Salvar descarta os outros).
  const marcados = existentes ? rascunho.campos.filter((id) => existentes.has(id)).length : rascunho.campos.length;
  const noTeto = marcados >= LIMITES.campos;

  const nadaMarcado = CAIXAS_DO_ACESSO.every((c) => !rascunho[c]) && marcados === 0;

  const termo = semAcento(busca.trim());
  const camposVisiveis =
    carga.fase === 'pronto' && termo
      ? carga.campos.filter((c) => semAcento(c.field_name).includes(termo))
      : carga.fase === 'pronto'
        ? carga.campos
        : [];

  function alternarCampo(id: string) {
    setRascunho((r) => ({
      ...r,
      campos: r.campos.includes(id) ? r.campos.filter((x) => x !== id) : [...r.campos, id],
    }));
  }

  async function salvar() {
    if (!naoSalvo) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acesso: acessoParaSalvar(rascunho, existentes) }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { agente?: IaAgente; code?: string; error?: string };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code, corpo.error));
        return;
      }
      toast.success(t('acesso.salvo'));
      // O rascunho passa a ser o que o servidor gravou (sem os campos órfãos).
      setRascunho({ ...corpo.agente.acesso, campos: [...corpo.agente.acesso.campos] });
      aoSalvar(corpo.agente);
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('acesso.explicacao')}</p>
      {nadaMarcado ? <p className="text-xs text-muted-foreground">{t('acesso.soAConversa')}</p> : null}

      <section className="space-y-3">
        {CAIXAS_DO_ACESSO.map((c) => (
          <label key={c} className="flex items-start gap-3 rounded-md border border-border p-3">
            <Checkbox
              className="mt-0.5"
              checked={rascunho[c]}
              onCheckedChange={(v) => setRascunho((r) => ({ ...r, [c]: v === true }))}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{rotuloDoBloco(t, c)}</span>
              <span className="block text-xs text-muted-foreground">{t(`acesso.dica.${c}`)}</span>
            </span>
          </label>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{rotuloDoBloco(t, 'campos')}</h3>
          {carga.fase === 'pronto' && carga.campos.length > 0 ? (
            <span className="text-xs text-muted-foreground">{t('acesso.campos.marcados', { n: marcados })}</span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t('acesso.campos.dica')}</p>

        {carga.fase === 'carregando' ? (
          <div className="h-24 animate-pulse rounded-md bg-muted/40" />
        ) : carga.fase === 'falhou' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('acesso.campos.falhou')}</p>
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
        ) : carga.campos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('acesso.campos.nenhum')}</p>
        ) : (
          <div className="space-y-2">
            {carga.campos.length > CAMPOS_PARA_BUSCAR ? (
              <div className="relative sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={t('acesso.campos.buscar')}
                  aria-label={t('acesso.campos.buscar')}
                  className="pl-8"
                />
              </div>
            ) : null}
            {noTeto ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t('acesso.campos.limite', { max: LIMITES.campos })}
              </p>
            ) : null}
            {camposVisiveis.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('acesso.campos.nenhumNaBusca')}</p>
            ) : (
              <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
                {camposVisiveis.map((c) => {
                  const marcado = rascunho.campos.includes(c.id);
                  return (
                    <label key={c.id} className="flex min-w-0 items-center gap-2 text-sm">
                      <Checkbox
                        checked={marcado}
                        // No teto, só dá para DESMARCAR (a rota recusaria a lista).
                        disabled={!marcado && noTeto}
                        onCheckedChange={() => alternarCampo(c.id)}
                      />
                      <span className="min-w-0 truncate" title={c.field_name}>
                        {c.field_name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={() => void salvar()} disabled={salvando || !naoSalvo}>
          {t('acesso.salvar')}
        </Button>
      </div>
    </div>
  );
}
