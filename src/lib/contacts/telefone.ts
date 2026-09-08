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
 * ⚠️ O `+` decide se o número JÁ tem DDI. Sem ele, 10–11 dígitos são lidos
 * como DDD + número do Brasil e ganham o 55 — é o que o cliente brasileiro
 * digita. Com ele, os dígitos entram como vieram ("+1 404 555 1234" tem 11
 * dígitos e NÃO é um celular de São Paulo).
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
  if (!comDdi && (digitos.length === 10 || digitos.length === 11)) return `55${digitos}`;
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
