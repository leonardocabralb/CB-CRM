// ============================================================
// PATCH  /api/cb/perfis/[id] — editar um perfil.
// DELETE /api/cb/perfis/[id] — apagar um perfil SEM membros.
//
// As travas que não cabem em RLS moram aqui:
//   - perfil `sistema` não se edita nem se apaga;
//   - mudar `papel_base` passa pela RPC da 959, que sincroniza o
//     `account_role` de todos os membros NA MESMA transação;
//   - o editor não rebaixa o próprio perfil para fora de admin
//     (anti-auto-bloqueio — perderia a tela que desfaz o erro);
//   - apagar exige perfil SEM membros. Não é o SET NULL que protege — ele
//     funciona — é a SEMÂNTICA: `perfil_id` nulo significa acesso TOTAL,
//     então apagar um perfil em uso "para revogar" faria o oposto do
//     esperado. A recusa com contagem obriga a remanejar antes.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { rebaixariaOEditor, validarCorpoDePerfil } from "@/lib/perfis/validar";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/** Carrega o perfil JÁ ESCOPADO na conta — service-role ignora RLS. */
async function carregarPerfil(id: string, accountId: string) {
  return supabaseAdmin()
    .from("cb_perfis_de_acesso")
    .select("id, papel_base, sistema")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(
      `admin:perfis:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const atual = await carregarPerfil(id, ctx.accountId);
    // ⚠️ Erro de banco NÃO é "não encontrado" (regra das rotas v1): timeout
    // virando 404 faria o operador recriar o perfil, duplicando.
    if (atual.error) {
      console.error("[PATCH /api/cb/perfis] load error:", atual.error);
      return NextResponse.json(
        { error: "Falha ao carregar o perfil" },
        { status: 500 },
      );
    }
    if (!atual.data) {
      return NextResponse.json(
        { error: "Perfil não encontrado" },
        { status: 404 },
      );
    }
    if (atual.data.sistema) {
      return NextResponse.json(
        { error: "Perfil de sistema não pode ser editado" },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => null);
    const v = validarCorpoDePerfil(body);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });

    const mudouPapel = v.perfil.papel_base !== atual.data.papel_base;

    if (mudouPapel) {
      // Anti-auto-bloqueio: quem edita o PRÓPRIO perfil não o tira de admin.
      const eu = await supabaseAdmin()
        .from("profiles")
        .select("perfil_id, account_role")
        .eq("user_id", ctx.userId)
        .maybeSingle();
      if (
        rebaixariaOEditor({
          papelDoEditor: eu.data?.account_role ?? null,
          perfilDoEditor: eu.data?.perfil_id ?? null,
          perfilAlvo: id,
          novoPapel: v.perfil.papel_base,
        })
      ) {
        return NextResponse.json(
          {
            error:
              "Este é o seu próprio perfil — tirá-lo de administrador trancaria você para fora da tela que desfaz isso",
          },
          { status: 409 },
        );
      }
    }

    // Campos que não são papel: update direto (uma linha, atômico).
    const { error: upErr } = await supabaseAdmin()
      .from("cb_perfis_de_acesso")
      .update({
        nome: v.perfil.nome,
        telas: v.perfil.telas,
        secoes_config: v.perfil.secoes_config,
        channel_ids: v.perfil.channel_ids,
        pipeline_ids: v.perfil.pipeline_ids,
      })
      .eq("id", id)
      .eq("account_id", ctx.accountId);
    if (upErr) {
      if (upErr.code === "23505") {
        return NextResponse.json(
          { error: "Já existe um perfil com este nome" },
          { status: 409 },
        );
      }
      console.error("[PATCH /api/cb/perfis] update error:", upErr);
      return NextResponse.json(
        { error: "Não foi possível salvar o perfil" },
        { status: 500 },
      );
    }

    // Papel muda por último, pela RPC — perfil + membros numa transação só
    // (959). supabase-js não abre transação entre chamadas.
    let membrosAtualizados = 0;
    if (mudouPapel) {
      const { data: rpc, error: rpcErr } = await supabaseAdmin().rpc(
        "cb_mudar_papel_do_perfil",
        { p_perfil: id, p_papel: v.perfil.papel_base },
      );
      if (rpcErr) {
        console.error("[PATCH /api/cb/perfis] rpc error:", rpcErr);
        return NextResponse.json(
          { error: "O perfil foi salvo, mas a troca de papel falhou — tente de novo" },
          { status: 500 },
        );
      }
      membrosAtualizados =
        (rpc as { membros_atualizados?: number })?.membros_atualizados ?? 0;
    }

    return NextResponse.json({ ok: true, membrosAtualizados });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(
      `admin:perfis:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const atual = await carregarPerfil(id, ctx.accountId);
    if (atual.error) {
      console.error("[DELETE /api/cb/perfis] load error:", atual.error);
      return NextResponse.json(
        { error: "Falha ao carregar o perfil" },
        { status: 500 },
      );
    }
    if (!atual.data) {
      return NextResponse.json(
        { error: "Perfil não encontrado" },
        { status: 404 },
      );
    }
    if (atual.data.sistema) {
      return NextResponse.json(
        { error: "Perfil de sistema não pode ser apagado" },
        { status: 409 },
      );
    }

    // ⚠️ Perfil em uso não se apaga. O SET NULL da 957 funcionaria — e é
    // esse o problema: nulo = SEM RESTRIÇÃO, então apagar "para revogar"
    // devolveria acesso TOTAL à equipe inteira do perfil, em silêncio.
    const emUso = await supabaseAdmin()
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("perfil_id", id)
      .eq("account_id", ctx.accountId);
    if (emUso.error) {
      console.error("[DELETE /api/cb/perfis] count error:", emUso.error);
      return NextResponse.json(
        { error: "Falha ao conferir o uso do perfil" },
        { status: 500 },
      );
    }
    if ((emUso.count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Este perfil está atribuído a ${emUso.count} membro(s) — mova as pessoas para outro perfil antes de apagar`,
          membros: emUso.count,
        },
        { status: 409 },
      );
    }

    const { error } = await supabaseAdmin()
      .from("cb_perfis_de_acesso")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);
    if (error) {
      console.error("[DELETE /api/cb/perfis] delete error:", error);
      return NextResponse.json(
        { error: "Não foi possível apagar o perfil" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
