'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { Calendario } from '@/components/agenda/calendario';
import { GradeDeHoras } from '@/components/agenda/grade-de-horas';
import { ReuniaoForm } from '@/components/agenda/reuniao-form';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useReunioes } from '@/hooks/use-reunioes';
import { FUSO_PADRAO, diaNoFuso, horaNoFuso, paraInstante } from '@/lib/agenda/fuso';
import {
  hojeNoFuso,
  navegar,
  periodoDaVisao,
  rotuloDoPeriodo,
  type Visao,
} from '@/lib/agenda/grade';
import {
  TODOS,
  filtrarPorResponsavel,
} from '@/lib/agenda/responsaveis';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { cn } from '@/lib/utils';
import type { AccountMember, Meeting } from '@/types';

/**
 * A agenda de reuniões (migration 945, Fase 1).
 *
 * ⚠️ TODA data desta tela passa por `FUSO_PADRAO`. O `Date` do navegador
 * responde no fuso da máquina de quem olha, que pode não ser o do escritório —
 * e a agenda do escritório é uma só.
 */
export default function AgendaPage() {
  const t = useTranslations('Agenda');

  const [visao, setVisao] = useState<Visao>('mes');
  const [referencia, setReferencia] = useState(() =>
    diaNoFuso(new Date(), FUSO_PADRAO),
  );
  const [token, setToken] = useState(0);

  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Meeting | null>(null);
  const [diaInicial, setDiaInicial] = useState<string | null>(null);
  const [horaInicial, setHoraInicial] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Filtro por advogado — a linha do plano da Fase 1 que faltava.
  const [membros, setMembros] = useState<AccountMember[]>([]);
  const [responsavel, setResponsavel] = useState<string>(TODOS);

  useEffect(() => {
    let vivo = true;
    void fetchAccountMembers().then((lista) => {
      if (vivo) setMembros(lista);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const hoje = hojeNoFuso(new Date(), FUSO_PADRAO);

  const { de, ate } = useMemo(
    () => periodoDaVisao(visao, referencia, FUSO_PADRAO),
    [visao, referencia],
  );

  const { reunioes: todas, carregando, erro, recarregar } = useReunioes(de, ate, token);

  // ⚠️ O recorte é no CLIENTE, sobre a lista já carregada — não na consulta.
  // A janela é sempre um mês ou uma semana, então cabe inteira na memória, e
  // filtrar aqui deixa a troca de advogado instantânea, sem ida ao banco.
  const reunioes = useMemo(
    () => filtrarPorResponsavel(todas, responsavel),
    [todas, responsavel],
  );

  function abrirNovo(dia?: string) {
    setEmEdicao(null);
    setDiaInicial(dia ?? referencia);
    setHoraInicial(null);
    setFormAberto(true);
  }

  function abrirNoHorario(dia: string, hora: string) {
    setEmEdicao(null);
    setDiaInicial(dia);
    setHoraInicial(hora);
    setFormAberto(true);
  }

  function abrirEdicao(reuniao: Meeting) {
    setEmEdicao(reuniao);
    setDiaInicial(null);
    setHoraInicial(null);
    setFormAberto(true);
  }

  /**
   * Mover a reunião para outro dia, mantendo a hora.
   *
   * ⚠️ A recusa por sobreposição é ESPERADA aqui, não excepcional: é o que
   * acontece ao soltar uma reunião num dia em que o responsável já tem outra no
   * mesmo horário. A mensagem da rota é mostrada como aviso, e a lista é
   * recarregada para a reunião voltar visualmente ao lugar de origem.
   */
  async function mover(reuniao: Meeting, novoDia: string, minutos = 0) {
    const inicio = new Date(reuniao.starts_at);
    const fim = new Date(reuniao.ends_at);
    const duracao = fim.getTime() - inicio.getTime();

    // ⚠️ RECONSTRUÍDO PELA HORA DE PAREDE, não somando o deslocamento em
    // milissegundos. Somar dias em ms preserva o INSTANTE, não a hora local:
    // arrastar uma reunião das 14h para o outro lado de uma virada de horário
    // de verão a deixaria às 13h ou 15h, sem que ninguém tivesse pedido. O
    // Brasil não usa horário de verão desde 2019, então hoje as duas contas
    // dão o mesmo número — a diferença aparece no dia em que um advogado
    // estiver em outro país, e aí ninguém vai suspeitar desta linha.
    //
    // `minutos` é o deslocamento vertical na grade de horas (zero no mês, que
    // não desenha hora). Aplicado DEPOIS da reconstrução, para o arrastar
    // mudar a hora sem desfazer a proteção acima.
    const base = paraInstante(
      novoDia,
      horaNoFuso(inicio, FUSO_PADRAO),
      FUSO_PADRAO,
    );
    const novoInicio = new Date(base.getTime() + minutos * 60000);

    setAviso(null);

    const resposta = await fetch(`/api/cb/agenda/${reuniao.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        starts_at: novoInicio.toISOString(),
        ends_at: new Date(novoInicio.getTime() + duracao).toISOString(),
      }),
    });

    if (!resposta.ok) {
      const dados = (await resposta.json().catch(() => ({}))) as { error?: string };
      setAviso(dados.error ?? t('erroMover'));
    }

    void recarregar();
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">{t('titulo')}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {(['mes', 'semana', 'dia'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisao(v)}
                className={cn(
                  'rounded px-2.5 py-1 text-sm transition-colors',
                  visao === v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(v)}
              </button>
            ))}
          </div>

          <Button onClick={() => abrirNovo()}>
            <Plus className="size-4" />
            {t('novaReuniao')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setReferencia(navegar(visao, referencia, -1))}
          aria-label={t('anterior')}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setReferencia(navegar(visao, referencia, 1))}
          aria-label={t('proximo')}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="ghost" onClick={() => setReferencia(hoje)}>
          {t('hoje')}
        </Button>
        {/* ⚠️ `first-letter:uppercase`, nunca `capitalize`: o segundo põe
            maiúscula em TODA palavra, e o rótulo do mês em português vira
            "Agosto De 2026". */}
        <span className="ml-1 text-sm font-medium first-letter:uppercase">
          {rotuloDoPeriodo(visao, referencia)}
        </span>
        {carregando && (
          <span className="text-xs text-muted-foreground">{t('carregando')}</span>
        )}

        {/* ⚠️ Só aparece com dois ou mais advogados na conta: um filtro que não
            recorta nada é ruído. Diferente do seletor de responsável DENTRO do
            formulário, que é dado e fica sempre — aqui é conveniência. */}
        {membros.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={responsavel}
              onValueChange={(v) => setResponsavel(v ?? TODOS)}
            >
              <SelectTrigger className="h-8 w-48">
                <SelectValue>
                  {responsavel === TODOS
                    ? t('todosOsResponsaveis')
                    : (() => {
                        // ⚠️ memberLabel, nunca full_name cru: o trigger de
                        // signup grava '' (que o ?? não pega) — o gatilho
                        // mostrava "Todos os responsáveis" sobre uma agenda
                        // FILTRADA, e o item do dropdown saía em branco.
                        const m = membros.find((x) => x.user_id === responsavel);
                        return m ? memberLabel(m) : t('todosOsResponsaveis');
                      })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>{t('todosOsResponsaveis')}</SelectItem>
                {membros.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {memberLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {aviso && (
        <div
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          {aviso}
        </div>
      )}

      {erro && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t('erroCarregar')}
        </div>
      )}

      {/* ⚠️ `flex flex-col` + `min-h-0`: sem os dois a grade não tem como esticar
          até o rodapé. `min-h-0` porque item de flex tem `min-height: auto` por
          padrão, o que impede encolher e faz a grade transbordar em vez de
          rolar por dentro. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-lg border border-border">
        {visao === 'mes' ? (
          <Calendario
            visao={visao}
            referencia={referencia}
            hoje={hoje}
            reunioes={reunioes}
            aoAbrirReuniao={abrirEdicao}
            aoCriarNoDia={abrirNovo}
            aoMover={mover}
          />
        ) : (
          <GradeDeHoras
            visao={visao}
            referencia={referencia}
            hoje={hoje}
            reunioes={reunioes}
            aoAbrirReuniao={abrirEdicao}
            aoCriarEm={abrirNoHorario}
            aoMover={mover}
          />
        )}
      </div>

      <ReuniaoForm
        aberto={formAberto}
        aoFechar={() => setFormAberto(false)}
        reuniao={emEdicao}
        diaInicial={diaInicial}
        horaInicial={horaInicial}
        aoSalvar={() => setToken((n) => n + 1)}
      />
    </div>
  );
}
