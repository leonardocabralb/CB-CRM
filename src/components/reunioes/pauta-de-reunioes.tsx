'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';

import { LinhaDaReuniao, type MarcacaoPendente } from '@/components/reunioes/linha-da-reuniao';
import { Button } from '@/components/ui/button';
import { useAoVoltarParaOApp } from '@/hooks/use-ao-voltar-para-o-app';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { usePautaDeReunioes } from '@/hooks/use-pauta-de-reunioes';
import { diaNoFuso, FUSO_PADRAO, paraInstante } from '@/lib/agenda/fuso';
import { gradeDaSemana, somarDias } from '@/lib/agenda/grade';
import { urlDoInbox } from '@/lib/inbox/url';
import { funilNoEscopo } from '@/lib/perfis/escopo';
import { executarAcao } from '@/lib/reunioes/executar';
import { faseDaReuniao, pendentes as reunioesPendentes, type Acao, type ReuniaoDaPauta } from '@/lib/reunioes/pauta';
import { guardarRetornoDaPauta } from '@/lib/reunioes/retorno';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/** Os segundos do "Desfazer" antes de o card ser movido. */
const ESPERA_DO_DESFAZER_S = 5;
/** Recuo da rede de segurança na leitura (a lista de pendentes olha 30 dias). */
const DIAS_DA_REDE = 30;

type Filtro = 'todas' | 'sem_resultado' | 'nao_qualificadas';

interface Pendente {
  acao: Acao;
  alvoId: string;
  alvoNome: string;
  valor: number | null;
  ateMs: number;
}

const DIA_VALIDO = /^\d{4}-\d{2}-\d{2}$/;

function diaDoParametro(v: string | null): string | null {
  if (!v || !DIA_VALIDO.test(v)) return null;
  return Number.isNaN(Date.parse(`${v}T12:00:00Z`)) ? null : v;
}

function rotuloDoDia(dia: string): { semana: string; data: string } {
  const meioDia = new Date(`${dia}T12:00:00Z`);
  return {
    semana: meioDia.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }).replace('.', ''),
    data: meioDia.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }),
  };
}

/**
 * A pauta de reuniões (`/reunioes`). Plano: `docs/PLANO-pauta-de-reunioes.md`.
 *
 * A semana à vista em cima (dias com contagem e pendências), a REDE DE
 * SEGURANÇA (reuniões de outros dias que já começaram e estão sem resultado)
 * e a lista do dia escolhido, com os botões:
 * - antes da reunião: "Reunião qualificada";
 * - depois que ela começa: com proposta (pede o valor), sem proposta, no show.
 *
 * ⚠️ Cada botão espera `ESPERA_DO_DESFAZER_S` segundos com "Desfazer" antes de
 * mover o card: mover dispara as automações da etapa e o aviso à TinTim na
 * hora, e isso não tem volta. Sair da tela no meio NÃO cancela — a marcação é
 * gravada na hora (quem clica e abre a conversa em seguida não perde nada).
 *
 * ⚠️ O recorte por funil usa a LENTE (`acesso`), como o Meu dia: é tela de
 * dentro do app, e o "Ver como" tem de mostrar o que o perfil vê.
 */
