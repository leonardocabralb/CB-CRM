import type { SupabaseClient } from "@supabase/supabase-js";

import { partesNoFuso } from "@/lib/agenda/fuso";
import { FUSO_DO_ESCRITORIO } from "@/lib/contacts/campo-data";
import { NOME_DO_APP } from "@/lib/marca";
import { diaNoFuso, somarDias } from "@/lib/tasks/prazo";
import { MAX_DESCRICAO, MAX_TITULO } from "@/lib/tasks/validar";

import { AtlasError, criarClienteAtlas, type AcoesNoAtlas, type ClienteAtlas, type DadosDoClienteNoAtlas } from "./cliente";
import { codigoDe, lerChaveDoAtlas, registrarConferencia } from "./conexao";
import { estaPausado } from "./decisao";
import { ambienteDoAtlas, noAmbiente } from "./enderecos";
import { diaParaAtlas, emailParaAtlas, telefoneParaBusca, type TipoDeContrato } from "./formatar";
import { appUrlSegura } from "./leitura";
import {
  DESCRICAO_DA_PERMISSAO_OPCIONAL,
  PERMISSAO_DA_ACAO,
  PERMISSOES_OPCIONAIS,
  ROTULO_DA_PERMISSAO,
  SITUACOES_ESCREVIVEIS,
  SITUACOES_QUE_REABREM,
  TETO_NOTAS_BYTES,
  TETO_OBSERVACAO,
  TETO_TRANSCRICAO_BYTES,
  bytesUtf8,
  recortarBytes,
  recortarUtf16,
  type SituacaoDoOnboarding,
} from "./passos-do-atlas";

/**
 * O nó "Atlas" do construtor (30/09/2026) — o I/O das quatro ações NOVAS,
 * fora do motor para ser testável (molde de `criar-cliente.ts`, que continua
 * INTOCADO: ele está ligado em produção). Regras:
 * `.claude/rules/integracoes-atlas-acoes.md`.
 *
 * - A chave da conta (`cb_atlas_config`), do MESMO ambiente; sem ela, FALHA
 *   com o mesmo texto do "Criar cliente".
 * - O cliente é o do VÍNCULO da ficha (`cb_atlas_clientes`, com a cerca de
 *   ambiente e o escritório da conexão). Sem vínculo, "Atualizar cliente",
 *   "Enviar transcrição" e "Atualizar onboarding" FALHAM sem chamar o Atlas;
 *   a tarefa nasce sem cliente.
 * - O `not_found` do Atlas numa ação com cliente é a LIXEIRA: marca
 *   `excluido_no_atlas_em` (o vínculo NUNCA é apagado) e falha; o SUCESSO
 *   dela tira a marca (a API só escreve em cliente fora da lixeira).
 * - ⚠️ As permissões `create_task`, `create_transcript` e
 *   `update_onboarding` são OPCIONAIS: desligadas, só o passo falha, com o
 *   nome delas no motivo, e a conexão NÃO vai a erro.
 * - ⚠️ Nunca repete sozinho (fora de PASSOS_DE_ENVIO). `Idempotency-Key`
 *   estável por passo de execução: `<logId>:<stepId>:<ação>`.
 * - ⚠️ O motivo da falha vai para o "Já rodou" e os registros (qualquer
 *   membro lê): só códigos traduzidos e os NOSSOS nomes — nunca texto da
 *   resposta do Atlas. O texto da transcrição nunca vai a detalhe nem a log.
 */

type FabricaDeAcoes = (chave: string) => Pick<ClienteAtlas, "ler"> & AcoesNoAtlas;
type AcaoNova = keyof typeof PERMISSAO_DA_ACAO;

interface Opcoes {
  cliente?: FabricaDeAcoes;
}

/** O que toda ação recebe do motor. */
export interface EntradaDaAcao {
  accountId: string;
  contactId: string;
  /** Estável por passo de execução (`<logId>:<stepId>`); o sufixo da ação vem aqui. */
  chaveDeIdempotencia: string;
}

// ------------------------------------------------------------
// O que as quatro repartem
// ------------------------------------------------------------

/** Copiado de `criar-cliente.ts` (o passo de produção não é mexido para "compartilhar"). */
const MOTIVO_DA_CONEXAO = {
  nao_conectado: "o Atlas não está conectado (Configurações → Integrações)",
  chave_ilegivel: "a chave do Atlas guardada não pôde ser lida — reconecte em Configurações → Integrações",
  outro_ambiente: "a conexão do Atlas guardada é de outro ambiente do Atlas (teste × produção) — reconecte em Configurações → Integrações",
  db_error: "não foi possível ler a conexão com o Atlas",
} as const;

