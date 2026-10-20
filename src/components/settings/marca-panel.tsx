'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Info, Loader2, Lock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { CartaoDaPeca } from '@/components/settings/marca/cartao-da-peca';
import { ExemplosDaMarca } from '@/components/settings/marca/exemplos-da-marca';
import { useMensagemDeErro } from '@/components/settings/marca/mensagem-de-erro';
import { PreviaDaMarca } from '@/components/settings/marca/previa-da-marca';
import {
  codigoConhecido,
  conferirArquivo,
  ehRecusaDePermissao,
  ehRespostaDaMarca,
  estadoDaPeca,
  formularioDoRascunho,
  montarRascunho,
  mudancasDoRascunho,
  pecaDoCampo,
  problemasDoRascunho,
  rascunhoDaLinha,
  type CodigoDeErro,
  type Rascunho,
  type RespostaDaMarca,
} from '@/components/settings/marca/rascunho';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  COR_DO_ICONE_PADRAO,
  LIMITE_DO_NOME,
  LIMITE_DO_NOME_CURTO,
  NOME_PADRAO,
  PECAS_DA_MARCA,
  corValida,
  type PecaDaMarca,
} from '@/lib/marca';
import { cn } from '@/lib/utils';

// ============================================================
// Configurações → Marca (1094): o nome e o logo da INSTALAÇÃO.
//
// Tudo passa por `/api/cb/marca` (a tabela `cb_marca` é fechada ao
// navegador). GET diz a marca atual, a linha gravada e se quem olha pode
// editar; POST grava só o que mudou; DELETE volta ao padrão. Depois de
// gravar, `router.refresh()` refaz o layout raiz — a barra lateral e o
// título da aba já saem com a marca nova.
//
// ⚠️ Carregando ou falhando, a tela NUNCA mostra o padrão como se fosse a
// marca atual (vazio por ignorância, seção 8c do CLAUDE.md): quem tem marca
// própria veria o padrão e poderia "voltar" a ele sem querer.
// ============================================================

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'erro' }
  | { tipo: 'pronto'; dados: RespostaDaMarca };

export function MarcaPanel() {
  const t = useTranslations('Settings.marca');
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [tentativa, setTentativa] = useState(0);
  // Remonta o formulário a cada gravação: o rascunho recomeça do que a
  // rota devolveu, e as URLs de objeto do rascunho velho são revogadas na
  // desmontagem.
  const [geracao, setGeracao] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const resposta = await fetch('/api/cb/marca', { cache: 'no-store' });
        const corpo: unknown = await resposta.json().catch(() => null);
        if (!vivo) return;
        if (resposta.ok && ehRespostaDaMarca(corpo)) {
          setEstado({ tipo: 'pronto', dados: corpo });
        } else {
          setEstado({ tipo: 'erro' });
        }
      } catch {
        if (vivo) setEstado({ tipo: 'erro' });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  const recarregar = () => {
    setEstado({ tipo: 'carregando' });
    setTentativa((n) => n + 1);
  };

  return (
    <section className="animate-in fade-in-50 min-w-0 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {estado.tipo === 'carregando' ? (
        <Esqueleto />
      ) : estado.tipo === 'erro' ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-destructive text-sm">{t('loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={recarregar}>
            <RotateCcw aria-hidden="true" />
            {t('retry')}
          </Button>
        </div>
      ) : (
        <FormularioDaMarca
          key={geracao}
          dados={estado.dados}
          onGravou={(dados) => {
            setEstado({ tipo: 'pronto', dados });
            setGeracao((n) => n + 1);
          }}
          onRecarregar={recarregar}
        />
      )}
    </section>
  );
}

function Esqueleto() {
  const t = useTranslations('Settings.marca');
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-muted h-20 animate-pulse rounded-lg" />
        <div className="bg-muted h-20 animate-pulse rounded-lg" />
      </div>
      <div className="bg-muted h-40 animate-pulse rounded-lg" />
      <div className="bg-muted h-56 animate-pulse rounded-lg" />
    </div>
  );
}

