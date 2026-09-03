'use client';

// ============================================================
// Bloco "Origem do contato", FIXO no topo da aba Histórico do painel
// (pedido do operador, 2026-09-03): quando a ficha nasceu, por qual conexão
// correu a primeira mensagem e quem a mandou. A regra é `lib/contacts/origem`
// (pura, com teste); aqui só a busca da primeira mensagem e a renderização.
//
// ⚠️ A primeira mensagem é buscada por CONVERSA e comparada contra a prop do
// render atual (`de === conversationId`) — a armadilha do efeito passivo que
// já mordeu quatro vezes: sem isso, ao trocar de cliente o bloco mostraria a
// origem do anterior sob o nome do novo. Sem resposta ainda, não afirma nada.
// ============================================================

import { useEffect, useState } from 'react';
import { CalendarDays, MapPin, MessageSquare, PlugZap } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useChannels } from '@/hooks/use-channels';
import { origemDoContato, type PrimeiraMensagem } from '@/lib/contacts/origem';
import { createClient } from '@/lib/supabase/client';
import type { Contact } from '@/types';

export function OrigemDoContato({
  contact,
  conversationId,
}: {
  contact: Contact;
  conversationId: string | null;
}) {
  const t = useTranslations('Inbox.sidebar');
  const { channels } = useChannels();
  const [primeira, setPrimeira] = useState<{
    de: string;
    mensagem: PrimeiraMensagem | null;
  } | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    let cancelado = false;
    const supabase = createClient();
    supabase
      .from('messages')
      .select('created_at, channel_id, sender_type, from_device')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          console.error('[origem-do-contato] primeira mensagem:', error);
          return;
        }
        setPrimeira({
          de: conversationId,
          mensagem: (data?.[0] as PrimeiraMensagem | undefined) ?? null,
        });
      });
    return () => {
      cancelado = true;
    };
  }, [conversationId]);

  // Só afirma sobre a primeira mensagem quando a resposta é DESTA conversa;
  // enquanto não é, o bloco mostra só a data de cadastro, que é do contato.
  const respondeu = !!conversationId && primeira?.de === conversationId;
  const origem = origemDoContato(
    contact,
    respondeu ? primeira!.mensagem : null,
    (id) => channels.find((c) => c.id === id)?.label ?? null,
  );

  const quando = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const quem =
    origem.quemFalouPrimeiro === 'cliente'
      ? t('originSpeakerCustomer')
      : origem.quemFalouPrimeiro === 'equipe_crm'
        ? t('originSpeakerTeamCrm')
        : origem.quemFalouPrimeiro === 'equipe_celular'
          ? t('originSpeakerTeamDevice')
          : origem.quemFalouPrimeiro === 'robo'
            ? t('originSpeakerBot')
            : null;

  return (
    <div className="mb-4 rounded-lg bg-muted/40 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <MapPin className="h-3 w-3" />
        {t('originTitle')}
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <dt className="text-muted-foreground">{t('originRegisteredAt')}</dt>
          <dd className="font-medium text-foreground">{quando(origem.cadastradoEm)}</dd>
        </div>
        {/* Sem conversa, ou conversa ainda sem mensagem: não há "primeira
            mensagem" de que falar — uma linha só, dizendo isso. */}
        {respondeu && !origem.primeiraMensagemEm ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            <dd>{t('originNoMessages')}</dd>
          </div>
        ) : (
          respondeu && (
            <>
              {/* Estas duas QUEBRAM linha em vez de truncar: o nome da conexão
                  e "a equipe, pelo celular pareado" não cabem nos ~330px do
                  painel ao lado do rótulo (medido em 03/09). */}
              <div className="flex min-w-0 items-start gap-2">
                <PlugZap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <dt className="text-muted-foreground">{t('originFirstMessageVia')}</dt>
                  {/* Travessão, não o canal padrão: carimbo nulo (anterior ao
                      multi-canal) ou conexão apagada é "não se sabe". */}
                  <dd className="break-words font-medium text-foreground">
                    {origem.canal?.nome ?? '—'}
                  </dd>
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-2">
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <dt className="text-muted-foreground">{t('originFirstSpeaker')}</dt>
                  <dd className="break-words font-medium text-foreground">
                  {quem}
                  {origem.primeiraMensagemEm && (
                    <span className="font-normal text-muted-foreground">
                      {' · '}
                      {quando(origem.primeiraMensagemEm)}
                    </span>
                  )}
                  </dd>
                </div>
              </div>
            </>
          )
        )}
      </dl>
    </div>
  );
}
