import type { SupabaseClient } from '@supabase/supabase-js';

import {
  formaDoReferral,
  lerReferralDaMeta,
  planejarGravacaoDoAnuncio,
  tipoConhecido,
  type AnuncioDeOrigem,
  type CampoDaConta,
  type PlanoDoAnuncio,
} from '@/lib/contacts/anuncio-de-origem';
import { salvarValoresDoContato } from '@/lib/contacts/custom-values';

/** O que aconteceu com o anúncio de um aviso — para o log e os testes. */
export interface ResultadoDoAnuncio {
  /** O aviso trazia um anúncio legível? */
  anuncio: boolean;
  /** O que foi planejado (null sem anúncio, ou se a leitura falhou). */
  plano: PlanoDoAnuncio | null;
  /** Falhas, para o log. Vazio = tudo o que o plano pedia foi gravado. */
  erros: string[];
}

/**
 * Grava o anúncio de origem (o `referral` do Click-to-WhatsApp) nos campos de
 * traqueamento da ficha. A regra — o que vai para qual campo, primeira origem
 * em bloco, último clique sempre — é `anuncio-de-origem.ts`.
 *
 * Chamado pelo webhook da Meta (`src/app/api/whatsapp/webhook/route.ts`) na
 * mensagem de CLIENTE recém-gravada — a reentrega já saiu antes —, e antes do
 * robô, das automações e do roteador de funil.
 *
 * ⚠️⚠️ NUNCA lança, e é isso que torna seguro o `await` na ingestão: a
 * mensagem do cliente já está gravada e o provedor já recebeu 200. Erro de
 * banco vira log e `erros` no resultado; o traqueamento perdido é o preço, a
 * mensagem nunca. O supabase-js DEVOLVE `error` (confere-se cada um) e o
 * `catch` pega o que ele lança (rede).
 *
 * Campo que NÃO existe na conta fica de fora, sem criar nada: os campos de
 * traqueamento se criam pela tela (Configurações → Campos e etiquetas), nunca
 * pelo código. Aviso sem `referral` (o caso de quase toda mensagem) não faz
 * consulta nenhuma. `referral` PRESENTE e ilegível vira aviso no log com a
 * forma dele (chaves e tipos, nunca valores): o dado do clique chega uma vez
 * só, e sem essa linha uma mudança de formato da Meta sumiria calada.
 *
 * `contact_custom_values` não tem `account_id`: a conta entra pelo catálogo
 * (`custom_fields` filtrado por ela), e só ids desse catálogo são gravados. O
 * contato é o que a própria ingestão resolveu naquela conta.
 */
