'use client';

import { useRef } from 'react';
import { RotateCcw, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { TIPOS_DA_PECA, type PecaDaMarca } from '@/lib/marca';
import { cn } from '@/lib/utils';

import {
  ExemploDaPeca,
  FormatoDaPeca,
  ImagemNoFundo,
  OndeAparece,
} from './peca-visual';
import { useMensagemDeErro } from './mensagem-de-erro';
import type { CodigoDeErro, EstadoDaPeca } from './rascunho';

/**
 * Um cartão por peça da marca própria: o que é, onde aparece, o formato, a
 * imagem (gravada ou escolhida e ainda não salva) no fundo dela, os botões
 * e o exemplo do padrão.
 *
 * Botões por estado:
 * - gravada → Trocar, Remover;
 * - nova (escolhida, não salva) → Trocar, Desfazer (volta ao gravado);
 * - removida (some ao salvar) → Enviar, Desfazer;
 * - vazia → Enviar.
 */
export function CartaoDaPeca({
  peca,
  estado,
  url,
  erro,
  ocupado,
  onEscolher,
  onRemover,
  onDesfazer,
}: {
  peca: PecaDaMarca;
  estado: EstadoDaPeca;
  /** A imagem a mostrar (a escolhida ou a gravada); `null` = nenhuma. */
  url: string | null;
  erro: CodigoDeErro | null;
  ocupado: boolean;
  onEscolher: (arquivo: File) => void;
  onRemover: () => void;
  onDesfazer: () => void;
}) {
  const t = useTranslations('Settings.marca');
  const mensagemDeErro = useMensagemDeErro();
  const seletor = useRef<HTMLInputElement>(null);
  const idDoErro = `marca-erro-${peca}`;
  const temImagem = estado === 'gravada' || estado === 'nova';

  // O que fica no lugar quando a peça falta — a mesma regra do desenho
  // (`logoPara`/`LogoDaMarca`), dita em palavras.
  const falta =
    peca === 'simbolo'
      ? t('faltaSimbolo')
      : peca.startsWith('horizontal')
        ? t('faltaHorizontal')
        : t('faltaVertical');

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border p-4',
        erro ? 'border-destructive/60' : 'border-border'
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <h4 className="text-foreground text-sm font-semibold">
          {t(`pecas.${peca}.titulo`)}
        </h4>
        <OndeAparece peca={peca} />
        <FormatoDaPeca peca={peca} />
      </div>

      {url && temImagem ? (
        <ImagemNoFundo peca={peca} src={url} alt={t(`pecas.${peca}.titulo`)} />
      ) : (
        <div className="border-border text-muted-foreground flex h-20 min-w-0 items-center justify-center rounded-md border border-dashed px-3 text-center text-xs">
          {falta}
        </div>
      )}

      {estado === 'nova' ? (
        <p className="text-primary text-xs font-medium">{t('estadoNova')}</p>
      ) : estado === 'removida' ? (
        <p className="text-muted-foreground text-xs font-medium">
          {t('estadoRemovida')}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={ocupado}
          onClick={() => seletor.current?.click()}
          aria-describedby={erro ? idDoErro : undefined}
        >
          <Upload aria-hidden="true" />
          {temImagem ? t('trocar') : t('enviar')}
        </Button>
        {estado === 'gravada' ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={ocupado}
            onClick={onRemover}
          >
            <Trash2 aria-hidden="true" />
            {t('remover')}
          </Button>
        ) : null}
        {estado === 'nova' || estado === 'removida' ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={ocupado}
            onClick={onDesfazer}
          >
            <RotateCcw aria-hidden="true" />
            {t('desfazer')}
          </Button>
        ) : null}
      </div>

      <input
        ref={seletor}
        type="file"
        accept={TIPOS_DA_PECA[peca].join(',')}
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          // Zera o valor: escolher O MESMO arquivo de novo (depois de um
          // erro, ou de Desfazer) precisa disparar o evento outra vez.
          e.target.value = '';
          if (arquivo) onEscolher(arquivo);
        }}
      />

      {erro ? (
        <p id={idDoErro} role="alert" className="text-destructive text-[13px]">
          {mensagemDeErro(erro)}
        </p>
      ) : null}

      <ExemploDaPeca peca={peca} />
    </div>
  );
}
