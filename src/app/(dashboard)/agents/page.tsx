'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bot } from 'lucide-react';

import { RequireRole } from '@/components/auth/require-role';
import { SubAbas } from '@/components/settings/sub-abas';
import { ListaDeAgentes } from '@/components/agentes-de-ia/lista-de-agentes';
import { UsoDeIa } from '@/components/agentes-de-ia/uso-de-ia';
import { useAuth } from '@/hooks/use-auth';

type Vista = 'agentes' | 'uso';

/**
 * Agentes de IA (F1b do docs/PLANO-agentes-de-ia.md): a LISTA de agentes e o
 * USO da conta em R$. Só administrador (D14) — as instruções e as regras não
 * saem para quem não é.
 */
export default function AgentsPage() {
  const t = useTranslations('IaAgentes');
  // A lista e o Uso são DA CONTA: trocar de conta sem recarregar (o perfil
  // muda no lugar) remonta tudo, senão ficavam os agentes, os custos e a
  // cotação da anterior — e salvar a cotação a gravaria na nova (Codex, #295).
  const { profileLoading, accountId } = useAuth();
  const [vista, setVista] = useState<Vista>('agentes');

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('titulo')}</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('descricao')}</p>

      <RequireRole
        min="admin"
        fallback={
          profileLoading ? (
            <div className="mt-6 h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">{t('somenteAdmin')}</p>
          )
        }
      >
        <div key={accountId ?? 'sem-conta'} className="mt-6 space-y-4">
          <SubAbas
            rotulo={t('abas')}
            ativa={vista}
            aoTrocar={setVista}
            abas={[
              { id: 'agentes', rotulo: t('abaAgentes') },
              { id: 'uso', rotulo: t('abaUso') },
            ]}
          />
          {vista === 'agentes' ? <ListaDeAgentes /> : <UsoDeIa />}
        </div>
      </RequireRole>
    </div>
  );
}
