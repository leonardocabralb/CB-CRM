// ============================================================
// Mover o card com 4 segundos para desfazer — e a garantia de que o
// movimento ACONTECE mesmo se a pessoa sair (decisão do operador,
// 29/09/2026: "apertar no botão → contador de 4 segundos → eu sair da
// página ou atualizar → a ação não ser finalizada" é o que não pode haver).
//
// Durante os 4 s NADA é enviado: "Desfazer" só cancela o relógio — nenhuma
// automação da etapa chega a disparar. Depois deles, o pedido vai à rota
// `POST /api/cb/negocios/[id]/mover`, que só move se o card AINDA está na
// etapa de origem.
//
// As saídas antes do prazo concluem NA HORA, cada uma por um caminho:
// - trocar de conversa ou sair do painel: quem monta o botão chama
//   `concluirAgora` na limpeza (o app continua vivo, o pedido termina);
// - atualizar, fechar a aba, ir para outro app no celular: `pagehide` e
//   `visibilitychange` (o último evento confiável no celular) chamam
//   `concluirTodosAgora`, e o pedido sai com `keepalive` — o navegador o
//   entrega mesmo com a página indo embora.
// ⚠️ E a RESERVA: o pedido fica no `localStorage` do aparelho desde o
// clique até o servidor dar uma resposta DEFINITIVA. Se o envio não chegou
// (sem internet, o navegador morreu antes) ou a falha foi provisória (5xx
// num deploy, tempo esgotado — Codex, PR #340), `retomarMovimentosPendentes`
// refaz: sozinho a cada 30 s na mesma página, e na próxima abertura do app,
// na volta à aba e quando a conexão voltar. Refazer é seguro pelo mesmo
// motivo de sempre: a rota só move a partir da etapa de origem, e "o card já
// está na etapa de destino" conta como feito.
//
// ⚠️ A retomada espera `FOLGA_DA_RETOMADA_MS` depois do prazo: outra aba
// aberta lê o mesmo `localStorage`, e retomar um pedido ainda na janela de
// desfazer da aba dona tiraria dela o "Desfazer".
//
// ⚠️⚠️ Pedido GUARDADO trava o card (fase `tentando`), e um clique novo não
// o substitui: com os botões de volta depois de uma falha provisória, um
// clique noutra etapa apagava o pedido da fila, e o primeiro movimento se
// perdia sem "Desfazer" (Codex, PR #340). Sair do `tentando` só por três
// portas: o servidor responder, "Tentar agora", ou "Desistir" — decisão
// explícita, como o Desfazer.
//
// Módulo de biblioteca, sem React: o estado é um só para o app inteiro (o
// painel desenha, a casca retoma), e o botão pode desmontar com o pedido no
// ar. As telas assinam por `assinarMovimentos`/`fotoDoMovimento`.
// ============================================================

import { toast } from 'sonner';

import { avisarDrenagemDeFunil } from '@/lib/automations/avisar-drenagem';
import type { DealStatus } from '@/types';

/** A janela de desfazer (decisão do operador). */
export const ESPERA_PARA_DESFAZER_MS = 4000;

/** Quanto tempo o "Movido para …" / "Desfeito" fica à vista. */
export const TEMPO_DO_AVISO_MS = 2500;

/**
 * Folga depois do prazo antes de a retomada refazer um pedido que não é
 * desta aba — o tempo de a aba dona concluí-lo.
 */
export const FOLGA_DA_RETOMADA_MS = 15_000;

/** Falha provisória: nova tentativa sozinha, na mesma página, a cada tanto… */
export const INTERVALO_DE_NOVA_TENTATIVA_MS = 30_000;
/** …até este número de vezes; depois, só na volta à aba, na volta da conexão ou na abertura. */
export const MAXIMO_DE_TENTATIVAS_NA_PAGINA = 10;