export const MOTIVO_SEM_VINCULO =
  'a ficha não está ligada a um cliente do Atlas: rode "Criar cliente" antes ou peça a um admin para vincular na aba Atlas ' +
  '(se o "Criar cliente" disse "ligado a outra ficha", junte as fichas) — nada foi enviado ao Atlas';

export const MOTIVO_NA_LIXEIRA =
  "o cadastro ligado a esta ficha está na lixeira do Atlas; restaure lá (até 7 dias) ou desvincule na aba Atlas e rode de novo — nada foi alterado no Atlas";

/** A tarefa não tem 404 (a API liga a tarefa ao cliente da lixeira): quem avisa é a MARCA do vínculo. */
export const MOTIVO_TAREFA_NA_LIXEIRA =
  'o cadastro ligado a esta ficha está na lixeira do Atlas (a tarefa ficaria presa a ele); restaure lá ou, se já restaurou, use "Conferir no Atlas" na aba Atlas e rode de novo — nada foi enviado ao Atlas';

async function conectar(
  admin: SupabaseClient,
  accountId: string,
  ambiente: string | null,
  opcoes: Opcoes,
): Promise<{ atlas: Pick<ClienteAtlas, "ler"> & AcoesNoAtlas; tenantId: string }> {
  const conexao = await lerChaveDoAtlas(admin, accountId, ambiente);
  if (!conexao.ok) {
    if (conexao.codigo === "chave_ilegivel") await registrarConferencia(admin, accountId, "chave_ilegivel", ambiente);
    throw new Error(MOTIVO_DA_CONEXAO[conexao.codigo]);
  }
  const fabrica = opcoes.cliente ?? ((c: string) => criarClienteAtlas(c));
  return { atlas: fabrica(conexao.chave), tenantId: conexao.tenantId };
}

interface VinculoDaFicha {
  id: string;
  atlasClientId: string;
  excluidoEm: string | null;
}

/**
 * O vínculo DESTA ficha, neste ambiente e deste escritório. Vínculo de OUTRO
 * escritório conta como sem vínculo (e fica: só a reconexão confirmada o
 * apaga). Erro de leitura LANÇA — nunca "sem vínculo" (CLAUDE.md 8b).
 */
async function vinculoDaFicha(
  admin: SupabaseClient,
  accountId: string,
  contactId: string,
  ambiente: string | null,
  tenantId: string,
): Promise<VinculoDaFicha | null> {
  const { data, error } = await noAmbiente(
    admin
      .from("cb_atlas_clientes")
      .select("id, atlas_client_id, atlas_tenant_id, excluido_no_atlas_em")
      .eq("account_id", accountId)
      .eq("contact_id", contactId),
    ambiente,
  ).maybeSingle();
  if (error) throw new Error("não foi possível ler o vínculo com o Atlas no CRM");
  if (!data || data.atlas_tenant_id !== tenantId) return null;
  return {
    id: String(data.id),
    atlasClientId: String(data.atlas_client_id),
    excluidoEm: typeof data.excluido_no_atlas_em === "string" ? data.excluido_no_atlas_em : null,
  };
}

/** O `not_found` do Atlas: marca quando foi visto na lixeira (o primeiro instante fica). O vínculo nunca sai. */
async function marcarNaLixeira(admin: SupabaseClient, accountId: string, ambiente: string | null, vinculoId: string): Promise<void> {
  const { error } = await noAmbiente(
    admin
      .from("cb_atlas_clientes")
      .update({ excluido_no_atlas_em: new Date().toISOString() })
      .eq("id", vinculoId)
      .eq("account_id", accountId)
      .is("excluido_no_atlas_em", null),
    ambiente,
  );
  if (error) console.error("[atlas] não foi possível marcar o vínculo na lixeira:", error.message);
}

/**
 * O SUCESSO de uma ação com cliente prova que ele saiu da lixeira: a API só
 * escreve em cliente com `deleted_at IS NULL` (`update_client`,
 * `create_transcript`, `update_onboarding_item`). Restaurar no Atlas não muda
 * o `status_changed_at`, e sem isto a marca ficaria até a próxima listagem
 * completa — e a TAREFA (que a marca barra) seguiria falhando logo depois de
 * um passo que acabou de escrever no mesmo cliente. Tira SÓ a marca, como o
 * "Conferir no Atlas" (`vinculo.ts`): a situação fica para a leitura, que
 * decide o evento. Falhar aqui só vai ao log — o Atlas já foi escrito, e o
 * "Conferir no Atlas" ainda tira a marca.
 */
