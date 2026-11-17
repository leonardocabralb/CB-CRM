// ============================================================
// As linhas que o "Salvar" do Gerenciar funil grava em `pipeline_stages`.
// Porte do #679 do original (`buildStageUpdateRows`), com as NOSSAS colunas.
//
// ⚠️⚠️ Só as etapas que AINDA existem no banco. O salvamento é um `upsert`
// por `id` (uma ida só ao banco), e o upsert INSERE a linha que não acha: a
// etapa que outro admin apagou com esta janela aberta voltava com o mesmo id,
// já sem as automações e as conexões que o DELETE tinha desligado dela
// (`supabase.md`). Quem chama lê os ids do funil logo antes e passa aqui.
// Sobra uma fresta de milissegundos (apagar entre a leitura e o upsert).
//
// As posições saem contíguas (0, 1, 2…) na ordem da janela, só entre as que
// ficaram.
// ============================================================

import type { PipelineStage } from "@/types";
import { desqualificacaoQueVale, marcaDaReuniaoQueVale } from "@/lib/funil/degraus";

export function etapasParaSalvar(
  locais: readonly PipelineStage[],
  idsQueExistem: ReadonlySet<string>,
) {
  return locais
    .filter((s) => idsQueExistem.has(s.id))
    .map((s, i) => ({
      id: s.id,
      pipeline_id: s.pipeline_id,
      name: s.name,
      color: s.color,
      position: i,
      // 950: etapa marcada carimba ganho/perdido por gatilho no banco.
      resultado: s.resultado ?? null,
      // 975: o degrau do funil de eficiência — independente do resultado.
      degrau: s.degrau ?? null,
      // 1058/1063: o que entrar na etapa diz sobre a reunião (aviso de
      // no-show, tela Reuniões). Da proposta em diante ela não vale — o degrau
      // já diz "compareceu, com proposta" — e é limpa aqui.
      desfecho_da_reuniao: marcaDaReuniaoQueVale(s.degrau, s.desfecho_da_reuniao),
      // 1065: o que o botão de avançar recomenda depois dela (NULL = automático).
      proximas_etapas: s.proximas_etapas ?? null,
      // 1070: o que estar nela diz sobre o contrato (faixa da conversa).
      situacao_do_cliente: s.situacao_do_cliente ?? null,
      // 1091: desqualificação — só vale na perda (o CHECK recusa o resto).
      desqualificacao: desqualificacaoQueVale(s.degrau, s.desqualificacao),
      // 1112: o campo Lista do motivo de quem entra na etapa (nulo = não
      // pergunta). Com o catálogo que falhou, volta o valor lido do banco.
      campo_do_motivo_id: s.campo_do_motivo_id ?? null,
    }));
}
