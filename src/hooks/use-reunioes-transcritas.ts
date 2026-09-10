'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { ReuniaoTranscrita } from '@/types';

/**
 * As reuniões transcritas (migration 987) — leitura DIRETA sob RLS, como
 * `use-reunioes.ts`: a 987 dá `SELECT` ao `authenticated` justamente para
 * isto; a escrita passa por `/api/cb/reunioes-transcritas` e `/api/cb/tldv`.
 *
 * ⚠️ A lista NÃO seleciona `texto`, `segmentos` nem `notas`: uma reunião de
 * uma hora dá ~80 KB, e a ficha lista dezenas. O visualizador busca a linha
 * inteira por id (`carregarReuniaoTranscrita`).
 */

export const COLUNAS_DA_LISTA =
  'id, account_id, contact_id, origem, tldv_meeting_id, titulo, realizada_em, duracao_seg, url, organizador_nome, organizador_email, participantes, status, tentativas, erro, vinculo_origem, vinculado_por, vinculado_em, created_by, autor_nome, created_at, updated_at';

export function useReunioesTranscritasDoContato(contactId: string | null | undefined) {
  // ⚠️ A lista leva o DONO junto (`de`), e `carregando` é DERIVADO dela. O
  // painel da conversa NÃO remonta ao trocar de cliente — a instância fica,
  // só a prop muda —, então entre a troca e a resposta existe um render com
  // o contato NOVO e a lista do ANTERIOR, clicável. Guardar a lista sozinha
  // e "limpar num efeito" deixa esse render passar (efeito é passivo); a
  // comparação contra a prop do render atual é a mesma guarda dos campos
  // personalizados (`{ de, mapa }`). Achado na revisão do PR #187.
  const [estado, setEstado] = useState<{ de: string | null; reunioes: ReuniaoTranscrita[]; falhou: boolean }>({
    de: null,
    reunioes: [],
    falhou: false,
  });

  const buscar = useCallback(
    async (vivo: () => boolean = () => true) => {
      if (!contactId) return;
      const supabase = createClient();
      const { data, error } = await supabase
        .from('cb_reunioes_transcritas')
        .select(COLUNAS_DA_LISTA)
        .eq('contact_id', contactId)
        .order('realizada_em', { ascending: false });
      // A ficha troca de cliente com um clique: resposta atrasada é descartada.
      if (!vivo()) return;
      setEstado({
        de: contactId,
        falhou: !!error,
        reunioes: error ? [] : ((data ?? []) as unknown as ReuniaoTranscrita[]),
      });
    },
    [contactId],
  );

  useEffect(() => {
    let vivo = true;
    // A regra do React Compiler olha a função chamada, e `buscar` grava
    // estado (depois do await). É a diretiva que o hook sempre teve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar(() => vivo);
    return () => {
      vivo = false;
    };
  }, [buscar]);

  // A lista em mãos é deste contato? Até lá a tela está carregando — a aba
  // afirma "nenhuma transcrição" a partir da lista vazia, e a lista É vazia
  // durante a carga. `recarregar` depois de uma ação mantém a lista à vista.
  const doContatoAtual = estado.de === contactId;
  return {
    reunioes: doContatoAtual ? estado.reunioes : [],
    carregando: !!contactId && !doContatoAtual,
    falhou: doContatoAtual && estado.falhou,
    recarregar: buscar,
  };
}

/** A linha inteira — com texto, frases e notas — para o visualizador. */
export async function carregarReuniaoTranscrita(id: string): Promise<ReuniaoTranscrita | null> {
  const { data, error } = await createClient().from('cb_reunioes_transcritas').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as unknown as ReuniaoTranscrita;
}

/**
 * As reuniões importadas do tl;dv que ainda não têm cliente — para o
 * diálogo "Do tl;dv" da ficha. Busca por nome no banco (ilike), até 30.
 */
export async function buscarReunioesSemCliente(busca: string): Promise<{ reunioes: ReuniaoTranscrita[]; falhou: boolean }> {
  let consulta = createClient()
    .from('cb_reunioes_transcritas')
    .select(COLUNAS_DA_LISTA)
    .eq('origem', 'tldv')
    .is('contact_id', null)
    .order('realizada_em', { ascending: false })
    .limit(30);
  const termo = busca.trim();
  if (termo.length > 0) {
    // Escape do LIKE (\ % _) e das aspas do PostgREST, nesta ordem — a mesma
    // dupla do seletor de cliente da agenda.
    const like = termo.replace(/[\\%_]/g, (c) => `\\${c}`);
    consulta = consulta.ilike('titulo', `%${like}%`);
  }
  const { data, error } = await consulta;
  return { reunioes: error ? [] : ((data ?? []) as unknown as ReuniaoTranscrita[]), falhou: !!error };
}
