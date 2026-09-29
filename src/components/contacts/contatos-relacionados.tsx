'use client';

// ============================================================
// A aba "Relacionados" (1069): as fichas ligadas a esta — no painel da
// conversa e na ficha de /contatos. O vínculo vale para os dois lados, e
// clicar no nome abre a conversa da outra pessoa.
//
// Os dados vêm por PROP (`useContatosRelacionados` em quem monta): o painel
// precisa do número para a etiqueta da aba antes de ela abrir.
//
// ⚠️ Quem monta passa `key={contactId}`: o formulário de vincular e a edição
// da descrição são RASCUNHO, e sem a chave o rascunho de A sobreviveria sob o
// cabeçalho de B — e o Vincular ligaria B ao contato escolhido na tela de A.
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Link2, MessageSquare, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { SeletorDeContatoRemoto } from '@/components/contacts/seletor-de-contato-remoto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCan } from '@/hooks/use-can';
import type { EstadoDosRelacionados } from '@/hooks/use-contatos-relacionados';
import { TETO_DE_RESULTADOS } from '@/lib/contacts/busca-remota';
import { identidadeDoContato, nomeDoContato } from '@/lib/contacts/identidade';
import {
  TETO_DA_DESCRICAO,
  type ContatoDoVinculo,
  type DesfechoDaEscrita,
  type Relacionado,
} from '@/lib/contacts/relacionados';
import { urlDoInbox } from '@/lib/inbox/url';
import { cn } from '@/lib/utils';

type Acao = 'vincular' | 'editar' | 'desvincular';

