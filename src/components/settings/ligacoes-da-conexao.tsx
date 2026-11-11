'use client';

// ============================================================
// "Ligações pelo CRM" na ficha de cada conexão por QR (4e,
// `docs/PLANO-ligar-pelo-crm.md` §8.17), só para o admin:
//  - D16: um INTERRUPTOR por conexão. Ligado, o estado do computador de
//    ligações e, quando ele pede, o QR para ler com o celular do número;
//    desligado, o botão "Ligar" e o toque somem para a equipe;
//  - D17: só onde já há computador — sem ele, a frase "este número ainda não
//    tem computador de ligações" (criar um é operação no servidor);
//  - o QR aparece SOZINHO quando a máquina o pede (laço ENCADEADO de poucos
//    segundos, só com a seção na tela, como o da Evolution: nunca
//    `setInterval`, a rota pode levar segundos);
//  - "Reparear" desconecta o WhatsApp da máquina para um QR novo, com
//    confirmação (derruba as ligações do número até alguém ler o QR).
//
// ⚠️ Lista carregando ou que FALHOU nunca vira "não tem computador" (raiz,
// 8c): a frase da D17 só sai com a resposta na mão.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PhoneCall, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import type { SituacaoDaMaquina } from '@/lib/whatsapp/ligacoes/computador';

/** Um computador como a rota da lista o devolve (`/api/cb/ligacoes/conexoes`). */
export interface ComputadorNaTela {
  channel_id: string;
  ligado: boolean;
  ligado_em: string | null;
  situacao: SituacaoDaMaquina | null;
  sinal_em: string | null;
}

export type ListaDasLigacoes =
  | { estado: 'inativa' }
  | { estado: 'carregando' }
  | { estado: 'falhou' }
  | { estado: 'pronta'; configurado: boolean; porCanal: Map<string, ComputadorNaTela> };

/** A lista se renova assim (o sinal da máquina vem a cada minuto). */
const RENOVAR_A_LISTA_MS = 60_000;
/** O QR do WhatsApp troca a cada ~20 s: a tela pergunta mais rápido que isso. */
export const INTERVALO_DO_QR_MS = 4_000;

/** A lista dos computadores da conta, só para o admin (a rota é dele). */
export function useLigacoesDasConexoes(): { lista: ListaDasLigacoes; recarregar: () => void } {
  const { profileLoading, accountRole } = useAuth();
  const ativa = !profileLoading && !!accountRole && hasMinRole(accountRole, 'admin');
  const [lista, setLista] = useState<ListaDasLigacoes>({ estado: 'carregando' });
  const [geracao, setGeracao] = useState(0);
  const recarregar = useCallback(() => setGeracao((g) => g + 1), []);

  useEffect(() => {
    if (!ativa) return;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const buscar = async () => {
      try {
        const r = await fetch('/api/cb/ligacoes/conexoes', { cache: 'no-store' });
        const corpo = (await r.json().catch(() => null)) as {
          configurado?: boolean;
          computadores?: ComputadorNaTela[];
        } | null;
        if (!vivo) return;
        if (!r.ok || !corpo || !Array.isArray(corpo.computadores)) {
          // A última boa fica (a seção não pisca); sem nenhuma, "não deu".
          setLista((antes) => (antes.estado === 'pronta' ? antes : { estado: 'falhou' }));
        } else {
          setLista({
            estado: 'pronta',
            configurado: corpo.configurado === true,
            porCanal: new Map(corpo.computadores.map((c) => [c.channel_id, c])),
          });
        }
      } catch {
        if (vivo) setLista((antes) => (antes.estado === 'pronta' ? antes : { estado: 'falhou' }));
      }
      if (vivo) relogio = setTimeout(buscar, RENOVAR_A_LISTA_MS);
    };
    void buscar();
    return () => {
      vivo = false;
      clearTimeout(relogio);
    };
  }, [ativa, geracao]);

  return { lista: ativa ? lista : { estado: 'inativa' }, recarregar };
}

/** O que a seção desta conexão mostra (pura, testada). */
export type Secao =
  | { tipo: 'nada' }
  | { tipo: 'carregando' }
  | { tipo: 'falhou' }
  | { tipo: 'sem_computador' }
  | { tipo: 'computador'; computador: ComputadorNaTela };

export function secaoDaConexao(lista: ListaDasLigacoes, channelId: string): Secao {
  if (lista.estado === 'inativa') return { tipo: 'nada' };
  if (lista.estado === 'carregando') return { tipo: 'carregando' };
  if (lista.estado === 'falhou') return { tipo: 'falhou' };
  // A instalação sem o segredo das ligações não as tem: nada a dizer.
  if (!lista.configurado) return { tipo: 'nada' };
  const computador = lista.porCanal.get(channelId);
  return computador ? { tipo: 'computador', computador } : { tipo: 'sem_computador' };
}

