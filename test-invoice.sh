#!/bin/bash

# Script para testar emissão de NF diretamente via cURL
# Mostra EXATAMENTE o que o Asaas retorna

echo "🧪 TESTE DE EMISSÃO DE NOTA FISCAL - ASAAS"
echo "=========================================="
echo ""

# Carrega variáveis do .env
source .env 2>/dev/null || export $(cat .env | grep -v '^#' | xargs)

echo "📍 Ambiente: $ASAAS_ENVIRONMENT"
echo "🔗 API URL: $ASAAS_API_URL"
echo "🔑 API Key: ${ASAAS_API_KEY:0:20}..."
echo ""

# ID do último pagamento (substitua pelo seu)
PAYMENT_ID="pay_b3ouq3v4dxmvri3t"

echo "💳 Payment ID: $PAYMENT_ID"
echo ""

# Payload da NF
PAYLOAD='{
  "payment": "'$PAYMENT_ID'",
  "serviceDescription": "Teste de veiculação de campanha publicitária",
  "observations": "Teste de emissão via cURL",
  "externalReference": "TEST-CURL-001",
  "effectiveDate": "2025-12-08",
  "municipalServiceId": "06394",
  "municipalServiceCode": "10.08",
  "municipalServiceName": "Agenciamento de publicidade e propaganda, inclusive o agenciamento de veiculacao por quaisquer meios.",
  "deductions": 0,
  "taxes": {
    "retainIss": false,
    "iss": 5.00,
    "cofins": 0,
    "csll": 0,
    "inss": 0,
    "ir": 0,
    "pis": 0
  }
}'

echo "📋 Payload:"
echo "$PAYLOAD" | jq '.' 2>/dev/null || echo "$PAYLOAD"
echo ""

echo "🚀 Enviando requisição..."
echo ""

# Faz a requisição
curl -X POST "$ASAAS_API_URL/invoices" \
  -H "access_token: $ASAAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -v \
  2>&1 | tee /tmp/asaas_response.txt

echo ""
echo ""
echo "=========================================="
echo "📊 RESPOSTA SALVA EM: /tmp/asaas_response.txt"
echo ""
echo "🔍 Se o erro 'invalid_fiscal_info' persistir:"
echo "1. Acesse: https://sandbox.asaas.com"
echo "2. Menu: Configurações → Notas Fiscais"
echo "3. Clique em EDITAR e SALVE novamente"
echo "4. Aguarde 5 minutos e teste novamente"
echo ""
