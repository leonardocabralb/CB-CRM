import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  canEditSettings,
  canManageAutomations,
  canManageMembers,
  canSendMessages,
} from "@/lib/auth/roles";
import { TODAS_AS_SECOES, TODAS_AS_TELAS } from "./catalogo";
import {
  ESCRITA_DA_SECAO,
  ESCRITA_DA_TELA,
  PODERES,
  areasQueNaoOperam,
  poderesDoPapel,
} from "./poderes";
import type { PapelBase } from "./tipos";

const PAPEIS: PapelBase[] = ["admin", "agent", "viewer"];

describe("poderesDoPapel", () => {
  it("CRÍTICO: espelha os predicados de roles.ts, nunca uma segunda cópia", () => {
    // Este é o teste que sustenta o módulo inteiro. Se alguém trocar um
    // `permite` por uma comparação de papel escrita à mão, ela vai divergir
    // de `roles.ts` na primeira mudança de política — e o sintoma é uma tela
    // AFIRMANDO um poder que a pessoa não tem.
    for (const papel of PAPEIS) {
      const mapa = new Map(
        poderesDoPapel(papel).map((p) => [p.id, p.permitido]),
      );
      expect(mapa.get("send-messages")).toBe(canSendMessages(papel));
      expect(mapa.get("manage-automations")).toBe(canManageAutomations(papel));
      expect(mapa.get("edit-settings")).toBe(canEditSettings(papel));
      expect(mapa.get("manage-members")).toBe(canManageMembers(papel));
    }
  });

  it("anotação interna é de todo mundo, viewer incluso", () => {
    // Diferença deliberada de `send-messages` (ver `canWriteNotes`): a
    // anotação não fala com o cliente. Fixado aqui porque a tela agora
    // AFIRMA isso em texto, e uma regressão silenciosa viraria mentira.
    for (const papel of PAPEIS) {
      const mapa = new Map(
        poderesDoPapel(papel).map((p) => [p.id, p.permitido]),
      );
      expect(mapa.get("write-notes")).toBe(true);
    }
  });

  it("a escada não inverte: admin ⊇ agent ⊇ viewer", () => {
    const conta = (papel: PapelBase) =>
      poderesDoPapel(papel).filter((p) => p.permitido).length;
    expect(conta("admin")).toBeGreaterThan(conta("agent"));
    expect(conta("agent")).toBeGreaterThan(conta("viewer"));
  });

  it("nenhum poder é exclusivo do owner (nenhum perfil pode ser owner)", () => {
    // Listar capacidade que NENHUM papel-base alcança são três "✗" idênticos
    // em todos os papéis — ruído que ensina o olho a pular a lista.
    for (const poder of PODERES) {
      expect(PAPEIS.some((p) => poder.permite(p))).toBe(true);
    }
  });
});

describe("mapas de escrita", () => {
  it("CRÍTICO: toda tela e toda seção têm piso declarado", () => {
    // O `Record<TelaId, …>` já cobra isto no typecheck; o teste é a rede
    // para o caso de alguém alargar o tipo. Área sem entrada cairia num
    // padrão permissivo e a tela descreveria como "todo mundo opera".
    for (const tela of TODAS_AS_TELAS) {
      expect(ESCRITA_DA_TELA[tela]).toBeDefined();
    }
    for (const secao of TODAS_AS_SECOES) {
      expect(ESCRITA_DA_SECAO[secao]).toBeDefined();
    }
  });

  it("quick-replies é a única seção de Configurações que um agent escreve", () => {
    // Medido em 2026-09-02 contra rotas e policies. Se outra seção descer
    // para 'agent', é decisão de produto — e este teste cobra que ela seja
    // consciente, não uma linha trocada de passagem.
    const doAgent = TODAS_AS_SECOES.filter(
      (s) => ESCRITA_DA_SECAO[s] === "agent",
    );
    expect(doAgent).toEqual(["quick-replies"]);
  });
});

