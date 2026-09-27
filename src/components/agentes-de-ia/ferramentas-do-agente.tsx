'use client';

// ============================================================
// Sub-aba Ferramentas de um agente de IA (F4, D28 do
// docs/PLANO-agentes-de-ia.md): o que o agente pode FAZER junto com a
// resposta — mover o card, etiquetar, tirar etiqueta, preencher campo, criar
// tarefa e executar automação. Cada tipo é uma chave e, ligado, a lista do
// que ele pode escolher. Salva pelo PATCH do agente, mandando SÓ `ferramentas`.
//
// ⚠️ NADA ligado = o agente só conversa (fechado por padrão, como o acesso).
// O que sai da D5 não pode ser marcado: etapa de ganho/perdido, campo de
// data vigiado por lembrete, automação com passo fora da D5 (ou com
// "Aguardar") e a CASCATA — etapa ou etiqueta cuja automação de entrada, de
// aplicar ou de tirar sai da D5 — aparecem DESABILITADOS com o motivo; quem
// calcula é o servidor (`/ferramentas/opcoes`), a tela só mostra. Um item
// assim que JÁ estava marcado (a etapa virou de resultado depois, a
// automação da etapa ganhou um passo) continua desmarcável, com o motivo em
// vermelho: o Salvar vai recusá-lo (400 com os `itens`, marcados na lista).
//
// ⚠️ As opções carregam à parte: enquanto carregam as listas são esqueleto,
// e a carga que falha diz que falhou — nunca "a conta não tem etiquetas",
// que seria a lista vazia virando afirmação (CLAUDE.md).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { LIMITES } from '@/lib/ia-agentes/agente';
import { semAcento } from '@/lib/inbox/busca-em-mensagens';
import { cn } from '@/lib/utils';
import { agruparItens, itensDoTipo, lerOpcoes, type Bloqueio, type ItemDaLista } from './ferramentas';
import {
  ferramentasDoRascunho,
  ferramentasMudaram,
  ferramentasParaSalvar,
  rascunhoDasFerramentas,
  type RascunhoDasFerramentas,
} from './rascunho';
import { motivoForaDaD5, rotuloDoTipoDeAcao, rotuloDoTipoDoCampo, textoDoCodigo } from './textos';
import { TIPOS_DE_ACAO, type IaAgente, type OpcoesDasFerramentas, type TipoDeAcao } from './tipos';

type Carga = { fase: 'carregando' } | { fase: 'falhou' } | { fase: 'pronto'; opcoes: OpcoesDasFerramentas };

/** O teto de linhas do PostgREST: lista com isto (ou mais) pode ter sido cortada. */
const TETO_DO_POSTGREST = 1000;

/** Acima disto a lista ganha a caixa de busca. */
const ITENS_PARA_BUSCAR = 10;