/**
 * A resposta que não decide nada: o servidor não conseguiu (5xx num deploy,
 * banco lento), mandou esperar (429, 408) ou a sessão venceu (401 — o login
 * seguinte refaz). O pedido fica na fila. Só 400 e 404 são definitivos.
 *
 * ⚠️ 403 também é provisório: `getCurrentAccount` devolve Forbidden quando a
 * LEITURA do perfil ou da conta falha, sem ter decidido nada sobre o papel
 * (Codex, PR #340). O papel de fato insuficiente acaba no card travado, com
 * "Desistir" — nunca num pedido perdido.
 */
const ehProvisoria = (status: number) =>
  status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;

const CHAVE_DA_FILA = 'cb-movimentos-pendentes:';

/** Os textos já traduzidos: a retomada roda fora do React, às vezes noutra página. */
export interface TextosDoMovimento {
  /** "Negócio de Fulano movido para X". */
  movido: string;
  /** O card já tinha saído da etapa de origem; nada foi feito. */
  mudou: string;
  falhou: string;
  /** Falha provisória (sem rede, servidor fora): o CRM tenta de novo. */
  tentandoDeNovo: string;
}

export interface PedidoDeMovimento {
  dealId: string;
  /** A etapa de origem — a rota só move a partir dela. */
  de: string;
  para: string;
  textos: TextosDoMovimento;
}

interface Pendente extends PedidoDeMovimento {
  id: string;
  usuario: string;
  prazo: number;
}

export type EstadoDoMovimento =
  | { fase: 'aguardando'; para: string; prazo: number }
  | { fase: 'enviando'; para: string }
  /** Guardado no aparelho, esperando o servidor (falha provisória, ou de outra aba/página). */
  | { fase: 'tentando'; para: string }
  | { fase: 'movido'; para: string }
  | { fase: 'desfeito' };

export type ResultadoDoMovimento =
  | { tipo: 'movido'; stageId: string; status: DealStatus | null }
  | { tipo: 'mudou'; stageId: string | null }
  | { tipo: 'falhou' };

export interface Conclusao {
  dealId: string;
  resultado: ResultadoDoMovimento;
}

/** O que o módulo usa do mundo — trocado nos testes. */
export interface Ambiente {
  agora: () => number;
  enviar: typeof fetch;
  armazenamento: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  sucesso: (texto: string) => void;
  erro: (texto: string) => void;
  drenar: () => void;
}

const AMBIENTE_PADRAO: Ambiente = {
  agora: () => Date.now(),
  enviar: (...args) => fetch(...args),
  armazenamento: () => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      return null;
    }
  },
  sucesso: (texto) => toast.success(texto),
  erro: (texto) => toast.error(texto),
  drenar: () => avisarDrenagemDeFunil(),
};

let ambiente: Ambiente = AMBIENTE_PADRAO;

// Os pedidos na janela de desfazer, por negócio (um por vez).
const aguardando = new Map<string, { pedido: Pendente; relogio: ReturnType<typeof setTimeout> }>();
// Ids de pedido com o envio no ar — a retomada não os manda de novo.
const emVoo = new Set<string>();
// Falha provisória: avisa uma vez por pedido, não a cada tentativa, e conta
// as tentativas automáticas desta página.
const avisadosDaFalha = new Set<string>();
const tentativas = new Map<string, number>();
let relogioDaTentativa: ReturnType<typeof setTimeout> | null = null;
// O que cada tela desenha, por negócio. Objeto novo só quando muda: é a foto
// do `useSyncExternalStore`, que compara por identidade.
const fotos = new Map<string, EstadoDoMovimento>();
const relogiosDoAviso = new Map<string, ReturnType<typeof setTimeout>>();
const assinantes = new Set<() => void>();
const ouvintesDeConclusao = new Set<(conclusao: Conclusao) => void>();
let usuarioDaRetomada: string | null = null;
let relogioDaRetomada: ReturnType<typeof setTimeout> | null = null;
let escutando = false;

function avisarAssinantes() {
  for (const fn of assinantes) fn();
}

