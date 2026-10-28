// ============================================================
// A fábrica das URLs que o INBOX escreve (os `router.replace` da página) e
// que as jornadas do funil e da pauta de reuniões produzem. Existe porque o
// param `de` (a faixa "Voltar ao funil" / "Voltar às reuniões") precisa
// SOBREVIVER aos replaces ao trocar de conversa — com as strings montadas à
// mão em cada handler, o primeiro clique já apagava a faixa. As outras telas
// que produzem `/inbox?c=` (notificações, agendadas, radar, tarefas, painel)
// podem usá-la sem `de`: não têm faixa de volta.
//
// ⚠️ `c` VENCE `etapa`: os dois juntos não têm leitor — `c` abre uma
// conversa, `etapa` semeia o filtro da lista, e emitir os dois faria a URL
// prometer duas coisas.
//
// ⚠️ `etapa` é porta de ENTRADA, não espelho do filtro. Quem navega de novo
// (replace ao trocar de conversa) NÃO a repete: preservá-la faria o filtro
// que o operador limpou no painel voltar no reload — a pastilha do painel é
// quem conta a verdade sobre o recorte.
//
// ⚠️ `de` só é emitido com os valores que têm leitor: "funil" (a faixa
// "Voltar ao funil"), "reunioes" (a faixa "Voltar às reuniões", da pauta),
// "notificacoes" e "meu-dia" (as faixas "Voltar às notificações" e "Voltar ao
// Meu dia", do clique num aviso — pedido do operador, 28/10/2026).
// Reemitir verbatim fazia um `de=qualquercoisa` de link colado grudar em
// todos os replaces da sessão, sem UI nenhuma para removê-lo.
// ============================================================

import { UUID } from "@/lib/tasks/validar";

/** As telas que abrem a caixa de entrada com uma faixa de volta. */
export type OrigemDoInbox = "funil" | "reunioes" | "notificacoes" | "meu-dia";

/** O `de` da URL tem leitor? Valor desconhecido (link colado) não passa. */
export function ehOrigemDoInbox(
  de: string | null | undefined,
): de is OrigemDoInbox {
  return de === "funil" || de === "reunioes" || de === "notificacoes" || de === "meu-dia";
}

/**
 * Qual número do indicador do Meu dia foi clicado: "não lidos" liga o filtro
 * "Não lidas"; "em atraso", o "Em atraso".
 */
export type VerDoInbox = "nao-lidas" | "em-atraso";

function ehVerDoInbox(v: string | null | undefined): v is VerDoInbox {
  return v === "nao-lidas" || v === "em-atraso";
}

/** O recorte que os indicadores do Meu dia pedem à caixa de entrada. */
export interface RecorteDaUrl {
  conexao: string;
  ver: VerDoInbox | null;
}

/**
 * `?conexao=<id>&ver=…` lidos da URL, em PARSE: conexão que não tem forma de
 * id não semeia nada, e `ver` desconhecido é ignorado (a conexão sozinha
 * ainda recorta). Se a conexão existe e está no perfil, quem confere é a
 * lista, quando o catálogo chega.
 */
export function recorteDaUrl(
  conexao: string | null | undefined,
  ver: string | null | undefined,
): RecorteDaUrl | null {
  if (!conexao || !UUID.test(conexao)) return null;
  return { conexao, ver: ehVerDoInbox(ver) ? ver : null };
}

/**
 * `?nota=<id>` lido da URL, em PARSE: o que não tem forma de id não pede salto
 * nenhum. Se a anotação existe e é desta conversa, quem confere é o fio — o
 * salto só acontece se a âncora dela aparecer.
 */
export function notaDaUrl(nota: string | null | undefined): string | null {
  return nota && UUID.test(nota) ? nota : null;
}

/**
 * ⚠️ `conexao` e `ver` são porta de ENTRADA, como `etapa` (os indicadores de
 * conexão do Meu dia): `c` e `etapa` vencem, e quem navega de novo não os
 * repete — a pastilha do painel é quem conta o recorte depois.
 *
 * ⚠️ `nota` (1114) também é porta de entrada: o aviso de anotação abre a
 * conversa JÁ no trecho que o gerou. Só sai com `c` — sem a conversa não há
 * fio onde saltar — e quem navega de novo não a repete (o salto é um evento,
 * não um estado da tela).
 */
export function urlDoInbox(params: {
  c?: string | null;
  nota?: string | null;
  etapa?: string | null;
  de?: string | null;
  conexao?: string | null;
  ver?: VerDoInbox | null;
}): string {
  const partes: string[] = [];
  if (params.c) {
    partes.push(`c=${encodeURIComponent(params.c)}`);
    if (params.nota) partes.push(`nota=${encodeURIComponent(params.nota)}`);
  } else if (params.etapa) {
    partes.push(`etapa=${encodeURIComponent(params.etapa)}`);
  } else if (params.conexao) {
    partes.push(`conexao=${encodeURIComponent(params.conexao)}`);
    if (ehVerDoInbox(params.ver)) partes.push(`ver=${params.ver}`);
  }
  if (ehOrigemDoInbox(params.de)) partes.push(`de=${params.de}`);
  return partes.length > 0 ? `/inbox?${partes.join("&")}` : "/inbox";
}

/**
 * Pedido de abertura de conversa vindo de FORA da página do inbox com ela já
 * montada — hoje, o clique no aviso do navegador. O `router.push` sozinho só
 * troca a query: a página não remonta, o deep link só é lido quando a lista
 * recarrega, e a URL passava a dizer uma conversa com o fio mostrando outra.
 * O `detail` é o id da conversa.
 */
export const EVENTO_ABRIR_CONVERSA = "cb:abrir-conversa";

/**
 * O par do `EVENTO_ABRIR_CONVERSA` no aviso de ANOTAÇÃO (1114): além de abrir
 * a conversa, o fio salta até a anotação que gerou o aviso. Sinal PRÓPRIO, e
 * não um `detail` mais gordo no de abrir: abrir e saltar são coisas distintas
 * (o aviso de mensagem só abre), e com a conversa já aberta só o salto age.
 */
export const EVENTO_IR_PARA_NOTA = "cb:ir-para-nota";

/** O `detail` do `EVENTO_IR_PARA_NOTA`. */
export interface PedidoDeIrParaNota {
  conversaId: string;
  notaId: string;
}

/**
 * A caixa de entrada ABRIU esta conversa (o `detail` é o id). Quem ouve: o
 * aviso do navegador, que tira da fila de espera a mensagem que a pessoa
 * acabou de ver. Amostrar a URL de tempos em tempos perdia quem abre e sai
 * entre dois tiques, e a mensagem já lida virava aviso depois (Codex, PR #289).
 */
export const EVENTO_CONVERSA_ABERTA = "cb:conversa-aberta";
