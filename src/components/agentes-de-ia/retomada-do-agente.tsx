'use client';

// ============================================================
// Sub-aba Retomada de um agente de IA (1056, pedido do operador em
// 27/09/2026): quando o agente pergunta algo e o cliente não responde, ele
// volta a falar numa cadência (padrão 15 min · 1 h · 3 h · 6 h · 12 h · 48 h,
// contados da última mensagem do agente sem resposta), só dentro de uma
// janela do dia. Salva pelo PATCH do agente, mandando SÓ `retomada` (o objeto
// inteiro — o servidor recusa cadência ou janela fora da forma com
// `retomada_invalida`).
//
// ⚠️ A tela diz QUANDO a série para (o cliente respondeu, a equipe assumiu, o
// card saiu da etapa, perto dos lembretes da reunião): é o que o operador
// precisa saber antes de ligar.
// ============================================================

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, RotateCcw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CADENCIA_PADRAO, cadenciaValida, LIMITES_DA_RETOMADA } from '@/lib/ia-agentes/retomada';
import { cn } from '@/lib/utils';
import { acrescentarIntervalo, retomadaMudou } from './rascunho';
import { textoDoCodigo, textoDoIntervalo } from './textos';
import type { ConfigDaRetomada, IaAgente } from './tipos';

const UNIDADES = ['min', 'h', 'd'] as const;
type Unidade = (typeof UNIDADES)[number];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function copiar(r: ConfigDaRetomada): ConfigDaRetomada {
  return { ativa: r.ativa, cadencia: [...r.cadencia], janela: { ...r.janela } };
}

export function RetomadaDoAgente({
  agente,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  agente: IaAgente;
  aoSalvar: (novo: IaAgente) => void;
  /** Avisa o detalhe se há alteração não salva (a aba Playground diz isso). */
  aoMudarNaoSalvo?: (naoSalvo: boolean) => void;
}) {
  const t = useTranslations('IaAgentes');
  const [rascunho, setRascunho] = useState<ConfigDaRetomada>(() => copiar(agente.retomada));
  const [valor, setValor] = useState('');
  const [unidade, setUnidade] = useState<Unidade>('h');
  const [salvando, setSalvando] = useState(false);

  const naoSalvo = retomadaMudou(agente.retomada, rascunho);
  useEffect(() => {
    aoMudarNaoSalvo?.(naoSalvo);
  }, [naoSalvo, aoMudarNaoSalvo]);

  const janelaValida =
    HORA.test(rascunho.janela.inicio) && HORA.test(rascunho.janela.fim) && rascunho.janela.inicio < rascunho.janela.fim;
  const podeSalvar = naoSalvo && !salvando && janelaValida && cadenciaValida(rascunho.cadencia);
  const ehPadrao =
    rascunho.cadencia.length === CADENCIA_PADRAO.length && rascunho.cadencia.every((m, i) => m === CADENCIA_PADRAO[i]);

  function acrescentar() {
    const r = acrescentarIntervalo(rascunho.cadencia, valor, unidade);
    if (!r.ok) {
      toast.error(
        r.motivo === 'cheia'
          ? t('retomada.cheia', { max: LIMITES_DA_RETOMADA.tentativasMax })
          : r.motivo === 'repetido'
            ? t('retomada.repetido')
            : t('retomada.invalido')
      );
      return;
    }
    setRascunho((x) => ({ ...x, cadencia: r.cadencia }));
    setValor('');
  }

  async function salvar() {
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retomada: rascunho }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { agente?: IaAgente; code?: string; error?: string };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code, corpo.error));
        return;
      }
      toast.success(t('retomada.salvo'));
      setRascunho(copiar(corpo.agente.retomada));
      aoSalvar(corpo.agente);
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('retomada.explicacao')}</p>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t('retomada.ligar')}</p>
          <p className="text-xs text-muted-foreground">{t('retomada.ligarDica')}</p>
        </div>
        <Switch
          checked={rascunho.ativa}
          onCheckedChange={(v) => setRascunho((x) => ({ ...x, ativa: v === true }))}
          aria-label={t('retomada.ligar')}
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{t('retomada.cadencia')}</h3>
          {!ehPadrao ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setRascunho((x) => ({ ...x, cadencia: [...CADENCIA_PADRAO] }))}
            >
              <RotateCcw className="size-3.5" /> {t('retomada.restaurarPadrao')}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('retomada.cadenciaDica', { max: LIMITES_DA_RETOMADA.tentativasMax })}
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label={t('retomada.cadencia')}>
          {rascunho.cadencia.map((minutos, i) => (
            <li
              key={minutos}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs text-foreground"
              title={t('retomada.tentativa', { n: i + 1 })}
            >
              {textoDoIntervalo(t, minutos)}
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                aria-label={t('retomada.remover', { tempo: textoDoIntervalo(t, minutos) })}
                // A cadência tem pelo menos UMA tentativa (para desligar, a chave).
                disabled={rascunho.cadencia.length <= LIMITES_DA_RETOMADA.tentativasMin}
                onClick={() => setRascunho((x) => ({ ...x, cadencia: x.cadencia.filter((m) => m !== minutos) }))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="retomada-valor" className="sr-only">
            {t('retomada.novoIntervalo')}
          </Label>
          <Input
            id="retomada-valor"
            inputMode="numeric"
            className="w-20"
            value={valor}
            placeholder={t('retomada.novoIntervalo')}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                acrescentar();
              }
            }}
          />
          <div className="flex gap-1" role="group" aria-label={t('retomada.unidadeDoIntervalo')}>
            {UNIDADES.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unidade === u}
                onClick={() => setUnidade(u)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  unidade === u ? 'border-primary bg-primary/5' : 'border-border text-muted-foreground'
                )}
              >
                {t(`retomada.unidadeNome.${u}`)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={acrescentar}
            disabled={!valor.trim() || rascunho.cadencia.length >= LIMITES_DA_RETOMADA.tentativasMax}
          >
            <Plus className="size-3.5" /> {t('retomada.adicionar')}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t('retomada.janela')}</h3>
        <p className="text-xs text-muted-foreground">{t('retomada.janelaDica')}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input
            type="time"
            className="w-32"
            aria-label={t('retomada.inicio')}
            value={rascunho.janela.inicio}
            onChange={(e) => setRascunho((x) => ({ ...x, janela: { ...x.janela, inicio: e.target.value } }))}
          />
          <span className="text-muted-foreground">{t('campo.ate')}</span>
          <Input
            type="time"
            className="w-32"
            aria-label={t('retomada.fim')}
            value={rascunho.janela.fim}
            onChange={(e) => setRascunho((x) => ({ ...x, janela: { ...x.janela, fim: e.target.value } }))}
          />
        </div>
        {!janelaValida ? <p className="text-xs text-red-700 dark:text-red-300">{t('retomada.janelaInvalida')}</p> : null}
        {agente.horario ? (
          <p className="text-xs text-muted-foreground">
            {t('retomada.janelaComHorario', { inicio: agente.horario.inicio, fim: agente.horario.fim })}
          </p>
        ) : null}
      </section>

      <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        {t('retomada.paradas')}
      </p>

      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={() => void salvar()} disabled={!podeSalvar}>
          {t('retomada.salvar')}
        </Button>
      </div>
    </div>
  );
}
