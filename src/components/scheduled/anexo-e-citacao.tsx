'use client';

// ============================================================
// O que a 932 acrescentou à LINHA de uma agendada: o anexo e a citação.
//
// Peça própria porque as duas telas mostram a mesma linha — a faixa dentro da
// conversa e a tela global — e o aviso que ela carrega é o tipo de coisa que,
// escrita duas vezes, passa a existir só numa delas.
// ============================================================

import { AlertTriangle, CornerUpLeft, FileText, Mic, Video } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { buildReplyPreview } from '@/components/inbox/reply-quote';
import type { Citada } from '@/hooks/use-citadas-da-agendada';
import { citacaoAindaVale, temAnexo } from '@/lib/scheduled/midia';
import type { Message, ScheduledMessage } from '@/types';

type LinhaComExtras = Pick<
  ScheduledMessage,
  | 'status'
  | 'media_url'
  | 'media_kind'
  | 'media_filename'
  | 'reply_to_message_id'
  | 'citacao_perdida'
>;

export function AnexoECitacao({
  agendada,
  citada,
  citadaCarregada,
}: {
  agendada: LinhaComExtras;
  /** `undefined` = a mensagem citada não existe mais. Ver `useCitadas`. */
  citada: Citada | undefined;
  /**
   * A busca da citada já terminou?
   *
   * ⚠️ Antes de terminar, `citada` é `undefined` por não ter chegado — não por
   * ter sumido. Sem esta separação, toda linha com citação piscaria "a
   * mensagem citada foi apagada" a cada carregamento, e o aviso que só deve
   * aparecer quando é verdade viraria ruído que ninguém lê.
   */
  citadaCarregada: boolean;
}) {
  const t = useTranslations('Inbox.scheduled');
  const tQuote = useTranslations('Inbox.replyQuote');

  const comAnexo = temAnexo(agendada);
  if (!comAnexo && !agendada.reply_to_message_id) return null;

  const vale = citacaoAindaVale(citada ?? null);

  return (
    <div className="mt-1 space-y-1">
      {comAnexo && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {/* ⚠️ Miniatura só na FOTO, e não é enfeite: "Foto" sozinho não
              responde a pergunta que o operador faz olhando a fila — QUAL
              foto está marcada para sair. Nos outros tipos a miniatura não
              existiria mesmo, e o nome do documento já responde. */}
          {agendada.media_kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agendada.media_url!}
              alt={t('attachment_image')}
              className="h-8 w-8 shrink-0 rounded object-cover"
            />
          ) : agendada.media_kind === 'video' ? (
            <Video className="h-3 w-3 shrink-0" />
          ) : agendada.media_kind === 'audio' ? (
            <Mic className="h-3 w-3 shrink-0" />
          ) : (
            <FileText className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">
            {agendada.media_kind === 'document' && agendada.media_filename
              ? agendada.media_filename
              : t(`attachment_${agendada.media_kind}`)}
          </span>
        </div>
      )}

      {agendada.reply_to_message_id && (agendada.status === 'sent' || citadaCarregada) && (
        <>
          {/* ⚠️ Três estados, não dois. Uma linha JÁ ENVIADA não pergunta "vai
              sair sem a citação?" — ela já saiu, e o que interessa é se saiu
              sem. Misturar os dois faria o acervo avisar sobre algo a decidir
              que não existe mais. (E a linha enviada não depende da busca: o
              `citacao_perdida` já está gravado nela.) */}
          {agendada.status === 'sent' ? (
            agendada.citacao_perdida && (
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <CornerUpLeft className="h-3 w-3 shrink-0" />
                {t('quotedWasLost')}
              </p>
            )
          ) : vale ? (
            <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
              <CornerUpLeft className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {t('replyingTo', {
                  trecho: buildReplyPreview(citada as unknown as Message, tQuote),
                })}
              </span>
            </p>
          ) : (
            // ⚠️ O aviso que a decisão do escritório pediu. Aparece ANTES do
            // envio, enquanto ainda dá para cancelar e reescrever — apagar
            // mensagem aqui é apagar MOLE, então sem esta linha nada na tela
            // denunciaria que a bolha citada virou "Esta mensagem foi
            // apagada" no celular do cliente.
            <p className="flex items-center gap-1 text-[10px] text-amber-600">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {t('quotedDeleted')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
