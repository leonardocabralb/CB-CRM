import { describe, expect, it } from "vitest";

import { contarNegociacoes, lerNegociacoes, resultadoDaResposta, segundosDeEspera } from "./negociacoes";

// ============================================================
// A negociação do Atlas (Fase 3) — ALLOWLIST campo a campo. Todo dado aqui
// é FICTÍCIO (ids zerados, "Banco Exemplo", "Cliente Exemplo").
// ============================================================

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A resposta do contrato (§3), com os campos que NUNCA podem passar. */
function respostaDoAtlas() {
  return {
    success: true,
    clientId: ID(11),
    truncated: false,
    totals: { banks: 1, contracts: 1, proposals: 1 },
    // campo novo no topo: fica fora
    notes: "anotação do escritório",
    banks: [
      {
        id: ID(1),
        bank_name: "Banco Exemplo",
        original_debt: 10000,
        updated_debt: 12500,
        notes: "anotação do banco",
        status: "em_negociacao",
        contracts: [
          {
            id: ID(2),
            contract_ref: "123456",
            titular: "Cliente Exemplo",
            debt_type: "Crédito Consignado",
            is_judicializado: false,
            status: "quitado",
            settled_date: "2026-08-10",
            settlement: { total_debt_at_settlement: 12000, total_settled_amount: 6000, discount_pct: 50.0, sourceProposalId: ID(9) },
            // nunca saem (contrato §3, "Nunca saem")
            notes: "anotação do contrato",
            processo_numero: "PROC-EXEMPLO-99",
            action_plan: "plano",
            garantia: "garantia",
            abusivities: ["tarifa"],
          },
        ],
        proposals: [
          {
            id: ID(3),
            date: "2026-07-01",
            proposed_amount: 6000,
            base_debt: 12000,
            discount_pct: 50.0,
            status: "aceita",
            proposal_type: "a_vista",
            contract_ids: [ID(2)],
            status_history: [{ from_status: null, to_status: "recebida", changed_at: "2026-07-01T12:00:00+00:00", changed_by: "Pessoa Exemplo" }],
            // nunca saem
            channel: "whatsapp",
            sender: "Pessoa Exemplo",
            link: "https://exemplo.invalid/proposta",
            notes: "anotação da proposta",
            simulation_id: ID(4),
          },
        ],
      },
    ],
  };
}

