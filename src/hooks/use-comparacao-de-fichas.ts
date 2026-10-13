'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Quantas mensagens de cada conversa o "Comparar" mostra (as mais recentes). */
export const MENSAGENS_NA_COMPARACAO = 6;

export interface MensagemComparada {
  id: string;
  sender_type: string;
  content_type: string | null;
  content_text: string | null;
  created_at: string;
  status: string | null;
  error_title: string | null;
  nao_saiu: boolean | null;
  deleted_at: string | null;
}

export interface CardComparado {
  id: string;
  title: string | null;
  status: string | null;
  value: number | null;
  pipeline_id: string;
  created_at: string;
  funil: string | null;
  etapa: string | null;
}

export interface FichaComparada {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  // Opcional, como em todo tipo que LÊ a identidade do WhatsApp: o pino
  // `bsuid.chamadores.test.ts` conta chave obrigatória como escritor.
  wa_username?: string | null;
  instagram_username?: string | null;
  created_at: string;
  etiquetas: { nome: string; cor: string | null }[];
  /** Só os campos PREENCHIDOS, em ordem alfabética (lista plana, sem blocos). */
  campos: { campo: string; tipo: string | null; valor: string }[];
  cards: CardComparado[];
  conversa: { id: string; channel_id: string | null } | null;
  /** As últimas da conversa, da mais antiga para a mais nova. */
  mensagens: MensagemComparada[];
}

type Cliente = ReturnType<typeof createClient>;

/**
 * As duas fichas, lidas inteiras para o lado a lado. NULO = alguma leitura
 * falhou (o diálogo diz "não foi possível", nunca mostra meia ficha como se
 * fosse a ficha inteira).
 *
 * Sem embed além do de etiqueta (o mesmo do painel): nomes de funil, etapa e
 * campo vêm por id, em leituras próprias.
 */
