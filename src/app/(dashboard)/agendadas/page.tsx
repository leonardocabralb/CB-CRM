'use client';

// ============================================================
// A tela global de mensagens agendadas (Fase C).
//
// ⚠️ POR QUE ELA EXISTE: até aqui as agendadas só apareciam DENTRO da conversa.
// Não havia como perguntar "o que vai sair esta semana?" sem abrir conversa por
// conversa — e num escritório com 64 conversas isso quer dizer que ninguém
// perguntava.
//
// ⚠️ NÃO SUBSTITUI A FAIXA DO FIO, e as duas não são redundantes: a faixa
// existe para quem já está escrevendo TROPEÇAR no que está marcado antes de
// mandar; esta tela existe para quem quer olhar o conjunto. Tirar a faixa
// devolveria o problema que ela resolveu (escrever por cima e o cliente receber
// duas).
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  Loader2,
  Trash2,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAcoesDaAgendada } from '@/hooks/use-acoes-da-agendada';
import {
  useAgendadasDaConta,
  type AgendadaDaConta,
} from '@/hooks/use-agendadas-da-conta';
import { useAgendadorSaude } from '@/hooks/use-agendador-saude';
import { useCan } from '@/hooks/use-can';
import { useChannels } from '@/hooks/use-channels';
import { channelLabel } from '@/lib/cb-channels/display';
import { tituloDaConversa } from '@/lib/cb-groups/display';
import {
  clienteEscreveuDepois,
  estaAtrasada,
  ordenarParaTela,
  podeDispararAgora,
} from '@/lib/scheduled/display';
import {
  filtrarPorSituacao,
  SITUACOES,
  type Situacao,
} from '@/lib/scheduled/tela-global';
import { cn } from '@/lib/utils';

