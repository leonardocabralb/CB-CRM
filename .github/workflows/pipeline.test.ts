import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// O portão do deploy, travado no fonte.
//
// Este arquivo publica em PRODUÇÃO e o passo do rollout carrega a chave SSH
// da VPS. Os dois defeitos que o PR #100 consertou (M8 e M9 do plano de
// 31/08) eram PRÉ-EXISTENTES, herdados do `deploy.yml` original, e
// compartilhavam o pior modo de falha que um pipeline pode ter: parecer
// verde.
//
//   M9  o guarda era `github.event_name != 'pull_request'`, e
//       `workflow_dispatch` passa. "Run workflow" numa branch de feature
//       fazia rollout dela na VPS E reescrevia a tag `:latest`, que é o
//       padrão do `docker-stack.yml` — a receita de emergência passava a
//       ressuscitar a branch, semanas depois.
//
//   M8  o `else` do `docker service inspect` saía com código 0. Ele cobria
//       quatro situações e só uma era benigna; nas outras três o serviço
//       existe, segue na imagem velha, e o pipeline se declarava
//       bem-sucedido.
//
// ⚠️ NENHUM teste de código alcança isto — só ler o YAML. E a regressão
// natural é alguém "simplificar": trocar a lista de permissão por uma
// negação, ou as sondas por um `|| true`. Daí os pinos.
//
// A lista de permissão do M9 é mais forte que um teste de ref sozinho, e o
// motivo está no próprio YAML: `pull_request_target`, se um dia entrar no
// `on:`, roda com a ref da BASE (`refs/heads/main`) — a ref sozinha o
// deixaria passar, com a chave SSH em mão.
// ============================================================

const yml = fs.readFileSync(path.join(__dirname, 'pipeline.yml'), 'utf8');

/** O bloco do job `deploy`, do cabeçalho até o próximo job (ou o fim). */
function jobDoDeploy(): string {
  const i = yml.indexOf('\n  deploy:');
  expect(i, 'job deploy não encontrado').toBeGreaterThan(-1);
  const resto = yml.slice(i + 1);
  const j = resto.search(/\n {2}[a-z_-]+:\n/);
  return j > 0 ? resto.slice(0, j) : resto;
}

const rollout = (() => {
  const i = yml.indexOf('ROLLOUT_SCRIPT: |');
  expect(i, 'ROLLOUT_SCRIPT não encontrado').toBeGreaterThan(-1);
  return yml.slice(i, yml.indexOf('    steps:', i));
})();

describe('pipeline: quem pode publicar (M9)', () => {
  it('a ref é exigida — só o main publica', () => {
    expect(jobDoDeploy()).toContain("github.ref == 'refs/heads/main'");
  });

  it('é LISTA DE PERMISSÃO de eventos, não uma negação', () => {
    // Negar `pull_request` deixava `workflow_dispatch` passar, e deixaria
    // `pull_request_target` passar duas vezes (evento diferente, ref da
    // base). Enumerar quem PODE publicar fecha os dois de uma vez.
    const job = jobDoDeploy();
    expect(job).toContain("github.event_name == 'push'");
    expect(job).toContain("github.event_name == 'workflow_dispatch'");
  });

  it('o teste antigo, que deixava o disparo manual passar, não voltou', () => {
    // Só nas linhas de `if:` — a explicação em prosa cita a forma antiga de
    // propósito, e acusá-la faria o teste brigar com a documentação.
    for (const linha of [...yml.matchAll(/^\s*if:.*$/gm)].map((m) => m[0])) {
      expect(linha).not.toContain("event_name != 'pull_request'");
    }
  });

  it('o deploy continua dependendo da verificação', () => {
    expect(jobDoDeploy()).toContain('needs: [verificar]');
  });
});

describe('pipeline: o rollout não pode falhar em verde (M8)', () => {
  it('sonda o daemon e o papel de manager ANTES de perguntar pelo serviço', () => {
    // Sondar é mais robusto que casar a mensagem de erro do `inspect`: o
    // texto do Docker muda entre versões e idiomas, a sonda não.
    expect(rollout).toContain('docker info');
    expect(rollout).toContain('{{.Swarm.LocalNodeState}}');
    expect(rollout).toContain('{{.Swarm.ControlAvailable}}');
  });

  it('cada motivo de não publicar termina em `exit 1`', () => {
    // Três saídas de falha (daemon, manager, serviço ausente). Sair 0 em
    // qualquer uma é mentir sobre ter publicado.
    expect(rollout.match(/exit 1/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('não sobrou ramo que só ecoa e segue verde', () => {
    // A forma exata do defeito antigo.
    expect(rollout).not.toMatch(/else\s*\n\s*echo[^\n]*\n(\s*echo[^\n]*\n)*\s*fi/);
  });

  it('o update é a ÚLTIMA coisa, depois das três sondas', () => {
    const iUpdate = rollout.indexOf('docker service update');
    expect(iUpdate).toBeGreaterThan(rollout.indexOf('docker info'));
    expect(iUpdate).toBeGreaterThan(rollout.indexOf('docker service inspect'));
  });
});
