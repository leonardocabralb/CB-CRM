// ============================================================
// A COR de cada conexão — a peça que faz "por qual número?" ser respondida
// pelo olho, sem leitura.
//
// Por que derivada e não configurável: com 2–4 conexões, escolher a cor é
// uma tela de configuração, uma coluna, uma entrada no
// `CB_CHANNEL_SAFE_COLUMNS` e um valor a validar — para um ganho que a
// derivação já entrega. Se um dia o operador quiser MANDAR na cor, o lugar
// é uma coluna `cor` em `cb_channels` com queda para esta paleta.
//
// ⚠️ A ordem é a de `created_at`, calculada AQUI — nunca a do array que
// chega. `listChannels` ordena `is_default DESC, created_at ASC`, então
// marcar outra conexão como padrão REORDENA a lista: sem o sort próprio,
// trocar o padrão repintaria todas as conversas do escritório de uma vez.
//
// Consequência aceita: apagar uma conexão recolore as criadas DEPOIS dela.
// É evento raro e já ruidoso por conta própria (apagar canal anula o
// `channel_id` das mensagens e some com as análises do Radar daquele
// número). Canal NOVO entra no fim e não mexe em ninguém, que é o caso
// comum.
// ============================================================

import type { CbChannel } from './repo';

export interface CorDeCanal {
  /**
   * A bolinha. É onde a cor vive em quase toda parte — gatilho do seletor,
   * itens do menu, linha da lista e o rótulo embaixo da mensagem —, porque
   * uma bolinha se sustenta sobre qualquer fundo, inclusive o `bg-primary`
   * da bolha da equipe.
   */
  ponto: string;
  /**
   * O nome do canal escrito na cor dele. Só onde o fundo é neutro: hoje o
   * separador de trecho do fio.
   */
  texto: string;
}

/**
 * As cores, na ordem em que são distribuídas.
 *
 * ⚠️ Classes LITERAIS, nunca interpoladas (`border-${cor}-500`): o Tailwind
 * varre o fonte em busca de strings de classe e não executa código — uma
 * classe montada em runtime simplesmente não é gerada, e a bolinha nasce
 * transparente sem erro nenhum.
 *
 * Fora da paleta: verde e vermelho, que já carregam significado de estado
 * neste projeto (`CHANNEL_STATUS_DOT` pinta conectado/desconectado, e a
 * bolha não entregue é `destructive`). Um canal "vermelho" seria lido como
 * canal com problema.
 */
export const PALETA_DE_CANAIS: readonly CorDeCanal[] = [
  { ponto: 'bg-violet-500', texto: 'text-violet-600 dark:text-violet-400' },
  { ponto: 'bg-teal-500', texto: 'text-teal-600 dark:text-teal-400' },
  { ponto: 'bg-amber-500', texto: 'text-amber-600 dark:text-amber-400' },
  { ponto: 'bg-sky-500', texto: 'text-sky-600 dark:text-sky-400' },
  { ponto: 'bg-fuchsia-500', texto: 'text-fuchsia-600 dark:text-fuchsia-400' },
  { ponto: 'bg-orange-500', texto: 'text-orange-600 dark:text-orange-400' },
];

/**
 * Canal → cor, por ordem de criação.
 *
 * Acima de `PALETA_DE_CANAIS.length` conexões as cores repetem. Preferível a
 * inventar tons: duas conexões da mesma cor ainda têm nome escrito ao lado
 * em todo lugar onde a cor aparece, e a conta real tem duas.
 */
export function coresPorCanal(channels: CbChannel[]): Map<string, CorDeCanal> {
  const porCriacao = [...channels].sort((a, b) => {
    // `created_at` empatado é possível (semeadura, importação): o id
    // desempata para a ordem não depender do que o Postgres devolveu.
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? -1 : 1;
    }
    return a.id < b.id ? -1 : 1;
  });

  const mapa = new Map<string, CorDeCanal>();
  porCriacao.forEach((canal, i) => {
    mapa.set(canal.id, PALETA_DE_CANAIS[i % PALETA_DE_CANAIS.length]);
  });
  return mapa;
}

/**
 * A cor de UM canal, ou `null` quando o id não resolve — canal apagado, ou
 * lista ainda carregando. Quem chama não desenha bolinha nenhuma nesse caso:
 * uma cor de queda afirmaria um canal que ninguém sabe qual é.
 */
export function corDoCanal(
  cores: Map<string, CorDeCanal>,
  id: string | null | undefined,
): CorDeCanal | null {
  if (!id) return null;
  return cores.get(id) ?? null;
}