export function FerramentasDoAgente({
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
  const [rascunho, setRascunho] = useState<RascunhoDasFerramentas>(() => rascunhoDasFerramentas(agente.ferramentas));
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [salvando, setSalvando] = useState(false);
  // Os ids que o último Salvar teve recusados (400 com `itens`): ficam
  // marcados na lista até a próxima tentativa.
  const [recusados, setRecusados] = useState<ReadonlySet<string>>(() => new Set());

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}/ferramentas/opcoes`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const opcoes = lerOpcoes(await res.json());
      setCarga(opcoes ? { fase: 'pronto', opcoes } : { fase: 'falhou' });
    } catch {
      setCarga({ fase: 'falhou' });
    }
  }, [agente.id]);

  useEffect(() => {
    void (async () => {
      await carregar();
    })();
  }, [carregar]);

  const ferramentas = useMemo(() => ferramentasDoRascunho(rascunho), [rascunho]);
  const naoSalvo = ferramentasMudaram(agente.ferramentas, ferramentas);
  useEffect(() => {
    aoMudarNaoSalvo?.(naoSalvo);
  }, [naoSalvo, aoMudarNaoSalvo]);

  // O catálogo de cada tipo, para podar o que não existe mais. ⚠️ Só uma
  // lista COMPLETA prova que o item sumiu (Codex, #312): cortada pelo teto
  // do PostgREST — ou sem carga —, nada é descartado.
  const existentes = useMemo(() => {
    const saida: Partial<Record<TipoDeAcao, ReadonlySet<string> | null>> = {};
    if (carga.fase !== 'pronto') return saida;
    for (const tipo of TIPOS_DE_ACAO) {
      const itens = itensDoTipo(carga.opcoes, tipo);
      saida[tipo] = itens.length < TETO_DO_POSTGREST ? new Set(itens.map((i) => i.id)) : null;
    }
    return saida;
  }, [carga]);

  const nadaLigado = rascunho.ligadas.length === 0;

  function alternarTipo(tipo: TipoDeAcao, ligar: boolean) {
    setRascunho((r) => ({
      ...r,
      ligadas: ligar ? (r.ligadas.includes(tipo) ? r.ligadas : [...r.ligadas, tipo]) : r.ligadas.filter((x) => x !== tipo),
    }));
  }

  function alternarItem(tipo: TipoDeAcao, id: string) {
    setRascunho((r) => {
      const lista = r.listas[tipo];
      return {
        ...r,
        listas: { ...r.listas, [tipo]: lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id] },
      };
    });
  }

  async function salvar() {
    if (!naoSalvo) return;
    setSalvando(true);
    setRecusados(new Set());
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ferramentas: ferramentasParaSalvar(ferramentas, existentes) }),
      });
      const corpo = (await res.json().catch(() => ({}))) as {
        agente?: IaAgente;
        code?: string;
        error?: string;
        itens?: unknown;
      };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code, corpo.error));
        if (Array.isArray(corpo.itens)) {
          setRecusados(new Set(corpo.itens.filter((x): x is string => typeof x === 'string')));
        }
        return;
      }
      toast.success(t('ferramentas.salvo'));
      // O rascunho passa a ser o que o servidor gravou (sem os itens órfãos).
      setRascunho(rascunhoDasFerramentas(corpo.agente.ferramentas));
      aoSalvar(corpo.agente);
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('ferramentas.explicacao')}</p>
      {nadaLigado ? <p className="text-xs text-muted-foreground">{t('ferramentas.soConversa')}</p> : null}

      <div className="space-y-3">
        {TIPOS_DE_ACAO.map((tipo) => {
          const ligada = rascunho.ligadas.includes(tipo);
          return (
            <section key={tipo} className="space-y-3 rounded-md border border-border p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <Switch className="mt-0.5" checked={ligada} onCheckedChange={(v) => alternarTipo(tipo, v === true)} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{rotuloDoTipoDeAcao(t, tipo)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`ferramentas.tipo.${tipo}.dica`)}</span>
                </span>
              </label>
              {ligada ? (
                carga.fase === 'carregando' ? (
                  <div className="h-20 animate-pulse rounded-md bg-muted/40" />
                ) : carga.fase === 'falhou' ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{t('ferramentas.falhou')}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCarga({ fase: 'carregando' });
                        void carregar();
                      }}
                    >
                      <RefreshCw className="size-4" /> {t('tentarDeNovo')}
                    </Button>
                  </div>
                ) : (
                  <ListaDoTipo
                    tipo={tipo}
                    itens={itensDoTipo(carga.opcoes, tipo)}
                    marcados={rascunho.listas[tipo]}
                    recusados={recusados}
                    aoAlternar={(id) => alternarItem(tipo, id)}
                  />
                )
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={() => void salvar()} disabled={salvando || !naoSalvo}>
          {t('ferramentas.salvar')}
        </Button>
      </div>
    </div>
  );
}

/** A lista de um tipo ligado: marcar o que o agente pode escolher. */
function ListaDoTipo({
  tipo,
  itens,
  marcados,
  recusados,
  aoAlternar,
}: {
  tipo: TipoDeAcao;
  itens: ItemDaLista[];
  marcados: string[];
  recusados: ReadonlySet<string>;
  aoAlternar: (id: string) => void;
}) {
  const t = useTranslations('IaAgentes');
  const [busca, setBusca] = useState('');

  if (itens.length === 0) return <p className="text-sm text-muted-foreground">{t(`ferramentas.nenhum.${tipo}`)}</p>;

  // Só os marcados que ainda existem contam (o Salvar descarta os outros).
  const ids = new Set(itens.map((i) => i.id));
  const quantos = marcados.filter((id) => ids.has(id)).length;
  // O teto de `lerFerramentas` no servidor: no teto, só dá para desmarcar.
  const noTeto = quantos >= LIMITES.itensPorAcao;

  const termo = semAcento(busca.trim());
  const visiveis = termo
    ? itens.filter((i) => semAcento(i.nome).includes(termo) || (i.grupo !== null && semAcento(i.grupo).includes(termo)))
    : itens;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {itens.length > ITENS_PARA_BUSCAR ? (
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={t('ferramentas.buscar')}
              aria-label={t('ferramentas.buscar')}
              className="pl-8"
            />
          </div>
        ) : (
          <span />
        )}
        <span className="text-xs text-muted-foreground">{t('ferramentas.marcados', { n: quantos })}</span>
      </div>
      {quantos === 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{t('ferramentas.ligadaSemNada')}</p>
      ) : null}
      {noTeto ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{t('ferramentas.limite', { max: LIMITES.itensPorAcao })}</p>
      ) : null}
      {visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('ferramentas.nenhumNaBusca')}</p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {agruparItens(visiveis).map(({ grupo, itens: doGrupo }) => (
            <div key={grupo ?? ''} className="space-y-2">
              {grupo !== null ? <p className="text-xs font-medium text-muted-foreground">{grupo}</p> : null}
              <div className={cn('grid gap-2', tipo !== 'executar_automacao' && 'sm:grid-cols-2')}>
                {doGrupo.map((item) => (
                  <ItemMarcavel
                    key={item.id}
                    item={item}
                    marcado={marcados.includes(item.id)}
                    recusado={recusados.has(item.id)}
                    noTeto={noTeto}
                    aoAlternar={() => aoAlternar(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemMarcavel({
  item,
  marcado,
  recusado,
  noTeto,
  aoAlternar,
}: {
  item: ItemDaLista;
  marcado: boolean;
  recusado: boolean;
  noTeto: boolean;
  aoAlternar: () => void;
}) {
  const t = useTranslations('IaAgentes');
  const motivo = item.bloqueio ? textoDoBloqueio(t, item.bloqueio) : null;
  // Bloqueado ou no teto: só dá para DESMARCAR (a rota recusaria a lista).
  const desabilitado = !marcado && (motivo !== null || noTeto);
  // O tipo do campo ao lado do nome ("Data", "Lista"…): é o que diz ao
  // administrador que valor o agente vai precisar escrever.
  const tipoDoCampo = item.campo ? rotuloDoTipoDoCampo(t, item.campo.tipo) : null;
  const opcoesDoCampo =
    item.campo && item.campo.opcoes.length > 0
      ? t('ferramentas.campoOpcoes', { opcoes: item.campo.opcoes.join(', ') })
      : undefined;
  return (
    <label
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-sm text-sm',
        recusado && 'ring-1 ring-red-500/60',
        desabilitado ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <Checkbox className="mt-0.5" checked={marcado} disabled={desabilitado} onCheckedChange={aoAlternar} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('truncate', desabilitado && 'text-muted-foreground')} title={item.nome}>
            {item.nome}
          </span>
          {tipoDoCampo !== null ? (
            <span
              className="shrink-0 rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground"
              title={opcoesDoCampo}
            >
              {tipoDoCampo}
            </span>
          ) : null}
        </span>
        {motivo !== null ? (
          <span
            className={cn(
              'block text-xs',
              // Marcado e proibido: o Salvar vai recusar — o motivo em vermelho diz o que desmarcar.
              marcado ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground',
            )}
          >
            {motivo}
          </span>
        ) : null}
        {recusado && motivo === null ? (
          <span className="block text-xs text-red-700 dark:text-red-300">{t('ferramentas.recusado')}</span>
        ) : null}
      </span>
    </label>
  );
}

function textoDoBloqueio(t: ReturnType<typeof useTranslations>, bloqueio: Bloqueio): string {
  switch (bloqueio.tipo) {
    case 'etapa_de_resultado':
      return t('ferramentas.bloqueio.etapaDeResultado');
    case 'campo_vigiado':
      return t('ferramentas.bloqueio.campoVigiado');
    case 'fora_da_d5':
      // "Aguardar" tem frase própria: não é passo proibido em si — a IA só não
      // executa automação que pausa (a retomada não confere o agente).
      return bloqueio.codigo === 'aguardar'
        ? t('ferramentas.bloqueio.aguardar')
        : t('ferramentas.bloqueio.foraDaD5', { motivo: motivoForaDaD5(t, bloqueio.codigo) });
    case 'cascata':
      return t(`ferramentas.bloqueio.cascata.${bloqueio.gatilho}`, { motivo: motivoForaDaD5(t, bloqueio.codigo) });
    default: {
      const nunca: never = bloqueio;
      return String(nunca);
    }
  }
}
