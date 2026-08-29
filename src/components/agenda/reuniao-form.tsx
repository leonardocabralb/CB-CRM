'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FUSO_PADRAO, diaNoFuso, horaNoFuso, paraInstante } from '@/lib/agenda/fuso';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import { SeletorDeCliente } from '@/components/agenda/seletor-de-cliente';
import { useAuth } from '@/hooks/use-auth';
import { fetchAccountMembers } from '@/lib/account/members';
import type {
  AccountMember,
  Contact,
  Meeting,
  MeetingStatus,
  MeetingType,
} from '@/types';

/**
 * Criar e editar reunião (migration 945).
 *
 * ⚠️ O FORMULÁRIO TRABALHA EM HORA LOCAL E GRAVA INSTANTE. Os campos são
 * `<input type="date">` e `<input type="time">`, que só sabem de hora de
 * parede; a conversão para instante acontece no envio, por `paraInstante`, e é
 * a única maneira de a reunião das 14h ser às 14h para o cliente. Mandar o
 * valor cru do campo grava 14h UTC — 11h em Brasília.
 */

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  /** Preenchido = edição; vazio = criação. */
  reuniao?: Meeting | null;
  /** Dia pré-selecionado ao criar (`YYYY-MM-DD`), quando veio de uma célula. */
  diaInicial?: string | null;
  /** Hora pré-selecionada (`HH:MM`), quando veio de um clique na grade. */
  horaInicial?: string | null;
  /** Cliente pré-selecionado, quando veio da ficha dele. */
  contactId?: string | null;
  aoSalvar: () => void;
}

const DURACOES = [15, 30, 45, 60, 90, 120];

