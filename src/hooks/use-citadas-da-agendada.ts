'use client';

// ============================================================
// As mensagens que as agendadas CITAM (932).
//
// ⚠️ POR QUE UMA BUSCA À PARTE, E NÃO UM EMBED. `reply_to_message_id` não tem
// FK — decisão da 932, com motivo escrito lá — e o PostgREST só embute por
// relacionamento declarado. Então a única forma é perguntar pelos ids.
//
// ⚠️ E POR QUE ISSO IMPORTA NA TELA: apagar mensagem neste CRM é apagar MOLE
// (905), a linha continua no banco. Sem consultar `deleted_at`, a faixa diria
// "responde a: …" sobre uma bolha que o cliente vê como "Esta mensagem foi
// apagada" — e o operador só descobriria pelo que chegou lá.
// ============================================================

import { useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

export interface Citada {
  id: string;
  content_text: string | null;
  content_type: string | null;
  deleted_at: string | null;
}

export interface Citadas {
  /**
   * Id → mensagem citada. **Id ausente quer dizer que ela não existe mais** —
   * e é por isso que `prontas` existe.
   */
  porId: Map<string, Citada>;
  /**
   * A busca DESTES ids terminou?
   *
   * ⚠️ Sem este sinalizador a tela responderia errado com cara de certo: entre
   * o render e a resposta, todo id estaria ausente do mapa e a linha avisaria
   * "a mensagem citada foi apagada" sobre citações perfeitamente vivas. É a
   * mesma regra dos filtros do inbox — dado que não carregou não pode virar
   * afirmação.
   */
  prontas: boolean;
}

const VAZIO: Citadas = { porId: new Map(), prontas: true };

/** @param ids Os `reply_to_message_id` das agendadas em tela. Pode repetir. */
export function useCitadas(ids: readonly (string | null)[]): Citadas {
  // O estado guarda a CHAVE junto com o mapa: é o que permite dizer se o que
  // está em mãos responde pelos ids de agora.
  const [estado, setEstado] = useState<{ chave: string; porId: Map<string, Citada> }>(
    { chave: '', porId: new Map() },
  );
  const vivoRef = useRef(true);
  /**
   * Contador de geração — a mesma proteção dos outros hooks deste projeto.
   *
   * ⚠️ Duas buscas podem estar no ar ao mesmo tempo (a lista muda, a aba
   * troca) e elas NÃO voltam em ordem. Sem isto, a resposta VELHA chegando
   * depois carimbaria o estado com a chave antiga: `prontas` ficaria falso
   * para a lista de agora, e como o efeito daquela chave já rodou, ninguém
   * buscaria de novo — a linha da citação sumiria da tela e não voltaria.
   */
  const geracaoRef = useRef(0);

  // Chave estável: a identidade do array muda a cada render da lista, e sem
  // isto a busca dispararia em laço.
  const chave = [...new Set(ids.filter(Boolean) as string[])].sort().join(',');

  useEffect(() => {
    vivoRef.current = true;
    const minhaGeracao = ++geracaoRef.current;
    const buscar = async () => {
      if (!chave) return;
      const supabase = createClient();
      const { data, error } = await supabase
        .from('messages')
        .select('id, content_text, content_type, deleted_at')
        .in('id', chave.split(','));
      if (!vivoRef.current || geracaoRef.current !== minhaGeracao) return;
      if (error) {
        // ⚠️ Falha NÃO vira "todas as citações sumiram": sem mudar a chave, a
        // tela segue tratando estes ids como não-carregados e não afirma nada.
        console.error('[agendadas] não deu para ler as citações:', error.message);
        return;
      }
      const porId = new Map<string, Citada>();
      for (const m of (data ?? []) as Citada[]) porId.set(m.id, m);
      setEstado({ chave, porId });
    };
    void buscar();
    return () => {
      vivoRef.current = false;
    };
  }, [chave]);

  if (!chave) return VAZIO;
  return { porId: estado.porId, prontas: estado.chave === chave };
}
