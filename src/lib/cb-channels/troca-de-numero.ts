// ============================================================
// O "Reparear" leu o QR com OUTRO chip? (03/10/2026)
//
// Trocar o chip de uma conexão por QR Code é "Reparear" na MESMA conexão
// (decisão do operador): tudo que aponta para ela — automações, robôs,
// filtros, conversas, funil de entrada — continua valendo, e só o número
// muda. A rota `/connect` grava o número novo em `display_phone`.
//
// O que NÃO se atualizaria sozinho é o LID do próprio aparelho
// (`cb_channels.own_lid`, 916): ele é aprendido UMA vez, sobre nulo
// (`aprenderNossoLid`, a sincronização dos grupos). Com o chip novo, o LID
// velho ficaria para sempre — a ligação feita pelo aparelho novo deixaria de
// ser "do escritório" (`ligacoes/registrar.ts`) e a menção ao número num
// grupo não acenderia (`mencionaNos`). Número mudou → `own_lid` volta a nulo
// e é reaprendido.
//
// Puro, sem I/O.
// ============================================================

function digitos(telefone: string | null | undefined): string {
  return (telefone ?? '').replace(/\D/g, '');
}

/**
 * O pareamento que acabou de abrir é de OUTRO número? Pelos dígitos (o mesmo
 * chip não vira outro por formatação). Sem o número agora (a Evolution não o
 * informou), não há o que afirmar. Sem número antes, conta como troca: zerar
 * um `own_lid` que já é nulo não custa nada, e o de um número que o CRM não
 * registrou não se confere.
 */
export function trocouDeNumero(
  antes: string | null | undefined,
  agora: string | null | undefined,
): boolean {
  const novo = digitos(agora);
  return novo !== '' && digitos(antes) !== novo;
}
