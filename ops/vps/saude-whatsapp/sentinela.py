#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sentinela do WhatsApp — roda NA VPS, de hora em hora (cron), e avisa no sino
do CRM. Instalação, arquivos e como desligar: docs/INFRA-VPS.md, seção 12.

Cada execução:
1. COLETA: lê o log da Evolution, o do CRM e o do agendador desde a execução
   anterior e guarda só CONTAGENS de assinaturas MASCARADAS em
   coleta/AAAA-MM-DD.jsonl. O log da Evolution cobre ~2 dias e o do CRM some a
   cada deploy: a varredura semanal lê estes arquivos.
2. CHECAGENS, só leitura (banco da Evolution, Docker, Redis e a fronteira de
   entrega do CRM): conexão fora de 'open'; conexão aberta sem receber;
   mensagem que a Evolution recebeu e o CRM não gravou; mensagem descartada
   antes do banco da Evolution (o caso da sessão '.99'); falha real de
   entrega; sessão legada '.99'; serviço sem réplica; disco; memória.
3. AVISO: problema NOVO vira notificação 'whatsapp_alert' (1085) para quem é
   owner/admin da conta, gravada pelo PostgREST com a service role do
   /root/crm.env. Um aviso por problema, lembrete a cada 24 h enquanto durar
   e "Normalizou" quando passa.

Escreve SÓ em /root/saude-whatsapp e na tabela notifications. Nunca imprime
segredo, telefone nem conteúdo de mensagem.

Modos:
  (sem argumento)  o do cron: coleta, checa, avisa e grava o estado.
  --simular        checa e mostra o que avisaria; não grava NADA (nem estado,
                   nem coleta, nem aviso). Serve para conferir por ssh:
                   ssh root@<vps> 'python3 - --simular' < sentinela.py
  --teste-aviso    manda UM aviso de teste aos administradores.

