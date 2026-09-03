'use client';

// ============================================================
// Bloco "Origem do contato", FIXO no topo da aba Histórico do painel
// (pedido do operador, 2026-09-03): quando a ficha nasceu, por qual conexão
// correu a primeira mensagem e quem a mandou. A regra é `lib/contacts/origem`
// (pura, com teste); aqui só a busca da primeira mensagem e a renderização.
//
// ⚠️ A primeira mensagem vem do FIO, por prop (`messages[0]`), nunca de uma
// consulta própria: a página zera o array ao trocar de conversa e carimba de
// quem ele é (`messagesCarregando`), então não há render com a origem do
// cliente anterior sob o nome do novo — e a primeira mensagem de uma
// conversa nova chega sozinha, sem remontar nada.
// ============================================================

import { CalendarDays, MapPin, MessageSquare, PlugZap } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useChannels } from '@/hooks/use-channels';
import { origemDoContato } from '@/lib/contacts/origem';
import type { Contact, Message } from '@/types';

export function OrigemDoContato({
  contact,
  messages,
  carregando,
}: {
  contact: Contact;
  /**
   * O fio INTEIRO da conversa, por prop — o mesmo array que alimenta a aba
   * Arquivos. O fio carrega a conversa completa (sem `limit`), do mais antigo
   * ao mais novo, então `messages[0]` É a primeira mensagem; e como é prop,
   * a primeira mensagem de uma conversa recém-aberta chega sozinha (achado
   * do Codex no PR #109: uma consulta própria, chaveada só pela conversa,
   * ficava presa em "nenhuma mensagem" até remontar o painel).
   */
  messages: Message[];
  /** Carga do fio em curso: `messages` vazio ainda não afirma nada. */
  carregando: boolean;
}) {
  const t = useTranslations('Inbox.sidebar');
  const { channels } = useChannels();

  // Só afirma sobre a primeira mensagem com a carga concluída; até lá o
  // bloco mostra só a data de cadastro, que é do contato.
  const respondeu = !carregando;
  const primeira = respondeu && messages.length > 0 ? messages[0] : null;
  const origem = origemDoContato(
    contact,
    primeira
      ? {
          created_at: primeira.created_at,
          channel_id: primeira.channel_id,
          sender_type: primeira.sender_type,
          from_device: primeira.from_device,
        }
      : null,
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
