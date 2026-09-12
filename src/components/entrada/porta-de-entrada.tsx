'use client';

// ============================================================
// A porta de entrada: o Meu dia NO LUGAR do app, até o "Continuar".
//
// Não é um Dialog por cima do app, de propósito. O app montado por trás
// teria efeitos antes da confirmação: um link `/inbox?c=X` abriria o fio e
// zeraria as não lidas daquela conversa para a conta inteira, e o heartbeat
// publicaria presença. Aqui o layout inteiro (menu, cabeçalho, página,
// heartbeat) só monta depois do clique.
//
// ⚠️ TRAVA DE MÃO ÚNICA. A decisão "mostra?" é tomada UMA vez por carga de
// página, no inicializador do estado, e só FECHA — nunca reabre por evento
// de auth (o `SIGNED_IN` dispara a cada volta à aba), por remontagem (o
// spinner do "Ver como" e a troca de usuário remontam o que está abaixo do
// shell) nem pela virada do dia com a aba aberta. Abrir no meio do uso
// desmontaria o compositor: o rascunho se perde, o anexo preparado é
// apagado do bucket e a mensagem na janela de desfazer é ENVIADA.
// Remontagem é coberta pelo `Set` de módulo "liberados nesta carga".
//
// ⚠️ A confirmação vive no `localStorage`, por pessoa (a régua está em
// `src/lib/resumo-do-dia/pendencia.ts`): sessão nova OU primeiro acesso do
// dia. Outra aba que confirma libera esta pelo evento `storage` — só quando
// a confirmação é da MESMA sessão e do MESMO dia que esta aba capturou.
//
// ⚠️ Conta que não resolveu (`accountStatus !== 'ready'`) PULA a tela: as
// consultas falhariam ou mentiriam, e o `AccountAccessAlert` do shell é quem
// narra esse problema.
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/hooks/use-auth';
import { sairDesteAparelho } from '@/lib/auth/sair';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import {
  chaveDoRegistro,
  decidirEntrada,
  inicioDasNovidades,
  lerRegistro,
  novoRegistro,
  precisaMostrar,
  type RegistroDeEntrada,
} from '@/lib/resumo-do-dia/pendencia';
import { createClient } from '@/lib/supabase/client';
import { diaLocal } from '@/lib/tasks/prazo';

import { LimiteDeErro } from './limite-de-erro';
import { ResumoDoDia } from './resumo-do-dia';

/** Quem já passou pela porta NESTA carga de página — remontar não reabre. */
const liberadosNestaCarga = new Set<string>();

function lerDoNavegador(userId: string): RegistroDeEntrada | null {
  // O shell só instancia a porta depois do spinner de auth, que no servidor
  // é o que se renderiza — mas a guarda custa uma linha e sobrevive a quem
  // mover o componente (o molde de `use-theme.tsx`).
  if (typeof window === 'undefined') return null;
  try {
    return lerRegistro(window.localStorage.getItem(chaveDoRegistro(userId)));
  } catch {
    // Storage indisponível (modo privado restrito): sem registro, a tela
    // aparece — e a confirmação fica só em memória, nesta carga.
    return null;
  }
}

function gravarNoNavegador(userId: string, registro: RegistroDeEntrada): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      chaveDoRegistro(userId),
      JSON.stringify(registro)
    );
  } catch {
    // Idem: a confirmação em memória (o Set) já liberou esta carga.
  }
}

interface Decisao {
  pendente: boolean;
  /** O dia e a sessão que esta aba capturou ao decidir. */
  dia: string;
  sessao: string | null;
  /** O instante da decisão — a régua do relógio da tela (saudação, data). */
  agoraMs: number;
  desdeMs: number;
  /** A âncora das novidades é a confirmação anterior (senão, 24 h). */
  daConfirmacao: boolean;
}

export function PortaDeEntrada({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const { sessionId, accountStatus, accountId, profile, perfilDeAcesso } =
    useAuth();

  const [decisao, setDecisao] = useState<Decisao>(() => {
    const agora = new Date();
    const dia = diaLocal(agora);
    const registro = lerDoNavegador(userId);
    const pendente = decidirEntrada({
      registro,
      sessionId,
      hoje: dia,
      accountStatus,
      jaLiberadoNestaCarga: liberadosNestaCarga.has(userId),
    });
    const inicio = inicioDasNovidades(registro, agora.getTime());
    return {
      pendente,
      dia,
      sessao: sessionId,
      agoraMs: agora.getTime(),
      desdeMs: inicio.desdeMs,
      daConfirmacao: inicio.daConfirmacao,
    };
  });

  // Liberada (agora ou desde o início) = nesta carga não volta a abrir.
  useEffect(() => {
    if (!decisao.pendente) liberadosNestaCarga.add(userId);
  }, [decisao.pendente, userId]);

  // Outra aba confirmou: destrava esta, se a confirmação vale para ela.
  useEffect(() => {
    if (!decisao.pendente) return;
    const chave = chaveDoRegistro(userId);
    const aoMudar = (e: StorageEvent) => {
      if (e.key !== chave) return;
      if (
        !precisaMostrar(lerRegistro(e.newValue), decisao.sessao, decisao.dia)
      ) {
        setDecisao((d) => ({ ...d, pendente: false }));
      }
    };
    window.addEventListener('storage', aoMudar);
    return () => window.removeEventListener('storage', aoMudar);
  }, [decisao.pendente, decisao.sessao, decisao.dia, userId]);

  const confirmar = useCallback(() => {
    // O dia e a sessão de AGORA, não os capturados: quem deixa a tela aberta
    // até depois da meia-noite confirma o dia em que clicou.
    gravarNoNavegador(
      userId,
      novoRegistro(sessionId, diaLocal(new Date()), new Date())
    );
    liberadosNestaCarga.add(userId);
    setDecisao((d) => ({ ...d, pendente: false }));
  }, [userId, sessionId]);

  const sair = useCallback(async (): Promise<string | null> => {
    const resultado = await sairDesteAparelho(createClient().auth);
    if (!resultado.ok) return resultado.erro;
    // Só com sucesso: com a sessão ainda no cookie, `/login` devolveria
    // para `/dashboard` e formaria um laço.
    window.location.href = '/login';
    return null;
  }, []);

  // O contexto REAL, nunca a lente do "Ver como": `acesso` do useAuth é o
  // efetivo. Memoizado porque entra nas dependências do efeito de carga.
  const papel = profile?.account_role ?? null;
  const ctx = useMemo<ContextoDeAcesso>(
    () => ({ papel, perfil: perfilDeAcesso }),
    [papel, perfilDeAcesso]
  );

  if (!decisao.pendente || !accountId) return <>{children}</>;

  return (
    <LimiteDeErro fallback={children}>
      <ResumoDoDia
        userId={userId}
        accountId={accountId}
        ctx={ctx}
        primeiroNome={profile?.full_name?.trim().split(/\s+/)[0] || null}
        agoraMs={decisao.agoraMs}
        desdeMs={decisao.desdeMs}
        temConfirmacaoAnterior={decisao.daConfirmacao}
        onContinuar={confirmar}
        onSair={sair}
      />
    </LimiteDeErro>
  );
}
