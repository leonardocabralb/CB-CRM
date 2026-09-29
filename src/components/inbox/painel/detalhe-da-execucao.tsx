'use client';

// ============================================================
// A EXPANSÃO de uma linha do "Já rodou" (aba Automações da conversa) — a
// mini-auditoria pedida pelo operador em 29/09/2026: o que disparou, o que
// rodou (na ordem), onde parou e por quê, e o que não chegou a rodar.
//
// O registro é lido SÓ quando a linha abre (`/api/cb/execucoes/detalhe`): o
// painel não paga nada a mais por ter a expansão.
//
// ⚠️ Efeito passivo: a resposta é carimbada com o id da execução (`de`) e
// comparada com a escolhida no render atual — trocar de execução no grupo
// ("2×") nunca mostra o registro da anterior. Falha de leitura vira aviso com
// "Tentar de novo", nunca uma lista vazia afirmando que nada rodou.
//
// Os textos do motor passam por DUAS trocas, na tela (nunca no motor): id →
// nome (`textoComNomes`, a régua da tela de registros) e inglês técnico →
// português (`lerTextoDoMotor`). O texto original fica no `title`.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  Circle,
  GitBranch,
  Minus,
  Pause,
  RefreshCw,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useCan } from '@/hooks/use-can';
import { textoComNomes, type TipoDoAlvo } from '@/lib/automations/registro-legivel';
import type { DesfechoDoHistorico, ItemDoHistorico, MotivoDaInterrupcao } from '@/lib/execucoes/desfecho';
import type { DetalheMontado, PassoDoDetalhe, PassoQueNaoRodou } from '@/lib/execucoes/detalhe';
import type { NomesDoTexto } from '@/lib/execucoes/nomes-dos-passos';
import { lerTextoDoMotor } from '@/lib/execucoes/texto-do-motor';
import { cn } from '@/lib/utils';

interface Resposta {
  execucao: {
    id: string;
    automationId: string;
    nome: string | null;
    gatilho: string | null;
    iniciadaEm: string;
    terminadaEm: string;
    desfecho: DesfechoDoHistorico;
    interrompidaPor: MotivoDaInterrupcao | null;
    erro: string | null;
  };
  detalhe: DetalheMontado;
  nomesDoTexto: NomesDoTexto;
}

type Estado = { de: string; dados: Resposta } | { de: string; erro: true };

