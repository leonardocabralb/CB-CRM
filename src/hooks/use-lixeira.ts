'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  fatiar,
  lerArquivosParados,
  lerExclusaoDefinitiva,
  lerItem,
  lerMover,
  lerPrevia,
  lerVolta,
  motivoDoErro,
  type FichaMovida,
  type ItemDaLixeira,
  type ItemDaVolta,
  type ItemExcluido,
  type MotivoDaLixeira,
  type PreviaDaFicha,
} from '@/lib/contacts/lixeira';
import { createClient } from '@/lib/supabase/client';

// ============================================================
// A Lixeira de contatos (1097) vista pelo navegador: as chamadas às RPCs e
// as leituras com carimbo. A receita (o que vai, o que volta, quem pode)
// mora nas funções do banco, que conferem admin e suspensão por dentro; a
// leitura do que elas devolvem mora em `src/lib/contacts/lixeira.ts`.
//
// ⚠️ O supabase-js DEVOLVE `error`, não lança — toda chamada confere. E
// nenhuma função daqui lança: a tela recebe um motivo e o traduz.
// ============================================================

// ── Mover ────────────────────────────────────────────────────────────────

export interface ResultadoDoMoverNaTela {
  /** O lote do "Desfazer" (B5), gerado AQUI antes da primeira fatia. */
  loteId: string;
  /** Uma entrada por ficha PEDIDA, sempre. */
  fichas: FichaMovida[];
}

/**
 * Move as fichas para a Lixeira, em fatias de `FICHAS_POR_CHAMADA` (o teto
 * de 8 s do navegador), TODAS no MESMO lote, gerado AQUI antes da primeira
 * fatia e passado em todas. O "Desfazer" restaura o lote inteiro.
 *
 * ⚠️ O lote não se aprende da primeira resposta (Codex, #429): se ela se
 * perde depois de a fatia gravar, as seguintes iriam sem `p_lote`, a ação
 * se partiria em dois lotes e o "Desfazer" deixaria a primeira fatia na
 * Lixeira.
 *
 * ⚠️ Erro da chamada INTEIRA vira `recusada` para as fichas daquela fatia,
 * com o motivo (a transação do banco é uma só: nada da fatia saiu — salvo
 * rede caída depois da gravação, e por isso o texto de `falhou` manda
 * conferir a lista). Ficha que a resposta não cita também é `recusada`
 * (`falhou`): a tela nunca afirma o que não leu, e a recarga da lista mostra
 * a verdade.
 */
export async function moverParaLixeira(ids: readonly string[]): Promise<ResultadoDoMoverNaTela> {
  const supabase = createClient();
  const loteId = crypto.randomUUID();
  const fichas: FichaMovida[] = [];

  for (const fatia of fatiar(ids)) {
    const recusar = (motivo: MotivoDaLixeira, quais: readonly string[] = fatia) => {
      for (const id of quais) fichas.push({ id, resultado: 'recusada', motivo });
    };
    try {
      const { data, error } = await supabase.rpc(
        'cb_mover_contatos_para_lixeira',
        { p_ids: fatia, p_lote: loteId },
      );
      if (error) {
        console.error('[lixeira] mover foi recusado:', error.message);
        recusar(motivoDoErro(error));
        continue;
      }
      const resposta = lerMover(data);
      if (!resposta) {
        console.error('[lixeira] mover voltou numa forma inesperada');
        recusar('falhou');
        continue;
      }
      const pedidas = new Set(fatia);
      const vistas = new Set<string>();
      for (const f of resposta.fichas) {
        if (!pedidas.has(f.id) || vistas.has(f.id)) continue;
        vistas.add(f.id);
        fichas.push(f);
      }
      recusar(
        'falhou',
        fatia.filter((id) => !vistas.has(id)),
      );
    } catch (err) {
      console.error('[lixeira] mover estourou:', err);
      recusar('falhou');
    }
  }
  return { loteId, fichas };
}

// ── A prévia ─────────────────────────────────────────────────────────────

export interface EstadoDaPreviaDaLixeira {
  previa: PreviaDaFicha[] | null;
  carregando: boolean;
  /** Por que a prévia não veio. NULO enquanto carrega ou quando veio. */
  falha: MotivoDaLixeira | null;
  tentarDeNovo: () => void;
}

