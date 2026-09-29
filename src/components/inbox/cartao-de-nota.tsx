'use client';

import {
  ChevronDown,
  ChevronUp,
  Locate,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { TextoComLinks } from '@/components/inbox/texto-com-links';
import { cn } from '@/lib/utils';
import type { ConversationNote } from '@/types';

/**
 * A anotação interna nas ABAS (painel da conversa e barra do grupo).
 *
 * Irmã da `NoteLine`, que é a mesma anotação DENTRO do fio — separadas de
 * propósito: no fio a nota divide espaço com mensagens que o cliente recebeu
 * e precisa destoar (amarela, 85% de largura, centralizada); aqui ela é o
 * conteúdo da coluna e usa a cor do painel.
 *
 * ⚠️ O que as duas PRECISAM ter igual é o que este componente centraliza: o
 * AUTOR e o botão de apagar. Até 2026-09-02 a aba não tinha nenhum dos dois —
 * a mesma anotação mostrava "Fulano anotou:" e uma lixeira no fio, e no painel
 * aparecia sem dono e sem saída. Quem lia pelo painel não sabia de quem era, e
 * quem quisesse apagar tinha de caçar a nota no meio da conversa.
 *
 * ⚠️ Confirmação INLINE, não diálogo (mesma decisão da `NoteLine`): é UMA
 * anotação interna, não sai para o cliente e não tem consequência fora daqui.
 * Um modal para isso seria atrito.
 *
 * ⚠️ Os botões NÃO dependem de hover. No toque do celular não existe hover, e
 * um botão revelado por ele simplesmente não existe — é o que já estava
 * escrito no alfinete do painel, e vale igual para a lixeira.
 *
 * LEITURA (pedido do operador, 29/09/2026): texto em `text-sm` na cor do
 * texto, com entrelinha folgada; autor e data no CABEÇALHO. Em `text-xs` e
 * cinza sobre cinza a anotação era difícil de ler e de achar na lista.
 *
 * ⚠️ A FIXADA nasce RECOLHIDA (duas linhas) e abre pela seta (mesmo pedido).
 * O painel a prende no topo da rolagem; aberta e sem como recolher, uma
 * anotação longa (links de documentos) cobria a lista inteira. Mesma
 * mecânica da `NotaFixadaBar` do fio: a seta só aparece com o texto CORTADO
 * de verdade, e aberta ela tem teto e rola dentro de si — um bloco preso
 * mais alto que a área visível esconderia o próprio fim. Quem monta passa
 * `key={nota.id}`: aberta/recolhida é estado da leitura DESTA anotação, e a
 * próxima fixada nasceria aberta sem o remonte.
 */
export function CartaoDeNota({
  nota,
  podeApagar,
  onApagar,
  destaque = false,
  fixada = false,
  fixando = false,
  onFixar,
  onVerNaConversa,
}: {
  nota: ConversationNote;
  /** Autor ou admin — quem decide de verdade é a RLS; isto só esconde o botão. */
  podeApagar: boolean;
  onApagar: (id: string) => void;
  /**
   * O cartão da nota FIXADA no topo da aba: outra moldura, mesmo conteúdo,
   * e nasce recolhido (ver o cabeçalho do componente).
   */
  destaque?: boolean;
  fixada?: boolean;
  /** Fixação em trânsito: desabilita o botão para não mandar duas vezes. */
  fixando?: boolean;
  /** Ausente = a fixação não é oferecida (nota de grupo não fixa — 951). */
  onFixar?: (fixar: boolean) => void;
  /**
   * "Ver na conversa" (09/09/2026): leva o fio até esta anotação, no ponto
   * da conversa em que foi escrita. Ausente = sem botão (a ficha de
   * `/contatos` não tem fio ao lado).
   */
  onVerNaConversa?: () => void;
}) {
  const t = useTranslations('Inbox.note');
  const tSidebar = useTranslations('Inbox.sidebar');
  const [confirmando, setConfirmando] = useState(false);
  const [aberta, setAberta] = useState(false);
  const [cortada, setCortada] = useState(false);
  const textoRef = useRef<HTMLParagraphElement>(null);

  /**
   * Só a fixada recolhe, e a seta só aparece quando o texto está CORTADO.
   * ⚠️ Medido, nunca estimado por caracteres: a largura do painel muda sem a
   * janela mudar, e a aba escondida (`keepMounted`) mede zero até abrir —
   * daí o `ResizeObserver`. Mede só RECOLHIDA: aberta, o texto rola dentro
   * do teto e `scrollHeight > clientHeight` passa a ser o normal.
   */
  useEffect(() => {
    if (!destaque || aberta) return;
    const el = textoRef.current;
    if (!el) return;
    const medir = () => setCortada(el.scrollHeight - el.clientHeight > 1);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [destaque, aberta, nota.texto]);

  return (
    <div
      className={cn(
        'bg-card rounded-lg border p-3',
        // Sem `sticky` aqui: grudar no topo é decisão de LAYOUT de quem
        // monta a aba (o painel prende o cartão fixado; a barra do grupo nem
        // tem nota fixada — 951 exige contato). O cartão só diz como é.
        destaque ? 'border-primary/40 shadow-sm' : 'border-border'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Mesma frase do fio (`Inbox.note.wrote`), para a anotação ter o
              mesmo dono nos dois lugares — inclusive a queda para "Alguém da
              equipe" quando o autor saiu da conta. Na fixada também: a
              informação não pode sumir só porque a nota foi fixada. */}
          <p className="text-foreground text-xs font-semibold break-words">
            {t('wrote', { autor: nota.autor_nome || t('unknownAuthor') })}
          </p>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px]">
            {destaque && (
              <span className="text-primary inline-flex items-center gap-1 font-semibold tracking-wider uppercase">
                <Pin className="h-3 w-3" />
                {tSidebar('pinnedNote')}
              </span>
            )}
            <span>
              {/* Locale do NAVEGADOR (undefined), nunca fixo — o formato
                  antigo do date-fns imprimia "Aug 29" num app pt-BR. */}
              {new Date(nota.created_at).toLocaleString(undefined, {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {destaque && (cortada || aberta) && (
            <button
              type="button"
              onClick={() => setAberta((v) => !v)}
              aria-expanded={aberta}
              aria-label={aberta ? t('collapse') : t('expand')}
              title={aberta ? t('collapse') : t('expand')}
              className="text-muted-foreground hover:text-foreground -m-1 p-1 transition-colors"
            >
              {aberta ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {onVerNaConversa && (
            <button
              type="button"
              onClick={onVerNaConversa}
              aria-label={t('verNaConversa')}
              title={t('verNaConversa')}
              className="text-muted-foreground hover:text-foreground -m-1 p-1 transition-colors"
            >
              <Locate className="h-3.5 w-3.5" />
            </button>
          )}
          {onFixar && (
            <button
              type="button"
              onClick={() => onFixar(!fixada)}
              disabled={fixando}
              aria-label={fixada ? tSidebar('unpinNote') : tSidebar('pinNote')}
              title={fixada ? tSidebar('unpinNote') : tSidebar('pinNote')}
              className="text-muted-foreground hover:text-foreground -m-1 p-1 transition-colors disabled:opacity-50"
            >
              {fixada ? (
                <PinOff className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {podeApagar &&
            (confirmando ? (
              <span className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => onApagar(nota.id)}
                  className="text-destructive font-semibold underline underline-offset-2 hover:opacity-80"
                >
                  {t('confirmDelete')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  className="text-muted-foreground underline underline-offset-2 hover:opacity-80"
                >
                  {t('cancelDelete')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={t('delete')}
                title={t('delete')}
                onClick={() => setConfirmando(true)}
                className="text-muted-foreground hover:text-destructive -m-1 p-1 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ))}
        </span>
      </div>
      <p
        ref={textoRef}
        className={cn(
          'text-foreground mt-2 text-sm leading-relaxed whitespace-pre-wrap',
          // ⚠️ `break-words`: a anotação recebe texto de fora (link de
          // processo colado, número sem espaços) e a coluna do painel é
          // estreita — sem isto ela empurra a largura e acende barra
          // horizontal, a armadilha que o CLAUDE.md registra sobre a bolha
          // do fio.
          'break-words',
          destaque && (aberta ? 'max-h-64 overflow-y-auto' : 'line-clamp-2')
        )}
      >
        {/* Endereço clicável (29/09/2026) — link de documento colado na
            nota é o caso comum. */}
        <TextoComLinks texto={nota.texto} />
      </p>
    </div>
  );
}
