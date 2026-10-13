'use client';

// ============================================================
// UNIR AS FICHAS (1092) — a revisão antes de unir, dentro do "Comparar".
//
// Decisões do operador (13/10/2026, docs/PLANO-fichas-duplicadas.md):
//   D6 o sistema SUGERE a ficha que fica; o admin pode trocar;
//   D7 um card por funil — o mais avançado fica, o outro sai com a história
//      indo para o que fica;
//   D8 as automações em curso da ficha que sai terminam;
//   D9 telefone e e-mail da que sai viram contatos antigos da que fica.
// Só admin (D1). Sem desfazer: por isso a tela mostra ANTES, pela prévia do
// banco (`cb_previa_da_uniao`), tudo o que a união vai fazer — e sem a
// prévia não há botão.
//
// ⚠️ O recorte do PERFIL vale aqui como no "Comparar": card de funil fora
// do escopo aparece só como contagem (a união o leva igual).
// ============================================================

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import type { FichaComparada } from '@/hooks/use-comparacao-de-fichas';
import { unirFichas, usePreviaDaUniao } from '@/hooks/use-uniao-de-fichas';
import { nomeDoContato } from '@/lib/contacts/identidade';
import { formatarTelefone } from '@/lib/contacts/telefone';
import {
  aOutra,
  type BloqueioDaUniao,
  type CardDaUniao,
  type DivergenciaDaUniao,
  type FalhaDaUniao,
  type MotivoDaSugestao,
  type PreviaDaUniao,
  type ResultadoDaUniao,
} from '@/lib/contacts/uniao';
import { funilNoEscopo } from '@/lib/perfis/escopo';

import { identidadeLegivel } from './faixa-de-possivel-duplicata';

type T = ReturnType<typeof useTranslations<'Duplicatas.uniao'>>;

/** A frase de cada recusa — chaves LITERAIS, para o portão de i18n contar. */
export function textoDaFalha(t: T, falha: FalhaDaUniao): string {
  switch (falha) {
    case 'so_admin':
      return t('falhaSoAdmin');
    case 'membro_suspenso':
      return t('falhaSuspenso');
    case 'ficha_nao_encontrada':
      return t('falhaNaoEncontrada');
    case 'contas_diferentes':
      return t('falhaContas');
    case 'mesma_ficha':
      return t('falhaMesma');
    case 'bloqueada':
      return t('falhaBloqueada');
    case 'sem_tratamento':
      return t('falhaSemTratamento');
    case 'ocupada':
      return t('falhaOcupada');
    case 'falhou':
      return t('falhaGeral');
    default: {
      const nunca: never = falha;
      return nunca;
    }
  }
}

function textoDoBloqueio(t: T, b: BloqueioDaUniao): string {
  if (b === 'instagram') return t('bloqueioInstagram');
  if (b === 'bsuid_diferentes') return t('bloqueioBsuid');
  return t('bloqueioDesconhecido');
}

function textoDaSugestao(t: T, m: MotivoDaSugestao | null): string | null {
  if (m === 'mensagem_do_cliente') return t('motivoMensagemDoCliente');
  if (m === 'atividade') return t('motivoAtividade');
  if (m === 'mais_nova') return t('motivoMaisNova');
  return null;
}

function textoDoCard(t: T, c: CardDaUniao): string {
  if (c.acao === 'apaga') return t('cardApaga');
  if (c.acao === 'move') return t('cardMove');
  return t('cardFica');
}

function textoDaDivergencia(t: T, d: DivergenciaDaUniao): string {
  const valor = d.saiu ?? '—';
  if (d.campo === 'nome') return t('divergenciaNome', { valor });
  if (d.campo === 'empresa') return t('divergenciaEmpresa', { valor });
  return t('divergenciaCampo', { campo: d.rotulo ?? '—', valor });
}

function CaixaDaFicha({
  rotulo,
  ficha,
  semNome,
  sugestao,
}: {
  rotulo: string;
  ficha: FichaComparada | undefined;
  semNome: string;
  sugestao: string | null;
}) {
  const identidade = ficha ? identidadeLegivel(ficha) : null;
  return (
    <div className="border-border min-w-0 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {rotulo}
      </p>
      <p className="mt-1 text-sm font-semibold break-words">
        {ficha ? nomeDoContato(ficha, semNome) : '—'}
      </p>
      {identidade && (
        <p className="text-muted-foreground text-xs break-words">
          {identidade}
        </p>
      )}
      {sugestao && <p className="mt-1 text-xs text-emerald-600">{sugestao}</p>}
    </div>
  );
}