/**
 * A prévia do mover (`cb_previa_da_lixeira`, só leitura, só admin): o que a
 * exclusão cancela de COLEGAS.
 *
 * ⚠️ Carimbada com as fichas e a tentativa (`{ de }`) e `carregando`
 * DERIVADO (seção 8c): no primeiro render de uma seleção nova, o estado
 * ainda é o da anterior — e "nada a cancelar" de outra ficha é afirmação
 * falsa sobre esta.
 */
export function usePreviaDaLixeira(ids: readonly string[] | null): EstadoDaPreviaDaLixeira {
  const chave = ids && ids.length > 0 ? [...new Set(ids)].sort().join(',') : null;
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<{
    de: string | null;
    previa: PreviaDaFicha[] | null;
    falha: MotivoDaLixeira | null;
  }>({ de: null, previa: null, falha: null });

  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    const de = `${chave}#${tentativa}`;
    void (async () => {
      try {
        const { data, error } = await createClient().rpc('cb_previa_da_lixeira', {
          p_ids: chave.split(','),
        });
        if (!vivo) return;
        if (error) {
          console.error('[lixeira] a prévia falhou:', error.message);
          setEstado({ de, previa: null, falha: motivoDoErro(error) });
          return;
        }
        const previa = lerPrevia(data);
        setEstado({ de, previa, falha: previa ? null : 'falhou' });
      } catch (err) {
        console.error('[lixeira] a prévia estourou:', err);
        if (vivo) setEstado({ de, previa: null, falha: 'falhou' });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [chave, tentativa]);

  const deAgora = chave ? `${chave}#${tentativa}` : null;
  const atual = deAgora !== null && estado.de === deAgora;
  const tentarDeNovo = useCallback(() => setTentativa((n) => n + 1), []);
  return {
    previa: atual ? estado.previa : null,
    carregando: deAgora !== null && !atual,
    falha: atual ? estado.falha : null,
    tentarDeNovo,
  };
}

// ── Restaurar e excluir de vez ───────────────────────────────────────────

export type RespostaDaVolta =
  | { ok: true; itens: ItemDaVolta[] }
  | { ok: false; motivo: MotivoDaLixeira };

/**
 * Restaura itens escolhidos OU um lote inteiro (o "Desfazer" do toast e o
 * "Restaurar o lote" da Lixeira chamam a MESMA função do banco, B5).
 * Resposta sem a forma esperada é `falhou`: o texto manda conferir a lista,
 * que a tela recarrega.
 */
export async function restaurar(
  alvo: { itens: readonly string[] } | { lote: string },
): Promise<RespostaDaVolta> {
  try {
    const { data, error } = await createClient().rpc(
      'cb_restaurar_da_lixeira',
      'lote' in alvo ? { p_lote: alvo.lote } : { p_itens: [...alvo.itens] },
    );
    if (error) {
      console.error('[lixeira] restaurar foi recusado:', error.message);
      return { ok: false, motivo: motivoDoErro(error) };
    }
    const itens = lerVolta(data);
    if (!itens) {
      console.error('[lixeira] restaurar voltou numa forma inesperada');
      return { ok: false, motivo: 'falhou' };
    }
    return { ok: true, itens };
  } catch (err) {
    console.error('[lixeira] restaurar estourou:', err);
    return { ok: false, motivo: 'falhou' };
  }
}

export type RespostaDaExclusaoDefinitiva =
  | { ok: true; itens: ItemExcluido[] }
  | { ok: false; motivo: MotivoDaLixeira };

/**
 * "Excluir agora" (B3): tira os itens da Lixeira de vez e põe os arquivos na
 * fila. `pedido` = é pedido de exclusão do titular (LGPD): a função do banco
 * apaga também o que ficou fora da ficha (eventos, ligações, retidas, o nome
 * na trilha).
 */
export async function excluirDeVez(
  itens: readonly string[],
  pedido: boolean,
): Promise<RespostaDaExclusaoDefinitiva> {
  try {
    const { data, error } = await createClient().rpc('cb_excluir_da_lixeira', {
      p_itens: [...itens],
      p_pedido_exclusao: pedido,
    });
    if (error) {
      console.error('[lixeira] excluir de vez foi recusado:', error.message);
      return { ok: false, motivo: motivoDoErro(error) };
    }
    const lidos = lerExclusaoDefinitiva(data);
    if (!lidos) {
      console.error('[lixeira] excluir de vez voltou numa forma inesperada');
      return { ok: false, motivo: 'falhou' };
    }
    return { ok: true, itens: lidos };
  } catch (err) {
    console.error('[lixeira] excluir de vez estourou:', err);
    return { ok: false, motivo: 'falhou' };
  }
}

// ── A lista ──────────────────────────────────────────────────────────────

/** O PostgREST corta em 1000 linhas sem avisar (seção 8b): a lista lê até
 *  aqui e, chegando nele, diz "as N mais recentes" — nunca um total. */
export const LIMITE_DA_LISTA = 1000;

export interface EstadoDaLixeira {
  /** NULO enquanto a primeira leitura desta busca não voltou, ou se falhou. */
  itens: ItemDaLixeira[] | null;
  carregando: boolean;
  /** A leitura falhou. Com `itens` na tela, é a RECARGA que falhou: a lista
   *  fica, e a tela avisa que pode estar velha. */
  falhou: boolean;
  /** Chegou ao `LIMITE_DA_LISTA`: há (ou pode haver) mais fichas. */
  truncada: boolean;
  recarregar: () => void;
}

/**
 * As fichas na Lixeira (`cb_lixeira_da_conta`, só admin; nunca a
 * fotografia). `busca` vai ao banco como TEXTO (`p_busca`, comparado por
 * `position()`, sem curinga).
 *
 * ⚠️ Carimbada com a BUSCA, e só com ela: `recarregar` (depois de restaurar
 * ou excluir) relê com a lista na tela, sem trocá-la pelo "carregando".
 * Busca nova é outra pergunta — essa sim carrega do zero.
 */
export function useItensDaLixeira(busca: string): EstadoDaLixeira {
  const termo = busca.trim();
  const [versao, setVersao] = useState(0);
  const [estado, setEstado] = useState<{
    de: string | null;
    itens: ItemDaLixeira[] | null;
    falhou: boolean;
    truncada: boolean;
  }>({ de: null, itens: null, falhou: false, truncada: false });

  useEffect(() => {
    let vivo = true;
    void (async () => {
      let lidos: { itens: ItemDaLixeira[]; truncada: boolean } | null = null;
      try {
        const { data, error } = await createClient()
          .rpc('cb_lixeira_da_conta', { p_busca: termo === '' ? null : termo })
          .range(0, LIMITE_DA_LISTA - 1);
        if (error) {
          console.error('[lixeira] a lista falhou:', error.message);
        } else if (Array.isArray(data)) {
          lidos = {
            itens: data.flatMap((linha) => {
              const item = lerItem(linha);
              return item ? [item] : [];
            }),
            truncada: data.length >= LIMITE_DA_LISTA,
          };
        } else {
          console.error('[lixeira] a lista voltou numa forma inesperada');
        }
      } catch (err) {
        console.error('[lixeira] a lista estourou:', err);
      }
      if (!vivo) return;
      if (lidos) {
        setEstado({ de: termo, itens: lidos.itens, falhou: false, truncada: lidos.truncada });
      } else {
        // A recarga que falha mantém a lista desta busca (com o aviso);
        // a primeira leitura que falha não tem o que manter.
        setEstado((antes) =>
          antes.de === termo
            ? { ...antes, falhou: true }
            : { de: termo, itens: null, falhou: true, truncada: false },
        );
      }
    })();
    return () => {
      vivo = false;
    };
  }, [termo, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const atual = estado.de === termo;
  return {
    itens: atual ? estado.itens : null,
    carregando: !atual,
    falhou: atual && estado.falhou,
    truncada: atual && estado.truncada,
    recarregar,
  };
}

/**
 * Os arquivos que a fila não conseguiu apagar (`cb_arquivos_da_lixeira_parados`,
 * só admin). NULO = não sei (carregando ou falhou): a tela só avisa com
 * número lido, e nunca afirma "nada parado".
 */
export function useArquivosParados(): { naFila: number; parados: number } | null {
  const [estado, setEstado] = useState<{ naFila: number; parados: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const { data, error } = await createClient().rpc('cb_arquivos_da_lixeira_parados');
        if (error) {
          console.error('[lixeira] a fila de arquivos falhou:', error.message);
          return;
        }
        if (vivo) setEstado(lerArquivosParados(data));
      } catch (err) {
        console.error('[lixeira] a fila de arquivos estourou:', err);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  return estado;
}
