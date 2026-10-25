'use client';

// ============================================================
// O catálogo de modelos da Meta da CONTA, para a bolha de modelo mostrar o
// cabeçalho, o rodapé e os botões que o cliente viu
// (`src/lib/whatsapp/modelo-da-mensagem.ts`).
//
// UMA leitura por conta, compartilhada por todas as bolhas (cache de módulo,
// o molde de `nomes-dos-agentes.ts`): uma busca por bolha seriam dezenas por
// conversa. Nome que o catálogo não tem (modelo sincronizado depois da
// leitura) pede de novo, no máximo uma vez por minuto; e a leitura vence em
// 5 min, senão o modelo editado ficaria velho em toda bolha até recarregar a
// página.
//
// ⚠️ Catálogo da CONTA: sem `.eq('user_id', …)` — `user_id` é autoria, e o
// membro que não criou o modelo leria vazio (CLAUDE.md 8a; o mesmo cuidado
// de `template-manager.tsx`). O recorte é a conta (`accountId` do perfil,
// que a RLS já garante), e o cache é CHAVEADO por ela: outro login na mesma
// aba não herda o catálogo do anterior.
//
// ⚠️ `null` = não sei (sem conta, carregando, ou leitura que falhou sem uma
// boa antes): a bolha fica como sempre foi, sem afirmar nada. A releitura que
// falha mantém a última boa, como a dos nomes dos agentes.
// ============================================================

import { useEffect, useSyncExternalStore } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { ModeloDoCatalogo } from '@/lib/whatsapp/modelo-da-mensagem';

const REBUSCAR_MS = 60_000;
const VALIDADE_MS = 5 * 60_000;
/** O teto do PostgREST: a leitura anda por CHAVE (`id`) até uma página curta. */
const POR_PAGINA = 1000;
/** Freio de segurança; passado dele, os modelos que sobram ficam como hoje. */
const MAX_PAGINAS = 10;
const COLUNAS =
  'id, name, language, channel_id, header_type, header_content, footer_text, buttons, body_text';

let catalogo: {
  conta: string;
  modelos: readonly ModeloDoCatalogo[];
  nomes: ReadonlySet<string>;
} | null = null;
/** A conta da leitura em voo, e o número dela (a resposta velha é descartada). */
let buscandoPara: string | null = null;
let ultimoPedido = 0;
/** A última leitura que TERMINOU (boa ou não) — o freio de 1 min. */
let tentadoPara: string | null = null;
let tentadoEm = 0;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const f of ouvintes) f();
}

function assinar(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

async function lerCatalogo(conta: string): Promise<ModeloDoCatalogo[] | null> {
  const supabase = createClient();
  const modelos: ModeloDoCatalogo[] = [];
  let depoisDe: string | null = null;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    let consulta = supabase
      .from('message_templates')
      .select(COLUNAS)
      .eq('account_id', conta);
    if (depoisDe) consulta = consulta.gt('id', depoisDe);
    const { data, error } = await consulta.order('id').limit(POR_PAGINA);
    if (error) {
      // Erro de leitura NÃO é "catálogo vazio" (CLAUDE.md 8b).
      console.error('[modelos-da-conta] leitura falhou:', error.message);
      return null;
    }
    const linhas = (data ?? []) as unknown as (ModeloDoCatalogo & {
      id: string;
    })[];
    modelos.push(...linhas);
    if (linhas.length < POR_PAGINA) return modelos;
    depoisDe = linhas[linhas.length - 1].id;
  }
  return modelos;
}

function buscar(conta: string) {
  if (buscandoPara === conta) return;
  if (tentadoPara === conta && Date.now() - tentadoEm < REBUSCAR_MS) return;
  const pedido = ++ultimoPedido;
  buscandoPara = conta;
  void lerCatalogo(conta)
    .catch(() => null)
    .then((modelos) => {
      // Outra conta (outro login na aba) pediu no meio: esta resposta é velha.
      if (pedido !== ultimoPedido) return;
      buscandoPara = null;
      tentadoPara = conta;
      tentadoEm = Date.now();
      if (modelos) {
        catalogo = {
          conta,
          modelos,
          nomes: new Set(modelos.map((m) => m.name)),
        };
      }
      avisar();
    });
}

/**
 * O catálogo da conta (`null` enquanto não se sabe). `nomeProcurado` é o
 * `template_name` da bolha: ausente do catálogo, pede uma releitura; sem nome
 * não há o que casar, e nada é lido.
 */
export function useModelosDaConta(
  nomeProcurado: string | null | undefined
): readonly ModeloDoCatalogo[] | null {
  const { accountId } = useAuth();
  const modelos = useSyncExternalStore(
    assinar,
    () =>
      accountId && catalogo?.conta === accountId ? catalogo.modelos : null,
    () => null
  );
  useEffect(() => {
    if (!accountId || !nomeProcurado) return;
    const daConta = catalogo?.conta === accountId ? catalogo : null;
    if (
      !daConta ||
      !daConta.nomes.has(nomeProcurado) ||
      Date.now() - tentadoEm > VALIDADE_MS
    ) {
      buscar(accountId);
    }
  }, [accountId, nomeProcurado]);
  return modelos;
}
