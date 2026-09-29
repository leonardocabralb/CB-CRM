'use client';

// ============================================================
// As conexões do Meu dia (v2, pedido do operador em 29/09/2026): no lugar da
// LISTA de clientes esperando, um indicador por conexão que a pessoa
// enxerga — quantos clientes estão com mensagem não lida e quantos esperam
// resposta em atraso. Cada número abre a caixa de entrada JÁ filtrada por
// aquela conexão e por aquele recorte (`?conexao=&ver=`).
//
// ⚠️ Os números são do ESCRITÓRIO (pastilha `De`), não da pessoa: a não lida
// é da conta inteira (quem abre zera para todos), e a espera é do cliente,
// não de um atendente. A régua é a da caixa de entrada (`contarPorConexao`).
//
// ⚠️ A lista de conexões é AFIRMAÇÃO aqui ("estas são as suas conexões"):
// por isso lê `loading`/`falhou` do `useChannels` — lista vazia de uma
// leitura que falhou não é "nenhuma conexão".
// ============================================================

import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Radio } from 'lucide-react';

import type { Bloco } from '@/hooks/use-resumo-do-dia';
import type { Conexoes } from '@/hooks/use-area-de-trabalho';
import { useChannels } from '@/hooks/use-channels';
import { coresPorCanal } from '@/lib/cb-channels/cores';
import { urlDoInbox } from '@/lib/inbox/url';
import {
  contarPorConexao,
  type NumerosDaConexao,
} from '@/lib/meu-dia/conexoes';
import { canaisVisiveis } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import { cn } from '@/lib/utils';

import { De, EstadoDoBlocoDaAba } from './blocos-de-operacao';
import { Cabecalho, ForaDoPerfil } from './blocos-pessoais';

export function BlocoDeConexoes({
  bloco,
  agoraMs,
  acesso,
  veInbox,
}: {
  bloco: Bloco<Conexoes>;
  /** O instante em que as conversas foram lidas — a régua do atraso. */
  agoraMs: number;
  /** A LENTE do "Ver como": quais conexões esta tela mostra. */
  acesso: ContextoDeAcesso;
  veInbox: boolean;
}) {
  const t = useTranslations('MeuDia');
  const { channels, loading, falhou } = useChannels();

  // As do perfil, na ordem em que foram criadas (a mesma das cores): a
  // ordem da rota põe a padrão primeiro, e marcar outra como padrão
  // embaralharia a faixa.
  const visiveis = useMemo(
    () =>
      [...canaisVisiveis(acesso, channels)].sort((a, b) =>
        a.created_at === b.created_at
          ? a.id.localeCompare(b.id)
          : a.created_at < b.created_at
            ? -1
            : 1
      ),
    [acesso, channels]
  );
  const cores = useMemo(() => coresPorCanal(channels), [channels]);
  const contagem = useMemo(
    () =>
      bloco.status === 'pronto'
        ? contarPorConexao(
            bloco.dados.conversas,
            visiveis.map((c) => c.id),
            agoraMs
          )
        : null,
    [bloco, visiveis, agoraMs]
  );

  const estado: Bloco<unknown> =
    loading || bloco.status === 'carregando'
      ? { status: 'carregando' }
      : falhou || bloco.status === 'falhou'
        ? { status: 'falhou' }
        : { status: 'pronto', dados: null };

  return (
    <section className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={<Radio className="size-4" aria-hidden />}
        titulo={t('connectionsTitle')}
        direita={<De escopo="escritorio" />}
      />
      {estado.status !== 'pronto' || !contagem ? (
        <EstadoDoBlocoDaAba bloco={estado} />
      ) : visiveis.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {t('connectionsNone')}
        </p>
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
            {visiveis.map((canal) => (
              <PecaDaConexao
                key={canal.id}
                id={canal.id}
                nome={canal.label?.trim() || canal.display_phone || '—'}
                cor={cores.get(canal.id)?.ponto ?? null}
                numeros={contagem.porConexao.get(canal.id)!}
                veInbox={veInbox}
              />
            ))}
          </ul>
          {contagem.semConexao.naoLidos + contagem.semConexao.emAtraso > 0 && (
            <p className="text-muted-foreground mt-2 text-xs">
              {t('connectionsNoChannel', {
                naoLidos: contagem.semConexao.naoLidos,
                emAtraso: contagem.semConexao.emAtraso,
              })}
            </p>
          )}
          {!veInbox && <ForaDoPerfil />}
        </>
      )}
    </section>
  );
}

