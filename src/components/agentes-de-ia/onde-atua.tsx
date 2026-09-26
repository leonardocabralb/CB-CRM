'use client';

// ============================================================
// "Onde atua" (D24 do docs/PLANO-agentes-de-ia.md): as ETAPAS do funil em
// que o agente responde. Escolhe-se o funil e marcam-se as etapas; as de um
// funil ficam guardadas ao trocar para outro (o agente pode atuar em vários).
//
// ⚠️ Uma etapa tem no máximo UM agente: a que já é de outro aparece
// desabilitada com "IA · <nome>" (a rota também recusa, 409). ⚠️ Só card
// que ENTRAR na etapa depois de ela ser marcada e de o agente ser ligado é
// atendido (D27) — o texto diz isso, senão o operador marca "Lead" e estranha
// que os leads parados ali não recebem nada.
// ============================================================

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Checkbox } from '@/components/ui/checkbox';
import { createClient } from '@/lib/supabase/client';

interface Funil {
  id: string;
  name: string;
}

interface Etapa {
  id: string;
  name: string;
  pipeline_id: string;
  position: number;
}

type Carga = { fase: 'carregando' } | { fase: 'falhou' } | { fase: 'pronto'; funis: Funil[]; etapas: Etapa[] };

export function OndeAtua({
  etapas,
  aoMudar,
  ocupadas,
}: {
  /** Ids das etapas marcadas (o rascunho). */
  etapas: string[];
  aoMudar: (etapas: string[]) => void;
  /** Etapa → nome do OUTRO agente que já atua nela; nulo = a lista não carregou. */
  ocupadas: Map<string, string> | null;
}) {
  const t = useTranslations('IaAgentes.ondeAtua');
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [funilEscolhido, setFunilEscolhido] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const supabase = createClient();
      const [funis, etapasDosFunis] = await Promise.all([
        supabase.from('pipelines').select('id, name').order('created_at').order('id'),
        supabase.from('pipeline_stages').select('id, name, pipeline_id, position').order('position').order('id'),
      ]);
      if (!vivo) return;
      if (funis.error || etapasDosFunis.error) {
        setCarga({ fase: 'falhou' });
        return;
      }
      setCarga({
        fase: 'pronto',
        funis: (funis.data ?? []) as Funil[],
        etapas: (etapasDosFunis.data ?? []) as Etapa[],
      });
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (carga.fase === 'carregando') return <div className="h-24 animate-pulse rounded-md bg-muted/40" />;
  if (carga.fase === 'falhou') return <p className="text-xs text-red-700 dark:text-red-300">{t('falhou')}</p>;
  if (carga.funis.length === 0) return <p className="text-xs text-muted-foreground">{t('semFunis')}</p>;

  // O funil aberto é resolvido no RENDER: o escolhido, senão o da primeira
  // etapa marcada, senão o primeiro.
  const funilDaMarcada = carga.etapas.find((e) => etapas.includes(e.id))?.pipeline_id;
  const funil =
    carga.funis.find((f) => f.id === funilEscolhido) ??
    carga.funis.find((f) => f.id === funilDaMarcada) ??
    carga.funis[0];
  const marcadasPorFunil = new Map<string, number>();
  for (const e of carga.etapas) {
    if (etapas.includes(e.id)) marcadasPorFunil.set(e.pipeline_id, (marcadasPorFunil.get(e.pipeline_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-3">
      <select
        aria-label={t('funil')}
        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm sm:max-w-md"
        value={funil.id}
        onChange={(e) => setFunilEscolhido(e.target.value)}
      >
        {carga.funis.map((f) => {
          const n = marcadasPorFunil.get(f.id) ?? 0;
          return (
            <option key={f.id} value={f.id}>
              {n > 0 ? t('funilComMarcadas', { funil: f.name, n }) : f.name}
            </option>
          );
        })}
      </select>
      <div className="grid gap-2 sm:grid-cols-2">
        {carga.etapas
          .filter((e) => e.pipeline_id === funil.id)
          .map((e) => {
            const dono = ocupadas?.get(e.id) ?? null;
            const marcada = etapas.includes(e.id);
            return (
              <label key={e.id} className="flex min-w-0 items-center gap-2 text-sm">
                <Checkbox
                  checked={marcada}
                  disabled={dono !== null && !marcada}
                  onCheckedChange={() => aoMudar(marcada ? etapas.filter((x) => x !== e.id) : [...etapas, e.id])}
                />
                <span className="min-w-0 truncate">{e.name}</span>
                {dono !== null && !marcada ? (
                  <span className="shrink-0 truncate text-xs text-muted-foreground">{t('ocupada', { agente: dono })}</span>
                ) : null}
              </label>
            );
          })}
      </div>
      {etapas.length === 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{t('nenhuma')}</p>
      ) : null}
    </div>
  );
}
