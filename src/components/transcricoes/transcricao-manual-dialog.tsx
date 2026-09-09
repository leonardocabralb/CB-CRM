'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FUSO_PADRAO, paraInstante } from '@/lib/agenda/fuso';

/**
 * "Colar transcrição": a reunião que não passou pelo tl;dv (ou passou e a
 * gravação não saiu). Título, dia e hora, duração e link opcionais, e o
 * texto. Nasce `pronta`, vinculada ao cliente da ficha.
 *
 * ⚠️ Dia e hora são de PAREDE e viram instante por `paraInstante` — a mesma
 * regra do formulário da agenda; o valor cru do campo gravaria 14h UTC.
 */

interface Props {
  contactId: string;
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
}

type Campo = 'titulo' | 'data' | 'texto' | 'duracao' | 'url' | 'contato';

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function TranscricaoManualDialog({ contactId, aberto, aoFechar, aoSalvar }: Props) {
  const t = useTranslations('Transcricoes.manualDialog');
  const tRaiz = useTranslations('Transcricoes');
  const [titulo, setTitulo] = useState('');
  const [dia, setDia] = useState(hoje);
  const [hora, setHora] = useState('10:00');
  const [duracaoMin, setDuracaoMin] = useState('');
  const [url, setUrl] = useState('');
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const limpar = () => {
    setTitulo('');
    setDia(hoje());
    setHora('10:00');
    setDuracaoMin('');
    setUrl('');
    setTexto('');
    setErro(null);
  };

  const salvar = async () => {
    if (salvando) return;
    setErro(null);
    if (!dia || !hora) {
      setErro(t('erros.data'));
      return;
    }
    // `JSON.stringify(NaN)` vira `null`, e o servidor aceitaria "sem duração"
    // sobre um campo que a pessoa tentou preencher — conferido aqui.
    const minutos = duracaoMin.trim() === '' ? null : Number(duracaoMin);
    if (minutos !== null && !Number.isFinite(minutos)) {
      setErro(t('erros.duracao'));
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch('/api/cb/reunioes-transcritas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          titulo,
          realizada_em: paraInstante(dia, hora, FUSO_PADRAO).toISOString(),
          texto,
          duracao_seg: minutos === null ? null : Math.round(minutos * 60),
          url: url.trim() || null,
        }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; campo?: Campo };
      if (!res.ok) {
        if (corpo.error === 'invalido' && corpo.campo) setErro(t(`erros.${corpo.campo}` as Parameters<typeof t>[0]));
        else setErro(tRaiz('falha', { motivo: tRaiz('motivo.db_error') }));
        return;
      }
      toast.success(t('salvo'));
      limpar();
      aoSalvar();
      aoFechar();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('titulo')}</DialogTitle>
          <DialogDescription>{t('descricao')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label htmlFor="tr-titulo">{t('campoTitulo')}</Label>
            <Input id="tr-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} autoComplete="off" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="tr-dia">{t('campoData')}</Label>
              <Input id="tr-dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tr-hora">{t('campoHora')}</Label>
              <Input id="tr-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tr-duracao">{t('campoDuracao')}</Label>
              <Input id="tr-duracao" type="number" min={0} max={1440} value={duracaoMin} onChange={(e) => setDuracaoMin(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tr-url">{t('campoLink')}</Label>
            <Input id="tr-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tr-texto">{t('campoTexto')}</Label>
            <Textarea id="tr-texto" rows={12} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={t('textoPlaceholder')} />
          </div>
          {erro && <p className="text-xs text-destructive">{erro}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={aoFechar} disabled={salvando}>
            {t('cancelar')}
          </Button>
          <Button type="button" size="sm" onClick={() => void salvar()} disabled={salvando || !titulo.trim() || !texto.trim()}>
            {salvando ? t('salvando') : t('salvar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
