'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, MessageSquare, Rocket } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { ValorInput } from '@/components/valor/valor-input';
import { horaNoFuso, FUSO_PADRAO } from '@/lib/agenda/fuso';
import { formatCurrency } from '@/lib/currency';
import {
  comoMarcar,
  faseDaReuniao,
  type Acao,
  type MotivoDeSoRegistrar,
  type AlvosDoFunil,
  type ReuniaoDaPauta,
  type Resultado,
} from '@/lib/reunioes/pauta';
import { cn } from '@/lib/utils';

/** Uma marcação esperando os segundos do "Desfazer". */
export interface MarcacaoPendente {
  acao: Acao;
  /** Para onde o card vai; nulo = só registra. */
  alvoNome: string | null;
  valor: number | null;
  restanteS: number;
}

const ROTULO_DO_RESULTADO: Record<Resultado, 'resultadoProposta' | 'resultadoSemProposta' | 'resultadoNoShow'> = {
  proposta: 'resultadoProposta',
  sem_proposta: 'resultadoSemProposta',
  no_show: 'resultadoNoShow',
};

const TEXTO_DO_MOTIVO: Record<MotivoDeSoRegistrar, 'motivoSemCard' | 'motivoCardFechado' | 'motivoReuniaoPosterior' | 'motivoSemEtapa'> = {
  sem_card: 'motivoSemCard',
  card_fechado: 'motivoCardFechado',
  reuniao_posterior: 'motivoReuniaoPosterior',
  sem_etapa: 'motivoSemEtapa',
};

function hora(iso: string): string {
  return horaNoFuso(new Date(iso), FUSO_PADRAO);
}

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', timeZone: FUSO_PADRAO });
}

