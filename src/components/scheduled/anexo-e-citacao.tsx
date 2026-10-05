'use client';

// ============================================================
// O que a 932 acrescentou à LINHA de uma agendada: o anexo e a citação.
//
// Peça própria porque as duas telas mostram a mesma linha — a faixa dentro da
// conversa e a tela global — e o aviso que ela carrega é o tipo de coisa que,
// escrita duas vezes, passa a existir só numa delas.
//
// O anexo se PRÉ-VISUALIZA aqui (pedido do operador, 05/10/2026): o áudio
// toca no mesmo player do fio, o documento abre numa aba, foto e vídeo abrem
// no visualizador do fio. Sem isso, "Áudio" na fila não dizia o que ia sair.
// ============================================================

import { useState } from 'react';
import { AlertTriangle, CornerUpLeft, ImageOff, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SeloDoDocumento } from '@/components/inbox/message-bubble';
import { MediaViewer } from '@/components/inbox/media-viewer';
import { PlayerDeAudio } from '@/components/inbox/player-de-audio';
import { buildReplyPreview } from '@/components/inbox/reply-quote';
import type { Citada } from '@/hooks/use-citadas-da-agendada';
import { ehPaginaHtml, urlParaAbrirAnexo } from '@/lib/media/abrir-anexo';
import { basenameFromUrl } from '@/lib/media/filename';
import { citacaoAindaVale, temAnexo } from '@/lib/scheduled/midia';
import type { Message, ScheduledMessage } from '@/types';

/** Superfície própria, a mesma do documento na bolha: lê igual nas duas telas. */
const CARTAO =
  'flex max-w-full items-center gap-2 rounded-lg bg-card p-1.5 pr-2.5 text-xs text-card-foreground ring-1 ring-border transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
        <PreviaDoAnexo
          url={agendada.media_url!}
          kind={agendada.media_kind!}
          nome={agendada.media_filename}
        />
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

/**
 * O anexo da agendada, pronto para conferir ANTES de sair.
 *
 * As peças são as do fio, de propósito: o player é o mesmo (velocidade
 * lembrada, um áudio por vez) e o visualizador é o nosso, com giro e zoom.
 * A URL é a pública do bucket, derivada do caminho pela rota (932).
 */
function PreviaDoAnexo({
  url,
  kind,
  nome,
}: {
  url: string;
  kind: NonNullable<ScheduledMessage['media_kind']>;
  nome: string | null;
}) {
  const t = useTranslations('Inbox.scheduled');
  const tv = useTranslations('Inbox.mediaViewer');
  const [ampliada, setAmpliada] = useState(false);
  const [quebrada, setQuebrada] = useState(false);
  // O nome que o CAMINHO no bucket carrega (`buildMediaPath` o monta com o
  // nome e a extensão do arquivo). `media_filename` só vem no documento do
  // compositor: foto e vídeo não o gravam, e a API v1 aceita documento sem.
  const doCaminho = basenameFromUrl(url) || null;
  const nomeDoArquivo = nome ?? doCaminho;

  if (kind === 'audio') {
    // Fora de bolha: lê contra o fundo do cartão, como a bolha do cliente.
    return <PlayerDeAudio src={url} naBolhaDaEquipe={false} />;
  }

  if (kind === 'document') {
    const rotulo = nomeDoArquivo ?? t('attachment_document');
    return (
      <a
        // Página .html vai para BAIXAR, nunca abrir a partir do nosso Storage
        // (1060, `abrir-anexo.ts`). PDF abre no leitor do navegador.
        // ⚠️ Quem decide se é página é o CAMINHO (o que o Storage serve),
        // não só o nome: o nome vem de quem agendou (a API v1 aceita
        // qualquer um, ou nenhum), e "contrato.pdf" sobre um `.html` abriria
        // a página direto do nosso Storage.
        href={urlParaAbrirAnexo(
          url,
          null,
          ehPaginaHtml(null, doCaminho) && !ehPaginaHtml(null, nomeDoArquivo)
            ? doCaminho
            : nomeDoArquivo,
        )}
        target="_blank"
        rel="noopener noreferrer"
        title={rotulo}
        className={`${CARTAO} w-fit`}
      >
        <SeloDoDocumento nome={rotulo} />
        <span className="min-w-0 flex-1 truncate font-medium">{rotulo}</span>
      </a>
    );
  }

  const video = kind === 'video';
  const rotulo = video ? t('watchVideo') : tv('open');
  return (
    <>
      <button
        type="button"
        onClick={() => setAmpliada(true)}
        title={rotulo}
        aria-label={rotulo}
        className={`${CARTAO} w-fit cursor-zoom-in`}
      >
        {/* ⚠️ A miniatura da FOTO não é enfeite: "Foto" sozinho não responde
            a pergunta que o operador faz olhando a fila — QUAL foto está
            marcada para sair. */}
        {video ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </span>
        ) : quebrada ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
            <ImageOff className="h-4 w-4 text-muted-foreground" />
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={t('attachment_image')}
            onError={() => setQuebrada(true)}
            className="h-10 w-10 shrink-0 rounded object-cover"
          />
        )}
        <span className="min-w-0 truncate font-medium">
          {t(video ? 'attachment_video' : 'attachment_image')}
        </span>
      </button>
      {ampliada && (
        <MediaViewer
          src={url}
          video={video}
          alt={t(video ? 'attachment_video' : 'attachment_image')}
          // Sem o nome do caminho, o Baixar salvaria PNG e vídeo como `.jpg`.
          fileName={nomeDoArquivo ?? undefined}
          onClose={() => setAmpliada(false)}
        />
      )}
    </>
  );
}
