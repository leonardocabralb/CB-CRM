import { createServerClient } from '@supabase/ssr'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // A sessão é conferida AQUI, pela assinatura do token (getClaims: chaves
  // públicas do projeto em cache por 10 min), sem perguntar ao serviço de
  // login a cada pedido: o getUser() custava um GET /auth/v1/user por
  // navegação, cada um com uma vaga no banco, e no teto de conexões o 500
  // dele mandava ao login quem estava logado. As ROTAS continuam no
  // getUser() (`getCurrentAccount`). Troca aceita: "Sair de todos os
  // aparelhos" e o login apagado tiram a pessoa da TELA no vencimento do
  // token (até 1 h), não na próxima navegação; o banco já aceitava esse
  // token até vencer.
  //
  // `loginForaDoAr`: o login não respondeu (5xx/rede, `AuthRetryableFetchError`)
  // ao renovar o token ou ao buscar as chaves (o cache delas vence a cada
  // 10 min). Não é "saiu": a tela abre; a API segue até a rota, que confere o
  // login por conta própria (`requireRole`/`getUser`; pino no
  // `middleware.test.ts`). Sem isso, as chaves fora do ar por um instante
  // dariam 401 a todo envio, mesmo com o login respondendo.
  //
  // `conferenciaLancou`: erro que não é da biblioteca (a WebCrypto recusando a
  // chave, um cookie corrompido). Só a TELA abre — ela lê sob a RLS, que
  // confere o token a cada leitura. A API recusa: um cookie FORJADO, com
  // qualquer texto no lugar do token, faz a biblioteca lançar, e tratá-lo como
  // incerto tiraria o 401 do middleware de qualquer visitante.
  let logado = false
  let loginForaDoAr = false
  let conferenciaLancou = false
  try {
    const { data, error } = await supabase.auth.getClaims()
    logado = Boolean(data?.claims?.sub)
    if (!logado && error && isAuthRetryableFetchError(error)) {
      loginForaDoAr = true
      console.warn('[middleware] o login não respondeu; sessão incerta neste pedido:', error.status)
    }
  } catch (err) {
    console.error('[middleware] a conferência da sessão lançou:', err)
    conferenciaLancou = true
  }
  const telaIncerta = loginForaDoAr || conferenciaLancou

  // getClaims() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (logado && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  // Toda pasta de `src/app/(dashboard)/` entra aqui: o `middleware.test.ts`
  // (do original, #607) lê a pasta e reprova a que faltar.
  //
  // ⚠️ `/agenda` cobre `/agendadas` DE GRAÇA, porque o teste é `startsWith` —
  // e é por isso mesmo que a página pública de auto-agendamento da Fase 2 vai
  // se chamar `/marcar/<token>`, nunca `/agendar/<token>`: esta linha mandaria
  // o cliente, que não tem login, para a tela de login.
  const protectedPaths = ['/dashboard', '/meu-dia', '/radar', '/inbox', '/contacts', '/agenda', '/reunioes', '/pipelines', '/broadcasts', '/automations', '/flows', '/agents', '/notifications', '/tarefas', '/settings']
  if (!logado && !telaIncerta && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks)
  if (!logado && !loginForaDoAr && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
