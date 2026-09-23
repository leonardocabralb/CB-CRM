// ============================================================
// O botão "Enviar teste" de Configurações → Webhooks → Enviados.
//
// Manda UM envelope de exemplo (`exemplos.ts`, com `test: true`) ao endereço
// cadastrado e devolve o que aconteceu, para o operador conferir o formato no
// n8n ANTES de esperar um card se mexer de verdade.
//
// ⚠️ Mesmo pedido da entrega real, peça por peça — é o ponto do teste:
//   - o pedido sai de `pedidoDeEntrega` (os mesmos cabeçalhos, a assinatura
//     sobre os bytes exatos, `redirect: 'manual'`, o mesmo prazo);
//   - o mesmo guarda de SSRF (`isDeliverableUrl`);
//   - o mesmo segredo decifrado.
// Um teste que passasse por outro caminho aprovaria um endpoint que a entrega
// real recusa.
//
// ⚠️ NÃO toca em `failure_count` nem em `last_delivery_at`. O teste é gesto
// manual: quinze cliques contra um endereço errado DESLIGARIAM o endpoint
// (`MAX_CONSECUTIVE_FAILURES`), e um teste bem-sucedido carimbaria "última
// entrega" sobre um aviso que não foi evento nenhum.
//
// Funciona com o endpoint desligado e para evento que ele NÃO assina: é teste
// de FORMATO — o operador quer ver o `deal.stage_changed` antes de assiná-lo.
//
// ⚠️ Devolve também o COMEÇO do que o endereço respondeu (até
// `TETO_DO_TRECHO` bytes, só texto). No erro mais comum do n8n — o 404 do
// fluxo não publicado, ou da Test URL fora da janela — é o corpo que diz o
// motivo; o status sozinho não diz. O teto é o que impede um endpoint que
// despeja corpo grande de segurar memória e conexão. Quem DECIDE o resultado
// continua sendo o status, como na entrega real (`deliver.ts`): um 2xx com
// corpo lento ou quebrado é "entregue", com o trecho ausente.
// ============================================================

import { randomUUID } from 'node:crypto';

import { decrypt } from '@/lib/whatsapp/encryption';
import { pedidoDeEntrega } from '@/lib/webhooks/deliver';
import { exemploDeEnvelope } from '@/lib/webhooks/exemplos';
import { TETO_DO_TRECHO } from '@/lib/webhooks/resultado-do-teste';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { WebhookEvent } from '@/lib/webhooks/events';

/**
 * Por que o teste não passou. Chaves estáveis: a tela as traduz.
 *
 * - `http`: o endereço respondeu, mas fora de 2xx (`status` diz qual);
 * - `redirecionamento`: respondeu 3xx — a entrega não segue redirecionamento
 *   (um endereço público poderia apontar para a rede interna);
 * - `tempo`: não respondeu em `DELIVERY_TIMEOUT_MS` (5 s, `deliver.ts`);
 * - `rede`: resolveu o nome, mas não deu para conectar (recusa, TLS, queda);
 * - `endereco_bloqueado`: o guarda de SSRF recusou o endereço — ele resolve
 *   para rede privada ou interna, OU o nome NÃO RESOLVE (domínio digitado
 *   errado). `isDeliverableUrl` não separa os dois, então a tela precisa
 *   dizer as duas possibilidades;
 * - `segredo_ilegivel`: o segredo gravado não decifra (a `ENCRYPTION_KEY`
 *   mudou) — nenhuma entrega real sairia assinada; recriar o endpoint resolve.
 */
export type MotivoDaFalhaDoTeste =
  | 'http'
  | 'redirecionamento'
  | 'tempo'
  | 'rede'
  | 'endereco_bloqueado'
  | 'segredo_ilegivel';

/**
 * A resposta de `POST /api/cb/webhooks-de-saida/{id}/teste` quando o endpoint
 * existe — sempre 200: o teste RODOU, e o resultado dele é dado, não erro.
 * `ms` é quanto o teste levou, do começo ao fim.
 */
export type ResultadoDoTeste =
  | { ok: true; status: number; ms: number; resposta?: TrechoDaResposta | null }
  | {
      ok: false;
      status: number | null;
      motivo: MotivoDaFalhaDoTeste;
      ms: number;
      /**
       * Presente quando o endereço RESPONDEU (`http`, `redirecionamento`):
       * é justamente na falha que o corpo mais importa. `null` = a leitura
       * do corpo falhou (prazo, conexão caída no meio).
       */
      resposta?: TrechoDaResposta | null;
    };

/**
 * O começo do corpo que o endereço devolveu.
 *
 * - `corpo`: o texto decodificado, sem caracteres de controle (menos `\n` e
 *   `\t`); `""` = resposta sem corpo; `null` só quando `binario`.
 * - `cortado`: o corpo passava de `TETO_DO_TRECHO` bytes.
 * - `binario`: o `content-type` não é texto — o corpo nem é lido.
 */
export interface TrechoDaResposta {
  corpo: string | null;
  cortado: boolean;
  binario?: boolean;
}

