'use client';

// ============================================================
// A seção "Grupos de WhatsApp" da aba Relacionados do painel da conversa
// (1117): os grupos em que o cliente estava na última conferência da lista.
// Clicar abre o grupo na própria caixa de entrada, com a faixa "Voltar para"
// o cliente.
//
// Os dados vêm por PROP (`useGruposDoContato` em quem monta): a etiqueta da
// aba soma os grupos antes de ela abrir. ⚠️ Carregando e falha nunca viram
// "nenhum grupo".
// ============================================================

import { useTranslations } from 'next-intl';
import { ArrowUpRight, Users } from 'lucide-react';

import type { EstadoDosGruposDoContato } from '@/hooks/use-grupos-do-contato';
import { nomeDoGrupo } from '@/lib/cb-groups/display';
import type { GrupoDoContato } from '@/lib/cb-groups/grupos-do-contato';
import { cn } from '@/lib/utils';

export function GruposDoContato({
  grupos,
  onAbrirConversa,
}: {
  grupos: EstadoDosGruposDoContato;
  /** Abre a conversa do grupo na página. Ausente = a linha não clica. */
  onAbrirConversa?: (conversaId: string) => void;
}) {
  const t = useTranslations('Contacts.groups');
  const { itens, carregando, falhou } = grupos;

  return (
    <section className="space-y-2">
      <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{t('title')}</h4>
      {carregando ? (
        <p className="text-muted-foreground text-xs">{t('loading')}</p>
      ) : falhou || !itens ? (
        <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
          <span>{t('loadFailed')}</span>
          <button
            type="button"
            onClick={grupos.recarregar}
            className="shrink-0 font-semibold underline underline-offset-2 hover:opacity-80"
          >
            {t('retry')}
          </button>
        </div>
      ) : itens.length === 0 ? (
        // Vazio com resposta: nenhum grupo CONFERIDO tem este cliente. O
        // vínculo nasce na leitura da lista do grupo, e a dica diz quando.
        <div className="border-border text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
          <p>{t('empty')}</p>
          <p className="mt-1">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {itens.map((g) => (
            <LinhaDoGrupo key={g.grupoId} g={g} onAbrirConversa={onAbrirConversa} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinhaDoGrupo({
  g,
  onAbrirConversa,
}: {
  g: GrupoDoContato;
  onAbrirConversa?: (conversaId: string) => void;
}) {
  const t = useTranslations('Contacts.groups');
  const nome = nomeDoGrupo(g.grupo, t('noName'));
  // Dia e mês no idioma de quem lê (regra das datas da raiz).
  const visto = new Date(g.vistoEm).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
  const legenda = [
    g.participantes != null ? t('participants', { count: g.participantes }) : null,
    t('seenOn', { data: visto }),
  ]
    .filter(Boolean)
    .join(' · ');

  const corpo = (
    <>
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full">
        {g.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a foto do grupo é do Storage, como na lista
          <img src={g.fotoUrl} alt="" className="size-8 rounded-full object-cover" />
        ) : (
          <Users className="text-muted-foreground size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{nome}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {g.conversaId ? legenda : `${legenda} · ${t('noConversation')}`}
        </span>
      </span>
      {g.conversaId && onAbrirConversa && (
        <ArrowUpRight className="text-muted-foreground mt-1 size-3.5 shrink-0" aria-hidden />
      )}
    </>
  );

  const classe = 'flex w-full min-w-0 items-start gap-2.5 rounded-md p-2.5 text-left';
  const conversaId = g.conversaId;
  return (
    <li className="border-border rounded-md border">
      {conversaId && onAbrirConversa ? (
        <button
          type="button"
          onClick={() => onAbrirConversa(conversaId)}
          title={t('openGroup')}
          className={cn(classe, 'hover:bg-muted/60 transition-colors')}
        >
          {corpo}
        </button>
      ) : (
        <div className={classe}>{corpo}</div>
      )}
    </li>
  );
}