/** "há 12 min", com o mesmo vocabulário curto do botão das conexões. */
function haQuanto(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

type Tradutor = ReturnType<typeof useTranslations<'Settings.channels'>>;

function textoDaSituacao(t: Tradutor, c: ComputadorNaTela): string {
  switch (c.situacao) {
    case 'pronto':
      return t('ligacoes.situacao.pronto');
    case 'em_ligacao':
      return t('ligacoes.situacao.emLigacao');
    case 'qr':
      return t('ligacoes.situacao.qr');
    case 'carregando':
    case null:
      return t('ligacoes.situacao.carregando');
    case 'fora': {
      const tempo = haQuanto(c.sinal_em);
      return tempo ? t('ligacoes.situacao.fora', { tempo }) : t('ligacoes.situacao.foraSemSinal');
    }
  }
}

function textoDoErro(t: Tradutor, erro: unknown): string {
  switch (erro) {
    case 'em_ligacao':
      return t('ligacoes.erro.emLigacao');
    case 'ja_pede_qr':
      return t('ligacoes.erro.jaPedeQr');
    case 'desligado':
      return t('ligacoes.erro.desligado');
    case 'sem_resposta':
      return t('ligacoes.erro.semResposta');
    case 'nao_desconectou':
      return t('ligacoes.erro.naoDesconectou');
    case 'sem_computador':
      return t('ligacoes.erro.semComputador');
    default:
      return t('ligacoes.erro.falhou');
  }
}

type EstadoDoQr =
  | { de: string; tipo: 'esperando' }
  | { de: string; tipo: 'qr'; imagem: string }
  | { de: string; tipo: 'falhou' };

/**
 * O QR ao vivo, em laço encadeado enquanto `ativo`. A máquina conectada
 * (alguém leu o QR) avisa uma vez por `aoConectar` e o laço para. O
 * `aoConectar` vai por REF: trocá-lo (a cada sinal novo da lista) não
 * reinicia o laço (revisão da 4e: reiniciar dava dois avisos "conectou").
 */
function useQrAoVivo(channelId: string, ativo: boolean, aoConectar: () => void): EstadoDoQr | null {
  const [qr, setQr] = useState<EstadoDoQr | null>(null);
  const aoConectarRef = useRef(aoConectar);
  useEffect(() => {
    aoConectarRef.current = aoConectar;
  }, [aoConectar]);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const consultar = async () => {
      try {
        const r = await fetch(`/api/cb/ligacoes/conexoes/${channelId}/qr`, { cache: 'no-store' });
        const corpo = (await r.json().catch(() => null)) as { whatsapp?: string | null; qr?: string | null } | null;
        if (!vivo) return;
        if (r.ok && corpo?.whatsapp === 'conectado') {
          aoConectarRef.current();
          return;
        }
        setQr(
          r.ok && corpo?.qr
            ? { de: channelId, tipo: 'qr', imagem: corpo.qr }
            : r.ok
              ? { de: channelId, tipo: 'esperando' }
              : { de: channelId, tipo: 'falhou' },
        );
      } catch {
        if (vivo) setQr({ de: channelId, tipo: 'falhou' });
      }
      if (vivo) relogio = setTimeout(consultar, INTERVALO_DO_QR_MS);
    };
    void consultar();
    return () => {
      vivo = false;
      clearTimeout(relogio);
    };
  }, [channelId, ativo]);
  // Carimbado pela conexão (raiz, 8c): o estado de outra nunca aparece aqui.
  return ativo && qr?.de === channelId ? qr : null;
}

