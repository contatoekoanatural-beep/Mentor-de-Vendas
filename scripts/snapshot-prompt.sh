#!/usr/bin/env bash
# Salva a base do prompt do agente (que vive no Firestore) num arquivo datado
# dentro de prompt-backups/, para o prompt ter historico versionado igual ao codigo.
#
#   bash scripts/snapshot-prompt.sh            # agente patricia
#   bash scripts/snapshot-prompt.sh <agentId>  # outro agente
#
# Requer gcloud autenticado (gcloud auth login).
set -euo pipefail

PROJETO="mentor-de-vendas-ekoa"
AGENTE_ID="${1:-480cbGZmwqhcjElzrTSz}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO="$RAIZ/prompt-backups"

TOKEN="$(gcloud auth print-access-token)"
URL="https://firestore.googleapis.com/v1/projects/$PROJETO/databases/(default)/documents/agents/$AGENTE_ID"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

CODIGO="$(curl -s -H "Authorization: Bearer $TOKEN" "$URL" -o "$TMP" -w '%{http_code}')"
if [ "$CODIGO" != "200" ]; then
  echo "Erro ao ler o agente no Firestore (HTTP $CODIGO)" >&2
  exit 1
fi

mkdir -p "$DESTINO"

node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const campo = (k) => doc.fields?.[k]?.stringValue ?? "";
const slug = campo("slug") || "agente";
const base = campo("base");

if (!base) { console.error("Campo base vazio — nada a salvar."); process.exit(1); }

const agora = new Date();
const p = (n) => String(n).padStart(2, "0");
const carimbo = `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}`;
const destino = `${process.argv[2]}/base-${slug}-${carimbo}.txt`;

fs.writeFileSync(destino, base);
console.log(`Salvo: ${destino}`);
console.log(`${base.length} caracteres | tom: ${campo("tone") ? "definido" : "vazio"} | modo: ${campo("responseMode")}`);
' "$TMP" "$DESTINO"
