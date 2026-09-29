'use client';

// ============================================================
// As peças comuns dos blocos do Meu dia e o bloco de NOVIDADES do cartão da
// entrada (`resumo-do-dia.tsx`).
//
// A aba /meu-dia deixou de usar as listas daqui na v2 (29/09/2026,
// `docs/PLANO-meu-dia-v2.md`): os clientes esperando viraram indicadores por
// conexão e as tarefas ganharam bloco próprio (`bloco-de-tarefas.tsx`).
//
// ⚠️ `onContinuar` continua existindo e não é resíduo: a porta de entrada
// monta `Novidades`, e o contrato "todo link confirma antes de navegar" é o
// que impede a URL de trocar com a tela da porta na frente.
//
// ⚠️ Tela fora do perfil (D8): o número aparece SEM link, com o aviso.
// Esconder calaria uma obrigação atribuída à pessoa. O item é gateado pela
// tela para onde ELE leva, não pela tela do bloco.
// ============================================================

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AtSign, ListTodo, UserPlus } from 'lucide-react';

import type {
  Bloco,
  Novidades as DadosDeNovidades,
} from '@/hooks/use-resumo-do-dia';
import { cn } from '@/lib/utils';

// `flex-wrap` + título `shrink-0`: no celular o resumo à direita desce para
// a linha de baixo em vez de espremer o título em três linhas (medido a
// 375px, "Clientes esperando resposta" quebrava em três).
export function Cabecalho({
  icone,
  titulo,
  direita,
}: {
  icone: React.ReactNode;
  titulo: string;
  direita: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-foreground flex shrink-0 items-center gap-1.5 text-sm font-semibold">
        {icone}
        {titulo}
      </h2>
      <div className="text-muted-foreground min-w-0 text-right">{direita}</div>
    </div>
  );
}

export function EstadoDoBloco({ bloco }: { bloco: Bloco<unknown> }) {
  const t = useTranslations('ResumoDoDia');
  if (bloco.status === 'carregando') {
    return <p className="text-muted-foreground mt-2 text-sm">{t('loading')}</p>;
  }
  if (bloco.status === 'falhou') {
    return <p className="text-destructive mt-2 text-sm">{t('failed')}</p>;
  }
  return null;
}

export function ForaDoPerfil() {
  const t = useTranslations('ResumoDoDia');
  return (
    <p className="text-muted-foreground mt-2 text-xs">
      {t('outOfYourProfile')}
    </p>
  );
}

export function LinkDoBloco({
  href,
  texto,
  onContinuar,
}: {
  href: string;
  texto: string;
  onContinuar: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onContinuar}
      className="text-primary mt-2 inline-block text-sm hover:underline"
    >
      {texto}
    </Link>
  );
}

export function Novidades({
  bloco,
  veNotificacoes,
  onContinuar,
  comLink = true,
}: {
  bloco: Bloco<DadosDeNovidades>;
  veNotificacoes: boolean;
  onContinuar: () => void;
  /**
   * O cartão da ENTRADA passa `false`: ali o único caminho para a frente é
   * o botão que leva à aba, e um segundo link desfaria o enxugamento que o
   * operador pediu. Sem link é diferente de FORA DO PERFIL — por isso a
   * prop, e não `veNotificacoes={false}`, que escreveria na tela um aviso
   * de restrição que não existe.
   */
  comLink?: boolean;
}) {
  const t = useTranslations('ResumoDoDia');
  if (bloco.status !== 'pronto') return <EstadoDoBloco bloco={bloco} />;
  const { mencoes, tarefas, conversas, total, foraDoPerfil, truncada } =
    bloco.dados;
  // A régua da D8 também aqui: o número aparece, o conteúdo não.
  const fora =
    foraDoPerfil > 0 ? (
      <p className="text-muted-foreground mt-2 text-xs">
        {t(truncada ? 'outOfProfileAtLeast' : 'outOfProfile', {
          count: foraDoPerfil,
        })}
      </p>
    ) : null;
  // ⚠️ Consulta TRUNCADA não afirma número nem ausência (Codex, PR #199).
  // Passando do teto, o hook devolve só os avisos mais NOVOS — e se todos
  // eles estiverem fora do perfil, "Nada de novo" seria dito sobre uma
  // menção mais antiga que ficou de fora. É a armadilha "lista vazia
  // virando afirmação", aqui com a lista cheia e o recorte esvaziando-a.
  //
  // ⚠️ E o truncado diz "PELO MENOS N" (≥), nunca "mais de N" (>): o
  // `truncada` prova que ALGUM aviso ficou de fora, não que ficou de fora
  // um aviso DESTE tipo. Com 3 menções na janela e só tarefas no que foi
  // cortado, "mais de 3 menções" seria falso — são exatamente 3 (Codex,
  // PR #200). As chaves da fila e das conversas dizem "mais de" porque lá
  // o número exibido É o teto, e aí a desigualdade estrita é verdadeira.
  if (total === 0) {
    return (
      <>
        <p className="text-muted-foreground mt-2 text-sm">
          {t(truncada ? 'newsTooMany' : 'newsNone')}
        </p>
        {fora}
      </>
    );
  }
  const chip = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs';
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {mencoes > 0 && (
          <span className={cn(chip, 'bg-primary/10 text-primary')}>
            <AtSign className="size-3.5" aria-hidden />
            {t(truncada ? 'newsMentionsAtLeast' : 'newsMentions', {
              count: mencoes,
            })}
          </span>
        )}
        {tarefas > 0 && (
          <span className={cn(chip, 'bg-muted text-foreground')}>
            <ListTodo className="size-3.5" aria-hidden />
            {t(truncada ? 'newsTasksAtLeast' : 'newsTasks', {
              count: tarefas,
            })}
          </span>
        )}
        {conversas > 0 && (
          <span className={cn(chip, 'bg-muted text-foreground')}>
            <UserPlus className="size-3.5" aria-hidden />
            {t(truncada ? 'newsConversationsAtLeast' : 'newsConversations', {
              count: conversas,
            })}
          </span>
        )}
      </div>
      {fora}
      {!comLink ? null : veNotificacoes ? (
        <LinkDoBloco
          href="/notifications"
          texto={t('openNotifications')}
          onContinuar={onContinuar}
        />
      ) : (
        <ForaDoPerfil />
      )}
    </div>
  );
}