export async function gravarAnuncioDeOrigem(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  referral: unknown;
}): Promise<ResultadoDoAnuncio> {
  if (args.referral === undefined) {
    return { anuncio: false, plano: null, erros: [] };
  }
  const anuncio = lerReferralDaMeta(args.referral);
  if (!anuncio) {
    console.warn('[anuncio-de-origem] referral ilegível:', {
      conta: args.accountId,
      contato: args.contactId,
      forma: formaDoReferral(args.referral),
    });
    return { anuncio: false, plano: null, erros: [] };
  }

  const erros: string[] = [];
  try {
    const { data: campos, error: camposErr } = await args.db
      .from('custom_fields')
      .select('id, field_key, categoria')
      .eq('account_id', args.accountId);
    if (camposErr) {
      erros.push(`catálogo: ${camposErr.message}`);
      return registrar(args, anuncio, { anuncio: true, plano: null, erros });
    }

    const { data: linhas, error: valoresErr } = await args.db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', args.contactId);
    if (valoresErr) {
      erros.push(`valores: ${valoresErr.message}`);
      return registrar(args, anuncio, { anuncio: true, plano: null, erros });
    }

    const valores: Record<string, string> = {};
    for (const l of (linhas ?? []) as {
      custom_field_id: string;
      value: string | null;
    }[]) {
      valores[l.custom_field_id] = l.value ?? '';
    }

    const plano = planejarGravacaoDoAnuncio(
      anuncio,
      (campos ?? []) as CampoDaConta[],
      valores
    );

    // Primeira origem: só onde não há linha — quem decide é o banco, campo a
    // campo. ⚠️ O BLOCO não é atômico: "a ficha tem origem?" foi respondido
    // sobre a leitura acima, e se o Make da iMotion gravar um desses campos
    // pela API v1 nesse intervalo (milissegundos), o dele fica e os outros
    // dois entram — a ficha sai com origem misturada. Aceito: fechar pediria
    // a pergunta e o INSERT na mesma transação (uma RPC).
    if (Object.keys(plano.primeiraOrigem).length > 0) {
      const erro = await salvarValoresDoContato(
        args.db,
        args.contactId,
        plano.primeiraOrigem,
        { manterExistentes: true }
      );
      if (erro) erros.push(`primeira origem: ${erro}`);
    }
    // Último clique: por cima do que houver. ⚠️ Vence a ESCRITA mais
    // recente, não o clique mais recente: duas mensagens com `referral` do
    // mesmo contato processadas em paralelo (dois anúncios clicados no mesmo
    // instante, ou um webhook atrasado) podem deixar o clique mais velho
    // gravado. Aceito (Codex, PR #313): a janela é de milissegundos, e fechar
    // pede gravar cada clique à parte (a tabela de cliques da 7b do plano do
    // previdenciário), que é onde o evento de conversão vai ler de verdade.
    if (Object.keys(plano.ultimoClique).length > 0) {
      const erro = await salvarValoresDoContato(
        args.db,
        args.contactId,
        plano.ultimoClique
      );
      if (erro) erros.push(`último clique: ${erro}`);
    }

    return registrar(args, anuncio, { anuncio: true, plano, erros });
  } catch (err) {
    erros.push(err instanceof Error ? err.message : String(err));
    return registrar(args, anuncio, { anuncio: true, plano: null, erros });
  }
}

/**
 * Uma linha de log por anúncio recebido — é o rastro de que ele chegou, e o
 * que a conferência com um clique real lê: o tipo, e se vieram o id e o
 * `ctwa_clid`.
 *
 * Na FALHA, a linha leva também o `ctwa_clid` e o id do anúncio (código de
 * clique e id de anúncio, não são dado pessoal): a reentrega sai antes da
 * gravação, então nada tenta de novo, e o clique é o único dado que não se
 * recupera por outro caminho (nomes e ids saem da API de anúncios). É por
 * esta linha que se regrava à mão.
 */
function registrar(
  args: { accountId: string; contactId: string },
  anuncio: AnuncioDeOrigem,
  resultado: ResultadoDoAnuncio
): ResultadoDoAnuncio {
  const { plano, erros } = resultado;
  const resumo = {
    conta: args.accountId,
    contato: args.contactId,
    tipo: anuncio.tipo?.slice(0, 40) ?? null,
    temId: anuncio.idDaOrigem !== null,
    temCtwaClid: anuncio.ctwaClid !== null,
    primeiraOrigem: plano ? Object.keys(plano.primeiraOrigem).length : null,
    origemJaExistia: plano?.origemJaExistia ?? null,
    ultimoClique: plano ? Object.keys(plano.ultimoClique).length : null,
    semCampo: plano?.semCampo ?? null,
  };
  if (erros.length > 0) {
    console.error('[anuncio-de-origem] falhou:', erros.join(' | '), {
      ...resumo,
      ctwaClid: anuncio.ctwaClid,
      idDaOrigem: anuncio.idDaOrigem,
    });
  } else if (!tipoConhecido(anuncio.tipo)) {
    // Tipo ausente ou fora de `ad`/`post`: só o último clique foi gravado.
    console.warn('[anuncio-de-origem] tipo desconhecido:', resumo);
  } else {
    console.info('[anuncio-de-origem] recebido:', resumo);
  }
  return resultado;
}
