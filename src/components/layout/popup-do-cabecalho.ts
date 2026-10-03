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
// - a altura máxima é a `--available-height` do base-ui (o espaço abaixo do
//   gatilho — desconta a faixa do "Ver como", que empurra o cabeçalho para
//   baixo: um teto fixo pela tela deixava o fim da lista fora dela, Codex no
//   PR #375) com PISO de 16rem (`max-h-[max(var(--available-height),16rem)]`):
//   a mesma medição torta que fazia o lado inverter encolheria o menu até
//   sumir. A classe é escrita à mão em cada popup (classe do Tailwind é
//   literal).
// ============================================================

/** O lado nunca inverte; a largura ainda se ajusta à tela. */
export const ABRE_PARA_BAIXO = {
  side: "none",
  align: "shift",
  fallbackAxisSide: "none",
} as const;
