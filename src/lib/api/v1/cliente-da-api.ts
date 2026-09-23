import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// O cliente de service role das rotas da API pública (`/api/v1`).
//
// É um cliente PRÓPRIO, e não o `supabaseAdmin()` de `flows/admin-client.ts`,
// por um motivo só: todo pedido dele leva o cabeçalho `x-cb-origem: api`. O
// PostgREST publica os cabeçalhos do pedido na GUC `request.headers`, e o
// gatilho da fila do funil (migration 1040) os lê para carimbar a ORIGEM do
// movimento de card como `api` — é o que deixa o integrador separar "eu mesmo
// movi pela API" (o que ele filtra para não entrar em laço) de "uma automação
// moveu" nos avisos `deal.*`.
//
// ⚠️ NUNCA pôr o cabeçalho no `supabaseAdmin()` compartilhado: ele é
// importado pelo motor de fluxos, pelos webhooks de entrada e por mais uma
// dezena de módulos, e carimbaria como `api` escritas que não vêm da API. E o
// inverso: rota v1 nova usa `ctx.supabase` (este cliente), nunca o admin
// compartilhado, senão o movimento sai `system`. Há pino em
// `cliente-da-api.test.ts`.
//
// ✅ Que o gateway da Supabase repasse o cabeçalho e o PostgREST o publique
// em `request.headers` foi MEDIDO contra a produção em 23/09/2026, depois de
// aplicar a 1040 (ver a nota da origem `api` no CLAUDE.md).
// Se um dia ele deixar de chegar, a queda NÃO é inofensiva: o movimento pela
// API volta a sair `system`, sem erro nenhum, e a receita da doc
// (`source != api`) deixa de cortar o laço do fluxo que move o card pela API.
//
// ⚠️ A marca é um RÓTULO, não uma credencial: quem tem a service role pode
// mandar o cabeçalho que quiser. Ela só decide o texto de `source` no aviso;
// nada de permissão depende dela. E o que uma automação faz continua saindo
// `automation` mesmo dentro de um pedido desta API — o gatilho olha a cadeia
// e o `source` do INSERT antes do cabeçalho.
// ============================================================

/** Nome e valor do cabeçalho — o gatilho da 1040 compara com os MESMOS textos. */
export const CABECALHO_DE_ORIGEM = 'x-cb-origem';
export const ORIGEM_DA_API = 'api';

let _cliente: SupabaseClient | null = null;

export function clienteDaApi(): SupabaseClient {
  if (!_cliente) {
    _cliente = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { global: { headers: { [CABECALHO_DE_ORIGEM]: ORIGEM_DA_API } } },
    );
  }
  return _cliente;
}
