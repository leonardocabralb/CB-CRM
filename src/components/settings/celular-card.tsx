'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CircleAlert, Loader2, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMensagemDoCelular } from '@/components/entrada/exigencia-do-celular';
import { useAuth } from '@/hooks/use-auth';
import { salvarMeuCelular, useMeuCelular } from '@/hooks/use-meu-celular';
import { formatarTelefone } from '@/lib/contacts/telefone';

/**
 * Cartão "Celular", em Seu perfil: onde a pessoa vê e TROCA o celular que a
 * tela de exigência pediu na entrada (1046). Trocar, não apagar: o celular é
 * exigido, e a régua recusa o campo vazio.
 *
 * Grava pela mesma rota da tela de exigência (`salvarMeuCelular`), com a
 * mesma régua e as mesmas frases.
 */
export function CelularCard({ className }: { className?: string }) {
  const t = useTranslations('MeuCelular');
  const { user } = useAuth();
  const meu = useMeuCelular(user?.id ?? null);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <Smartphone className="text-muted-foreground size-4" aria-hidden />
          {t('perfilTitulo')}
        </CardTitle>
        <CardDescription>{t('perfilDescricao')}</CardDescription>
      </CardHeader>
      <CardContent>
        {meu.estado === 'carregando' ? (
          <p className="text-muted-foreground text-sm">
            {t('perfilCarregando')}
          </p>
        ) : meu.estado === 'desconhecido' ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-destructive flex items-center gap-2 text-sm">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              {t('perfilFalhouAoCarregar')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={meu.recarregar}
            >
              {t('perfilTentarDeNovo')}
            </Button>
          </div>
        ) : (
          // A `key` recomeça o rascunho quando o número gravado muda (depois
          // de salvar), sem efeito copiando prop para estado.
          <FormularioDoCelular
            key={meu.celular ?? ''}
            gravado={meu.celular}
            aoGravar={meu.gravado}
          />
        )}
      </CardContent>
    </Card>
  );
}

function FormularioDoCelular({
  gravado,
  aoGravar,
}: {
  gravado: string | null;
  aoGravar: (celular: string) => void;
}) {
  const t = useTranslations('MeuCelular');
  const mensagem = useMensagemDoCelular();
  const inicial = gravado ? formatarTelefone(gravado) : '';
  const [texto, setTexto] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const mudou = texto.trim() !== inicial;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando || !mudou) return;
    setErro(null);
    setSalvando(true);
    const r = await salvarMeuCelular(texto);
    setSalvando(false);
    if (!r.ok) {
      setErro(mensagem(r.motivo));
      return;
    }
    toast.success(t('salvo'));
    // O mesmo número noutra grafia não muda a `key` do pai: o rascunho passa
    // a ser a grafia gravada, senão o botão ficaria aceso sobre o salvo.
    setTexto(formatarTelefone(r.celular));
    aoGravar(r.celular);
  };

  return (
    <form onSubmit={salvar} className="space-y-2" noValidate>
      <Label htmlFor="perfil-celular" className="text-foreground">
        {t('rotulo')}
      </Label>
      <div className="flex flex-wrap items-start gap-2">
        <Input
          id="perfil-celular"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={t('placeholder')}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            if (erro) setErro(null);
          }}
          readOnly={salvando}
          aria-invalid={erro !== null}
          aria-describedby={
            erro ? 'perfil-celular-erro' : 'perfil-celular-dica'
          }
          className="min-w-0 flex-1 basis-56"
        />
        <Button type="submit" disabled={salvando || !mudou}>
          {salvando ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('salvando')}
            </>
          ) : (
            t('perfilSalvar')
          )}
        </Button>
      </div>
      {erro ? (
        <p
          id="perfil-celular-erro"
          role="alert"
          className="text-destructive text-sm"
        >
          {erro}
        </p>
      ) : (
        <p id="perfil-celular-dica" className="text-muted-foreground text-xs">
          {t('dica')}
        </p>
      )}
    </form>
  );
}
