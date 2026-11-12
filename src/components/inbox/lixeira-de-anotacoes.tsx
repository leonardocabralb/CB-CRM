'use client';

import { ArrowLeft, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { AnexosDaNota } from '@/components/inbox/anexos-da-nota';
import { MarcaDeEditada } from '@/components/inbox/marca-de-editada';
import { TextoComLinks } from '@/components/inbox/texto-com-links';
import {
  DIAS_NA_LIXEIRA_DE_ANOTACOES,
  diasParaVencer,
  naOrdemDaLixeira,
  podeMexerNaNota,
} from '@/lib/notes/lixeira';
import type { ConversationNote } from '@/types';

// ============================================================
// Lixeira de anotações (1132) — a peça da aba Notas
//
// Pedido do operador (10/11/2026): um ícone pequeno e discreto de lixeira na
// aba Notas mostra as anotações apagadas da conversa, na ordem em que foram
// escritas, e dali se restaura. Mora aqui para o painel do contato e o do
// grupo não divergirem; quem monta guarda o "estou vendo a lixeira"
// CARIMBADO com a conversa (`{ de }`), e esconde (sem desmontar) a caixa de
// escrever enquanto isso — o rascunho mora dentro dela.
// ============================================================

/** O ícone discreto que abre a lixeira; com a contagem quando há apagadas. */
export function BotaoDaLixeiraDeAnotacoes({
  quantas,
  onAbrir,
}: {
  /** `null` = a lista não respondeu (sem número — nunca "0" por ignorância). */
  quantas: number | null;
  onAbrir: () => void;
}) {
  const t = useTranslations('Inbox.note.lixeira');
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={t('abrir')}
      title={t('abrir')}
      className="text-muted-foreground hover:text-foreground -m-1 inline-flex items-center gap-1 p-1 text-[11px] transition-colors"
    >
      <Trash2 className="h-3.5 w-3.5" />
      {quantas !== null && quantas > 0 && <span>{quantas}</span>}
    </button>
  );
}

/** A lixeira aberta: cabeçalho com a volta e a lista das apagadas. */
export function LixeiraDeAnotacoes({
  apagadas,
  pronta,
  falhou,
  usuarioId,
  administra,
  onRestaurar,
  onVoltar,
}: {
  apagadas: readonly ConversationNote[];
  /** A busca DESTA conversa voltou bem: só aí o vazio é resposta. */
  pronta: boolean;
  falhou: boolean;
  usuarioId: string | null | undefined;
  /** Admin/dono restaura qualquer uma; os outros, só as que escreveram. */
  administra: boolean;
  /** `true` quando a anotação voltou. */
  onRestaurar: (id: string) => Promise<boolean>;
  onVoltar: () => void;
}) {
  const t = useTranslations('Inbox.note.lixeira');
  // O relógio do prazo "sai em N dias", por tique (o React Compiler recusa
  // `Date.now()` no render).
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60 * 60_000);
    return () => clearInterval(id);
  }, []);
  const lista = useMemo(() => naOrdemDaLixeira(apagadas), [apagadas]);

  return (
    <div>
      <button
        type="button"
        onClick={onVoltar}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('voltar')}
      </button>
      <h3 className="text-foreground mt-2 flex items-center gap-1.5 text-sm font-semibold">
        <Trash2 className="h-4 w-4" />
        {t('titulo')}
      </h3>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        {t('explica', { dias: DIAS_NA_LIXEIRA_DE_ANOTACOES })}
      </p>

      <div className="mt-3 space-y-3">
        {lista.map((nota) => (
          <CartaoDeNotaApagada
            key={nota.id}
            nota={nota}
            agora={agora}
            podeRestaurar={podeMexerNaNota(nota, usuarioId, administra)}
            onRestaurar={onRestaurar}
          />
        ))}
        {/* Vazio só é afirmação com a busca DESTA conversa respondida. */}
        {falhou ? (
          <p className="text-destructive py-6 text-center text-xs">{t('erro')}</p>
        ) : !pronta ? (
          <p className="text-muted-foreground flex items-center justify-center gap-1.5 py-6 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('carregando')}
          </p>
        ) : lista.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-xs">
            {t('vazia', { dias: DIAS_NA_LIXEIRA_DE_ANOTACOES })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** "28 de out., 14:18" — locale do navegador, nunca fixo. */
function quando(instante: string): string {
  return new Date(instante).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Uma anotação na lixeira: o autor e a data em que foi escrita (como na aba),
 * quem apagou e quando, o prazo, o texto INTEIRO e os anexos, e o Restaurar
 * para quem pode. Sem fixar, responder, editar nem "ver na conversa": ela não
 * está no fio.
 */
function CartaoDeNotaApagada({
  nota,
  agora,
  podeRestaurar,
  onRestaurar,
}: {
  nota: ConversationNote;
  agora: number;
  podeRestaurar: boolean;
  onRestaurar: (id: string) => Promise<boolean>;
}) {
  const t = useTranslations('Inbox.note');
  const tLixeira = useTranslations('Inbox.note.lixeira');
  const [restaurando, setRestaurando] = useState(false);
  const dias = nota.apagada_em ? diasParaVencer(nota.apagada_em, agora) : null;

  const restaurar = async () => {
    setRestaurando(true);
    const voltou = await onRestaurar(nota.id);
    // Voltou: o cartão sai da lixeira (a linha muda de lista) e desmonta.
    if (!voltou) setRestaurando(false);
  };

  return (
    <div className="bg-muted/40 border-border rounded-lg border border-dashed p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground text-xs font-semibold break-words">
            {t(nota.resposta_de ? 'replied' : 'wrote', {
              autor: nota.autor_nome || t('unknownAuthor'),
            })}
          </p>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px]">
            <span>
              {new Date(nota.created_at).toLocaleString(undefined, {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <MarcaDeEditada editadaEm={nota.editada_em} criadaEm={nota.created_at} />
          </p>
        </div>
        {podeRestaurar && (
          <button
            type="button"
            onClick={() => void restaurar()}
            disabled={restaurando}
            className="text-primary hover:text-primary/80 inline-flex shrink-0 items-center gap-1 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {restaurando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {restaurando ? tLixeira('restaurando') : tLixeira('restaurar')}
          </button>
        )}
      </div>
      {nota.apagada_em && (
        <p className="text-destructive mt-1.5 text-[11px] font-medium">
          {nota.apagada_por_nome
            ? tLixeira('apagadaPor', { nome: nota.apagada_por_nome, quando: quando(nota.apagada_em) })
            : tLixeira('apagadaEm', { quando: quando(nota.apagada_em) })}
          {dias !== null && (
            <span className="text-muted-foreground font-normal"> · {tLixeira('vence', { dias })}</span>
          )}
        </p>
      )}
      {/* Anotação só de anexos (1102) tem o texto vazio: sem parágrafo. */}
      {nota.texto.trim() && (
        <p className="text-foreground/80 mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
          <TextoComLinks texto={nota.texto} />
        </p>
      )}
      <AnexosDaNota anexos={nota.anexos} className="mt-2" />
    </div>
  );
}
