'use client';

// ============================================================
// O bloco "o que precisa ser corrigido" (só do administrador) e as peças que
// os blocos da aba compartilham. "O dia até agora" e "Negócios no funil"
// saíram a pedido do operador (29/09/2026, `docs/PLANO-meu-dia-v2.md`).
//
// ⚠️ CADA NÚMERO DIZ DE QUEM É (decisão do operador, 12/09): há coisa que é
// da pessoa (suas tarefas) e coisa que é da operação do escritório (as
// conexões, as entregas que falharam). Misturar as duas sem marca faria o
// operador ler o trabalho do escritório como sendo o dele — e, no bloco de
// correções, faria o contrário: ele acharia que a falha é "dele" e não ia
// mexer. A marca é a pastilha `De`.
// ============================================================

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';

import type { Bloco } from '@/hooks/use-resumo-do-dia';
import type { Correcoes, Integracoes } from '@/hooks/use-area-de-trabalho';
import { useChannels } from '@/hooks/use-channels';
import { channelLabel } from '@/lib/cb-channels/display';
import { nomeDoContato } from '@/lib/contacts/identidade';
import { urlDoInbox } from '@/lib/inbox/url';
import {
  DIAS_DE_RETIDA_NA_TELA,
  resumirCorrecoes,
  type EstadoDaFonte,
  type EstadoPorFonte,
  type FonteDeCorrecao,
} from '@/lib/meu-dia/correcoes';
import { cn } from '@/lib/utils';

import { Cabecalho } from './blocos-pessoais';

/** Traduz um `Bloco<T>` numa contagem para a régua das correções. */
function fonteDe<T>(
  bloco: Bloco<T>,
  quantidade: (dados: T) => number
): EstadoDaFonte {
  if (bloco.status === 'carregando') return { status: 'carregando' };
  if (bloco.status === 'falhou') return { status: 'falhou' };
  return {
    status: 'pronto',
    contagem: { quantidade: quantidade(bloco.dados) },
  };
}

