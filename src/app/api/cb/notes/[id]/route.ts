import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { createClient } from '@/lib/supabase/server';
import { canWriteNotes, isAccountRole } from '@/lib/auth/roles';
import { MAX_MARCADOS, MAX_TEXTO_DA_ANOTACAO } from '@/lib/notes/anotacao-da-automacao';
import {
  MAX_ANEXOS_DA_NOTA,
  conferirAnexo,
  corpoDoAviso,
  lerAnexosDaNota,
  lerAnexosDoCorpo,
  mantidosSaoDaNota,
  type AnexoDaNota,
} from '@/lib/notes/anexos';
import { lerArquivoDoAnexo } from '@/lib/notes/arquivo-do-anexo';

/**
 * As escritas numa anotação que já existe. O navegador não faz UPDATE nesta
 * tabela (a 918/920 revogaram o de `authenticated` — um `.update()` do
 * cliente voltaria "0 linhas" com cara de sucesso): tudo passa por aqui.
 *
 * - `PATCH` — fixar/desafixar no topo da ficha do cliente (951). A régua de
 *   quem pode é a de quem anota (`canWriteNotes`): fixar é curadoria da
 *   ficha, não edição de conteúdo. "Uma por cliente" é garantido pelo ÍNDICE
 *   PARCIAL da 951, não por esta rota: limpar a antiga e carimbar a nova são
 *   dois UPDATEs, e entre eles cabe outra requisição — quando isso acontecer,
 *   o segundo carimbo leva 23505 e volta como "alguém fixou junto", nunca
 *   como duas fixadas.
 * - `PUT` — EDITAR (Fase 3 da anotação com anexos; D7 e A2–A5 do operador):
 *   texto e anexos, só pelo AUTOR. Ver o cabeçalho do `PUT`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: erroPerfil } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle();
  // Erro de LEITURA não é "sem conta" (raiz, 8b): seria 403 por falha do banco.
  if (erroPerfil) {
    console.error('[PATCH /api/cb/notes] profile:', erroPerfil.message);
    return NextResponse.json({ error: erroPerfil.message }, { status: 500 });
  }
  const accountId = profile?.account_id as string | undefined;
  const papel = profile?.account_role;
  if (!accountId || !isAccountRole(papel) || !canWriteNotes(papel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { fixada } = (body ?? {}) as { fixada?: unknown };
  if (typeof fixada !== 'boolean') {
    return NextResponse.json(
      { error: "'fixada' must be a boolean" },
      { status: 400 }
    );
  }

  // Lida com o cliente DO USUÁRIO, sob RLS — é o que prova que a nota é de
  // uma conta que ele enxerga, antes de o service-role escrever.
  const { data: nota, error: notaErr } = await supabase
    .from('cb_conversation_notes')
    .select('id, contact_id')
    .eq('id', id)
    .maybeSingle();
  if (notaErr) {
    // Erro de banco não vira "não encontrado" (regra do projeto).
    console.error('[PATCH /api/cb/notes] lookup:', notaErr.message);
    return NextResponse.json({ error: 'Failed to load note' }, { status: 500 });
  }
  if (!nota) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }
  // Nota de GRUPO não fixa: a fixação é "uma por CLIENTE", e grupo não tem
  // contato (o índice parcial da 951 nem a cobre).
  if (!nota.contact_id) {
    return NextResponse.json(
      { error: 'GROUP_NOTE_NOT_PINNABLE' },
      { status: 409 }
    );
  }

  const admin = supabaseAdmin();

  if (fixada) {
    // Desafixa a anterior do MESMO cliente antes de carimbar a nova.
    const { error: erroLimpa } = await admin
      .from('cb_conversation_notes')
      .update({ fixada_em: null })
      .eq('account_id', accountId)
      .eq('contact_id', nota.contact_id)
      .not('fixada_em', 'is', null);
    if (erroLimpa) {
      console.error('[PATCH /api/cb/notes] unpin previous:', erroLimpa.message);
      return NextResponse.json(
        { error: 'Failed to pin note' },
        { status: 500 }
      );
    }
  }

  const { data: atual, error: erroFixa } = await admin
    .from('cb_conversation_notes')
    .update({ fixada_em: fixada ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single();
  if (erroFixa) {
    const codigo = (erroFixa as { code?: string }).code;
    // 23505 = o índice parcial desempatou uma corrida de duas fixações.
    if (codigo === '23505') {
      return NextResponse.json(
        { error: 'PINNED_BY_SOMEONE_ELSE' },
        { status: 409 }
      );
    }
    // PGRST116 = o `.single()` casou 0 linhas: a nota foi APAGADA entre a
    // leitura sob RLS e este update (DELETE é direto do navegador). Não é
    // defeito do servidor — mas a limpeza da fixada anterior JÁ commitou
    // (dois UPDATEs sem transação), então o cliente fica sem fixada e
    // refaz o pin se quiser. 409 honesto, sem log de erro falso.
    if (codigo === 'PGRST116') {
      return NextResponse.json({ error: 'NOTE_GONE' }, { status: 409 });
    }
    console.error('[PATCH /api/cb/notes] pin:', erroFixa.message);
    return NextResponse.json({ error: 'Failed to pin note' }, { status: 500 });
  }

  return NextResponse.json({ note: atual });
}

/**
 * O instante como o PostgREST e o tempo real o escrevem ("2026-10-23T21:00:00.123+00:00",
 * com ou sem o "T"). Só a FORMA: quem compara é o banco.
 */
