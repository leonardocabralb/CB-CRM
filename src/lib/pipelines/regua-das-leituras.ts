// ============================================================
// Régua de ordem das leituras de negócios do PAINEL da conversa
// (`painel-do-contato.tsx`). A tela de Funis tem a dela, dentro da página
// (`pedidoDosNegociosRef`/`ultimoGravadoRef`, `funil.md`); esta é a mesma
// regra com uma peça a mais.
//
// Desde que o painel relê os negócios quando o card muda por outro caminho
// (`useMudancaNoNegocio`), há leituras CONCORRENTES do mesmo contato: a carga
// do contato, a releitura de cada evento da trilha (o agente move o card e
// marca o status: dois eventos), a da volta à aba. Elas podem voltar fora de
// ordem.
//
// - ⚠️ Nenhuma leitura grava por cima de outra pedida DEPOIS dela. A régua é
//   a última que GRAVOU, nunca a última pedida: a leitura que falha não grava,
//   e a régua do pedido calaria a mais velha que deu certo.
// - ⚠️ A ESCRITA do próprio painel (etapa, status, valor, data) conta como a
//   leitura mais nova (`escreveu`): uma leitura pedida antes dela voltaria com
//   a foto de antes e desfaria na tela o que o operador acabou de salvar —
//   o valor e a data nem geram evento para corrigir depois. Mas essa leitura
//   foi pedida por um MOTIVO (outro caminho mudou o card), e calá-la perderia
//   a mudança: por isso `escreveu` diz se havia leitura no ar, e quem chama
//   relê de novo.
// ============================================================

export interface ReguaDasLeituras {
  /** Número da leitura que vai começar. */
  pedir(): number;
  /** A leitura `n` voltou bem: pode gravar? Se pode, a régua avança até ela. */
  podeGravar(n: number): boolean;
  /**
   * O painel gravou o negócio e pôs o resultado na tela. Leituras pedidas
   * antes não gravam mais; `true` = havia leitura no ar, e quem chama relê.
   */
  escreveu(): boolean;
}

export function criarReguaDasLeituras(): ReguaDasLeituras {
  let pedidas = 0;
  let gravada = 0;
  return {
    pedir: () => ++pedidas,
    podeGravar: (n) => {
      if (n <= gravada) return false;
      gravada = n;
      return true;
    },
    escreveu: () => {
      const haviaNoAr = pedidas > gravada;
      gravada = ++pedidas;
      return haviaNoAr;
    },
  };
}