function definirFoto(dealId: string, foto: EstadoDoMovimento | null) {
  const relogio = relogiosDoAviso.get(dealId);
  if (relogio) clearTimeout(relogio);
  relogiosDoAviso.delete(dealId);
  if (foto) fotos.set(dealId, foto);
  else fotos.delete(dealId);
  if (foto?.fase === 'movido' || foto?.fase === 'desfeito') {
    relogiosDoAviso.set(
      dealId,
      setTimeout(() => {
        relogiosDoAviso.delete(dealId);
        fotos.delete(dealId);
        avisarAssinantes();
      }, TEMPO_DO_AVISO_MS),
    );
  }
  avisarAssinantes();
}

// ---- A fila no aparelho --------------------------------------

// Cópia em memória da fila: é ela que vale quando o `localStorage` não está
// disponível (bloqueado, cota) — sem ela, a nova tentativa da mesma página
// não acharia o pedido que acabou de falhar.
const filaEmMemoria = new Map<string, Pendente[]>();

function lerFila(usuario: string): Pendente[] {
  let bruto: string | null = null;
  try {
    const armazenamento = ambiente.armazenamento();
    if (!armazenamento) return filaEmMemoria.get(usuario) ?? [];
    bruto = armazenamento.getItem(CHAVE_DA_FILA + usuario);
  } catch {
    return filaEmMemoria.get(usuario) ?? [];
  }
  if (!bruto) return [];
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return [];
  }
  if (!Array.isArray(lido)) return [];
  // PARSE, nunca `as`: o que está no aparelho pode ser de outra versão do app.
  const texto = (v: unknown): v is string => typeof v === 'string' && v !== '';
  return lido.flatMap((item): Pendente[] => {
    if (!item || typeof item !== 'object') return [];
    const e = item as Record<string, unknown>;
    const t = (e.textos ?? {}) as Record<string, unknown>;
    if (
      !texto(e.id) || !texto(e.dealId) || !texto(e.de) || !texto(e.para) ||
      typeof e.prazo !== 'number' || !Number.isFinite(e.prazo) ||
      !texto(t.movido) || !texto(t.mudou) || !texto(t.falhou) || !texto(t.tentandoDeNovo)
    ) {
      return [];
    }
    return [{
      id: e.id, usuario, dealId: e.dealId, de: e.de, para: e.para, prazo: e.prazo,
      textos: { movido: t.movido, mudou: t.mudou, falhou: t.falhou, tentandoDeNovo: t.tentandoDeNovo },
    }];
  });
}

function gravarFila(usuario: string, fila: Pendente[]) {
  filaEmMemoria.set(usuario, fila);
  try {
    const armazenamento = ambiente.armazenamento();
    if (!armazenamento) return;
    if (fila.length === 0) {
      armazenamento.removeItem(CHAVE_DA_FILA + usuario);
      return;
    }
    armazenamento.setItem(
      CHAVE_DA_FILA + usuario,
      // Sem o `usuario`: ele é a própria chave.
      JSON.stringify(
        fila.map((e) => ({ id: e.id, dealId: e.dealId, de: e.de, para: e.para, prazo: e.prazo, textos: e.textos })),
      ),
    );
  } catch {
    // Sem armazenamento (modo privado, cota): fica só a garantia do `keepalive`.
  }
}

const tirarDaFila = (usuario: string, id: string) =>
  gravarFila(usuario, lerFila(usuario).filter((e) => e.id !== id));

// ---- O envio -------------------------------------------------

/**
 * O pedido fica na fila, e a página tenta de novo sozinha — com teto, para
 * um servidor que falha sempre não virar um laço de pedidos a cada 30 s.
 */