function PecaDaConexao({
  id,
  nome,
  cor,
  numeros,
  veInbox,
}: {
  id: string;
  nome: string;
  cor: string | null;
  numeros: NumerosDaConexao;
  veInbox: boolean;
}) {
  const t = useTranslations('MeuDia');
  return (
    <li className="border-border bg-background/40 min-w-0 rounded-lg border p-3">
      <p className="text-foreground flex min-w-0 items-center gap-1.5 text-sm font-medium">
        {cor && (
          <span
            className={cn('size-2 shrink-0 rounded-full', cor)}
            aria-hidden
          />
        )}
        <span className="truncate" title={nome}>
          {nome}
        </span>
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Numero
          valor={numeros.naoLidos}
          rotulo={t('connectionsUnread')}
          href={
            veInbox && numeros.naoLidos > 0
              ? urlDoInbox({ conexao: id, ver: 'nao-lidas' })
              : null
          }
          destaque={numeros.naoLidos > 0 ? 'primario' : null}
          titulo={t('connectionsOpenUnread', { conexao: nome })}
        />
        <Numero
          valor={numeros.emAtraso}
          rotulo={t('connectionsLate')}
          detalhe={
            numeros.criticos > 0
              ? t('connectionsCritical', { count: numeros.criticos })
              : null
          }
          href={
            veInbox && numeros.emAtraso > 0
              ? urlDoInbox({ conexao: id, ver: 'em-atraso' })
              : null
          }
          destaque={
            numeros.criticos > 0
              ? 'critico'
              : numeros.emAtraso > 0
                ? 'atraso'
                : null
          }
          titulo={t('connectionsOpenLate', { conexao: nome })}
        />
      </div>
    </li>
  );
}

/**
 * Um número do indicador. Zero não vira link: a caixa filtrada abriria vazia.
 *
 * As cores são as do selo da linha da caixa de entrada: âmbar aos 10 min,
 * vermelho aos 30 (a PRIMEIRA cor vale nos dois modos — o `dark:` do
 * projeto está inerte).
 */
function Numero({
  valor,
  rotulo,
  detalhe = null,
  href,
  destaque,
  titulo,
}: {
  valor: number;
  rotulo: string;
  detalhe?: string | null;
  href: string | null;
  destaque: 'primario' | 'atraso' | 'critico' | null;
  titulo: string;
}) {
  const conteudo = (
    <>
      <span
        className={cn(
          'block text-2xl leading-none font-semibold tabular-nums',
          destaque === 'primario' && 'text-primary',
          destaque === 'atraso' && 'text-amber-700 dark:text-amber-300',
          destaque === 'critico' && 'text-destructive',
          destaque === null && 'text-muted-foreground'
        )}
      >
        {valor}
      </span>
      <span className="text-muted-foreground mt-1 block text-xs">{rotulo}</span>
      {detalhe && (
        <span className="text-destructive block text-[11px]">{detalhe}</span>
      )}
    </>
  );
  if (!href) return <div className="min-w-0 px-1 py-0.5">{conteudo}</div>;
  return (
    <Link
      href={href}
      title={titulo}
      aria-label={`${valor} ${rotulo} — ${titulo}`}
      className="hover:bg-muted/60 min-w-0 rounded-md px-1 py-0.5"
    >
      {conteudo}
    </Link>
  );
}