async function tirarMarcaDaLixeira(admin: SupabaseClient, accountId: string, ambiente: string | null, vinculo: VinculoDaFicha): Promise<void> {
  if (!vinculo.excluidoEm) return;
  const { error } = await noAmbiente(
    admin
      .from("cb_atlas_clientes")
      .update({ excluido_no_atlas_em: null, updated_at: new Date().toISOString() })
      .eq("id", vinculo.id)
      .eq("account_id", accountId)
      .not("excluido_no_atlas_em", "is", null),
    ambiente,
  );
  if (error) console.error("[atlas] não foi possível tirar a marca da lixeira do vínculo:", error.message);
}

/** A permissão que a falha nomeia: a que o Atlas disse, ou a da ação. */
function permissaoDaFalha(e: AtlasError, acao: AcaoNova): string {
  return e.permissao ?? PERMISSAO_DA_ACAO[acao];
}

/**
 * A falha do Atlas marca a conexão (a chave, o plano, a permissão
 * OBRIGATÓRIA), menos a permissão OPCIONAL desligada: aí só o passo falha.
 */
async function registrarFalha(admin: SupabaseClient, accountId: string, ambiente: string | null, e: AtlasError, acao: AcaoNova): Promise<void> {
  if (e.codigo === "sem_permissao" && (PERMISSOES_OPCIONAIS as readonly string[]).includes(permissaoDaFalha(e, acao))) return;
  await registrarConferencia(admin, accountId, codigoDe(e), ambiente);
}

const O_QUE_CONFERIR: Record<AcaoNova, string> = {
  atlas_atualizar_cliente: "se o cliente foi atualizado",
  atlas_criar_tarefa: "se a tarefa foi criada",
  atlas_enviar_transcricao: "se a transcrição chegou ao Diagnóstico",
  atlas_atualizar_onboarding: "se o item foi atualizado",
};

/**
 * O motivo em português — só CÓDIGO traduzido (o nosso e o `code` do Atlas,
 * que é código, não texto) e os NOSSOS nomes. Nunca `e.message`.
 */
export function motivoDaAcao(e: unknown, acao: AcaoNova, contexto: { item?: string } = {}): string {
  if (!(e instanceof AtlasError)) return "erro inesperado ao falar com o Atlas";
  switch (e.codigo) {
    case "chave_invalida":
      return "a chave do Atlas foi recusada — reconecte em Configurações → Integrações";
    case "api_fora_do_plano":
      return "o plano do escritório no Atlas não inclui a API";
    case "sem_permissao": {
      const p = permissaoDaFalha(e, acao);
      const rotulo = ROTULO_DA_PERMISSAO[p];
      const descricao = (DESCRICAO_DA_PERMISSAO_OPCIONAL as Readonly<Record<string, string>>)[p];
      const nome = rotulo ? `"${rotulo}" (${p})` : descricao ? `de ${descricao} (${p})` : `"${p}"`;
      return `a permissão ${nome} está desligada no Atlas; ligue-a lá e rode de novo`;
    }
    case "validacao":
      return `o Atlas recusou os dados (validação${e.campos.length > 0 ? `: ${e.campos.join(", ")}` : ""})`;
    case "limite":
      return "o Atlas pediu para esperar (limite de pedidos por minuto); rode de novo em instantes";
    case "idempotencia":
      switch (e.codigoDoAtlas) {
        case "idempotency_outcome_unknown":
          return "o Atlas não sabe se o pedido anterior entrou; confira no Atlas antes de rodar de novo";
        case "idempotency_conflict":
          return "o mesmo pedido já foi feito com outros dados; confira no Atlas";
        case "idempotency_key_invalid":
          return "erro do CRM na chave do pedido ao Atlas; avise o suporte do CRM";
        default:
          return "o Atlas ainda está processando este pedido; confira no Atlas antes de rodar de novo";
      }
    case "acao_desconhecida":
      return "a API do Atlas ainda não tem esta ação (atualização pendente no Atlas)";
    case "fora_do_ar":
    case "rede":
      return `o Atlas não respondeu; confira no Atlas ${O_QUE_CONFERIR[acao]} antes de rodar de novo`;
    case "resposta_inesperada":
      return `o Atlas respondeu num formato inesperado; confira no Atlas ${O_QUE_CONFERIR[acao]} antes de rodar de novo`;
    case "item_nao_encontrado":
      return `o checklist de onboarding deste cliente no Atlas não tem o item "${contexto.item ?? ""}"; confira o texto lá e ajuste o passo`;
    case "ambiguo":
      return "há mais de um item com esse texto no checklist deste cliente no Atlas; renomeie lá e rode de novo";
    case "sem_admin":
      return "o escritório no Atlas não tem administrador ativo para receber a tarefa";
    case "nao_encontrado":
      return "o cliente não foi encontrado no Atlas";
    default:
      return "o Atlas devolveu um erro";
  }
}