export function BlocoDeCorrecoes({
  correcoes,
  integracoes,
  conexoes,
  conexoesAtrasadas,
  agendadorParado,
  veAgendadas,
  veAutomacoes,
  veConexoes,
  veIntegracoes,
  veWebhooks,
  veInbox,
  veContatos,
}: {
  correcoes: Bloco<Correcoes>;
  integracoes: Bloco<Integracoes>;
  /**
   * ⚠️ Estado, não número: `0` e "não consegui perguntar" são coisas
   * diferentes, e somá-las faz este bloco dizer "tudo em ordem" sobre uma
   * sonda que falhou (Codex, PR #202).
   */
  conexoes: EstadoDaFonte;
  conexoesAtrasadas: EstadoDaFonte;
  /** `null` enquanto a saúde do agendador não respondeu. */
  agendadorParado: boolean | null;
  veAgendadas: boolean;
  /**
   * ⚠️ Gate PRÓPRIO, não `veConfiguracoes`: Configurações é tela sempre
   * visível, então ela é verdadeira para todo perfil — e um perfil sem
   * Automações via o link, clicava e caía na `TelaBloqueada` (Codex, PR
   * #202). Cada destino é gateado pela tela PARA ONDE ELE LEVA.
   */
  veAutomacoes: boolean;
  /**
   * ⚠️ Por SEÇÃO, não pela tela de Configurações: ela não é recortável
   * (sempre visível), mas as seções DENTRO dela são. Um perfil sem
   * `channels` no `secoes_config` clicava no link e a página o mandava para
   * a primeira seção pessoal que ele enxerga (Codex, PR #202).
   */
  veConexoes: boolean;
  veIntegracoes: boolean;
  /** A seção Webhooks é só de admin (`SECOES_SO_DE_ADMIN`): gate próprio. */
  veWebhooks: boolean;
  /** Para onde levar a falha de automação: a conversa, senão a ficha. */
  veInbox: boolean;
  veContatos: boolean;
}) {
  const t = useTranslations('MeuDia');
  // Só para dar NOME à conexão das mensagens retidas. Falha silenciosa e lista
  // vazia durante a carga (o contrato do hook): aqui o vazio só troca o nome
  // por um travessão por um instante — não afirma nada.
  const { channels } = useChannels();

  /**
   * ⚠️ `retidas: null` é "a rota não conseguiu conferir ESTA parte" (banco
   * sem a 1010, erro só daquela consulta) — vira `falhou`, nunca zero: zero
   * deixaria o bloco dizer "tudo em ordem" sobre pergunta não respondida.
   */
  const mensagensRetidas: EstadoDaFonte =
    integracoes.status !== 'pronto'
      ? { status: integracoes.status }
      : integracoes.dados.retidas === null
        ? { status: 'falhou' }
        : {
            status: 'pronto',
            contagem: { quantidade: integracoes.dados.retidas.quantidade },
          };

  const estados: EstadoPorFonte = {
    agendador:
      agendadorParado === null
        ? { status: 'carregando' }
        : {
            status: 'pronto',
            contagem: { quantidade: agendadorParado ? 1 : 0 },
          },
    conexoes,
    conexoesAtrasadas,
    mensagensRetidas,
    agendadasFalharam: fonteDe(correcoes, (c) => c.agendadasFalharam),
    entregaIncerta: fonteDe(correcoes, (c) => c.entregaIncerta),
    automacoesFalharam: fonteDe(correcoes, (c) => c.automacoesFalharam),
    agendamentosNaoProcessados: fonteDe(integracoes, (i) => i.calendly),
    webhooksNaoProcessados: fonteDe(integracoes, (i) => i.webhooks),
  };
  const resumo = resumirCorrecoes(estados);

  // Cada achado com o seu texto e para onde se vai consertar. A régua de
  // "tela fora do perfil" é a de sempre: número sem link, com o aviso.
  // ⚠️ O parâmetro de Configurações é `?tab=`, NUNCA `?section=`: a página
  // lê `searchParams.get('tab')` e ignora o resto, então `?section=channels`
  // abre a Visão geral — o clique de conserto levaria ao lugar errado sem
  // erro nenhum (Codex, PR #202).
  const DESTINO: Record<FonteDeCorrecao, { href: string | null; ve: boolean }> = {
    agendador: { href: '/agendadas', ve: veAgendadas },
    conexoes: { href: '/settings?tab=channels', ve: veConexoes },
    conexoesAtrasadas: { href: '/settings?tab=channels', ve: veConexoes },
    // Sem tela: o conserto não é no CRM, é no CELULAR daquela conexão (a
    // lista logo abaixo diz qual e a que horas).
    mensagensRetidas: { href: null, ve: false },
    agendadasFalharam: { href: '/agendadas', ve: veAgendadas },
    entregaIncerta: { href: '/agendadas', ve: veAgendadas },
    automacoesFalharam: { href: '/automations', ve: veAutomacoes },
    // O log do Calendly mora no cartão dele, em Integrações; o dos webhooks,
    // em Webhooks → Recebidos — é lá que está o lead cujo telefone foi
    // recusado (nome e respostas), e ele só se resolve lendo o log.
    agendamentosNaoProcessados: {
      href: '/settings?tab=integracoes',
      ve: veIntegracoes,
    },
    webhooksNaoProcessados: {
      href: '/settings?tab=webhooks&aba=recebidos',
      ve: veWebhooks,
    },
  };

  const texto = (fonte: FonteDeCorrecao, count: number): string => {
    // Chaves LITERAIS, uma por fonte: chave montada escapa do portão de i18n
    // do CI (`i18n-chaves-usadas.mjs` conta a dinâmica, não a confere).
    if (fonte === 'agendador') return t('fixSchedulerDown');
    if (fonte === 'conexoes') return t('fixChannelsDown', { count });
    if (fonte === 'conexoesAtrasadas')
      return t('fixChannelsLagging', { count });
    if (fonte === 'mensagensRetidas')
      return t('fixHeldMessages', { count, dias: DIAS_DE_RETIDA_NA_TELA });
    if (fonte === 'agendadasFalharam')
      return t('fixScheduledFailed', { count });
    if (fonte === 'entregaIncerta') return t('fixDeliveryUnsure', { count });
    if (fonte === 'automacoesFalharam')
      return t('fixAutomationsFailed', { count });
    if (fonte === 'agendamentosNaoProcessados')
      return t('fixBookingsStuck', { count });
    return t('fixWebhooksStuck', { count });
  };

  return (
    <section className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={
          <Wrench
            className={cn(
              'size-4',
              resumo.situacao === 'temProblema' && 'text-destructive'
            )}
            aria-hidden
          />
        }
        titulo={t('fixTitle')}
        direita={
          <span className="flex items-center gap-2 text-sm">
            {/* ⚠️ O total só aparece quando é CONFIÁVEL: com uma fonte ainda
                em voo ou que falhou, o número seria um parcial com cara de
                fechado — e a lista abaixo já mostra o que se sabe. */}
            {resumo.situacao === 'temProblema' &&
              resumo.conferindo.length === 0 &&
              resumo.naoConferidas.length === 0 && (
                <span className="text-destructive font-medium tabular-nums">
                  {resumo.aoMenos
                    ? t('fixCountAtLeast', { count: resumo.total })
                    : resumo.total}
                </span>
              )}
            <De escopo="escritorio" />
          </span>
        }
      />

      {resumo.situacao === 'conferindo' && (
        <p className="text-muted-foreground mt-2 text-sm">{t('checking')}</p>
      )}

      {resumo.situacao === 'limpo' && (
        <p className="text-foreground mt-2 flex items-center gap-1.5 text-sm">
          <CheckCircle2
            className="size-4 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          {t('fixNone')}
        </p>
      )}

      {/* ⚠️ Zero COM uma consulta que falhou nunca vira "tudo em ordem": este
          bloco existe para avisar que algo quebrou, e um selo verde sobre
          pergunta não respondida é o contrário do que ele serve. */}
      {resumo.situacao === 'incompleto' && (
        <p className="text-muted-foreground mt-2 text-sm">
          {t('fixIncomplete', { count: resumo.naoConferidas.length })}
        </p>
      )}

      {resumo.achados.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {resumo.achados.map((a) => {
            const destino = DESTINO[a.fonte];
            const conteudo = (
              <>
                <AlertTriangle
                  className="text-destructive size-3.5 shrink-0"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  {texto(a.fonte, a.quantidade)}
                </span>
              </>
            );
            const classes = 'flex items-baseline gap-1.5 text-sm';
            return (
              <li key={a.fonte}>
                {destino.ve && destino.href ? (
                  <Link
                    href={destino.href}
                    className={cn(classes, 'hover:bg-muted/60 rounded-md')}
                  >
                    {conteudo}
                  </Link>
                ) : (
                  <div className={classes}>{conteudo}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ⚠️ As falhas de automação vêm NOMEADAS, com o caminho de conserto.
          Antes o achado levava a `/automations`, uma tela genérica onde o
          operador ainda teria de descobrir qual execução falhou e de quem
          era — e o conserto (executar a automação de novo) mora na CONVERSA
          do cliente. Sem conversa, cai na ficha, como as tarefas fazem. */}
      {correcoes.status === 'pronto' &&
        correcoes.dados.falhasDeAutomacao.length > 0 && (
          <ul className="border-border mt-2 space-y-1 border-t pt-2">
            {correcoes.dados.falhasDeAutomacao.map((f) => {
              const nome = nomeDoContato(f.contato, t('unknownContact'));
              const destino = f.conversationId
                ? veInbox
                  ? urlDoInbox({ c: f.conversationId })
                  : null
                : f.contato && veContatos
                  ? `/contacts?contact=${encodeURIComponent(f.contato.id)}`
                  : null;
              const texto = (
                <>
                  <span className="text-foreground">{nome}</span>
                  {f.automacao && (
                    <span className="text-muted-foreground">
                      {' · '}
                      {f.automacao}
                    </span>
                  )}
                </>
              );
              return (
                <li key={f.id} className="min-w-0 truncate text-xs">
                  {destino ? (
                    <Link href={destino} className="hover:underline">
                      {texto}
                    </Link>
                  ) : (
                    texto
                  )}
                </li>
              );
            })}
          </ul>
        )}

      {/* ⚠️ As retidas vêm com a CONEXÃO e a HORA: o conserto é olhar o
          celular daquele número e responder por lá — o eco traz o telefone e a
          fala entra sozinha na conversa. Sem isso o achado seria um número que
          não diz onde procurar. Nada de conteúdo nem telefone: a rota é de
          qualquer membro. */}
      {integracoes.status === 'pronto' &&
        integracoes.dados.retidas !== null &&
        integracoes.dados.retidas.itens.length > 0 && (
          <div className="border-border mt-2 border-t pt-2">
            {/* Com título: os detalhes ficam ABAIXO de todos os achados, e sem
                ele a conexão e a hora eram lidas como detalhe da linha de cima
                (visto na tela, em 19/09/2026). */}
            <p className="text-muted-foreground mb-1 text-xs font-medium">{t('heldHeading')}</p>
            <ul className="space-y-1">
              {integracoes.dados.retidas.itens.map((r) => (
                <li
                  key={`${r.canalId ?? 'sem-conexao'}-${r.recebidaEm}`}
                  className="min-w-0 truncate text-xs"
                >
                  <span className="text-foreground">
                    {channelLabel(channels, r.canalId) ?? '—'}
                  </span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {new Date(r.recebidaEm).toLocaleString(undefined, {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {r.daEquipe && ` · ${t('heldFromTeam')}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-1.5 text-xs">{t('heldHint')}</p>
          </div>
        )}

      {/* A falha parcial é dita SEMPRE, inclusive quando já há achados: o
          que apareceu não prova que o resto foi conferido. */}
      {resumo.achados.length > 0 && resumo.naoConferidas.length > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          {t('fixIncomplete', { count: resumo.naoConferidas.length })}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------
// Peças
// ------------------------------------------------------------

/**
 * De quem é este número.
 *
 * Pastilha discreta, não um parágrafo: ela aparece em mais de um bloco, e
 * uma frase repetida na tela vira ruído que o olho aprende a pular — que é
 * como o número perde a marca de novo.
 */
export function De({
  escopo,
  inline = false,
}: {
  escopo: 'seu' | 'escritorio';
  inline?: boolean;
}) {
  const t = useTranslations('MeuDia');
  const texto = escopo === 'seu' ? t('scopeYours') : t('scopeOffice');
  if (inline) return <span className="text-xs">{texto}</span>;
  return (
    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
      {texto}
    </span>
  );
}

/** O mesmo `EstadoDoBloco` dos blocos pessoais, com as chaves desta aba. */
export function EstadoDoBlocoDaAba({ bloco }: { bloco: Bloco<unknown> }) {
  const t = useTranslations('MeuDia');
  if (bloco.status === 'carregando') {
    return <p className="text-muted-foreground mt-2 text-sm">{t('loading')}</p>;
  }
  if (bloco.status === 'falhou') {
    return <p className="text-destructive mt-2 text-sm">{t('failed')}</p>;
  }
  return null;
}
