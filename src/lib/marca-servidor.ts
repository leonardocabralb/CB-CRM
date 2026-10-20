// ============================================================
// A marca no SERVIDOR: lê `cb_marca` (1094) com service role, em cache.
//
// ⚠️ Só servidor: usa a service role. O navegador recebe a marca já
// resolvida pelo layout raiz (`MarcaProvider`), nunca lê a tabela — ela é
// fechada a `anon` e a `authenticated`, e a tela de login precisa da marca
// antes de haver sessão.
//
// Cache: `unstable_cache` com a etiqueta `TAG_DA_MARCA`. A rota que grava
// (`/api/cb/marca`) chama `revalidateTag(TAG_DA_MARCA, { expire: 0 })`, e a
// próxima página já sai com a marca nova. A hora de `revalidate` é só rede
// de segurança (um processo que não ouviu a invalidação).
//
// ⚠️ Falha de leitura NUNCA vira cache: a função cacheada LANÇA, e quem
// chama cai no padrão só desta vez. Guardar o padrão no cache faria uma
// instalação com marca própria se apresentar como Atlas por uma hora por
// causa de um soluço do banco.
// ============================================================

import { unstable_cache } from 'next/cache'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  BUCKET_DA_MARCA,
  marcaPadrao,
  resolverMarca,
  type LinhaDaMarca,
  type Marca,
} from '@/lib/marca'

export const TAG_DA_MARCA = 'marca'

export const COLUNAS_DA_MARCA =
  'nome, nome_curto, cor_do_icone, simbolo_path, horizontal_escuro_path, horizontal_claro_path, vertical_escuro_path, vertical_claro_path, atualizado_em'

/** A linha crua (sem cache). Lança em erro de leitura; `null` = sem marca própria. */
export async function lerLinhaDaMarca(): Promise<LinhaDaMarca | null> {
  const { data, error } = await supabaseAdmin()
    .from('cb_marca')
    .select(COLUNAS_DA_MARCA)
    .maybeSingle()
  if (error) throw new Error(`cb_marca: ${error.message}`)
  return (data as LinhaDaMarca | null) ?? null
}

/** URL pública de um caminho do bucket da marca (derivada, nunca aceita de fora). */
export function urlPublicaDaMarca(caminho: string): string {
  return supabaseAdmin().storage.from(BUCKET_DA_MARCA).getPublicUrl(caminho)
    .data.publicUrl
}

const marcaEmCache = unstable_cache(
  async (): Promise<Marca> =>
    resolverMarca(await lerLinhaDaMarca(), urlPublicaDaMarca),
  ['cb-marca'],
  { tags: [TAG_DA_MARCA], revalidate: 3600 },
)

/**
 * A marca da instalação. Nunca lança: sem banco (ou fora de uma requisição
 * do Next, como nos testes), devolve o padrão — e registra por quê.
 */
export async function obterMarca(): Promise<Marca> {
  try {
    return await marcaEmCache()
  } catch (erro) {
    console.error('[marca] leitura falhou; usando o padrão:', erro)
    return marcaPadrao()
  }
}

/**
 * A conta DONA da instalação: a mais antiga. Só o admin dela troca a marca
 * (decisão do operador, 19/10/2026) — o cadastro dá a todo login novo uma
 * conta avulsa em que ele é admin, e "qualquer admin" deixaria essas
 * pessoas trocarem o logo de todos.
 *
 * Lança em erro de leitura (o chamador responde 500, nunca "não é você").
 */
export async function contaDaInstalacao(): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('accounts')
    .select('id')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`accounts: ${error.message}`)
  return (data as { id: string } | null)?.id ?? null
}
