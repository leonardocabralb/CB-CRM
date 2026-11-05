// ============================================================
// O alarme de conexão no botão do cabeçalho (E1, Fase 3 dos alarmes).
//
// O sino (Fase 2) não é lido; o botão das conexões do cabeçalho (o glifo do
// WhatsApp) é o que está sempre à vista. Com alarme, ele se ALARGA e diz qual
// conexão e o quê, sem precisar abrir o popover. Decisão do operador
// (05/11/2026), no lugar da faixa fixa no topo do plano: "centralizar esses
// avisos dentro do botãozinho do WhatsApp". D2: owner/admin e os membros cujo
// perfil vê a conexão.
//
// Duas fontes, ambas pela sonda da saúde (`useChannelHealth`), sem realtime
// novo:
//  · o AO VIVO, com a régua da faixa da conversa (`avisoDaConexao`, que lê o
//    `tone`/`detail` do servidor, nunca reavalia): fora do ar, não recebe e
//    envios sem recibo;
//  · os EPISÓDIOS do sino ainda abertos (`episodios`, decididos no servidor por
//    `episodioAberto`): a medição ao vivo apaga quando envelhece, e o episódio
//    só fecha com prova. É isso que faz o alarme da madrugada ser visto às 8h.
//
// ⚠️ O atraso SÓ entra pelo episódio, que conta a duração (30 min, D5; e o
// operador confirmou para o cabeçalho, 05/11/2026): o atraso ao vivo (mais de
// 5 min) acende a cada reinício da Evolution, e todo atraso fora do incidente
// passou em menos de 30 min (plano §3b). O glifo e a faixa da conversa
// continuam mostrando o atraso ao vivo.
//
// ⚠️ UMA linha por conexão, com o pior motivo dela; a lista sai do pior para o
// mais leve, e o botão mostra a primeira.
//
// ⚠️ Sonda carregando ou que FALHOU = sem alarme: na falha, `useChannelHealth`
// guarda a última lista BOA, e afirmar um alarme a partir dela seria afirmar
// sobre o passado (a mesma régua da faixa da conversa, `canal-na-conversa.md`).
//
// ⚠️ O recorte é o do acesso EFETIVO (com o "Ver como"): o botão é parte da
// tela, como o menu (`perfis.md`). Quem RECEBE aviso no sino, ao contrário,
// sai do contexto real (`alarmes-no-sino.ts`).
// ============================================================

import type { EpisodioAberto } from '@/lib/cb-channels/alarmes-no-sino';
import { avisoDaConexao, type SaudeDaConexao } from '@/lib/inbox/aviso-da-conexao';
import { canalNoEscopo } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';

export type SaudeNoCabecalho = SaudeDaConexao & {
  episodios?: readonly EpisodioAberto[] | null;
};

export type AlarmeDoCabecalho =
  | { canalId: string; tipo: 'fora_do_ar'; rotulo: string }
  | { canalId: string; tipo: 'sem_recibo'; rotulo: string; desdeIso: string }
  | { canalId: string; tipo: 'nao_recebe'; rotulo: string }
  | {
      canalId: string;
      tipo: 'atrasada';
      rotulo: string;
      desdeIso: string;
      /** A última medição da 1002, fresca ou não: é o que se sabe. */
      atrasoSeg: number | null;
    };

/** O pior primeiro: o que não sai, o que sai e não volta, o que não chega, o que chega tarde. */
const GRAVIDADE: Record<AlarmeDoCabecalho['tipo'], number> = {
  fora_do_ar: 0,
  sem_recibo: 1,
  nao_recebe: 2,
  atrasada: 3,
};

function maisAntigo(a: string, b: string | null): string {
  return b !== null && Date.parse(b) < Date.parse(a) ? b : a;
}

function alarmeDaConexao(
  c: SaudeNoCabecalho,
  saude: readonly SaudeNoCabecalho[],
): AlarmeDoCabecalho | null {
  const aoVivo = avisoDaConexao({
    canalId: c.id,
    ehGrupo: false,
    saude,
    carregando: false,
    falhou: false,
  });
  if (aoVivo?.tipo === 'fora_do_ar') return { canalId: c.id, tipo: 'fora_do_ar', rotulo: c.label };

  const episodios = c.episodios ?? [];
  const deRecibo = episodios.find((e) => e.tipo === 'sem_recibo') ?? null;
  if (aoVivo?.tipo === 'sem_recibo') {
    return {
      canalId: c.id,
      tipo: 'sem_recibo',
      rotulo: c.label,
      desdeIso: maisAntigo(aoVivo.desdeIso, deRecibo?.desdeIso ?? null),
    };
  }
  if (deRecibo) return { canalId: c.id, tipo: 'sem_recibo', rotulo: c.label, desdeIso: deRecibo.desdeIso };

  if (aoVivo?.tipo === 'nao_recebe') return { canalId: c.id, tipo: 'nao_recebe', rotulo: c.label };

  const deAtraso = episodios.find((e) => e.tipo === 'atraso') ?? null;
  if (deAtraso) {
    return {
      canalId: c.id,
      tipo: 'atrasada',
      rotulo: c.label,
      desdeIso: deAtraso.desdeIso,
      atrasoSeg: c.atrasoSeg,
    };
  }
  return null;
}

export function alarmesDoCabecalho(args: {
  saude: readonly SaudeNoCabecalho[];
  carregando: boolean;
  falhou: boolean;
  acesso: ContextoDeAcesso;
}): AlarmeDoCabecalho[] {
  const { saude, carregando, falhou, acesso } = args;
  if (carregando || falhou) return [];
  // D2: owner/admin recebem o aviso de toda conexão, mesmo com perfil recortado.
  const veTodas = acesso.papel === 'owner' || acesso.papel === 'admin';
  const alarmes: AlarmeDoCabecalho[] = [];
  for (const c of saude) {
    if (!veTodas && !canalNoEscopo(acesso, c.id)) continue;
    const alarme = alarmeDaConexao(c, saude);
    if (alarme) alarmes.push(alarme);
  }
  return alarmes.sort((a, b) => GRAVIDADE[a.tipo] - GRAVIDADE[b.tipo]);
}