/**
 * `text/*` (HTML incluso), JSON e XML — e cabeçalho ausente, que é o caso
 * comum. JSON/XML pelo SUBTIPO inteiro ou pelo sufixo (`+json`, `+xml`),
 * nunca por "contém": `application/vnd.openxmlformats-…` (docx, xlsx) tem
 * "xml" no nome, é um zip, e sairia na tela como 2 KB de lixo.
 */
export function ehTextual(contentType: string | null): boolean {
  if (!contentType) return true;
  const tipo = contentType.split(';')[0].trim().toLowerCase();
  if (!tipo) return true;
  if (tipo.startsWith('text/')) return true;
  const subtipo = tipo.slice(tipo.indexOf('/') + 1);
  return /(^|\+)(json|xml)$/.test(subtipo);
}

// Controle C0 e C1, menos a tabulação (\x09) e a quebra de linha (\x0A). O
// `\r` sai também: a quebra de linha continua pelo `\n`.
const CONTROLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Lê no máximo `teto` bytes do corpo e solta o resto. Nunca lança: a leitura
 * que falha (o prazo de `pedidoDeEntrega` também corta o corpo) devolve
 * `null`, e o resultado fica o que o status disse.
 */
async function trechoDaResposta(
  resposta: Response,
  teto: number = TETO_DO_TRECHO
): Promise<TrechoDaResposta | null> {
  if (!ehTextual(resposta.headers.get('content-type'))) {
    await resposta.body?.cancel().catch(() => {});
    return { corpo: null, cortado: false, binario: true };
  }
  if (!resposta.body) return { corpo: '', cortado: false };

  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  let cortado = false;
  try {
    // Lê UM pedaço além do teto para saber se o corpo passava dele: um
    // corpo de exatamente `teto` bytes não é "cortado".
    for (;;) {
      if (total > teto) {
        cortado = true;
        break;
      }
      const { done, value } = await leitor.read();
      if (done) break;
      partes.push(value);
      total += value.byteLength;
    }
  } catch {
    await leitor.cancel().catch(() => {});
    return null;
  }
  if (cortado) await leitor.cancel().catch(() => {});

  const bytes = new Uint8Array(Math.min(total, teto));
  let posicao = 0;
  for (const parte of partes) {
    if (posicao >= bytes.length) break;
    const pedaco = parte.subarray(0, bytes.length - posicao);
    bytes.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }
  // `stream: true` no corte: o caractere multibyte partido no teto fica de
  // fora, em vez de virar um "�" no fim do trecho.
  const texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes, {
    stream: cortado,
  });
  return { corpo: texto.replace(CONTROLE, ''), cortado };
}

export interface EndpointDoTeste {
  id: string;
  url: string;
  /** O segredo CIFRADO, como está em `webhook_endpoints.secret`. */
  secret: string;
}

/** Nunca lança: toda saída é um `ResultadoDoTeste`. */
export async function enviarTeste(
  endpoint: EndpointDoTeste,
  evento: WebhookEvent,
  accountId: string
): Promise<ResultadoDoTeste> {
  const inicio = Date.now();
  const ms = () => Date.now() - inicio;

  if (!(await isDeliverableUrl(endpoint.url))) {
    return { ok: false, status: null, motivo: 'endereco_bloqueado', ms: ms() };
  }

  let segredo: string;
  try {
    segredo = decrypt(endpoint.secret);
  } catch {
    return { ok: false, status: null, motivo: 'segredo_ilegivel', ms: ms() };
  }

  const corpo = JSON.stringify(
    exemploDeEnvelope(evento, {
      accountId,
      // Id NOVO a cada clique: quem deduplica pelo id não pode engolir o
      // segundo teste.
      id: randomUUID(),
      quando: new Date().toISOString(),
      teste: true,
    })
  );

  let resposta: Response;
  try {
    resposta = await fetch(
      endpoint.url,
      pedidoDeEntrega({
        endpointId: endpoint.id,
        evento,
        corpo,
        segredo,
        tsSegundos: Math.floor(Date.now() / 1000),
      })
    );
  } catch (err) {
    // `AbortSignal.timeout` rejeita com um `DOMException` de nome
    // `TimeoutError`; `AbortError` cobre o runtime que ainda não distingue os
    // dois. Lido pelo nome, sem `instanceof`: DOMException não é Error em todo
    // runtime.
    const nome = (err as { name?: unknown } | null)?.name;
    const motivo = nome === 'TimeoutError' || nome === 'AbortError' ? 'tempo' : 'rede';
    return { ok: false, status: null, motivo, ms: ms() };
  }

  // O começo do corpo, com teto — nunca o corpo inteiro: um corpo pendurado
  // seguraria a conexão (e, com endpoint lento, o prazo) à toa.
  const trecho = await trechoDaResposta(resposta);

  // Com `redirect: 'manual'` o Node devolve o 3xx como está; o navegador
  // devolveria `opaqueredirect` com status 0 — os dois contam.
  if (resposta.type === 'opaqueredirect' || (resposta.status >= 300 && resposta.status < 400)) {
    return {
      ok: false,
      status: resposta.status || null,
      motivo: 'redirecionamento',
      ms: ms(),
      resposta: trecho,
    };
  }
  if (!resposta.ok) {
    return { ok: false, status: resposta.status, motivo: 'http', ms: ms(), resposta: trecho };
  }
  return { ok: true, status: resposta.status, ms: ms(), resposta: trecho };
}