function CorpoDaPrevia({
  t,
  previa,
  ficaFicha,
  saiFicha,
  ficaEhSugerida,
  aoTrocar,
  semNome,
}: {
  t: T;
  previa: PreviaDaUniao;
  ficaFicha: FichaComparada | undefined;
  saiFicha: FichaComparada | undefined;
  ficaEhSugerida: boolean;
  aoTrocar: () => void;
  semNome: string;
}) {
  const { acesso } = useAuth();
  const visiveis = previa.cards.filter(
    (c) => !c.pipelineId || funilNoEscopo(acesso, c.pipelineId)
  );
  const ocultos = previa.cards.length - visiveis.length;
  const c = previa.contagens;
  const passam = [
    c.mensagens > 0 && t('mensagens', { count: c.mensagens }),
    c.anotacoes > 0 && t('anotacoes', { count: c.anotacoes }),
    c.tarefas > 0 && t('tarefas', { count: c.tarefas }),
    c.etiquetasNovas > 0 && t('etiquetas', { count: c.etiquetasNovas }),
    c.camposPreenchidos > 0 && t('campos', { count: c.camposPreenchidos }),
    c.agendadas > 0 && t('agendadas', { count: c.agendadas }),
  ].filter((x): x is string => typeof x === 'string');
  const sugestao = textoDaSugestao(t, previa.motivoDaSugestao);

  return (
    <div className="min-w-0 space-y-4 text-sm">
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <CaixaDaFicha
          rotulo={t('fica')}
          ficha={ficaFicha}
          semNome={semNome}
          sugestao={
            ficaEhSugerida && sugestao
              ? t('sugerida', { motivo: sugestao })
              : null
          }
        />
        <div className="flex items-center justify-center">
          <Button type="button" size="xs" variant="outline" onClick={aoTrocar}>
            {t('trocar')}
          </Button>
        </div>
        <CaixaDaFicha
          rotulo={t('sai')}
          ficha={saiFicha}
          semNome={semNome}
          sugestao={null}
        />
      </div>

      {previa.nomeFinal && (
        <p className="break-words">
          {t('nomeFinal', { nome: previa.nomeFinal })}
        </p>
      )}

      <section>
        <h4 className="text-muted-foreground text-xs font-medium">
          {t('cardsTitulo')}
        </h4>
        {previa.cards.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t('semCards')}</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs">
            {visiveis.map((card) => (
              <li key={card.dealId} className="break-words">
                <span className="font-medium">
                  {card.funil ?? '—'} · {card.etapa ?? '—'}
                </span>
                {' — '}
                {textoDoCard(t, card)}
              </li>
            ))}
            {ocultos > 0 && (
              <li className="text-muted-foreground">
                {t('cardsForaDoPerfil', { count: ocultos })}
              </li>
            )}
          </ul>
        )}
      </section>

      <section>
        <h4 className="text-muted-foreground text-xs font-medium">
          {t('passamTitulo')}
        </h4>
        <p className="text-xs">
          {passam.length > 0 ? passam.join(' · ') : t('nadaPassa')}
        </p>
      </section>

      {previa.contatosAntigos.length > 0 && (
        <section>
          <h4 className="text-muted-foreground text-xs font-medium">
            {t('contatosAntigosTitulo')}
          </h4>
          <p className="text-xs break-words">
            {previa.contatosAntigos
              .map((a) =>
                a.tipo === 'telefone' ? formatarTelefone(a.valor) : a.valor
              )
              .join(' · ')}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('contatosAntigosTexto')}
          </p>
        </section>
      )}

      {previa.divergencias.length > 0 && (
        <section>
          <h4 className="text-muted-foreground text-xs font-medium">
            {t('divergenciasTitulo')}
          </h4>
          <ul className="mt-1 space-y-0.5 text-xs">
            {previa.divergencias.map((d, i) => (
              <li
                key={`${d.campo}:${d.rotulo ?? ''}:${i}`}
                className="break-words"
              >
                {textoDaDivergencia(t, d)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(c.automacoesInterrompidas > 0 || c.robosParados > 0) && (
        <p className="text-xs">
          {[
            c.automacoesInterrompidas > 0 &&
              t('automacoes', { count: c.automacoesInterrompidas }),
            c.robosParados > 0 && t('robos', { count: c.robosParados }),
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}

      {previa.bloqueios.length > 0 ? (
        <ul className="space-y-0.5 text-xs font-medium text-red-600">
          {previa.bloqueios.map((b) => (
            <li key={b}>{textoDoBloqueio(t, b)}</li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs">
          {t('irreversivel')}
        </p>
      )}
    </div>
  );
}

export function RevisaoDaUniao({
  par,
  fichas,
  aoVoltar,
  aoUnir,
}: {
  /** [esta ficha, a outra]. */
  par: readonly [string, string];
  /** As duas fichas como o "Comparar" as leu (nome e telefone das caixas). */
  fichas: FichaComparada[] | null;
  aoVoltar: () => void;
  aoUnir: (resultado: ResultadoDaUniao) => void;
}) {
  const t = useTranslations('Duplicatas.uniao');
  const tFaixa = useTranslations('Duplicatas');
  const [esta, outra] = par;
  /** A ficha que o ADMIN escolheu manter; nula = a sugerida. */
  const [escolha, setEscolha] = useState<string | null>(null);
  const [unindo, setUnindo] = useState(false);
  const [falhaDaUniao, setFalhaDaUniao] = useState<FalhaDaUniao | null>(null);

  // A prévia "esta fica" traz também a SUGESTÃO, que vale para os dois
  // sentidos (D6). O outro sentido só é pedido quando é o escolhido.
  const base = usePreviaDaUniao(esta, outra);
  const sugerida = base.previa?.sugeridaFica ?? null;
  const fica = escolha ?? (base.carregando ? null : (sugerida ?? esta));
  const sai = fica ? aOutra(par, fica) : null;
  const invertida = usePreviaDaUniao(
    fica === outra ? outra : null,
    fica === outra ? esta : null
  );
  const atual = fica === outra ? invertida : base;

  const carregando = fica === null || atual.carregando;
  const previa = atual.previa;
  const podeUnir =
    !carregando && !unindo && previa !== null && previa.bloqueios.length === 0;

  async function confirmar() {
    if (!fica || !sai || !podeUnir) return;
    setUnindo(true);
    setFalhaDaUniao(null);
    const r = await unirFichas(fica, sai);
    if (!r.ok) {
      setUnindo(false);
      setFalhaDaUniao(r.falha);
      return;
    }
    aoUnir(r.resultado);
  }

  const fichaPorId = (id: string | null) =>
    id ? fichas?.find((f) => f.id === id) : undefined;

  return (
    <>
      <div className="min-w-0">
        <h3 className="text-base font-semibold">{t('titulo')}</h3>
        {carregando ? (
          <p className="text-muted-foreground mt-2">{t('conferindo')}</p>
        ) : atual.falha || !previa ? (
          <p className="mt-2 text-red-600">
            {textoDaFalha(t, atual.falha ?? 'falhou')}
          </p>
        ) : (
          <div className="mt-3">
            <CorpoDaPrevia
              t={t}
              previa={previa}
              ficaFicha={fichaPorId(fica)}
              saiFicha={fichaPorId(sai)}
              ficaEhSugerida={fica === sugerida}
              aoTrocar={() => setEscolha(sai)}
              semNome={tFaixa('semNome')}
            />
          </div>
        )}
        {falhaDaUniao && (
          <p className="mt-3 text-sm font-medium text-red-600">
            {textoDaFalha(t, falhaDaUniao)}
          </p>
        )}
      </div>
      <DialogFooter className="min-w-0 sm:items-center">
        <Button
          type="button"
          variant="outline"
          disabled={unindo}
          onClick={aoVoltar}
        >
          {t('voltar')}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!podeUnir}
          onClick={() => void confirmar()}
        >
          {unindo ? t('unindo') : t('confirmar')}
        </Button>
      </DialogFooter>
    </>
  );
}
