// ============================================================
// A conexão pela central do Instagram (U-3) que sai do CRM: a conta para de
// entregar ao app da Atlas (`DELETE {ig-id}/subscribed_apps`, com o token do
// próprio escritório) e a central apaga a rota dela, para a conta poder ir a
// outro escritório. Best-effort e NUNCA lança: a remoção da conexão não
// espera a Meta nem a central (uma rota que sobra só faz a central repassar
// entregas que este CRM descarta, com log).
// ============================================================

import { decrypt } from '@/lib/whatsapp/encryption';

import { criarClienteInstagram } from '../graph';
import { avisarDesconexao, estadoDoCliente, type AmbienteDoCliente } from './cliente';

export async function desligarDaCentral(
  canal: { access_token: string | null; ig_user_id: string | null },
  deps: { fetchFn?: typeof fetch; env?: AmbienteDoCliente } = {}
): Promise<void> {
  const igUserId = canal.ig_user_id;
  if (!igUserId) return;
  const fetchFn = deps.fetchFn ?? fetch;
  if (canal.access_token) {
    try {
      await criarClienteInstagram(decrypt(canal.access_token), fetchFn, {
        login: 'unificado',
        igUserId,
      }).tirarWebhooks();
    } catch (err) {
      // A mensagem já vem sem o token (`semSegredo`).
      console.warn(
        '[instagram/central] a assinatura do webhook não saiu:',
        err instanceof Error ? err.message : err
      );
    }
  }
  const central = estadoDoCliente(deps.env);
  if (central.ligado && central.incompleto === null) {
    await avisarDesconexao(central.cliente, igUserId, fetchFn);
  } else {
    console.warn('[instagram/central] sem a central no ambiente: a rota da conta fica lá');
  }
}
