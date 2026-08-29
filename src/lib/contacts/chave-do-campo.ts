/**
 * Gera a chave (slug) de um campo personalizado a partir do nome.
 *
 * ⚠️ GÊMEO da função SQL `cb_chave_de_campo` (migration 948). O banco tem um
 * gatilho que gera a chave quando ela vem vazia; esta versão existe para a
 * TELA sugerir a mesma chave que o banco geraria — quem mudar a regra aqui
 * muda lá na mesma passada, e o teste de paridade fixa os exemplos.
 *
 * Regras (idênticas ao SQL): minúsculas → acentos comuns do pt-BR traduzidos
 * → qualquer outra coisa vira `_` → bordas aparadas → teto de 60 → vazio
 * degrada para 'campo'.
 */

const DE = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const PARA = "aaaaaeeeeiiiiooooouuuucn";

export function gerarChaveDeCampo(nome: string | null | undefined): string {
  let s = (nome ?? "").toLowerCase();
  // `translate` do Postgres: caractere a caractere, sem regex — replicado
  // igual (um replace por par) para a paridade não depender de Unicode
  // normalization, que o SQL não faz.
  for (let i = 0; i < DE.length; i++) {
    s = s.split(DE[i]).join(PARA[i]);
  }
  s = s.replace(/[^a-z0-9]+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  s = s.slice(0, 60);
  s = s.replace(/^_+|_+$/g, "");
  return s === "" ? "campo" : s;
}
