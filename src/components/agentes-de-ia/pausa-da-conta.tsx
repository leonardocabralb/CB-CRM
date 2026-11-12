'use client';

// ============================================================
// "Quando a equipe responde" — a pausa TEMPORÁRIA da IA (1138, decisões do
// operador de 11/11/2026). Configuração da CONTA, uma só para todo agente
// (Trabalhista, Previdenciário, Bancário): em quantos minutos sem resposta da
// equipe a IA volta a responder, e faz o follow-up da fala da equipe. 0 =
// desligado (toda pausa fica até o "Retomar IA", como antes). Só admin (a
// página inteira é).
//
// ⚠️ Carregando ou falhou NUNCA vira "15" nem "desligado" no campo: o valor
// só aparece depois de lido (lista vazia virando afirmação, CLAUDE.md 8c).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VOLTA_APOS_MIN_TETO } from '@/lib/ia-agentes/pausa';
import { textoDoCodigo } from './textos';

type Estado = { fase: 'carregando' } | { fase: 'falhou' } | { fase: 'pronto'; minutos: number };

/** O texto do campo → minutos (inteiro de 0 ao teto); fora disso, `null`. */
export function minutosDigitados(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n <= VOLTA_APOS_MIN_TETO ? n : null;
}

export function PausaDaConta() {
  const t = useTranslations('IaAgentes');
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/cb/ia/pausa', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { minutos?: unknown };
      if (typeof corpo.minutos !== 'number') throw new Error('forma');
      setEstado({ fase: 'pronto', minutos: corpo.minutos });
      setTexto(String(corpo.minutos));
    } catch {
      setEstado({ fase: 'falhou' });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await carregar();
    })();
  }, [carregar]);

  async function salvar() {
    const minutos = minutosDigitados(texto);
    if (minutos === null) {
      toast.error(t('erro.minutos_invalidos'));
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch('/api/cb/ia/pausa', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutos }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok) {
        toast.error(textoDoCodigo(t, corpo.code));
        return;
      }
      toast.success(minutos === 0 ? t('pausaDaConta.salvaDesligada') : t('pausaDaConta.salva', { minutos }));
      await carregar();
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  const salvo = estado.fase === 'pronto' ? estado.minutos : null;
  const mudou = salvo !== null && minutosDigitados(texto) !== salvo;

  return (
    <section className="space-y-2 rounded-lg border border-border p-4 sm:max-w-2xl">
      <h2 className="text-sm font-semibold text-foreground">{t('pausaDaConta.titulo')}</h2>
      <p className="text-sm text-muted-foreground">{t('pausaDaConta.explicacao')}</p>

      {estado.fase === 'carregando' ? (
        <div className="h-9 w-48 animate-pulse rounded-md bg-muted/40" />
      ) : estado.fase === 'falhou' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{t('pausaDaConta.falhou')}</p>
          <Button variant="outline" size="sm" onClick={() => void carregar()}>
            <RefreshCw className="size-4" /> {t('tentarDeNovo')}
          </Button>
        </div>
      ) : (
        <>
          <Label htmlFor="ia-volta-apos-min" className="pt-1">
            {t('pausaDaConta.campo')}
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="ia-volta-apos-min"
              inputMode="numeric"
              className="w-24"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">{t('pausaDaConta.minutos')}</span>
            <Button size="sm" onClick={() => void salvar()} disabled={salvando || !mudou}>
              {t('pausaDaConta.salvar')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {salvo === 0 ? t('pausaDaConta.agoraDesligada') : t('pausaDaConta.agora', { minutos: salvo ?? 0 })}
          </p>
          <p className="text-xs text-muted-foreground">{t('pausaDaConta.dica')}</p>
        </>
      )}
    </section>
  );
}