export function PautaDeReunioes() {
  const t = useTranslations('Reunioes');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId, acesso } = useAuth();
  const podeMarcar = useCan('send-messages');
  const supabase = useMemo(() => createClient(), []);

  // O relógio da tela: abre os botões de resultado na hora e conta o
  // "Desfazer". A cada segundo só enquanto há marcação pendente; senão a cada
  // 30 s (o resultado abre no minuto do início).
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  const [pendentesLocais, setPendentesLocais] = useState<Record<string, Pendente>>({});
  const haPendenteLocal = Object.keys(pendentesLocais).length > 0;
  useEffect(() => {
    // O primeiro tique sai já (fora do corpo do efeito): sem ele, a contagem do
    // "Desfazer" partiria de um relógio de até 30 s atrás.
    const ja = setTimeout(() => setAgoraMs(Date.now()), 0);
    const id = setInterval(() => setAgoraMs(Date.now()), haPendenteLocal ? 1000 : 30_000);
    return () => {
      clearTimeout(ja);
      clearInterval(id);
    };
  }, [haPendenteLocal]);
  const agora = useMemo(() => new Date(agoraMs), [agoraMs]);

  const hoje = diaNoFuso(agora, FUSO_PADRAO);
  const [dia, setDia] = useState<string>(() => diaDoParametro(searchParams.get('dia')) ?? hoje);
  const [filtro, setFiltro] = useState<Filtro>('todas');

  const semana = useMemo(() => gradeDaSemana(dia, hoje), [dia, hoje]);
  // A janela da leitura: a semana à vista E os 30 dias da rede de segurança
  // (até o fim de hoje). Derivada de DIAS, nunca do relógio corrido — senão
  // a chave mudaria a cada tique e a tela releria sem parar.
  const janela = useMemo(() => {
    const inicioDaSemana = semana[0].dia;
    const fimDaSemana = semana[6].dia;
    const pisoDaRede = somarDias(hoje, -DIAS_DA_REDE);
    const primeiro = pisoDaRede < inicioDaSemana ? pisoDaRede : inicioDaSemana;
    const ultimo = hoje > fimDaSemana ? hoje : fimDaSemana;
    return {
      de: paraInstante(primeiro, '00:00', FUSO_PADRAO).toISOString(),
      ate: paraInstante(ultimo, '23:59', FUSO_PADRAO).toISOString(),
    };
  }, [semana, hoje]);

  const { pauta, carregando, falhou, recarregar } = usePautaDeReunioes(janela);
  useAoVoltarParaOApp(recarregar);

  const irParaDia = useCallback(
    (novo: string) => {
      setDia(novo);
      router.replace(`/reunioes?dia=${novo}`, { scroll: false });
    },
    [router],
  );

  // O recorte do perfil: reunião cujo card está num funil fora do escopo não
  // aparece. Sem card, aparece (não há funil para recortar).
  const visiveis = useMemo(
    () => (pauta?.reunioes ?? []).filter((r) => !r.negocio || funilNoEscopo(acesso, r.negocio.pipelineId)),
    [pauta, acesso],
  );
  const doDia = (d: string) => visiveis.filter((r) => diaNoFuso(new Date(r.inicio), FUSO_PADRAO) === d);
  const semResultado = reunioesPendentes(visiveis, agora);
  const deOutrosDias = semResultado.filter((r) => diaNoFuso(new Date(r.inicio), FUSO_PADRAO) !== dia);

  let lista = doDia(dia);
  if (filtro === 'sem_resultado') lista = lista.filter((r) => faseDaReuniao(r, agora) === 'sem_resultado');
  if (filtro === 'nao_qualificadas') {
    lista = lista.filter((r) => faseDaReuniao(r, agora) === 'antes' && !r.qualificada);
  }

  // ------------------------------------------------------------------
  // As marcações: pendentes com "Desfazer", depois gravadas.
  // ------------------------------------------------------------------
  const [ocupadas, setOcupadas] = useState<Set<string>>(() => new Set());
  const reunioesPorChave = useMemo(() => new Map(visiveis.map((r) => [r.chave, r])), [visiveis]);
  // A foto que a gravação usa: a reunião COMO ESTAVA quando o botão foi
  // clicado (a cerca da etapa compara com o que a pessoa viu).
  const fotoRef = useRef(new Map<string, ReuniaoDaPauta>());
  const pendentesRef = useRef(pendentesLocais);
  useEffect(() => {
    pendentesRef.current = pendentesLocais;
  });

  const gravar = useCallback(
    async (chave: string, p: Pendente) => {
      const r = fotoRef.current.get(chave);
      fotoRef.current.delete(chave);
      if (!r || !accountId) return;
      setOcupadas((s) => new Set(s).add(chave));
      const desfecho = await executarAcao({
        supabase,
        accountId,
        reuniao: r,
        acao: p.acao,
        alvo: { id: p.alvoId, nome: p.alvoNome },
        valor: p.valor,
      });
      setOcupadas((s) => {
        const n = new Set(s);
        n.delete(chave);
        return n;
      });
      const nome = r.contato?.nome ?? t('semContato');
      if (desfecho === 'ok') toast.success(t('toastMovido', { nome, etapa: p.alvoNome }));
      else if (desfecho === 'card_mudou') toast.warning(t('toastCardMudou', { nome }));
      else if (desfecho === 'registro_falhou') toast.warning(t('toastRegistroFalhou', { nome }));
      else toast.error(t('toastFalhou', { nome }));
      recarregar();
    },
    [accountId, supabase, recarregar, t],
  );

  // O prazo do "Desfazer" venceu: grava. Cada marcação é disparada UMA vez
  // (`disparadasRef`, pela chave e pelo prazo): o efeito roda de novo a cada
  // tique e, no modo estrito do React, duas vezes por montagem — contar com o
  // estado já atualizado gravaria duas vezes.
  const disparadasRef = useRef(new Set<string>());
  useEffect(() => {
    const vencidas = Object.entries(pendentesLocais).filter(
      ([chave, p]) => p.ateMs <= agoraMs && !disparadasRef.current.has(`${chave}@${p.ateMs}`),
    );
    if (vencidas.length === 0) return;
    for (const [chave, p] of vencidas) disparadasRef.current.add(`${chave}@${p.ateMs}`);
    queueMicrotask(() => {
      setPendentesLocais((antes) => {
        const n = { ...antes };
        for (const [chave, p] of vencidas) if (n[chave]?.ateMs === p.ateMs) delete n[chave];
        return n;
      });
      for (const [chave, p] of vencidas) void gravar(chave, p);
    });
  }, [agoraMs, pendentesLocais, gravar]);

  // Sair da tela com marcação no prazo do "Desfazer" GRAVA na hora: quem
  // clica "No show" e abre a conversa em seguida conta com o card movido.
  const gravarRef = useRef(gravar);
  useEffect(() => {
    gravarRef.current = gravar;
  });
  useEffect(() => {
    const disparadas = disparadasRef.current;
    return () => {
      for (const [chave, p] of Object.entries(pendentesRef.current)) {
        if (disparadas.has(`${chave}@${p.ateMs}`)) continue;
        disparadas.add(`${chave}@${p.ateMs}`);
        void gravarRef.current(chave, p);
      }
    };
  }, []);

  const marcar = (r: ReuniaoDaPauta, acao: Acao, valor: number | null) => {
    const alvo = r.negocio ? pauta?.funis[r.negocio.pipelineId]?.[acao] : null;
    if (!alvo) return;
    fotoRef.current.set(r.chave, r);
    setPendentesLocais((antes) => ({
      ...antes,
      [r.chave]: { acao, alvoId: alvo.id, alvoNome: alvo.nome, valor, ateMs: Date.now() + ESPERA_DO_DESFAZER_S * 1000 },
    }));
  };

  const desfazer = (chave: string) => {
    fotoRef.current.delete(chave);
    setPendentesLocais((antes) => {
      const n = { ...antes };
      delete n[chave];
      return n;
    });
  };

  const abrirConversa = (r: ReuniaoDaPauta) => {
    if (!r.conversaId) return;
    guardarRetornoDaPauta(`/reunioes?dia=${dia}`);
    router.push(urlDoInbox({ c: r.conversaId, de: 'reunioes' }));
  };

  const pendenteDaLinha = (chave: string): MarcacaoPendente | null => {
    const p = pendentesLocais[chave];
    if (!p) return null;
    return {
      acao: p.acao,
      alvoNome: p.alvoNome,
      valor: p.valor,
      restanteS: Math.max(1, Math.ceil((p.ateMs - agoraMs) / 1000)),
    };
  };

  const linha = (r: ReuniaoDaPauta, mostrarDia: boolean) => (
    <LinhaDaReuniao
      key={r.chave}
      reuniao={r}
      alvos={r.negocio ? (pauta?.funis[r.negocio.pipelineId] ?? null) : null}
      agora={agora}
      podeMarcar={podeMarcar}
      pendente={pendenteDaLinha(r.chave)}
      ocupada={ocupadas.has(r.chave)}
      mostrarDia={mostrarDia}
      aoMarcar={(acao, valor) => {
        const atual = reunioesPorChave.get(r.chave) ?? r;
        marcar(atual, acao, valor);
      }}
      aoDesfazer={() => desfazer(r.chave)}
      aoAbrirConversa={() => abrirConversa(r)}
    />
  );

  const rotuloDaSemana = `${rotuloDoDia(semana[0].dia).data} – ${rotuloDoDia(semana[6].dia).data}`;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t('titulo')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitulo')}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" aria-label={t('semanaAnterior')} onClick={() => irParaDia(somarDias(dia, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[7.5rem] text-center text-sm tabular-nums">{rotuloDaSemana}</span>
          <Button size="icon-sm" variant="outline" aria-label={t('semanaSeguinte')} onClick={() => irParaDia(somarDias(dia, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => irParaDia(hoje)} disabled={dia === hoje}>
            {t('hoje')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {semana.map(({ dia: d, ehHoje }) => {
          const r = rotuloDoDia(d);
          const doD = pauta ? doDia(d) : [];
          const semRes = doD.filter((x) => faseDaReuniao(x, agora) === 'sem_resultado').length;
          return (
            <button
              key={d}
              type="button"
              onClick={() => irParaDia(d)}
              className={cn(
                'min-w-0 rounded-lg border px-1 py-1.5 text-center transition-colors',
                d === dia ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
              )}
            >
              <div className={cn('text-[11px] capitalize', ehHoje ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                {r.semana}
              </div>
              <div className="text-sm font-medium tabular-nums">{r.data}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {!pauta ? '·' : doD.length ? t('nReunioes', { n: doD.length }) : '—'}
              </div>
              {semRes > 0 && (
                <div className="truncate text-[11px] text-amber-700 dark:text-amber-300">{t('nSemResultado', { n: semRes })}</div>
              )}
            </button>
          );
        })}
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('carregando')}
        </div>
      ) : !pauta ? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
          {t('falhou')}
          <Button size="sm" variant="outline" onClick={recarregar}>
            {t('tentarDeNovo')}
          </Button>
        </div>
      ) : (
        <>
          {falhou && <p className="text-xs text-amber-700 dark:text-amber-300">{t('recargaFalhou')}</p>}

          {semResultado.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                {t('redeAcesa', { n: semResultado.length })}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-600/5 px-3 py-2 text-sm text-green-700 dark:text-green-300">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {t('redeApagada')}
            </div>
          )}

          {deOutrosDias.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium text-muted-foreground">{t('deOutrosDias', { n: deOutrosDias.length })}</h2>
              {deOutrosDias.map((r) => linha(r, true))}
            </section>
          )}

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium capitalize">
                {dia === hoje ? t('hojeExtenso') : `${rotuloDoDia(dia).semana} ${rotuloDoDia(dia).data}`}
              </h2>
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {(['todas', 'sem_resultado', 'nao_qualificadas'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFiltro(f)}
                    className={cn(
                      'px-2.5 py-1 text-xs transition-colors',
                      filtro === f ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {t(f === 'todas' ? 'filtroTodas' : f === 'sem_resultado' ? 'filtroSemResultado' : 'filtroNaoQualificadas')}
                  </button>
                ))}
              </div>
            </div>
            {lista.length > 0 ? (
              lista.map((r) => linha(r, false))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {doDia(dia).length === 0 ? t('diaVazio') : t('recorteVazio')}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
