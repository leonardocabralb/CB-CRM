'use client';

// ============================================================
// A tela de quem teve o acesso SUSPENSO (1067): no lugar do CRM inteiro, sem
// menu, página nem batimento de presença — no molde da exigência do celular.
//
// Ela não é a barreira: o banco já recusa tudo a quem está suspenso (a
// própria linha fica invisível e as funções de acesso respondem "não é
// membro"). Esta tela só diz o que houve, em vez de um app vazio com erros.
//
// A pessoa chega aqui ao abrir o CRM, ou em até meio minuto se estava com ele
// aberto: o batimento de presença é recusado e refaz a leitura do perfil
// (`presence-heartbeat.tsx`).
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Lock, LogOut, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { sairDesteAparelho } from '@/lib/auth/sair';
import { createClient } from '@/lib/supabase/client';

export function AcessoSuspenso({
  suspensoEm,
  aoTentarDeNovo,
}: {
  suspensoEm: string | null;
  /** Relê o perfil: se um administrador reativou, o CRM volta sozinho. */
  aoTentarDeNovo: () => Promise<void>;
}) {
  const t = useTranslations('AcessoSuspenso');
  const tShell = useTranslations('DashboardShell');
  const [conferindo, setConferindo] = useState(false);
  const [saindo, setSaindo] = useState(false);

  const data = suspensoEm
    ? new Date(suspensoEm).toLocaleDateString(undefined, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : null;

  const tentarDeNovo = async () => {
    setConferindo(true);
    try {
      await aoTentarDeNovo();
    } finally {
      setConferindo(false);
    }
  };

  const sair = async () => {
    setSaindo(true);
    const r = await sairDesteAparelho(createClient().auth);
    if (!r.ok) {
      setSaindo(false);
      toast.error(tShell('signOutError', { message: r.erro }));
      return;
    }
    // Só com sucesso: com a sessão ainda no cookie, `/login` devolveria para
    // `/dashboard` e formaria um laço (a mesma regra da porta de entrada).
    window.location.href = '/login';
  };

  return (
    <div className="bg-background flex min-h-[var(--altura-visivel,100dvh)] items-center justify-center px-4 py-8">
      <Card className="border-border bg-card w-full max-w-md">
        {/* O CardHeader é `grid`: o centro horizontal é `justify-items`. */}
        <CardHeader className="items-center justify-items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-amber-500/10">
            <Lock className="size-6 text-amber-700 dark:text-amber-300" aria-hidden />
          </div>
          <CardTitle className="text-foreground text-xl">{t('titulo')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {data ? t('descricaoComData', { data }) : t('descricao')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-center text-sm">{t('comoVoltar')}</p>
          <Button onClick={tentarDeNovo} disabled={conferindo || saindo} className="w-full">
            {conferindo ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            {t('tentarDeNovo')}
          </Button>
          <Button
            variant="outline"
            onClick={sair}
            disabled={conferindo || saindo}
            className="w-full"
          >
            {saindo ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <LogOut className="size-4" aria-hidden />
            )}
            {t('sair')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
