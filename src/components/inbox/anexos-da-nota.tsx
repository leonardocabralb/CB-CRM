'use client';

import { ImageIcon, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { MediaViewer } from '@/components/inbox/media-viewer';
import { SeloDoDocumento } from '@/components/inbox/message-bubble';
import { PlayerDeAudio } from '@/components/inbox/player-de-audio';
import { urlDaMiniatura } from '@/lib/acervo/tipos';
import { ehPaginaHtml, urlParaAbrirAnexo } from '@/lib/media/abrir-anexo';
import {
  lerAnexosDaNota,
  resumoDosAnexos,
  tamanhoLegivel,
  tipoDoAnexo,
  urlPublicaDoAnexo,
} from '@/lib/notes/anexos';
import { cn } from '@/lib/utils';

/**
 * Os ANEXOS de uma anotação interna (1102), nos lugares que desenham a
 * anotação inteira: o fio (`NoteLine`), as abas (`CartaoDeNota`) e a ficha de
 * `/contatos` (que só MOSTRA — A6). A faixa fixada e a citação mostram só o
 * resumo (`ResumoDosAnexos`). Pino `anexos-da-nota.chamadores.test.ts`:
 * quem desenha o texto da anotação desenha um dos dois.
 *
 * - ÁUDIO no `PlayerDeAudio` (o do fio: velocidade lembrada, um por vez),
 *   SEM transcrição (D4).
 * - IMAGEM e VÍDEO em miniatura que abre o NOSSO visualizador (giro e zoom),
 *   com setas entre as mídias DESTA anotação. Por portal no `body`: no painel
 *   (gaveta com `transform`) o `fixed` do visualizador ficaria preso a ela
 *   (`foto-ampliavel.tsx`).
 * - DOCUMENTO como o cartão da bolha (superfície própria + selo de
 *   `tipoDoDocumento`); a página `.html` só BAIXA (`urlParaAbrirAnexo`, 1060).
 *
 * A URL é DERIVADA do caminho aqui (`urlPublicaDoAnexo`), nunca gravada.
 * Nada tem largura fixa que não encolha (fio de 305 px): miniaturas de 80 px
 * que quebram linha, cartões com `max-w-full`, o player com `max-w-full`.
 */

/** O lado pedido ao Storage para a miniatura de 80 px: o dobro, para tela retina. */
const LADO_DA_MINIATURA_DA_NOTA = 160;
export function AnexosDaNota({
  anexos,
  naNotaDoFio = false,
  className,
}: {
  /** `nota.anexos` — o JSON gravado, lido campo a campo. */
  anexos: unknown;
  /**
   * Dentro da anotação âmbar do fio: o player herda a cor do texto dela
   * (com a do tema, a onda sumiria no âmbar no modo escuro).
   */
  naNotaDoFio?: boolean;
  className?: string;
}) {
  const t = useTranslations('Inbox.note');
  // O anexo aberto no visualizador, pelo CAMINHO (a identidade estável).
  const [aberto, setAberto] = useState<string | null>(null);
  // As imagens cuja miniatura o Storage não renderizou (pelo caminho).
  const [semMiniatura, setSemMiniatura] = useState<ReadonlySet<string>>(() => new Set());

  const lista = lerAnexosDaNota(anexos);
  if (lista.length === 0) return null;

  const audios = lista.filter((a) => tipoDoAnexo(a.mime) === 'audio');
  const midias = lista.filter((a) => {
    const tipo = tipoDoAnexo(a.mime);
    return tipo === 'imagem' || tipo === 'video';
  });
  const documentos = lista.filter((a) => {
    const tipo = tipoDoAnexo(a.mime);
    return tipo === 'documento' || tipo === null;
  });
  const indice = aberto ? midias.findIndex((m) => m.caminho === aberto) : -1;
  const atual = indice >= 0 ? midias[indice] : null;

  return (
    <div
      role="group"
      aria-label={t('anexos')}
      className={cn('mt-1.5 flex min-w-0 flex-col gap-1.5', className)}
    >
      {audios.map((a) => (
        <PlayerDeAudio
          key={a.caminho}
          src={urlPublicaDoAnexo(a.caminho)}
          naBolhaDaEquipe={false}
          corHerdada={naNotaDoFio}
        />
      ))}

      {midias.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {midias.map((m) => {
            const url = urlPublicaDoAnexo(m.caminho);
            const video = tipoDoAnexo(m.mime) === 'video';
            return (
              <button
                key={m.caminho}
                type="button"
                onClick={() => setAberto(m.caminho)}
                title={t('ampliarAnexo', { nome: m.nome })}
                aria-label={t('ampliarAnexo', { nome: m.nome })}
                className="relative size-20 shrink-0 cursor-zoom-in overflow-hidden rounded-md bg-black/5 ring-1 ring-black/10 transition-opacity hover:opacity-90"
              >
                {video ? (
                  <>
                    <video
                      src={url}
                      preload="metadata"
                      muted
                      playsInline
                      className="size-full object-cover"
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                      <Play className="ml-0.5 h-5 w-5 fill-current" />
                    </span>
                  </>
                ) : semMiniatura.has(m.caminho) ? (
                  // A transformação recusou (foto grande demais para ela):
                  // um ícone, e o original continua a um clique.
                  <span className="text-muted-foreground flex size-full items-center justify-center">
                    <ImageIcon className="h-5 w-5" />
                  </span>
                ) : (
                  // ⚠️ A MINIATURA renderizada pelo Storage, nunca o original:
                  // o original (uma foto de celular tem MB) só no
                  // visualizador. Sem `loading="lazy"`, como no seletor do
                  // acervo: dentro de gaveta recém-aberta ela não pintava, e
                  // a miniatura tem poucos KB.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={urlDaMiniatura(url, LADO_DA_MINIATURA_DA_NOTA)}
                    alt={m.nome}
                    decoding="async"
                    width={80}
                    height={80}
                    onError={() =>
                      setSemMiniatura((atuais) => new Set(atuais).add(m.caminho))
                    }
                    className="size-full object-cover"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {documentos.map((d) => {
        const soBaixa = ehPaginaHtml(d.mime, d.nome);
        const rotulo = soBaixa
          ? t('baixarAnexo', { nome: d.nome })
          : t('abrirAnexo', { nome: d.nome });
        return (
          <a
            key={d.caminho}
            href={urlParaAbrirAnexo(urlPublicaDoAnexo(d.caminho), d.mime, d.nome)}
            target="_blank"
            rel="noopener noreferrer"
            title={rotulo}
            aria-label={rotulo}
            className="bg-card text-card-foreground ring-border hover:bg-accent focus-visible:ring-ring flex w-fit max-w-full min-w-0 items-center gap-2 rounded-lg p-1.5 pr-2.5 text-xs ring-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <SeloDoDocumento nome={d.nome} mime={d.mime} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{d.nome}</span>
              {d.bytes > 0 && (
                <span className="block text-[10px] opacity-70">
                  {tamanhoLegivel(d.bytes)}
                </span>
              )}
            </span>
          </a>
        );
      })}

      {atual &&
        createPortal(
          <MediaViewer
            src={urlPublicaDoAnexo(atual.caminho)}
            alt={atual.nome}
            fileName={atual.nome}
            video={tipoDoAnexo(atual.mime) === 'video'}
            onClose={() => setAberto(null)}
            galeria={
              midias.length > 1
                ? {
                    indice,
                    total: midias.length,
                    onNavegar: (novo) => {
                      const alvo = midias[novo];
                      if (alvo) setAberto(alvo.caminho);
                    },
                  }
                : undefined
            }
          />,
          document.body
        )}
    </div>
  );
}

/**
 * O RESUMO dos anexos ("🎤 Áudio", "📄 contrato.pdf", "📎 3 anexos"), para
 * onde a anotação aparece encolhida: a faixa da fixada no fio, a citação da
 * respondida e o cartão fixado recolhido. A mesma régua do corpo do aviso
 * (`resumoDosAnexos`), aqui pelo dicionário. Sem anexo, nada.
 */
export function ResumoDosAnexos({
  anexos,
  className,
}: {
  anexos: unknown;
  className?: string;
}) {
  const t = useTranslations('Inbox.note');
  const resumo = resumoDosAnexos(lerAnexosDaNota(anexos));
  if (!resumo) return null;
  const texto = (() => {
    switch (resumo.tipo) {
      case 'audio':
        return t('resumoAudio');
      case 'imagem':
        return t('resumoImagem');
      case 'video':
        return t('resumoVideo');
      case 'documento':
        return t('resumoDocumento', { nome: resumo.nome });
      case 'varios':
        return t('resumoVarios', { n: resumo.quantos });
    }
  })();
  return <span className={cn('block truncate', className)}>{texto}</span>;
}
