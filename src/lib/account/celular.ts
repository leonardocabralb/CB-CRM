import {
  telefoneDigitado,
  type MotivoDoTelefone,
} from '@/lib/contacts/telefone';

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
 * ⚠️ Número de fora do Brasil só com `+` (ou 00) escrito — aí o código do
 * país é o que foi escrito. SEM ele, o resultado tem de ser brasileiro (55):
 * `telefoneDigitado` devolve como veio todo número sem `+` de 12 a 15
 * dígitos (e o de 11 sem o 9 na 3ª posição), então um dígito a mais num
 * celular daqui ("11 91234-56789") passaria como "estrangeiro" e furaria a
 * exigência do celular (revisão do PR #302).
 *
 * ⚠️ Uma régua só: a tela confere antes de mandar (resposta imediata) e a rota
 * `PUT /api/cb/meu-celular` confere de novo antes de gravar. O CHECK da 1046
 * é só o piso de forma.
 */
export type MotivoDoCelular = MotivoDoTelefone | 'nao_e_celular';

export type CelularDigitado =
  { ok: true; digitos: string } | { ok: false; motivo: MotivoDoCelular };

/** Todos os motivos, para a tela e a rota tratarem cada um (e o teste cobrar as frases). */
export const MOTIVOS_DO_CELULAR: readonly MotivoDoCelular[] = [
  'vazio',
  'curto',
  'invalido',
  'nao_e_celular',
];

/**
 * Os 67 DDDs em uso no Brasil (plano de numeração da Anatel). Só dígitos de
 * 1 a 9 não bastava: "(23) 91234-5678" passava, e um erro de digitação
 * cumpria a exigência com um número que não existe (Codex, PR #302).
 */
export const DDDS_DO_BRASIL: ReadonlySet<string> = new Set([
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '21',
  '22',
  '24',
  '27',
  '28',
  '31',
  '32',
  '33',
  '34',
  '35',
  '37',
  '38',
  '41',
  '42',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '53',
  '54',
  '55',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '67',
  '68',
  '69',
  '71',
  '73',
  '74',
  '75',
  '77',
  '79',
  '81',
  '82',
  '83',
  '84',
  '85',
  '86',
  '87',
  '88',
  '89',
  '91',
  '92',
  '93',
  '94',
  '95',
  '96',
  '97',
  '98',
  '99',
]);

/** 55 + DDD + 9 + 8 dígitos (o DDD é conferido à parte, pela lista). */
const CELULAR_BRASILEIRO = /^55\d{2}9\d{8}$/;

export function celularDigitado(
  texto: string | null | undefined
): CelularDigitado {
  const r = telefoneDigitado(texto);
  if (!r.ok) return r;
  // O mesmo "escreveu o DDI?" de `telefoneDigitado`: depois de tirar as marcas
  // invisíveis que vêm de uma cópia do WhatsApp.
  const escrito = (texto ?? '').replace(/\p{Cf}/gu, '').trim();
  const comDdi = escrito.startsWith('+') || escrito.startsWith('00');
  if (!comDdi && !r.digitos.startsWith('55'))
    return { ok: false, motivo: 'invalido' };
  if (r.digitos.startsWith('55')) {
    // DDD que não existe ("20", "23"…) é número errado, não "fixo": a frase
    // de "não é celular" mandaria a pessoa procurar o 9 que ela já escreveu.
    if (!DDDS_DO_BRASIL.has(r.digitos.slice(2, 4)))
      return { ok: false, motivo: 'invalido' };
    if (!CELULAR_BRASILEIRO.test(r.digitos))
      return { ok: false, motivo: 'nao_e_celular' };
  }
  return r;
}

/** O código que a rota devolve num 400 é um dos motivos? (A tela traduz só os conhecidos.) */
export function ehMotivoDoCelular(valor: unknown): valor is MotivoDoCelular {
  return (
    typeof valor === 'string' &&
    (MOTIVOS_DO_CELULAR as readonly string[]).includes(valor)
  );
}
