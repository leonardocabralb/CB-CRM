import type { Metadata } from 'next';

import { NOME_DO_APP } from '@/lib/marca';

// ============================================================
// Política de privacidade — página PÚBLICA, servida em /privacidade.
//
// Existe porque a Meta exige uma URL de política de privacidade para
// publicar (modo Live) qualquer app que receba webhooks — e o do
// Instagram Direct é o primeiro nosso (docs/ESTUDO-instagram-direct.md,
// §7). Sem Live, a Meta só entrega DM de quem tem papel no app.
//
// ⚠️ O texto NÃO cita o nome do escritório nem e-mail de ninguém: este
// arquivo VIAJA para quem instalar o sistema (produto-gate.test.ts
// reprova nome, domínio e conta nossos em `src/`). Quem opera a
// instalação é chamado de "Operador", e o nome do produto sai de
// `NOME_DO_APP`, como no resto do app. A identificação do Operador é o
// DOMÍNIO em que a página é servida — que é de quem instalou.
//
// Fica fora dos route groups: `(auth)` tem layout de login e
// `(dashboard)` exige sessão. O middleware só protege os `protectedPaths`,
// e `/privacidade` não está entre eles — a página abre sem login, que é o
// que a Meta (e qualquer visitante) precisa.
//
// Texto fixo em português, de propósito: é documento jurídico do
// Operador, não interface — não passa pelo dicionário i18n.
// ============================================================

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description: `Como ${NOME_DO_APP} trata os dados das conversas que recebe.`,
};

const ATUALIZADA_EM = '9 de setembro de 2026';

export default function PaginaDePrivacidade() {
  return (
    <main className="text-foreground mx-auto max-w-3xl px-6 py-12 text-base leading-relaxed">
      <header className="mb-10">
        <p className="text-muted-foreground text-sm">{NOME_DO_APP}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Política de Privacidade
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Última atualização: {ATUALIZADA_EM}
        </p>
      </header>

      <Secao titulo="1. O que é este sistema e quem responde por ele">
        <p>
          {NOME_DO_APP} é um sistema de gestão de atendimento: ele recebe,
          organiza e permite responder mensagens que clientes e interessados
          enviam a uma organização por canais como WhatsApp e Instagram Direct.
          Cada instalação é operada por uma organização (o{' '}
          <strong>Operador</strong>), responsável pelo tratamento dos dados aqui
          descritos. O Operador desta instalação é o titular do domínio em que
          esta página é servida.
        </p>
      </Secao>

      <Secao titulo="2. Quais dados são tratados">
        <p>Ao enviar uma mensagem à conta do Operador, podem ser tratados:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            <strong>Identificação do remetente</strong>: o identificador da
            conta na plataforma de origem (por exemplo, o ID de usuário do
            Instagram ou o número de telefone no WhatsApp), o nome de exibição
            e, quando disponível, a foto de perfil.
          </li>
          <li>
            <strong>Conteúdo das mensagens</strong>: texto, imagens, áudios,
            vídeos, documentos e reações enviados na conversa, com data e hora.
          </li>
          <li>
            <strong>Dados de atendimento</strong>: anotações internas,
            etiquetas, etapa de atendimento e outros registros feitos pela
            equipe do Operador para organizar o contato.
          </li>
        </ul>
        <p className="mt-2">
          O sistema não coleta dados de navegação de quem envia mensagens, não
          usa cookies de rastreamento e não acessa contatos, publicações ou
          seguidores das contas que escrevem ao Operador.
        </p>
      </Secao>

      <Secao titulo="3. Para que os dados são usados">
        <ul className="list-disc space-y-1 pl-6">
          <li>Receber e responder às mensagens — a finalidade principal.</li>
          <li>
            Organizar o histórico de atendimento de cada pessoa em um só lugar.
          </li>
          <li>
            Cumprir obrigações legais e regulatórias a que o Operador esteja
            sujeito.
          </li>
        </ul>
        <p className="mt-2">
          As bases legais são a execução de contrato ou de procedimentos
          preliminares a pedido do titular, o legítimo interesse do Operador em
          atender quem o procura e, quando aplicável, o consentimento (Lei nº
          13.709/2018 — LGPD).
        </p>
      </Secao>

      <Secao titulo="4. Com quem os dados são compartilhados">
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Meta Platforms</strong> (WhatsApp e Instagram): é a
            plataforma por onde as mensagens trafegam. O uso dessas plataformas
            é regido também pelas políticas da própria Meta.
          </li>
          <li>
            <strong>Provedores de infraestrutura</strong> contratados pelo
            Operador para hospedar o sistema, o banco de dados e os arquivos,
            sob obrigação contratual de confidencialidade.
          </li>
          <li>
            <strong>Serviços de inteligência artificial</strong>, apenas quando
            o Operador ativa recursos como transcrição de áudio ou análise de
            atendimento — e somente para essas finalidades.
          </li>
        </ul>
        <p className="mt-2">
          Os dados não são vendidos nem cedidos para publicidade de terceiros.
        </p>
      </Secao>

      <Secao titulo="5. Por quanto tempo os dados ficam guardados">
        <p>
          Pelo tempo necessário ao atendimento e ao cumprimento de obrigações
          legais do Operador — em especial os prazos de guarda aplicáveis à sua
          atividade. Encerrada a necessidade, os dados são excluídos ou
          anonimizados.
        </p>
      </Secao>

      <Secao titulo="6. Seus direitos">
        <p>
          Nos termos da LGPD, você pode solicitar ao Operador: confirmação de
          que seus dados são tratados, acesso, correção, anonimização, bloqueio
          ou eliminação, portabilidade, informação sobre compartilhamentos e
          revogação do consentimento.
        </p>
      </Secao>

      <Secao titulo="7. Como pedir a exclusão dos seus dados" id="exclusao">
        <p>
          Envie o pedido ao Operador pelo mesmo canal em que conversou (WhatsApp
          ou Instagram) ou pelos canais de contato publicados no site do
          Operador, informando a conta ou o número usado na conversa. O pedido é
          atendido no prazo legal, ressalvados os registros que o Operador tenha
          obrigação de manter.
        </p>
        <p className="mt-2">
          Você também pode, a qualquer momento, retirar o acesso do sistema à
          sua conta do Instagram em <em>Configurações → Apps e sites</em> do
          próprio Instagram.
        </p>
      </Secao>

      <Secao titulo="8. Segurança">
        <p>
          As credenciais de integração são guardadas cifradas, o acesso ao
          sistema exige autenticação e cada membro da equipe do Operador só
          enxerga o que o seu perfil permite. O tráfego entre as plataformas e o
          sistema é protegido por HTTPS, e as mensagens recebidas têm sua origem
          verificada por assinatura.
        </p>
      </Secao>

      <Secao titulo="9. Alterações desta política">
        <p>
          Esta página pode ser atualizada. A data no topo indica a versão
          vigente; mudanças relevantes serão comunicadas pelos canais do
          Operador.
        </p>
      </Secao>

      <Secao titulo="10. Contato">
        <p>
          Dúvidas e pedidos sobre privacidade devem ser dirigidos ao Operador
          pelos canais de contato publicados no site dele — o mesmo domínio em
          que esta página é servida.
        </p>
      </Secao>
    </main>
  );
}

function Secao({
  titulo,
  id,
  children,
}: {
  titulo: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-8">
      <h2 className="mb-2 text-xl font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}
