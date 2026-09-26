'use client';

// ============================================================
// A tela de exigência do celular (1046): quem ainda não informou o próprio
// celular vê este cartão NO LUGAR do CRM ao abri-lo, e não passa sem informar.
// Pedido do operador (26/09/2026): o número serve para, no futuro, o CRM
// avisar a pessoa por mensagem particular.
//
// Quem decide mostrar é a casca (`dashboard-shell.tsx`), e as regras moram
// lá, junto do resto da entrada:
// - ⚠️ só com a leitura RESPONDENDO que não há celular (`falta`). Leitura que
//   falhou (`desconhecido`) deixa passar: trancar o CRM inteiro por um soluço
//   de rede é a forma da issue #471. A pessoa é pedida na próxima abertura;
// - só com a conta resolvida (`accountStatus === 'ready'`): sem ela a rota
//   recusaria a gravação e a pessoa ficaria presa no cartão;
// - a leitura acontece UMA vez por carga, em paralelo com a do perfil, e o
//   cartão nunca aparece no meio do uso — só na abertura;
// - ACIMA da porta de entrada (Meu dia): a porta decide na montagem, e só
//   monta depois do celular gravado.
//
// ⚠️ Nada do app monta atrás (nem menu, nem página, nem o heartbeat de
// presença): é o cartão sozinho, no molde da tela de login. Um link
// `/inbox?c=X` aberto por quem ainda não tem celular não abre o fio nem zera
// as não lidas daquela conversa.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, LogOut, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { salvarMeuCelular } from '@/hooks/use-meu-celular';
import type { MotivoDoCelular } from '@/lib/account/celular';
import { sairDesteAparelho } from '@/lib/auth/sair';
import { createClient } from '@/lib/supabase/client';

/** A frase de cada recusa — a mesma na entrada e em Seu perfil. */
export function useMensagemDoCelular(): (motivo: MotivoDoCelular | 'falhou') => string {
  const t = useTranslations('MeuCelular');
  return (motivo) => {
    switch (motivo) {
      case 'vazio':
        return t('motivoVazio');
      case 'curto':
        return t('motivoCurto');
      case 'invalido':
        return t('motivoInvalido');
      case 'nao_e_celular':
        return t('motivoNaoECelular');
      case 'falhou':
        return t('motivoFalhou');
    }
  };
}

export function ExigenciaDoCelular({ aoGravar }: { aoGravar: (celular: string) => void }) {
  const t = useTranslations('MeuCelular');
  const tShell = useTranslations('DashboardShell');
  const mensagem = useMensagemDoCelular();

  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [saindo, setSaindo] = useState(false);

  // O cartão substitui o app inteiro: o foco vai para o campo, senão teclado e
  // leitor de tela continuam "na página anterior", que não existe.
  const campoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    campoRef.current?.focus();
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    setErro(null);
    setSalvando(true);
    const r = await salvarMeuCelular(texto);
    if (!r.ok) {
      setSalvando(false);
      setErro(mensagem(r.motivo));
      campoRef.current?.focus();
      return;
    }
    toast.success(t('salvo'));
    aoGravar(r.celular);
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
    // A altura da casca sai de `--altura-visivel` (regra do celular), com a
    // mesma queda; `min-h`, e não `h`: o cartão alto cresce e a página rola.
    <div className="bg-background flex min-h-[var(--altura-visivel,100dvh)] items-center justify-center px-4 py-8">
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex size-12 items-center justify-center rounded-xl">
            <Smartphone className="text-primary size-6" aria-hidden />
          </div>
          <CardTitle className="text-foreground text-xl">{t('titulo')}</CardTitle>
          <CardDescription className="text-muted-foreground">{t('descricao')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={salvar} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="meu-celular" className="text-muted-foreground">
                {t('rotulo')}
              </Label>
              <Input
                ref={campoRef}
                id="meu-celular"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t('placeholder')}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  if (erro) setErro(null);
                }}
                disabled={salvando}
                aria-invalid={erro !== null}
                aria-describedby={erro ? 'meu-celular-erro' : 'meu-celular-dica'}
              />
              {erro ? (
                <p id="meu-celular-erro" role="alert" className="text-destructive text-sm">
                  {erro}
                </p>
              ) : (
                <p id="meu-celular-dica" className="text-muted-foreground text-xs">
                  {t('dica')}
                </p>
              )}
            </div>

            <p className="text-muted-foreground text-xs">{t('quemVe')}</p>

            <Button type="submit" disabled={salvando || saindo} className="w-full">
              {salvando ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {t('salvando')}
                </>
              ) : (
                t('salvarEContinuar')
              )}
            </Button>

            <button
              type="button"
              onClick={sair}
              disabled={saindo || salvando}
              className="text-muted-foreground inline-flex items-center justify-center gap-1 self-center text-xs underline-offset-4 hover:underline disabled:opacity-50"
            >
              <LogOut className="size-3.5" aria-hidden />
              {t('sair')}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
