#!/usr/bin/env bash
#
# Gate de pre-deploy do backend — rode na VM ANTES de reiniciar o PM2.
#
# POR QUE ISTO EXISTE
# O projeto nao tem CI. Sem um gate, um deploy pode subir com teste vermelho,
# build quebrado ou uma rota nova sem revisao. Este script e o CI possivel:
# roda na VM, no mesmo lugar onde o deploy acontece, e ABORTA antes de tocar
# no processo em producao.
#
# USO (dentro do seu script de deploy, antes do pm2 reload):
#   bash scripts/predeploy-check.sh || exit 1
#
# Para pular temporariamente uma etapa (use com parcimonia e registre o porque):
#   SKIP_AUDIT=1 bash scripts/predeploy-check.sh
#
set -uo pipefail

cd "$(dirname "$0")/.."

FALHAS=0
passo() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✔ %s\033[0m\n' "$1"; }
erro()  { printf '  \033[31mX %s\033[0m\n' "$1"; FALHAS=$((FALHAS+1)); }
aviso() { printf '  \033[33m! %s\033[0m\n' "$1"; }

# ─────────────────────────────────────────────────────────────
passo "1/6 · Segredos nao podem estar versionados"
# Se o repo for git, confirma que nada sensivel entrou no indice.
if [ -d .git ] || git rev-parse --git-dir >/dev/null 2>&1; then
  RASTREADOS=$(git ls-files | grep -E '(^|/)\.env($|\.)|(^|/)credentials/|\.pem$|\.key$' || true)
  if [ -n "$RASTREADOS" ]; then
    erro "Arquivos sensiveis RASTREADOS pelo git:"
    echo "$RASTREADOS" | sed 's/^/      /'
    erro "Remova com: git rm --cached <arquivo> — e rotacione a credencial."
  else
    ok "Nenhum .env, credentials/ ou chave no indice do git"
  fi
else
  aviso "Nao e um repositorio git — checagem pulada (veja item 10.2 do plano)"
fi

# ─────────────────────────────────────────────────────────────
passo "2/6 · Variaveis de ambiente obrigatorias"
FALTANDO=""
for VAR in NODE_ENV JWT_SECRET MONGODB_URI ASAAS_API_KEY WEBHOOK_AUTH_TOKEN; do
  if [ -z "${!VAR:-}" ]; then FALTANDO="$FALTANDO $VAR"; fi
done
if [ -n "$FALTANDO" ]; then
  erro "Variaveis ausentes:$FALTANDO"
else
  ok "Todas presentes"
fi

if [ "${NODE_ENV:-}" != "production" ]; then
  erro "NODE_ENV=${NODE_ENV:-<vazio>} — precisa ser exatamente 'production'."
  erro "Fora disso: cookies perdem o flag Secure, o CORS libera localhost e o trust proxy fica desligado."
fi

if [ -n "${JWT_SECRET:-}" ] && [ ${#JWT_SECRET} -lt 32 ]; then
  erro "JWT_SECRET tem ${#JWT_SECRET} caracteres — minimo 32. Gere com: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
fi

# ─────────────────────────────────────────────────────────────
passo "3/6 · Dependencias (npm ci — reprodutivel)"
# `npm ci` instala EXATAMENTE o package-lock.json e falha se ele estiver
# dessincronizado do package.json. `npm install` mascara essa divergencia.
if npm ci --silent; then
  ok "Dependencias instaladas a partir do lockfile"
else
  erro "npm ci falhou — package-lock.json provavelmente esta dessincronizado"
fi

# ─────────────────────────────────────────────────────────────
passo "4/6 · Build TypeScript"
if npm run build --silent; then
  ok "Compilou sem erros"
else
  erro "Build falhou"
fi

# ─────────────────────────────────────────────────────────────
passo "5/6 · Testes"
if npm run test:ci --silent; then
  ok "Suite completa passou"
else
  erro "Testes falharam — NAO faca deploy"
fi

# ─────────────────────────────────────────────────────────────
passo "6/6 · Inventario de API + vulnerabilidades"
if npx ts-node src/scripts/checkApiInventory.ts; then
  ok "Nenhuma rota nova sem documentacao"
else
  erro "Rota nova sem entrada no API_REAL.md"
fi

if [ "${SKIP_AUDIT:-0}" != "1" ]; then
  # --omit=dev: so o que roda em producao. As dezenas de advisories do
  # react-scripts/webpack sao build-only e nao pertencem a este gate.
  if npm audit --omit=dev --audit-level=high --silent; then
    ok "Sem vulnerabilidades altas/criticas em producao"
  else
    erro "Vulnerabilidade alta/critica em dependencia de producao"
  fi
else
  aviso "npm audit pulado por SKIP_AUDIT=1"
fi

# ─────────────────────────────────────────────────────────────
printf '\n'
if [ "$FALHAS" -gt 0 ]; then
  printf '\033[31m✘ %s verificacao(oes) falharam — deploy ABORTADO.\033[0m\n\n' "$FALHAS"
  exit 1
fi
printf '\033[32m✔ Tudo verde. Seguro para reiniciar o PM2.\033[0m\n\n'
