import { describe, expect, it } from 'vitest';

import {
  podeNaTarefa,
  type AcaoDeTarefa,
  type AtorDaTarefa,
  type TarefaParaPermissao,
} from './permissoes';
import type { AccountRole } from '@/lib/auth/roles';

const CHEFE = 'u-chefe';
const COLEGA = 'u-colega';
const ESTRANHO = 'u-estranho';

/** Tarefa que o chefe criou para o colega — o caso normal. */
const NORMAL: TarefaParaPermissao = {
  criador_user_id: CHEFE,
  responsavel_user_id: COLEGA,
};

function ator(userId: string, papel: AccountRole = 'agent'): AtorDaTarefa {
  return { userId, papel };
}

const TODAS: AcaoDeTarefa[] = [
  'marcar-lida',
  'concluir',
  'importante',
  'editar',
  'apagar',
];

describe('marcar-lida', () => {
  it('é só do responsável', () => {
    expect(podeNaTarefa('marcar-lida', NORMAL, ator(COLEGA))).toBe(true);
    expect(podeNaTarefa('marcar-lida', NORMAL, ator(CHEFE))).toBe(false);
    expect(podeNaTarefa('marcar-lida', NORMAL, ator(ESTRANHO))).toBe(false);
  });

  it('nem o dono da conta marca lida pelo colega', () => {
    // ⚠️ A única ação sem porta de admin. "Lida" é o estado pessoal de quem
    // recebeu; um terceiro marcando por ele apagaria o sinal de que a tarefa
    // ainda não foi vista — que é a única coisa que a etiqueta do menu conta.
    expect(podeNaTarefa('marcar-lida', NORMAL, ator(ESTRANHO, 'owner'))).toBe(false);
    expect(podeNaTarefa('marcar-lida', NORMAL, ator(CHEFE, 'admin'))).toBe(false);
  });
});

describe('concluir e importante', () => {
  it('valem para os dois lados da tarefa', () => {
    for (const acao of ['concluir', 'importante'] as const) {
      expect(podeNaTarefa(acao, NORMAL, ator(COLEGA))).toBe(true);
      expect(podeNaTarefa(acao, NORMAL, ator(CHEFE))).toBe(true);
      expect(podeNaTarefa(acao, NORMAL, ator(ESTRANHO))).toBe(false);
    }
  });
});

describe('editar e apagar', () => {
  it('são de quem pediu, não de quem recebeu', () => {
    // ⚠️ O responsável adiando o próprio prazo esvaziaria a delegação. Quem
    // recebeu e discorda responde — o que cria tarefa nova, visível.
    for (const acao of ['editar', 'apagar'] as const) {
      expect(podeNaTarefa(acao, NORMAL, ator(CHEFE))).toBe(true);
      expect(podeNaTarefa(acao, NORMAL, ator(COLEGA))).toBe(false);
      expect(podeNaTarefa(acao, NORMAL, ator(ESTRANHO))).toBe(false);
    }
  });
});

describe('papel', () => {
  it('viewer age nas próprias tarefas como qualquer um', () => {
    // Criar tarefa é livre para todo papel (decisão do operador), então o
    // viewer também é destinatário e criador de pleno direito.
    expect(podeNaTarefa('marcar-lida', NORMAL, ator(COLEGA, 'viewer'))).toBe(true);
    expect(podeNaTarefa('concluir', NORMAL, ator(COLEGA, 'viewer'))).toBe(true);
    expect(podeNaTarefa('editar', NORMAL, ator(CHEFE, 'viewer'))).toBe(true);
  });

  it('agent estranho à tarefa não age nela', () => {
    for (const acao of TODAS) {
      expect(podeNaTarefa(acao, NORMAL, ator(ESTRANHO, 'agent'))).toBe(false);
    }
  });

  it('admin e owner alcançam tudo, menos marcar lida', () => {
    for (const papel of ['admin', 'owner'] as const) {
      expect(podeNaTarefa('concluir', NORMAL, ator(ESTRANHO, papel))).toBe(true);
      expect(podeNaTarefa('importante', NORMAL, ator(ESTRANHO, papel))).toBe(true);
      expect(podeNaTarefa('editar', NORMAL, ator(ESTRANHO, papel))).toBe(true);
      expect(podeNaTarefa('apagar', NORMAL, ator(ESTRANHO, papel))).toBe(true);
      expect(podeNaTarefa('marcar-lida', NORMAL, ator(ESTRANHO, papel))).toBe(false);
    }
  });
});

describe('tarefa órfã', () => {
  // ⚠️ O caso que a rede de segurança do admin existe para resolver: as duas
  // colunas são `ON DELETE SET NULL`, então quando alguém sai do escritório
  // suas tarefas ficam sem criador e sem responsável.
  const ORFA: TarefaParaPermissao = {
    criador_user_id: null,
    responsavel_user_id: null,
  };

  it('trava para todo agent — ninguém "é" o criador de uma tarefa sem criador', () => {
    for (const acao of TODAS) {
      expect(podeNaTarefa(acao, ORFA, ator(COLEGA, 'agent'))).toBe(false);
    }
  });

  it('o admin destrava, e é por isso que a porta existe', () => {
    // Sem ela a tarefa ficaria encalhada na fila da conta para sempre, sem
    // ninguém capaz de concluí-la ou apagá-la.
    expect(podeNaTarefa('concluir', ORFA, ator(CHEFE, 'admin'))).toBe(true);
    expect(podeNaTarefa('apagar', ORFA, ator(CHEFE, 'admin'))).toBe(true);
    expect(podeNaTarefa('editar', ORFA, ator(CHEFE, 'admin'))).toBe(true);
  });

  it('coluna nula não casa com id vazio vindo da rede', () => {
    // ⚠️ `userId` é `string` no tipo, mas a rota o recebe de fora. Sem o teste
    // de nulo em `ehCriador`/`ehResponsavel`, um id vazio casaria com a coluna
    // nula e a permissão vazaria para qualquer um.
    expect(podeNaTarefa('editar', ORFA, ator(''))).toBe(false);
    expect(podeNaTarefa('marcar-lida', ORFA, ator(''))).toBe(false);
  });
});

describe('meia-órfã', () => {
  it('quem sobrou continua agindo', () => {
    // O criador saiu; o responsável ainda está lá e a tarefa continua sendo
    // trabalho dele.
    const semCriador: TarefaParaPermissao = {
      criador_user_id: null,
      responsavel_user_id: COLEGA,
    };
    expect(podeNaTarefa('marcar-lida', semCriador, ator(COLEGA))).toBe(true);
    expect(podeNaTarefa('concluir', semCriador, ator(COLEGA))).toBe(true);
    // Mas editar continua sendo do criador — que não existe mais. Só admin.
    expect(podeNaTarefa('editar', semCriador, ator(COLEGA))).toBe(false);
    expect(podeNaTarefa('editar', semCriador, ator(COLEGA, 'admin'))).toBe(true);
  });

  it('tarefa que a pessoa criou para si mesma acumula os dois lados', () => {
    const propria: TarefaParaPermissao = {
      criador_user_id: COLEGA,
      responsavel_user_id: COLEGA,
    };
    for (const acao of TODAS) {
      expect(podeNaTarefa(acao, propria, ator(COLEGA, 'viewer'))).toBe(true);
    }
  });
});