describe("lerNegociacoes — allowlist", () => {
  it("devolve só o que a aba mostra, com os nomes do contrato", () => {
    expect(lerNegociacoes(respostaDoAtlas())).toEqual({
      truncated: false,
      totals: { banks: 1, contracts: 1, proposals: 1 },
      banks: [
        {
          id: ID(1),
          bank_name: "Banco Exemplo",
          original_debt: 10000,
          updated_debt: 12500,
          contracts: [
            {
              id: ID(2),
              contract_ref: "123456",
              titular: "Cliente Exemplo",
              debt_type: "Crédito Consignado",
              is_judicializado: false,
              status: "quitado",
              settled_date: "2026-08-10",
              settlement: { total_debt_at_settlement: 12000, total_settled_amount: 6000, discount_pct: 50 },
            },
          ],
          proposals: [
            { id: ID(3), date: "2026-07-01", proposed_amount: 6000, base_debt: 12000, discount_pct: 50, status: "aceita", proposal_type: "a_vista" },
          ],
        },
      ],
    });
  });

  it("CRÍTICO (pino): anotação, canal, remetente, link, simulação, processo, plano, garantia, abusividade, trilha e campo novo NUNCA passam", () => {
    const texto = JSON.stringify(lerNegociacoes(respostaDoAtlas()));
    for (const proibido of [
      "anotação",
      "whatsapp",
      "Pessoa Exemplo",
      "exemplo.invalid",
      "processo",
      "PROC-EXEMPLO",
      "plano",
      "garantia",
      "tarifa",
      "status_history",
      "changed_by",
      "contract_ids",
      "simulation",
      "sourceProposalId",
      "notes",
      "channel",
      "sender",
      "clientId",
      "em_negociacao",
    ]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  it("nulos continuam nulos; número e data fora do formato viram nulo (nunca valor inventado)", () => {
    const r = lerNegociacoes({
      banks: [
        {
          bank_name: "",
          original_debt: "10000",
          updated_debt: Number.NaN,
          contracts: [{ contract_ref: null, is_judicializado: "sim", status: null, settled_date: "10/08/2026", settlement: null }],
          proposals: [{ date: "2026-07-01T12:00:00Z", proposed_amount: Infinity, base_debt: null, discount_pct: null, status: "", proposal_type: null }],
        },
      ],
    });
    expect(r).toEqual({
      truncated: false,
      totals: { banks: null, contracts: null, proposals: null },
      banks: [
        {
          id: null,
          bank_name: null,
          original_debt: null,
          updated_debt: null,
          contracts: [{ id: null, contract_ref: null, titular: null, debt_type: null, is_judicializado: null, status: null, settled_date: null, settlement: null }],
          proposals: [{ id: null, date: null, proposed_amount: null, base_debt: null, discount_pct: null, status: null, proposal_type: null }],
        },
      ],
    });
  });

  it("desconto NEGATIVO passa como veio (proposta parcelada acima da dívida)", () => {
    const corpo = respostaDoAtlas();
    corpo.banks[0].proposals[0].discount_pct = -12.5;
    expect(lerNegociacoes(corpo)!.banks[0].proposals[0].discount_pct).toBe(-12.5);
  });

  it("situação e tipo desconhecidos passam como texto (a tela usa a reserva)", () => {
    const corpo = respostaDoAtlas();
    corpo.banks[0].proposals[0].status = "contraproposta";
    corpo.banks[0].proposals[0].proposal_type = "misto";
    const p = lerNegociacoes(corpo)!.banks[0].proposals[0];
    expect(p.status).toBe("contraproposta");
    expect(p.proposal_type).toBe("misto");
  });

  it("`truncated` com os totais reais", () => {
    const r = lerNegociacoes({ truncated: true, totals: { banks: 3, contracts: 1200, proposals: -1 }, banks: [] });
    expect(r).toEqual({ truncated: true, totals: { banks: 3, contracts: 1200, proposals: null }, banks: [] });
    // Só `true` liga (texto "true" não).
    expect(lerNegociacoes({ truncated: "true", banks: [] })!.truncated).toBe(false);
  });

  it("ilegível é null: sem `banks`, banco/contrato/proposta que não é objeto (descartar esconderia uma dívida)", () => {
    expect(lerNegociacoes(null)).toBeNull();
    expect(lerNegociacoes({ success: true })).toBeNull();
    expect(lerNegociacoes({ banks: "nenhum" })).toBeNull();
    expect(lerNegociacoes({ banks: [null] })).toBeNull();
    expect(lerNegociacoes({ banks: [{ bank_name: "Banco Exemplo", contracts: ["x"] }] })).toBeNull();
    expect(lerNegociacoes({ banks: [{ bank_name: "Banco Exemplo", proposals: {} }] })).toBeNull();
    // Lista AUSENTE dentro do banco é vazia (banco sem contrato cadastrado).
    expect(lerNegociacoes({ banks: [{ bank_name: "Banco Exemplo" }] })!.banks[0]).toMatchObject({ contracts: [], proposals: [] });
  });

  it("é idempotente: o navegador passa a resposta da rota pelo MESMO filtro", () => {
    const uma = lerNegociacoes(respostaDoAtlas());
    expect(lerNegociacoes(JSON.parse(JSON.stringify(uma)))).toEqual(uma);
  });

  it("as contagens do log (nunca valores nem nome de banco)", () => {
    expect(contarNegociacoes(lerNegociacoes(respostaDoAtlas())!)).toEqual({ bancos: 1, contratos: 1, propostas: 1 });
  });
});

describe("resultadoDaResposta — o estado da tela", () => {
  it("200 legível é ok; 200 ilegível é falha (nunca 'sem negociação')", () => {
    expect(resultadoDaResposta(200, { truncated: false, totals: {}, banks: [] })).toEqual({
      tipo: "ok",
      negociacoes: { truncated: false, totals: { banks: null, contracts: null, proposals: null }, banks: [] },
    });
    expect(resultadoDaResposta(200, {})).toEqual({ tipo: "erro", erro: "falhou" });
    expect(resultadoDaResposta(200, null)).toEqual({ tipo: "erro", erro: "falhou" });
  });

  it("a tabela de códigos da rota", () => {
    const casos: [number, unknown, unknown][] = [
      [403, { error: "sem_permissao", permissao: "read_negotiations" }, { tipo: "erro", erro: "sem_permissao" }],
      [403, { error: "sem_permissao", permissao: null }, { tipo: "erro", erro: "sem_permissao" }],
      [403, { error: "sem_permissao", permissao: "read_client" }, { tipo: "erro", erro: "sem_permissao_consultar" }],
      [404, { error: "nao_encontrado" }, { tipo: "erro", erro: "nao_encontrado" }],
      [404, { error: "sem_vinculo" }, { tipo: "erro", erro: "sem_vinculo" }],
      [409, { error: "nao_conectado" }, { tipo: "erro", erro: "conexao" }],
      [409, { error: "chave_invalida" }, { tipo: "erro", erro: "conexao" }],
      [409, { error: "api_fora_do_plano" }, { tipo: "erro", erro: "conexao" }],
      [409, { error: "chave_ilegivel" }, { tipo: "erro", erro: "conexao" }],
      [502, { error: "nao_suportado" }, { tipo: "erro", erro: "falhou" }],
      [502, { error: "indisponivel" }, { tipo: "erro", erro: "falhou" }],
      [500, { error: "db_error" }, { tipo: "erro", erro: "falhou" }],
      [500, null, { tipo: "erro", erro: "falhou" }],
    ];
    for (const [status, corpo, esperado] of casos) expect(resultadoDaResposta(status, corpo), JSON.stringify(corpo)).toEqual(esperado);
  });

  it("429: a espera do Atlas (`retryAfter`) e a do balde da rota (`retry_after_seconds`), cada uma com a sua ORIGEM", () => {
    expect(resultadoDaResposta(429, { error: "limite", retryAfter: 12 })).toEqual({ tipo: "limite", espera: { segundos: 12, origem: "atlas" } });
    // O balde do CRM recusou: nenhuma chamada ao Atlas — nunca "o Atlas pediu".
    expect(resultadoDaResposta(429, { error: "Rate limit exceeded", retry_after_seconds: 7 })).toEqual({ tipo: "limite", espera: { segundos: 7, origem: "crm" } });
    // O Atlas não disse: 60 s (a janela da cota dele).
    expect(resultadoDaResposta(429, { error: "limite", retryAfter: null })).toEqual({ tipo: "limite", espera: { segundos: 60, origem: "atlas" } });
    // Corpo ilegível: não atribui ao Atlas.
    expect(resultadoDaResposta(429, null)).toEqual({ tipo: "limite", espera: { segundos: 60, origem: "crm" } });
  });

  it("segundosDeEspera: arredonda para cima, teto de 5 min, lixo vira 60", () => {
    expect(segundosDeEspera(1.2)).toBe(2);
    expect(segundosDeEspera("30")).toBe(30);
    expect(segundosDeEspera(100000)).toBe(300);
    expect(segundosDeEspera(-5)).toBe(60);
    expect(segundosDeEspera("amanhã")).toBe(60);
    expect(segundosDeEspera(undefined)).toBe(60);
  });
});
