#!/usr/bin/env bash
# ============================================================
# deploy_supabase.sh — Déploiement de la migration Supabase-only.
# À lancer depuis la RACINE du repo sur ton Mac :  bash deploy_supabase.sh
#
# Fait les étapes 4 et 5 du guide :
#   - définit les secrets Whoop (lit WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET
#     automatiquement depuis ton fichier .env s'il est présent)
#   - déploie les 3 edge functions
#
# Pré-requis : Supabase CLI installé + projet déjà lié (supabase link).
# La migration SQL (étape 3) reste à faire à la main dans le SQL Editor.
# ============================================================
set -e
cd "$(dirname "$0")"

REDIRECT="https://gfavgstyyaaidkpadkxz.supabase.co/functions/v1/whoop-oauth-callback"

# --- Récupère les valeurs Whoop depuis .env si dispo ---
if [ -f .env ]; then
  WHOOP_CLIENT_ID="$(grep -E '^WHOOP_CLIENT_ID='     .env | head -1 | cut -d= -f2- | tr -d '\r')"
  WHOOP_CLIENT_SECRET="$(grep -E '^WHOOP_CLIENT_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '\r')"
fi
WHOOP_CLIENT_ID="${WHOOP_CLIENT_ID:-7e159226-403f-41a2-8dc6-10f06c81671e}"

if [ -z "$WHOOP_CLIENT_SECRET" ]; then
  echo "⚠  WHOOP_CLIENT_SECRET introuvable dans .env."
  read -r -p "   Colle ton client secret Whoop : " WHOOP_CLIENT_SECRET
fi

echo ""
echo "→ 1/2  Définition des secrets Whoop…"
supabase secrets set WHOOP_CLIENT_ID="$WHOOP_CLIENT_ID"
supabase secrets set WHOOP_CLIENT_SECRET="$WHOOP_CLIENT_SECRET"
supabase secrets set WHOOP_REDIRECT_URI="$REDIRECT"

echo ""
echo "→ 2/2  Déploiement des edge functions…"
supabase functions deploy strava-streams
supabase functions deploy whoop-ingest
supabase functions deploy whoop-oauth-callback --no-verify-jwt

echo ""
echo "✅ Terminé."
echo "   Dernière chose : ajoute cette Redirect URI dans le portail Whoop (developer.whoop.com) :"
echo "   $REDIRECT"
