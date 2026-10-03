import { ehGatilhoDaRegua } from "@/lib/asaas/regua";

/**
 * O gatilho "Situação mudou no Atlas" (1073, Fase 4 de
 * docs/PLANO-integracao-atlas.md). Mora aqui, e não em `src/lib/atlas/`,
 * porque o motor o importa e `mudancas.ts` importa o motor.
 */
export const GATILHO_DO_ATLAS = "atlas_situacao_mudou" as const;

/**
 * Os gatilhos que SÓ rodam pelo disparador que decide "aconteceu?": a régua
 * do Asaas (a varredura reconfirma o pagamento e trava o marco) e a
 * "Situação mudou no Atlas" (a leitura periódica escolhe o card do evento).
 * Os dois carimbam `automation_id` no contexto, e `triggerMatches` casa SÓ
 * com ele. Por qualquer outra porta — o botão "Executar automação", o agente
 * de IA, o passo `run_automation`, `POST /api/automations/engine` — sairiam
 * sem o card e sem as `{{vars.*}}` do evento: todos recusam (e o construtor
 * e o seletor do `run_automation` não oferecem).
 *
 * ⚠️ É só para as RECUSAS. O que é específico da régua (conexão obrigatória
 * no passo, as sementes do construtor, o canal no motor) continua em
 * `ehGatilhoDaRegua`.
 */
export function soRodaPeloDisparador(tipo: string | null | undefined): boolean {
  return ehGatilhoDaRegua(tipo) || tipo === GATILHO_DO_ATLAS;
}
