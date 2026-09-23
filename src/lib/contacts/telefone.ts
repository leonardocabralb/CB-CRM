/**
 * Telefone como GENTE o escreve — e como o CRM o guarda.
 *
 * Nasceu para o Calendly (977), que não tem campo "telefone": o número vem do lembrete por SMS
 * (`text_reminder_number`, sempre com DDI: "+55 96 99000-0016") ou do que o
 * cliente DIGITOU numa pergunta do formulário ("(96) 99000-0016",
 * "96990000016", "+55 96 9 9000-0016"…). Aqui tudo vira o formato de
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

/** Por que um telefone DIGITADO foi recusado — cada motivo tem a sua frase. */
export type MotivoDoTelefone = "vazio" | "curto" | "invalido";

export type TelefoneDigitado =
  | { ok: true; digitos: string }
  | { ok: false; motivo: MotivoDoTelefone };

/**
 * Um telefone que uma PESSOA digitou (formulário, ficha, planilha), no
 * formato de `contacts.phone` — ou o motivo de não servir.
 *
 * É a metade ADITIVA do #586 do original, com a NOSSA régua: lá o `+` virou
 * obrigatório; aqui o número brasileiro sem `+` continua ganhando o 55
 * (`digitosDoTelefone`), porque é assim que o escritório digita. O que muda
 * é que, até aqui, as telas gravavam o texto CRU: "(81) 98874-5316" virava a
 * ficha "81988745316", que sai para +81 (Japão) — e o CSV do disparo criava
 * uma ficha nova assim em vez de achar a do cliente.
 *
 * Três recusas que `digitosDoTelefone` deixa passar, porque ele também serve
 * a quem lê número de sistema (Calendly, Asaas), não só a quem digita:
 * - ⚠️ **Sem `+`, menos de 10 dígitos é "curto"** (faltou o DDD): "98874-5316"
 *   passaria como "988745316" e sairia para +98 (Irã). Com `+`, o piso é o de
 *   `isValidE164` (8), porque ali o código do país foi escrito.
 * - **Letra no meio é "invalido"**: `digitosDoTelefone` apaga tudo que não é
 *   dígito, e "81 9887 ramal 45" viraria um número que ninguém escreveu.
 * - **Começar em 0 é "invalido"** (tronco: "081 98874-5316"): cortar o 0
 *   acertaria esse caso e erraria o "0800", então a pessoa reescreve.
 * - **DDI 55 exige DDD + 8 ou 9 dígitos** (12 ou 13 no total): 55 é só o
 *   Brasil, e "+55 81 9887-453" (faltou um dígito) iria para um número que
 *   não existe.
 */
export function telefoneDigitado(texto: string | null | undefined): TelefoneDigitado {
  // ⚠️ Copiar um número do WhatsApp traz marcas de direção invisíveis em volta
  // (U+202A…U+202C), e editores trocam o hífen por traço tipográfico. Nada
  // disso é "letra": sem esta limpeza, o número colado de lá era recusado como
  // inválido sem nada visível errado na caixa (revisão da Fase 3-II).
  const aparado = (texto ?? "")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .trim()
    // Planilha salva pelo pandas (e por quem converte a coluna para número)
    // escreve "81988745316.0": sem cortar o ".0", o zero vira um dígito a mais
    // e o número sai para +81. Só a forma inteira "dígitos.0" é cortada.
    .replace(/^(\+?\d+)\.0+$/, "$1");
  if (!aparado) return { ok: false, motivo: "vazio" };
  if (!/^\+?[\d\s().-]+$/.test(aparado)) return { ok: false, motivo: "invalido" };

  const comDdi = aparado.startsWith("+") || aparado.startsWith("00");
  let escritos = aparado.replace(/\D/g, "");
  if (aparado.startsWith("00")) escritos = escritos.slice(2);
  if (escritos.length < (comDdi ? MIN_DIGITOS : 10)) return { ok: false, motivo: "curto" };

  const digitos = digitosDoTelefone(aparado);
  if (!digitos || digitos.startsWith("0")) return { ok: false, motivo: "invalido" };
  if (digitos.startsWith("55") && digitos.length !== 12 && digitos.length !== 13) {
    return { ok: false, motivo: "invalido" };
  }
  return { ok: true, digitos };
}