async function lerComparacao(supabase: Cliente, ids: string[]): Promise<FichaComparada[] | null> {
  const [contatos, etiquetas, catalogo, valores, negocios, conversas] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, phone, email, wa_username, instagram_username, created_at')
      .in('id', ids),
    supabase.from('contact_tags').select('contact_id, tags(name, color)').in('contact_id', ids),
    supabase.from('custom_fields').select('id, field_name, field_type'),
    supabase.from('contact_custom_values').select('contact_id, custom_field_id, value').in('contact_id', ids),
    supabase
      .from('deals')
      .select('id, contact_id, title, status, value, pipeline_id, stage_id, created_at')
      .in('contact_id', ids)
      .order('created_at', { ascending: false }),
    supabase.from('conversations').select('id, contact_id, channel_id').in('contact_id', ids),
  ]);
  const erro =
    contatos.error ?? etiquetas.error ?? catalogo.error ?? valores.error ?? negocios.error ?? conversas.error;
  if (erro) {
    console.error('[comparar-fichas] leitura falhou:', erro.message);
    return null;
  }

  const listaDeNegocios = (negocios.data ?? []) as (Omit<CardComparado, 'funil' | 'etapa'> & {
    contact_id: string;
    stage_id: string;
  })[];
  const funisIds = [...new Set(listaDeNegocios.map((n) => n.pipeline_id))];
  const etapasIds = [...new Set(listaDeNegocios.map((n) => n.stage_id))];
  const listaDeConversas = (conversas.data ?? []) as { id: string; contact_id: string; channel_id: string | null }[];

  const [funis, etapas, ...mensagensPorConversa] = await Promise.all([
    funisIds.length
      ? supabase.from('pipelines').select('id, name').in('id', funisIds)
      : Promise.resolve({ data: [], error: null }),
    etapasIds.length
      ? supabase.from('pipeline_stages').select('id, name').in('id', etapasIds)
      : Promise.resolve({ data: [], error: null }),
    ...listaDeConversas.map((c) =>
      supabase
        .from('messages')
        .select('id, sender_type, content_type, content_text, created_at, status, error_title, nao_saiu, deleted_at')
        .eq('conversation_id', c.id)
        .order('created_at', { ascending: false })
        .limit(MENSAGENS_NA_COMPARACAO),
    ),
  ]);
  const erro2 = funis.error ?? etapas.error ?? mensagensPorConversa.find((m) => m.error)?.error;
  if (erro2) {
    console.error('[comparar-fichas] leitura falhou:', erro2.message);
    return null;
  }

  const nomeDoFunil = new Map(((funis.data ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));
  const nomeDaEtapa = new Map(((etapas.data ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]));
  const campoPorId = new Map(
    ((catalogo.data ?? []) as { id: string; field_name: string; field_type: string | null }[]).map((c) => [c.id, c]),
  );
  const mensagensDaConversa = new Map(
    listaDeConversas.map((c, i) => [
      c.id,
      [...((mensagensPorConversa[i].data ?? []) as MensagemComparada[])].reverse(),
    ]),
  );

  return ((contatos.data ?? []) as Omit<FichaComparada, 'etiquetas' | 'campos' | 'cards' | 'conversa' | 'mensagens'>[]).map(
    (c) => {
      const conversa = listaDeConversas.find((v) => v.contact_id === c.id) ?? null;
      return {
        ...c,
        etiquetas: ((etiquetas.data ?? []) as unknown as { contact_id: string; tags: { name: string; color: string | null } | null }[])
          .filter((e) => e.contact_id === c.id && e.tags)
          .map((e) => ({ nome: e.tags!.name, cor: e.tags!.color }))
          .sort((a, b) => a.nome.localeCompare(b.nome)),
        campos: ((valores.data ?? []) as { contact_id: string; custom_field_id: string; value: string | null }[])
          .filter((v) => v.contact_id === c.id && (v.value ?? '').trim() !== '')
          .map((v) => {
            const campo = campoPorId.get(v.custom_field_id);
            return { campo: campo?.field_name ?? '—', tipo: campo?.field_type ?? null, valor: v.value!.trim() };
          })
          .sort((a, b) => a.campo.localeCompare(b.campo)),
        cards: listaDeNegocios
          .filter((n) => n.contact_id === c.id)
          .map((n) => ({
            id: n.id,
            title: n.title,
            status: n.status,
            value: n.value,
            pipeline_id: n.pipeline_id,
            created_at: n.created_at,
            funil: nomeDoFunil.get(n.pipeline_id) ?? null,
            etapa: nomeDaEtapa.get(n.stage_id) ?? null,
          })),
        conversa: conversa ? { id: conversa.id, channel_id: conversa.channel_id } : null,
        mensagens: conversa ? (mensagensDaConversa.get(conversa.id) ?? []) : [],
      };
    },
  );
}

/**
 * As duas fichas do "Comparar" (1088). Só lê com o diálogo ABERTO.
 *
 * ⚠️ Carimbo `{ de, fichas }` com a chave do PAR: trocar de candidata com o
 * diálogo aberto não mostra, nem por um render, as fichas do par anterior.
 */
export function useComparacaoDeFichas(
  contatoId: string | null,
  outroId: string | null,
): { fichas: FichaComparada[] | null; carregando: boolean; falhou: boolean } {
  const chave = contatoId && outroId ? `${contatoId}:${outroId}` : null;
  const [estado, setEstado] = useState<{ de: string | null; fichas: FichaComparada[] | null }>({
    de: null,
    fichas: null,
  });

  useEffect(() => {
    if (!chave || !contatoId || !outroId) return;
    let vivo = true;
    void lerComparacao(createClient(), [contatoId, outroId]).then((fichas) => {
      if (vivo) setEstado({ de: chave, fichas });
    });
    return () => {
      vivo = false;
    };
  }, [chave, contatoId, outroId]);

  const doParAtual = !!chave && estado.de === chave;
  return {
    fichas: doParAtual ? estado.fichas : null,
    carregando: !!chave && !doParAtual,
    falhou: doParAtual && estado.fichas === null,
  };
}
