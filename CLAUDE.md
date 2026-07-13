@AGENTS.md

# CB CRM — Contexto do projeto e fluxo de trabalho

## O que é este projeto

Este repositório é um **fork** do CRM open source **wacrm**
(`ArnasDon/wacrm`), um CRM de WhatsApp (Next.js 16 + Supabase + Meta
Cloud API) com inbox compartilhado, contatos, pipelines, broadcasts,
automações e assistente de IA.

Estamos moldando este fork para uso interno do **CB Advogados**: um
sistema de **gestão de WhatsApp** com **integrações próprias**,
adaptado às necessidades do escritório. Ou seja: partimos do código
open source e construímos nossas customizações por cima, continuando a
receber melhorias e correções de bugs do projeto original.

## Estrutura de remotes (fork + upstream)

| Remote      | Aponta para                  | Papel                                                     |
| ----------- | ---------------------------- | --------------------------------------------------------- |
| `origin`    | `leonardocabralb/CB-CRM`     | Nosso fork — para onde fazemos **push**                   |
| `upstream`  | `ArnasDon/wacrm`             | Original open source — de onde só **puxamos** (read-only) |

Nunca fazer push no `upstream`.

## Estrutura de branches

| Branch          | Função                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `main`          | **Espelho limpo do original.** NÃO customizar aqui. Serve só para receber e refletir o `upstream/main`. |
| `cb-advogados`  | **Branch de trabalho.** Todas as customizações do CB Advogados vivem aqui (este arquivo inclusive).     |

> **Regra de ouro:** o `main` deve permanecer idêntico ao
> `upstream/main`. Todo código nosso vai para `cb-advogados` (ou
> branches derivadas dela). Isso mantém as atualizações do upstream
> sem conflito.

## Como puxar atualizações do original (upstream)

Quando o projeto original tiver melhorias/correções, o fluxo é:

```bash
# 1. Buscar novidades do original (não altera nada ainda)
git fetch upstream

# 2. Atualizar o main como espelho limpo
git checkout main
git merge upstream/main        # fast-forward, sem conflito
git push origin main           # backup no nosso fork

# 3. Trazer as atualizações para a branch de trabalho
git checkout cb-advogados
git merge main                 # aqui podem surgir conflitos (resolver)
git push origin cb-advogados
```

Conflitos só acontecem quando o original e nós editamos **a mesma
linha do mesmo arquivo**. Para minimizar conflitos: manter as
customizações **isoladas** (arquivos/módulos novos) sempre que
possível, em vez de reescrever arquivos do core.

## Diretrizes de customização

- Trabalhar sempre em `cb-advogados` (ou branch derivada), nunca no `main`.
- Preferir criar **novos** componentes/módulos/rotas a reescrever os do
  core, para reduzir conflitos futuros com o upstream.
- Documentar integrações próprias do CB Advogados conforme forem criadas.
- `.env.local` guarda segredos (Supabase, Meta, ENCRYPTION_KEY) e é
  ignorado pelo git — nunca commitar.

## Stack e comandos úteis

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Postgres + Auth + Storage + RLS) · Meta Cloud API.

```bash
npm run dev          # servidor de desenvolvimento (localhost:3000)
npm run build        # build de produção
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run format       # prettier --write
```

Migrations do Supabase ficam em `supabase/migrations/` (aplicar em
ordem `001` → `NNN`).