Python 3.8 (Ubuntu 20.04), só biblioteca padrão.
"""
import collections
import datetime
import fcntl
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

PASTA = '/root/saude-whatsapp'
ARQ_ESTADO = os.path.join(PASTA, 'estado.json')
PASTA_COLETA = os.path.join(PASTA, 'coleta')
ARQ_TRAVA = os.path.join(PASTA, '.trava')
ARQ_LOG = os.path.join(PASTA, 'sentinela.log')
CRM_ENV = '/root/crm.env'

# O Brasil não tem horário de verão desde 2019: UTC-3 fixo.
BRT = datetime.timezone(datetime.timedelta(hours=-3))
UTC = datetime.timezone.utc

TIPO_DO_AVISO = 'whatsapp_alert'
LEMBRETE_H = 24
INTERVALO_DE_EVENTO_H = 6
DIAS_DE_COLETA = 90
COLETA_MAXIMA_H = 26
RECHECAGEM_S = 60

# "Aberta sem receber": em dia útil, com a janela de 2 h inteira entre 8h e
# 20h, nenhuma mensagem de cliente e pelo menos 5 nossas saindo pela conexão.
# Calibrada em 13/10/2026 contra 5 semanas de histórico: disparou 3 vezes, 2
# delas no incidente real de 16/09 (a fila de entrada presa). Sem exigir
# saídas, a regra dispararia em todo dia parado e em todo feriado.
JANELA_SEM_ENTRADA_H = 2
SAIDAS_MINIMAS = 5
# "A Evolution recebeu e o CRM não gravou": mensagens de cliente mais novas
# que a fronteira de entrega do CRM (`cb_channels.entrega_carimbo_em`, 1002)
# + 90 s — a gravação dela é espaçada de 60 s —, com mais de 10 min de idade.
NAO_GRAVADAS_MINIMAS = 3
FOLGA_DA_FRONTEIRA_S = 90
IDADE_MINIMA_S = 600
FALHAS_MINIMAS = 3
DISCO_MAXIMO = 85
MEMORIA_MINIMA_MB = 300
HORA_DA_VARREDURA_99 = 10

# Tipos que a Evolution grava em "Message" e o CRM descarta de propósito
# (reação, controle, abertura de álbum, cópia auxiliar, a EDIÇÃO cifrada que
# só carimba `edited_at`): não são mensagem "perdida" quando faltam no CRM.
TIPOS_SEM_CONTEUDO = (
    'reactionMessage', 'encReactionMessage', 'protocolMessage', 'albumMessage',
    'secretEncryptedMessage',
    'associatedChildMessage', 'pollUpdateMessage', 'senderKeyDistributionMessage',
    'messageContextInfo', 'keepInChatMessage', 'pinInChatMessage', 'editedMessage',
)
# 1:1 de verdade: fora grupo, status, lista de transmissão e canal.
FILTRO_1A1 = (
    "coalesce(m.key->>'remoteJid', '') not like '%@g.us' "
    "and coalesce(m.key->>'remoteJid', '') not like '%@broadcast' "
    "and coalesce(m.key->>'remoteJid', '') not like '%@newsletter'"
)

SEP = '\x1f'
AGORA = datetime.datetime.now(UTC)


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------

def iso(dt):
    return dt.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def de_iso(texto):
    return datetime.datetime.strptime(texto[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=UTC)


def quando(dt, com_dia=True):
    local = dt.astimezone(BRT)
    if com_dia and local.date() != AGORA.astimezone(BRT).date():
        return local.strftime('%d/%m às %H:%M')
    return local.strftime('%H:%M')


def rodar(args, timeout=60, entrada=None):
    # Sem entrada, o filho NÃO herda o stdin: no --simular o programa chega
    # por ele (python3 - < sentinela.py).
    extra = {'input': entrada} if entrada is not None else {'stdin': subprocess.DEVNULL}
    r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       timeout=timeout, **extra)
    if r.returncode != 0:
        erro = r.stderr.decode('utf-8', 'replace').strip().splitlines()
        raise RuntimeError('%s %s saiu com %d: %s' % (
            args[0], args[1], r.returncode, (erro[-1] if erro else '')[:200]))
    return r.stdout.decode('utf-8', 'replace')


def sem_segredo(texto):
    """Corta qualquer bloco longo (chave, token) antes de ir para o log."""
    return re.sub(r'[A-Za-z0-9._\-+/=]{30,}', '<omitido>', str(texto))[:300]


def conteineres(nome, todos=False):
    args = ['docker', 'ps', '-q', '--no-trunc', '-f', 'name=' + nome]
    if todos:
        args.insert(2, '-a')
    return [c for c in rodar(args).split() if c]


def psql(pg, sql):
    saida = rodar(['docker', 'exec', '-i', pg, 'psql', '-U', 'postgres', '-d', 'evolution',
                   '-At', '-F', SEP, '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                  timeout=90, entrada=sql.encode('utf-8'))
    return [linha.split(SEP) for linha in saida.splitlines() if linha]


def literal(texto):
    return "'" + str(texto).replace("'", "''") + "'"


def ler_env(caminho):
    valores = {}
    with open(caminho, encoding='utf-8') as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha or linha.startswith('#') or '=' not in linha:
                continue
            if linha.startswith('export '):
                linha = linha[len('export '):]
            chave, valor = linha.split('=', 1)
            valor = valor.strip()
            if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in '"\'':
                valor = valor[1:-1]
            valores[chave.strip()] = valor
    return valores


class Crm:
    """PostgREST do Supabase com a service role. Nunca imprime a chave."""

    def __init__(self, env):
        self.base = env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/') + '/rest/v1/'
        self.chave = env['SUPABASE_SERVICE_ROLE_KEY']

    def pedir(self, metodo, caminho, corpo=None):
        dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
        req = urllib.request.Request(self.base + caminho, data=dados, method=metodo, headers={
            'apikey': self.chave,
            'Authorization': 'Bearer ' + self.chave,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
            # O Cloudflare do Supabase recusa (1010) o user-agent padrão do urllib.
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) sentinela-whatsapp',
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                texto = r.read().decode('utf-8', 'replace')
                return r.status, (json.loads(texto) if texto else None)
        except urllib.error.HTTPError as e:
            return e.code, sem_segredo(e.read().decode('utf-8', 'replace'))

    def ler(self, caminho):
        status, dados = self.pedir('GET', caminho)
        if status != 200 or not isinstance(dados, list):
            raise RuntimeError('leitura de %s voltou %s: %s' % (caminho.split('?')[0], status, dados))
        return dados


# --------------------------------------------------------------------------
# Coleta dos logs (só contagens mascaradas)
# --------------------------------------------------------------------------

ANSI = re.compile(r'\x1b\[[0-9;]*m')
# Linha com material de sessão (chaves Signal): descartada inteira.
SESSAO = re.compile(r'privKey|noiseKey|advSecretKey|signedIdentityKey|signedPreKey|"private"', re.I)
VALOR = re.compile(r'(apikey|api_key|token|secret|password|senha|authorization|bearer)(["\'\s:=]+)([^\s"\',}]+)', re.I)
CONHECIDAS = ('transaction failed, rolling back', 'error in handling message', 'failed to decrypt message',
              'Connection Closed', 'Stream Errored', 'connection errored', 'restart required', 'logged out',
              'Message ignored with messageStubParameters', 'Original message not found for update',
              'Bad MAC', 'No session', 'No matching sessions', 'PreKeyError', 'SessionError')


TAG = re.compile(r'\s*(\[[^\]\s]{1,40}\])\s*')
EMAIL = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
ERRO_NOMEADO = re.compile(r'\s*((?:[A-Z]\w*)?Error\b.*)')


def assinatura(texto, tamanho=120):
    """O TIPO da linha, nunca o conteúdo (a coleta fica 90 dias em disco).
    Corta no primeiro '{' ou '[' — objeto e lista impressos, por onde vem o
    nó cru da mensagem (o caso do "error in handling message") —, troca todo
    trecho entre aspas por <…>, apaga e-mail e mascara chave, id, blob e
    número. Uma etiqueta de abertura do app (`[radar]`) é mantida."""
    if SESSAO.search(texto):
        return '[linha com chave de sessão omitida]'
    prefixo = ''
    m = TAG.match(texto)
    if m:
        prefixo, texto = m.group(1) + ' ', texto[m.end():]
    texto = VALOR.sub(r'\1\2<omitido>', texto)
    texto = re.split(r'[{\[]', texto, 1)[0]
    texto = re.sub(r'"[^"]*"?|\'[^\']*\'?|`[^`]*`?', '<…>', texto)
    texto = EMAIL.sub('<email>', texto)
    texto = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', texto)
    texto = re.sub(r'[0-9A-Fa-f]{16,}', '<id>', texto)
    texto = re.sub(r'[A-Za-z0-9+/_=-]{24,}', '<blob>', texto)
    texto = re.sub(r'\d{4,}', '#', texto)
    return (prefixo + re.sub(r'\s+', ' ', texto).strip())[:tamanho]


def arquivos_de_log(conteiner):
    caminho = rodar(['docker', 'inspect', '-f', '{{.LogPath}}', conteiner]).strip()
    if not caminho:
        return []

    def ordem(p):
        fim = p.rsplit('.', 1)[1]
        return -int(fim) if fim.isdigit() else 0
    return sorted(glob.glob(caminho + '*'), key=ordem)


def linhas_do_log(arquivos, desde, ate):
    """(instante, texto) do json-file do Docker, em streaming, na janela."""
    for nome in arquivos:
        try:
            fh = open(nome, 'rb')
        except OSError:
            continue
        with fh:
            for bruto in fh:
                try:
                    obj = json.loads(bruto)
                except ValueError:
                    continue
                instante = obj.get('time', '')[:19]
                if instante < desde or instante >= ate:
                    continue
                yield instante, ANSI.sub('', obj.get('log', ''))


def coletar_evolution(evo, desde, ate):
    """As assinaturas do log da Evolution — a mesma leitura da seção 5 do
    vps-saude.sh, com os recibos ERROR por (conexão, tipo, código)."""
    assinaturas = collections.Counter()
    recibos = collections.Counter()
    descartadas = 0
    linhas = 0
    primeiro = ultimo = None
    historico = collections.deque(maxlen=14)
    pendente = None
    sem_texto = None  # (nível, componente) de um ERROR/WARN cujo texto vem na linha seguinte
    for instante, s in linhas_do_log(arquivos_de_log(evo), desde, ate):
        linhas += 1
        primeiro = primeiro or instante
        ultimo = instante
        if 'error in handling message' in s:
            descartadas += 1
        historico.append(s)
        if pendente is not None:
            m = re.search(r'"(\d{3})"', s)
            if m:
                recibos['\t'.join(pendente + (m.group(1),))] += 1
                pendente = None
            elif ']' in s:
                recibos['\t'.join(pendente + ('?',))] += 1
                pendente = None
        if '"status": 0' in s:
            bloco = ''.join(historico)
            inst = re.findall(r'\[Evolution API\]\s*\[([a-z0-9-]+)\]', bloco)
            rj = re.findall(r'"remoteJid": "[0-9]+(:[0-9]+)?@', bloco)
            if inst and rj:
                pendente = (inst[-1], 'aparelho' if rj[-1] else 'principal')
        if sem_texto is not None:
            # Só entra a linha seguinte que for o NOME de um erro ("Error:
            # Connection Closed"); objeto impresso (o nó da mensagem) nunca.
            nivel_anterior, componente_anterior = sem_texto
            sem_texto = None
            erro = ERRO_NOMEADO.match(s)
            if erro:
                assinaturas[nivel_anterior + '\t' + componente_anterior + ': ' + assinatura(erro.group(1))] += 1
                continue
            assinaturas[nivel_anterior + '\t' + componente_anterior + ': (objeto omitido)'] += 1
        nivel = None
        m = re.search(r'\s(ERROR|WARN)\s+\[([^\]]+)\]\s*\[[^\]]*\]\s*(.*)', s)
        if m:
            nivel, componente = m.group(1), assinatura(m.group(2), 60)
            if m.group(3).strip() in ('', '{', '['):
                sem_texto = (nivel, componente)
                continue
            texto = componente + ': ' + assinatura(m.group(3))
        else:
            m = re.match(r'\s*\{"level":(\d+).*"msg":"([^"]*)"', s)
            if m and int(m.group(1)) >= 40:
                nivel = 'baileys-' + ('erro' if int(m.group(1)) >= 50 else 'aviso')
                texto = assinatura(m.group(2))
        if nivel is None:
            for conhecida in CONHECIDAS:
                if conhecida in s:
                    nivel, texto = 'conhecida', conhecida
                    break
        if nivel is None:
            continue
        assinaturas[nivel + '\t' + texto] += 1
    return {'linhas': linhas, 'cobertura': [primeiro, ultimo], 'descartadas': descartadas,
            'assinaturas': dict(assinaturas.most_common(60)), 'recibos': dict(recibos)}


def coletar_app(nome_do_servico, desde, ate):
    """Falhas e avisos do log de um serviço do CRM (crm_crm, crm_agendador) —
    a leitura da seção 6 do vps-saude.sh. Lê também os contêineres parados
    (o de antes do deploy), enquanto o Docker os guardar."""
    contagem = collections.Counter()
    linhas = 0
    for conteiner in conteineres(nome_do_servico, todos=True):
        try:
            arquivos = arquivos_de_log(conteiner)
        except RuntimeError:
            continue
        for _instante, s in linhas_do_log(arquivos, desde, ate):
            linhas += 1
            if not re.search(r'error|failed|falhou|warn|\[evolution/webhook\]|\[send-message\]|ignorad|curl', s, re.I):
                continue
            contagem[assinatura(s, 160)] += 1
    return {'linhas': linhas, 'assinaturas': dict(contagem.most_common(60))}


# --------------------------------------------------------------------------
# Checagens
# --------------------------------------------------------------------------

class Achados:
    def __init__(self):
        self.problemas = {}   # chave -> {titulo, corpo, contas, evento}
        self.normais = set()  # chaves medidas e em ordem (para "Normalizou")
        self.nao_medido = []  # o que falhou ao medir, com o motivo

    def problema(self, chave, titulo, corpo, contas, evento=False):
        self.problemas[chave] = {'titulo': titulo, 'corpo': corpo,
                                 'contas': sorted(contas), 'evento': evento}

    def normal(self, chave):
        self.normais.add(chave)


def situacao_do_servidor():
    """Réplicas e memória: o que se mede sem o banco da Evolution."""
    replicas = {}
    for linha in rodar(['docker', 'service', 'ls', '--format', '{{.Name}} {{.Replicas}}']).splitlines():
        partes = linha.split()
        if len(partes) >= 2 and '/' in partes[1]:
            rodando, esperado = partes[1].split('/', 1)
            replicas[partes[0]] = (rodando, esperado)
    memoria_mb = None
    with open('/proc/meminfo') as fh:
        for linha in fh:
            if linha.startswith('MemAvailable:'):
                memoria_mb = int(linha.split()[1]) // 1024
    return {'replicas': replicas, 'memoria_mb': memoria_mb}


def situacao_das_conexoes(pg):
    """{instância: situação} da tabela "Instance"; None = o banco não respondeu
    (e então nada sobre conexão é afirmado, nem problema nem normal)."""
    if pg is None:
        return None
    try:
        linhas = psql(pg, '''
            select "name", "connectionStatus", coalesce("disconnectionReasonCode"::text, ''),
                   coalesce(to_char("disconnectionAt", 'YYYY-MM-DD"T"HH24:MI:SS'), '')
            from "Instance";''')
    except (RuntimeError, subprocess.TimeoutExpired):
        return None
    return {nome: {'status': status, 'codigo': codigo, 'desde': desde}
            for nome, status, codigo, desde in linhas}


def suspeitas(servidor, conexoes, producao):
    s = set()
    for servico, (rodando, esperado) in servidor['replicas'].items():
        if rodando != esperado:
            s.add('replica:' + servico)
    if servidor['memoria_mb'] is not None and servidor['memoria_mb'] < MEMORIA_MINIMA_MB:
        s.add('memoria')
    if conexoes is not None:
        for canal in producao:
            inst = conexoes.get(canal['instance_name'])
            # Instância que sumiu do servidor (apagada ou renomeada) é conexão
            # inutilizável — nunca motivo para tirar o canal da conta.
            if inst is None or inst['status'] != 'open':
                s.add('conexao:' + canal['instance_name'])
    return s


def checar_servidor_e_conexoes(pg, producao, contas, achados):
    """Réplica, memória, disco e conexão. Roda MESMO com o banco da Evolution
    fora — é justamente quando o Postgres parado precisa de aviso. A suspeita
    só vira problema se continuar depois de RECHECAGEM_S (deploy do CRM,
    reconexão de rotina). Devolve a situação das conexões (None = o banco não
    respondeu)."""
    servidor = situacao_do_servidor()
    conexoes = situacao_das_conexoes(pg)
    primeira = suspeitas(servidor, conexoes, producao)
    if primeira:
        time.sleep(RECHECAGEM_S)
        servidor = situacao_do_servidor()
        conexoes = situacao_das_conexoes(pg)
    persistentes = primeira & suspeitas(servidor, conexoes, producao)

    for servico, (rodando, esperado) in servidor['replicas'].items():
        chave = 'replica:' + servico
        if chave in persistentes:
            achados.problema(chave, 'Serviço parado no servidor: ' + servico,
                             '%s de %s réplicas rodando.' % (rodando, esperado), contas)
        elif rodando == esperado:
            achados.normal(chave)
    if 'memoria' in persistentes:
        achados.problema('memoria', 'Memória do servidor quase no fim',
                         '%d MB livres, e o servidor não tem swap.' % servidor['memoria_mb'], contas)
    elif servidor['memoria_mb'] is not None and servidor['memoria_mb'] >= MEMORIA_MINIMA_MB:
        achados.normal('memoria')

    st = os.statvfs('/')
    usado = (st.f_blocks - st.f_bfree) * st.f_frsize
    livre = st.f_bavail * st.f_frsize
    pct = int(round(100.0 * usado / (usado + livre))) if usado + livre else 0
    if pct > DISCO_MAXIMO:
        achados.problema('disco', 'Disco do servidor em %d%%' % pct,
                         '%d%% usado (o alerta acende acima de %d%%).' % (pct, DISCO_MAXIMO), contas)
    else:
        achados.normal('disco')

    if conexoes is None:
        achados.nao_medido.append('banco da Evolution não respondeu: conexões e mensagens não medidas')
        return None
    for canal in producao:
        chave = 'conexao:' + canal['instance_name']
        inst = conexoes.get(canal['instance_name'])
        if chave in persistentes:
            if inst is None:
                corpo = ('A conexão existe no CRM, mas a instância "%s" não existe no servidor do WhatsApp '
                         '(apagada ou renomeada). Se ela não é mais usada, apague-a em Configurações → Conexões.'
                         % canal['instance_name'])
            else:
                desde = de_iso(inst['desde']) if inst['desde'] else None
                codigo = inst['codigo']
                motivo = (' (código %s%s)' % (codigo, ': deslogada ou suspensa' if codigo == '401' else '')
                          if codigo else '')
                corpo = ('Desconectada desde %s%s.' % (quando(desde), motivo) if desde
                         else 'Situação "%s" no servidor do WhatsApp.' % inst['status'])
                corpo += ' Veja Configurações → Conexões.'
            achados.problema(chave, 'WhatsApp fora do ar: ' + canal['label'], corpo, [canal['account_id']])
        elif inst is not None and inst['status'] == 'open':
            achados.normal(chave)
    return conexoes


def checar_mensagens(pg, producao, conexoes, achados):
    """O que depende do banco da Evolution: tráfego, o que o CRM não gravou e
    falha real de entrega — só nas conexões cuja instância existe."""
    producao = [c for c in producao if c['instance_name'] in conexoes]
    if not producao:
        achados.nao_medido.append('nenhuma conexão de produção casou CRM × Evolution')
        return
    nomes = ', '.join(literal(c['instance_name']) for c in producao)
    por_nome = {c['instance_name']: c for c in producao}

    # 3. Aberta sem receber (só se decide em horário útil; normaliza a qualquer hora).
    trafego = {nome: (int(e), int(s)) for nome, e, s in psql(pg, '''
        select i."name",
               count(*) filter (where not (m.key->>'fromMe')::boolean),
               count(*) filter (where (m.key->>'fromMe')::boolean)
        from "Message" m join "Instance" i on i.id = m."instanceId"
        where i."name" in (%s)
          and m."messageTimestamp" > extract(epoch from now() - interval '%d hours')
          and %s
        group by 1;''' % (nomes, JANELA_SEM_ENTRADA_H, FILTRO_1A1))}
    local = AGORA.astimezone(BRT)
    inicio_da_janela = (AGORA - datetime.timedelta(hours=JANELA_SEM_ENTRADA_H)).astimezone(BRT)
    horario_util = local.isoweekday() <= 5 and inicio_da_janela.hour >= 8 and local.hour < 20 \
        and inicio_da_janela.date() == local.date()
    for nome, canal in por_nome.items():
        entrada, saida = trafego.get(nome, (0, 0))
        chave = 'sem_entrada:' + nome
        if entrada > 0:
            achados.normal(chave)
        elif horario_util and saida >= SAIDAS_MINIMAS and conexoes[nome]['status'] == 'open':
            achados.problema(chave, 'WhatsApp sem receber: ' + canal['label'],
                             'Nenhuma mensagem de cliente nas últimas %d h, e %d saíram por ela. '
                             'A conexão aparece ativa.' % (JANELA_SEM_ENTRADA_H, saida), [canal['account_id']])

    # 4. A Evolution recebeu e o CRM não gravou.
    fronteiras = []
    for nome, canal in por_nome.items():
        carimbo = canal.get('entrega_carimbo_em')
        if carimbo:
            limite = int(de_iso(carimbo).timestamp()) + FOLGA_DA_FRONTEIRA_S
            fronteiras.append('(%s, %d)' % (literal(nome), limite))
    if fronteiras:
        tipos = ', '.join(literal(t) for t in TIPOS_SEM_CONTEUDO)
        faltando = {nome: (int(n), int(primeira_ts)) for nome, n, primeira_ts in psql(pg, '''
            with fronteira(nome, limite) as (values %s)
            select f.nome, count(*), min(m."messageTimestamp")
            from fronteira f
            join "Instance" i on i."name" = f.nome
            join "Message" m on m."instanceId" = i.id
            where not (m.key->>'fromMe')::boolean
              and m."messageTimestamp" > f.limite
              and m."messageTimestamp" < extract(epoch from now()) - %d
              and m."messageTimestamp" > extract(epoch from now() - interval '24 hours')
              and coalesce(m.key->>'remoteJid', '') not like '%%@lid'
              and coalesce(m."messageType", '') not in (%s)
              and %s
            group by 1;''' % (', '.join(fronteiras), IDADE_MINIMA_S, tipos, FILTRO_1A1))}
        for nome, canal in por_nome.items():
            if not canal.get('entrega_carimbo_em'):
                continue
            chave = 'nao_gravadas:' + nome
            n, primeira_ts = faltando.get(nome, (0, 0))
            if n >= NAO_GRAVADAS_MINIMAS:
                desde = datetime.datetime.fromtimestamp(primeira_ts, UTC)
                achados.problema(chave, 'Mensagens não chegam ao CRM: ' + canal['label'],
                                 '%d mensagens de cliente chegaram ao WhatsApp desde %s e não foram '
                                 'gravadas no CRM.' % (n, quando(desde)), [canal['account_id']])
            else:
                achados.normal(chave)

    # 5. Falha real de entrega (ERROR do envio PRINCIPAL, em 1:1, sem entrega).
    falhas = {nome: int(n) for nome, n in psql(pg, '''
        with x as (
          select i."name" as nome, m.id,
                 bool_or(u.status = 'ERROR' and u."remoteJid" like '%%@%%') as principal,
                 bool_or(u.status in ('DELIVERY_ACK', 'READ', 'PLAYED')) as chegou
          from "Message" m
          join "Instance" i on i.id = m."instanceId"
          join "MessageUpdate" u on u."messageId" = m.id
          where i."name" in (%s)
            and (m.key->>'fromMe')::boolean
            and m."messageTimestamp" > extract(epoch from now() - interval '24 hours')
            and m.id in (select "messageId" from "MessageUpdate" where status = 'ERROR')
            and %s
          group by 1, 2)
        select nome, count(*) filter (where principal and not chegou) from x group by 1;''' % (nomes, FILTRO_1A1))}
    for nome, canal in por_nome.items():
        chave = 'falhas:' + nome
        n = falhas.get(nome, 0)
        if n >= FALHAS_MINIMAS:
            achados.problema(chave, 'Mensagens não entregues: ' + canal['label'],
                             '%d mensagens enviadas nas últimas 24 h foram recusadas pelo WhatsApp '
                             '(falha do envio principal, não de aparelho secundário).' % n, [canal['account_id']])
        else:
            achados.normal(chave)


def checar_sessoes_99(rd, contas, achados, simular):
    """Sessão legada '.99' (INFRA-VPS §8): uma vez por dia, ou sempre no --simular."""
    if rd and (simular or AGORA.astimezone(BRT).hour == HORA_DA_VARREDURA_99):
        legadas = 0
        chaves = rodar(['docker', 'exec', rd, 'redis-cli', '-n', '8', '--scan', '--pattern', 'evolution:instance:*']).split()
        for chave_redis in chaves:
            campos = rodar(['docker', 'exec', rd, 'redis-cli', '-n', '8', 'HKEYS', chave_redis], timeout=120)
            legadas += sum(1 for c in campos.splitlines() if re.match(r'^session-[0-9]+\.99$', c))
        if legadas > 0:
            achados.problema('sessao99', 'Sessão antiga que derruba conversas',
                             "%d sessões legadas '.99' no servidor do WhatsApp: a conversa do contato para de chegar." % legadas,
                             contas)
        else:
            achados.normal('sessao99')


# --------------------------------------------------------------------------
# Estado e avisos
# --------------------------------------------------------------------------

def ler_estado():
    try:
        with open(ARQ_ESTADO, encoding='utf-8') as fh:
            estado = json.load(fh)
        if isinstance(estado, dict):
            return estado
    except (OSError, ValueError):
        pass
    return {}


def gravar_json(caminho, dados):
    temporario = caminho + '.tmp'
    with open(temporario, 'w', encoding='utf-8') as fh:
        json.dump(dados, fh, ensure_ascii=False, indent=1, sort_keys=True)
    os.chmod(temporario, 0o600)
    os.replace(temporario, caminho)


def decidir(estado, achados):
    """Os avisos desta execução: (chave, motivo, titulo, corpo, contas)."""
    ativos = estado.get('ativos', {})
    eventos = estado.get('eventos', {})
    avisos = []
    for chave, p in sorted(achados.problemas.items()):
        if p['evento']:
            ultimo = eventos.get(chave)
            if ultimo and AGORA - de_iso(ultimo) < datetime.timedelta(hours=INTERVALO_DE_EVENTO_H):
                continue
            avisos.append((chave, 'evento', p['titulo'], p['corpo'], p['contas']))
            continue
        atual = ativos.get(chave)
        if atual is None:
            avisos.append((chave, 'novo', p['titulo'], p['corpo'], p['contas']))
        elif AGORA - de_iso(atual['avisado_em']) >= datetime.timedelta(hours=LEMBRETE_H):
            avisos.append((chave, 'lembrete', 'Continua — ' + p['titulo'],
                           p['corpo'] + ' Desde %s.' % quando(de_iso(atual['desde'])), p['contas']))
    for chave, atual in sorted(ativos.items()):
        if chave in achados.normais and chave not in achados.problemas:
            avisos.append((chave, 'resolvido', 'Normalizou — ' + atual['titulo'],
                           'Voltou ao normal às %s (o problema começou %s).' % (
                               quando(AGORA, com_dia=False), quando(de_iso(atual['desde']))),
                           atual['contas']))
    return avisos


def aplicar(estado, achados, enviados):
    ativos = estado.setdefault('ativos', {})
    eventos = estado.setdefault('eventos', {})
    for chave, motivo in enviados:
        if motivo == 'evento':
            eventos[chave] = iso(AGORA)
        elif motivo == 'novo':
            p = achados.problemas[chave]
            ativos[chave] = {'desde': iso(AGORA), 'avisado_em': iso(AGORA),
                             'titulo': p['titulo'], 'contas': p['contas']}
        elif motivo == 'lembrete':
            ativos[chave]['avisado_em'] = iso(AGORA)
        elif motivo == 'resolvido':
            ativos.pop(chave, None)


def enviar(crm, admins, avisos):
    """Grava os avisos no sino. Devolve [(chave, motivo)] dos que entraram;
    o que falhar fica para a próxima execução (o estado não muda)."""
    enviados = []
    for chave, motivo, titulo, corpo, contas in avisos:
        linhas = [{'account_id': conta, 'user_id': uid, 'type': TIPO_DO_AVISO,
                   'title': titulo[:200], 'body': corpo[:500]}
                  for conta in contas for uid in admins.get(conta, [])]
        if not linhas:
            print('  sem administrador para avisar: %s' % chave)
            continue
        status, resposta = crm.pedir('POST', 'notifications', linhas)
        if status == 201:
            enviados.append((chave, motivo))
        else:
            print('  aviso %s NÃO gravado: HTTP %s %s' % (chave, status, sem_segredo(resposta)))
    return enviados


def administradores(crm):
    por_conta = collections.defaultdict(list)
    for p in crm.ler('profiles?select=user_id,account_id&account_role=in.(owner,admin)&suspenso_em=is.null'):
        if p.get('user_id') and p.get('account_id'):
            por_conta[p['account_id']].append(p['user_id'])
    return por_conta


# --------------------------------------------------------------------------
# Execução
# --------------------------------------------------------------------------

def arrumar_a_casa():
    limite = AGORA - datetime.timedelta(days=DIAS_DE_COLETA)
    for nome in glob.glob(os.path.join(PASTA_COLETA, '*.jsonl')):
        if datetime.datetime.fromtimestamp(os.path.getmtime(nome), UTC) < limite:
            os.remove(nome)
    try:
        if os.path.getsize(ARQ_LOG) > 2 * 1024 * 1024:
            with open(ARQ_LOG, 'rb') as fh:
                fh.seek(-1024 * 1024, os.SEEK_END)
                resto = fh.read()
            with open(ARQ_LOG, 'wb') as fh:
                fh.write(resto[resto.find(b'\n') + 1:])
    except OSError:
        pass


def main():
    simular = '--simular' in sys.argv
    teste = '--teste-aviso' in sys.argv

    if not simular:
        os.makedirs(PASTA_COLETA, mode=0o700, exist_ok=True)
        os.chmod(PASTA, 0o700)
        trava = open(ARQ_TRAVA, 'w')
        try:
            fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print('%s outra execução em andamento; saindo' % iso(AGORA))
            return 0

    achados = Achados()
    crm = Crm(ler_env(CRM_ENV))
    # Sem o CRM não há a quem avisar, mas a coleta dos logs segue: é ela que
    # não pode ter buraco.
    canais, admins = [], {}
    try:
        canais = crm.ler('cb_channels?select=id,account_id,label,instance_name,entrega_carimbo_em'
                         '&kind=eq.evolution&instance_name=not.is.null')
        admins = administradores(crm)
    except Exception as e:
        achados.nao_medido.append('CRM: ' + sem_segredo(e))
    contas_de_producao = sorted({c['account_id'] for c in canais
                                 if 'teste' not in ((c.get('label') or '') + c['instance_name']).lower()})

    if teste:
        enviados = enviar(crm, admins, [('teste', 'evento', 'Teste da sentinela do WhatsApp',
                                         'Se você está vendo isto, os avisos do servidor chegam ao sino.',
                                         contas_de_producao)])
        print('%s aviso de teste: %s%s' % (iso(AGORA), 'gravado' if enviados else 'FALHOU',
                                           ' (' + ' | '.join(achados.nao_medido) + ')' if achados.nao_medido else ''))
        return 0 if enviados else 1

    pg = (conteineres('postgres_postgres') or [None])[0]
    evo = (conteineres('evolution_evolution') or [None])[0]
    rd = (conteineres('redis_redis') or [None])[0]
    estado = ler_estado()

    # Checagens. Cada parte falha sozinha: uma que quebra não cala as outras
    # nem a coleta. Postgres parado aparece como réplica faltando (`docker
    # service ls`), não como checagem pulada.
    producao = [c for c in canais if 'teste' not in ((c.get('label') or '') + c['instance_name']).lower()]
    conexoes = None
    try:
        conexoes = checar_servidor_e_conexoes(pg, producao, contas_de_producao, achados)
    except Exception as e:
        achados.nao_medido.append('servidor e conexões: ' + sem_segredo(e))
    if conexoes is not None and producao:
        try:
            checar_mensagens(pg, producao, conexoes, achados)
        except Exception as e:
            achados.nao_medido.append('mensagens: ' + sem_segredo(e))
    try:
        checar_sessoes_99(rd, contas_de_producao, achados, simular)
    except Exception as e:
        achados.nao_medido.append("sessões '.99': " + sem_segredo(e))

    # Coleta dos logs, desde a execução anterior (no máximo COLETA_MAXIMA_H).
    ate = iso(AGORA)[:19]
    piso = iso(AGORA - datetime.timedelta(hours=COLETA_MAXIMA_H))[:19]
    desde = max(estado.get('coletado_ate', piso)[:19], piso)
    registro = {'execucao': iso(AGORA), 'janela': [desde + 'Z', ate + 'Z']}
    coleta_ok = False
    try:
        registro['evolution'] = coletar_evolution(evo, desde, ate) if evo else None
        registro['crm'] = coletar_app('crm_crm', desde, ate)
        registro['agendador'] = coletar_app('crm_agendador', desde, ate)
        coleta_ok = True
    except Exception as e:
        achados.nao_medido.append('coleta: ' + sem_segredo(e))
    descartadas = (registro.get('evolution') or {}).get('descartadas', 0)
    if descartadas:
        achados.problema('descartadas', 'WhatsApp descartou mensagens recebidas',
                         '%d mensagem(ns) de cliente descartada(s) antes de chegar ao CRM desde %s '
                         '(sessão de criptografia de um contato).' % (descartadas, quando(de_iso(desde))),
                         contas_de_producao, evento=True)

    avisos = decidir(estado, achados)
    registro['problemas'] = sorted(achados.problemas)
    registro['nao_medido'] = achados.nao_medido

    if simular:
        resumo = {}
        for fonte in ('evolution', 'crm', 'agendador'):
            dados = registro.get(fonte)
            if isinstance(dados, dict):
                resumo[fonte] = {k: v for k, v in dados.items() if k != 'assinaturas'}
                resumo[fonte]['assinaturas_top'] = list(dados['assinaturas'].items())[:12]
        print(json.dumps({'problemas': achados.problemas, 'normais': sorted(achados.normais),
                          'nao_medido': achados.nao_medido, 'janela_da_coleta': registro['janela'],
                          'avisaria': [{'chave': a[0], 'motivo': a[1], 'titulo': a[2], 'corpo': a[3],
                                        'destinatarios': sum(len(admins.get(c, [])) for c in a[4])}
                                       for a in avisos],
                          'coleta': resumo}, ensure_ascii=False, indent=1))
        return 0

    enviados = enviar(crm, admins, avisos)
    aplicar(estado, achados, enviados)
    registro['avisos'] = [list(e) for e in enviados]
    if coleta_ok:
        estado['coletado_ate'] = ate + 'Z'
    estado['ultima_execucao'] = iso(AGORA)
    dia = AGORA.astimezone(BRT).strftime('%Y-%m-%d')
    with open(os.path.join(PASTA_COLETA, dia + '.jsonl'), 'a', encoding='utf-8') as fh:
        fh.write(json.dumps(registro, ensure_ascii=False, sort_keys=True) + '\n')
    gravar_json(ARQ_ESTADO, estado)
    arrumar_a_casa()
    print('%s ok: %d problema(s) %s; %d aviso(s) gravado(s)%s' % (
        iso(AGORA), len(achados.problemas), sorted(achados.problemas), len(enviados),
        ('; NÃO MEDIDO: ' + ' | '.join(achados.nao_medido)) if achados.nao_medido else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
