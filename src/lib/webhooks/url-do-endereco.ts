// ============================================================
// NOSSO: a régua da URL do webhook de saída para as rotas de SESSÃO
// (`/api/cb/webhooks-de-saida`, a tela Configurações → Webhooks → Enviados).
//
// A régua é a do original (`checkWebhookUrl`, `endpoints.ts`, #681): https,
// e SEM usuário e senha na URL — o `fetch` do Node recusa URL com credencial,
// então toda entrega falharia até desligar o endpoint, com a senha na
// listagem. A v1 devolve a `message` dela (inglês, contrato da API); a tela
// precisa de um CÓDIGO para escolher a frase traduzida
// (`Settings.webhooks.urlInvalida` / `urlComCredencial`). Fica num módulo
// NOSSO para o `endpoints.ts` continuar igual ao do original.
// ============================================================

import { checkWebhookUrl } from '@/lib/webhooks/endpoints';

export type MotivoDaUrlRecusada = 'url_invalida' | 'url_com_credencial';

export type UrlDoEndereco =
  | { ok: true; url: string }
  | { ok: false; motivo: MotivoDaUrlRecusada };

export function conferirUrlDoEndereco(entrada: unknown): UrlDoEndereco {
  const conferida = checkWebhookUrl(entrada);
  if (conferida.ok) return conferida;
  return {
    ok: false,
    motivo: ehHttpsComCredencial(entrada) ? 'url_com_credencial' : 'url_invalida',
  };
}

// Na MESMA ordem do original: `http://usuario:senha@…` é recusada por não ser
// https, e a tela diz isso — não a frase da credencial.
function ehHttpsComCredencial(entrada: unknown): boolean {
  if (typeof entrada !== 'string') return false;
  try {
    const u = new URL(entrada.trim());
    return u.protocol === 'https:' && Boolean(u.username || u.password);
  } catch {
    return false;
  }
}
