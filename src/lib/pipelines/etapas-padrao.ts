// ============================================================
// As etapas com que todo funil NOVO nasce — o "Criar funil" da tela de Funis
// e o funil semeado na conta que ainda não tem nenhum (`pipelines/page.tsx`).
//
// ⚠️ Os NOMES saem do dicionário do idioma da instalação
// (`Pipelines.page.etapasPadrao.*`), nunca de literal: o nome é GRAVADO em
// `pipeline_stages.name` e fica no funil para sempre — a instalação em
// português nascia com "New Lead → Won" e o operador renomeava etapa por
// etapa. Cor e posição são do produto e não mudam com o idioma.
//
// Nada no app lê a etapa pelo NOME (conferido em 25/10/2026): ganho e perdido
// são a MARCA `resultado` (950/1031), degrau e situação do cliente também são
// marcas, e a v1 e as automações apontam a etapa pelo id. Por isso a etapa
// "Ganho" nasce SEM resultado, como a "Won" nascia — marcá-la mudaria o que
// entrar nela faz com o status do card (decisão do operador, não deste
// arquivo).
//
// Chaves LITERAIS de propósito (nada de `` t(`etapasPadrao.${x}`) ``): assim
// o portão `i18n-chaves-usadas` as confere. O teste ao lado lê os dois
// dicionários.
// ============================================================

export interface EtapaPadrao {
  name: string;
  color: string;
  position: number;
}

export function etapasPadrao(t: (chave: string) => string): EtapaPadrao[] {
  return [
    { name: t("etapasPadrao.novoLead"), color: "#3b82f6", position: 0 }, // azul
    { name: t("etapasPadrao.qualificado"), color: "#eab308", position: 1 }, // amarelo
    { name: t("etapasPadrao.propostaEnviada"), color: "#f97316", position: 2 }, // laranja
    { name: t("etapasPadrao.negociacao"), color: "#8b5cf6", position: 3 }, // roxo
    { name: t("etapasPadrao.ganho"), color: "#22c55e", position: 4 }, // verde
  ];
}