/** Link de reunião que dá para abrir: só http(s). O `local` da agenda pode ser um endereço. */
function linkDeReuniao(link: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function LinhaDaReuniao({
  reuniao: r,
  alvos,
  agora,
  podeMarcar,
  pendente,
  ocupada,
  mostrarDia,
  aoMarcar,
  aoDesfazer,
  aoAbrirConversa,
}: {
  reuniao: ReuniaoDaPauta;
  alvos: AlvosDoFunil | null;
  agora: Date;
  /** Papel que move card (agent ou acima). Observador vê, não marca. */
  podeMarcar: boolean;
  pendente: MarcacaoPendente | null;
  /** A marcação desta reunião está sendo gravada agora. */
  ocupada: boolean;
  /** Mostrar a data junto da hora (lista de pendentes de outros dias). */
  mostrarDia: boolean;
  aoMarcar: (acao: Acao, valor: number | null) => void;
  aoDesfazer: () => void;
  aoAbrirConversa: () => void;
}) {
  const t = useTranslations('Reunioes');
  const [pedindoValor, setPedindoValor] = useState(false);
  const [valor, setValor] = useState(0);
  const [erroDoValor, setErroDoValor] = useState(false);
  // Resultado já registrado, reaberto para corrigir (marca de novo: o upsert
  // troca a linha do mesmo marco, e o card anda se puder).
  const [corrigindo, setCorrigindo] = useState(false);

  const fase = faseDaReuniao(r, agora);
  const link = linkDeReuniao(r.link);
  const { divida, atraso, origem } = r.qualificacao;

  /** O que o botão faz, dito na dica: leva o card para X, ou só registra (e por quê). */
  const dica = (acao: Acao): string => {
    const plano = comoMarcar(r, acao, alvos);
    return plano.alvo
      ? t('levaPara', { etapa: plano.alvo.nome })
      : t(TEXTO_DO_MOTIVO[plano.motivo], { data: r.proximaEm ? dataCurta(r.proximaEm) : '', hora: r.proximaEm ? hora(r.proximaEm) : '' });
  };

  const botao = (acao: Acao, rotulo: string, onClick?: () => void, destaque = false) => (
    <Button
      key={acao}
      size="sm"
      variant={destaque ? 'default' : 'outline'}
      disabled={ocupada}
      title={dica(acao)}
      onClick={
        onClick ??
        (() => {
          setCorrigindo(false);
          aoMarcar(acao, null);
        })
      }
    >
      {rotulo}
    </Button>
  );

  const confirmarProposta = () => {
    if (!(valor > 0)) {
      setErroDoValor(true);
      return;
    }
    setPedindoValor(false);
    setCorrigindo(false);
    aoMarcar('proposta', valor);
  };

  // Quando o resultado só REGISTRA (sem mover o card), a linha diz por quê —
  // a dica do botão não aparece no toque.
  const avisoDoResultado = (() => {
    const plano = comoMarcar(r, 'no_show', alvos);
    return plano.alvo ? null : t(TEXTO_DO_MOTIVO[plano.motivo], { data: r.proximaEm ? dataCurta(r.proximaEm) : '', hora: r.proximaEm ? hora(r.proximaEm) : '' });
  })();

  const botoesDoResultado = (
    <div className="flex flex-wrap items-center gap-2">
      {!corrigindo && (
        <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t('registreOResultado')}
        </span>
      )}
      {podeMarcar && (
        <>
          {botao('proposta', t('botaoProposta'), () => {
            setValor(r.resultado?.valor ?? r.negocio?.valor ?? 0);
            setPedindoValor(true);
          })}
          {botao('sem_proposta', t('botaoSemProposta'))}
          {botao('no_show', t('botaoNoShow'))}
          {corrigindo && (
            <Button size="sm" variant="ghost" onClick={() => setCorrigindo(false)}>
              {t('cancelar')}
            </Button>
          )}
        </>
      )}
      {podeMarcar && avisoDoResultado && <span className="w-full text-[11px] text-muted-foreground">{avisoDoResultado}</span>}
    </div>
  );

  let acoes: ReactNode = null;
  if (ocupada) {
    acoes = (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('gravando')}
      </span>
    );
  } else if (pendente) {
    acoes = (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {pendente.alvoNome === null
          ? t('registrando', { s: pendente.restanteS })
          : pendente.valor !== null
            ? t('movendoComValor', { etapa: pendente.alvoNome, valor: formatCurrency(pendente.valor), s: pendente.restanteS })
            : t('movendo', { etapa: pendente.alvoNome, s: pendente.restanteS })}
        <button type="button" className="font-medium underline underline-offset-2" onClick={aoDesfazer}>
          {t('desfazer')}
        </button>
      </span>
    );
  } else if (pedindoValor) {
    acoes = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('valorDaProposta')}</span>
        <ValorInput
          valor={valor}
          aoMudar={(v) => {
            setValor(v);
            if (erroDoValor) setErroDoValor(false);
          }}
          placeholder="R$ 0,00"
          aria-label={t('valorDaProposta')}
          className="h-7 w-36 text-sm"
        />
        <Button size="sm" onClick={confirmarProposta}>
          {t('confirmar')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setPedindoValor(false);
            setErroDoValor(false);
          }}
        >
          {t('cancelar')}
        </Button>
        {erroDoValor && <span className="text-xs text-red-700 dark:text-red-300">{t('valorObrigatorio')}</span>}
      </div>
    );
  } else if (fase === 'com_resultado' && r.resultado && !corrigindo) {
    const res = r.resultado;
    const oQue =
      res.tipo === 'proposta' && res.valor !== null
        ? t('resultadoPropostaComValor', { valor: formatCurrency(res.valor) })
        : t(ROTULO_DO_RESULTADO[res.tipo]);
    acoes = (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-700 dark:text-green-300" />
        {res.fonte === 'tela'
          ? t('resultadoRegistrado', { oQue, por: res.por ?? t('alguem'), hora: hora(res.em) })
          : t('resultadoPeloFunil', { oQue, etapa: res.etapa ?? '—', por: res.por ?? t('sistema') })}
        {podeMarcar && (
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2"
            onClick={() => setCorrigindo(true)}
          >
            {t('corrigir')}
          </button>
        )}
      </span>
    );
  } else if (fase === 'antes') {
    const planoDaQualificacao = comoMarcar(r, 'qualificada', alvos);
    acoes = (
      <div className="flex flex-wrap items-center gap-2">
        {r.qualificada ? (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('qualificadaPor', { por: r.qualificada.por ?? t('alguem') })}
          </span>
        ) : podeMarcar ? (
          botao('qualificada', t('botaoQualificada'), undefined, true)
        ) : null}
        <span className="text-xs text-muted-foreground">{t('resultadoAbreAs', { hora: hora(r.inicio) })}</span>
        {podeMarcar && !r.qualificada && !planoDaQualificacao.alvo && (
          <span className="w-full text-[11px] text-muted-foreground">
            {t(TEXTO_DO_MOTIVO[planoDaQualificacao.motivo], { data: '', hora: '' })}
          </span>
        )}
      </div>
    );
  } else {
    acoes = botoesDoResultado;
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-card px-3 py-2.5',
        fase === 'sem_resultado' && !pendente ? 'border-amber-500/50' : 'border-border',
      )}
    >
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3">
        <div className="pt-0.5">
          <div className="text-sm font-medium tabular-nums">{hora(r.inicio)}</div>
          {mostrarDia && <div className="text-[11px] text-muted-foreground">{dataCurta(r.inicio)}</div>}
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium">{r.contato?.nome ?? t('semContato')}</span>
            {r.reagendamento && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t('reagendamento')}</span>
            )}
            {r.qualificada && fase !== 'antes' && !r.resultado && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{t('qualificada')}</span>
            )}
            {r.negocio && (
              <span
                className="ml-auto max-w-full truncate rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                title={r.negocio.pipelineNome ?? undefined}
              >
                {r.negocio.etapaNome ?? '—'}
                {r.negocio.status === 'won' ? ` · ${t('ganho')}` : r.negocio.status === 'lost' ? ` · ${t('perdido')}` : ''}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {divida || atraso || origem ? (
              <>
                <span>
                  {t('divida')}: <span className="text-foreground">{divida ?? t('naoInformado')}</span>
                </span>
                <span>
                  {t('atraso')}: <span className="text-foreground">{atraso ?? t('naoInformado')}</span>
                </span>
                {origem && (
                  <span>
                    {t('origem')}: <span className="text-foreground">{origem}</span>
                  </span>
                )}
              </>
            ) : (
              <span>{t('semQualificacaoNaFicha')}</span>
            )}
          </div>

          {(r.faltouAntes || r.aguardandoDesde) && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-amber-700 dark:text-amber-300">
              {r.faltouAntes && (
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {t('jaFaltou', { etapa: r.faltouAntes.etapa ?? '—', data: dataCurta(r.faltouAntes.em) })}
                </span>
              )}
              {r.aguardandoDesde && (
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {t('aguardandoResposta', { hora: hora(r.aguardandoDesde), data: dataCurta(r.aguardandoDesde) })}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="min-w-0">{acoes}</div>
            <div className="flex shrink-0 items-center gap-1">
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('entrarNaReuniao')}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  <Rocket className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('entrar')}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {r.conversaId && (
                <Button size="sm" variant="ghost" onClick={aoAbrirConversa}>
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t('abrirConversa')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