export function ReuniaoForm({
  aberto,
  aoFechar,
  reuniao,
  diaInicial,
  horaInicial,
  contactId,
  aoSalvar,
}: Props) {
  const t = useTranslations('Agenda');
  const { user } = useAuth();

  // ⚠️ Busca direta em vez de um hook `use-membros`: a branch de Tarefas cria
  // um com esse nome, e duas versões do mesmo hook conflitariam no merge sem
  // que nenhuma das duas features precisasse disso. `fetchAccountMembers` já
  // engole o erro e devolve `[]`.
  const [membros, setMembros] = useState<AccountMember[]>([]);

  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<MeetingType>('outra');
  const [status, setStatus] = useState<MeetingStatus>('agendada');
  const [dia, setDia] = useState('');
  const [hora, setHora] = useState('09:00');
  const [duracao, setDuracao] = useState(60);
  const [responsavel, setResponsavel] = useState('');
  const [local, setLocal] = useState('');
  const [descricao, setDescricao] = useState('');

  // O cliente da reunião. `travado` quando o formulário foi aberto da ficha
  // dele — ali o vínculo é o motivo de a reunião existir.
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [clienteNome, setClienteNome] = useState<string | null>(null);

  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const editando = Boolean(reuniao);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    void fetchAccountMembers().then((lista) => {
      if (!cancelado) setMembros(lista);
    });
    return () => {
      cancelado = true;
    };
  }, [aberto]);

  // Repõe o formulário toda vez que abre — sem isto, abrir para criar depois de
  // ter editado traz os dados da reunião anterior.
  //
  // O `disable` cobre o bloco porque a regra aponta cada `setState` de dentro,
  // não a linha do `useEffect`. É o mesmo padrão do `use-conversation-notes`.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!aberto) return;

    if (reuniao) {
      const inicio = new Date(reuniao.starts_at);
      const fim = new Date(reuniao.ends_at);
      setTitulo(reuniao.titulo);
      setTipo(reuniao.tipo);
      setStatus(reuniao.status);
      setDia(diaNoFuso(inicio, FUSO_PADRAO));
      setHora(horaNoFuso(inicio, FUSO_PADRAO));
      setDuracao(Math.round((fim.getTime() - inicio.getTime()) / 60000));
      setResponsavel(reuniao.owner_user_id ?? '');
      setLocal(reuniao.local ?? '');
      setDescricao(reuniao.descricao ?? '');
      setClienteId(reuniao.contact_id);
      setClienteNome(reuniao.contato_nome);
    } else {
      setTitulo('');
      setTipo('outra');
      setStatus('agendada');
      setDia(diaInicial ?? diaNoFuso(new Date(), FUSO_PADRAO));
      setHora(horaInicial ?? '09:00');
      setDuracao(60);
      // ⚠️ Nasce com quem está criando, que é o mesmo padrão que a rota aplica
      // quando o corpo não traz `owner_user_id`. Deixar vazio fazia o campo
      // abrir com um rótulo genérico em cinza, com cara de não preenchido —
      // e foi assim que a reunião pareceu "não ter responsável".
      setResponsavel(user?.id ?? '');
      setClienteId(contactId ?? null);
      setClienteNome(null);
      setLocal('');
      setDescricao('');
    }
    setErro(null);
    setConfirmandoApagar(false);
  }, [aberto, reuniao, diaInicial, horaInicial, contactId, user?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function salvar() {
    setErro(null);

    if (!titulo.trim()) {
      setErro(t('erroTitulo'));
      return;
    }
    if (!dia || !hora) {
      setErro(t('erroData'));
      return;
    }

    setSalvando(true);

    // ⚠️ Aqui é onde a hora de parede vira instante. `toISOString()` deixa a
    // string com `Z`, que é o que a validação da rota exige.
    const inicio = paraInstante(dia, hora, FUSO_PADRAO);
    const fim = new Date(inicio.getTime() + duracao * 60000);

    const corpo: Record<string, unknown> = {
      titulo: titulo.trim(),
      tipo,
      status,
      starts_at: inicio.toISOString(),
      ends_at: fim.toISOString(),
      local: local.trim() || null,
      descricao: descricao.trim() || null,
    };

    if (responsavel) corpo.owner_user_id = responsavel;
    // ⚠️ `null` explícito, nunca omitido: omitir significaria "não mexer", e
    // desvincular o cliente não teria como ser gravado.
    corpo.contact_id = clienteId;

    const resposta = await fetch(
      editando ? `/api/cb/agenda/${reuniao!.id}` : '/api/cb/agenda',
      {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      },
    );

    setSalvando(false);

    if (!resposta.ok) {
      const dados = (await resposta.json().catch(() => ({}))) as {
        error?: string;
      };
      setErro(dados.error ?? t('erroSalvar'));
      return;
    }

    aoSalvar();
    aoFechar();
  }

  /**
   * Apagar a reunião.
   *
   * ⚠️ Em DOIS cliques, sem `window.confirm`: o diálogo nativo bloqueia a
   * thread e, dentro de um modal, alguns navegadores o suprimem — o operador
   * clicaria em "Apagar" e nada aconteceria. O segundo clique confirma no
   * próprio botão, que passa a dizer o que vai acontecer.
   */
  async function apagar() {
    if (!reuniao) return;

    if (!confirmandoApagar) {
      setConfirmandoApagar(true);
      return;
    }

    setErro(null);
    setApagando(true);

    const resposta = await fetch(`/api/cb/agenda/${reuniao.id}`, {
      method: 'DELETE',
    });

    setApagando(false);

    if (!resposta.ok) {
      const dados = (await resposta.json().catch(() => ({}))) as {
        error?: string;
      };
      setErro(dados.error ?? t('erroApagar'));
      setConfirmandoApagar(false);
      return;
    }

    aoSalvar();
    aoFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? t('editarReuniao') : t('novaReuniao')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="titulo">{t('campoTitulo')}</Label>
            <Input
              id="titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={t('tituloPlaceholder')}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dia">{t('dia')}</Label>
              <Input
                id="dia"
                type="date"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hora">{t('hora')}</Label>
              <Input
                id="hora"
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('duracao')}</Label>
              <Select
                value={String(duracao)}
                onValueChange={(v) => v && setDuracao(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURACOES.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {t('minutos', { count: m })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('tipo')}</Label>
              <Select value={tipo} onValueChange={(v) => v && setTipo(v as MeetingType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="onboarding">{t('tipoOnboarding')}</SelectItem>
                  <SelectItem value="atualizacao">{t('tipoAtualizacao')}</SelectItem>
                  <SelectItem value="outra">{t('tipoOutra')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ⚠️ SEMPRE VISÍVEL, inclusive na edição e com um membro só.
              A primeira versão escondia o campo quando a conta tinha menos de
              dois membros, copiando a convenção de canal ("seletor some quando
              não decide nada"). A transposição estava errada: canal sem
              alternativa não decide nada, mas o responsável SEMPRE decide de
              quem é a reunião — e escondê-lo impedia até de ler. Com a conta
              recém-criada, que tem um dono só, o campo simplesmente nunca
              apareceu e a reunião parecia não ter responsável.

              Trocar o dono na edição é permitido: a restrição de sobreposição
              vai avaliar o horário na agenda do NOVO responsável, e a rota já
              traduz esse conflito numa frase legível. */}
          <div className="space-y-2">
            <Label>{t('responsavel')}</Label>
            {membros.length > 0 ? (
              <Select value={responsavel} onValueChange={(v) => setResponsavel(v ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {membros.find((m) => m.user_id === responsavel)?.full_name ??
                      reuniao?.owner_nome ??
                      t('euMesmo')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {membros.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              /* ⚠️ A busca de membros falhou (ela devolve `[]` em qualquer
                 erro). Some o seletor, mas NÃO o dado: quem já é o responsável
                 continua na tela como texto. Sumir com tudo faria uma falha de
                 rede parecer "esta reunião não tem responsável". */
              <p className="text-sm text-muted-foreground">
                {reuniao?.owner_nome ?? t('euMesmo')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('cliente')}</Label>
              {/* ⚠️ Só na edição, e só com cliente vinculado: é o atalho que
                  leva da agenda para o atendimento. Prefere a CONVERSA quando
                  a reunião nasceu de uma (`/inbox?c=`), e cai na ficha
                  (`/contacts?contact=`) quando não — nem todo cliente tem
                  conversa aberta, e a ficha também mostra nome e telefone. */}
              {editando && clienteId && (
                <Link
                  href={
                    reuniao?.conversation_id
                      ? `/inbox?c=${reuniao.conversation_id}`
                      : `/contacts?contact=${clienteId}`
                  }
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {reuniao?.conversation_id ? t('abrirConversa') : t('abrirFicha')}
                  <ExternalLink className="size-3" />
                </Link>
              )}
            </div>
            <SeletorDeCliente
              valor={clienteId}
              nomeAtual={clienteNome}
              travado={Boolean(contactId)}
              aoEscolher={(c: Contact | null) => {
                setClienteId(c?.id ?? null);
                setClienteNome(c ? c.name || c.phone : null);
              }}
            />
          </div>

          {editando && (
            <div className="space-y-2">
              <Label>{t('situacao')}</Label>
              <Select
                value={status}
                onValueChange={(v) => v && setStatus(v as MeetingStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agendada">{t('statusAgendada')}</SelectItem>
                  <SelectItem value="realizada">{t('statusRealizada')}</SelectItem>
                  <SelectItem value="cancelada">{t('statusCancelada')}</SelectItem>
                  <SelectItem value="falta">{t('statusFalta')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="local">{t('local')}</Label>
            <Input
              id="local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder={t('localPlaceholder')}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">{t('descricao')}</Label>
            <Textarea
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </div>

          {erro && (
            <p className="text-sm text-destructive" role="alert">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Apagar fica à ESQUERDA, longe de Salvar: são vizinhos com
              consequências opostas, e a reunião apagada não volta. */}
          {editando ? (
            <Button
              variant="ghost"
              onClick={apagar}
              disabled={salvando || apagando}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {apagando
                ? t('apagando')
                : confirmandoApagar
                  ? t('confirmarApagar')
                  : t('apagar')}
            </Button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={aoFechar} disabled={salvando || apagando}>
              {t('cancelar')}
            </Button>
            <Button onClick={salvar} disabled={salvando || apagando}>
              {salvando ? t('salvando') : t('salvar')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