/** O navegador consegue desenhar a imagem (URL de objeto)? */
function carregaNoNavegador(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const imagem = new window.Image();
    imagem.onload = () => resolve(true);
    imagem.onerror = () => resolve(false);
    imagem.src = url;
  });
}

function semChave<K extends string, V>(
  objeto: Partial<Record<K, V>>,
  chave: K
): Partial<Record<K, V>> {
  if (!(chave in objeto)) return objeto;
  const copia = { ...objeto };
  delete copia[chave];
  return copia;
}

/** Exportado para o teste de desenho (`marca/marca-panel.desenho.test.tsx`). */
export function FormularioDaMarca({
  dados,
  onGravou,
  onRecarregar,
}: {
  dados: RespostaDaMarca;
  onGravou: (dados: RespostaDaMarca) => void;
  onRecarregar: () => void;
}) {
  const t = useTranslations('Settings.marca');
  const mensagemDeErro = useMensagemDeErro();
  const router = useRouter();
  const { marca: gravada, linha, podeEditar, motivo } = dados;

  const [modo, setModo] = useState<'padrao' | 'propria'>(
    gravada.propria ? 'propria' : 'padrao'
  );
  const [rascunho, setRascunho] = useState<Rascunho>(() =>
    rascunhoDaLinha(linha)
  );
  const [errosDaPeca, setErrosDaPeca] = useState<
    Partial<Record<PecaDaMarca, CodigoDeErro>>
  >({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoPadrao, setConfirmandoPadrao] = useState(false);
  const [voltando, setVoltando] = useState(false);

  // ⚠️ Trava de duplo envio que vale ANTES do próximo render: dois cliques
  // seguidos leem o mesmo `salvando === false`.
  const enviando = useRef(false);
  // URLs de objeto que o rascunho já usou; as que saem dele são revogadas
  // no efeito abaixo, e todas na desmontagem.
  const urlsCriadas = useRef(new Set<string>());
  // Vez da última escolha por peça: conferir e carregar o arquivo é
  // assíncrono, e a resposta de um arquivo trocado no meio do caminho não
  // pode ganhar.
  const vezDaEscolha = useRef<Partial<Record<PecaDaMarca, number>>>({});
  const montado = useRef(true);

  useEffect(() => {
    const urls = urlsCriadas.current;
    montado.current = true;
    return () => {
      montado.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const emUso = new Set(
      Object.values(rascunho.novas).map((nova) => nova?.url)
    );
    for (const url of urlsCriadas.current) {
      if (!emUso.has(url)) {
        URL.revokeObjectURL(url);
        urlsCriadas.current.delete(url);
      }
    }
  }, [rascunho.novas]);

  const ocupado = salvando || voltando;
  const emPropria = modo === 'propria';
  const mudancas = mudancasDoRascunho(linha, gravada, rascunho);
  const problemas = problemasDoRascunho(gravada, rascunho);
  // Peça com erro E arquivo novo no rascunho: ou a ROTA recusou esse
  // arquivo (salvar de novo daria o mesmo erro), ou a pessoa tentou trocá-lo
  // por outro que não passou — salvar mandaria o que ela quis tirar. Trocar
  // ou Desfazer limpa. (Arquivo recusado aqui nunca entra no rascunho.)
  const pecaRecusada = PECAS_DA_MARCA.some(
    (p) => errosDaPeca[p] && rascunho.novas[p]
  );
  const podeSalvar =
    podeEditar &&
    emPropria &&
    !ocupado &&
    mudancas.alguma &&
    problemas.length === 0 &&
    !pecaRecusada;

  // A prévia: o rascunho na marca própria; no padrão (ou para quem só lê),
  // a marca que está valendo.
  const previa = (() => {
    if (!podeEditar || !emPropria) return gravada;
    const m = montarRascunho(gravada, rascunho);
    if (m.nome) return m;
    const semNome = t('previaSemNome');
    return { ...m, nome: semNome, nomeCurto: m.nomeCurto || semNome };
  })();

  const limparErroDaPeca = (peca: PecaDaMarca) =>
    setErrosDaPeca((e) => semChave(e, peca));

  async function escolher(peca: PecaDaMarca, arquivo: File) {
    const vez = (vezDaEscolha.current[peca] ?? 0) + 1;
    vezDaEscolha.current[peca] = vez;
    limparErroDaPeca(peca);
    setErroGeral(null);

    const recusa = await conferirArquivo(peca, arquivo);
    const valeAinda = () =>
      montado.current && vezDaEscolha.current[peca] === vez;
    if (recusa) {
      if (valeAinda()) setErrosDaPeca((e) => ({ ...e, [peca]: recusa }));
      return;
    }

    // A regra da rota passou; falta o navegador conseguir DESENHAR o
    // arquivo (um SVG malformado passa na lista de recusa e quebra no
    // `<img>` da barra lateral).
    const url = URL.createObjectURL(arquivo);
    const desenha = await carregaNoNavegador(url);
    if (!valeAinda() || !desenha) {
      URL.revokeObjectURL(url);
      if (valeAinda()) {
        setErrosDaPeca((e) => ({ ...e, [peca]: 'arquivo_corrompido' }));
      }
      return;
    }
    urlsCriadas.current.add(url);
    setRascunho((r) => ({
      ...r,
      novas: { ...r.novas, [peca]: { arquivo, url } },
      removidas: r.removidas.filter((p) => p !== peca),
    }));
  }

  function remover(peca: PecaDaMarca) {
    limparErroDaPeca(peca);
    setRascunho((r) => ({
      ...r,
      novas: semChave(r.novas, peca),
      removidas: r.removidas.includes(peca)
        ? r.removidas
        : [...r.removidas, peca],
    }));
  }

  function desfazer(peca: PecaDaMarca) {
    // Cancela uma escolha que ainda esteja medindo a imagem.
    vezDaEscolha.current[peca] = (vezDaEscolha.current[peca] ?? 0) + 1;
    limparErroDaPeca(peca);
    setRascunho((r) => ({
      ...r,
      novas: semChave(r.novas, peca),
      removidas: r.removidas.filter((p) => p !== peca),
    }));
  }

  function descartar() {
    for (const p of PECAS_DA_MARCA) {
      vezDaEscolha.current[p] = (vezDaEscolha.current[p] ?? 0) + 1;
    }
    setRascunho(rascunhoDaLinha(linha));
    setErrosDaPeca({});
    setErroGeral(null);
    if (!gravada.propria) setModo('padrao');
  }

  /** A resposta de POST/DELETE: sucesso grava; erro diz o quê e onde. */
  async function tratarResposta(resposta: Response, sucesso: string) {
    const corpo: unknown = await resposta.json().catch(() => null);
    if (resposta.ok) {
      if (ehRespostaDaMarca(corpo)) {
        toast.success(sucesso);
        onGravou(corpo);
      } else {
        // Gravou, mas a resposta veio estranha: relê do servidor em vez
        // de afirmar qualquer coisa.
        onRecarregar();
      }
      router.refresh();
      return;
    }
    // Só o 403 que DIZ "você não pode": o de perfil ilegível é soluço do
    // banco e cai na frase genérica, abaixo.
    if (ehRecusaDePermissao(resposta.status, corpo)) {
      setErroGeral(t('semPermissao'));
      toast.error(t('semPermissao'));
      return;
    }
    const bruto = (corpo ?? {}) as { erro?: unknown; peca?: unknown };
    const codigo = resposta.status === 400 ? codigoConhecido(bruto.erro) : null;
    if (codigo) {
      const peca =
        pecaDoCampo(bruto.peca) ??
        (codigo.startsWith('simbolo_') ? 'simbolo' : null);
      if (peca) {
        setErrosDaPeca((e) => ({ ...e, [peca]: codigo }));
        setErroGeral(t('corrijaAsImagens'));
      } else {
        setErroGeral(mensagemDeErro(codigo));
      }
      toast.error(t('naoSalvou'));
      return;
    }
    setErroGeral(t('falhaGenerica'));
    toast.error(t('falhaGenerica'));
  }

  async function salvar() {
    if (enviando.current || !podeSalvar) return;
    enviando.current = true;
    setSalvando(true);
    setErroGeral(null);
    try {
      const resposta = await fetch('/api/cb/marca', {
        method: 'POST',
        body: formularioDoRascunho(linha, gravada, rascunho),
      });
      await tratarResposta(resposta, t('salvo'));
    } catch {
      setErroGeral(t('falhaGenerica'));
      toast.error(t('falhaGenerica'));
    } finally {
      enviando.current = false;
      setSalvando(false);
    }
  }

  async function voltarAoPadrao() {
    if (enviando.current) return;
    enviando.current = true;
    setVoltando(true);
    setErroGeral(null);
    try {
      const resposta = await fetch('/api/cb/marca', { method: 'DELETE' });
      await tratarResposta(resposta, t('voltouAoPadrao'));
    } catch {
      setErroGeral(t('falhaGenerica'));
      toast.error(t('falhaGenerica'));
    } finally {
      // Fecha também na falha: o erro aparece na tela (e no aviso), não
      // escondido atrás do diálogo.
      setConfirmandoPadrao(false);
      enviando.current = false;
      setVoltando(false);
    }
  }

  function escolherModo(proximo: 'padrao' | 'propria') {
    if (!podeEditar || ocupado || proximo === modo) return;
    // Voltar ao padrão com marca própria GRAVADA apaga coisa: confirma
    // antes. Do rascunho ainda não gravado, é só trocar de cartão.
    if (proximo === 'padrao' && gravada.propria) {
      setConfirmandoPadrao(true);
      return;
    }
    setErroGeral(null);
    setModo(proximo);
  }

  // O que dizer ao lado do Salvar, quando ele está desligado.
  const motivoDoSalvar = problemas[0]
    ? mensagemDeErro(problemas[0])
    : pecaRecusada
      ? t('corrijaAsImagens')
      : !mudancas.alguma
        ? t('nadaMudou')
        : null;

  return (
    <div className="min-w-0 space-y-8">
      {!podeEditar ? (
        <div
          role="note"
          className="border-border bg-muted/40 text-foreground flex min-w-0 gap-2 rounded-lg border p-3 text-sm"
        >
          <Lock
            aria-hidden="true"
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
          />
          <p className="min-w-0">
            {motivo === 'nao_e_a_conta_da_instalacao'
              ? t('somenteLeituraOutraConta')
              : t('somenteLeituraNaoAdmin')}
          </p>
        </div>
      ) : null}

      <section className="min-w-0 space-y-3">
        <h3 className="text-foreground text-sm font-semibold">
          {t('modoTitulo')}
        </h3>
        <div
          role="group"
          aria-label={t('modoTitulo')}
          className="grid min-w-0 gap-3 sm:grid-cols-2"
        >
          <CartaoDeModo
            titulo={t('modoPadrao', { nomePadrao: NOME_PADRAO })}
            dica={t('modoPadraoDica')}
            ativo={modo === 'padrao'}
            emUso={!gravada.propria}
            desabilitado={!podeEditar || ocupado}
            onEscolher={() => escolherModo('padrao')}
            rotuloEmUso={t('emUso')}
          />
          <CartaoDeModo
            titulo={t('modoPropria')}
            dica={t('modoPropriaDica')}
            ativo={modo === 'propria'}
            emUso={gravada.propria}
            desabilitado={!podeEditar || ocupado}
            onEscolher={() => escolherModo('propria')}
            rotuloEmUso={t('emUso')}
          />
        </div>
      </section>

      {podeEditar && emPropria ? (
        <>
          <section className="min-w-0 space-y-4">
            <h3 className="text-foreground text-sm font-semibold">
              {t('dadosTitulo')}
            </h3>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5 sm:col-span-2">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <Label htmlFor="marca-nome">{t('nomeLabel')}</Label>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {t('contador', {
                      atual: rascunho.nome.length,
                      limite: LIMITE_DO_NOME,
                    })}
                  </span>
                </div>
                <Input
                  id="marca-nome"
                  value={rascunho.nome}
                  maxLength={LIMITE_DO_NOME}
                  disabled={ocupado}
                  aria-describedby="marca-nome-dica"
                  onChange={(e) => {
                    const nome = e.target.value;
                    setRascunho((r) => ({ ...r, nome }));
                  }}
                />
                <p
                  id="marca-nome-dica"
                  className="text-muted-foreground text-xs"
                >
                  {t('nomeDica')}
                </p>
              </div>

              <div className="min-w-0 space-y-1.5">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <Label htmlFor="marca-nome-curto">
                    {t('nomeCurtoLabel')}
                  </Label>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {t('contador', {
                      atual: rascunho.nomeCurto.length,
                      limite: LIMITE_DO_NOME_CURTO,
                    })}
                  </span>
                </div>
                <Input
                  id="marca-nome-curto"
                  value={rascunho.nomeCurto}
                  maxLength={LIMITE_DO_NOME_CURTO}
                  disabled={ocupado}
                  aria-describedby="marca-nome-curto-dica"
                  onChange={(e) => {
                    const nomeCurto = e.target.value;
                    setRascunho((r) => ({ ...r, nomeCurto }));
                  }}
                />
                <p
                  id="marca-nome-curto-dica"
                  className="text-muted-foreground text-xs"
                >
                  {t('nomeCurtoDica')}
                </p>
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="marca-cor">{t('corLabel')}</Label>
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    type="color"
                    aria-label={t('corSeletor')}
                    disabled={ocupado}
                    value={
                      corValida(rascunho.corDoIcone.trim())
                        ? rascunho.corDoIcone.trim().toLowerCase()
                        : COR_DO_ICONE_PADRAO
                    }
                    onChange={(e) => {
                      const corDoIcone = e.target.value;
                      setRascunho((r) => ({ ...r, corDoIcone }));
                    }}
                    className="border-input h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Input
                    id="marca-cor"
                    value={rascunho.corDoIcone}
                    placeholder={COR_DO_ICONE_PADRAO}
                    maxLength={7}
                    spellCheck={false}
                    autoCapitalize="off"
                    disabled={ocupado}
                    aria-describedby="marca-cor-dica"
                    aria-invalid={
                      problemas.includes('cor_invalida') || undefined
                    }
                    onChange={(e) => {
                      const corDoIcone = e.target.value;
                      setRascunho((r) => ({ ...r, corDoIcone }));
                    }}
                  />
                </div>
                <p
                  id="marca-cor-dica"
                  className="text-muted-foreground text-xs"
                >
                  {t('corDica', { corPadrao: COR_DO_ICONE_PADRAO })}
                </p>
              </div>
            </div>
          </section>

          <section className="min-w-0 space-y-3">
            <div className="min-w-0">
              <h3 className="text-foreground text-sm font-semibold">
                {t('pecasTitulo')}
              </h3>
              <p className="text-muted-foreground mt-1 max-w-[62ch] text-xs">
                {t('pecasDescricao')}
              </p>
            </div>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              {PECAS_DA_MARCA.map((peca) => {
                const estadoDaPecaAtual = estadoDaPeca(gravada, rascunho, peca);
                return (
                  <CartaoDaPeca
                    key={peca}
                    peca={peca}
                    estado={estadoDaPecaAtual}
                    url={
                      rascunho.novas[peca]?.url ??
                      (estadoDaPecaAtual === 'gravada' ? gravada[peca] : null)
                    }
                    erro={errosDaPeca[peca] ?? null}
                    ocupado={ocupado}
                    onEscolher={(arquivo) => void escolher(peca, arquivo)}
                    onRemover={() => remover(peca)}
                    onDesfazer={() => desfazer(peca)}
                  />
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      <section className="min-w-0 space-y-3">
        <div className="min-w-0">
          <h3 className="text-foreground text-sm font-semibold">
            {t('previaTitulo')}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {/* Rascunho só quando ele DIFERE do gravado: logo depois de
                salvar, com "Nada mudou ainda", a prévia é a marca de agora. */}
            {podeEditar && emPropria && (mudancas.alguma || !gravada.propria)
              ? t('previaRascunho')
              : t('previaAtual')}
          </p>
        </div>
        <PreviaDaMarca marca={previa} />
      </section>

      {podeEditar && emPropria ? (
        <div className="border-border min-w-0 space-y-2 border-t pt-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground min-w-0 text-[13px]">
              {podeSalvar ? null : motivoDoSalvar}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={descartar}
                disabled={ocupado || (!mudancas.alguma && gravada.propria)}
              >
                {t('descartar')}
              </Button>
              <Button onClick={() => void salvar()} disabled={!podeSalvar}>
                {salvando ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                {salvando ? t('salvando') : t('salvar')}
              </Button>
            </div>
          </div>
          {erroGeral ? (
            <p role="alert" className="text-destructive text-[13px]">
              {erroGeral}
            </p>
          ) : null}
        </div>
      ) : erroGeral ? (
        <p role="alert" className="text-destructive text-[13px]">
          {erroGeral}
        </p>
      ) : null}

      <div className="border-border bg-muted/40 text-muted-foreground min-w-0 space-y-1.5 rounded-lg border p-3 text-xs">
        <p className="flex min-w-0 gap-2">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{t('avisoIphone')}</span>
        </p>
        <p className="flex min-w-0 gap-2">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{t('avisoAba')}</span>
        </p>
      </div>

      <ExemplosDaMarca />

      <Dialog
        open={confirmandoPadrao}
        onOpenChange={(aberto) => {
          if (!aberto && !voltando) setConfirmandoPadrao(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="min-w-0">
            <DialogTitle>{t('voltarTitulo')}</DialogTitle>
            <DialogDescription>
              {t('voltarDescricao', { nomePadrao: NOME_PADRAO })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={voltando}
              onClick={() => setConfirmandoPadrao(false)}
            >
              {t('cancelar')}
            </Button>
            <Button
              variant="destructive"
              disabled={voltando}
              onClick={() => void voltarAoPadrao()}
            >
              {voltando ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              {voltando ? t('voltando') : t('voltarConfirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CartaoDeModo({
  titulo,
  dica,
  ativo,
  emUso,
  desabilitado,
  onEscolher,
  rotuloEmUso,
}: {
  titulo: string;
  dica: string;
  ativo: boolean;
  emUso: boolean;
  desabilitado: boolean;
  onEscolher: () => void;
  rotuloEmUso: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      disabled={desabilitado}
      onClick={onEscolher}
      className={cn(
        'flex min-w-0 flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors',
        ativo
          ? 'border-primary bg-primary-soft'
          : 'border-border hover:bg-muted',
        desabilitado && 'cursor-not-allowed',
        desabilitado && !ativo && 'opacity-60 hover:bg-transparent'
      )}
    >
      <span className="flex w-full min-w-0 items-center justify-between gap-2">
        <span
          className={cn(
            'min-w-0 truncate text-sm font-semibold',
            ativo ? 'text-primary' : 'text-foreground'
          )}
        >
          {titulo}
        </span>
        {emUso ? (
          <span className="border-border bg-background text-muted-foreground shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium">
            {rotuloEmUso}
          </span>
        ) : null}
      </span>
      <span className="text-muted-foreground text-xs">{dica}</span>
    </button>
  );
}
