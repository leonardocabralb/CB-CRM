import type { SupabaseClient } from "@supabase/supabase-js";

import { NOME_DO_APP } from "@/lib/marca";

import { AtlasError, criarClienteAtlas, type ClienteAtlas, type ClienteDoAtlas } from "./cliente";
import { codigoDe, lerChaveDoAtlas, registrarConferencia } from "./conexao";
import { decidir, estaEncerrado, type Decisao } from "./decisao";
import { dadosParaCriar, dadosParaReativar, telefoneParaAtlas, type EntradaDoCliente, type TipoDeContrato } from "./formatar";

/**
 * O passo de automação "Criar cliente no Atlas" (Fase 0 de
 * docs/PLANO-integracao-atlas.md) — o I/O, fora do motor para ser testável.
 *
 * 1. A chave da conta (`cb_atlas_config`). Sem ela, o passo FALHA com motivo.
 * 2. O vínculo que já existe (`cb_atlas_clientes`) vale: relê o cliente no
 *    Atlas. Sem vínculo (ou com o cliente apagado lá), PROCURA pelo link das
 *    conversas do CRM, pelo telefone e pelo e-mail.
 * 3. Decide (`decisao.ts`): criar, reativar o cadastro encerrado (D3), só
 *    vincular o que está em curso, ou parar quando há mais de um.
 * 4. Grava o vínculo 1:1.
 *
 * ⚠️ Nunca repete sozinho (fica FORA de PASSOS_DE_ENVIO): criar pode ter
 * acontecido mesmo com tempo esgotado. Quem roda de novo é gente, e a busca
 * pelo link da conversa acha o cliente que já foi criado — não duplica. As
 * escritas levam `Idempotency-Key` estável por passo de execução.
 *
 * ⚠️ O motivo da falha vai para o fio e para o "Já rodou", que qualquer membro
 * lê: nunca dado da resposta do Atlas, só o código traduzido.
 */

export interface EntradaDoPassoAtlas {
  accountId: string;
  contactId: string;
  /** Estável por passo de execução (`<logId>:<stepId>`). */
  chaveDeIdempotencia: string;
  contato: { nome: string | null; telefone: string | null; email: string | null };
  negocio: { valor: number | null; criadoEm: string | null } | null;
  datas: { primeiroContato: string | null; proposta: string | null; fechamento: string | null };
  linkDaConversa: string | null;
  tipoDeContrato: TipoDeContrato;
  agora: Date;
}

export type ResultadoDoPassoAtlas =
  | { acao: "criado"; atlasClientId: string }
  | { acao: "reativado"; atlasClientId: string; situacaoAnterior: string | null }
  | { acao: "vinculado"; atlasClientId: string; situacao: string | null }
  /** O cliente do Atlas já está ligado a OUTRA ficha do CRM: nada foi gravado aqui. */
  | { acao: "ligado_a_outra_ficha"; atlasClientId: string; situacao: string | null };

type FabricaDeCliente = (chave: string) => ClienteAtlas;

/** O motivo em português, para o fio — sem nada da resposta do Atlas. */
export function motivoDaFalha(e: unknown): string {
  if (!(e instanceof AtlasError)) return "erro inesperado ao falar com o Atlas";
  switch (e.codigo) {
    case "chave_invalida":
      return "a chave do Atlas foi recusada — reconecte em Configurações → Integrações";
    case "api_fora_do_plano":
      return "o plano do escritório no Atlas não inclui a API";
    case "sem_permissao":
      return `a permissão ${e.permissao ? `"${e.permissao}" ` : ""}está desligada no Atlas`;
    case "validacao":
      return "o Atlas recusou os dados do cliente (validação)";
    case "limite":
      return "o Atlas pediu para esperar (limite de pedidos por minuto); rode de novo em instantes";
    case "limite_do_plano":
      return "o escritório atingiu o limite de clientes do plano no Atlas";
    case "idempotencia":
      return "o Atlas ainda está processando este pedido; confira no Atlas antes de rodar de novo";
    case "acao_desconhecida":
      return "a API do Atlas ainda não tem esta ação (atualização pendente no Atlas)";
    case "fora_do_ar":
    case "rede":
      return "o Atlas não respondeu; confira no Atlas se o cliente foi criado antes de rodar de novo";
    case "nao_encontrado":
      return "o cliente não foi encontrado no Atlas";
    default:
      return "o Atlas devolveu um erro";
  }
}

async function conversasDoContato(admin: SupabaseClient, accountId: string, contactId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(9);
  if (error) throw new Error("não foi possível ler as conversas do cliente no CRM");
  return (data ?? []).map((c) => String(c.id));
}