export default function AgendadasPage() {
  const t = useTranslations('Scheduled');
  // ⚠️ Os textos de situação, canal e as duas ações vêm do namespace da FAIXA,
  // não de cópias novas: são as mesmas frases, e duas versões da mesma frase
  // envelhecem separadas — a faixa passaria a avisar sobre entrega incerta com
  // palavras diferentes das desta tela.
  const tInbox = useTranslations('Inbox.scheduled');
  const tSaude = useTranslations('Inbox.scheduled.saude');
  const {
    agendadas,
    carregando,
    falhou,
    contagem,
    ultimaEntradaPorConversa,
    temMaisEnviadas,
    estourouOTeto,
    carregarMais,
    recarregar,
  } = useAgendadasDaConta();
  const { saude, recarregar: recarregarSaude } = useAgendadorSaude();
  // ⚠️ As duas recargas juntas. A faixa de saúde tem estado PRÓPRIO e só
  // reconfere de 5 em 5 minutos; sem isto, cancelar a última falha zerava a aba
  // "Falhas" logo abaixo enquanto a faixa continuava anunciando "1 mensagem
  // falhou e espera decisão" — a mesma tela afirmando as duas coisas.
  const aoMudar = useCallback(() => {
    recarregar();
    recarregarSaude();
  }, [recarregar, recarregarSaude]);
  const { ocupada, enviarAgora, cancelar } = useAcoesDaAgendada(aoMudar);
  const { channels } = useChannels();
  const podeAgir = useCan('send-messages');
  const [situacao, setSituacao] = useState<Situacao>('todas');

  const mostrarCanal = channels.length > 1;

  // ⚠️ Ordena SEMPRE, mesmo já vindo do banco em três consultas na ordem certa.
  // A ordem da tela é uma regra do produto ("o que sai primeiro em cima, o que
  // saiu por último logo abaixo"), não um efeito colateral de como a busca foi
  // escrita — e ela é testada em `display.test.ts`.
  const ordenadas = useMemo(() => ordenarParaTela(agendadas), [agendadas]);
  const visiveis = useMemo(
    () => filtrarPorSituacao(ordenadas, situacao) as AgendadaDaConta[],
    [ordenadas, situacao],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CalendarClock className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      {/* ⚠️ O estado do agendador aparece AQUI e sob demanda, não como faixa
          permanente no cabeçalho do sistema. Foi a pergunta que o operador fez
          ("como eu confiro que ele está vivo, se o aviso só aparece quando dá
          problema?") — e esta é a tela onde ela é feita. Um indicador em toda
          página vira papel de parede e deixa de ser lido. */}
      {saude && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            saude.tom === 'down' &&
              'border-destructive/40 bg-destructive/10 text-destructive',
            saude.tom === 'warn' &&
              'border-amber-500/40 bg-amber-500/10 text-amber-600',
            saude.tom === 'ok' && 'border-border bg-muted/40 text-muted-foreground',
          )}
        >
          {saude.tom !== 'ok' && (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <p>
            {/* ⚠️ Cada recado tem seus PRÓPRIOS parâmetros — `paradoComFila`
                quer `{fila}`, `falhas` quer `{n}`. Montar a chave por
                interpolação (`t('health_' + recado)`) compilaria e renderizaria
                o número errado no lugar errado, em silêncio. */}
            {saude.recado === 'paradoComFila' &&
              tSaude('paradoComFila', { fila: saude.pendentes })}
            {saude.recado === 'paradoSemFila' && tSaude('paradoSemFila')}
            {saude.recado === 'nuncaRodou' && tSaude('nuncaRodou')}
            {saude.recado === 'falhas' && tSaude('falhas', { n: saude.falhas })}
            {saude.recado === null && t('healthOk')}{' '}
            {/* O número cru importa: "parado há 4 horas" e "parado há 40
                minutos" pedem reações diferentes. */}
            {saude.minutosSemCiclo !== null &&
              tSaude('ultimoCiclo', { min: saude.minutosSemCiclo })}
          </p>
        </div>
      )}

      {/* Abas de situação. Os números são os TOTAIS DA CONTA (`count: 'exact'`
          no hook), não o tamanho da página.
          ⚠️ Os números somem quando a busca falhou: com a lista vazia por erro,
          quatro zeros ao lado das abas afirmariam "não há nada" logo acima da
          caixa que admite não saber de nada — a tela dizendo duas coisas
          contrárias ao mesmo tempo. */}
      <div className="flex flex-wrap gap-2">
        {SITUACOES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSituacao(s)}
            aria-pressed={situacao === s}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              situacao === s
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`tab_${s}`)}
            {!falhou && !carregando && (
              <span className="ml-1.5 opacity-70">{contagem[s]}</span>
            )}
          </button>
        ))}
      </div>

      {estourouOTeto && (
        <p className="text-xs text-amber-600">{t('capReached')}</p>
      )}

      {carregando ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : falhou ? (
        // ⚠️ Nunca cair no estado vazio por falha: "não há nada agendado" é a
        // frase que faz alguém agendar de novo o que já estava agendado.
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
          {t('loadFailed')}
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
          {situacao === 'todas' ? t('emptyAll') : t('emptyFiltered')}
        </div>
      ) : (
        <div className="space-y-2">
          {visiveis.map((a) => {
            const atrasada = estaAtrasada(a);
            const respondeu = clienteEscreveuDepois(
              a,
              ultimaEntradaPorConversa.get(a.conversation_id) ?? null,
            );
            // ⚠️ `tituloDaConversa` é a MESMA regra da lista do inbox e do
            // cabeçalho do fio, e é ela que faz conversa de GRUPO aparecer com
            // nome: grupo não tem contato (`conversations.contact_id` é nulo
            // lá), então ler `contact.name` direto deixaria a coluna em branco.
            //
            // ⚠️ O ramo sem conversa NÃO quer dizer "conversa apagada" — a FK
            // da 925 é `ON DELETE CASCADE`, então a agendada não sobrevive à
            // conversa e esse estado é inalcançável por exclusão. Sobra o embed
            // não ter vindo. Nomear a causa errada mandaria alguém procurar uma
            // exclusão que não houve.
            const paraQuem = a.conversation
              ? tituloDaConversa(a.conversation, {
                  semNome: t('groupNoName'),
                  desconhecido: t('unknownRecipient'),
                })
              : t('conversationUnavailable');
            return (
              <div
                key={a.id}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-start',
                  a.status === 'failed' && 'border-destructive/40',
                )}
              >
                {/* quando · situação */}
                <div className="w-full shrink-0 sm:w-40">
                  <span
                    className={cn(
                      'inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                      a.status === 'failed'
                        ? 'bg-destructive/15 text-destructive'
                        : a.status === 'sent'
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-primary/15 text-primary',
                    )}
                  >
                    {tInbox(`status_${a.status}`)}
                  </span>
                  <p className="mt-1 text-xs leading-tight text-muted-foreground">
                    {/* `undefined` como locale, nunca 'pt-BR' fixo: é a regra
                        do projeto para data não sair em inglês nem ignorar o
                        fuso de quem olha. */}
                    {new Date(a.sent_at ?? a.scheduled_for).toLocaleString(undefined, {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>

                {/* para quem · prévia · quem agendou */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-foreground">
                      {paraQuem}
                    </p>
                    {a.conversation && (
                      <Link
                        href={`/inbox?c=${a.conversation.id}`}
                        title={t('openConversation')}
                        aria-label={t('openConversation')}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {a.body}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {tInbox('scheduledBy', { name: a.autor_nome })}
                    {mostrarCanal && (
                      <>
                        {' · '}
                        {/* ⚠️ O canal é o da AGENDADA (`a.channel_id`), fixado
                            quando ela foi marcada — nunca o canal atual da
                            conversa. São coisas diferentes: se o cliente
                            escreveu por outro número no meio-tempo, a conversa
                            se moveu e esta mensagem continua saindo pelo
                            número escolhido (P4.3). */}
                        {channelLabel(channels, a.channel_id) ?? tInbox('channelGone')}
                      </>
                    )}
                  </p>

                  {a.error && (
                    <p className="mt-1 text-[10px] text-destructive">{a.error}</p>
                  )}
                  {atrasada && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {tInbox('overdue')}
                    </p>
                  )}
                  {/* ⚠️ 926: falhou DEPOIS de o WhatsApp aceitar. Sem esta
                      linha "Falhou" convida a mandar de novo — e o cliente
                      recebe duas vezes. `podeDispararAgora` já esconde o
                      botão; o recado explica por quê. */}
                  {a.entrega_incerta && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {tInbox('uncertainDelivery')}
                    </p>
                  )}
                  {/* ⚠️ P4.4, e AQUI ele pesa mais que na faixa da conversa: lá
                      o operador tem o fio na frente e vê a resposta do cliente
                      sozinho. Nesta tela ele decide "Executar agora" sem ver
                      conversa nenhuma — sem este aviso, mandaria um "confirmo
                      nosso horário de amanhã" para quem cancelou de madrugada. */}
                  {respondeu && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {tInbox('customerRepliedSince')}
                    </p>
                  )}
                </div>

                {/* ⚠️ Linha JÁ ENVIADA não tem ação, e isso é decisão, não
                    esquecimento. A policy da 925 até permite apagá-la (não
                    desfaz envio nenhum — a mensagem está em `messages`), mas o
                    texto da confirmação promete "o envio agendado não vai
                    sair", que ali é FALSO: já saiu. E o que sobraria seria
                    apagar o registro do que foi mandado ao cliente, que é o
                    contrário do que uma tela de acervo serve. */}
                {podeAgir && a.status !== 'sent' && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {podeDispararAgora(a) && (
                      <button
                        type="button"
                        onClick={() => void enviarAgora(a)}
                        disabled={ocupada === a.id}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
                      >
                        {ocupada === a.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Zap className="h-3 w-3" />
                        )}
                        {a.status === 'failed' ? tInbox('retry') : tInbox('sendNow')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void cancelar(a)}
                      disabled={ocupada === a.id}
                      title={tInbox('cancel')}
                      aria-label={tInbox('cancel')}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-destructive text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* ⚠️ Só o acervo de ENVIADAS pagina — fila e falhas vêm inteiras.
              O botão some quando a aba aberta não contém enviadas, senão
              "carregar mais" prometeria linhas que aquele filtro não mostra. */}
          {temMaisEnviadas && (situacao === 'todas' || situacao === 'enviadas') && (
            <button
              type="button"
              onClick={carregarMais}
              className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              {t('loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
