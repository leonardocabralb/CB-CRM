'use client';

// ============================================================
// As notificações NÃO LIDAS da pessoa (v2, pedido do operador em 29/09/2026:
// "dar ênfase nas notificações"). O clique faz o mesmo que no sino: marca
// lida e abre o destino por `rotaDoAviso` (tarefa antes de conversa).
//
// ⚠️ Aviso de conversa em conexão FORA do perfil é só contado ("N fora do
// seu perfil") — a régua das novidades (12/09). O sino não recorta: os dois
// números divergem de propósito.
// ⚠️ O destino é gateado pela tela para onde ELE leva (Tarefas ou a caixa de
// entrada): fora do perfil, o aviso aparece sem clique.
// ============================================================

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { AtSign, Bell, ListTodo, Reply, UserPlus } from 'lucide-react';

import type { Bloco } from '@/hooks/use-resumo-do-dia';
import type { Notificacoes } from '@/hooks/use-area-de-trabalho';
import { LOCALE_DAS_DATAS } from '@/lib/idioma-das-datas';
import { rotaDoAviso } from '@/lib/notifications/rota-do-aviso';
import {
  textoDoAviso,
  type AvisoComContato,
} from '@/lib/notifications/texto-do-aviso';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { AccountMember, Notification } from '@/types';

import { EstadoDoBlocoDaAba } from './blocos-de-operacao';
import { Cabecalho, ForaDoPerfil, LinkDoBloco } from './blocos-pessoais';

/** Quantos avisos a lista mostra antes do "e mais N". */
const AVISOS_NA_LISTA = 8;

// Exaustivo, como o `TYPE_ICON` do sino: tipo novo sem ícone quebra o
// typecheck, em vez de virar um espaço em branco na lista.
const ICONE: Record<Notification['type'], typeof Bell> = {
  conversation_assigned: UserPlus,
  note_mention: AtSign,
  task_assigned: ListTodo,
  task_reply: Reply,
};

export function BlocoDeNotificacoes({
  bloco,
  membros,
  veNotificacoes,
  veTarefas,
  veInbox,
}: {
  bloco: Bloco<Notificacoes>;
  /** A lista da página (uma leitura para os dois blocos que dão nome a gente). */
  membros: AccountMember[];
  veNotificacoes: boolean;
  veTarefas: boolean;
  veInbox: boolean;
}) {
  const t = useTranslations('MeuDia');
  const tResumo = useTranslations('ResumoDoDia');
  const tTipos = useTranslations('NotificationsPage.tipos');
  const router = useRouter();
  // Quem atribuiu: `actor_user_id` → nome. Sem a lista, o texto do aviso
  // fica na voz passiva (a régua do sino).
  const nomePorUsuario = useMemo(
    () => new Map(membros.map((m) => [m.user_id, m.full_name])),
    [membros]
  );
  // O aviso clicado some da lista na hora (ele já foi tratado), mesmo que a
  // navegação demore um instante.
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());

  const abrir = (aviso: AvisoComContato, rota: string) => {
    setAbertos((a) => new Set(a).add(aviso.id));
    // Marca lida como o sino faz: a própria linha, sob RLS (a policy deixa
    // cada um marcar os seus). Falha não segura a navegação — o aviso volta
    // a aparecer na próxima carga, e é só isso.
    void createClient()
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', aviso.id)
      .is('read_at', null)
      .then(({ error }) => {
        if (error) {
          console.warn('[Meu dia] não consegui marcar o aviso:', error.message);
        }
      });
    router.push(rota);
  };

  const pronto = bloco.status === 'pronto' ? bloco.dados : null;
  const avisos = pronto?.avisos.filter((a) => !abertos.has(a.id)) ?? [];
  const lista = avisos.slice(0, AVISOS_NA_LISTA);
  const restantes = avisos.length - lista.length;

  return (
    <section className="border-border bg-card flex h-full flex-col rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={<Bell className="size-4" aria-hidden />}
        titulo={t('notificationsTitle')}
        direita={
          // Sem nenhuma, o corpo já diz; o número no título repetiria.
          pronto && avisos.length > 0 ? (
            <span className="text-primary text-sm font-medium">
              {pronto.truncada
                ? t('notificationsUnreadAtLeast', { count: avisos.length })
                : t('notificationsUnread', { count: avisos.length })}
            </span>
          ) : null
        }
      />
      {!pronto ? (
        <EstadoDoBlocoDaAba bloco={bloco} />
      ) : (
        <div className="mt-2 flex flex-1 flex-col">
          {avisos.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {/* ⚠️ "Nenhuma não lida" só sem nada fora do perfil: com avisos de
                  outra conexão, a frase seria falsa ao lado do "N fora do
                  seu perfil" logo abaixo. */}
              {pronto.truncada
                ? t('notificationsNoneListed')
                : pronto.foraDoPerfil > 0
                  ? t('notificationsNoneInProfile')
                  : t('notificationsNone')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {lista.map((aviso) => {
                const Icone = ICONE[aviso.type] ?? Bell;
                const texto = textoDoAviso(
                  aviso,
                  aviso.actor_user_id
                    ? (nomePorUsuario.get(aviso.actor_user_id) ?? null)
                    : null,
                  tTipos
                );
                const rota = rotaDoAviso(aviso);
                const destino =
                  rota && (aviso.task_id ? veTarefas : veInbox) ? rota : null;
                const conteudo = (
                  <>
                    <span className="bg-primary/10 text-primary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                      <Icone className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {texto.titulo}
                      </span>
                      {texto.corpo && (
                        <span className="text-muted-foreground block truncate text-xs">
                          {texto.corpo}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      {formatDistanceToNow(new Date(aviso.created_at), {
                        addSuffix: true,
                        locale: LOCALE_DAS_DATAS,
                      })}
                    </span>
                  </>
                );
                const classes = 'flex w-full items-start gap-2.5 rounded-md p-1.5 text-left';
                return (
                  <li key={aviso.id}>
                    {destino ? (
                      <button
                        type="button"
                        onClick={() => abrir(aviso, destino)}
                        className={cn(classes, 'hover:bg-muted/60')}
                      >
                        {conteudo}
                      </button>
                    ) : (
                      <div className={classes}>{conteudo}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {/* ⚠️ Com a leitura cortada no teto, o resto é um PISO: "e mais 42"
              seria falso com 72 esperando. */}
          {restantes > 0 && (
            <p className="text-muted-foreground mt-1 text-xs">
              {pronto.truncada
                ? t('notificationsMoreAtLeast', { count: restantes })
                : tResumo('andMore', { count: restantes })}
            </p>
          )}
          {pronto.foraDoPerfil > 0 && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              {tResumo(pronto.truncada ? 'outOfProfileAtLeast' : 'outOfProfile', {
                count: pronto.foraDoPerfil,
              })}
            </p>
          )}
          <div className="mt-auto">
            {veNotificacoes ? (
              <LinkDoBloco
                href="/notifications"
                texto={tResumo('openNotifications')}
                onContinuar={NADA}
              />
            ) : (
              <ForaDoPerfil />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** A aba não tem porta acima dela: navegar daqui não confirma nada. */
const NADA = () => {};
