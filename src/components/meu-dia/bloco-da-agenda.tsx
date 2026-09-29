'use client';

// ============================================================
// A agenda e as reuniões de HOJE e AMANHÃ (v2, pedido do operador em
// 29/09/2026: "um pouco maior, vinculada àquele cliente").
//
// A fonte é a pauta de `/reunioes` (`usePautaDeReunioes`, rota
// `/api/cb/reunioes`): Calendly E agenda do CRM, com o cancelamento casado e
// o convite substituído por reagendamento inferido. Até a v1 o bloco lia só
// `cb_meetings` — vazia (medido em 29/09/2026) — porque listar o Calendly
// cru mostraria reunião cancelada e as duas pontas de um reagendamento; a
// pauta resolveu isso, e é a mesma lista que a tela de Reuniões mostra.
//
// ⚠️ Reuniões do ESCRITÓRIO (o Calendly não diz de qual advogado), recortadas
// pelo FUNIL do perfil, como a pauta (`funilNoEscopo`): sem card, aparece.
// ⚠️ Hora e dia no fuso da AGENDA (`FUSO_PADRAO`), o mesmo da pauta — no do
// navegador, a reunião das 23h viraria "amanhã" para quem estivesse em UTC.
// ⚠️ O nome leva à CONVERSA do cliente (senão à ficha), sem o `de=reunioes`:
// a faixa "Voltar às reuniões" mentiria para quem veio do Meu dia.
// ============================================================

import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, ExternalLink } from 'lucide-react';

import { diaNoFuso, FUSO_PADRAO } from '@/lib/agenda/fuso';
import { urlDoInbox } from '@/lib/inbox/url';
import { funilNoEscopo } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import {
  linkDeReuniao,
  type ReuniaoDaPauta,
  type Resultado,
} from '@/lib/reunioes/pauta';
import { somarDias } from '@/lib/tasks/prazo';
import { cn } from '@/lib/utils';

import { De, EstadoDoBlocoDaAba } from './blocos-de-operacao';
import { Cabecalho, LinkDoBloco } from './blocos-pessoais';

export interface PautaDoDia {
  reunioes: ReuniaoDaPauta[] | null;
  carregando: boolean;
  falhou: boolean;
}

