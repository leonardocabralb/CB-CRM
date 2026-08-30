// ============================================================
// Perfis de fábrica — a matriz combinada com o operador em 2026-08-30.
//
// São o PONTO DE PARTIDA, não a regra final: a partir da Fase 5 o operador
// edita tudo na tela (menos o que é `sistema`). Existem aqui para que a conta
// não comece em branco e para que as fases 2–4 tenham o que aplicar antes de
// existir tela de edição.
//
// ⚠️ Nenhum perfil de Dono. O dono enxerga tudo por curto-circuito em
// `visibilidade.ts`, e o CHECK da 956 impede `papel_base = 'owner'` — perfil
// que promovesse alguém a dono seria transferência de posse por caminho
// lateral.
// ============================================================

import { TODAS_AS_SECOES, TODAS_AS_TELAS, type SecaoId, type TelaId } from "./catalogo";
import type { PapelBase } from "./tipos";

export interface PerfilDeFabrica {
  nome: string;
  papel_base: PapelBase;
  telas: TelaId[];
  secoes_config: SecaoId[];
  sistema: boolean;
}

/**
 * O que o Advogado vê. É o perfil que o operador vai DUPLICAR por área
 * ("Advogado Trabalhista", "Advogado Bancário"), trocando só as conexões e os
 * funis — por isso ele nasce sem recorte, e o recorte é o que a cópia ajusta.
 *
 * Fora daqui, por decisão do operador: Painel e Radar (visão de gestão),
 * Disparos em massa (um clique atinge centenas de clientes), Automações,
 * Fluxos e Agentes de IA (passam a exigir admin também no servidor, Fase 2).
 */
const TELAS_DO_ADVOGADO: TelaId[] = [
  "inbox",
  "notifications",
  "tarefas",
  "contacts",
  "agenda",
  "pipelines",
  "agendadas",
  // ⚠️ `settings` NÃO entra aqui: é `TELAS_SEMPRE_VISIVEIS`, que nenhum perfil
  // consegue esconder. Listá-la daria a impressão falsa de que dá para tirá-la
  // — e o que decide o que aparece DENTRO dela é `secoes_config`, abaixo.
];

/**
 * ⚠️ `quick-replies` está aqui de propósito: resposta rápida é ferramenta de
 * atendimento, não configuração de conta. Quem atende precisa VER para usar no
 * compositor; criar e editar continua barrado pelo papel (`edit-settings` é
 * admin+). Decisão do operador em 2026-08-30.
 *
 * As três seções pessoais (profile, security, appearance) não precisam ser
 * listadas — `podeVerSecao` as libera para todo perfil, sempre. Listá-las aqui
 * daria a impressão falsa de que dá para tirá-las.
 */
const SECOES_DO_ADVOGADO: SecaoId[] = ["quick-replies"];

export const PERFIS_DE_FABRICA: PerfilDeFabrica[] = [
  {
    nome: "Administrador",
    papel_base: "admin",
    telas: [...TODAS_AS_TELAS],
    secoes_config: [...TODAS_AS_SECOES],
    sistema: true,
  },
  {
    // Nasce sem recorte de canal/funil (arrays vazios = tudo). O operador
    // duplica e recorta por área.
    nome: "Advogado",
    papel_base: "agent",
    telas: TELAS_DO_ADVOGADO,
    secoes_config: SECOES_DO_ADVOGADO,
    sistema: false,
  },
  {
    // Mesmas telas do advogado menos as que só fazem sentido para quem
    // escreve. O que o torna somente-leitura é o `papel_base: viewer`, que a
    // RLS já respeita — não esta lista.
    nome: "Observador",
    papel_base: "viewer",
    telas: TELAS_DO_ADVOGADO.filter((t) => t !== "agendadas"),
    secoes_config: SECOES_DO_ADVOGADO,
    sistema: true,
  },
];