function tentarDeNovoMaisTarde(pedido: Pendente) {
  emVoo.delete(pedido.id);
  // Fora da fila = alguém decidiu enquanto o envio estava no ar ("Desistir",
  // ou outra aba concluiu): não há o que tentar, e travar o card o deixaria
  // travado para sempre.
  if (!lerFila(pedido.usuario).some((e) => e.id === pedido.id)) {
    definirFoto(pedido.dealId, null);
    return;
  }
  definirFoto(pedido.dealId, { fase: 'tentando', para: pedido.para });
  if (!avisadosDaFalha.has(pedido.id)) {
    avisadosDaFalha.add(pedido.id);
    ambiente.erro(pedido.textos.tentandoDeNovo);
  }
  const feitas = (tentativas.get(pedido.id) ?? 0) + 1;
  tentativas.set(pedido.id, feitas);
  if (feitas < MAXIMO_DE_TENTATIVAS_NA_PAGINA && !relogioDaTentativa) {
    relogioDaTentativa = setTimeout(() => {
      relogioDaTentativa = null;
      retomarMovimentosPendentes(pedido.usuario);
    }, INTERVALO_DE_NOVA_TENTATIVA_MS);
  }
}

async function enviar(pedido: Pendente, avisarPorToast: boolean): Promise<void> {
  if (emVoo.has(pedido.id)) return;
  emVoo.add(pedido.id);
  definirFoto(pedido.dealId, { fase: 'enviando', para: pedido.para });

  let resposta: Response;
  try {
    resposta = await ambiente.enviar(`/api/cb/negocios/${pedido.dealId}/mover`, {
      method: 'POST',
      // O pedido sobrevive à página: é o que faz atualizar ou fechar a aba
      // no meio da espera ainda mover o card.
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ de: pedido.de, para: pedido.para }),
    });
  } catch {
    // Não chegou ao servidor: o pedido CONTINUA na fila.
    tentarDeNovoMaisTarde(pedido);
    return;
  }
  if (ehProvisoria(resposta.status)) {
    tentarDeNovoMaisTarde(pedido);
    return;
  }

  let corpo: { stage_id?: unknown; status?: unknown } = {};
  try {
    corpo = (await resposta.json()) as typeof corpo;
  } catch {
    // Corpo ilegível: decide pelo status.
  }
  const stageId = typeof corpo.stage_id === 'string' ? corpo.stage_id : null;
  const status =
    corpo.status === 'open' || corpo.status === 'won' || corpo.status === 'lost'
      ? corpo.status
      : null;

  let resultado: ResultadoDoMovimento;
  if (resposta.ok) resultado = { tipo: 'movido', stageId: stageId ?? pedido.para, status };
  // 409 = o card não estava mais na origem. Já na etapa de destino é o MESMO
  // movimento feito por outro caminho (outra aba, a retomada, um colega):
  // conta como feito.
  else if (resposta.status === 409 && stageId === pedido.para) {
    resultado = { tipo: 'movido', stageId, status };
  } else if (resposta.status === 409) resultado = { tipo: 'mudou', stageId };
  else resultado = { tipo: 'falhou' };

  emVoo.delete(pedido.id);
  avisadosDaFalha.delete(pedido.id);
  tentativas.delete(pedido.id);
  tirarDaFila(pedido.usuario, pedido.id);

  if (resultado.tipo === 'movido') {
    // As automações da etapa rodam agora, e não no ciclo do agendador.
    ambiente.drenar();
    // Toast só quando ESTE pedido moveu: o 409 "já está no destino" da
    // retomada é o envio da página que fechou, que já tinha chegado — um
    // "movido" atrasado ali só confundiria.
    if (avisarPorToast && resposta.ok) ambiente.sucesso(pedido.textos.movido);
    definirFoto(pedido.dealId, { fase: 'movido', para: pedido.para });
  } else {
    ambiente.erro(resultado.tipo === 'mudou' ? pedido.textos.mudou : pedido.textos.falhou);
    definirFoto(pedido.dealId, null);
  }
  for (const fn of ouvintesDeConclusao) fn({ dealId: pedido.dealId, resultado });
}

// ---- A página indo embora ------------------------------------

