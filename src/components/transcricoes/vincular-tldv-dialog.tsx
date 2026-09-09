'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buscarReunioesSemCliente } from '@/hooks/use-reunioes-transcritas';
import { FUSO_PADRAO, diaNoFuso, horaNoFuso } from '@/lib/agenda/fuso';
import { formatarDuracao } from '@/lib/tldv/texto';
import type { ReuniaoTranscrita } from '@/types';

/**
 * "Do tl;dv": ligar a este cliente uma reunião já importada e ainda sem
 * cliente, OU colar o link da reunião no tl;dv para importá-la agora, já
 * vinculada. As duas escritas passam pela rota (987).
 */

interface Props {
  contactId: string;
  aberto: boolean;
  aoFechar: () => void;
  aoVincular: () => void;
}

const MOTIVOS = new Set(['link_invalido', 'nao_conectado', 'nao_encontrado', 'sem_permissao', 'limite', 'rede', 'tldv_error', 'db_error', 'contato_nao_encontrado', 'chave_invalida', 'chave_ilegivel']);

export function VincularTldvDialog({ contactId, aberto, aoFechar, aoVincular }: Props) {
  const t = useTranslations('Transcricoes');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<ReuniaoTranscrita[]>([]);
  // ⚠️ Nasce `true`: a lista vazia durante a carga NÃO pode virar "nenhuma
  // reunião sem cliente" (efeito passivo, CLAUDE.md).
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [link, setLink] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const motivo = (codigo: string) =>
    MOTIVOS.has(codigo) ? t(`motivo.${codigo}` as Parameters<typeof t>[0]) : t('motivo.tldv_error');

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true);
    const timer = setTimeout(async () => {
      const r = await buscarReunioesSemCliente(busca);
      if (!vivo) return;
      setLista(r.reunioes);
      setFalhou(r.falhou);
      setCarregando(false);
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [aberto, busca]);

  const vincular = async (r: ReuniaoTranscrita) => {
    if (ocupado) return;
    setOcupado(r.id);
    try {
      const res = await fetch(`/api/cb/reunioes-transcritas/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId }),
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(t('falha', { motivo: motivo(corpo.error ?? 'db_error') }));
        return;
      }
      toast.success(t('vinculada'));
      aoVincular();
      aoFechar();
    } finally {
      setOcupado(null);
    }
  };

  const importar = async () => {
    if (ocupado || !link.trim()) return;
    setOcupado('link');
    try {
      const res = await fetch('/api/cb/tldv/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link, contact_id: contactId }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) {
        toast.error(t('falha', { motivo: motivo(corpo.error ?? 'tldv_error') }));
        return;
      }
      toast.success(corpo.status === 'pronta' ? t('importadaPronta') : t('importadaPendente'));
      setLink('');
      aoVincular();
      aoFechar();
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('vincularDialog.titulo')}</DialogTitle>
          <DialogDescription>{t('vincularDialog.descricao')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="tldv-link">{t('vincularDialog.linkLabel')}</Label>
          <div className="flex gap-2">
            <Input
              id="tldv-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t('vincularDialog.linkPlaceholder')}
              autoComplete="off"
            />
            <Button type="button" size="sm" onClick={() => void importar()} disabled={ocupado !== null || !link.trim()}>
              {ocupado === 'link' ? t('vincularDialog.importando') : t('vincularDialog.importar')}
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t('vincularDialog.buscar')} className="pl-8" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {carregando ? (
            <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {t('carregando')}
            </p>
          ) : falhou ? (
            <p className="py-2 text-xs text-destructive">{t('erroCarregar')}</p>
          ) : lista.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">{t('vincularDialog.semResultados')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {lista.map((r) => {
                const inicio = new Date(r.realizada_em);
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{r.titulo}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {diaNoFuso(inicio, FUSO_PADRAO)} · {horaNoFuso(inicio, FUSO_PADRAO)} · {formatarDuracao(r.duracao_seg)} ·{' '}
                        {t(`status.${r.status}` as Parameters<typeof t>[0])}
                      </p>
                      {r.participantes.length > 0 && (
                        <p className="truncate text-xs text-muted-foreground">{r.participantes.map((p) => p.email || p.nome).join(', ')}</p>
                      )}
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => void vincular(r)} disabled={ocupado !== null}>
                      {ocupado === r.id ? <Loader2 className="size-3.5 animate-spin" /> : t('vincularDialog.vincular')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