/** A falha do Atlas vira a frase do passo; a do CRM já é nossa e sobe como está. */
async function falhou(
  admin: SupabaseClient,
  accountId: string,
  ambiente: string | null,
  e: unknown,
  acao: AcaoNova,
  contexto: { item?: string } = {},
): Promise<never> {
  if (e instanceof AtlasError) {
    await registrarFalha(admin, accountId, ambiente, e, acao);
    throw new Error(`Atlas: ${motivoDaAcao(e, acao, contexto)}`);
  }
  throw e;
}

function textoOuNulo(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** "30/09/2026 14:05" no fuso do escritório (nunca getter local: o servidor roda em UTC). */
function dataEHora(iso: string): string {
  const p = partesNoFuso(new Date(iso), FUSO_DO_ESCRITORIO);
  const d = (n: number) => String(n).padStart(2, "0");
  return `${d(p.dia)}/${d(p.mes)}/${p.ano} ${d(p.hora)}:${d(p.minuto)}`;
}

// ------------------------------------------------------------
// Ação 2 — "Atualizar cliente" (`update_client`)
// ------------------------------------------------------------

/**
 * De onde vem cada campo. `undefined` = o passo não o escolheu; `null`/vazio
 * = escolhido, mas vazio na ficha (fica FORA do corpo: no `update_client`,
 * `null` apaga o campo lá).
 */
export interface FontesDoAtualizar {
  situacao: string | null;
  tipoDeContrato: TipoDeContrato | null;
  /** O valor do card (`negocioAlvo`); `null` = sem card. */
  valorDoCard?: number | null;
  /** Os campos de data CRUS (ISO). */
  primeiroContato?: string | null;
  proposta?: string | null;
  fechamento?: string | null;
  linkDaConversa?: string | null;
  telefone?: string | null;
  email?: string | null;
  /** O campo de texto com CPF/CNPJ, cru. */
  documento?: string | null;
}

export interface EntradaDoAtualizar extends EntradaDaAcao {
  fontes: FontesDoAtualizar;
}

/**
 * Puro: o corpo do `update_client`, os rótulos do que vai e do que ficou de
 * fora por estar vazio na ficha. ⚠️ Nunca `null` nem vazio no corpo. LANÇA
 * (nada foi enviado) quando o que está preenchido não serve: data ilegível
 * (a mesma régua do "Criar cliente") e documento que não é CPF nem CNPJ.
 */
export function montarAtualizacao(f: FontesDoAtualizar): { dados: DadosDoClienteNoAtlas; enviados: string[]; vazios: string[] } {
  const dados: DadosDoClienteNoAtlas = {};
  const enviados: string[] = [];
  const vazios: string[] = [];
  if (f.situacao) {
    dados.status = f.situacao;
    enviados.push("situação");
  }
  if (f.tipoDeContrato) {
    dados.contractType = f.tipoDeContrato;
    enviados.push("tipo de contrato");
  }
  if (f.valorDoCard !== undefined) {
    // ⚠️ `deals.value` é NOT NULL DEFAULT 0: o card sem valor preenchido vem
    // 0, e mandar 0 APAGARIA o valor que a equipe digitou no Atlas. O "Criar"
    // manda 0 porque CRIA; aqui é sobrescrita.
    if (typeof f.valorDoCard === "number" && Number.isFinite(f.valorDoCard) && f.valorDoCard > 0) {
      dados.contractValue = f.valorDoCard;
      enviados.push("valor");
    } else vazios.push("valor do card");
  }
  for (const [chave, campo, nome, rotulo] of [
    ["primeiroContato", "firstContactDate", "do primeiro contato", "data do primeiro contato"],
    ["proposta", "proposalDate", "da proposta", "data da proposta"],
    ["fechamento", "closingDate", "de fechamento", "data de fechamento"],
  ] as const) {
    const bruto = f[chave];
    if (bruto === undefined) continue;
    // Sem a RESERVA do "Criar" (criação do card, hoje): aqui ela
    // sobrescreveria a data certa que está no Atlas.
    if (!textoOuNulo(bruto)) {
      vazios.push(rotulo);
      continue;
    }
    const dia = diaParaAtlas(bruto);
    if (!dia) throw new Error(`a data ${nome} na ficha não é uma data válida; corrija o campo e rode de novo — nada foi enviado ao Atlas`);
    dados[campo] = dia;
    enviados.push(rotulo);
  }
  if (f.linkDaConversa !== undefined) {
    const link = textoOuNulo(f.linkDaConversa);
    if (link) {
      dados.chatLink = link;
      enviados.push("link da conversa");
    } else vazios.push("link da conversa");
  }
  if (f.telefone !== undefined) {
    const tel = telefoneParaBusca(f.telefone);
    if (tel) {
      dados.phone = tel;
      enviados.push("telefone");
    } else vazios.push("telefone");
  }
  if (f.email !== undefined) {
    const email = emailParaAtlas(f.email);
    if (email) {
      dados.email = email;
      enviados.push("e-mail");
    } else vazios.push("e-mail");
  }
  if (f.documento !== undefined) {
    const bruto = textoOuNulo(f.documento);
    if (!bruto) vazios.push("documento");
    else {
      const digitos = bruto.replace(/\D/g, "");
      if (digitos.length !== 11 && digitos.length !== 14) {
        throw new Error("o documento na ficha não é CPF (11 dígitos) nem CNPJ (14 dígitos); corrija o campo e rode de novo — nada foi enviado ao Atlas");
      }
      dados.docId = digitos;
      enviados.push("documento");
    }
  }
  return { dados, enviados, vazios };
}

const ANTERIORES_LEGIVEIS: readonly string[] = [...SITUACOES_ESCREVIVEIS, "em_negociacao"];

export async function atualizarClienteNoAtlas(admin: SupabaseClient, entrada: EntradaDoAtualizar, opcoes: Opcoes = {}): Promise<string> {
  const { accountId, contactId } = entrada;
  const { dados, enviados, vazios } = montarAtualizacao(entrada.fontes);
  const naoAlterados = vazios.length > 0 ? `; vazios na ficha, não alterados: ${vazios.join(", ")}` : "";
  // Tudo o que foi escolhido está vazio na ficha: o Atlas recusaria o pedido
  // sem campo ("No updatable fields"), e não há o que mudar.
  if (enviados.length === 0) return `nada a atualizar no Atlas: os campos escolhidos estão vazios na ficha (${vazios.join(", ")})`;

  const ambiente = ambienteDoAtlas();
  const { atlas, tenantId } = await conectar(admin, accountId, ambiente, opcoes);
  try {
    const vinculo = await vinculoDaFicha(admin, accountId, contactId, ambiente, tenantId);
    if (!vinculo) throw new Error(MOTIVO_SEM_VINCULO);

    // ⚠️ Situação que REABRE (ativo, importado): o "Criar cliente" recusa
    // reativar o SUSPENSO. Sem reler, este passo desfaria a suspensão que a
    // equipe fez no Atlas de propósito.
    if (dados.status && SITUACOES_QUE_REABREM.includes(dados.status)) {
      const atual = await atlas.ler(vinculo.atlasClientId);
      if (!atual) {
        await marcarNaLixeira(admin, accountId, ambiente, vinculo.id);
        throw new Error(MOTIVO_NA_LIXEIRA);
      }
      if (estaPausado(atual.status)) {
        throw new Error(
          "o cadastro deste cliente no Atlas está suspenso; o Atlas manda no contrato: reative-o lá se for o caso — nada foi alterado no Atlas",
        );
      }
    }

    let resposta: Awaited<ReturnType<AcoesNoAtlas["atualizarCliente"]>>;
    try {
      resposta = await atlas.atualizarCliente(vinculo.atlasClientId, dados, `${entrada.chaveDeIdempotencia}:atualizar`);
    } catch (e) {
      if (e instanceof AtlasError && e.codigo === "nao_encontrado") {
        await marcarNaLixeira(admin, accountId, ambiente, vinculo.id);
        throw new Error(MOTIVO_NA_LIXEIRA);
      }
      throw e;
    }

    // A situação escrita pelo CRM vai ao vínculo: a leitura periódica a vê
    // IGUAL e não gera o evento "Situação mudou no Atlas" (uma escrita do
    // próprio CRM), como o "Criar cliente" faz ao reativar.
    if (dados.status) {
      const agora = new Date().toISOString();
      const url = appUrlSegura(resposta.appUrl, vinculo.atlasClientId);
      const { error } = await noAmbiente(
        admin
          .from("cb_atlas_clientes")
          .update({
            situacao: dados.status,
            situacao_lida_em: agora,
            crm_escreveu_em: agora,
            excluido_no_atlas_em: null,
            updated_at: agora,
            ...(url ? { app_url: url } : {}),
          })
          .eq("id", vinculo.id)
          .eq("account_id", accountId),
        ambiente,
      );
      if (error) {
        throw new Error(
          "a situação foi gravada no Atlas, mas o vínculo não foi atualizado no CRM (a próxima leitura pode tratar como mudança feita no Atlas)",
        );
      }
    } else await tirarMarcaDaLixeira(admin, accountId, ambiente, vinculo);
    await registrarConferencia(admin, accountId, null, ambiente);

    const rotulos = enviados.map((r) => {
      if (r !== "situação" || !dados.status) return r;
      const antes = resposta.situacaoAnterior;
      return antes && ANTERIORES_LEGIVEIS.includes(antes) ? `situação (${antes} → ${dados.status})` : `situação (${dados.status})`;
    });
    return `cliente atualizado no Atlas: ${rotulos.join(", ")}${naoAlterados}`;
  } catch (e) {
    return falhou(admin, accountId, ambiente, e, "atlas_atualizar_cliente");
  }
}

// ------------------------------------------------------------
// Ação 3 — "Criar tarefa no Atlas" (`create_task`)
// ------------------------------------------------------------

export interface EntradaDaTarefa extends EntradaDaAcao {
  /** Já interpolados. */
  titulo: string;
  descricao: string;
  prioridade: "normal" | "urgent";
  /** Nulo = sem prazo. */
  prazoEmDias: number | null;
  nomeDaAutomacao: string;
  agora: Date;
}

/**
 * ⚠️ Cliente OPCIONAL (decisão da spec do nó): a tarefa é para a EQUIPE do
 * Atlas, e o caso típico ("preparar a pasta de <nome>") vem antes ou no lugar
 * do "Criar cliente". Sem vínculo, nasce sem cliente e o detalhe diz. A API
 * põe a tarefa no admin ativo mais antigo do escritório e NÃO confirma o
 * cliente (descarta em silêncio o id que não acha): o detalhe diz "pedida com
 * o cliente", nunca "ligada".
 */
export async function criarTarefaNoAtlas(admin: SupabaseClient, entrada: EntradaDaTarefa, opcoes: Opcoes = {}): Promise<string> {
  const { accountId, contactId } = entrada;
  const titulo = entrada.titulo.trim();
  if (!titulo) throw new Error("o título da tarefa ficou vazio (confira os campos inseridos) — nada foi enviado ao Atlas");
  const descricao = entrada.descricao.trim();
  const dados: Parameters<AcoesNoAtlas["criarTarefa"]>[0] = {
    title: recortarUtf16(titulo, MAX_TITULO),
    // Sem descrição, o Atlas grava o inglês "Created via API".
    // O nome da automação não tem teto: a reserva passa pelo MESMO corte (Codex, #365).
    description: recortarUtf16(descricao || `Aberta pela automação "${entrada.nomeDaAutomacao}" no ${NOME_DO_APP}`, MAX_DESCRICAO),
    priority: entrada.prioridade,
  };
  // O dia no fuso do escritório (a régua do `create_task` do CRM), nunca
  // `toISOString().slice`: às 22h de Brasília já é amanhã em UTC.
  if (entrada.prazoEmDias !== null) dados.dueDate = somarDias(diaNoFuso(entrada.agora, FUSO_DO_ESCRITORIO), entrada.prazoEmDias);

  const ambiente = ambienteDoAtlas();
  const { atlas, tenantId } = await conectar(admin, accountId, ambiente, opcoes);
  try {
    const vinculo = await vinculoDaFicha(admin, accountId, contactId, ambiente, tenantId);
    if (vinculo?.excluidoEm) throw new Error(MOTIVO_TAREFA_NA_LIXEIRA);
    if (vinculo) dados.clientId = vinculo.atlasClientId;
    await atlas.criarTarefa(dados, `${entrada.chaveDeIdempotencia}:tarefa`);
    await registrarConferencia(admin, accountId, null, ambiente);
    return vinculo
      ? "tarefa criada no Atlas (pedida com o cliente ligado à ficha)"
      : "tarefa criada no Atlas sem cliente: a ficha não está ligada ao Atlas";
  } catch (e) {
    return falhou(admin, accountId, ambiente, e, "atlas_criar_tarefa");
  }
}

// ------------------------------------------------------------
// Ação 4 — "Enviar transcrição ao Atlas" (`create_transcript`)
// ------------------------------------------------------------

export interface EntradaDaTranscricao extends EntradaDaAcao {
  idadeMaximaHoras: number;
  /** Já interpoladas. */
  notasDoOperador: string;
  incluirNotasDaReuniao: boolean;
  aceitarVinculoPorEmail: boolean;
  agora: Date;
}

interface ReuniaoLida {
  id: string;
  titulo: string;
  realizada_em: string;
  origem: string;
  status: string;
  texto: string | null;
  notas: string | null;
  vinculo_origem: string | null;
}

/**
 * A transcrição é a da reunião MAIS RECENTE da ficha na janela
 * (`cb_reunioes_transcritas`: tl;dv ou colada na aba Reuniões). Nunca manda
 * outra reunião no lugar da mais recente (a pendente, a sem gravação): o
 * Diagnóstico analisaria a conversa errada.
 */
export async function enviarTranscricaoAoAtlas(admin: SupabaseClient, entrada: EntradaDaTranscricao, opcoes: Opcoes = {}): Promise<string> {
  const { accountId, contactId } = entrada;
  const ambiente = ambienteDoAtlas();
  const { atlas, tenantId } = await conectar(admin, accountId, ambiente, opcoes);
  try {
    const vinculo = await vinculoDaFicha(admin, accountId, contactId, ambiente, tenantId);
    if (!vinculo) throw new Error(MOTIVO_SEM_VINCULO);

    const desde = new Date(entrada.agora.getTime() - entrada.idadeMaximaHoras * 3_600_000).toISOString();
    const { data, error } = await admin
      .from("cb_reunioes_transcritas")
      .select("id, titulo, realizada_em, origem, status, texto, notas, vinculo_origem")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .gte("realizada_em", desde)
      // ⚠️ Teto no AGORA: a transcrição colada à mão aceita data futura, e a
      // "mais recente" seria ela, não a reunião que aconteceu (Codex, #365).
      .lte("realizada_em", entrada.agora.toISOString())
      .order("realizada_em", { ascending: false })
      .limit(5);
    // Erro de leitura nunca vira "não há transcrição" (CLAUDE.md 8b).
    if (error) throw new Error("não foi possível ler as transcrições no CRM — nada foi enviado ao Atlas");
    // A desvinculada à mão não é deste cliente (hoje ela já sai pelo `contact_id` nulo).
    const reuniao = ((data ?? []) as ReuniaoLida[]).find((r) => r.vinculo_origem !== "desvinculada");
    if (!reuniao) {
      throw new Error(
        `não há transcrição de reunião deste cliente nas últimas ${entrada.idadeMaximaHoras} h (tl;dv ou colada na aba Reuniões) — nada foi enviado ao Atlas`,
      );
    }
    const quando = dataEHora(reuniao.realizada_em);
    if (reuniao.status === "pendente") {
      throw new Error(
        `a transcrição da reunião de ${quando} ainda não ficou pronta no tl;dv; rode de novo mais tarde (ou ponha um "Aguardar" antes) — nada foi enviado ao Atlas`,
      );
    }
    if (reuniao.status !== "pronta" || !textoOuNulo(reuniao.texto)) {
      throw new Error(
        `a reunião de ${quando} ficou sem transcrição${reuniao.status === "falhou" ? " (a busca no tl;dv falhou)" : ""}; cole a transcrição na aba Reuniões ou rode sem este passo — nada foi enviado ao Atlas`,
      );
    }
    // ⚠️ O tl;dv liga a reunião à ficha pelo E-MAIL do convidado — casamento
    // FRACO (o cônjuge com o mesmo e-mail). Mandar a conversa inteira ao
    // cadastro de outra pessoa é pior que reativar o cadastro errado.
    const peloEmail = reuniao.origem !== "manual" && reuniao.vinculo_origem !== "manual";
    if (peloEmail && !entrada.aceitarVinculoPorEmail) {
      throw new Error(
        // ⚠️ Só caminho que EXISTE na tela: não há botão "confirmar"; o PATCH
        // grava `manual` quando alguém vincula de novo (tirar e vincular).
        `a reunião de ${quando} foi ligada a esta ficha pelo e-mail do convidado; se ela é mesmo deste cliente, tire-a da ficha e vincule de novo ` +
          '(na aba Reuniões: abra a reunião, "Tirar deste cliente" e depois "Do tl;dv"; ou em Configurações → Integrações → tl;dv: o X e depois "Vincular cliente") ' +
          'ou marque no passo "Aceitar reunião ligada pelo e-mail do convidado" — nada foi enviado ao Atlas',
      );
    }
    const texto = reuniao.texto as string;
    if (bytesUtf8(texto) > TETO_TRANSCRICAO_BYTES) {
      // Sem cortar: a análise de meia reunião engana.
      throw new Error(`a transcrição da reunião de ${quando} passa do teto do Atlas (300 KB); nada foi enviado ao Atlas`);
    }

    const cabecalho = `Reunião "${reuniao.titulo}" de ${quando} (${reuniao.origem === "manual" ? "colada à mão" : "tl;dv"}), enviada pelo ${NOME_DO_APP}`;
    const doOperador = textoOuNulo(entrada.notasDoOperador);
    const base = [cabecalho, doOperador].filter((x): x is string => !!x).join("\n\n");
    if (bytesUtf8(base) > TETO_NOTAS_BYTES) throw new Error("as notas do passo passam do teto do Atlas (50 KB); encurte o texto — nada foi enviado ao Atlas");
    let notas = base;
    const daReuniao = entrada.incluirNotasDaReuniao ? textoOuNulo(reuniao.notas) : null;
    if (daReuniao) {
      const sobra = TETO_NOTAS_BYTES - bytesUtf8(`${base}\n\n`);
      const cortada = recortarBytes(daReuniao, sobra);
      if (cortada) notas = `${base}\n\n${cortada}`;
    }

    try {
      await atlas.enviarTranscricao({ clientId: vinculo.atlasClientId, transcript: texto, notes: notas }, `${entrada.chaveDeIdempotencia}:transcricao`);
    } catch (e) {
      if (e instanceof AtlasError && e.codigo === "nao_encontrado") {
        await marcarNaLixeira(admin, accountId, ambiente, vinculo.id);
        throw new Error(MOTIVO_NA_LIXEIRA);
      }
      throw e;
    }
    await tirarMarcaDaLixeira(admin, accountId, ambiente, vinculo);
    await registrarConferencia(admin, accountId, null, ambiente);
    const titulo = recortarUtf16(reuniao.titulo, 60);
    return (
      `transcrição da reunião "${titulo}" de ${quando.slice(0, 5)} enviada ao Atlas (aguarda análise no Diagnóstico)` +
      (peloEmail ? " — reunião ligada à ficha pelo e-mail do convidado" : "")
    );
  } catch (e) {
    return falhou(admin, accountId, ambiente, e, "atlas_enviar_transcricao");
  }
}

// ------------------------------------------------------------
// Ação 5 — "Atualizar onboarding no Atlas" (`update_onboarding_item`)
// ------------------------------------------------------------

export interface EntradaDoOnboarding extends EntradaDaAcao {
  /** O texto do item, LITERAL (o Atlas casa aparado e sem maiúsculas). */
  item: string;
  situacao: SituacaoDoOnboarding | null;
  /** Já interpolada. */
  observacao: string;
}

const SITUACAO_DO_ITEM_EM_PORTUGUES: Record<SituacaoDoOnboarding, string> = {
  pending: "pendente",
  done: "feito",
  blocked: "travado",
  skipped: "não se aplica",
};

export async function atualizarOnboardingNoAtlas(admin: SupabaseClient, entrada: EntradaDoOnboarding, opcoes: Opcoes = {}): Promise<string> {
  const { accountId, contactId } = entrada;
  const item = entrada.item.trim();
  if (!item) throw new Error("o passo não diz qual item do checklist atualizar — nada foi enviado ao Atlas");
  const observacao = entrada.observacao.trim();
  // Vazia fica FORA (nunca `null`, que apagaria a observação lá). O teto do
  // Atlas conta unidades UTF-16 (`.length`), não caracteres.
  const dados: Parameters<AcoesNoAtlas["atualizarItemDoOnboarding"]>[0] = { clientId: "", text: item };
  if (entrada.situacao) dados.status = entrada.situacao;
  if (observacao) dados.observation = recortarUtf16(observacao, TETO_OBSERVACAO);
  if (!dados.status && !dados.observation) {
    return "nada a atualizar no onboarding: a observação ficou vazia e o passo não muda a situação do item";
  }

  const ambiente = ambienteDoAtlas();
  const { atlas, tenantId } = await conectar(admin, accountId, ambiente, opcoes);
  try {
    const vinculo = await vinculoDaFicha(admin, accountId, contactId, ambiente, tenantId);
    if (!vinculo) throw new Error(MOTIVO_SEM_VINCULO);
    dados.clientId = vinculo.atlasClientId;
    try {
      await atlas.atualizarItemDoOnboarding(dados, `${entrada.chaveDeIdempotencia}:onboarding`);
    } catch (e) {
      // `item_nao_encontrado` (o 404 com a lista) NÃO é a lixeira.
      if (e instanceof AtlasError && e.codigo === "nao_encontrado") {
        await marcarNaLixeira(admin, accountId, ambiente, vinculo.id);
        throw new Error(MOTIVO_NA_LIXEIRA);
      }
      throw e;
    }
    await tirarMarcaDaLixeira(admin, accountId, ambiente, vinculo);
    await registrarConferencia(admin, accountId, null, ambiente);
    const partes = [
      ...(dados.status ? [`marcado como ${SITUACAO_DO_ITEM_EM_PORTUGUES[dados.status as SituacaoDoOnboarding]}`] : []),
      ...(dados.observation ? ["observação atualizada"] : []),
    ];
    return `item "${recortarUtf16(item, 60)}" do onboarding atualizado no Atlas: ${partes.join(", ")}`;
  } catch (e) {
    return falhou(admin, accountId, ambiente, e, "atlas_atualizar_onboarding", { item: recortarUtf16(item, 60) });
  }
}
