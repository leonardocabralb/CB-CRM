'use client';

// ============================================================
// A faixa da simulação de perfil — sempre à vista enquanto ela durar.
//
// ⚠️ A SAÍDA mora AQUI, e não na tela de Perfis, de propósito: o perfil
// simulado pode esconder Configurações → Perfis de acesso (é seção só de
// admin), e aí a única porta de volta seria mexer no sessionStorage. A
// faixa fica acima do cabeçalho, em toda página, e some sozinha quando
// não há simulação. Ver `lib/perfis/simulacao.ts`.
// ============================================================

import { useTranslations } from 'next-intl';
import { Eye, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';

export function FaixaDeSimulacao() {
  const { simulacao, encerrarSimulacao } = useAuth();
  const t = useTranslations('PerfisPanel.simulacao');
  const tRoles = useTranslations('Settings.roles');

  if (!simulacao) return null;

  const papel = (p: string) => tRoles(p as Parameters<typeof tRoles>[0]);

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-foreground"
    >
      <Eye className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {t('faixa', {
            nome: simulacao.perfil.nome,
            papel: papel(simulacao.perfil.papel_base),
          })}
        </p>
        {/* O limite, dito onde a pessoa está olhando: só a visão muda. */}
        <p className="text-muted-foreground">
          {t('faixaDica', { papelReal: papel(simulacao.papelReal) })}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={encerrarSimulacao}
        className="shrink-0 border-amber-500/40"
      >
        <X className="size-3.5" />
        {t('sair')}
      </Button>
    </div>
  );
}
