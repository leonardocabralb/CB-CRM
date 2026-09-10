// ============================================================
// O recibo que chega ANTES da mensagem.
//
// A Evolution despacha o `messages.upsert` e o `messages.update` (recibo) da
// mesma mensagem colados — e o recibo ganha a corrida dentro do CRM. Medido
// em 10/09/2026 nas mensagens que o celular pareado mandou a um cliente: a das
// 09:51:28 e o recibo de entrega dela (09:51:31) saíram JUNTOS da Evolution
// às 09:51:55, no mesmo lote da Baileys 7. Gravar a mensagem passa por
// contato, conversa e citação antes do INSERT; o recibo é um UPDATE só. No
// log do PostgREST: o PATCH do recibo às 12:51:55.708 (zero linhas) e o POST
// da mensagem às 12:51:57.644. O recibo era descartado e a bolha ficava num
// ✓ até o cliente LER — quando chega outro recibo, bem depois.
//
// ⚠️ Não é defeito da Baileys 7: 38% das mensagens do celular já ficavam
// presas em `sent` antes do upgrade (1.267 de 3.315 desde 20/08), e 34%
// depois. O envio pelo próprio CRM tem a mesma janela — a linha só nasce
// depois que a Evolution responde (`send-message.ts`).
//
// A cura é esperar a linha: sem linha, tenta de novo em pausas curtas. A
// linha EXISTIR e o UPDATE não avançar é o outro caso — recibo atrasado ou
// repetido que a escada recusou (`escada-de-status.ts`) — e aí não se insiste.
// ============================================================

/** O que o UPDATE condicional respondeu. */
export type Tentativa = 'avancou' | 'nada' | 'erro';

/**
 * Pausas entre as tentativas — 30 s ao todo. O caso medido precisou de ~2 s;
 * a folga é para o lote que a Baileys 7 despeja depois de reconectar, quando
 * dezenas de mensagens disputam o banco ao mesmo tempo.
 */
export const PAUSAS_DO_RECIBO_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * Aplica o recibo assim que a mensagem existir. Devolve `true` quando alguma
 * tentativa AVANÇOU a linha — é o que libera o fan-out do webhook público.
 */
export async function aplicarReciboQuandoAMensagemExistir(opts: {
  tentar: () => Promise<Tentativa>;
  /** A linha da mensagem já existe? */
  existe: () => Promise<boolean>;
  esperar: (ms: number) => Promise<void>;
  pausas: readonly number[];
}): Promise<boolean> {
  for (let i = 0; ; i++) {
    const r = await opts.tentar();
    if (r === 'avancou') return true;
    if (r === 'erro' || i >= opts.pausas.length) return false;

    if (await opts.existe()) {
      // A linha existe e o UPDATE não avançou: ou a escada recusou um recibo
      // velho, ou a linha nasceu ENTRE o UPDATE e esta leitura. Uma última
      // tentativa separa os dois — a escada torna a repetição inofensiva.
      return (await opts.tentar()) === 'avancou';
    }
    await opts.esperar(opts.pausas[i]);
  }
}