export function BlocoDaAgenda({
  pauta,
  agoraMs,
  acesso,
  veInbox,
  veContatos,
  veAgenda,
}: {
  pauta: PautaDoDia;
  /** O instante do pedido — o relógio desta tela. */
  agoraMs: number;
  /** A LENTE do "Ver como": o recorte por funil. */
  acesso: ContextoDeAcesso;
  veInbox: boolean;
  veContatos: boolean;
  veAgenda: boolean;
}) {
  const t = useTranslations('MeuDia');

  const dias = useMemo(() => {
    if (!pauta.reunioes) return null;
    const hoje = diaNoFuso(new Date(agoraMs), FUSO_PADRAO);
    const amanha = somarDias(hoje, 1);
    const doPerfil = pauta.reunioes
      .filter((r) => !r.negocio || funilNoEscopo(acesso, r.negocio.pipelineId))
      .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
    const noDia = (dia: string) =>
      doPerfil.filter((r) => diaNoFuso(new Date(r.inicio), FUSO_PADRAO) === dia);
    return { hoje: noDia(hoje), amanha: noDia(amanha) };
  }, [pauta.reunioes, agoraMs, acesso]);

  // ⚠️ "Não sei" nunca vira "nenhuma reunião": a falha da recarga que
  // mantém a pauta anterior continua mostrando a pauta (o hook guarda).
  const estado =
    dias !== null
      ? null
      : pauta.carregando
        ? ({ status: 'carregando' } as const)
        : ({ status: 'falhou' } as const);

  return (
    <section className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={<CalendarClock className="size-4" aria-hidden />}
        titulo={t('agendaTitle')}
        direita={<De escopo="escritorio" />}
      />
      {estado ? (
        <EstadoDoBlocoDaAba bloco={estado} />
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Dia
            titulo={t('agendaToday')}
            reunioes={dias!.hoje}
            agoraMs={agoraMs}
            veInbox={veInbox}
            veContatos={veContatos}
          />
          <Dia
            titulo={t('agendaTomorrow')}
            reunioes={dias!.amanha}
            agoraMs={agoraMs}
            veInbox={veInbox}
            veContatos={veContatos}
          />
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4">
        <LinkDoBloco href="/reunioes" texto={t('agendaOpenMeetings')} onContinuar={NADA} />
        {veAgenda && (
          <LinkDoBloco href="/agenda" texto={t('openAgenda')} onContinuar={NADA} />
        )}
      </div>
    </section>
  );
}

function Dia({
  titulo,
  reunioes,
  agoraMs,
  veInbox,
  veContatos,
}: {
  titulo: string;
  reunioes: ReuniaoDaPauta[];
  agoraMs: number;
  veInbox: boolean;
  veContatos: boolean;
}) {
  const t = useTranslations('MeuDia');
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs font-medium">
        {titulo} · {reunioes.length}
      </p>
      {reunioes.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-sm">{t('agendaNoneThatDay')}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {reunioes.map((r) => (
            <LinhaDaReuniao
              key={r.chave}
              reuniao={r}
              agoraMs={agoraMs}
              veInbox={veInbox}
              veContatos={veContatos}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaDaReuniao({
  reuniao: r,
  agoraMs,
  veInbox,
  veContatos,
}: {
  reuniao: ReuniaoDaPauta;
  agoraMs: number;
  veInbox: boolean;
  veContatos: boolean;
}) {
  const tReunioes = useTranslations('Reunioes');
  const tResumo = useTranslations('ResumoDoDia');

  const hora = new Date(r.inicio).toLocaleTimeString(undefined, {
    timeZone: FUSO_PADRAO,
    hour: '2-digit',
    minute: '2-digit',
  });
  // A rota já resolveu o nome (senão o telefone, senão o @); nulo = sem nome.
  const nome = r.contato?.nome?.trim() || tResumo('unknownContact');
  const href = r.conversaId
    ? veInbox
      ? urlDoInbox({ c: r.conversaId })
      : null
    : r.contato && veContatos
      ? `/contacts?contact=${encodeURIComponent(r.contato.id)}`
      : null;
  // "Entrar" só até o FIM da reunião (sem fim, até 1 h depois do início):
  // link de reunião que já acabou é convite para a sala vazia.
  const fimMs = r.fim ? Date.parse(r.fim) : Date.parse(r.inicio) + 60 * 60_000;
  // Só http(s): o `local` da agenda do CRM também vira `link` na pauta.
  const link = agoraMs < fimMs ? linkDeReuniao(r.link) : null;

  return (
    <li className="flex items-start gap-3 rounded-md p-1 text-sm">
      <span className="text-foreground w-11 shrink-0 font-medium tabular-nums">
        {hora}
      </span>
      <span className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="text-foreground block truncate font-medium hover:underline">
            {nome}
          </Link>
        ) : (
          <span className="text-foreground block truncate font-medium">{nome}</span>
        )}
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          {r.evento && <span className="truncate">{r.evento}</span>}
          {r.negocio?.etapaNome && (
            <span className="truncate">· {r.negocio.etapaNome}</span>
          )}
          {r.reagendamento && (
            <span className="bg-muted rounded px-1 py-px text-[11px]">
              {tReunioes('reagendamento')}
            </span>
          )}
          {r.resultado && (
            <span
              className={cn(
                'rounded px-1 py-px text-[11px]',
                r.resultado.tipo === 'no_show'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              )}
            >
              {rotuloDoResultado(r.resultado.tipo, tReunioes)}
            </span>
          )}
        </span>
      </span>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex shrink-0 items-center gap-1 text-xs hover:underline"
        >
          {tReunioes('entrar')}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </li>
  );
}

/** Três chamadas LITERAIS: o portão de i18n só enxerga chave literal. */
function rotuloDoResultado(
  tipo: Resultado,
  t: ReturnType<typeof useTranslations<'Reunioes'>>
): string {
  if (tipo === 'proposta') return t('resultadoProposta');
  if (tipo === 'sem_proposta') return t('resultadoSemProposta');
  return t('resultadoNoShow');
}

/** A aba não tem porta acima dela: navegar daqui não confirma nada. */
const NADA = () => {};
