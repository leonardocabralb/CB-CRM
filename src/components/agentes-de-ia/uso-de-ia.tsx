'use client';

// ============================================================
// Uso de IA em tokens e em R$ (F1b, 5.8, D13, D21). Sem `agenteId`: a conta
// inteira (por agente e por módulo) e o campo da cotação. Com `agenteId`: só
// aquele agente, produção e teste separados.
//
// ⚠️ R$ é ESTIMATIVA pela cotação de HOJE, para todo o período; modelo fora da
// tabela de preço aparece como "sem preço", nunca como zero. ⚠️ Falha de carga
// diz que falhou — nunca "nenhum uso".
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/currency';
import type { ResumoDoUso, Soma } from '@/lib/ia-agentes/uso';
import { textoDoCodigo } from './textos';

interface Resposta {
  dias: number;
  cotacao: number | null;
  resumo: ResumoDoUso;
}

const MODOS = ['agente', 'agente_teste', 'radar', 'transcricao', 'auto_reply', 'draft'] as const;

export function UsoDeIa({ agenteId }: { agenteId?: string }) {
  const t = useTranslations('IaAgentes');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [cotacao, setCotacao] = useState('');
  const [salvandoCotacao, setSalvandoCotacao] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/cb/ia/uso?dias=30', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as Resposta;
      setDados(corpo);
      setCotacao(corpo.cotacao === null ? '' : String(corpo.cotacao).replace('.', ','));
      setFalhou(false);
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await carregar();
    })();
  }, [carregar]);

  async function salvarCotacao() {
    setSalvandoCotacao(true);
    try {
      const res = await fetch('/api/cb/ia/cotacao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cotacao: cotacao.trim() === '' ? null : cotacao.trim() }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok) {
        toast.error(textoDoCodigo(t, corpo.code));
        return;
      }
      toast.success(t('uso.cotacaoSalva'));
      await carregar();
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvandoCotacao(false);
    }
  }

  if (falhou && !dados) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('uso.falhou')}</p>
        <Button variant="outline" size="sm" onClick={() => void carregar()}>
          <RefreshCw className="size-4" /> {t('tentarDeNovo')}
        </Button>
      </div>
    );
  }
  if (!dados) return <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />;

  const { resumo } = dados;
  const doAgente = agenteId ? resumo.porAgente.find((a) => a.iaAgenteId === agenteId) : undefined;

  const reais = (s: Soma) =>
    s.reais !== null ? formatCurrency(s.reais) : s.dolar === null ? t('uso.semPreco') : t('uso.semCotacao');
  const tokens = (n: number) => n.toLocaleString(undefined);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">{t('uso.explicacao', { dias: dados.dias })}</p>

      {agenteId ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(['producao', 'teste'] as const).map((k) => {
            const s = doAgente?.[k];
            return (
              <div key={k} className="rounded-lg border border-border p-4">
                <p className="text-xs text-muted-foreground">{t(`uso.${k}`)}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{s ? reais(s) : formatCurrency(0)}</p>
                <p className="text-xs text-muted-foreground">
                  {t('uso.tokensEChamadas', { tokens: tokens(s?.tokensTotal ?? 0), chamadas: s?.chamadas ?? 0 })}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">{t('uso.total')}</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{reais(resumo.total)}</p>
            <p className="text-xs text-muted-foreground">
              {t('uso.tokensEChamadas', { tokens: tokens(resumo.total.tokensTotal), chamadas: resumo.total.chamadas })}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t('uso.agente')}</th>
                  <th className="py-2 pr-3 font-medium">{t('uso.producao')}</th>
                  <th className="py-2 font-medium">{t('uso.teste')}</th>
                </tr>
              </thead>
              <tbody>
                {resumo.porAgente.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-3 text-xs text-muted-foreground">
                      {t('uso.nenhumAgente')}
                    </td>
                  </tr>
                ) : (
                  resumo.porAgente.map((a) => (
                    <tr key={a.iaAgenteId ?? '—'} className="border-b border-border/60">
                      <td className="py-2 pr-3">{a.nome ?? t('uso.agenteApagado')}</td>
                      <td className="py-2 pr-3">
                        {reais(a.producao)}{' '}
                        <span className="text-xs text-muted-foreground">({tokens(a.producao.tokensTotal)})</span>
                      </td>
                      <td className="py-2">
                        {reais(a.teste)}{' '}
                        <span className="text-xs text-muted-foreground">({tokens(a.teste.tokensTotal)})</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('uso.porModulo')}</p>
            <ul className="space-y-1 text-sm">
              {MODOS.filter((m) => resumo.porModo[m]).map((m) => (
                <li key={m} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-foreground">{t(`uso.modo.${m}`)}</span>
                  <span className="text-muted-foreground">{reais(resumo.porModo[m])}</span>
                  <span className="text-xs text-muted-foreground">({tokens(resumo.porModo[m].tokensTotal)})</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {resumo.semPreco.length > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t('uso.modelosSemPreco', { modelos: resumo.semPreco.join(', ') })}
        </p>
      ) : null}

      {!agenteId ? (
        <div className="space-y-1.5 rounded-lg border border-border p-4 sm:max-w-md">
          <Label htmlFor="ia-cotacao">{t('uso.cotacao')}</Label>
          <div className="flex gap-2">
            <Input
              id="ia-cotacao"
              inputMode="decimal"
              className="w-32"
              value={cotacao}
              placeholder="5,60"
              onChange={(e) => setCotacao(e.target.value)}
            />
            <Button size="sm" onClick={() => void salvarCotacao()} disabled={salvandoCotacao}>
              {t('uso.salvarCotacao')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('uso.cotacaoDica')}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('uso.cotacaoNaLista')}</p>
      )}
    </div>
  );
}
