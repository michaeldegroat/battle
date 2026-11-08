# Sourced by the API scripts. Key resolution, in order:
#   1. $BT_KEY
#   2. ~/.config/battle-training/key
#   3. a placeholder: the environment's Network secret for api.battle.training replaces it in transit
if [ -n "${BT_KEY:-}" ]; then AUTH="Bearer $BT_KEY"
elif [ -r "$HOME/.config/battle-training/key" ]; then AUTH="Bearer $(cat "$HOME/.config/battle-training/key")"
else AUTH="Bearer proxy-injected"; fi
API=https://api.battle.training
BOT=${BOT:-mdeg-armor}