describe("areasQueNaoOperam", () => {
  it("admin opera tudo o que marcar", () => {
    const r = areasQueNaoOperam("admin", TODAS_AS_TELAS, TODAS_AS_SECOES);
    expect(r.telas).toEqual([]);
    expect(r.secoes).toEqual([]);
    expect(r.secoesOcultas).toEqual([]);
  });

  it("CRÍTICO: o caso 'Gestor' — agent com seções de administração marcadas", () => {
    // Reprodução literal do perfil "Gestor Geral" desta conta (medido em
    // 2026-09-02): papel `agent`, com Conexões, Membros, Modelos, Campos,
    // Acervo e Assinatura ligadas, mais Automações e Disparos nas telas.
    const r = areasQueNaoOperam(
      "agent",
      ["inbox", "pipelines", "automations", "broadcasts"],
      ["quick-replies", "assinatura", "channels", "fields", "members", "acervo"],
    );
    expect(r.telas).toEqual(["automations", "broadcasts"]);
    expect(r.secoes).toEqual([
      "assinatura",
      "channels",
      "fields",
      "members",
      "acervo",
    ]);
    // Respostas rápidas o agent escreve — não pode aparecer no aviso.
    expect(r.secoes).not.toContain("quick-replies");
    expect(r.secoesOcultas).toEqual([]);
  });

  it("CRÍTICO: 'perfis' num papel não-admin é OCULTA, não somente-leitura", () => {
    // Os dois sintomas são diferentes e o pior é o oculto: a seção não
    // aparece e a caixa marcada é inerte — quem a marcou sai da tela achando
    // ter delegado a gestão de permissões. Nunca nas duas listas.
    const r = areasQueNaoOperam("agent", [], ["perfis", "channels"]);
    expect(r.secoesOcultas).toEqual(["perfis"]);
    expect(r.secoes).toEqual(["channels"]);
  });

  it("CRÍTICO: id órfão do banco é ignorado, nunca listado", () => {
    // `"deals"` está gravado HOJE no perfil "Administrador" desta conta e o
    // editor não filtra ao montar o rascunho — `duplicar()` o copia verbatim,
    // e duplicar é o único botão daquele cartão. Sem o filtro,
    // `ESCRITA_DA_SECAO["deals"]` é undefined, a comparação de posto dá false,
    // e o aviso dizia "só para leitura: deals" num perfil ADMINISTRADOR.
    const r = areasQueNaoOperam(
      "admin",
      ["inbox", "tela-que-nao-existe" as never],
      ["overview", "deals" as never],
    );
    expect(r.telas).toEqual([]);
    expect(r.secoes).toEqual([]);
    expect(r.secoesOcultas).toEqual([]);
  });

  it("seção pessoal nunca entra no aviso", () => {
    // Trocar a própria senha é de todo mundo. Listá-las viraria um aviso
    // permanente e falso em cima de todo perfil restrito.
    const r = areasQueNaoOperam("viewer", [], [
      "profile",
      "security",
      "appearance",
    ]);
    expect(r.secoes).toEqual([]);
    expect(r.secoesOcultas).toEqual([]);
  });

  it("CRÍTICO: inbox e contatos NÃO são somente-leitura para o viewer", () => {
    // `canWriteNotes` é deliberadamente mais permissivo que `canSendMessages`:
    // o Visualizador escreve anotação interna — no inbox E na aba Notas da
    // ficha do contato (compositor sem gate de `podeEditar`, rota aceita
    // viewer; achado do Codex no PR #107, a linha nasceu `agent`). Dizer "só
    // para leitura, sem os botões" sobre essas duas seria mentira. Funis,
    // sim: lá ele não escreve nada e não há compositor de nota.
    const r = areasQueNaoOperam(
      "viewer",
      ["inbox", "agenda", "dashboard", "contacts", "pipelines"],
      [],
    );
    expect(r.telas).toEqual(["pipelines"]);
  });
});

// ------------------------------------------------------------
// O elo com o dicionário
// ------------------------------------------------------------
// Mesma amarração de `descrever-passo.test.ts`: o fallback do next-intl é
// por ARQUIVO, não por chave, então poder novo sem entrada no dicionário
// põe `PerfisPanel.poderes.<id>`, cru, dentro do editor de perfis.

function poderesDoDicionario(arquivo: string): Record<string, string> {
  const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, "utf8"));
  return bruto.PerfisPanel.poderes;
}

describe.each(["pt-BR.json", "en.json"])("dicionário %s", (arquivo) => {
  const rotulos = poderesDoDicionario(arquivo);

  it("CRÍTICO: todo poder tem rótulo", () => {
    const semChave = PODERES.map((p) => p.id).filter((id) => !(id in rotulos));
    expect(semChave).toEqual([]);
  });

  it("não sobra rótulo órfão", () => {
    const usados = new Set(PODERES.map((p) => p.id));
    expect(Object.keys(rotulos).filter((k) => !usados.has(k as never))).toEqual(
      [],
    );
  });
});