/**
 * O que gravar em `contacts.phone` quando uma pessoa salva a ficha (o
 * formulário de contato e a ficha de /contatos): `phone` AUSENTE = não mexe;
 * string = os dígitos normalizados; `null` = a ficha fica sem telefone; ou o
 * motivo da recusa. Uma decisão só para as duas telas — cada uma chama isto
 * uma vez, e há pino cobrando (`telefone-digitado.chamadores.test.ts`).
 *
 * ⚠️ Na EDIÇÃO, "não mudou" não passa pela régua, de propósito: há fichas
 * antigas fora dela (número estrangeiro de 11 dígitos, uma com `+`), e
 * corrigir o NOME de uma delas não pode esbarrar num telefone que ninguém
 * tocou — nem regravá-lo. A comparação é contra o que a TELA carregou,
 * aparada dos dois lados. Na CRIAÇÃO não há "antes": tudo passa pela régua.
 *
 * `podeFicarSem` é a ficha só do Instagram (989): apagar o telefone dela é
 * legítimo e grava `null` — nunca `""`: a ficha sem telefone é `phone IS NULL`
 * desde a 989, e é por aí que o disparo, as fotos e as telas a reconhecem.
 *
 * ⚠️ Limite aceito (revisão da Fase 3-II): número ESTRANGEIRO guardado só em
 * dígitos com 10, ou 11 com 9 na 3ª posição (Peru "51912345678"), editado sem
 * `+`, é relido como brasileiro. Medido em 23/09/2026: ZERO fichas assim — as
 * 17 estrangeiras da base têm 12 dígitos ou mais.
 */
export function escritaDoTelefone(
  antes: string | null | undefined,
  digitado: string,
  opcoes: { criacao?: boolean; podeFicarSem?: boolean } = {},
): { ok: true; phone?: string | null } | { ok: false; motivo: MotivoDoTelefone } {
  if (!opcoes.criacao && digitado.trim() === (antes ?? "").trim()) return { ok: true };
  const r = telefoneDigitado(digitado);
  if (r.ok) return { ok: true, phone: r.digitos };
  if (r.motivo === "vazio" && opcoes.podeFicarSem && !opcoes.criacao) return { ok: true, phone: null };
  return r;
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

/** "5596990000016" → "(96) 99000-0016"; fora do Brasil, "+<dígitos>". */
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

/**
 * As grafias de um celular brasileiro que o CRM pode ter guardado: a que veio
 * e a irmã com/sem o NONO DÍGITO.
 *
 * `contacts.phone` guarda só dígitos com DDI, e o mesmo cliente existe na
 * base ora como "5583980000016" (13 dígitos, com o 9), ora como
 * "558380000016" (12, sem) — depende de quem gravou: o WhatsApp entrega o
 * JID sem o 9 para número antigo, o CSV vem como o escritório digitou, o
 * Calendly como o cliente escreveu. `findExistingContact` já tolera isso ao
 * CASAR (últimos 8 dígitos); a busca da caixa de entrada não tolerava —
 * digitar o número com o 9 não achava a ficha gravada sem ele, e a leitura
 * do operador era que o cliente não estava no CRM (reportado em 09/09/2026).
 *
 * ⚠️ Só celular: o 9 foi acrescentado apenas aos números móveis, que
 * começam em 6, 7, 8 ou 9. Inserir um 9 num fixo fabricaria um número que
 * não existe — inofensivo para a busca, mas a regra escrita é a real.
 *
 * ⚠️ Só com DDI 55 na frente, porque é assim que a coluna guarda. Um número
 * sem DDI ou de outro país volta sozinho, sem irmã.
 *
 * A forma original vem SEMPRE primeiro; a irmã, só quando existe.
 */
export function variantesDoNonoDigito(digitos: string): string[] {
  if (!digitos.startsWith("55")) return [digitos];
  // 55 + DDD (2) + 9 + 8 dígitos = 13: a irmã é sem o 9.
  if (digitos.length === 13 && digitos[4] === "9" && /[6-9]/.test(digitos[5])) {
    return [digitos, digitos.slice(0, 4) + digitos.slice(5)];
  }
  // 55 + DDD (2) + 8 dígitos = 12: a irmã ganha o 9 depois do DDD.
  if (digitos.length === 12 && /[6-9]/.test(digitos[4])) {
    return [digitos, `${digitos.slice(0, 4)}9${digitos.slice(4)}`];
  }
  return [digitos];
}

/**
 * A grafia CANÔNICA de um telefone: só dígitos e, no celular brasileiro de 12
 * dígitos (55 + DDD + 8, começando em 6–9), COM o nono dígito depois do DDD.
 * As duas grafias que `variantesDoNonoDigito` devolve têm sempre a MESMA
 * canônica — é a chave de "mesma pessoa".
 *
 * ⚠️ ESPELHO da coluna gerada `contacts.telefone_canonico` (1024), que é a
 * chave ÚNICA por conta: mudar a régua num lado sem o outro faz o código
 * achar "pessoa nova" onde o banco vê a mesma (23505 na cara) ou o contrário.
 * Há teste lendo a migration.
 */
export function telefoneCanonico(telefone: string | null | undefined): string {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  return /^55\d{2}[6-9]\d{7}$/.test(digitos)
    ? `${digitos.slice(0, 4)}9${digitos.slice(4)}`
    : digitos;
}
