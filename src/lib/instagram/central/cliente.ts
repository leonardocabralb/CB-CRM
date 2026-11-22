// ============================================================
// O CLIENTE da central do Instagram (U-3): este CRM conecta o Instagram pelo
// app único da Atlas, sem app próprio na Meta, como instância da central (a
// central mora no Atlas CRM; este CRM é só instância).
//
// Liga com as três variáveis do ambiente, que saem do cadastro desta
// instância na central (feito pelo operador da central):
//   · INSTAGRAM_CENTRAL_URL — a origem https da central;
//   · INSTAGRAM_CENTRAL_INSTANCIA — o id desta instância lá;
//   · INSTAGRAM_CENTRAL_CHAVE — a chave desta instância (só a central tem o
//     hash dela).
// Com as três, o "Conectar com Instagram ou Facebook" vai à central (o
// `oauth/start`), a volta traz um tíquete (o `oauth/callback`) e o resgate é
// de servidor para servidor, com a chave no `Bearer`. A conexão nasce com
// `ig_login = 'central'` e, em `ig_app_secret`, o segredo do repasse (que sai
// da chave): é com ele que a central assina as entregas, e a rota de webhook
// de sempre as confere. Envio, perfil e saúde vão direto à Meta, com o token
// do escritório (`contaDaConexao`).
//
// ⚠️ O `NEXT_PUBLIC_SITE_URL` deste CRM tem de ser a origem cadastrada na
// central: `origemDoPedido` monta o retorno por ele, e a central só devolve o
// login a essa origem.
// ============================================================

import { lerComTeto } from '@/lib/http/ler-com-teto';

import { chaveTemForma, segredoDoRepasse } from './chave';
import {
  CAMINHOS_DA_CENTRAL,
  VERSAO_DO_CONTRATO,
  origemHttps,
  type ConteudoDoTiquete,
} from './contrato';

export interface ClienteDaCentral {
  url: string;
  instancia: string;
  chave: string;
}

