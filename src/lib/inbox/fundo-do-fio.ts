// ============================================================
// O fundo de desenhos do fio (a conversa aberta E o estado vazio): um
// ladrilho SVG de `public/` repetido sobre o `bg-background`.
//
// Um por marca: com a marca PADRÃO, o símbolo do Atlas
// (`inbox-doodle-atlas.svg`, escolha do operador, 17/11/2026); com marca
// própria, os ícones neutros (`inbox-doodle.svg`) — marca própria nunca
// herda imagem do Atlas (`.claude/rules/marca.md`). Os dois no mesmo traço
// e no mesmo tom médio, MEDIDO (o método está no cabeçalho do SVG do Atlas).
//
// ⚠️ As classes são LITERAIS: a classe de imagem montada com variável não é
// gerada pelo Tailwind e o fio fica liso. Nem escrever a forma da classe com
// reticências num comentário: o Tailwind lê comentário, gera a classe e o
// build quebra tentando resolver o endereço (`globals.css`).
// ============================================================

export const FUNDO_NEUTRO = "/inbox-doodle.svg";
export const FUNDO_DO_ATLAS = "/inbox-doodle-atlas.svg";

/** As classes do fundo do fio para a marca da instalação. */
export function fundoDoFio(marcaPropria: boolean): string {
  return marcaPropria
    ? "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat"
    : "bg-background bg-[url('/inbox-doodle-atlas.svg')] bg-repeat";
}
