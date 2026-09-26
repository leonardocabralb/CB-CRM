'use client';

import { use } from 'react';
import { useTranslations } from 'next-intl';

import { RequireRole } from '@/components/auth/require-role';
import { DetalheDoAgente } from '@/components/agentes-de-ia/detalhe-do-agente';
import { useAuth } from '@/hooks/use-auth';

/** Um agente de IA (F1b): Configuração, Playground e Uso. Só administrador (D14). */
export default function AgentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('IaAgentes');
  const { profileLoading } = useAuth();
  return (
    <RequireRole
      min="admin"
      fallback={
        profileLoading ? (
          <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
        ) : (
          <p className="text-sm text-muted-foreground">{t('somenteAdmin')}</p>
        )
      }
    >
      <DetalheDoAgente key={id} id={id} />
    </RequireRole>
  );
}