/** As três variáveis do cliente; o resto do ambiente não importa aqui. */
export interface AmbienteDoCliente {
  INSTAGRAM_CENTRAL_URL?: string;
  INSTAGRAM_CENTRAL_INSTANCIA?: string;
  INSTAGRAM_CENTRAL_CHAVE?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRAZO_MS = 15_000;
const TETO_DA_RESPOSTA = 256 * 1024;

export type EstadoDoCliente =
  | { ligado: false }
  | { ligado: true; incompleto: string[] }
  | { ligado: true; incompleto: null; cliente: ClienteDaCentral };

/**
 * Sem `INSTAGRAM_CENTRAL_URL`, desligado; com ela, as outras duas valem também.
 * O padrão lê cada variável do ambiente do processo pelo nome escrito por
 * extenso: é assim que os pinos `env-documentado` e `stack-env` a enxergam.
 */
export function estadoDoCliente(
  env: AmbienteDoCliente = {
    INSTAGRAM_CENTRAL_URL: process.env.INSTAGRAM_CENTRAL_URL,
    INSTAGRAM_CENTRAL_INSTANCIA: process.env.INSTAGRAM_CENTRAL_INSTANCIA,
    INSTAGRAM_CENTRAL_CHAVE: process.env.INSTAGRAM_CENTRAL_CHAVE,
  }
): EstadoDoCliente {
  const bruta = env.INSTAGRAM_CENTRAL_URL?.trim();
  if (!bruta) return { ligado: false };
  const faltam: string[] = [];
  const url = origemHttps(bruta);
  if (!url) faltam.push('INSTAGRAM_CENTRAL_URL (https://host, sem caminho)');
  const instancia = env.INSTAGRAM_CENTRAL_INSTANCIA?.trim() ?? '';
  if (!UUID.test(instancia)) faltam.push('INSTAGRAM_CENTRAL_INSTANCIA');
  const chave = env.INSTAGRAM_CENTRAL_CHAVE?.trim() ?? '';
  if (!chaveTemForma(chave)) faltam.push('INSTAGRAM_CENTRAL_CHAVE');
  if (faltam.length > 0 || !url) return { ligado: true, incompleto: faltam };
  return { ligado: true, incompleto: null, cliente: { url, instancia, chave } };
}

/** O segredo que assina as entregas que a central repassa a esta instância. */
export function segredoDasEntregas(cliente: ClienteDaCentral): string {
  return segredoDoRepasse(cliente.chave);
}

/** Para onde o `oauth/start` manda o navegador. */
export function urlDeEntrar(
  cliente: ClienteDaCentral,
  args: { retorno: string; estado: string }
): string {
  const u = new URL(`${cliente.url}${CAMINHOS_DA_CENTRAL.entrar}`);
  u.searchParams.set('instancia', cliente.instancia);
  u.searchParams.set('retorno', args.retorno);
  u.searchParams.set('estado', args.estado);
  return u.toString();
}

/** A central recusou, não respondeu, ou respondeu o que não se entende. */
export class CentralError extends Error {
  constructor(
    public readonly codigo: 'tiquete_invalido' | 'sem_acesso' | 'indisponivel',
    message: string
  ) {
    super(message);
    this.name = 'CentralError';
  }
}

async function pedirACentral(
  cliente: ClienteDaCentral,
  caminho: string,
  corpo: Record<string, unknown>,
  fetchFn: typeof fetch
): Promise<{ status: number; json: unknown }> {
  let r: Response;
  try {
    r = await fetchFn(`${cliente.url}${caminho}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cliente.chave}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ instancia: cliente.instancia, versao: VERSAO_DO_CONTRATO, ...corpo }),
      // A central é um endereço do ambiente, mas a resposta segue a regra de
      // toda URL de fora: sem redirecionamento (levaria a chave junto) e com teto.
      redirect: 'manual',
      signal: AbortSignal.timeout(PRAZO_MS),
    });
  } catch (e) {
    throw new CentralError('indisponivel', e instanceof Error ? e.message : 'falha de rede');
  }
  let json: unknown = null;
  try {
    json = JSON.parse((await lerComTeto(r, TETO_DA_RESPOSTA)).toString('utf8'));
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

/**
 * O tíquete da volta do login trocado pelo token e pelas contas. Lança
 * `CentralError` em tudo que não for 200 com a forma certa.
 */
export async function resgatarNaCentral(
  cliente: ClienteDaCentral,
  tiquete: string,
  fetchFn: typeof fetch = fetch
): Promise<ConteudoDoTiquete> {
  const { status, json } = await pedirACentral(cliente, CAMINHOS_DA_CENTRAL.resgatar, { tiquete }, fetchFn);
  if (status === 401) throw new CentralError('sem_acesso', 'a central recusou a chave desta instância');
  if (status === 404) throw new CentralError('tiquete_invalido', 'o tíquete venceu ou já foi usado');
  if (status !== 200) throw new CentralError('indisponivel', `a central respondeu HTTP ${status}`);
  const o = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null;
  if (!o || typeof o.token !== 'string' || !o.token || !Array.isArray(o.contas)) {
    throw new CentralError('indisponivel', 'a resposta da central veio sem token ou sem contas');
  }
  const textos = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const contas: ConteudoDoTiquete['contas'] = [];
  for (const c of o.contas) {
    if (typeof c !== 'object' || c === null) continue;
    const item = c as Record<string, unknown>;
    if (typeof item.igUserId !== 'string' || !/^[0-9]{1,32}$/.test(item.igUserId)) continue;
    contas.push({
      igUserId: item.igUserId,
      username: typeof item.username === 'string' && item.username ? item.username : null,
    });
  }
  const expira = Number(o.expiraEmSeg);
  return {
    versao: VERSAO_DO_CONTRATO,
    token: o.token,
    expiraEmSeg: Number.isFinite(expira) && expira > 0 ? expira : null,
    clientBusinessId: typeof o.clientBusinessId === 'string' && o.clientBusinessId ? o.clientBusinessId : null,
    contas,
    recusadas: textos(o.recusadas),
    falharam: textos(o.falharam),
  };
}

/** Avisa a central que esta conta saiu desta instância. Nunca lança; `false` = não confirmou. */
export async function avisarDesconexao(
  cliente: ClienteDaCentral,
  igUserId: string,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  try {
    const { status } = await pedirACentral(
      cliente,
      CAMINHOS_DA_CENTRAL.desconectar,
      { ig_user_id: igUserId },
      fetchFn
    );
    if (status !== 200) console.warn('[instagram/central] o desconectar respondeu HTTP', status);
    return status === 200;
  } catch (err) {
    console.warn('[instagram/central] o desconectar falhou:', err instanceof Error ? err.message : err);
    return false;
  }
}