export function ContatosRelacionados({
  contactId,
  accountId,
  relacionados,
  podeEditar,
  onAbrirConversa,
  onConversar,
}: {
  contactId: string;
  /** Recorta a busca do seletor à conta ativa. */
  accountId: string | null;
  relacionados: EstadoDosRelacionados;
  /** Vincular, editar e desvincular: quem edita o contato (`agent`+). */
  podeEditar: boolean;
  /**
   * Caixa de entrada: abre a conversa na PRÓPRIA página (e liga a faixa de
   * volta). Ausente — a ficha de /contatos —, o nome vira link para
   * `/inbox?c=`.
   */
  onAbrirConversa?: (conversaId: string) => void;
  /**
   * Contato sem conversa: abre a "Nova conversa" já preenchida. Só a caixa de
   * entrada passa — o diálogo mora na lista de conversas, e na ficha de
   * /contatos o pedido não teria quem o ouvisse.
   */
  onConversar?: (contato: ContatoDoVinculo) => void;
}) {
  const t = useTranslations('Contacts.related');
  const podeEnviar = useCan('send-messages');
  const { itens, carregando, falhou } = relacionados;

  const [vinculando, setVinculando] = useState(false);
  const [escolhido, setEscolhido] = useState('');
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState<{ vinculoId: string; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const ehOProprio = escolhido !== '' && escolhido === contactId;
  const jaVinculado = escolhido !== '' && !!itens?.some((r) => r.contatoId === escolhido);

  function avisar(acao: Acao, desfecho: DesfechoDaEscrita) {
    switch (desfecho) {
      case 'ok':
        toast.success(
          acao === 'vincular'
            ? t('toastLinked')
            : acao === 'editar'
              ? t('toastDescriptionSaved')
              : t('toastUnlinked'),
        );
        return;
      case 'ja-vinculados':
        toast.error(t('alreadyLinked'));
        return;
      case 'invalido':
        toast.error(t('toastInvalid'));
        return;
      case 'recusado':
        toast.error(t('toastRefused'));
        return;
      case 'sumiu':
        // No vincular, quem sumiu é a FICHA escolhida; nos outros, o vínculo.
        if (acao === 'vincular') toast.error(t('toastContactGone'));
        else toast.info(t('toastLinkGone'));
        return;
      case 'falhou':
        toast.error(t('toastFailed'));
        return;
    }
  }

  function fecharFormulario() {
    setVinculando(false);
    setEscolhido('');
    setDescricao('');
  }

  async function vincular() {
    if (!escolhido || ehOProprio || jaVinculado || salvando) return;
    setSalvando(true);
    const desfecho = await relacionados.vincular(escolhido, descricao);
    setSalvando(false);
    avisar('vincular', desfecho);
    if (desfecho === 'ok' || desfecho === 'ja-vinculados') fecharFormulario();
  }

  async function salvarDescricao() {
    if (!editando || salvando) return;
    setSalvando(true);
    const desfecho = await relacionados.editarDescricao(editando.vinculoId, editando.texto);
    setSalvando(false);
    avisar('editar', desfecho);
    if (desfecho !== 'falhou') setEditando(null);
  }

  async function desvincular(vinculoId: string) {
    if (salvando) return;
    setSalvando(true);
    const desfecho = await relacionados.desvincular(vinculoId);
    setSalvando(false);
    setConfirmando(null);
    avisar('desvincular', desfecho);
  }

  return (
    <div className="space-y-3">
      {podeEditar && !vinculando && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setVinculando(true)}>
            <Link2 className="size-3.5" />
            {t('linkContact')}
          </Button>
        </div>
      )}

      {podeEditar && vinculando && (
        <div className="border-border space-y-2 rounded-md border p-2.5">
          <SeletorDeContatoRemoto
            value={escolhido}
            onChange={setEscolhido}
            accountId={accountId ?? undefined}
            placeholder={t('chooseContact')}
            searchPlaceholder={t('contactSearchPlaceholder')}
            hintText={t('contactSearchHint')}
            loadingText={t('loading')}
            emptyText={t('contactSearchEmpty')}
            failedText={t('contactSearchFailed')}
            moreText={t('contactSearchMore', { count: TETO_DE_RESULTADOS })}
            ariaLabel={t('chooseContact')}
          />
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={TETO_DA_DESCRICAO}
            placeholder={t('descriptionPlaceholder')}
            aria-label={t('descriptionLabel')}
            className="h-8"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void vincular();
              }
            }}
          />
          {(ehOProprio || jaVinculado) && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {ehOProprio ? t('sameContact') : t('alreadyLinked')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={fecharFormulario} disabled={salvando}>
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => void vincular()}
              disabled={!escolhido || ehOProprio || jaVinculado || salvando}
            >
              {t('confirmLink')}
            </Button>
          </div>
        </div>
      )}

      {carregando ? (
        <p className="text-muted-foreground text-xs">{t('loading')}</p>
      ) : falhou || !itens ? (
        // ⚠️ Falha NÃO vira "nenhum contato relacionado": seria afirmar que
        // não há vínculo sobre uma leitura que não respondeu.
        <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
          <span>{t('loadFailed')}</span>
          <button
            type="button"
            onClick={relacionados.recarregar}
            className="shrink-0 font-semibold underline underline-offset-2 hover:opacity-80"
          >
            {t('retry')}
          </button>
        </div>
      ) : itens.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
          <p>{t('empty')}</p>
          {podeEditar && <p className="mt-1">{t('emptyHint')}</p>}
        </div>
      ) : (
        <ul className="space-y-2">
          {itens.map((r) => (
            <LinhaDoRelacionado
              key={r.vinculoId}
              r={r}
              podeEditar={podeEditar}
              podeConversar={podeEnviar && !!onConversar}
              onAbrirConversa={onAbrirConversa}
              onConversar={onConversar}
              editando={editando?.vinculoId === r.vinculoId ? editando.texto : null}
              onEditar={(texto) => setEditando({ vinculoId: r.vinculoId, texto })}
              onSalvarDescricao={() => void salvarDescricao()}
              onCancelarEdicao={() => setEditando(null)}
              confirmando={confirmando === r.vinculoId}
              onPedirDesvincular={() => setConfirmando(r.vinculoId)}
              onDesvincular={() => void desvincular(r.vinculoId)}
              onCancelarDesvincular={() => setConfirmando(null)}
              salvando={salvando}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaDoRelacionado({
  r,
  podeEditar,
  podeConversar,
  onAbrirConversa,
  onConversar,
  editando,
  onEditar,
  onSalvarDescricao,
  onCancelarEdicao,
  confirmando,
  onPedirDesvincular,
  onDesvincular,
  onCancelarDesvincular,
  salvando,
}: {
  r: Relacionado;
  podeEditar: boolean;
  podeConversar: boolean;
  onAbrirConversa?: (conversaId: string) => void;
  onConversar?: (contato: ContatoDoVinculo) => void;
  /** Texto em edição da descrição; NULO = não está editando esta linha. */
  editando: string | null;
  onEditar: (texto: string) => void;
  onSalvarDescricao: () => void;
  onCancelarEdicao: () => void;
  confirmando: boolean;
  onPedirDesvincular: () => void;
  onDesvincular: () => void;
  onCancelarDesvincular: () => void;
  salvando: boolean;
}) {
  const t = useTranslations('Contacts.related');
  const nome = nomeDoContato(r.contato, t('unknownContact'));
  // A identidade só vai embaixo quando o nome é um NOME (senão repetiria o
  // telefone que já virou o nome).
  const identidade = r.contato?.name?.trim() ? identidadeDoContato(r.contato) : null;
  const inicial = nome.trim().charAt(0).toUpperCase() || '?';

  const corpo = (
    <>
      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
        {inicial}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{nome}</span>
        {identidade && (
          <span className="text-muted-foreground block truncate text-xs">{identidade}</span>
        )}
        {r.descricao && editando === null && (
          <span className="text-foreground/80 mt-0.5 block text-xs break-words">{r.descricao}</span>
        )}
      </span>
      {r.conversaId && (
        <MessageSquare className="text-muted-foreground mt-1 size-3.5 shrink-0" aria-hidden />
      )}
    </>
  );

  // Botão ou link com a MESMA caixa — o que muda é quem abre a conversa.
  const classeDoCorpo =
    'flex min-w-0 flex-1 items-start gap-2.5 rounded-md p-2.5 text-left transition-colors';

  return (
    <li className="border-border rounded-md border">
      <div className="flex items-start">
        {r.conversaId && onAbrirConversa ? (
          <button
            type="button"
            onClick={() => onAbrirConversa(r.conversaId!)}
            title={t('openConversation')}
            className={cn(classeDoCorpo, 'hover:bg-muted/60')}
          >
            {corpo}
          </button>
        ) : r.conversaId ? (
          <Link
            href={urlDoInbox({ c: r.conversaId })}
            title={t('openConversation')}
            className={cn(classeDoCorpo, 'hover:bg-muted/60')}
          >
            {corpo}
          </Link>
        ) : (
          <div className={classeDoCorpo}>{corpo}</div>
        )}

        {/* Irmãos do corpo, nunca dentro dele: botão aninhado é inválido. */}
        {podeEditar && editando === null && !confirmando && (
          <div className="flex shrink-0 items-center gap-0.5 p-1.5">
            <button
              type="button"
              onClick={() => onEditar(r.descricao ?? '')}
              aria-label={t('editDescription')}
              title={t('editDescription')}
              className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onPedirDesvincular}
              aria-label={t('unlink')}
              title={t('unlink')}
              className="text-muted-foreground hover:text-destructive rounded p-1 transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {editando !== null && (
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
          <Input
            autoFocus
            value={editando}
            onChange={(e) => onEditar(e.target.value)}
            maxLength={TETO_DA_DESCRICAO}
            placeholder={t('descriptionPlaceholder')}
            aria-label={t('descriptionLabel')}
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSalvarDescricao();
              } else if (e.key === 'Escape') {
                onCancelarEdicao();
              }
            }}
          />
          <button
            type="button"
            onClick={onSalvarDescricao}
            disabled={salvando}
            aria-label={t('save')}
            title={t('save')}
            className="text-primary rounded p-1 hover:opacity-80 disabled:opacity-50"
          >
            <Check className="size-4" />
          </button>
          <button
            type="button"
            onClick={onCancelarEdicao}
            aria-label={t('cancel')}
            title={t('cancel')}
            className="text-muted-foreground hover:text-foreground rounded p-1"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {confirmando && (
        <div className="flex items-center justify-end gap-3 px-2.5 pb-2.5 text-xs">
          <span className="text-muted-foreground">{t('unlinkQuestion')}</span>
          <button
            type="button"
            onClick={onDesvincular}
            disabled={salvando}
            className="text-destructive font-semibold underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
          >
            {t('confirmUnlink')}
          </button>
          <button
            type="button"
            onClick={onCancelarDesvincular}
            className="text-muted-foreground underline underline-offset-2 hover:opacity-80"
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {!r.conversaId && (
        <div className="text-muted-foreground flex items-center gap-2 px-2.5 pb-2.5 pl-[3.25rem] text-xs">
          <span>{t('noConversation')}</span>
          {podeConversar && r.contato?.phone && onConversar && (
            <button
              type="button"
              onClick={() => onConversar(r.contato!)}
              className="text-primary font-medium underline underline-offset-2 hover:opacity-80"
            >
              {t('startConversation')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
