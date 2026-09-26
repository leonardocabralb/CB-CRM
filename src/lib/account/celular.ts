import { telefoneDigitado, type MotivoDoTelefone } from '@/lib/contacts/telefone';

/**
 * O celular que um MEMBRO da equipe digita para si (a tela de exigência na
 * entrada do CRM e o cartão de Seu perfil), no formato em que é guardado em
 * `cb_celulares_dos_membros` (1046): só dígitos, com o código do país.
 *
 * É a régua das telas do CRM (`telefoneDigitado`: o brasileiro sem DDI ganha
 * o 55, sem DDD é "curto", letra e 0 de tronco são recusados) MAIS uma
 * exigência: número brasileiro tem de ser de CELULAR — DDD + 9 + 8 dígitos.
 * O número serve para o CRM mandar mensagem particular à pessoa, e fixo não
 * recebe WhatsApp.
 *
 * ⚠️ O celular antigo SEM o 9 (55 + DDD + 8, a grafia que o WhatsApp ainda
 * entrega em JID de número velho) é recusado de propósito: quem digita o
 * PRÓPRIO celular hoje escreve o 9, e aceitar a grafia de 8 abriria a porta
 * para o fixo, que tem a mesma forma.
 *
 * ⚠️ Número de fora do Brasil passa como `telefoneDigitado` o lê — com `+`
 * (ou 00) o código do país é o que foi escrito. Sem `+`, 10 ou 11 dígitos
 * são lidos como brasileiros (a régua de sempre); a tela pede o `+`.
 *
 * ⚠️ Uma régua só: a tela confere antes de mandar (resposta imediata) e a rota
 * `PUT /api/cb/meu-celular` confere de novo antes de gravar. O CHECK da 1046
 * é só o piso de forma.
 */
export type MotivoDoCelular = MotivoDoTelefone | 'nao_e_celular';

export type CelularDigitado =
  | { ok: true; digitos: string }
  | { ok: false; motivo: MotivoDoCelular };

/** Todos os motivos, para a tela e a rota tratarem cada um (e o teste cobrar as frases). */
export const MOTIVOS_DO_CELULAR: readonly MotivoDoCelular[] = [
  'vazio',
  'curto',
  'invalido',
  'nao_e_celular',
];

/** 55 + DDD (dois dígitos de 1 a 9: nenhum DDD tem 0). */
const DDD_BRASILEIRO = /^55[1-9]{2}/;

/** 55 + DDD + 9 + 8 dígitos. */
const CELULAR_BRASILEIRO = /^55[1-9]{2}9\d{8}$/;

export function celularDigitado(texto: string | null | undefined): CelularDigitado {
  const r = telefoneDigitado(texto);
  if (!r.ok) return r;
  if (r.digitos.startsWith('55')) {
    // DDD que não existe ("20", "30"…) é número errado, não "fixo": a frase
    // de "não é celular" mandaria a pessoa procurar o 9 que ela já escreveu.
    if (!DDD_BRASILEIRO.test(r.digitos)) return { ok: false, motivo: 'invalido' };
    if (!CELULAR_BRASILEIRO.test(r.digitos)) return { ok: false, motivo: 'nao_e_celular' };
  }
  return r;
}

/** O código que a rota devolve num 400 é um dos motivos? (A tela traduz só os conhecidos.) */
export function ehMotivoDoCelular(valor: unknown): valor is MotivoDoCelular {
  return typeof valor === 'string' && (MOTIVOS_DO_CELULAR as readonly string[]).includes(valor);
}
