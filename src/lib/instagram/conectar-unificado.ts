// ============================================================
// A volta do login unificado (1153): um login, VÁRIAS contas.
//
// No unificado a pessoa escolhe, na tela da Meta, o portfólio e as contas do
// Instagram que compartilha com o app; o token (do usuário do sistema daquele
// portfólio) alcança todas. Cada conta vira UMA conexão — como cada número de
// WhatsApp —, com o mesmo token repetido nas linhas (estudo, §2.6: a forma
// mais simples; reconectar atualiza todas de uma vez).
//
// Por conta, na ordem do login do Instagram:
//   1. o nó da conta diz o @ (`me()` com o ID no caminho);
//   2. a conta passa a entregar os webhooks ao app — ANTES de gravar, para
//      não nascer conexão que não recebe;
//   3. a gravação (`canal.ts`), com a regra do índice único global.
// A falha de UMA conta não derruba as outras: cada uma volta com o seu
// desfecho, e a tela diz quais não entraram.
//
// Pela central do Instagram (U-3) é o mesmo caminho, com `login: 'central'`
// e `assinar: false`: a central já assinou o webhook de cada conta (é ela que
// recebe as entregas), e o segredo gravado é o das entregas que ela repassa.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { gravarCanalDoInstagram } from './canal';
import {
  InstagramApiError,
  criarClienteInstagram,
  type ContasDoToken,
} from './graph';
import { CAMPOS_DO_WEBHOOK, vencimentoDoToken } from './oauth';

export interface ContaConectada {
  canalId: string;
  username: string;
  reconectado: boolean;
}

export interface ContaQueNaoEntrou {
  /** O @ da lista do login, ou o ID quando a Meta não mandou o @. */
  conta: string;
  /** O ID da conta (a central solta a rota da que não entrou). */
  igUserId: string;
  motivo: 'outra_conta' | 'meta' | 'erro';
  /** A mensagem da Meta, já sem segredo (`semSegredo`). */
  detalhe: string | null;
}

export interface ResultadoDoUnificado {
  conectadas: ContaConectada[];
  naoEntraram: ContaQueNaoEntrou[];
}

export async function conectarContasDoUnificado(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    /**
     * O segredo que assina as entregas: o App Secret principal no unificado,
     * o segredo do repasse da central no `central`.
     */
    appSecret: string;
    token: string;
    expiraEmSeg: number | null;
    alcance: ContasDoToken;
    /** Padrão: `unificado` (o app da própria conta). */
    login?: 'unificado' | 'central';
    /** Padrão: assina. Pela central, não (ela já assinou). */
    assinar?: boolean;
  },
  criarCliente: typeof criarClienteInstagram = criarClienteInstagram
): Promise<ResultadoDoUnificado> {
  const resultado: ResultadoDoUnificado = { conectadas: [], naoEntraram: [] };
  const tokenExpiraEm =
    args.expiraEmSeg === null ? null : vencimentoDoToken(args.expiraEmSeg);

  for (const conta of args.alcance.contas) {
    const nome = conta.username ? `@${conta.username}` : conta.igUserId;
    try {
      const cliente = criarCliente(args.token, fetch, {
        login: 'unificado',
        igUserId: conta.igUserId,
      });
      const perfil = await cliente.me();
      // Falha na gravação DEPOIS daqui deixa a conta assinada sem conexão: as
      // entregas chegam, não casam conexão nenhuma e são descartadas com log
      // (ruído, não vazamento). Entrar de novo assina de novo e resolve.
      if (args.assinar !== false) await cliente.assinarWebhooks(CAMPOS_DO_WEBHOOK);
      const r = await gravarCanalDoInstagram(db, {
        accountId: args.accountId,
        userId: args.userId,
        // `null` = nasce como `@username`; reconectar preserva o rótulo.
        label: null,
        accessToken: args.token,
        igAppSecret: args.appSecret,
        humanAgent: null,
        perfil,
        tokenExpiraEm,
        login: args.login ?? 'unificado',
        clientBusinessId: args.alcance.clientBusinessId,
      });
      if (r.ok) {
        resultado.conectadas.push({
          canalId: r.canal.id,
          username: perfil.username,
          reconectado: r.reconectado,
        });
      } else {
        resultado.naoEntraram.push({
          conta: `@${perfil.username}`,
          igUserId: conta.igUserId,
          motivo: r.codigo === 'outra_conta' ? 'outra_conta' : 'erro',
          detalhe: null,
        });
      }
    } catch (err) {
      if (err instanceof InstagramApiError) {
        // A mensagem já vem sem segredo nem token (`semSegredo`).
        console.warn('[instagram/unificado] a Meta recusou:', nome, err.codigo, err.message);
        resultado.naoEntraram.push({ conta: nome, igUserId: conta.igUserId, motivo: 'meta', detalhe: err.message });
      } else {
        console.error(
          '[instagram/unificado] falha inesperada:',
          nome,
          err instanceof Error ? err.message : err
        );
        resultado.naoEntraram.push({ conta: nome, igUserId: conta.igUserId, motivo: 'erro', detalhe: null });
      }
    }
  }
  return resultado;
}