function escutarAPagina() {
  if (escutando || typeof document === 'undefined' || typeof window === 'undefined') return;
  escutando = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') concluirTodosAgora();
    else if (usuarioDaRetomada) retomarMovimentosPendentes(usuarioDaRetomada);
  });
  window.addEventListener('pagehide', () => concluirTodosAgora());
  window.addEventListener('online', () => {
    if (usuarioDaRetomada) retomarMovimentosPendentes(usuarioDaRetomada);
  });
}

// ---- A API ---------------------------------------------------

/**
 * Começa a janela de desfazer. Depois de `ESPERA_PARA_DESFAZER_MS`, o card
 * é movido — a não ser que `desfazerMovimento` venha antes.
 *
 * `false` = recusado: o negócio já tem um pedido GUARDADO esperando o
 * servidor, e um novo o substituiria (ver o cabeçalho). A tela trava o card
 * nesse estado; a recusa é a segunda barreira.
 */
export function agendarMovimento(pedido: PedidoDeMovimento, usuario: string): boolean {
  if (!aguardando.has(pedido.dealId) && lerFila(usuario).some((e) => e.dealId === pedido.dealId)) {
    return false;
  }
  concluirAgora(pedido.dealId);
  const pendente: Pendente = {
    ...pedido,
    id: globalThis.crypto.randomUUID(),
    usuario,
    prazo: ambiente.agora() + ESPERA_PARA_DESFAZER_MS,
  };
  gravarFila(usuario, [...lerFila(usuario).filter((e) => e.dealId !== pedido.dealId), pendente]);
  const relogio = setTimeout(() => {
    aguardando.delete(pedido.dealId);
    void enviar(pendente, false);
  }, ESPERA_PARA_DESFAZER_MS);
  aguardando.set(pedido.dealId, { pedido: pendente, relogio });
  usuarioDaRetomada = usuario;
  escutarAPagina();
  definirFoto(pedido.dealId, { fase: 'aguardando', para: pedido.para, prazo: pendente.prazo });
  return true;
}

/** Cancela o movimento na janela de desfazer. `false` = não havia (já saiu). */
export function desfazerMovimento(dealId: string): boolean {
  const item = aguardando.get(dealId);
  if (!item) return false;
  clearTimeout(item.relogio);
  aguardando.delete(dealId);
  tirarDaFila(item.pedido.usuario, item.pedido.id);
  definirFoto(dealId, { fase: 'desfeito' });
  return true;
}

/**
 * Tira o pedido da janela e o envia JÁ. Quem monta o botão chama na troca de
 * conversa e ao desmontar; o aviso de sucesso vira toast (`avisarPorToast`),
 * porque a linha do cartão já não está à vista.
 */
export function concluirAgora(dealId: string, opcoes: { avisarPorToast?: boolean } = {}): void {
  const item = aguardando.get(dealId);
  if (!item) return;
  clearTimeout(item.relogio);
  aguardando.delete(dealId);
  void enviar(item.pedido, opcoes.avisarPorToast ?? false);
}

/** O pedido guardado deste negócio que não está na janela desta aba. */
function guardadoDo(dealId: string, usuario: string): Pendente | undefined {
  if (aguardando.has(dealId)) return undefined;
  return lerFila(usuario).find((e) => e.dealId === dealId);
}

/**
 * Card travado cujo pedido já saiu da fila — concluído ou desfeito noutra
 * aba, que lê o mesmo `localStorage` — destrava. Sem isso o card ficaria
 * travado para sempre, com botões que não acham pedido nenhum (Codex, PR #340).
 */
function destravarSemPedido(usuario: string) {
  const naFila = new Set(lerFila(usuario).map((e) => e.dealId));
  for (const [dealId, foto] of [...fotos]) {
    if (foto.fase === 'tentando' && !naFila.has(dealId) && !aguardando.has(dealId)) {
      definirFoto(dealId, null);
    }
  }
}

/** "Tentar agora" do card travado: manda o pedido guardado já. */
export function tentarAgora(dealId: string, usuario: string): void {
  const pedido = guardadoDo(dealId, usuario);
  if (pedido) void enviar(pedido, false);
  else destravarSemPedido(usuario);
}

