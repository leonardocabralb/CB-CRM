/**
 * O evento global que avisa a tela de que o vínculo com o Atlas mudou —
 * vincular ou desvincular uma ficha à mão (a aba Atlas). Vive FORA dos
 * hooks (como `src/lib/asaas/aviso.ts`): quem emite é a aba, e quem escuta
 * são o fio (a faixa), o painel (o botão) e a ficha de /contatos — árvores
 * diferentes, cada uma com a sua instância de `useAtlasDoContato`.
 */

export const EVENTO_ATLAS_MUDOU = "cb:atlas-mudou";

export function avisarAtlasMudou(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENTO_ATLAS_MUDOU));
}
