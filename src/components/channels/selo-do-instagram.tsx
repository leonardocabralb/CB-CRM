// ============================================================
// A marca do Instagram Direct na caixa de entrada: o atendente sabe,
// "passando o olho", que a conversa NÃO é de WhatsApp (pedido do operador,
// 21/11/2026). A ficha só do Instagram tem nome e foto como qualquer outra,
// e a linha dela saía idêntica à do WhatsApp da mesma pessoa — a bolinha da
// conexão não ajuda: com sete conexões, a paleta de seis repete o violeta.
//
// O desenho foi escolhido pelo operador entre três (prints no PR): o selo no
// canto da foto, na lista e no cabeçalho, mais a pastilha escrita no
// cabeçalho. Não é o anel em volta do avatar que ele retirou antes.
//
// ⚠️ Classes LITERAIS (a regra da `PALETA_DE_CANAIS`): o Tailwind varre o
// fonte e não gera classe montada em tempo de execução.
//
// ⚠️ Quem decide "é Instagram" é o CHAMADOR, pelo predicado (`ehInstagram`),
// e só com os canais carregados: estas peças não afirmam nada sozinhas, e
// lista de canais vazia não vira "é Instagram".
// ============================================================

import { cn } from '@/lib/utils';

import { InstagramGlyph } from './instagram-glyph';

/** O degradê do Instagram (amarelo → rosa → roxo), do canto de baixo. */
const DEGRADE_DO_INSTAGRAM =
  'bg-linear-to-tr from-amber-400 via-pink-500 to-purple-600';

/**
 * O glifo do Instagram num círculo com o degradê: o selo que vai no canto do
 * avatar. O `ring` na cor do cartão descola o selo da foto.
 */
export function SeloDoInstagram({
  className,
  rotulo,
}: {
  className?: string;
  /**
   * Texto para leitor de tela e `title`. Sem ele, o selo é só decoração:
   * para quando um texto ao lado já diz "Instagram".
   */
  rotulo?: string;
}) {
  return (
    <span
      title={rotulo}
      aria-hidden={rotulo ? undefined : true}
      className={cn(
        'inline-flex items-center justify-center rounded-full text-white ring-2 ring-card',
        DEGRADE_DO_INSTAGRAM,
        className,
      )}
    >
      <InstagramGlyph className="h-[62%] w-[62%]" />
      {rotulo && <span className="sr-only">{rotulo}</span>}
    </span>
  );
}

/** A pastilha escrita, com o degradê: "Instagram Direct". */
export function PastilhaDoInstagram({
  className,
  texto,
}: {
  className?: string;
  texto: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold leading-4 text-white',
        DEGRADE_DO_INSTAGRAM,
        className,
      )}
    >
      <InstagramGlyph className="h-2.5 w-2.5" />
      {texto}
    </span>
  );
}
