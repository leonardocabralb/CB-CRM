import type { SupabaseClient } from "@supabase/supabase-js";

import { NOME_DO_APP } from "@/lib/marca";

import { AtlasError, criarClienteAtlas, type ClienteAtlas, type ClienteDoAtlas } from "./cliente";
import { codigoDe, lerChaveDoAtlas, registrarConferencia } from "./conexao";
import { decidir, decidirPelaSituacao, type Decisao } from "./decisao";
import { dadosParaCriar, dadosParaReativar, emailParaAtlas, telefoneParaBusca, type EntradaDoCliente, type TipoDeContrato } from "./formatar";

/**
 * O passo de automação "Criar cliente no Atlas" (Fase 0 de
 * docs/PLANO-integracao-atlas.md) — o I/O, fora do motor para ser testável.
 *
 * 1. A chave da conta (`cb_atlas_config`), do MESMO ambiente. Sem ela, FALHA.
 * 2. O vínculo que já existe (`cb_atlas_clientes`) vale: relê o cliente no
 *    Atlas. Sem vínculo (ou com o cliente apagado lá — só o `not_found` do
 *    Atlas prova isso), PROCURA pelo link das conversas do CRM, pelo telefone
 *    e pelo e-mail.
 * 3. Decide (`decisao.ts`): criar, reativar (D3), só vincular, ou PARAR
 *    (mais de um, casamento fraco, cadastro SUSPENSO no Atlas).
 * 4. ⚠️ ANTES de escrever no Atlas, confere que o cadastro achado não é de
 *    OUTRA ficha do CRM: reativar o cadastro alheio gravaria o contrato desta
 *    pessoa no da outra, e o vínculo 1:1 nem poderia registrar.
 * 5. Escreve no Atlas e grava o vínculo 1:1.
 *
 * ⚠️ Nunca repete sozinho (fica FORA de PASSOS_DE_ENVIO): criar pode ter
 * acontecido mesmo com tempo esgotado. Quem roda de novo é gente, e a busca
 * pelo link da conversa acha o cliente que já foi criado — não duplica. As
 * escritas levam `Idempotency-Key` estável por passo de execução.
 * ⚠️ Duas execuções AO MESMO TEMPO para o mesmo contato (o card entra, sai e
 * volta em segundos) não se enxergam e podem criar dois cadastros: a segunda
 * falha no vínculo com o motivo. Conhecido, não tratado (como o `create_deal`).
 *
 * ⚠️ O motivo da falha vai para o "Já rodou" da aba Automações e para a tela
 * de registros, que qualquer membro lê: nunca texto da resposta do Atlas, só
 * o código traduzido (e, na validação, os NOSSOS nomes de campo).
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
  /** A conversa desta execução (a do link): SEMPRE entra na busca, mesmo com mais de 9. */
  conversaDaExecucao: string | null;
  tipoDeContrato: TipoDeContrato;
  agora: Date;
}

export type ResultadoDoPassoAtlas =
  | { acao: "criado"; atlasClientId: string }
  | { acao: "reativado"; atlasClientId: string; situacaoAnterior: string | null }
  | { acao: "vinculado"; atlasClientId: string; situacao: string | null }
  /** O cliente do Atlas (em curso) já está ligado a OUTRA ficha do CRM: nada foi gravado. */
  | { acao: "ligado_a_outra_ficha"; atlasClientId: string; situacao: string | null };

type FabricaDeCliente = (chave: string) => ClienteAtlas;

/** O motivo em português, para o "Já rodou" — sem nada da resposta do Atlas. */
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
      return `o Atlas recusou os dados do cliente (validação${e.campos.length > 0 ? `: ${e.campos.join(", ")}` : ""})`;
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
    case "resposta_inesperada":
      return "o Atlas respondeu num formato inesperado; confira no Atlas se o cliente foi criado antes de rodar de novo";
    case "nao_encontrado":
      return "o cliente não foi encontrado no Atlas";
    default:
      return "o Atlas devolveu um erro";
  }
}

const POR_QUE_CASOU: Record<string, string> = {
  email: "pelo e-mail",
  phone_last8: "pelo final do telefone (guardado no Atlas sem DDD)",
};

