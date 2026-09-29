'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  descricaoParaGravar,
  desfechoDoErro,
  montarRelacionados,
  outroLado,
  type ContatoDoVinculo,
  type DesfechoDaEscrita,
  type Relacionado,
  type VinculoGravado,
} from '@/lib/contacts/relacionados';

const COLUNAS_DO_VINCULO = 'id, contact_a_id, contact_b_id, descricao';
/** Só o que a linha desenha — nunca `select('*')`, que traz a ficha inteira. */
const COLUNAS_DA_FICHA = 'id, name, phone, wa_username, instagram_username';

export interface EstadoDosRelacionados {
  /** NULO = ainda não se sabe (carregando ou falhou). Nunca vira "nenhum". */
  itens: Relacionado[] | null;
  carregando: boolean;
  falhou: boolean;
  recarregar: () => void;
  vincular: (outroContatoId: string, descricao: string) => Promise<DesfechoDaEscrita>;
  editarDescricao: (vinculoId: string, descricao: string) => Promise<DesfechoDaEscrita>;
  desvincular: (vinculoId: string) => Promise<DesfechoDaEscrita>;
}

type Cliente = ReturnType<typeof createClient>;

/** Vínculos → fichas + conversas da outra ponta. NULO = alguma leitura falhou. */
async function lerRelacionados(supabase: Cliente, contatoId: string): Promise<Relacionado[] | null> {
  const { data: vinculos, error } = await supabase
    .from('cb_contatos_relacionados')
    .select(COLUNAS_DO_VINCULO)
    // O vínculo vale para os dois lados: o contato pode estar em qualquer coluna.
    .or(`contact_a_id.eq.${contatoId},contact_b_id.eq.${contatoId}`)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error || !vinculos) return null;

  const lidos = vinculos as VinculoGravado[];
  const outros = [...new Set(lidos.map((v) => outroLado(v, contatoId)))];
  if (outros.length === 0) return [];

  const [fichas, conversas] = await Promise.all([
    supabase.from('contacts').select(COLUNAS_DA_FICHA).in('id', outros),
    supabase.from('conversations').select('id, contact_id').in('contact_id', outros),
  ]);
  if (fichas.error || conversas.error) return null;

  return montarRelacionados(
    contatoId,
    lidos,
    (fichas.data ?? []) as ContatoDoVinculo[],
    (conversas.data ?? []) as { id: string; contact_id: string | null }[],
  );
}

/**
 * UPDATE/DELETE que voltou com ZERO linhas: a RLS barrou ou o vínculo já não
 * existe? O motivo se MEDE (a linha ainda está lá?), nunca se infere do papel
 * em cache — um atendente rebaixado com a tela aberta ainda "pode" em memória.
 */
async function motivoDeZeroLinhas(supabase: Cliente, vinculoId: string): Promise<DesfechoDaEscrita> {
  const { data, error } = await supabase
    .from('cb_contatos_relacionados')
    .select('id')
    .eq('id', vinculoId)
    .maybeSingle();
  if (error) return 'falhou';
  return data ? 'recusado' : 'sumiu';
}

/**
 * Os contatos relacionados de UMA ficha (1069) — a aba "Relacionados" do
 * painel da conversa e da ficha de /contatos.
 *
 * ⚠️ Guarda `{ de, itens }` e DERIVA `carregando` de `de !== contactId`: o
 * painel da conversa não remonta ao trocar de cliente, então existe um render
 * com o contato NOVO e a lista do ANTERIOR — e o clique numa linha abriria a
 * conversa errada. É a guarda de `useCobrancasDoContato`.
 */
export function useContatosRelacionados(
  contactId: string | null | undefined,
  /** O token de resync da página do inbox (voltar à aba, reconexão). */
  resyncToken: number = 0,
): EstadoDosRelacionados {
  const { accountId } = useAuth();
  const [estado, setEstado] = useState<{ de: string | null; itens: Relacionado[] | null }>({
    de: null,
    itens: null,
  });
  const [nonce, setNonce] = useState(0);
  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void lerRelacionados(createClient(), contactId).then((itens) => {
      if (vivo) setEstado({ de: contactId, itens });
    });
    return () => {
      vivo = false;
    };
  }, [contactId, nonce, resyncToken]);

  const vincular = useCallback(
    async (outroContatoId: string, descricao: string): Promise<DesfechoDaEscrita> => {
      // Falha FECHADA: sem a conta não há como gravar a linha certa.
      if (!contactId || !accountId) return 'falhou';
      if (outroContatoId === contactId) return 'invalido';
      const { error } = await createClient()
        .from('cb_contatos_relacionados')
        .insert({
          account_id: accountId,
          contact_a_id: contactId,
          contact_b_id: outroContatoId,
          descricao: descricaoParaGravar(descricao),
        });
      // INSERT barrado pela RLS ESTOURA (42501), ao contrário de UPDATE/DELETE.
      if (error) return desfechoDoErro(error);
      recarregar();
      return 'ok';
    },
    [contactId, accountId, recarregar],
  );

  const editarDescricao = useCallback(
    async (vinculoId: string, descricao: string): Promise<DesfechoDaEscrita> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('cb_contatos_relacionados')
        .update({ descricao: descricaoParaGravar(descricao) })
        .eq('id', vinculoId)
        .select('id');
      if (error) return desfechoDoErro(error);
      // RLS que barra UPDATE devolve 0 linhas com `error: null`.
      const desfecho = (data ?? []).length > 0 ? 'ok' : await motivoDeZeroLinhas(supabase, vinculoId);
      recarregar();
      return desfecho;
    },
    [recarregar],
  );

  const desvincular = useCallback(
    async (vinculoId: string): Promise<DesfechoDaEscrita> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('cb_contatos_relacionados')
        .delete()
        .eq('id', vinculoId)
        .select('id');
      if (error) return desfechoDoErro(error);
      const desfecho = (data ?? []).length > 0 ? 'ok' : await motivoDeZeroLinhas(supabase, vinculoId);
      recarregar();
      return desfecho;
    },
    [recarregar],
  );

  const doContatoAtual = !!contactId && estado.de === contactId;
  return {
    itens: doContatoAtual ? estado.itens : null,
    carregando: !!contactId && !doContatoAtual,
    falhou: doContatoAtual && estado.itens === null,
    recarregar,
    vincular,
    editarDescricao,
    desvincular,
  };
}
