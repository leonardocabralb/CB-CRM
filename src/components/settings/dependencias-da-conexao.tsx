'use client';

/**
 * O que depende desta conexão, dentro do diálogo de REMOVER (03/10/2026).
 *
 * Remover tinha efeitos que a tela não mostrava: passos que enviavam por esta
 * conexão passavam a sair por outro número, robôs só dela viravam curinga,
 * agentes de IA deixavam de atender. Aqui a lista vem ANTES do clique, com
 * nome — e, numa conexão por QR Code, o lembrete de que trocar o CHIP é
 * "Reparear" (a conexão fica, e nada disto quebra).
 *
 * ⚠️ O estado é CARIMBADO com a conexão e a tentativa que o produziram: o
 * diálogo troca de conexão sem desmontar, e o primeiro render depois da troca
 * ainda teria a lista da anterior (efeito passivo, CLAUDE.md 8c). Falha não
 * vira "nada depende": diz que não deu para conferir, com "Tentar de novo".
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { DependenciasDaConexao, ItemDependente } from '@/lib/cb-channels/dependencias';
import { ehEvolution, ehMeta } from '@/lib/cb-channels/transporte';

/** Nomes por linha; o resto vira "e mais N". */
const NOMES_POR_LINHA = 6;

type Lido = { de: string; tentativa: number; deps: DependenciasDaConexao | null };

export function ListaDeDependencias({ canal }: { canal: { id: string; kind: string } }) {
  const t = useTranslations('Settings.channels.dependencias');
  const [tentativa, setTentativa] = useState(0);
  const [lido, setLido] = useState<Lido | null>(null);

  useEffect(() => {
    let vivo = true;
    const carimbo = { de: canal.id, tentativa };
    (async () => {
      try {
        const res = await fetch(`/api/cb/channels/${canal.id}/dependencias`, { cache: 'no-store' });
        if (!vivo) return;
        if (!res.ok) {
          setLido({ ...carimbo, deps: null });
          return;
        }
        const deps = (await res.json()) as DependenciasDaConexao;
        if (vivo) setLido({ ...carimbo, deps });
      } catch {
        if (vivo) setLido({ ...carimbo, deps: null });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [canal.id, tentativa]);

  const atual = lido && lido.de === canal.id && lido.tentativa === tentativa ? lido : null;

  // "(já desligada)" para automação; "(já desligado)" para robô e agente.
  const nomes = (itens: ItemDependente[], masculino = false) => {
    const mostrados = itens
      .slice(0, NOMES_POR_LINHA)
      .map((i) =>
        i.ativo ? i.nome : masculino ? t('desligado', { nome: i.nome }) : t('desligada', { nome: i.nome }),
      );
    const resto = itens.length - mostrados.length;
    return resto > 0 ? `${mostrados.join(', ')} ${t('eMais', { n: resto })}` : mostrados.join(', ');
  };

  const linhas: { chave: string; texto: string; nomes?: string; grave?: boolean }[] = [];
  const deps = atual?.deps;
  if (deps) {
    if (deps.agendadasNaFila > 0)
      linhas.push({ chave: 'agendadas', texto: t('agendadas', { n: deps.agendadasNaFila }), grave: true });
    if (deps.automacoesDesligadas.length > 0)
      linhas.push({
        chave: 'desligadas',
        texto: t('automacoesDesligadas', { n: deps.automacoesDesligadas.length }),
        nomes: nomes(deps.automacoesDesligadas),
      });
    if (deps.automacoesComPasso.length > 0)
      linhas.push({
        chave: 'passo',
        texto: t('automacoesComPasso', { n: deps.automacoesComPasso.length }),
        nomes: nomes(deps.automacoesComPasso),
      });
    if (deps.automacoesPerdemONumero.length > 0)
      linhas.push({
        chave: 'perdem',
        texto: t('automacoesPerdemONumero', { n: deps.automacoesPerdemONumero.length }),
        nomes: nomes(deps.automacoesPerdemONumero),
      });
    if (deps.robosDesligados.length > 0)
      linhas.push({
        chave: 'robos',
        texto: t('robosDesligados', { n: deps.robosDesligados.length }),
        nomes: nomes(deps.robosDesligados, true),
      });
    if (deps.robosComPasso.length > 0)
      linhas.push({
        chave: 'robosPasso',
        texto: t('robosComPasso', { n: deps.robosComPasso.length }),
        nomes: nomes(deps.robosComPasso, true),
      });
    if (deps.agentes.length > 0)
      linhas.push({ chave: 'agentes', texto: t('agentes', { n: deps.agentes.length }), nomes: nomes(deps.agentes, true) });
    if (deps.esperas > 0) linhas.push({ chave: 'esperas', texto: t('esperas', { n: deps.esperas }) });
    if (deps.filtrosSalvos > 0) linhas.push({ chave: 'filtros', texto: t('filtros', { n: deps.filtrosSalvos }) });
    if (deps.conversas > 0)
      linhas.push({
        chave: 'conversas',
        texto: t('conversas', { n: deps.conversas, fixadas: deps.conversasFixadas }),
      });
    if (deps.grupos > 0) linhas.push({ chave: 'grupos', texto: t('grupos', { n: deps.grupos }) });
    if (deps.modelos > 0) linhas.push({ chave: 'modelos', texto: t('modelos', { n: deps.modelos }) });
  }

  return (
    <div className="space-y-2">
      {/* Trocar o chip NÃO é remover (decisão do operador, 03/10/2026). Na
          Meta não há QR: número novo é conexão nova, e a lista abaixo é o que
          precisa ser refeito nela. */}
      {ehEvolution(canal) && (
        <p className="rounded-md border border-primary/40 bg-primary/5 p-2 text-xs text-foreground">
          {t('trocarChip')}
        </p>
      )}
      {ehMeta(canal) && (
        <p className="rounded-md border border-primary/40 bg-primary/5 p-2 text-xs text-foreground">
          {t('trocarNumeroMeta')}
        </p>
      )}

      {!atual ? (
        <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{t('carregando')}</p>
      ) : !deps ? (
        <p className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">
          {t('falhou')}{' '}
          <button
            type="button"
            onClick={() => setTentativa((n) => n + 1)}
            className="font-medium text-foreground underline underline-offset-2"
          >
            {t('tentarDeNovo')}
          </button>
        </p>
      ) : linhas.length === 0 ? (
        <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{t('nada')}</p>
      ) : (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          <p className="mb-1 font-medium text-foreground">{t('titulo')}</p>
          <ul className="space-y-1.5">
            {linhas.map((l) => (
              <li key={l.chave} className={l.grave ? 'text-destructive' : 'text-muted-foreground'}>
                <span className={l.grave ? undefined : 'text-foreground'}>{l.texto}</span>
                {l.nomes && <span className="block break-words">{l.nomes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
