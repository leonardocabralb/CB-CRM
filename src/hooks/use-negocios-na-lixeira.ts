'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  NEGOCIOS_POR_CHAMADA,
  fatiar,
  lerNegociosNaLixeira,
} from '@/lib/contacts/lixeira';
import { createClient } from '@/lib/supabase/client';

/**
 * Os negócios cuja ficha está na Lixeira (B4, 1097): negócio → o nome da
 * ficha (nulo quando ela não tinha nome nem telefone). Mover a ficha deixa o
 * negócio no funil SEM contato (`deals.contact_id` nulo, como apagar), e sem
 * isto o card aparecia em branco, "Sem contato", sem dizer que a pessoa pode
 * voltar — e voltando, o negócio volta a apontar para ela.
 *
 * `ids`: SÓ os negócios com `contact_id` nulo (quem chama recorta). Sem
 * nenhum, nada é perguntado. A função (`cb_negocios_na_lixeira`) é de
 * qualquer membro e devolve só o nome, nunca a fotografia.
 *
 * ⚠️ Cada resposta vale para os negócios que ELA perguntou: o mapa devolvido
 * é recortado pelos `ids` do render atual, então a resposta de um conjunto
 * anterior nunca marca o card de outro (o formulário que troca de negócio, o
 * quadro que troca de funil — seção 8c). Enquanto a resposta do conjunto
 * novo não chega, o que já se sabia dos negócios que continuam nele fica na
 * tela (sem o card piscar a cada "mostrar mais").
 *
 * ⚠️ Leitura que FALHA não grava nada: o card fica como hoje, sem a marca —
 * nunca "não está na Lixeira" afirmado sobre dado que não veio, nem a marca
 * de outra leitura apagada por um soluço de rede.
 *
 * Foto da carga, como o resto do quadro (sem tempo real, `funil.md`), mas
 * RELIDA a cada leitura do quadro (`versao`): a ficha excluída de vez (outro
 * admin, ou o vencimento) deixa o negócio com o MESMO `contact_id` nulo, o
 * conjunto não muda, e só pela chave a marca ficava no card até desmontar
 * o quadro (Codex, #429). A restaurada volta com contato e sai do conjunto.
 */
export function useNegociosNaLixeira(
  ids: readonly string[],
  /** Muda a cada leitura dos negócios (a lista nova do quadro): pergunta de
   *  novo mesmo com o mesmo conjunto. */
  versao?: unknown,
): ReadonlyMap<string, string | null> {
  // Texto ordenado e sem repetição: a lista nova a cada render do quadro não
  // refaz a pergunta, só um CONJUNTO novo.
  const chave = [...new Set(ids)].sort().join(',');
  const [naLixeira, setNaLixeira] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    void (async () => {
      try {
        const supabase = createClient();
        // Uma linha por negócio pedido, no máximo: em fatias de 1000 a
        // resposta nunca bate no teto do PostgREST (seção 8b).
        const respostas = await Promise.all(
          fatiar(chave.split(','), NEGOCIOS_POR_CHAMADA).map((fatia) =>
            supabase.rpc('cb_negocios_na_lixeira', { p_negocios: fatia }),
          ),
        );
        if (!vivo) return;
        const erro = respostas.find((r) => r.error)?.error;
        if (erro) {
          console.error('[negocios-na-lixeira] leitura falhou:', erro.message);
          return;
        }
        const mapa = new Map<string, string | null>();
        for (const r of respostas) {
          for (const [negocio, nome] of lerNegociosNaLixeira(r.data)) mapa.set(negocio, nome);
        }
        setNaLixeira(mapa);
      } catch (err) {
        console.error('[negocios-na-lixeira] leitura estourou:', err);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [chave, versao]);

  // Recortado pelo conjunto do render ATUAL. O mapa só muda de identidade
  // quando a resposta ou o conjunto mudam: os cards são `memo`.
  return useMemo(() => {
    const saida = new Map<string, string | null>();
    if (!chave) return saida;
    for (const id of chave.split(',')) {
      if (naLixeira.has(id)) saida.set(id, naLixeira.get(id) ?? null);
    }
    return saida;
  }, [chave, naLixeira]);
}