/**
 * "Desistir" do card travado: a decisão explícita de não mover — como o
 * Desfazer, só que depois de o servidor falhar. Um envio já no ar ainda pode
 * chegar (e aí o card se move, e a tela diz).
 */
export function desistirDoMovimento(dealId: string, usuario: string): boolean {
  const pedido = guardadoDo(dealId, usuario);
  if (!pedido) {
    destravarSemPedido(usuario);
    return false;
  }
  tirarDaFila(usuario, pedido.id);
  tentativas.delete(pedido.id);
  avisadosDaFalha.delete(pedido.id);
  definirFoto(dealId, null);
  return true;
}

/** A página indo embora (ou para o fundo, no celular): tudo o que espera sai agora. */
export function concluirTodosAgora(): void {
  for (const dealId of [...aguardando.keys()]) concluirAgora(dealId);
}

/**
 * Refaz os pedidos que ficaram na fila do aparelho sem resposta do servidor.
 * A casca chama ao abrir; a própria página, na volta à aba e quando a
 * conexão volta.
 */
export function retomarMovimentosPendentes(usuario: string): void {
  usuarioDaRetomada = usuario;
  escutarAPagina();
  if (relogioDaRetomada) clearTimeout(relogioDaRetomada);
  relogioDaRetomada = null;
  destravarSemPedido(usuario);
  const destaAba = new Set([...aguardando.values()].map((item) => item.pedido.id));
  const agora = ambiente.agora();
  let proxima = Number.POSITIVE_INFINITY;
  for (const pedido of lerFila(usuario)) {
    if (destaAba.has(pedido.id) || emVoo.has(pedido.id)) continue;
    // Guardado trava o card desde já, também o que ainda está na folga (de
    // outra aba): senão os botões voltariam, e o clique seria recusado.
    const foto = fotos.get(pedido.dealId);
    if (!foto || foto.fase === 'desfeito') {
      definirFoto(pedido.dealId, { fase: 'tentando', para: pedido.para });
    }
    const quando = pedido.prazo + FOLGA_DA_RETOMADA_MS;
    if (quando > agora) {
      proxima = Math.min(proxima, quando - agora);
      continue;
    }
    void enviar(pedido, true);
  }
  if (Number.isFinite(proxima)) {
    relogioDaRetomada = setTimeout(() => retomarMovimentosPendentes(usuario), proxima);
  }
}

export function assinarMovimentos(fn: () => void): () => void {
  assinantes.add(fn);
  return () => {
    assinantes.delete(fn);
  };
}

export function fotoDoMovimento(dealId: string | null | undefined): EstadoDoMovimento | null {
  return dealId ? (fotos.get(dealId) ?? null) : null;
}

/** Quem guarda o negócio na tela (o painel) atualiza o estado local por aqui. */
export function aoConcluirMovimento(fn: (conclusao: Conclusao) => void): () => void {
  ouvintesDeConclusao.add(fn);
  return () => {
    ouvintesDeConclusao.delete(fn);
  };
}

/** Só para os testes: troca o mundo e zera o estado do módulo. */
export function __reiniciarParaTeste(novo: Partial<Ambiente> = {}): void {
  for (const item of aguardando.values()) clearTimeout(item.relogio);
  for (const relogio of relogiosDoAviso.values()) clearTimeout(relogio);
  if (relogioDaRetomada) clearTimeout(relogioDaRetomada);
  if (relogioDaTentativa) clearTimeout(relogioDaTentativa);
  aguardando.clear();
  emVoo.clear();
  filaEmMemoria.clear();
  avisadosDaFalha.clear();
  tentativas.clear();
  relogioDaTentativa = null;
  fotos.clear();
  relogiosDoAviso.clear();
  assinantes.clear();
  ouvintesDeConclusao.clear();
  usuarioDaRetomada = null;
  relogioDaRetomada = null;
  ambiente = { ...AMBIENTE_PADRAO, ...novo };
}
