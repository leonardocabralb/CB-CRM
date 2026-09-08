/**
 * Telefone como GENTE o escreve — e como o CRM o guarda.
 *
 * Nasceu para o Calendly (977), que não tem campo "telefone": o número vem do lembrete por SMS
 * (`text_reminder_number`, sempre com DDI: "+55 96 99112-6767") ou do que o
 * cliente DIGITOU numa pergunta do formulário ("(96) 99112-6767",
 * "96991126767", "+55 96 9 9112-6767"…). Aqui tudo vira o formato de
 * `contacts.phone` (só dígitos, com DDI), que é o que `findExistingContact`
 * casa pelos últimos 8 dígitos.
 *
 * ⚠️ O `+` decide se o número JÁ tem DDI. Sem ele, 10 dígitos (fixo) ou 11
 * dígitos COM o nono dígito na 3ª posição (celular: DDD + 9 + 8) são lidos
 * como Brasil e ganham o 55 — é o que o cliente brasileiro digita. Com
 * ele, os dígitos entram como vieram.
 *
 * ⚠️ Por que a 3ª posição, e não "11 dígitos": um número americano em
 * dígitos ("14045551234") também tem 11, e ganhar o 55 o mandaria para
 * outro destinatário — com os dados do agendamento junto (achado do Codex
 * no PR #128). Na América do Norte o 2º dígito do código de área nunca é
 * 9 (N9X é reservado), então o "9" na 3ª posição separa os dois com
 * segurança. Número de outro país com 11 dígitos e 9 na 3ª posição
 * (Bulgária fixo: "3592…") ainda colide — escreva com `+`, que é o que a
 * dica do editor pede para número de fora.
 */

const MIN_DIGITOS = 8;
const MAX_DIGITOS = 15;

/** Dígitos do telefone no formato de `contacts.phone`, ou `null` se não parece um. */
export function digitosDoTelefone(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const aparado = texto.trim();
  const comDdi = aparado.startsWith("+") || aparado.startsWith("00");
  let digitos = aparado.replace(/\D/g, "");
  if (aparado.startsWith("00")) digitos = digitos.replace(/^00/, "");
  if (digitos.length < MIN_DIGITOS || digitos.length > MAX_DIGITOS) return null;
  if (!comDdi && digitos.length === 10) return `55${digitos}`;
  if (!comDdi && digitos.length === 11 && digitos[2] === "9") return `55${digitos}`;
  return digitos;
}

/**
 * O texto tem cara de telefone? Só dígitos e pontuação de telefone, com
 * 10 a 15 dígitos — "Rua 12, nº 340" tem dígitos e não passa (tem letras).
 */
export function pareceTelefone(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const aparado = texto.trim();
  if (!/^[\s()+\-.\d]+$/.test(aparado)) return false;
  const digitos = aparado.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= MAX_DIGITOS;
}

/** "5596991126767" → "(96) 99112-6767"; fora do Brasil, "+<dígitos>". */
export function formatarTelefone(digitos: string | null | undefined): string {
  if (!digitos) return "";
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    const ddd = digitos.slice(2, 4);
    const numero = digitos.slice(4);
    const corte = numero.length - 4;
    return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
  }
  return `+${digitos}`;
}