export async function criarOuReativarNoAtlas(
  admin: SupabaseClient,
  entrada: EntradaDoPassoAtlas,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<ResultadoDoPassoAtlas> {
  const { accountId, contactId } = entrada;

  const conexao = await lerChaveDoAtlas(admin, accountId);
  if (!conexao.ok) {
    throw new Error(
      conexao.codigo === "nao_conectado"
        ? "o Atlas não está conectado (Configurações → Integrações)"
        : conexao.codigo === "chave_ilegivel"
          ? "a chave do Atlas guardada não pôde ser lida — reconecte em Configurações → Integrações"
          : "não foi possível ler a conexão com o Atlas",
    );
  }
  const atlas = (opcoes.cliente ?? ((c) => criarClienteAtlas(c)))(conexao.chave);

  const dados: EntradaDoCliente = {
    nome: entrada.contato.nome,
    telefone: entrada.contato.telefone,
    email: entrada.contato.email,
    valor: entrada.negocio?.valor ?? 0,
    cardCriadoEm: entrada.negocio?.criadoEm ?? null,
    primeiroContato: entrada.datas.primeiroContato,
    proposta: entrada.datas.proposta,
    fechamento: entrada.datas.fechamento,
    linkDaConversa: entrada.linkDaConversa,
    tipoDeContrato: entrada.tipoDeContrato,
    agora: entrada.agora,
    nomeDoApp: NOME_DO_APP,
  };

  try {
    // 1) O vínculo que já existe.
    const { data: vinculo, error: erroVinculo } = await admin
      .from("cb_atlas_clientes")
      .select("id, atlas_client_id, atlas_tenant_id")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .maybeSingle();
    if (erroVinculo) throw new Error("não foi possível ler o vínculo com o Atlas no CRM");

    let decisao: Decisao | null = null;
    if (vinculo && vinculo.atlas_tenant_id === conexao.tenantId) {
      const lido = await atlas.ler(String(vinculo.atlas_client_id));
      if (lido) decisao = estaEncerrado(lido.status) ? { acao: "reativar", cliente: lido } : { acao: "vincular", cliente: lido };
    }
    if (vinculo && decisao === null) {
      // O cliente sumiu do Atlas (ou é de outro escritório): o vínculo velho sai.
      const { error } = await admin.from("cb_atlas_clientes").delete().eq("id", vinculo.id);
      if (error) throw new Error("não foi possível limpar o vínculo antigo com o Atlas");
    }

    // 2) Sem vínculo: procura.
    if (decisao === null) {
      const conversas = await conversasDoContato(admin, accountId, contactId);
      const achados = await atlas.buscar({
        phone: telefoneParaAtlas(entrada.contato.telefone),
        email: entrada.contato.email?.trim() || null,
        chatLinkIds: [...conversas, contactId],
      });
      decisao = decidir(achados.clientes, achados.truncado);
    }

    // 3) Decide e escreve.
    let cliente: ClienteDoAtlas;
    let origem: "criada" | "reativada" | "encontrada";
    let resultado: ResultadoDoPassoAtlas;
    switch (decisao.acao) {
      case "ambiguo":
        throw new Error(
          `há ${decisao.quantos > 0 ? decisao.quantos : "vários"} cadastros no Atlas que podem ser deste cliente; ` +
            "resolva no Atlas (um cadastro por pessoa) e rode de novo",
        );
      case "criar":
        cliente = await atlas.criar(dadosParaCriar(dados), `${entrada.chaveDeIdempotencia}:criar`);
        origem = "criada";
        resultado = { acao: "criado", atlasClientId: cliente.id };
        break;
      case "reativar": {
        const anterior = decisao.cliente.status;
        const atualizado = await atlas.atualizar(decisao.cliente.id, dadosParaReativar(dados), `${entrada.chaveDeIdempotencia}:reativar`);
        cliente = { ...atualizado, appUrl: atualizado.appUrl ?? decisao.cliente.appUrl, status: atualizado.status ?? "ativo" };
        origem = "reativada";
        resultado = { acao: "reativado", atlasClientId: cliente.id, situacaoAnterior: anterior };
        break;
      }
      case "vincular":
        cliente = decisao.cliente;
        origem = "encontrada";
        resultado = { acao: "vinculado", atlasClientId: cliente.id, situacao: cliente.status };
        break;
    }

    // 4) O vínculo 1:1 — sem roubar o cliente de OUTRA ficha do CRM.
    const { data: dono, error: erroDono } = await admin
      .from("cb_atlas_clientes")
      .select("id, contact_id")
      .eq("account_id", accountId)
      .eq("atlas_client_id", cliente.id)
      .maybeSingle();
    if (erroDono) throw new Error("não foi possível ler o vínculo com o Atlas no CRM");
    if (dono && dono.contact_id && dono.contact_id !== contactId) {
      await registrarConferencia(admin, accountId, null);
      return resultado.acao === "vinculado" ? { acao: "ligado_a_outra_ficha", atlasClientId: cliente.id, situacao: cliente.status } : resultado;
    }
    const agora = new Date().toISOString();
    const linha = {
      account_id: accountId,
      contact_id: contactId,
      atlas_tenant_id: conexao.tenantId,
      atlas_client_id: cliente.id,
      app_url: cliente.appUrl,
      situacao: cliente.status,
      situacao_lida_em: agora,
      origem,
      updated_at: agora,
    };
    const { error: erroGravar } = dono
      ? await admin.from("cb_atlas_clientes").update(linha).eq("id", dono.id)
      : await admin.from("cb_atlas_clientes").insert(linha);
    if (erroGravar) {
      // O Atlas já foi escrito: dizer o que aconteceu, para ninguém rodar de novo às cegas.
      throw new Error(`o cliente foi ${origem === "criada" ? "criado" : origem === "reativada" ? "reativado" : "encontrado"} no Atlas, mas o vínculo não foi gravado no CRM`);
    }
    await registrarConferencia(admin, accountId, null);
    return resultado;
  } catch (e) {
    if (e instanceof AtlasError) {
      await registrarConferencia(admin, accountId, codigoDe(e));
      throw new Error(`Atlas: ${motivoDaFalha(e)}`);
    }
    throw e;
  }
}

/** O detalhe da execução, em português (vai cru para o fio e o "Já rodou"). */
export function detalheDoResultado(r: ResultadoDoPassoAtlas): string {
  switch (r.acao) {
    case "criado":
      return "cliente criado no Atlas";
    case "reativado":
      return `cadastro reativado no Atlas${r.situacaoAnterior ? ` (estava ${r.situacaoAnterior})` : ""}`;
    case "vinculado":
      return `já estava no Atlas${r.situacao ? ` (${r.situacao})` : ""}: vinculado, nada alterado lá`;
    case "ligado_a_outra_ficha":
      return "já estava no Atlas, ligado a outra ficha do CRM: nada alterado";
  }
}
