// ============================================================
// Popup preso ao CABEÇALHO (o menu da conta e o das conexões): abre SEMPRE
// para baixo.
//
// Relato do operador (02/10/2026): no app instalado no iPhone, os dois
// abriam para CIMA e saíam cortados — e o item do modo anônimo, que mora no
// menu da conta, ficava inalcançável. O Chrome do computador, mesmo com a
// tela de celular, não reproduz. Para o base-ui escolher o lado de cima, ele
// precisa ter medido MENOS espaço abaixo do gatilho, que está no topo da
// tela, do que os poucos pixels acima dele: a medição da área visível estava
// errada naquele aparelho. Por isso as duas travas andam juntas:
// - o lado não inverte (`ABRE_PARA_BAIXO`): no topo da tela, "para cima" nunca
//   é a resposta certa;
// - a altura máxima sai da TELA (`--altura-visivel`, a mesma da casca, com
//   queda em `100dvh`), nunca da `--available-height` que o base-ui calcula
//   com a mesma medição torta — presa a ela, o menu encolheria até sumir.
//   A classe é escrita à mão em cada popup (classe do Tailwind é literal).
// ============================================================

/** O lado nunca inverte; a largura ainda se ajusta à tela. */
export const ABRE_PARA_BAIXO = {
  side: "none",
  align: "shift",
  fallbackAxisSide: "none",
} as const;