export function LigacoesDaConexao({
  channelId,
  label,
  lista,
  recarregar,
}: {
  channelId: string;
  label: string;
  lista: ListaDasLigacoes;
  recarregar: () => void;
}) {
  const t = useTranslations('Settings.channels');
  const secao = secaoDaConexao(lista, channelId);
  const computador = secao.tipo === 'computador' ? secao.computador : null;
  const [trocando, setTrocando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [reparando, setReparando] = useState(false);
  // "Conectou" fica preso ao SINAL da lista em que aconteceu: o sinal seguinte
  // (a máquina o manda na hora em que o WhatsApp muda) traz a verdade dela e o
  // aposenta. O Reparear que deu certo mantém o QR na tela até alguém ler
  // (`aoConectar`) — nunca preso ao sinal do CLIQUE: a lista se renova durante
  // o pedido, que leva até 75 s (revisão da 4e).
  const [conectadoNoSinal, setConectadoNoSinal] = useState<string | null | undefined>(undefined);
  const [reparado, setReparado] = useState(false);

  const sinal = computador?.sinal_em ?? null;
  const sinalRef = useRef(sinal);
  useEffect(() => {
    sinalRef.current = sinal;
  }, [sinal]);
  const ligado = computador?.ligado === true;
  const conectadoAgora = conectadoNoSinal !== undefined && conectadoNoSinal === sinal;
  const pedeQr = ligado && !conectadoAgora && (computador?.situacao === 'qr' || reparado);

  const aoConectar = useCallback(() => {
    setConectadoNoSinal(sinalRef.current);
    setReparado(false);
    toast.success(t('ligacoes.conectou', { label }));
    recarregar();
  }, [t, label, recarregar]);
  const qr = useQrAoVivo(channelId, pedeQr, aoConectar);

  if (secao.tipo === 'nada') return null;

  async function trocar(ligar: boolean) {
    setTrocando(true);
    try {
      const r = await fetch(`/api/cb/ligacoes/conexoes/${channelId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ligado: ligar }),
      });
      const corpo = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) {
        toast.error(textoDoErro(t, corpo?.error));
        return;
      }
      toast.success(ligar ? t('ligacoes.ligou', { label }) : t('ligacoes.desligou', { label }));
      if (!ligar) setReparado(false);
      recarregar();
    } catch {
      toast.error(t('ligacoes.erro.falhou'));
    } finally {
      setTrocando(false);
    }
  }

  async function reparear() {
    setReparando(true);
    try {
      const r = await fetch(`/api/cb/ligacoes/conexoes/${channelId}/reparear`, { method: 'POST' });
      const corpo = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) {
        toast.error(textoDoErro(t, corpo?.error));
        return;
      }
      setConectadoNoSinal(undefined);
      setReparado(true);
      setConfirmar(false);
      recarregar();
    } catch {
      toast.error(t('ligacoes.erro.falhou'));
    } finally {
      setReparando(false);
    }
  }

  const aviso = ligado && (computador?.situacao === 'fora' || computador?.situacao === 'qr');

  return (
    <div className="basis-full rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PhoneCall aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{t('ligacoes.titulo')}</span>
        {computador && (
          <Switch
            checked={ligado}
            disabled={trocando}
            aria-label={t('ligacoes.interruptor', { label })}
            onCheckedChange={(valor) => void trocar(valor === true)}
          />
        )}
        {computador && ligado && (computador.situacao === 'pronto' || computador.situacao === 'em_ligacao') && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            title={t('ligacoes.reparearDica')}
            disabled={computador.situacao === 'em_ligacao'}
            onClick={() => setConfirmar(true)}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('ligacoes.reparear')}
          </Button>
        )}
      </div>

      <p className={cn('mt-1.5 text-xs', aviso ? 'font-medium text-amber-700' : 'text-muted-foreground')}>
        {secao.tipo === 'carregando' && t('ligacoes.carregando')}
        {secao.tipo === 'falhou' && (
          <>
            {t('ligacoes.falhaDaLista')}{' '}
            <button type="button" className="underline underline-offset-2" onClick={recarregar}>
              {t('ligacoes.tentarDeNovo')}
            </button>
          </>
        )}
        {secao.tipo === 'sem_computador' && t('ligacoes.semComputador')}
        {computador && !ligado && t('ligacoes.desligadas')}
        {computador && ligado && (conectadoAgora ? t('ligacoes.conectado') : textoDaSituacao(t, computador))}
      </p>

      {pedeQr && (
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <div className="flex h-48 w-48 shrink-0 items-center justify-center rounded-md border bg-white p-2">
            {qr?.tipo === 'qr' ? (
              // O QR é um PNG em data URL que a rota conferiu: <img> simples.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.imagem} alt={t('ligacoes.qrAlt', { label })} className="h-full w-full object-contain" />
            ) : (
              <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2 text-xs text-muted-foreground">
            <p>{t('ligacoes.qrInstrucao')}</p>
            {qr?.tipo === 'esperando' && <p>{t('ligacoes.qrEsperando')}</p>}
            {qr?.tipo === 'falhou' && <p className="text-amber-700">{t('ligacoes.qrFalhou')}</p>}
          </div>
        </div>
      )}

      <Dialog open={confirmar} onOpenChange={(aberto) => !reparando && setConfirmar(aberto)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ligacoes.reparearTitulo', { label })}</DialogTitle>
            <DialogDescription>{t('ligacoes.reparearDescricao')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={reparando} onClick={() => setConfirmar(false)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" disabled={reparando} onClick={() => void reparear()}>
              {reparando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('ligacoes.reparearConfirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
