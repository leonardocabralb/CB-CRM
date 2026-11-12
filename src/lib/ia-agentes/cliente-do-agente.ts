import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { CABECALHO_REF, CABECALHO_VIA } from '@/lib/conversations/origem-da-escrita'

// ============================================================
// O cliente de service role com que o AGENTE DE IA escreve o que a trilha
// registra (1141): mover o card e pôr/tirar etiqueta. Todo pedido dele leva
// `x-cb-via: agente` e `x-cb-ref: <agente>`, e os gatilhos de `deals` e de
// `contact_tags` (912, recriados na 1141) gravam a via e o nome do agente na
// linha — a faixa cinza do fio diz "pelo agente de IA <nome>" em vez de
// "pelo sistema". É por isso que a ação de etapa e de etiqueta não deixa mais
// anotação: a faixa já diz quem foi.
//
// ⚠️ Um cliente PRÓPRIO por agente, nunca o `supabaseAdmin()` compartilhado
// (o mesmo motivo do `clienteDaApi`): o cabeçalho carimbaria como "agente" a
// escrita de quem não é. Os escritores centrais de etiqueta
// (`addContactTagAndDispatch`, `removeContactTag`) recebem o cliente — por
// isso não precisam saber de origem.
//
// ⚠️ RÓTULO, não credencial (a 1083 só lê o cabeçalho com o papel service
// role). A queda é silenciosa: sem ele, a faixa volta a dizer "pelo sistema".
// ============================================================

const clientes = new Map<string, SupabaseClient>()

export function clienteDoAgente(agenteId: string): SupabaseClient {
  let cliente = clientes.get(agenteId)
  if (!cliente) {
    cliente = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      global: { headers: { [CABECALHO_VIA]: 'agente', [CABECALHO_REF]: agenteId } },
    })
    clientes.set(agenteId, cliente)
  }
  return cliente
}
