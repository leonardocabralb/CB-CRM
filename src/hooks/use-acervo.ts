'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { MediaLibraryItem } from '@/types';

/**
 * O acervo de mídias da conta (migration 953).
 *
 * ⚠️ LÊ DIRETO sob RLS, como a ficha de tarefas: a policy de SELECT é
 * `is_account_member`, e leitura não precisa de rota. ESCREVER, sim — não há
 * policy de INSERT/UPDATE/DELETE e o privilégio foi revogado, então um
 * `.from('cb_media_library').update()` do navegador leva 42501. Toda escrita
 * passa por `/api/cb/acervo`.
 *
 * Ordena por categoria e título no BANCO para as duas telas (Configurações e
 * o seletor do compositor) mostrarem a mesma ordem — ordenar em cada uma
 * abriria a porta para divergirem.
 *
 * ⚠️ `nullsFirst: false` na categoria: item sem categoria é o "Geral", e ele
 * pertence ao FIM da lista. Em ASC o Postgres põe NULL por último por padrão,
 * mas escrever é o que impede uma troca futura para DESC de empurrar o Geral
 * para o topo em silêncio.
 */
export function useAcervo(ativo = true) {
  const [itens, setItens] = useState<MediaLibraryItem[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  /**
   * ⚠️ Existe porque `carregando` nasce FALSO e o efeito que busca é PASSIVO:
   * no primeiro render a tela teria lista vazia sem estar carregando, e
   * mostraria "o acervo está vazio" — uma frase errada — antes de qualquer
   * consulta sair. Com o seletor do compositor é pior: ele abre e fecha, e o
   * operador leria "vazio" toda vez que abrisse. É a mesma armadilha de efeito
   * passivo que a faixa da nota fixada teve (PR #64).
   */
  const [jaCarregou, setJaCarregou] = useState(false);

  const buscar = useCallback(async (vivo?: () => boolean) => {
    const valeAinda = () => (vivo ? vivo() : true);
    setCarregando(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('cb_media_library')
      .select('*')
      .order('categoria', { ascending: true, nullsFirst: false })
      .order('titulo', { ascending: true })
      // Teto de segurança, da mesma família dos outros do projeto (924/929):
      // o acervo de um escritório é dezenas de arquivos, não milhares. Se um
      // dia passar disto, a lista fica INCOMPLETA com cara de completa — quem
      // paginar revisa o filtro junto, que hoje roda todo no cliente.
      .limit(500);

    if (!valeAinda()) return;

    if (error) {
      console.warn('[acervo] falha ao carregar:', error.message);
      setFalhou(true);
      setItens([]);
    } else {
      setFalhou(false);
      setItens((data ?? []) as MediaLibraryItem[]);
    }
    setCarregando(false);
    setJaCarregou(true);
  }, []);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar(() => vivo);
    return () => {
      vivo = false;
    };
  }, [ativo, buscar]);

  return { itens, carregando, jaCarregou, falhou, recarregar: buscar };
}
