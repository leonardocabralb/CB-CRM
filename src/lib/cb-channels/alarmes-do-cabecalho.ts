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
// Três fontes, todas pela sonda da saúde (`useChannelHealth`), sem realtime
// novo:
//  · o AO VIVO, com a régua da faixa da conversa (`avisoDaConexao`, que lê o
//    `tone`/`detail` do servidor, nunca reavalia): fora do ar e não recebe; o
//    sem recibo pelo `semReciboDesde`, que o servidor manda sempre que a régua
//    acende — também atrás de outro motivo (`lagging`, `lastError`), que o
//    `detail` mostra antes (a fila represada para os recibos junto);
//  · os EPISÓDIOS do sino ainda abertos (`episodios`, decididos no servidor por
//    `episodioAberto`): a medição ao vivo apaga quando envelhece, e o episódio
//    só fecha com prova. É isso que faz o alarme da madrugada ser visto às 8h;
//  · os alarmes de conexão abertos da SENTINELA da VPS (`sentinela`, 1123,
//    Fase 4): sem mensagem de cliente, mensagens não gravadas, falhas de
//    entrega e quedas seguidas. Só na nossa VPS; em outra instalação, vazio.
//
// ⚠️ O atraso SÓ entra pelo episódio, que conta a duração (30 min, D5; e o
// operador confirmou para o cabeçalho, 05/11/2026): o atraso ao vivo (mais de
// 5 min) acende a cada reinício da Evolution, e todo atraso fora do incidente
// passou em menos de 30 min (plano §3b). O glifo e a faixa da conversa
// continuam mostrando o atraso ao vivo.
//
// ⚠️ O botão mostra o PIOR motivo de cada conexão de quem recebe o aviso (D2,
// `alarmesDoCabecalho`), do pior para o mais leve; a ficha de cada conexão no
// popover mostra TODOS os dela a quem a vê ali (`alarmesPorConexao`), como as
// outras linhas da ficha, que não têm recorte (decisão do operador,
// 05/11/2026: os cartões no topo do popover ficaram grosseiros).
//
// ⚠️ Sonda carregando ou que FALHOU = sem alarme: na falha, `useChannelHealth`
// guarda a última lista BOA, e afirmar um alarme a partir dela seria afirmar
// sobre o passado (a mesma régua da faixa da conversa, `canal-na-conversa.md`).
//
// ⚠️ O recorte é o do acesso EFETIVO (com o "Ver como"): o botão é parte da
// tela, como o menu (`perfis.md`). Quem RECEBE aviso no sino, ao contrário,
// sai do contexto real (`alarmes-no-sino.ts`).
// ============================================================

import type { AlarmeDaSentinela, ChaveDaSentinela } from '@/lib/cb-channels/alarmes-da-sentinela';
import type { EpisodioAberto } from '@/lib/cb-channels/alarmes-no-sino';
import { avisoDaConexao, type SaudeDaConexao } from '@/lib/inbox/aviso-da-conexao';
import { canalNoEscopo } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';

export type SaudeNoCabecalho = SaudeDaConexao & {
  episodios?: readonly EpisodioAberto[] | null;
  sentinela?: readonly AlarmeDaSentinela[] | null;
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
    }
  | { canalId: string; tipo: ChaveDaSentinela; rotulo: string; desdeIso: string };

/**
 * O pior primeiro: o que não sai; o que chegou ao WhatsApp e se perdeu para o
 * CRM; o que sai e não volta; a conexão que cai e volta; o que não chega; o
 * envio recusado; o que chega tarde.
 */
const GRAVIDADE: Record<AlarmeDoCabecalho['tipo'], number> = {
  fora_do_ar: 0,
  nao_gravadas: 1,
  sem_recibo: 2,
  quedas: 3,
  sem_entrada: 4,
  nao_recebe: 5,
  falhas: 6,
  atrasada: 7,
};

function maisAntigo(a: string, b: string | null): string {
  return b !== null && Date.parse(b) < Date.parse(a) ? b : a;
}

/** Todos os motivos acesos da conexão, do pior para o mais leve. */
function alarmesDaConexao(
  c: SaudeNoCabecalho,
  saude: readonly SaudeNoCabecalho[],
): AlarmeDoCabecalho[] {
  const candidatos: AlarmeDoCabecalho[] = [];
  const aoVivo = avisoDaConexao({
    canalId: c.id,
    ehGrupo: false,
    saude,
    carregando: false,
    falhou: false,
  });
  if (aoVivo?.tipo === 'fora_do_ar') candidatos.push({ canalId: c.id, tipo: 'fora_do_ar', rotulo: c.label });
  if (aoVivo?.tipo === 'nao_recebe') candidatos.push({ canalId: c.id, tipo: 'nao_recebe', rotulo: c.label });

  const episodios = c.episodios ?? [];
  const deRecibo = episodios.find((e) => e.tipo === 'sem_recibo') ?? null;
  const reciboAoVivo = c.semReciboDesde ?? null;
  if (reciboAoVivo !== null || deRecibo !== null) {
    candidatos.push({
      canalId: c.id,
      tipo: 'sem_recibo',
      rotulo: c.label,
      desdeIso:
        reciboAoVivo !== null
          ? maisAntigo(reciboAoVivo, deRecibo?.desdeIso ?? null)
          : (deRecibo as EpisodioAberto).desdeIso,
    });
  }
  const deAtraso = episodios.find((e) => e.tipo === 'atraso') ?? null;
  if (deAtraso) {
    candidatos.push({
      canalId: c.id,
      tipo: 'atrasada',
      rotulo: c.label,
      desdeIso: deAtraso.desdeIso,
      atrasoSeg: c.atrasoSeg,
    });
  }
  for (const s of c.sentinela ?? []) {
    candidatos.push({ canalId: c.id, tipo: s.chave, rotulo: c.label, desdeIso: s.desdeIso });
  }

  return candidatos.sort((a, b) => GRAVIDADE[a.tipo] - GRAVIDADE[b.tipo]);
}

interface Entrada {
  saude: readonly SaudeNoCabecalho[];
  carregando: boolean;
  falhou: boolean;
  acesso: ContextoDeAcesso;
}

/**
 * A ficha do popover: os alarmes de cada conexão, do pior para o mais leve.
 * Sem o recorte D2 — o popover lista toda conexão da conta, e as outras
 * linhas da ficha (o status, o atraso) também não têm recorte.
 */
export function alarmesPorConexao({
  saude,
  carregando,
  falhou,
}: Omit<Entrada, 'acesso'>): Map<string, AlarmeDoCabecalho[]> {
  const porConexao = new Map<string, AlarmeDoCabecalho[]>();
  if (carregando || falhou) return porConexao;
  for (const c of saude) {
    const lista = alarmesDaConexao(c, saude);
    if (lista.length > 0) porConexao.set(c.id, lista);
  }
  return porConexao;
}

/** O botão: o pior alarme de cada conexão de quem recebe o aviso (D2). */
export function alarmesDoCabecalho(entrada: Entrada): AlarmeDoCabecalho[] {
  const { acesso } = entrada;
  // D2: owner/admin recebem o aviso de toda conexão, mesmo com perfil recortado.
  const veTodas = acesso.papel === 'owner' || acesso.papel === 'admin';
  return [...alarmesPorConexao(entrada)]
    .filter(([canalId]) => veTodas || canalNoEscopo(acesso, canalId))
    .map(([, lista]) => lista[0])
    .sort((a, b) => GRAVIDADE[a.tipo] - GRAVIDADE[b.tipo]);
}