/** O passo PARA sem escrever nada no Atlas: a frase diz o que a equipe faz. */
function parada(decisao: Exclude<Decisao, { acao: "criar" | "reativar" | "vincular" }>): Error {
  switch (decisao.acao) {
    case "ambiguo":
      return new Error(
        `há ${decisao.quantos > 0 ? decisao.quantos : "vários"} cadastros no Atlas que podem ser deste cliente; ` +
          "resolva no Atlas (um cadastro por pessoa) e rode de novo — nada foi alterado no Atlas",
      );
    case "fraco": {
      const por = (decisao.cliente.casouPor ?? []).map((m) => POR_QUE_CASOU[m]).filter(Boolean);
      return new Error(
        `há um cadastro no Atlas que casa com este cliente só ${por.length > 0 ? por.join(" e ") : "por um dado que não basta"}; ` +
          "confira no Atlas se é a mesma pessoa (acerte lá o telefone com DDD, ou ponha o link da conversa) e rode de novo — nada foi alterado no Atlas",
      );
    }
    case "pausado":
      return new Error(
        `o cadastro deste cliente no Atlas está ${decisao.cliente.status ?? "pausado"}; ` +
          "o Atlas manda no contrato: reative-o lá se for o caso e rode de novo — nada foi alterado no Atlas",
      );
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

/** A linha de vínculo que já aponta para este cliente do Atlas (de qualquer ficha, ou órfã). */
async function donoDoCliente(admin: SupabaseClient, accountId: string, atlasClientId: string): Promise<{ id: string; contact_id: string | null } | null> {
  const { data, error } = await admin
    .from("cb_atlas_clientes")
    .select("id, contact_id")
    .eq("account_id", accountId)
    .eq("atlas_client_id", atlasClientId)
    .maybeSingle();
  if (error) throw new Error("não foi possível ler o vínculo com o Atlas no CRM");
  return data ? { id: String(data.id), contact_id: data.contact_id ? String(data.contact_id) : null } : null;
}

const MOTIVO_DA_CONEXAO = {
  nao_conectado: "o Atlas não está conectado (Configurações → Integrações)",
  chave_ilegivel: "a chave do Atlas guardada não pôde ser lida — reconecte em Configurações → Integrações",
  outro_ambiente: "a conexão do Atlas guardada é de outro ambiente do Atlas (teste × produção) — reconecte em Configurações → Integrações",
  db_error: "não foi possível ler a conexão com o Atlas",
} as const;

export async function criarOuReativarNoAtlas(
  admin: SupabaseClient,
  entrada: EntradaDoPassoAtlas,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<ResultadoDoPassoAtlas> {
  const { accountId, contactId } = entrada;

  const conexao = await lerChaveDoAtlas(admin, accountId);
  if (!conexao.ok) {
    if (conexao.codigo === "chave_ilegivel") await registrarConferencia(admin, accountId, "chave_ilegivel");
    throw new Error(MOTIVO_DA_CONEXAO[conexao.codigo]);
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

  // O que JÁ foi escrito no Atlas: falha depois disso diz, para ninguém rodar de novo às cegas.
  let escrito: "criado" | "reativado" | null = null;
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
    /** A linha de `cb_atlas_clientes` a atualizar no fim (a desta ficha, ou a órfã do cliente achado). */
    let linha: string | null = null;
    /** A linha é o vínculo DESTA ficha: a `origem` (como ele NASCEU) não muda a cada execução. */
    let linhaPropria = false;
    if (vinculo && vinculo.atlas_tenant_id === conexao.tenantId) {
      const lido = await atlas.ler(String(vinculo.atlas_client_id));
      if (lido) {
        decisao = decidirPelaSituacao(lido);
        linha = String(vinculo.id);
        linhaPropria = true;
      }
    }
    if (vinculo && decisao === null) {
      // O Atlas disse `not_found` (ou o vínculo é de outro escritório): o vínculo velho sai.
      const { error } = await admin.from("cb_atlas_clientes").delete().eq("id", vinculo.id);
      if (error) throw new Error("não foi possível limpar o vínculo antigo com o Atlas");
    }

    // 2) Sem vínculo: procura. Critério que o Atlas recusaria fica de fora
    //    (derrubaria a busca inteira); o link das conversas vai sempre.
    if (decisao === null) {
      const conversas = await conversasDoContato(admin, accountId, contactId);
      // O Atlas aceita 10 ids: a conversa desta execução (a do `chatLink`) e a
      // ficha vão PRIMEIRO; as mais antigas completam.
      const ids = [entrada.conversaDaExecucao, contactId, ...conversas].filter((x): x is string => !!x);
      const achados = await atlas.buscar({
        phone: telefoneParaBusca(entrada.contato.telefone),
        email: emailParaAtlas(entrada.contato.email),
        chatLinkIds: [...new Set(ids)].slice(0, 10),
      });
      decisao = decidir(achados.clientes, achados.truncado);

      // 3) O cadastro achado já é de OUTRA ficha? Antes de qualquer escrita.
      if (decisao.acao === "reativar" || decisao.acao === "vincular") {
        const dono = await donoDoCliente(admin, accountId, decisao.cliente.id);
        if (dono?.contact_id && dono.contact_id !== contactId) {
          if (decisao.acao === "vincular") {
            await registrarConferencia(admin, accountId, null);
            return { acao: "ligado_a_outra_ficha", atlasClientId: decisao.cliente.id, situacao: decisao.cliente.status };
          }
          throw new Error(
            "o cadastro do Atlas que casa com este cliente já está ligado a outra ficha do CRM (provável ficha duplicada); " +
              "junte as fichas ou confira no Atlas e rode de novo — nada foi alterado no Atlas",
          );
        }
        if (dono) linha = dono.id; // órfão (a ficha foi apagada): esta ficha o adota
      }
    }

    // 4) Decide e escreve.
    let cliente: ClienteDoAtlas;
    let origem: "criada" | "reativada" | "encontrada";
    let resultado: ResultadoDoPassoAtlas;
    switch (decisao.acao) {
      case "ambiguo":
      case "fraco":
      case "pausado":
        throw parada(decisao);
      case "criar": {
        const novo = dadosParaCriar(dados);
        // O Atlas exige o nome: sem ele, recusaria com "validação" genérica.
        if (!novo.name) throw new Error("a ficha do cliente não tem nome; preencha o nome e rode de novo — nada foi enviado ao Atlas");
        // ⚠️ Só cria o que a busca ACHA de novo (link da conversa, telefone ou
        // e-mail): se o vínculo falhar depois, rodar de novo reencontra o
        // cliente em vez de criar outro (a chave de idempotência muda por execução).
        if (!novo.chatLink && !telefoneParaBusca(entrada.contato.telefone) && !novo.email) {
          throw new Error(
            "a ficha não tem conversa, telefone nem e-mail para o Atlas achar este cliente de novo; preencha o telefone ou o e-mail e rode de novo — nada foi enviado ao Atlas",
          );
        }
        cliente = await atlas.criar(novo, `${entrada.chaveDeIdempotencia}:criar`);
        escrito = "criado";
        origem = "criada";
        resultado = { acao: "criado", atlasClientId: cliente.id };
        break;
      }
      case "reativar": {
        const anterior = decisao.cliente.status;
        const atualizado = await atlas.atualizar(decisao.cliente.id, dadosParaReativar(dados), `${entrada.chaveDeIdempotencia}:reativar`);
        escrito = "reativado";
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

    // 5) O vínculo 1:1.
    const agora = new Date().toISOString();
    const lido = {
      account_id: accountId,
      contact_id: contactId,
      atlas_tenant_id: conexao.tenantId,
      atlas_client_id: cliente.id,
      app_url: cliente.appUrl,
      situacao: cliente.status,
      situacao_lida_em: agora,
      updated_at: agora,
    };
    const { error: erroGravar } = linha
      ? await admin.from("cb_atlas_clientes").update(linhaPropria ? lido : { ...lido, origem }).eq("id", linha)
      : await admin.from("cb_atlas_clientes").insert({ ...lido, origem });
    if (erroGravar) throw new Error(escrito ? "o vínculo não foi gravado no CRM" : "o vínculo com o Atlas não foi gravado no CRM");
    await registrarConferencia(admin, accountId, null);
    return resultado;
  } catch (e) {
    const motivo = e instanceof AtlasError ? motivoDaFalha(e) : e instanceof Error ? e.message : String(e);
    if (e instanceof AtlasError) await registrarConferencia(admin, accountId, codigoDe(e));
    if (escrito) throw new Error(`o cliente foi ${escrito} no Atlas, mas ${motivo}`);
    throw e instanceof AtlasError ? new Error(`Atlas: ${motivo}`) : e;
  }
}

/** O detalhe da execução, em português (vai cru para o "Já rodou" e os registros). */
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