/** "29/09 10:41" — o dia entra porque a execução com "Aguardar" dura dias. */
function diaEHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function hora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function mesmoDia(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

const ICONE_DO_PASSO: Record<PassoDoDetalhe['estado'], typeof Check> = {
  feito: Check,
  pulado: Minus,
  falhou: X,
  tentativa: RefreshCw,
};

const COR_DO_PASSO: Record<PassoDoDetalhe['estado'], string> = {
  feito: 'text-primary',
  pulado: 'text-muted-foreground',
  falhou: 'text-red-600 dark:text-red-400',
  tentativa: 'text-amber-600 dark:text-amber-400',
};

export function DetalheDaExecucao({ item }: { item: ItemDoHistorico }) {
  const t = useTranslations('Inbox.execucoes');
  const tAuto = useTranslations('Pipelines.automacoes');
  const tLogs = useTranslations('Automations.logs');
  const tGatilhos = useTranslations('Automations.builder.triggers');
  const tTipos = useTranslations('Automations.builder.steps');
  const podeVerRegistros = useCan('manage-automations');

  const [escolhida, setEscolhida] = useState(item.execucoes[0]?.id ?? '');
  // A lista do grupo muda com a recarga (execução nova no mesmo dia): a
  // escolha que saiu dela volta para a mais recente, no render.
  const id = item.execucoes.some((e) => e.id === escolhida) ? escolhida : (item.execucoes[0]?.id ?? '');
  const [estado, setEstado] = useState<Estado | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetch(`/api/cb/execucoes/detalhe?log=${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const dados = (await res.json()) as Resposta;
        if (!cancelado) setEstado({ de: id, dados });
      } catch {
        if (!cancelado) setEstado({ de: id, erro: true });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [id, tentativa]);

  const atual = estado?.de === id ? estado : null;

  const nomes = atual && 'dados' in atual ? atual.dados.nomesDoTexto : null;
  const carregados = new Set<TipoDoAlvo>(nomes?.carregados ?? []);
  const orfao = (tipo: TipoDoAlvo) => tLogs(`orfao.${tipo}` as Parameters<typeof tLogs>[0]);

  /** O texto do motor com nomes no lugar de ids, em português onde há tradução. */
  function textoDoMotor(bruto: string, tipo: string | null): string {
    const trocado = nomes ? textoComNomes(bruto, { porId: nomes.porId, carregados }, tipo, orfao) : bruto;
    return lerTextoDoMotor(trocado)
      .map((p) => ('chave' in p ? t(`motor.${p.chave}` as Parameters<typeof t>[0], p.valores) : p.texto))
      .join(' · ');
  }

  function rotulo(p: PassoDoDetalhe | PassoQueNaoRodou): string {
    if ('doMotor' in p && p.doMotor) return t('historico.doMotor');
    // Passo que saiu da automação: o rótulo do TIPO ("Enviar arquivo"), sem a
    // config que não existe mais — ver `removido` em `detalhe.ts`.
    if ('removido' in p && p.removido) {
      const chave = p.tipo as Parameters<typeof tTipos>[0];
      return tTipos.has(chave) ? tTipos(chave) : p.tipo;
    }
    return tAuto(`resumo.${p.chave}` as Parameters<typeof tAuto>[0], {
      ...p.valores,
      alvo: p.alvoSumiu ? tAuto('alvoSumiu') : (p.valores.alvo ?? ''),
    });
  }

  function gatilho(evento: string): string {
    if (evento === 'manual') return t('historico.gatilhoManual');
    if (evento === 'run_automation') return t('historico.gatilhoAcionada');
    const chave = `${evento}.label` as Parameters<typeof tGatilhos>[0];
    return t('historico.gatilho', { gatilho: tGatilhos.has(chave) ? tGatilhos(chave) : evento });
  }

  return (
    <div className="border-border mt-1.5 space-y-2 border-t pt-2">
      {item.execucoes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground text-[11px]">{t('historico.execucoesDoDia')}</span>
          {item.execucoes.map((e) => (
            <button
              key={e.id}
              type="button"
              aria-pressed={e.id === id}
              onClick={() => setEscolhida(e.id)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition-colors',
                e.id === id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {hora(e.quando)}
            </button>
          ))}
        </div>
      )}

      {!atual ? (
        <p className="text-muted-foreground/70 text-[11px]">{t('historico.carregando')}</p>
      ) : 'erro' in atual ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {t('historico.falhou')}{' '}
          <button
            type="button"
            onClick={() => {
              // Volta ao "carregando" na hora: o aviso de falha parado na tela
              // durante a nova leitura pareceria que o clique não fez nada.
              setEstado(null);
              setTentativa((n) => n + 1);
            }}
            className="text-foreground font-medium underline underline-offset-2"
          >
            {t('tentarDeNovo')}
          </button>
        </p>
      ) : (
        <CorpoDoDetalhe
          dados={atual.dados}
          t={t}
          rotulo={rotulo}
          textoDoMotor={textoDoMotor}
          gatilho={gatilho}
          podeVerRegistros={podeVerRegistros}
        />
      )}
    </div>
  );
}

function CorpoDoDetalhe({
  dados,
  t,
  rotulo,
  textoDoMotor,
  gatilho,
  podeVerRegistros,
}: {
  dados: Resposta;
  t: ReturnType<typeof useTranslations>;
  rotulo: (p: PassoDoDetalhe | PassoQueNaoRodou) => string;
  textoDoMotor: (bruto: string, tipo: string | null) => string;
  gatilho: (evento: string) => string;
  podeVerRegistros: boolean;
}) {
  const { execucao, detalhe } = dados;
  const interrompida = execucao.desfecho === 'interrompida';
  // O motivo da falha já aparece no passo que parou; fora dele (falha ao
  // acordar sem passo, ou ao nascer) ele vai no topo — nunca some.
  const erroSolto =
    execucao.desfecho === 'falhou' && execucao.erro && !detalhe.passos.some((p) => p.parou) ? execucao.erro : null;

  return (
    <>
      <div className="text-muted-foreground space-y-0.5 text-[11px]">
        {execucao.gatilho && <p>{gatilho(execucao.gatilho)}</p>}
        <p>
          {t(interrompida ? 'historico.periodoInterrompida' : 'historico.periodo', {
            inicio: diaEHora(execucao.iniciadaEm),
            fim: mesmoDia(execucao.iniciadaEm, execucao.terminadaEm)
              ? hora(execucao.terminadaEm)
              : diaEHora(execucao.terminadaEm),
          })}
        </p>
      </div>

      {erroSolto && (
        <p className="flex items-start gap-1.5 text-[11px] text-red-700 dark:text-red-300" title={erroSolto}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 break-words">{t('historico.motivo', { motivo: textoDoMotor(erroSolto, null) })}</span>
        </p>
      )}

      {detalhe.passos.length === 0 ? (
        <p className="text-muted-foreground/70 text-[11px]">{t('historico.semPassos')}</p>
      ) : (
        <ol className="space-y-1">
          {detalhe.passos.map((p) => {
            const Icone = ICONE_DO_PASSO[p.estado];
            const texto = p.detalhe ? textoDoMotor(p.detalhe, p.tipo) : '';
            return (
              <li key={p.id} className="flex items-start gap-2">
                <Icone className={cn('mt-0.5 h-3 w-3 shrink-0', COR_DO_PASSO[p.estado])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-xs break-words">
                    {rotulo(p)}
                    {p.removido && (
                      <span className="text-muted-foreground/70"> · {t('historico.removido')}</span>
                    )}
                    {p.parou && (
                      <span className="font-medium text-red-700 dark:text-red-300"> · {t('historico.parouAqui')}</span>
                    )}
                  </p>
                  {texto && (
                    <p
                      className={cn(
                        'text-[11px] break-words',
                        p.estado === 'falhou' ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground',
                      )}
                      title={p.detalhe}
                    >
                      {texto}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {interrompida && (
        <p className="text-foreground flex items-start gap-2 text-xs font-medium">
          <Pause className="text-muted-foreground mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {t(`historico.interrompida.${execucao.interrompidaPor ?? 'desconhecido'}` as Parameters<typeof t>[0])}
        </p>
      )}

      {detalhe.naoRodaramDesconhecido ? (
        <p className="text-muted-foreground/80 text-[11px]">{t('historico.naoRodaramDesconhecido')}</p>
      ) : detalhe.naoRodaram && detalhe.naoRodaram.length === 0 ? (
        <p className="text-muted-foreground/80 text-[11px]">{t('historico.nadaFicou')}</p>
      ) : detalhe.naoRodaram ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-[11px] font-medium">{t('historico.naoRodaram')}</p>
          <ol className="space-y-1">
            {detalhe.naoRodaram.map((p) => {
              const Icone = p.estado === 'condicional' ? GitBranch : Circle;
              return (
                <li key={p.id} className="flex items-start gap-2">
                  <Icone className="text-muted-foreground/60 mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <p className="text-muted-foreground text-xs break-words">
                    {rotulo(p)}
                    {p.estado === 'condicional' && (
                      <span className="text-muted-foreground/70"> · {t('dependeDaCondicao')}</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {podeVerRegistros && (
        <Link
          href={`/automations/${execucao.automationId}/logs`}
          className="text-muted-foreground hover:text-foreground inline-block text-[11px] underline underline-offset-2"
        >
          {t('historico.verRegistros')}
        </Link>
      )}
    </>
  );
}