const INSTANTE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;

/**
 * Por que a nota não veio — na leitura com a cerca de versão ou no UPDATE
 * cercado: APAGADA, ou EDITADA noutro lugar desde que a pessoa abriu a
 * edição. Medido, nunca deduzido (raiz, 8b): relê sem a cerca. Editada, a
 * resposta leva a nota ATUAL (`note`): a lista da tela pode estar velha (o
 * tempo real perdeu o UPDATE), e editar de novo a partir dela daria 409 em
 * laço.
 */
async function porQueNaoVeio(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  accountId: string
): Promise<NextResponse> {
  const { data, error } = await supabase
    .from('cb_conversation_notes')
    .select('*')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[PUT /api/cb/notes] relendo a nota:', error.message);
    return NextResponse.json({ error: 'Failed to load note' }, { status: 500 });
  }
  return NextResponse.json(
    data ? { error: 'NOTE_CHANGED', note: data } : { error: 'NOTE_GONE' },
    { status: 409 }
  );
}

/**
 * EDITAR a anotação (Fase 3; D7 e A2–A5 do operador). Corpo:
 * `{ texto, mencionados, mantidos, novos, versao }`.
 *
 * - Só o AUTOR (A2): o admin segue APAGANDO qualquer anotação, mas não
 *   reescreve a de outra pessoa — a autoria carimbada passaria a mentir.
 *   Anotação sem autor (automação, agente de IA) não se edita. Sem prazo (A3).
 * - ⚠️ A nota é lida sob RLS (o cliente DO USUÁRIO): é o que prova que ela é
 *   de uma conta que ele enxerga, antes de o service role escrever.
 * - ⚠️⚠️ CERCA DE VERSÃO: `versao` é o `editada_em` que a caixa tinha ao abrir
 *   a edição (`null` = nunca editada). A leitura E o UPDATE exigem
 *   `editada_em` igual a ela, comparado pelo BANCO (o tempo real e o
 *   PostgREST escrevem o instante cada um a seu jeito). Editada noutra aba ou
 *   aparelho desde então = 409 `NOTE_CHANGED`, com a nota ATUAL em `note` —
 *   nunca sobrescreve uma edição que a pessoa não viu. Fixar não mexe em
 *   `editada_em`, e não conflita. Apagada no meio = 409 `NOTE_GONE`. O UPDATE
 *   leva também a conta e o autor.
 * - Os anexos que FICAM (`mantidos`, pelo caminho; OBRIGATÓRIO — tirar todos
 *   é `[]`: um corpo sem o campo apagaria os anexos, sem volta) têm de ser da
 *   nota (`mantidosSaoDaNota`); os NOVOS (`novos`, já subidos pela caixa)
 *   passam pela régua do POST: desta conta e de `notas/`, e tamanho e tipo
 *   LIDOS no armazenamento (503 × 400; a recusa diz qual, em `anexo`).
 * - NADA MUDOU (o mesmo texto e os mesmos anexos, na mesma ordem) = 200 sem
 *   UPDATE: `editada_em` só muda quando algo mudou de fato (A4).
 * - O anexo TIRADO não é apagado aqui: o gatilho da 1102 (UPDATE OF anexos)
 *   o põe na fila de arquivos, e a drenagem confere se ninguém mais o cita.
 * - A menção ACRESCENTADA avisa só quem ENTROU (padrão aceito em 23/10/2026):
 *   quem já estava mencionado não recebe de novo, e o aviso antigo fica como
 *   foi escrito. `mencoesNotificadas: false` = havia a quem avisar e falhou.
 *   `mencionados` AUSENTE (a caixa não soube quem é da conta) mantém a lista
 *   gravada; `[]` a esvazia. O SUSPENSO (1067) fica na lista gravada, mas
 *   não é avisado: a caixa refaz a menção contra todos os membros, e tirá-lo
 *   da lista o faria "entrar" de novo — com outro aviso — depois da volta.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: erroPerfil } = await supabase
    .from('profiles')
    .select('account_id, account_role, full_name, email')
    .eq('user_id', user.id)
    .maybeSingle();
  if (erroPerfil) {
    console.error('[PUT /api/cb/notes] profile:', erroPerfil.message);
    return NextResponse.json({ error: erroPerfil.message }, { status: 500 });
  }
  const accountId = profile?.account_id as string | undefined;
  const papel = profile?.account_role;
  if (!accountId || !isAccountRole(papel) || !canWriteNotes(papel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { texto, mencionados, mantidos, novos, versao } = (body ?? {}) as {
    texto?: unknown;
    mencionados?: unknown;
    /** Os caminhos dos anexos que FICAM (da nota). */
    mantidos?: unknown;
    /** Os anexos novos, já subidos pela caixa: `[{ caminho, nome }]`. */
    novos?: unknown;
    /** O `editada_em` que a caixa tinha ao abrir a edição (`null` = nunca). */
    versao?: unknown;
  };
  if (typeof texto !== 'string') {
    return NextResponse.json({ error: 'texto must be a string' }, { status: 400 });
  }
  if (texto.length > MAX_TEXTO_DA_ANOTACAO) {
    return NextResponse.json({ error: 'Note is too long' }, { status: 400 });
  }
  if (versao !== null && (typeof versao !== 'string' || !INSTANTE.test(versao))) {
    return NextResponse.json(
      { error: 'versao must be the editada_em that was read (or null)' },
      { status: 400 }
    );
  }
  // `mantidos` é OBRIGATÓRIO: ausente "tiraria todos" — e o gatilho da 1102
  // apagaria os arquivos em ~15 min, sem volta. Tirar todos é `[]`.
  if (!Array.isArray(mantidos)) {
    return NextResponse.json(
      { error: 'mantidos must be the list of attachment paths that stay ([] = none)' },
      { status: 400 }
    );
  }
  const textoLimpo = texto.trim();
  // A forma e o lugar dos NOVOS (desta conta, em `notas/`, até 10, sem
  // repetir) ANTES de qualquer leitura no banco ou no armazenamento.
  const novosPedidos = lerAnexosDoCorpo(novos, accountId);
  if (!novosPedidos.ok) {
    return NextResponse.json({ error: novosPedidos.erro }, { status: 400 });
  }
  // AUSENTE = "não sei": a caixa não conseguiu a lista de membros (ver
  // adiante: a lista gravada fica). Presente, a mesma régua do POST.
  const pedidosDeMencao =
    mencionados === undefined
      ? null
      : Array.isArray(mencionados)
        ? [...new Set(mencionados.filter((m): m is string => typeof m === 'string'))]
            .filter((m) => UUID.test(m))
            .slice(0, MAX_MARCADOS)
        : [];

  // A nota, sob RLS, NA VERSÃO que a pessoa editou.
  const leitura = supabase
    .from('cb_conversation_notes')
    .select('*')
    .eq('id', id)
    .eq('account_id', accountId);
  const { data: nota, error: erroNota } = await (versao === null
    ? leitura.is('editada_em', null)
    : leitura.eq('editada_em', versao)
  ).maybeSingle();
  if (erroNota) {
    console.error('[PUT /api/cb/notes] lookup:', erroNota.message);
    return NextResponse.json({ error: 'Failed to load note' }, { status: 500 });
  }
  if (!nota) return porQueNaoVeio(supabase, id, accountId);
  if (nota.author_user_id !== user.id) {
    return NextResponse.json({ error: 'NOT_THE_AUTHOR' }, { status: 403 });
  }

  const ficam = mantidosSaoDaNota(mantidos, nota.anexos);
  if (!ficam.ok) {
    return NextResponse.json(
      { error: ficam.erro, ...(ficam.caminho ? { anexo: { caminho: ficam.caminho } } : {}) },
      { status: 400 }
    );
  }
  const caminhosQueFicam = new Set(ficam.anexos.map((a) => a.caminho));
  const repetido = novosPedidos.anexos.find((n) => caminhosQueFicam.has(n.caminho));
  if (repetido) {
    return NextResponse.json(
      { error: 'ATTACHMENT_REPEATED', anexo: { caminho: repetido.caminho, nome: repetido.nome } },
      { status: 400 }
    );
  }
  const total = ficam.anexos.length + novosPedidos.anexos.length;
  if (total > MAX_ANEXOS_DA_NOTA) {
    return NextResponse.json({ error: 'TOO_MANY_ATTACHMENTS' }, { status: 400 });
  }
  // Texto OU anexo — a mesma régua do CHECK `..._conteudo_ck` da 1102.
  if (!textoLimpo && total === 0) {
    return NextResponse.json({ error: 'texto or anexos is required' }, { status: 400 });
  }

  // Nada mudou: devolve a nota como está, sem UPDATE (e sem marca "editada").
  const antes = lerAnexosDaNota(nota.anexos).map((a) => a.caminho);
  const depois = [...caminhosQueFicam, ...novosPedidos.anexos.map((a) => a.caminho)];
  if (
    textoLimpo === String(nota.texto ?? '').trim() &&
    antes.length === depois.length &&
    antes.every((c, i) => c === depois[i])
  ) {
    return NextResponse.json({ note: nota, mudou: false, mencoesNotificadas: true });
  }

  const admin = supabaseAdmin();

  // Os NOVOS conferidos no PRÓPRIO armazenamento, como no POST.
  const novosConferidos: AnexoDaNota[] = [];
  for (const pedido of novosPedidos.anexos) {
    const lido = await lerArquivoDoAnexo(admin, pedido.caminho);
    if (lido.estado === 'falhou') {
      console.error('[PUT /api/cb/notes] não deu para conferir o anexo:', lido.motivo);
      return NextResponse.json({ error: 'STORAGE_UNAVAILABLE' }, { status: 503 });
    }
    const qual = { caminho: pedido.caminho, nome: pedido.nome };
    if (lido.estado === 'ausente') {
      return NextResponse.json({ error: 'ATTACHMENT_NOT_FOUND', anexo: qual }, { status: 400 });
    }
    const conferido = conferirAnexo(pedido, lido);
    if (!conferido.ok) {
      return NextResponse.json({ error: conferido.erro, anexo: qual }, { status: 400 });
    }
    novosConferidos.push(conferido.anexo);
  }

  // Os mencionados conferidos contra a conta (sob RLS), como no POST. Sem a
  // conferência — a leitura falhou, ou a caixa não soube quem é da conta
  // (`mencionados` ausente) —, a lista gravada fica a que a nota já tinha:
  // trocá-la por nenhuma faria quem já estava mencionado "entrar" de novo na
  // próxima edição, e ser avisado outra vez.
  const antigos = Array.isArray(nota.mencionados) ? (nota.mencionados as string[]) : [];
  let mencionadosAgora = antigos;
  // Quem está SUSPENSO (1067) entre os conferidos: fica gravado, não é avisado.
  const suspensos = new Set<string>();
  let mencoesOk = true;
  if (pedidosDeMencao?.length === 0) {
    mencionadosAgora = [];
  } else if (pedidosDeMencao) {
    const { data: membros, error: erroMembros } = await supabase
      .from('profiles')
      .select('user_id, suspenso_em')
      .eq('account_id', accountId)
      .in('user_id', pedidosDeMencao);
    if (erroMembros) {
      console.error('[PUT /api/cb/notes] falha ao validar menções:', erroMembros.message);
      // `false` só quando havia a quem avisar (alguém ENTRARIA na menção) —
      // corrigir uma letra de "@Bia confere", com a Bia já gravada, não falhou
      // em avisar ninguém.
      mencoesOk = !pedidosDeMencao.some((u) => u !== user.id && !antigos.includes(u));
    } else {
      mencionadosAgora = (membros ?? [])
        .map((m) => m.user_id as string)
        .filter((u) => u !== user.id);
      for (const m of membros ?? []) {
        if (m.suspenso_em) suspensos.add(m.user_id as string);
      }
    }
  }

  const anexosAgora = [...ficam.anexos, ...novosConferidos];
  const escrita = admin
    .from('cb_conversation_notes')
    .update({
      texto: textoLimpo,
      anexos: anexosAgora,
      mencionados: mencionadosAgora,
      editada_em: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('account_id', accountId)
    .eq('author_user_id', user.id);
  const { data: atualizada, error: erroEscrita } = await (versao === null
    ? escrita.is('editada_em', null)
    : escrita.eq('editada_em', versao)
  )
    .select('*')
    .maybeSingle();
  if (erroEscrita) {
    console.error('[PUT /api/cb/notes] update:', erroEscrita.message);
    return NextResponse.json({ error: 'Failed to save note' }, { status: 500 });
  }
  // Zero linhas: apagada ou editada entre a leitura e o UPDATE.
  if (!atualizada) return porQueNaoVeio(supabase, id, accountId);

  // O aviso a quem ENTROU na menção — depois da edição e sem derrubá-la. O
  // suspenso não lê anotação: não é avisado (e, gravado, não "entra" de novo).
  const entraram = mencionadosAgora.filter((u) => !antigos.includes(u) && !suspensos.has(u));
  if (entraram.length > 0) {
    const autorNome = profile?.full_name?.trim() || profile?.email || null;
    const { error: erroSino } = await admin.from('notifications').insert(
      entraram.map((destinatario) => ({
        account_id: accountId,
        user_id: destinatario,
        type: 'note_mention',
        conversation_id: nota.conversation_id,
        contact_id: nota.contact_id ?? null,
        actor_user_id: user.id,
        // Cru, como no POST (as colunas são TEXT, no idioma de quem escreveu).
        title: `${autorNome ?? 'Alguém da equipe'} mencionou você numa anotação`,
        body: corpoDoAviso(textoLimpo, anexosAgora),
      }))
    );
    if (erroSino) {
      console.error('[PUT /api/cb/notes] falha ao notificar menção:', erroSino.message);
      mencoesOk = false;
    }
  }

  return NextResponse.json({ note: atualizada, mudou: true, mencoesNotificadas: mencoesOk });
}
