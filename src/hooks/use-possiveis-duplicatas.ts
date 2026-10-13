'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import {
  montarCandidatas,
  parOrdenado,
  type Candidata,
  type CandidataGravada,
  type FichaDaCandidata,
} from '@/lib/contacts/duplicatas';
import { avisarRelacionadosMudaram, EVENTO_RELACIONADOS } from '@/lib/contacts/aviso-de-relacionados';
import { descricaoParaGravar, desfechoDoErro, type DesfechoDaEscrita } from '@/lib/contacts/relacionados';
import { createClient } from '@/lib/supabase/client';

/** Só o que a faixa desenha da outra ficha — nunca `select('*')`. */
const COLUNAS_DA_FICHA = 'id, name, phone, wa_username, instagram_username, created_at';

type Cliente = ReturnType<typeof createClient>;

/** RPC → fichas das candidatas. NULO = alguma leitura falhou. */
async function lerCandidatas(supabase: Cliente, contatoId: string): Promise<Candidata[] | null> {
  const { data, error } = await supabase.rpc('cb_possiveis_duplicatas', { p_contato: contatoId });
  if (error || !data) {
    if (error) console.error('[possiveis-duplicatas] a RPC falhou:', error.message);
    return null;
  }
  const linhas = data as CandidataGravada[];
  const ids = linhas.map((l) => l.outro_id);
  if (ids.length === 0) return [];

  const fichas = await supabase.from('contacts').select(COLUNAS_DA_FICHA).in('id', ids);
  if (fichas.error) {
    console.error('[possiveis-duplicatas] leitura falhou:', fichas.error.message);
    return null;
  }
  return montarCandidatas(linhas, (fichas.data ?? []) as FichaDaCandidata[]);
}

export interface EstadoDasDuplicatas {
  /** NULO = ainda não se sabe (carregando ou falhou). A faixa cala — nunca afirma "sem duplicata". */
  candidatas: Candidata[] | null;
  carregando: boolean;
  recarregar: () => void;
  /**
   * "Não é duplicata" (admin, 1088): o par sai do aviso nos dois sentidos.
   *
   * ⚠️ As escritas recebem as DUAS fichas, nunca leem o contato do render:
   * o "Desfazer" do toast pode ser clicado depois de o operador já estar em
   * outra conversa, e desfaria o par errado.
   */
  descartar: (contatoId: string, outroContatoId: string) => Promise<DesfechoDaEscrita>;
  /** O "Desfazer" do toast logo depois de descartar. */
  desfazerDescarte: (contatoId: string, outroContatoId: string) => Promise<DesfechoDaEscrita>;
  /** "Pessoas diferentes, mas ligadas": o vínculo de Contatos relacionados (1069). */
  ligar: (contatoId: string, outroContatoId: string, descricao: string) => Promise<DesfechoDaEscrita>;
}

/**
 * As fichas que parecem ser a mesma pessoa DESTA (1088), conferidas na hora
 * pelo banco (`cb_possiveis_duplicatas`). A faixa "Possível duplicata" da
 * conversa e do formulário do card.
 *
 * ⚠️ Guarda `{ de, candidatas }` e DERIVA `carregando`: o fio não remonta ao
 * trocar de cliente, e a faixa do anterior apareceria na conversa do novo —
 * com um "Comparar" abrindo a ficha errada.
 */
export function usePossiveisDuplicatas(
  contactId: string | null | undefined,
  /** O token de resync da página (voltar à aba, reconexão). */
  resyncToken: number = 0,
): EstadoDasDuplicatas {
  const { accountId } = useAuth();
  const [estado, setEstado] = useState<{ de: string | null; candidatas: Candidata[] | null }>({
    de: null,
    candidatas: null,
  });
  const [nonce, setNonce] = useState(0);
  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void lerCandidatas(createClient(), contactId).then((candidatas) => {
      if (vivo) setEstado({ de: contactId, candidatas });
    });
    return () => {
      vivo = false;
    };
  }, [contactId, nonce, resyncToken]);

  // O par ligado sai do aviso, e o desvinculado volta: a aba Relacionados
  // (outra árvore) avisa quando grava, e este hook relê.
  useEffect(() => {
    window.addEventListener(EVENTO_RELACIONADOS, recarregar);
    return () => window.removeEventListener(EVENTO_RELACIONADOS, recarregar);
  }, [recarregar]);

  const descartar = useCallback(
    async (contatoId: string, outroContatoId: string): Promise<DesfechoDaEscrita> => {
      // Falha FECHADA: sem a conta não há como gravar a linha certa.
      if (!accountId) return 'falhou';
      const { error } = await createClient()
        .from('cb_duplicatas_descartadas')
        .insert({ account_id: accountId, ...parOrdenado(contatoId, outroContatoId) });
      if (error) {
        const desfecho = desfechoDoErro(error);
        // 23505: outro admin já descartou o mesmo par — o efeito é o pedido.
        if (desfecho !== 'ja-vinculados') return desfecho;
      }
      recarregar();
      return 'ok';
    },
    [accountId, recarregar],
  );

  const desfazerDescarte = useCallback(
    async (contatoId: string, outroContatoId: string): Promise<DesfechoDaEscrita> => {
      const supabase = createClient();
      const par = parOrdenado(contatoId, outroContatoId);
      const { data, error } = await supabase
        .from('cb_duplicatas_descartadas')
        .delete()
        .eq('contato_menor', par.contato_menor)
        .eq('contato_maior', par.contato_maior)
        .select('id');
      if (error) return desfechoDoErro(error);
      if ((data ?? []).length === 0) {
        // RLS que barra DELETE devolve 0 linhas com `error: null`: o motivo se
        // MEDE (a decisão ainda está lá?), nunca se infere do papel em cache.
        const { data: ainda, error: erroDaConferencia } = await supabase
          .from('cb_duplicatas_descartadas')
          .select('id')
          .eq('contato_menor', par.contato_menor)
          .eq('contato_maior', par.contato_maior)
          .maybeSingle();
        if (erroDaConferencia) return 'falhou';
        recarregar();
        // Já não existe: outro desfez — o efeito pedido está feito.
        return ainda ? 'recusado' : 'ok';
      }
      recarregar();
      return 'ok';
    },
    [recarregar],
  );

  const ligar = useCallback(
    async (contatoId: string, outroContatoId: string, descricao: string): Promise<DesfechoDaEscrita> => {
      if (!accountId) return 'falhou';
      const { error } = await createClient()
        .from('cb_contatos_relacionados')
        .insert({
          account_id: accountId,
          contact_a_id: contatoId,
          contact_b_id: outroContatoId,
          descricao: descricaoParaGravar(descricao),
        });
      // INSERT barrado pela RLS ESTOURA (42501), ao contrário de UPDATE/DELETE.
      if (error) {
        const desfecho = desfechoDoErro(error);
        if (desfecho === 'ja-vinculados') avisarRelacionadosMudaram();
        return desfecho;
      }
      // A aba Relacionados e esta faixa (inclusive esta) relêem pelo aviso.
      avisarRelacionadosMudaram();
      return 'ok';
    },
    [accountId],
  );

  const doContatoAtual = !!contactId && estado.de === contactId;
  return {
    candidatas: doContatoAtual ? estado.candidatas : null,
    carregando: !!contactId && !doContatoAtual,
    recarregar,
    descartar,
    desfazerDescarte,
    ligar,
  };
}
